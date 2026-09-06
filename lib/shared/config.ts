import * as fs from "fs";
import * as path from "path";
import * as os from "os";

export type ClaudeAuthMode = "apiKey" | "oauth" | "auto";

export interface OpencodeUsageConfig {
  claude?: {
    authMode?: ClaudeAuthMode;
  };
}

const PROJECT_CONFIG_FILENAMES = ["opencode.json", "opencode.jsonc"];
const GLOBAL_CONFIG_DIR = path.join(os.homedir(), ".config", "opencode");

/**
 * Reads and parses a JSON config file, returning null on any failure
 * (missing file, invalid JSON, etc.)
 */
function readJsonFile(filePath: string): any | null {
  try {
    if (!fs.existsSync(filePath)) {
      return null;
    }
    const content = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/**
 * Looks for an opencode.json/opencode.jsonc in the current working directory
 */
function readProjectConfig(): any | null {
  for (const filename of PROJECT_CONFIG_FILENAMES) {
    const data = readJsonFile(path.join(process.cwd(), filename));
    if (data) {
      return data;
    }
  }
  return null;
}

/**
 * Looks for an opencode.json/opencode.jsonc in the global OpenCode config directory
 */
function readGlobalConfig(): any | null {
  for (const filename of PROJECT_CONFIG_FILENAMES) {
    const data = readJsonFile(path.join(GLOBAL_CONFIG_DIR, filename));
    if (data) {
      return data;
    }
  }
  return null;
}

/**
 * Resolves the `opencodeUsage` section of the OpenCode config, preferring
 * the project-level config over the global one.
 */
export function getOpencodeUsageConfig(): OpencodeUsageConfig {
  const project = readProjectConfig();
  if (project?.opencodeUsage) {
    return project.opencodeUsage as OpencodeUsageConfig;
  }

  const global = readGlobalConfig();
  if (global?.opencodeUsage) {
    return global.opencodeUsage as OpencodeUsageConfig;
  }

  return {};
}

/**
 * Resolves the configured Claude authentication mode.
 * Defaults to "auto" when unset or invalid.
 */
export function getClaudeAuthMode(): ClaudeAuthMode {
  const mode = getOpencodeUsageConfig().claude?.authMode;
  if (mode === "apiKey" || mode === "oauth" || mode === "auto") {
    return mode;
  }
  return "auto";
}
