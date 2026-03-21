/**
 * constants.ts — All magic values, defaults, and version strings for ClawVitals.
 *
 * Every numeric threshold, default value, and configuration constant is
 * defined here to avoid magic numbers scattered across the codebase.
 */

import type { Severity, ClawVitalsConfig } from './types';

/** ClawVitals skill version (matches package.json) */
export const SKILL_VERSION = '1.1.2';

/** Control library version bundled with this skill release */
export const LIBRARY_VERSION = '1.0.0';

/**
 * Score deduction applied when a stable control FAILs, keyed by severity.
 *
 * These values determine how much each failed control reduces the base score of 100.
 * - critical: Most severe — a single critical failure drops the score significantly
 * - info: Informational findings are never scored (deduction = 0)
 */
export const SEVERITY_DEDUCTION: Record<Severity, number> = {
  critical: 25,
  high: 10,
  medium: 5,
  low: 2,
  info: 0,
};

/** Base score before deductions are applied */
export const BASE_SCORE = 100;

/** Minimum number of evaluable (PASS or FAIL) stable controls required for a valid score */
export const MIN_EVALUABLE_CONTROLS = 5;

/** Minimum evaluable controls per domain before domain score is valid */
export const MIN_DOMAIN_EVALUABLE = 2;

/** Score threshold at or above which the band is 'green' */
export const GREEN_THRESHOLD = 90;

/** Score threshold at or above which the band is 'amber' (below green) */
export const AMBER_THRESHOLD = 70;

/**
 * Maximum number of minor versions behind latest before NC-VERS-002 fails.
 * Uses the year-boundary formula: (latestYear - currentYear) * 12 + (latestMonth - currentMonth)
 */
export const MAX_MINOR_VERSIONS_BEHIND = 2;

/** Default timeout for CLI commands in milliseconds */
export const CLI_TIMEOUT_MS = 30_000;

/** Maximum age of a lock file (in seconds) before it's considered stale */
export const LOCK_STALE_SECONDS = 120;

/** Number of days after which an exclusion without an expiry is flagged as stale */
export const EXCLUSION_STALE_DAYS = 90;

/** Maximum character length for the summary message */
export const SUMMARY_MAX_CHARS = 400;

/** Number of top findings to include in scheduled scan alert messages */
export const ALERT_TOP_FINDINGS = 3;

/** Default number of runs to show in history */
export const HISTORY_DEFAULT_LIMIT = 10;

/** Default retention period for run history in days */
export const DEFAULT_RETENTION_DAYS = 90;

/** Binaries allowed to be executed by CliRunner */
export const ALLOWED_BINARIES: readonly string[] = ['openclaw'] as const;

/** Default telemetry endpoint (HTTPS only) */
export const DEFAULT_TELEMETRY_ENDPOINT = 'https://telemetry.clawvitals.io/ping';

/** Default configuration values for a fresh install */
export const DEFAULT_CONFIG: ClawVitalsConfig = {
  host_name: 'localhost',
  retention_days: DEFAULT_RETENTION_DAYS,
  alert_threshold: 'high',
  exclusions_path: 'exclusions.json',
  version_source: 'auto',
  telemetry_enabled: false,
  telemetry_endpoint: DEFAULT_TELEMETRY_ENDPOINT,

};

/** ClawVitals workspace directory name (under the OpenClaw workspace) */
export const WORKSPACE_DIR = 'clawvitals';

/** Subdirectory for run history */
export const RUNS_DIR = 'runs';

/** Lock file name for concurrent scan prevention */
export const LOCK_FILE = '.lock';

/** Last-success pointer file name */
export const LAST_SUCCESS_FILE = 'last-success.json';

/** Config file name */
export const CONFIG_FILE = 'config.json';

/** Usage state file name */
export const USAGE_FILE = 'usage.json';

/** Exclusions file name (default) */
export const EXCLUSIONS_FILE = 'exclusions.json';

/** File permissions for sensitive files (owner read/write only) */
export const SECURE_FILE_MODE = 0o600;

/** Cron job name for scheduled scans */
export const CRON_JOB_NAME = 'clawvitals:scheduled-scan';

/** Cron expressions for each schedule cadence */
export const CRON_EXPRESSIONS: Record<string, string> = {
  daily: '0 8 * * *',
  weekly: '0 8 * * 1',
  monthly: '0 8 1 * *',
};

/** Regex pattern to extract version from `openclaw --version` output */
export const VERSION_REGEX = /(\d{4}\.\d+\.\d+)/;

/** Map score bands to emoji indicators */
export const BAND_EMOJI: Record<string, string> = {
  green: '\u{1F7E2}',
  amber: '\u{1F7E1}',
  red: '\u{1F534}',
  insufficient_data: '\u{2753}',
};
