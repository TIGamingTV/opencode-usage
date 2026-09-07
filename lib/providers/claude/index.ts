import type { UsageProvider, ProviderMessage } from "../base";
import { ClaudeClient } from "./client";
import { ClaudeFormatter } from "./formatter";
import { resolveClaudeOAuthCredentials } from "./oauth-credentials";
import { getClaudeAuthMode } from "../../shared/config";
import type { ClaudeUsageResponse } from "./types";

const client = new ClaudeClient();
const formatter = new ClaudeFormatter();

/**
 * Outcome of resolving+fetching Claude usage data, shared by both the
 * full and simple output formats.
 */
type ClaudeResolution =
  | { kind: "data"; data: ClaudeUsageResponse }
  | { kind: "message"; content: string }
  | { kind: "error"; error: string }
  | { kind: "null" };

/**
 * Resolves Claude Code CLI OAuth credentials and fetches usage data,
 * returning a resolution for every possible outcome (not authenticated,
 * expired, Keychain/API errors, or a successful fetch).
 */
async function resolveOAuthUsageData(): Promise<ClaudeResolution> {
  const resolution = resolveClaudeOAuthCredentials();

  switch (resolution.status) {
    case "not_authenticated":
      return { kind: "message", content: "Claude Code: not authenticated (run `claude` to log in)" };

    case "expired":
      return { kind: "message", content: "Claude Code: token expired — run `claude` to refresh" };

    case "error":
      return {
        kind: "error",
        error: `Claude Code: ${resolution.error ?? "failed to read credentials"}`,
      };

    case "ok": {
      if (!resolution.credentials) {
        return { kind: "error", error: "Claude Code: OAuth credentials unavailable" };
      }
      try {
        const data = await client.fetchUsageOAuth(resolution.credentials);
        return { kind: "data", data };
      } catch (error) {
        return {
          kind: "error",
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }
  }
}

/**
 * Resolves Claude usage data according to the configured auth mode.
 * Shared by both the full (/usage) and simple (/usage-simple) output formats.
 */
async function resolveClaudeUsageData(): Promise<ClaudeResolution> {
  const authMode = getClaudeAuthMode();

  try {
    if (authMode === "apiKey") {
      const data = await client.fetchUsageApiKey();
      if (!data) {
        return { kind: "null" };
      }
      return { kind: "data", data };
    }

    if (authMode === "oauth") {
      return await resolveOAuthUsageData();
    }

    // auto: prefer the existing OpenCode auth.json ("apiKey") path,
    // falling back to Claude Code CLI OAuth credentials when it isn't
    // configured. This keeps current behavior unchanged for users who
    // already have OpenCode's own Anthropic auth set up.
    if (client.isConfiguredApiKey()) {
      const data = await client.fetchUsageApiKey();
      if (data) {
        return { kind: "data", data };
      }
    }

    return await resolveOAuthUsageData();
  } catch (error) {
    return {
      kind: "error",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function toProviderMessage(
  resolution: ClaudeResolution,
  format: (data: ClaudeUsageResponse) => string,
): ProviderMessage | null {
  switch (resolution.kind) {
    case "null":
      return null;
    case "data":
      return { content: format(resolution.data) };
    case "message":
      return { content: resolution.content };
    case "error":
      return { content: "", error: resolution.error };
  }
}

export const claudeProvider: UsageProvider = {
  name: "Claude Code",
  id: "claude",
  description: "Claude Code usage monitoring",

  async getUsageData(): Promise<ProviderMessage | null> {
    const resolution = await resolveClaudeUsageData();
    return toProviderMessage(resolution, (data) => formatter.format(data));
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

/**
 * Fetches a compact 5h/week usage summary for Claude Code, intended for
 * quick, phone-readable checks (see /usage-simple).
 */
export async function getClaudeSimpleUsage(): Promise<ProviderMessage | null> {
  const resolution = await resolveClaudeUsageData();
  return toProviderMessage(resolution, (data) => formatter.formatSimple(data));
}

export default claudeProvider;
