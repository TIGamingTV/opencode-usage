import { sendIgnoredMessage, showToast } from "./shared/notification";
import { getCurrentSession, getAllSessions } from "./tracking/tracker";
import { registry } from "./providers/registry";
import { boxHeader } from "./shared/utils";
import { getClaudeSimpleUsage } from "./providers/claude";

interface UsageContext {
  client: any;
  sessionID: string;
  params: any;
}

/**
 * Compact handler for the /usage-simple command
 * Shows only Claude Code's 5h/week usage % and reset countdown,
 * for quick phone-readable checks.
 */
export async function handleUsageSimpleCommand(ctx: UsageContext): Promise<void> {
  const { client, sessionID } = ctx;

  try {
    await showToast(client, "Fetching Claude usage...", "info");

    const result = await getClaudeSimpleUsage();

    let output: string;
    if (!result) {
      output = "Claude Code: not configured.";
    } else if (result.error) {
      output = `Claude Code: ${result.error}`;
    } else {
      output = result.content;
    }

    await sendIgnoredMessage(client, sessionID, output);
    await showToast(client, "Usage updated.", "success");
  } catch (error) {
    console.error("Error in handleUsageSimpleCommand:", error);
    await showToast(client, "Failed to fetch usage metrics.", "error");
  }
}

/**
 * Main handler for the /usage command
 * Shows provider usage data and token usage tracked from message events
 */
export async function handleUsageCommand(ctx: UsageContext): Promise<void> {
  const { client, sessionID, params } = ctx;

  try {
    let output = "";

    await showToast(client, "Fetching usage metrics...", "info");

    // Fetch provider data (Copilot, Claude, Z.ai)
    const providers = registry.getAll();
    const providerResults = await Promise.all(
      providers.map(async (provider) => {
        try {
          const result = await provider.getUsageData();
          if (result && result.content) {
            return {
              provider: provider.name,
              content: result.content,
            };
          }
          return null;
        } catch (error) {
          console.error(`[${provider.name} Error]`, error);
          return null;
        }
      }),
    );

    const validProviderResults = providerResults.filter(
      (r): r is { provider: string; content: string } => r !== null,
    );

    // Add provider data if available
    if (validProviderResults.length > 0) {
      output += validProviderResults.map((r) => r.content).join("\n\n");
      output += "\n";
    }

    // Fetch and add token tracking data
    const current = getCurrentSession();
    const allSessions = getAllSessions();

    if (allSessions.length === 0) {
      if (validProviderResults.length === 0) {
        output = "No usage data available yet.\nConfigure providers or start a conversation to track token usage.";
      } else {
        output += "\nNo token usage data available yet.\nStart a conversation to track token usage.";
      }
    } else {
      if (current) {
        output += formatSession(current, "Current Session");
      } else {
        output += "No active session.\n";
      }

      if (allSessions.length > 1) {
        output += formatAllSessions(allSessions, "All Sessions");
      }
    }

    await sendIgnoredMessage(client, sessionID, output);
    await showToast(client, "Usage metrics updated successfully.", "success");
  } catch (error) {
    console.error("Error in handleUsageCommand:", error);
    await showToast(client, "Failed to fetch usage metrics.", "error");
  }
}

function formatSession(session: any, title: string): string {
  const { total, byModel } = session;

  let output = `\n${boxHeader(title, 80)}\n`;

  const totalTokens =
    total.input + total.output + total.reasoning + total.cacheRead + total.cacheWrite;
  output += `  Total Tokens:    ${formatNumber(totalTokens)}\n`;

  const messageCount =
    byModel.size > 0
      ? Array.from(byModel.values()).reduce((a: number, b: any) => a + b.messageCount, 0)
      : 0;
  output += `  Messages:        ${formatNumber(messageCount)}\n`;

  if (byModel.size > 0) {
    output += `\n  Models:\n`;
    output += `  ${"─".repeat(76)}\n`;

    const models = Array.from(byModel.values())
      .sort((a: any, b: any) => {
        const totalA = sumMetrics(a.metrics);
        const totalB = sumMetrics(b.metrics);
        return totalB - totalA;
      });

    models.forEach((modelStats: any) => {
      const key = `${modelStats.provider}/${modelStats.model}`;
      output += `  ${key}\n`;
      output += `    ${formatMetricsLine(modelStats.metrics, modelStats.messageCount)}\n`;
    });
  }

  return output;
}

function formatAllSessions(sessions: any[], title: string): string {
  if (sessions.length <= 1) return "";

  // Aggregate all sessions into a single summary
  const aggregated = {
    total: { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
    byModel: new Map<string, any>(),
  };

  sessions.forEach((session: any) => {
    aggregated.total.input += session.total.input;
    aggregated.total.output += session.total.output;
    aggregated.total.reasoning += session.total.reasoning;
    aggregated.total.cacheRead += session.total.cacheRead;
    aggregated.total.cacheWrite += session.total.cacheWrite;

    if (session.byModel && session.byModel.size > 0) {
      for (const [key, modelStats] of session.byModel.entries()) {
        const existing = aggregated.byModel.get(key);
        if (existing) {
          existing.metrics.input += modelStats.metrics.input;
          existing.metrics.output += modelStats.metrics.output;
          existing.metrics.reasoning += modelStats.metrics.reasoning;
          existing.metrics.cacheRead += modelStats.metrics.cacheRead;
          existing.metrics.cacheWrite += modelStats.metrics.cacheWrite;
          existing.messageCount += modelStats.messageCount;
        } else {
          aggregated.byModel.set(key, {
            provider: modelStats.provider,
            model: modelStats.model,
            metrics: { ...modelStats.metrics },
            messageCount: modelStats.messageCount,
          });
        }
      }
    }
  });

  let output = `\n${boxHeader(`${title} (${sessions.length} sessions)`, 80)}\n`;

  const totalTokens =
    aggregated.total.input + aggregated.total.output + aggregated.total.reasoning +
    aggregated.total.cacheRead + aggregated.total.cacheWrite;
  output += `  Total Tokens:    ${formatNumber(totalTokens)}\n`;

  const messageCount = aggregated.byModel.size > 0
    ? Array.from(aggregated.byModel.values()).reduce((a: number, b: any) => a + b.messageCount, 0)
    : 0;
  output += `  Messages:        ${formatNumber(messageCount)}\n`;

  if (aggregated.byModel.size > 0) {
    output += `\n  Models:\n`;
    output += `  ${"─".repeat(76)}\n`;

    const models = Array.from(aggregated.byModel.values())
      .sort((a: any, b: any) => sumMetrics(b.metrics) - sumMetrics(a.metrics));

    models.forEach((modelStats: any) => {
      const key = `${modelStats.provider}/${modelStats.model}`;
      output += `  ${key}\n`;
      output += `    ${formatMetricsLine(modelStats.metrics, modelStats.messageCount)}\n`;
    });
  }

  return output;
}

function formatMetricsLine(metrics: any, messageCount: number): string {
  return `In: ${formatNumber(metrics.input)}  Out: ${formatNumber(metrics.output)}  Rea: ${formatNumber(metrics.reasoning)}  Cache-Rd: ${formatNumber(metrics.cacheRead)}  Cache-Wr: ${formatNumber(metrics.cacheWrite)}  Messages: ${formatNumber(messageCount)}`;
}

function formatNumber(num: number): string {
  return num.toLocaleString("en-US");
}

function sumMetrics(metrics: any): number {
  return metrics.input + metrics.output + metrics.reasoning + metrics.cacheRead + metrics.cacheWrite;
}
