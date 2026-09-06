import type { UsageProvider, ProviderMessage } from "../base";
import { ClaudeClient } from "./client";
import { ClaudeFormatter } from "./formatter";
import { resolveClaudeOAuthCredentials } from "./oauth-credentials";
import { getClaudeAuthMode } from "../../shared/config";

const client = new ClaudeClient();
const formatter = new ClaudeFormatter();

/**
 * Resolves Claude Code CLI OAuth credentials and fetches usage data,
 * returning a user-facing message for every possible outcome (not
 * authenticated, expired, Keychain/API errors, or a successful fetch).
 */
async function getOAuthUsageMessage(): Promise<ProviderMessage> {
  const resolution = resolveClaudeOAuthCredentials();

  switch (resolution.status) {
    case "not_authenticated":
      return { content: "Claude Code: not authenticated (run `claude` to log in)" };

    case "expired":
      return { content: "Claude Code: token expired — run `claude` to refresh" };

    case "error":
      return {
        content: "",
        error: `Claude Code: ${resolution.error ?? "failed to read credentials"}`,
      };

    case "ok": {
      if (!resolution.credentials) {
        return { content: "", error: "Claude Code: OAuth credentials unavailable" };
      }
      try {
        const data = await client.fetchUsageOAuth(resolution.credentials);
        return { content: formatter.format(data) };
      } catch (error) {
        return {
          content: "",
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }
  }
}

export const claudeProvider: UsageProvider = {
  name: "Claude Code",
  id: "claude",
  description: "Claude Code usage monitoring",

  async getUsageData(): Promise<ProviderMessage | null> {
    const authMode = getClaudeAuthMode();

    try {
      if (authMode === "apiKey") {
        const data = await client.fetchUsageApiKey();
        if (!data) {
          return null;
        }
        return { content: formatter.format(data) };
      }

      if (authMode === "oauth") {
        return await getOAuthUsageMessage();
      }

      // auto: prefer the existing OpenCode auth.json ("apiKey") path,
      // falling back to Claude Code CLI OAuth credentials when it isn't
      // configured. This keeps current behavior unchanged for users who
      // already have OpenCode's own Anthropic auth set up.
      if (client.isConfiguredApiKey()) {
        const data = await client.fetchUsageApiKey();
        if (data) {
          return { content: formatter.format(data) };
        }
      }

      return await getOAuthUsageMessage();
    } catch (error) {
      return {
        content: "",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },

  isConfigured(): boolean {
    const authMode = getClaudeAuthMode();

    if (authMode === "apiKey") {
      return client.isConfiguredApiKey();
    }

    // oauth / auto: always report as configured so an actionable status
    // (not authenticated / expired / error / usage) is shown instead of
    // silently hiding the Claude Code section.
    return true;
  },
};

export default claudeProvider;
