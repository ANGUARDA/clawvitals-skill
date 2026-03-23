/**
 * types.ts — Shared TypeScript types for ClawVitals.
 *
 * All interfaces and type aliases used across the skill are defined here.
 * This module is the single source of truth for data shapes flowing through
 * the collection → evaluation → scoring → reporting pipeline.
 */

// ── Enums and Union Types ───────────────────────────────────────

/** Status of a control in the library lifecycle */
export type ControlStatus = 'stable' | 'experimental' | 'deprecated' | 'deferred';

/** Result of evaluating a single control against collected data */
export type EvalResult = 'PASS' | 'FAIL' | 'SKIP' | 'ERROR' | 'EXCLUDED';

/** Severity level for controls and findings */
export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';

/** Overall security posture band derived from the numeric score */
export type ScoreBand = 'green' | 'amber' | 'red' | 'insufficient_data';

/** How a control's data source relates to the finding */
export type SourceType = 'authoritative' | 'contextual' | 'derived';

// ── Control Library ─────────────────────────────────────────────

/** A single security control definition from the control library JSON */
export interface Control {
  /** Unique identifier, e.g. "NC-OC-003" */
  id: string;
  /** Human-readable name, max 60 chars */
  name: string;
  /** Domain code: "OC", "AUTH", "VERS", etc. */
  domain: string;
  /** Authoritative Dock severity for this control */
  severity: Severity;
  /** Minimum mode required (1 for MVP) */
  mode: number;
  /** Library lifecycle status */
  status: ControlStatus;
  /** SemVer of library version when this control was first added */
  introduced_in: string;
  /** What this control checks */
  description: string;
  /** Plain-English explanation of the risk */
  why_it_matters: string;
  /** Check configuration */
  check: {
    /** Which data source this check uses */
    source: string;
    /** How the source relates to the finding */
    source_type: SourceType;
    /** Condition that must be true before this check applies */
    prerequisite?: string;
    /** Message shown when skipped due to prerequisite */
    prerequisite_skip_reason?: string;
    /** Human-readable condition description */
    condition: string;
  };
  /** Template for the evidence string shown in the report */
  evidence_template: string;
  /** Exact steps to fix, including documentation URL */
  remediation: string;
  /** At least one reference URL */
  references: string[];
  /** Known false positive scenarios */
  false_positive_notes: string;
}

/** Versioned collection of controls */
export interface ControlLibrary {
  /** SemVer version of this library */
  version: string;
  /** ISO 8601 generation timestamp */
  generated: string;
  /** All controls in this library version */
  controls: Control[];
}

// ── Raw CLI Outputs ─────────────────────────────────────────────

/** A single finding from `openclaw security audit --json` */
export interface SecurityAuditFinding {
  /** Machine-readable check identifier */
  checkId: string;
  /** OpenClaw-assigned severity */
  severity: 'info' | 'warn' | 'critical';
  /** Human-readable title */
  title: string;
  /** Detailed description of the finding */
  detail: string;
  /** Remediation guidance (optional on info-level findings) */
  remediation?: string;
}

/** Full output of `openclaw security audit --json` */
export interface SecurityAuditOutput {
  /** Unix timestamp of the audit */
  ts: number;
  /** Count of findings by severity */
  summary: { critical: number; warn: number; info: number };
  /** All findings from the audit */
  findings: SecurityAuditFinding[];
}

/** Health status of a single messaging channel */
export interface HealthChannel {
  /** Whether the channel is configured */
  configured: boolean;
  /** Whether the channel process is running */
  running: boolean;
  /** Probe result */
  probe: { ok: boolean; error?: string };
}

/** Full output of `openclaw health --json` */
export interface HealthOutput {
  /** Overall health status */
  ok: boolean;
  /** Unix timestamp */
  ts: number;
  /** Time taken for health check */
  durationMs: number;
  /** Per-channel health status */
  channels: Record<string, HealthChannel>;
  /** Connected agents */
  agents: Array<{
    agentId: string;
    isDefault: boolean;
    heartbeat: unknown;
    sessions: unknown;
  }>;
  /** Heartbeat interval */
  heartbeatSeconds: number;
}

/** Full output of `openclaw update status --json` */
export interface UpdateStatusOutput {
  /** Update metadata */
  update: {
    root: string;
    installKind: string;
    packageManager: string;
    registry: { latestVersion: string };
    deps: { status: string; reason?: string };
  };
  /** Update availability */
  availability: {
    available: boolean;
    hasRegistryUpdate: boolean;
    latestVersion?: string | null;
  };
  /** Release channel */
  channel: { value: string };
}

// ── Parsed attack_surface detail ────────────────────────────────

/**
 * Structured representation of the attack_surface info finding's detail string.
 * Fields are null when parsing fails for that specific field.
 */
export interface AttackSurface {
  /** Number of open (unauthenticated) groups, null if unparseable */
  groups_open: number | null;
  /** Whether elevated tools are enabled */
  tools_elevated: boolean | null;
  /** Whether webhook receiver is enabled */
  hooks_webhooks: boolean | null;
  /** Whether internal hooks are enabled */
  hooks_internal: boolean | null;
  /** Whether browser control is enabled */
  browser_control: boolean | null;
  /** Original unparsed detail string */
  raw: string;
  /** True if all known fields parsed without errors */
  parse_ok: boolean;
  /** List of parse error messages for diagnostics */
  parse_errors: string[];
}

// ── Collector outputs ───────────────────────────────────────────

/** Wrapper for a single data source's collection result */
export interface SourceResult<T> {
  /** Whether collection succeeded */
  ok: boolean;
  /** Parsed data (null on failure) */
  data: T | null;
  /** Collection timestamp (null on failure) */
  ts: number | null;
  /** Error message (null on success) */
  error: string | null;
}

/** Version command result (simpler than other sources) */
export interface VersionResult {
  /** Whether the version command succeeded */
  ok: boolean;
  /** Parsed version string, e.g. "2026.3.13" */
  version: string | null;
  /** Error message on failure */
  error: string | null;
}

/** Combined results from all four data collection sources */
export interface CollectorResult {
  /** Security audit findings */
  security_audit: SourceResult<SecurityAuditOutput>;
  /** Gateway health status */
  health: SourceResult<HealthOutput>;
  /** Update availability */
  update_status: SourceResult<UpdateStatusOutput>;
  /** OpenClaw version */
  version_cmd: VersionResult;
  /** Parsed attack surface from security audit detail */
  attack_surface: AttackSurface | null;
}

// ── Evaluation ──────────────────────────────────────────────────

/** Result of evaluating a single control against collected data */
export interface ControlEvaluation {
  /** Control identifier */
  control_id: string;
  /** Human-readable control name */
  control_name: string;
  /** Domain code */
  domain: string;
  /** Control severity */
  severity: Severity;
  /** Library lifecycle status */
  status: ControlStatus;
  /** Evaluation result */
  result: EvalResult;
  /** Data source used */
  source: string;
  /** Source type classification */
  source_type: SourceType;
  /** Rendered evidence string */
  evidence: string;
  /** Remediation guidance (null on PASS/SKIP/ERROR) */
  remediation: string | null;
  /** Reason for exclusion (null unless EXCLUDED) */
  exclusion_reason: string | null;
  /** Exclusion expiry date (null unless EXCLUDED) */
  exclusion_expires: string | null;
  /** Error details (null unless ERROR) */
  error_detail: string | null;
  /** Reason for skipping (null unless SKIP) */
  skip_reason: string | null;
  /** SemVer of library version when this control was first added */
  introduced_in: string;
}

// ── Scoring ─────────────────────────────────────────────────────

/** Score for a single domain */
export interface DomainScore {
  /** Domain code */
  domain: string;
  /** Numeric score or insufficient_data */
  score: number | 'insufficient_data';
  /** Number of controls evaluated (PASS or FAIL) */
  controls_evaluated: number;
}

/** Overall scoring result from stable controls */
export interface ScoreResult {
  /** Numeric score (0-100) or insufficient_data */
  score: number | 'insufficient_data';
  /** Posture band */
  band: ScoreBand;
  /** Per-domain breakdown */
  domains: DomainScore[];
  /** Count of stable controls that passed */
  stable_pass: number;
  /** Count of stable controls that failed */
  stable_fail: number;
  /** Count of stable controls that were skipped */
  stable_skip: number;
  /** Count of stable controls that errored */
  stable_error: number;
  /** Count of stable controls that were excluded */
  stable_excluded: number;
}

// ── Delta ───────────────────────────────────────────────────────

/** Changes detected between current and previous scan */
export interface DeltaResult {
  /** Controls that are now FAIL but were not FAIL before */
  new_findings: ControlEvaluation[];
  /** Controls that were FAIL before but are now PASS */
  resolved_findings: ControlEvaluation[];
  /** Controls introduced in a newer library version than the previous scan */
  new_checks: ControlEvaluation[];
}

// ── Report ──────────────────────────────────────────────────────

/**
 * Full run report — the primary output artifact of a ClawVitals scan.
 *
 * NOTE: dock_analysis.stable shape matches FR-16 exactly.
 * score and band are top-level properties of stable (not nested under ScoreResult).
 * ScoreResult is used internally by Scorer; ReportGenerator flattens it into RunReport.
 */
export interface RunReport {
  /** Skill version */
  version: string;
  /** Control library version used for this scan */
  library_version: string;
  /** Scan metadata */
  meta: {
    /** Configured host name */
    host_name: string;
    /** ISO 8601 scan timestamp */
    scan_ts: string;
    /** Assessment mode (always '1' in MVP) */
    mode: '1';
    /** Detected OpenClaw version */
    openclaw_version: string | null;
    /** Unique run identifier */
    run_id: string;
    /** Whether this scan was triggered by cron */
    is_scheduled: boolean;
    /** True if all 3 primary sources succeeded */
    success: boolean;
  };
  /** Raw collector outputs */
  sources: CollectorResult;
  /** Native OpenClaw findings (from security audit) */
  native_findings: SecurityAuditFinding[];
  /** ClawVitals analysis results */
  dock_analysis: {
    /** Stable control results (score-contributing) */
    stable: {
      /** Numeric score or insufficient_data */
      score: number | 'insufficient_data';
      /** Posture band */
      band: ScoreBand;
      /** Per-domain breakdown */
      domains: DomainScore[];
      /** All stable control evaluations */
      findings: ControlEvaluation[];
    };
    /** Experimental control results (not scored) */
    experimental: {
      findings: ControlEvaluation[];
    };
    /** Controls excluded by user */
    excluded: ControlEvaluation[];
    /** Controls skipped due to prerequisites */
    skipped: ControlEvaluation[];
    /** Changes from previous scan */
    delta: DeltaResult;
  };
}

// ── Config ──────────────────────────────────────────────────────

/** ClawVitals configuration stored in config.json */
export interface ClawVitalsConfig {
  /** Display name for this host */
  host_name: string;
  /** Number of days to retain run history */
  retention_days: number;
  /** Minimum severity to trigger scheduled scan alerts */
  alert_threshold: Severity;
  /** Path to exclusions.json */
  exclusions_path: string;
  /** How to determine the current version */
  version_source: string;
  /** Whether anonymous telemetry is enabled */
  telemetry_enabled: boolean;
  /** HTTPS endpoint for telemetry pings */
  telemetry_endpoint: string;
}

/** Persistent usage state tracking */
export interface UsageState {
  /** Unique installation identifier (UUID v4) */
  install_id: string;
  /** ISO 8601 timestamp of initial install */
  installed_at: string;
  /** ClawVitals skill version */
  dock_version: string;
  /** Total number of scans run */
  total_runs: number;
  /** Number of manually triggered scans */
  manual_runs: number;
  /** Number of cron-triggered scans */
  scheduled_runs: number;
  /** Number of detail report requests */
  detail_requests: number;
  /** ISO 8601 timestamp of last scan (null if never run) */
  last_run_at: string | null;
  /** Score band from last scan */
  last_score_band: ScoreBand | null;
  /** Number of stable control failures in last scan */
  last_stable_fail_count: number | null;
  /** Whether recurring scans are configured */
  schedule_enabled: boolean;
  /** Telemetry opt-in prompt state */
  telemetry_prompt_state: 'not_shown' | 'accepted' | 'declined';
  /** Whether user has acknowledged elevated tools (NC-OC-005) */
  elevated_tools_acknowledged: boolean;
}

// ── Exclusion ───────────────────────────────────────────────────

/** A user-defined exclusion for a specific control */
export interface Exclusion {
  /** Control ID to exclude */
  controlId: string;
  /** Optional target resource (reserved for future per-resource exclusions) */
  target?: string;
  /** Reason for the exclusion */
  reason: string;
  /** ISO 8601 creation timestamp */
  created_at: string;
  /** ISO 8601 expiry date (optional — no expiry means permanent) */
  expires?: string;
  /** Who created the exclusion */
  created_by?: string;
}

// ── Run metadata for history listing ────────────────────────────

/** Summary metadata for a single run, used in history listings */
export interface RunMeta {
  /** ISO timestamp directory name */
  run_dir: string;
  /** Scan timestamp */
  scan_ts: string;
  /** Score (if available) */
  score: number | 'insufficient_data' | null;
  /** Band (if available) */
  band: ScoreBand | null;
  /** Whether all primary sources succeeded */
  success: boolean;
  /** Whether this was a scheduled scan */
  is_scheduled: boolean;
}

/** Content of the last-success.json pointer file */
export interface LastSuccessPointer {
  /** Directory name of the last successful run */
  run_dir: string;
}

/** Lock file content for concurrent scan prevention */
export interface LockFile {
  /** Process ID of the scan holding the lock */
  pid: number;
  /** ISO 8601 timestamp when the lock was acquired */
  started_at: string;
}
