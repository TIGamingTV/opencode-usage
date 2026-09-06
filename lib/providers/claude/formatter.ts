import { formatResetLine } from "../../shared/formatting";
import { createUsedProgressBar, boxHeader } from "../../shared/utils";
import type { ClaudeUsageResponse, QuotaPeriod } from "./types";

export class ClaudeFormatter {
  /**
   * Formats a Claude quota line with progress bar
   */
  private formatQuotaLine(name: string, quota: QuotaPeriod | null): string {
    if (!quota) {
      return `  ${name.padEnd(16)} N/A`;
    }

    const percentUsed = Math.round(quota.utilization);
    const progressBar = createUsedProgressBar(percentUsed, 20);

    return `  ${name.padEnd(16)} ${progressBar} ${percentUsed}%`;
  }

  /**
   * Formats a single quota period as a compact "label: pct% (resets in Xd Xh Xm)" line
   */
  private formatSimpleLine(label: string, quota: QuotaPeriod | null): string {
    if (!quota) {
      return `${label}: N/A`;
    }

    const percentUsed = Math.round(quota.utilization);
    return `${label}: ${percentUsed}%${this.formatSimpleResetSuffix(quota.resets_at)}`;
  }

  /**
   * Formats a minute-precision countdown suffix (more granular than formatResetCountdown,
   * which is useful given the 5-hour window)
   */
  private formatSimpleResetSuffix(resetDate: string | undefined): string {
    if (!resetDate) {
      return "";
    }

    const diffMs = new Date(resetDate).getTime() - Date.now();
    if (diffMs <= 0) {
      return " (resets soon)";
    }

    const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diffMs % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
    const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));

    const parts: string[] = [];
    if (days > 0) parts.push(`${days}d`);
    if (days > 0 || hours > 0) parts.push(`${hours}h`);
    parts.push(`${minutes}m`);

    return ` (resets in ${parts.join(" ")})`;
  }

  /**
   * Formats a minimal two-line summary: 5h and 7-day (week) usage % with reset countdown.
   * Intended for quick, phone-readable checks.
   */
  formatSimple(data: ClaudeUsageResponse): string {
    const lines: string[] = [];
    lines.push(this.formatSimpleLine("5h", data.five_hour));
    lines.push(this.formatSimpleLine("Week", data.seven_day));
    return lines.join("\n");
  }

  /**
   * Formats Claude usage data for display
   */
  format(data: ClaudeUsageResponse): string {
    const lines: string[] = [];

    lines.push(boxHeader("CLAUDE CODE", 80));

    lines.push(this.formatQuotaLine("5 Hour:", data.five_hour));
    lines.push(this.formatQuotaLine("7 Day:", data.seven_day));

    if (data.five_hour) {
      lines.push("  " + formatResetLine("5h Resets:", data.five_hour.resets_at, 15));
    }

    if (data.seven_day) {
      lines.push("  " + formatResetLine("7d Resets:", data.seven_day.resets_at, 15));
    }

    const extraUsage = data.extra_usage;
    if (extraUsage.is_enabled) {
      const utilization =
        extraUsage.utilization !== null ? `${Math.round(extraUsage.utilization)}%` : "N/A";
      const credits =
        extraUsage.used_credits !== null && extraUsage.monthly_limit !== null
          ? `${extraUsage.used_credits}/${extraUsage.monthly_limit}`
          : "N/A";
      lines.push(`  Extra Usage:     Enabled - ${utilization} (${credits})`);
    } else {
      lines.push("  Extra Usage:     Disabled");
    }

    return lines.join("\n");
  }
}
