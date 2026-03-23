/**
 * alerts.ts — Regression and critical finding alert logic.
 *
 * The plugin evaluates each scan result against the previous scan to determine
 * whether to alert. Two alert categories:
 *
 *   REGRESSION: Score dropped OR new FAIL findings appeared since last scan
 *   CRITICAL:   A critical-severity finding is present (alert immediately)
 *
 * Alert delivery is handled by the OpenClaw messaging layer — the plugin
 * produces an alert payload and OpenClaw routes it to the user's channels.
 */

import type { PluginConfig } from './plugin-config.js';

export type AlertSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export interface ScanSnapshot {
  score: number | 'insufficient_data';
  band: string;
  fail_count: number;
  critical_count: number;
  scan_ts: string;
}

export interface AlertResult {
  should_alert: boolean;
  reason: string;
  severity: AlertSeverity;
  message: string;
}

export interface AlertConfig {
  on_regression: boolean;
  on_new_critical: boolean;
  threshold: AlertSeverity;
}

export function resolveAlertConfig(config: PluginConfig): AlertConfig {
  return {
    on_regression: config.alerts?.on_regression !== false,
    on_new_critical: config.alerts?.on_new_critical !== false,
    threshold: config.alerts?.threshold ?? 'high',
  };
}

/**
 * Evaluate whether to alert based on current vs previous scan.
 * Returns null if no alert is needed.
 */
export function evaluateAlert(
  current: ScanSnapshot,
  previous: ScanSnapshot | null,
  alertConfig: AlertConfig,
): AlertResult | null {
  // Critical finding — alert immediately if on_new_critical is set
  if (alertConfig.on_new_critical && current.critical_count > 0) {
    const prevCritical = previous?.critical_count ?? 0;
    if (current.critical_count > prevCritical) {
      return {
        should_alert: true,
        reason: 'new_critical',
        severity: 'critical',
        message: `🔴 ClawVitals: ${current.critical_count} critical finding(s) detected on your OpenClaw installation. Run \`show clawvitals details\` for remediation steps.`,
      };
    }
  }

  // Regression — score dropped or new FAILs
  if (alertConfig.on_regression && previous !== null) {
    const scoreDrop =
      current.score !== 'insufficient_data' &&
      previous.score !== 'insufficient_data' &&
      current.score < previous.score;

    const newFails = current.fail_count > previous.fail_count;

    if (scoreDrop || newFails) {
      const scoreStr =
        current.score === 'insufficient_data' ? 'N/A' : `${current.score}/100`;
      const prevStr =
        previous.score === 'insufficient_data' ? 'N/A' : `${previous.score}/100`;

      return {
        should_alert: true,
        reason: 'regression',
        severity: 'high',
        message:
          `🟠 ClawVitals: Security posture regression detected.\n` +
          `Score: ${prevStr} → ${scoreStr} (${current.fail_count} failing controls)\n` +
          `Run \`show clawvitals details\` for remediation steps.`,
      };
    }
  }

  return null;
}
