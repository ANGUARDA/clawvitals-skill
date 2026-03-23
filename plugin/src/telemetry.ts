/**
 * telemetry.ts — Plugin telemetry client.
 *
 * The ClawVitals skill (on ClawHub) is stateless and makes no network calls — it has
 * no telemetry at all. The skill is locked and will not change.
 *
 * The plugin is different: it exists specifically to connect your installation to
 * clawvitals.io/dashboard. Telemetry IS the product — without it, the dashboard has
 * no data. So the plugin defaults telemetry to ON (opt-out, not opt-in).
 *
 * Users can opt out at any time:
 *   openclaw plugins config clawvitals set telemetry.enabled false
 *
 * WHAT IS SENT (full list — nothing else):
 *   v     — skill version string (e.g. "1.2.4")
 *   lv    — control library version (e.g. "1.0.0")
 *   s     — overall numeric score (0–100)
 *   b     — score band ("green" | "amber" | "red")
 *   sf    — count of FAIL findings
 *   sp    — count of PASS findings
 *   tr    — total lifetime scan count for this install
 *   sc    — 1 if scheduled, 0 if manual
 *   iid   — random UUID generated at plugin install time (no PII)
 *   alias — user-set display name for fleet management (OPTIONAL, user-controlled)
 *
 * WHAT IS NEVER SENT:
 *   - Hostnames, usernames, IP addresses, or file paths
 *   - Finding details, control IDs, or failure reasons
 *   - OpenClaw config, tokens, credentials, or secrets
 *   - Machine identifiers of any kind (only user-set alias, and only if configured)
 */

import type { PluginConfig, TelemetryPingParams, PluginInstallState } from './plugin-config.js';

const DEFAULT_ENDPOINT = 'https://telemetry.clawvitals.io/ping';

export interface ScanSummary {
  version: string;
  library_version: string;
  score: number | 'insufficient_data';
  band: string;
  fail_count: number;
  pass_count: number;
  is_scheduled: boolean;
}

export class PluginTelemetryClient {
  private config: PluginConfig;
  private state: PluginInstallState;

  constructor(config: PluginConfig, state: PluginInstallState) {
    this.config = config;
    this.state = state;
  }

  /**
   * Whether telemetry is enabled.
   * Defaults to TRUE — the plugin's purpose is dashboard connectivity.
   * The skill has no telemetry at all (stateless, no network calls).
   * Users opt OUT rather than opt IN.
   */
  get isEnabled(): boolean {
    return this.config.telemetry?.enabled !== false;
  }

  get endpoint(): string {
    const ep = this.config.telemetry?.endpoint ?? DEFAULT_ENDPOINT;
    return ep.startsWith('https://') ? ep : DEFAULT_ENDPOINT;
  }

  /**
   * Fire-and-forget ping with scan summary.
   * Errors are silently swallowed — telemetry must never affect scan operation.
   */
  async ping(scan: ScanSummary): Promise<void> {
    if (!this.isEnabled) return;

    try {
      const params: TelemetryPingParams = {
        v:   scan.version,
        lv:  scan.library_version,
        s:   scan.score === 'insufficient_data' ? 'nd' : String(scan.score),
        b:   scan.band,
        sf:  String(scan.fail_count),
        sp:  String(scan.pass_count),
        tr:  String(this.state.total_pings + 1),
        sc:  scan.is_scheduled ? '1' : '0',
        iid: this.state.install_id,
      };

      // Include alias only if the user explicitly set it in config.
      // Never derive from hostname, username, or any machine identifier.
      const alias = this.config.telemetry?.alias?.trim();
      if (alias) {
        params.alias = alias.slice(0, 64); // enforce max length
      }

      const qs = new URLSearchParams(params as unknown as Record<string, string>);
      const url = `${this.endpoint}?${qs.toString()}`;

      await fetch(url, {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      });
    } catch {
      // Silently swallow — telemetry must never affect scan operation
    }
  }
}
