/**
 * plugin-config.ts — Plugin configuration and state types for the ClawVitals plugin.
 *
 * These are distinct from the scan pipeline types (types.ts) which cover the
 * full ClawVitals assessment data model. This file covers plugin-level state:
 * config, telemetry params, install state, and trial/upgrade types.
 */

export interface PluginConfig {
  telemetry?: {
    enabled?: boolean;
    endpoint?: string;
    /** Human-readable alias for this install on the dashboard (e.g. "prod-server-1") */
    alias?: string;
  };
  schedule?: {
    enabled?: boolean;
    cron?: string;
  };
  alerts?: {
    on_regression?: boolean;
    on_new_critical?: boolean;
    threshold?: 'critical' | 'high' | 'medium' | 'low' | 'info';
  };
  retention_days?: number;
}

export interface TelemetryPingParams {
  /** Skill version */
  v: string;
  /** Control library version */
  lv: string;
  /** Numeric score */
  s: string;
  /** Score band */
  b: string;
  /** FAIL count */
  sf: string;
  /** PASS count */
  sp: string;
  /** Total lifetime runs */
  tr: string;
  /** Scheduled scan flag (1/0) */
  sc: string;
  /** Install UUID (no PII) */
  iid: string;
  /**
   * Human-readable alias for fleet management.
   * Set by user via config — never derived from machine hostname or username.
   * Optional. Dashboard shows alias instead of raw UUID when present.
   */
  alias?: string;
}

export interface PluginInstallState {
  /** UUID v4 generated at plugin install time */
  install_id: string;
  /** ISO 8601 timestamp of plugin install */
  installed_at: string;
  /** Total scans sent via plugin telemetry */
  total_pings: number;
  /** Last ping timestamp */
  last_ping_at: string | null;
  /** HMAC-SHA256 webhook secret for verifying incoming trial reminder webhooks */
  webhook_secret?: string;
}

export interface TrialReminderPayload {
  type: 'trial_reminder' | 'trial_expired';
  days_remaining: number;
  current_score: number | null;
  current_band: string | null;
  instance_count: number;
  features_at_risk: string[];
  upgrade_url: string;
  org_id: string;
  install_id: string | null;
}

export interface TrialStatus {
  plan: 'trial' | 'pro' | 'free';
  days_remaining: number | null;
  ends_at: string | null;
  upgrade_url: string;
}
