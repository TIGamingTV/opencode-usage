import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

/**
 * Isolated, read-only resolver for Claude Code CLI's own OAuth credentials.
 *
 * This is completely separate from OpenCode's own auth.json ("anthropic")
 * credential store used by the pre-existing API-key implementation. It only
 * reads credentials that the `claude` CLI itself manages, and never writes
 * to or refreshes any credential store.
 */

const PRIMARY_KEYCHAIN_SERVICE = "Claude Code-credentials";

export interface ClaudeOAuthCredentials {
  accessToken: string;
  refreshToken?: string;
  /** Epoch milliseconds */
  expiresAt?: number;
  subscriptionType?: string;
}

export type ClaudeOAuthStatus = "ok" | "not_authenticated" | "expired" | "error";

export interface ClaudeOAuthResolution {
  status: ClaudeOAuthStatus;
  credentials?: ClaudeOAuthCredentials;
  source?: "env" | "keychain" | "file";
  error?: string;
}

function getClaudeConfigDir(): string {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");
}

function isExpired(expiresAt: number | undefined): boolean {
  if (typeof expiresAt !== "number") {
    return false;
  }
  return expiresAt <= Date.now();
}

/**
 * Parses a raw credential blob into normalized OAuth credentials.
 * Supports both plain JSON and hex-encoded JSON (some macOS Keychain reads
 * return binary/non-printable password data as a hex string instead of the
 * literal text). Returns null if the blob cannot be parsed into a usable
 * credential shape.
 */
function parseCredentialBlob(raw: string): ClaudeOAuthCredentials | null {
  const tryParseJson = (text: string): any | null => {
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  };

  const trimmed = raw.trim();
  let parsed = tryParseJson(trimmed);

  if (!parsed && /^[0-9a-fA-F]+$/.test(trimmed) && trimmed.length % 2 === 0) {
    try {
      const decoded = Buffer.from(trimmed, "hex").toString("utf-8");
      parsed = tryParseJson(decoded);
    } catch {
      parsed = null;
    }
  }

  if (!parsed || typeof parsed !== "object") {
    return null;
  }

  // Credentials file / Keychain blob shape: { claudeAiOauth: { ... } }
  // Some versions may store the fields at the top level instead.
  const data = parsed.claudeAiOauth ?? parsed;

  if (typeof data.accessToken !== "string") {
    return null;
  }

  return {
    accessToken: data.accessToken,
    refreshToken: typeof data.refreshToken === "string" ? data.refreshToken : undefined,
    expiresAt: typeof data.expiresAt === "number" ? data.expiresAt : undefined,
    subscriptionType:
      typeof data.subscriptionType === "string" ? data.subscriptionType : undefined,
  };
}

/**
 * Reads a specific keychain service entry via the macOS `security` CLI.
 * Returns null if the entry simply doesn't exist; throws for any other
 * failure (locked keychain, access denied, timeout, etc.) so callers can
 * surface the error instead of silently treating it as "not configured".
 */
function readKeychainEntry(serviceName: string): string | null {
  try {
    const result = execSync(`security find-generic-password -s "${serviceName}" -w`, {
      timeout: 3000,
      encoding: "utf-8",
    });
    return result.trim();
  } catch (err: any) {
    // Exit code 44: "The specified item could not be found in the keychain."
    if (err?.status === 44) {
      return null;
    }
    if (err?.killed || err?.code === "ETIMEDOUT") {
      throw new Error(
        "Keychain read timed out. This can happen on macOS Tahoe. Try restarting Keychain Access.",
      );
    }
    if (err?.status === 36) {
      throw new Error(
        "macOS Keychain is locked. Please unlock it or run: security unlock-keychain ~/Library/Keychains/login.keychain-db",
      );
    }
    if (err?.status === 128) {
      throw new Error("Keychain access was denied. Please grant access when prompted by macOS.");
    }
    throw new Error(
      `Failed to read Keychain entry "${serviceName}" (exit ${err?.status ?? "unknown"}).`,
    );
  }
}

/**
 * Lists all Claude Code credential entries in the macOS Keychain. There may
 * be more than one when multiple accounts have been used with the CLI.
 */
function listKeychainServices(): string[] {
  try {
    const dump = execSync("security dump-keychain", {
      timeout: 5000,
      maxBuffer: 1024 * 1024 * 10,
      encoding: "utf-8",
    });

    const services = new Set<string>();
    const re = /"Claude Code-credentials(?:-[0-9a-f]+)?"/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(dump)) !== null) {
      services.add(match[0].slice(1, -1));
    }

    if (services.size === 0) {
      return [PRIMARY_KEYCHAIN_SERVICE];
    }

    const ordered: string[] = [];
    if (services.has(PRIMARY_KEYCHAIN_SERVICE)) {
      ordered.push(PRIMARY_KEYCHAIN_SERVICE);
    }
    for (const svc of services) {
      if (svc !== PRIMARY_KEYCHAIN_SERVICE) {
        ordered.push(svc);
      }
    }
    return ordered;
  } catch {
    return [PRIMARY_KEYCHAIN_SERVICE];
  }
}

/**
 * Attempts to resolve Claude Code OAuth credentials from the macOS Keychain.
 * Returns null if no matching entries exist anywhere in the Keychain.
 * Throws if the Keychain itself could not be read (locked, access denied,
 * timed out, etc.) so that condition can be reported distinctly.
 */
function resolveFromKeychain(): ClaudeOAuthCredentials | null {
  const services = listKeychainServices();
  let keychainError: Error | null = null;

  for (const service of services) {
    try {
      const raw = readKeychainEntry(service);
      if (!raw) {
        continue;
      }
      const creds = parseCredentialBlob(raw);
      if (creds) {
        return creds;
      }
    } catch (err) {
      keychainError = err instanceof Error ? err : new Error(String(err));
    }
  }

  if (keychainError) {
    throw keychainError;
  }

  return null;
}

/**
 * Reads Claude Code OAuth credentials from the `.credentials.json` file used
 * by the Claude Code CLI: `$CLAUDE_CONFIG_DIR/.credentials.json` when
 * `CLAUDE_CONFIG_DIR` is set, otherwise `~/.claude/.credentials.json`.
 */
function resolveFromCredentialsFile(): ClaudeOAuthCredentials | null {
  try {
    const credPath = path.join(getClaudeConfigDir(), ".credentials.json");
    if (!fs.existsSync(credPath)) {
      return null;
    }
    const raw = fs.readFileSync(credPath, "utf-8");
    return parseCredentialBlob(raw);
  } catch {
    return null;
  }
}

/**
 * Resolves Claude Code OAuth credentials without ever writing to or
 * refreshing any credential store. Resolution order:
 *
 *   1. `CLAUDE_CODE_OAUTH_TOKEN` environment variable
 *   2. macOS Keychain entry (or entries) named "Claude Code-credentials"
 *   3. `$CLAUDE_CONFIG_DIR/.credentials.json` or `~/.claude/.credentials.json`
 *
 * Never throws: unexpected failures are reported via `status: "error"`.
 */
export function resolveClaudeOAuthCredentials(): ClaudeOAuthResolution {
  try {
    const envToken = process.env.CLAUDE_CODE_OAUTH_TOKEN;
    if (envToken) {
      return {
        status: "ok",
        source: "env",
        credentials: { accessToken: envToken },
      };
    }

    if (process.platform === "darwin") {
      try {
        const creds = resolveFromKeychain();
        if (creds) {
          return {
            status: isExpired(creds.expiresAt) ? "expired" : "ok",
            source: "keychain",
            credentials: creds,
          };
        }
      } catch (err) {
        return {
          status: "error",
          source: "keychain",
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }

    const fileCreds = resolveFromCredentialsFile();
    if (fileCreds) {
      return {
        status: isExpired(fileCreds.expiresAt) ? "expired" : "ok",
        source: "file",
        credentials: fileCreds,
      };
    }

    return { status: "not_authenticated" };
  } catch (err) {
    return {
      status: "error",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
