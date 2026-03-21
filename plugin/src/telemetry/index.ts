/**
 * telemetry/index.ts — TelemetryClient: fire-and-forget GET ping.
 *
 * Sends anonymous, non-identifying scan summary data to the telemetry endpoint
 * ONLY when the user has explicitly run "clawvitals telemetry on".
 *
 * Off by default. No retry. Errors silently swallowed.
 *
 * WHAT IS SENT (full list — nothing else):
 *   v   — skill version string (e.g. "0.1.6")
 *   lv  — control library version string (e.g. "1.0.0")
 *   s   — overall numeric score (0–100)
 *   b   — score band ("green" | "amber" | "red")
 *   sf  — count of FAIL findings (integer)
 *   sp  — count of PASS findings (integer)
 *   tr  — total lifetime scan count for this install (integer)
 *   sc  — 1 if this was a scheduled scan, 0 if manual
 *   iid — random UUID generated at install time (no PII)
 *
 * WHAT IS NEVER SENT:
 *   - Finding details, control IDs, or failure reasons
 *   - File paths, hostnames, IP addresses, or usernames
 *   - OpenClaw config, tokens, credentials, or secrets
 *   - org_token or agent session tokens
 */

import type { RunReport, UsageState, ClawVitalsConfig } from '../types';

export class TelemetryClient {
  async ping(report: RunReport, usage: UsageState, config: ClawVitalsConfig): Promise<void> {
    if (!config.telemetry_enabled) return;                            // opt-in required
    if (!config.telemetry_endpoint.startsWith('https://')) return;   // HTTPS only

    try {
      const params = new URLSearchParams({
        v:   report.version,                                                              // skill version
        lv:  report.library_version,                                                      // control library version
        s:   String(report.dock_analysis.stable.score),                                   // numeric score 0–100
        b:   report.dock_analysis.stable.band,                                            // green / amber / red
        sf:  String(report.dock_analysis.stable.findings.filter(f => f.result === 'FAIL').length), // FAIL count
        sp:  String(report.dock_analysis.stable.findings.filter(f => f.result === 'PASS').length), // PASS count
        tr:  String(usage.total_runs),                                                    // total scans (integer)
        sc:  report.meta.is_scheduled ? '1' : '0',                                       // scheduled=1, manual=0
        iid: usage.install_id,                                                            // random UUID, no PII
        // No org_token. No hostnames. No finding details. No paths. No secrets.
      });

      const url = `${config.telemetry_endpoint}?${params.toString()}`;
      await fetch(url, { method: 'GET', signal: AbortSignal.timeout(5000) });
    } catch {
      // Silently swallow — telemetry must never affect scan operation
    }
  }
}
