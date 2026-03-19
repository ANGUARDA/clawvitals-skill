/**
 * telemetry/index.ts — TelemetryClient: fire-and-forget GET ping.
 *
 * Sends anonymous scan summaries to the telemetry endpoint when enabled.
 * All errors are silently swallowed — telemetry must never affect scan operation.
 * No retry on failure.
 */

import type { RunReport, UsageState, ClawVitalsConfig } from '../types';

/**
 * TelemetryClient sends anonymous usage telemetry as a GET request.
 * Fire-and-forget: errors are swallowed, no retries.
 */
export class TelemetryClient {
  /**
   * Send a telemetry ping with scan summary data.
   * Only fires when telemetry is enabled in config.
   *
   * @param report - The completed scan report
   * @param usage - Current usage state
   * @param config - Current configuration
   */
  async ping(report: RunReport, usage: UsageState, config: ClawVitalsConfig): Promise<void> {
    if (!config.telemetry_enabled) return;
    if (!config.telemetry_endpoint.startsWith('https://')) return;

    try {
      const params = new URLSearchParams({
        v: report.version,
        lv: report.library_version,
        s: String(report.dock_analysis.stable.score),
        b: report.dock_analysis.stable.band,
        sf: String(report.dock_analysis.stable.findings.filter(f => f.result === 'FAIL').length),
        sp: String(report.dock_analysis.stable.findings.filter(f => f.result === 'PASS').length),
        tr: String(usage.total_runs),
        sc: report.meta.is_scheduled ? '1' : '0',
        iid: usage.install_id,
      });

      if (config.org_token) {
        params.set('org', config.org_token);
      }

      const url = `${config.telemetry_endpoint}?${params.toString()}`;
      await fetch(url, {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      });
    } catch {
      // Silently swallow all telemetry errors — must never affect scan operation
    }
  }
}
