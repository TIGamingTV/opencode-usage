import { fetchWithTimeout } from "../../shared/utils";
import { readAuthConfig, type AuthProvider } from "../../shared/auth";
import type { ClaudeUsageResponse } from "./types";
import type { ClaudeOAuthCredentials } from "./oauth-credentials";

const ANTHROPIC_API_BASE_URL = "https://api.anthropic.com";

export class ClaudeClient {
  private readonly apiBaseUrl = ANTHROPIC_API_BASE_URL;

  /**
   * Builds headers for authentication with Claude API
   */
  private buildClaudeHeaders(token: string): Record<string, string> {
    return {
      "Accept": "application/json, text/plain, */*",
      "Content-Type": "application/json",
      "User-Agent": "claude-code/2.0.32",
      "Authorization": `Bearer ${token}`,
      "anthropic-beta": "oauth-2025-04-20",
    };
  }

  /**
   * Fetches usage data from Claude's OAuth usage endpoint using a bearer
   * token. Shared by both the OpenCode auth.json ("apiKey") path and the
   * Claude Code CLI OAuth credential path so both map to the exact same
   * internal representation.
   */
  private async fetchUsageWithToken(token: string): Promise<ClaudeUsageResponse> {
    const url = `${this.apiBaseUrl}/api/oauth/usage`;
    const response = await fetchWithTimeout(url, {
      headers: this.buildClaudeHeaders(token),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Anthropic API Error ${response.status}: ${errorText}`);
    }

    return response.json();
  }

  /**
   * Fetches Claude usage data using OpenCode's own stored Anthropic
   * credentials (`~/.local/share/opencode/auth.json`). This is the
   * pre-existing "apiKey" authentication path and is unchanged.
   */
  async fetchUsageApiKey(): Promise<ClaudeUsageResponse | null> {
    const authConfig = readAuthConfig();

    if (!authConfig) {
      return null;
    }

    const authData: AuthProvider | undefined = authConfig.anthropic;

    if (!authData) {
      return null;
    }

    const token = authData.access || authData.refresh;

    if (!token) {
      throw new Error("No token found in Anthropic auth data");
    }

    return this.fetchUsageWithToken(token);
  }

  /**
   * Fetches Claude usage data using Claude Code CLI OAuth credentials
   * (macOS Keychain, `.credentials.json`, or `CLAUDE_CODE_OAUTH_TOKEN`).
   */
  async fetchUsageOAuth(credentials: ClaudeOAuthCredentials): Promise<ClaudeUsageResponse> {
    return this.fetchUsageWithToken(credentials.accessToken);
  }

  /**
   * Checks if Claude is configured via OpenCode's own auth.json
   * ("apiKey" authentication path).
   */
  isConfiguredApiKey(): boolean {
    const authConfig = readAuthConfig();
    return !!authConfig?.anthropic;
  }
}
