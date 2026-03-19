# ClawVitals — Skill Implementation Specification
**Version:** 1.1.0  
**Date:** 2026-03-19  
**Status:** Post-review, implementation-ready  
**Supersedes:** business-ideas/clawvitals/REQUIREMENTS.md v0.8.1 (requirements remain the canonical source; this spec is the implementation-ready derivation for coding agents)  
**Author:** Karnak  

---

## Purpose

This document is the complete implementation specification for the ClawVitals OpenClaw skill (v0.1). It is designed to be handed to a coding agent and produce a working implementation without additional context. It synthesizes REQUIREMENTS.md v0.8.1, CONTROLS-ANALYSIS.md, and fixture validation findings.

When this spec conflicts with REQUIREMENTS.md on functional matters, REQUIREMENTS.md wins. When this spec provides implementation detail not in REQUIREMENTS.md (file structure, API signatures, class names, etc.), this spec is authoritative.

---

## 1. Overview

ClawVitals is an OpenClaw skill that:
1. Invokes OpenClaw CLI primitives to collect security signals
2. Evaluates signals against a versioned control library
3. Scores the installation and generates an actionable report with delta tracking
4. Optionally schedules recurring scans and sends alerts
5. Maintains local usage state and optionally sends anonymous telemetry

**Product name on OpenClaw:** `clawvitals`  
**Install command:** `openclaw skills install clawvitals`  
**Skill name in manifests/logs:** `clawvitals`  

---

## 2. Repository Structure

```
clawvitals/              ← this workspace (dev root)
├── SPEC-SKILL.md        ← this file
├── SPEC-PLATFORM.md     ← portal/fleet spec (separate)
├── PLAN.md              ← feature tracking
│
└── skill/               ← the OpenClaw skill package
    ├── package.json
    ├── skill.json        ← OpenClaw skill manifest
    ├── README.md
    ├── CHANGELOG.md
    │
    ├── src/
    │   ├── index.ts                 ← skill entry point (intent router ONLY — dispatches to ScanOrchestrator)
    │   ├── types.ts                 ← all shared TypeScript types
    │   ├── constants.ts             ← magic values, defaults, version
    │   │
    │   ├── cli-runner.ts            ← CliRunner: single exec wrapper (timeout, error, security boundary)
    │   │
    │   ├── orchestrator.ts          ← ScanOrchestrator: all 17 scan steps extracted from index.ts
    │   │
    │   ├── collectors/
    │   │   ├── index.ts             ← CollectorOrchestrator
    │   │   ├── security-audit.ts    ← openclaw security audit --json
    │   │   ├── health.ts            ← openclaw health --json
    │   │   ├── update-status.ts     ← openclaw update status --json
    │   │   └── version.ts           ← openclaw --version
    │   │
    │   ├── controls/
    │   │   ├── index.ts             ← ControlEvaluator
    │   │   ├── library.ts           ← load + validate control library JSON
    │   │   ├── evaluator.ts         ← per-control PASS/FAIL/SKIP/ERROR logic
    │   │   ├── attack-surface.ts    ← attack_surface detail string parser
    │   │   └── library.v0.1.json    ← bundled control library
    │   │
    │   ├── scoring/
    │   │   ├── index.ts             ← Scorer
    │   │   └── delta.ts             ← DeltaDetector
    │   │
    │   ├── reporting/
    │   │   ├── index.ts             ← ReportGenerator
    │   │   ├── summary.ts           ← 30-second summary message formatter
    │   │   ├── detail.ts            ← full detail report formatter
    │   │   └── storage.ts           ← run file read/write/retention
    │   │
    │   ├── scheduling/
    │   │   └── index.ts             ← SchedulerManager (cron wrapper)
    │   │
    │   ├── telemetry/
    │   │   └── index.ts             ← TelemetryClient (GET ping, fire-and-forget)
    │   │
    │   └── config/
    │       └── index.ts             ← ConfigManager (read/write config.json + usage.json)
    │
    └── tests/
        ├── unit/
        │   ├── attack-surface.test.ts
        │   ├── evaluator.test.ts
        │   ├── scoring.test.ts
        │   ├── delta.test.ts
        │   └── cli-runner.test.ts   ← timeout, error, PID-check behaviour
        └── fixtures/                ← symlink or copy from business-ideas/clawvitals/fixtures/
            ├── normal/
            ├── misconfigured/
            ├── hardened/
            ├── trusted-proxy/
            ├── deny-commands-only/
            ├── update-available/
            ├── version-behind/
            └── healthy-channels/
```

---

## 3. Skill Manifests

ClawVitals requires **two** manifest files:

1. **`SKILL.md`** (AgentSkills format) — used by OpenClaw to load the skill and by ClawHub for the public listing. Contains YAML frontmatter (name, description, tags, homepage) and the body is the listing page content. **This is the primary manifest.**

2. **`skill.json`** (below) — OpenClaw-specific configuration for intent routing, permissions, and cron registration. The exact schema may vary by OpenClaw version — treat this as the intended design; validate against the installed OpenClaw version's skill loader.

`SKILL.md` is at `clawvitals/skill/SKILL.md`. The body text (after frontmatter) is what users see on clawhub.ai and in `openclaw skills info clawvitals`. Keep it accurate and update it with each release.

## 3a. skill.json Manifest

```json
{
  "name": "clawvitals",
  "version": "0.1.0",
  "displayName": "ClawVitals",
  "description": "Security health check and recurring assessment for OpenClaw installations. Finds real issues, tracks posture over time, alerts on regressions.",
  "author": "Anguarda",
  "license": "Apache-2.0",
  "homepage": "https://clawvitals.io",
  "repository": "https://github.com/ANGUARDA/Portfolio",
  "minOpenClawVersion": "2026.3.0",
  "controlLibraryVersion": "0.1.0",
  "controlLibraryVersionRange": ">=0.1.0 <0.2.0",
  "permissions": [
    "exec:openclaw:security-audit",
    "exec:openclaw:health",
    "exec:openclaw:update",
    "exec:openclaw:version",
    "exec:openclaw:cron",
    "filesystem:workspace",
    "network:outbound:telemetry.clawvitals.io",
    "network:outbound:api.clawvitals.io"
  ],
  "intents": [
    {
      "pattern": ["run clawvitals", "clawvitals scan", "check clawvitals", "clawvitals check"],
      "handler": "handleScan"
    },
    {
      "pattern": ["show clawvitals details", "clawvitals full report", "clawvitals details"],
      "handler": "handleDetail"
    },
    {
      "pattern": ["clawvitals history"],
      "handler": "handleHistory"
    },
    {
      "pattern": ["clawvitals schedule", "clawvitals setup schedule"],
      "handler": "handleSchedule"
    },
    {
      "pattern": ["clawvitals telemetry on", "clawvitals telemetry off"],
      "handler": "handleTelemetry"
    },
    {
      "pattern": ["clawvitals exclude *", "clawvitals exclusions"],
      "handler": "handleExclusions"
    },
    {
      "pattern": ["clawvitals link *"],
      "handler": "handleLink"
    },
    {
      "pattern": ["clawvitals config *"],
      "handler": "handleConfig"
    },
    {
      "pattern": ["clawvitals status"],
      "handler": "handleStatus"
    }
  ],
  "cron": {
    "jobName": "clawvitals:scheduled-scan",
    "handler": "handleScheduledScan"
  }
}
```

---

## 4. TypeScript Types

```typescript
// src/types.ts

export type ControlStatus = 'stable' | 'experimental' | 'deprecated' | 'deferred';
export type EvalResult = 'PASS' | 'FAIL' | 'SKIP' | 'ERROR' | 'EXCLUDED';
export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';
export type ScoreBand = 'green' | 'amber' | 'red' | 'insufficient_data';
export type SourceType = 'authoritative' | 'contextual' | 'derived';

// ── Control Library ──────────────────────────────────────────────

export interface Control {
  id: string;                    // e.g. "NC-OC-003"
  name: string;
  domain: string;                // "OC" | "AUTH" | "VERS" | ...
  severity: Severity;
  mode: number;                  // 1 | 2 | 3
  status: ControlStatus;
  introduced_in: string;         // SemVer of library version
  description: string;
  why_it_matters: string;
  check: {
    source: string;
    source_type: SourceType;
    prerequisite?: string;
    prerequisite_skip_reason?: string;
    condition: string;           // human-readable docs only
  };
  evidence_template: string;
  remediation: string;
  references: string[];
  false_positive_notes: string;
}

export interface ControlLibrary {
  version: string;               // SemVer
  generated: string;             // ISO 8601
  controls: Control[];
}

// ── Raw CLI Outputs ──────────────────────────────────────────────

export interface SecurityAuditFinding {
  checkId: string;
  severity: 'info' | 'warn' | 'critical';
  title: string;
  detail: string;
  remediation?: string;
}

export interface SecurityAuditOutput {
  ts: number;
  summary: { critical: number; warn: number; info: number };
  findings: SecurityAuditFinding[];
}

export interface HealthChannel {
  configured: boolean;
  running: boolean;
  probe: { ok: boolean; error?: string };
}

export interface HealthOutput {
  ok: boolean;
  ts: number;
  durationMs: number;
  channels: Record<string, HealthChannel>;
  agents: Array<{
    agentId: string;
    isDefault: boolean;
    heartbeat: unknown;
    sessions: unknown;
  }>;
  heartbeatSeconds: number;
}

export interface UpdateStatusOutput {
  update: {
    root: string;
    installKind: string;
    packageManager: string;
    registry: { latestVersion: string };
    deps: { status: string; reason?: string };
  };
  availability: {
    available: boolean;
    hasRegistryUpdate: boolean;
  };
  channel: { value: string };
}

// ── Parsed attack_surface detail ────────────────────────────────

export interface AttackSurface {
  groups_open: number | null;
  tools_elevated: boolean | null;
  hooks_webhooks: boolean | null;
  hooks_internal: boolean | null;
  browser_control: boolean | null;
  raw: string;
  parse_ok: boolean;
  parse_errors: string[];
}

// ── Collector outputs ────────────────────────────────────────────

export interface CollectorResult {
  security_audit: { ok: boolean; data: SecurityAuditOutput | null; ts: number | null; error: string | null };
  health: { ok: boolean; data: HealthOutput | null; ts: number | null; error: string | null };
  update_status: { ok: boolean; data: UpdateStatusOutput | null; ts: number | null; error: string | null };
  version_cmd: { ok: boolean; version: string | null; error: string | null };
  attack_surface: AttackSurface | null;
}

// ── Evaluation ───────────────────────────────────────────────────

export interface ControlEvaluation {
  control_id: string;
  control_name: string;
  domain: string;
  severity: Severity;
  status: ControlStatus;
  result: EvalResult;
  source: string;
  source_type: SourceType;
  evidence: string;              // rendered evidence_template
  remediation: string | null;   // null on PASS/SKIP/ERROR
  exclusion_reason: string | null;
  exclusion_expires: string | null;
  error_detail: string | null;   // on ERROR
  skip_reason: string | null;    // on SKIP
}

// ── Scoring ──────────────────────────────────────────────────────

export interface DomainScore {
  domain: string;
  score: number | 'insufficient_data';
  controls_evaluated: number;
}

export interface ScoreResult {
  score: number | 'insufficient_data';
  band: ScoreBand;
  domains: DomainScore[];
  stable_pass: number;
  stable_fail: number;
  stable_skip: number;
  stable_error: number;
  stable_excluded: number;
}

// ── Delta ────────────────────────────────────────────────────────

export interface DeltaResult {
  new_findings: ControlEvaluation[];     // was not FAIL, now FAIL
  resolved_findings: ControlEvaluation[];// was FAIL, now PASS
  new_checks: ControlEvaluation[];       // introduced_in > prev library version
}

// ── Report ───────────────────────────────────────────────────────
// NOTE: RunReport.dock_analysis.stable shape matches FR-16 exactly.
// score and band are top-level properties of stable (not nested under a ScoreResult object).
// ScoreResult is used internally by Scorer; ReportGenerator flattens it into RunReport.

export interface RunReport {
  version: string;
  library_version: string;
  meta: {
    host_name: string;
    scan_ts: string;
    mode: '1';
    openclaw_version: string | null;
    run_id: string;              // uuid
    is_scheduled: boolean;
    success: boolean;            // true if all 3 primary sources (security_audit, health, update_status) succeeded
  };
  sources: CollectorResult;
  native_findings: SecurityAuditFinding[];
  dock_analysis: {
    stable: {
      score: number | 'insufficient_data';   // matches FR-16: top-level, not nested
      band: ScoreBand;                        // matches FR-16: top-level, not nested
      domains: DomainScore[];
      findings: ControlEvaluation[];          // FR-16 uses "findings" not "evaluations"
    };
    experimental: {
      findings: ControlEvaluation[];
    };
    excluded: ControlEvaluation[];
    skipped: ControlEvaluation[];
    delta: DeltaResult;
  };
}

// ── Config ───────────────────────────────────────────────────────

export interface ClawVitalsConfig {
  host_name: string;
  retention_days: number;
  alert_threshold: Severity;
  exclusions_path: string;
  version_source: 'auto' | 'manual' | string;
  telemetry_enabled: boolean;
  telemetry_endpoint: string;
  // CANONICAL: stores the cvt_-prefixed org_token (NOT internal org UUID).
  // Set via `clawvitals link {token}`. Used as the `org` param in telemetry pings.
  // The platform resolves org_id server-side from this token.
  org_token: string | null;
  pending_org_token: string | null;  // set when link API call fails; retried on next scan
}

export interface AgentSession {
  token: string;            // cvs_-prefixed agent session token
  scopes: string[];         // e.g. ['clawvitals:read', 'clawvitals:write']
  expires_at: string;       // ISO 8601
  created_at: string;
}

export interface UsageState {
  install_id: string;
  installed_at: string;
  dock_version: string;
  total_runs: number;
  manual_runs: number;
  scheduled_runs: number;
  detail_requests: number;
  last_run_at: string | null;
  last_score_band: ScoreBand | null;
  last_stable_fail_count: number | null;
  schedule_enabled: boolean;
  telemetry_prompt_state: 'not_shown' | 'accepted' | 'declined';
  // NC-OC-005 acknowledgement: track whether user has acknowledged elevated tools
  elevated_tools_acknowledged: boolean;
}

// ── Exclusion ────────────────────────────────────────────────────

export interface Exclusion {
  controlId: string;
  target?: string;
  reason: string;
  created_at: string;
  expires?: string;
  created_by?: string;
}
```

---

## 5. Module Specifications

### 5.0 CliRunner (`cli-runner.ts`)

**Responsibility:** Single, auditable wrapper around all OpenClaw CLI exec calls. This is the only place in the codebase that invokes exec. Every collector MUST use CliRunner — never call exec directly.

```typescript
class CliRunner {
  async run(
    command: string,
    args: string[],
    options: { timeoutMs?: number; parseJson?: boolean }
  ): Promise<{ stdout: string; stderr: string; exitCode: number }>
}
```

**Security invariants enforced here (and only here):**
- Command must start with `openclaw` or `node` — any other binary throws immediately (not an exec error, a code error at construction time)
- Args are passed as a separate array — never interpolated into a string (prevents injection)
- Default timeout: 30 seconds
- On timeout: process killed, throws `CliTimeoutError`
- On non-zero exit: throws `CliExecError` with stderr content
- All invocations logged to debug output with command + args (not secrets)

**Unit tests required:** timeout behaviour, non-zero exit, disallowed binary rejection.

### 5.0a ScanOrchestrator (`orchestrator.ts`)

**Responsibility:** Encapsulates the full scan pipeline (the 17 steps previously in `handleScan`). The intent router calls `ScanOrchestrator.run()`. This class is independently testable.

```typescript
class ScanOrchestrator {
  constructor(
    private collector: CollectorOrchestrator,
    private evaluator: ControlEvaluator,
    private scorer: Scorer,
    private delta: DeltaDetector,
    private reporter: ReportGenerator,
    private storage: StorageManager,
    private config: ConfigManager,
    private telemetry: TelemetryClient,
    private scheduler: SchedulerManager
  ) {}

  async run(options: { isScheduled: boolean }): Promise<RunReport>
}
```

`handleScan` in `index.ts` becomes: `return orchestrator.run({ isScheduled: false })`.  
`handleScheduledScan` becomes: `return orchestrator.run({ isScheduled: true })`.

### 5.1 CollectorOrchestrator (`collectors/index.ts`)

**Responsibility:** Invoke all 4 CLI data sources in parallel, validate output schemas, parse attack_surface detail, return structured CollectorResult.

```typescript
class CollectorOrchestrator {
  async collect(): Promise<CollectorResult>
}
```

**Behaviour:**
- All 4 sources run in parallel (Promise.allSettled — never let one failure abort others)
- Each collector times out after 30 seconds (contributes to the 60-second total NFR)
- On schema mismatch, the source entry is `{ ok: false, error: "Schema mismatch: ..." }`
- After `security_audit` completes, parse `attack_surface` detail immediately (see §5.1a)
- Log each source invocation to stderr for debugging

**Schema validation:** Each collector validates its output against pinned TypeScript types (use `zod` or `ajv` for runtime validation against the schemas documented in REQUIREMENTS.md §4.0).

### 5.1a AttackSurfaceParser (`controls/attack-surface.ts`)

**Input:** The `detail` string from the `summary.attack_surface` finding.

**Expected format:**
```
groups: open=0, closed=1
tools.elevated: enabled
hooks.webhooks: disabled
hooks.internal: enabled
browser control: disabled
```

**Parsing rules:**
- Split on newline
- For each line: split on `: `, trim both sides
- Extract named fields (case-insensitive key match):
  - `groups` → parse `open=N` with regex `open=(\d+)` → `groups_open: number`
  - `tools.elevated` → `enabled` → `tools_elevated: true`, else `false`
  - `hooks.webhooks` → `hooks_webhooks: boolean`
  - `hooks.internal` → `hooks_internal: boolean`
  - `browser control` → `browser_control: boolean`
- Unknown fields: log to `parse_errors` but do not fail
- If ANY known field cannot be parsed: add to `parse_errors`
- `parse_ok: true` if no parse_errors for known fields; `false` if any required field failed

**On total parse failure** (no line-delimited structure found): return `AttackSurface` with `parse_ok: false` and all fields null.

**Dependent controls** (NC-OC-004, NC-OC-005, NC-OC-006) MUST check `attack_surface.parse_ok` before using derived values. If `parse_ok == false`, mark control `ERROR` with reason "attack_surface detail parse failed."

### 5.2 ControlEvaluator (`controls/evaluator.ts`)

**Responsibility:** Given a CollectorResult and loaded ControlLibrary, evaluate every control and return ControlEvaluation[].

```typescript
class ControlEvaluator {
  constructor(private library: ControlLibrary, private exclusions: Exclusion[]) {}
  evaluate(collected: CollectorResult): ControlEvaluation[]
}
```

**Evaluation order:**
1. Check if control is applicable (mode == 1 for MVP)
2. Check if excluded → return EXCLUDED
3. Check prerequisite → if not met, return SKIP
4. Check if required source is available → if not, return ERROR
5. Run check logic → return PASS or FAIL

**Per-control check implementations:**

#### NC-OC-003 — No ineffective deny command entries
- Source: `security_audit`
- Check: `findings` contains `{ checkId: 'gateway.nodes.deny_commands_ineffective' }`
- FAIL if found, PASS if absent
- Evidence: "Ineffective deny command entries detected" / "No ineffective deny command entries"

#### NC-OC-004 — No open (unauthenticated) groups
- Source: `security_audit`
- Check: `findings` contains `{ checkId: 'security.exposure.open_groups_with_elevated' }` OR `{ checkId: 'security.exposure.open_groups_with_runtime_or_fs' }`
- FAIL if either found, PASS if neither found
- Evidence: list matching checkIds; or "No open unauthenticated groups detected"

#### NC-OC-008 — All configured channels healthy
- Source: `health`
- Check: any `channels[*].probe.ok == false`
- FAIL if any unhealthy, PASS if all healthy
- Evidence: list of failing channels with their error strings

#### NC-OC-009 — OpenClaw update available (INFO, not scored)
- Source: `update_status`
- Check: `availability.hasRegistryUpdate == true`
- FAIL (info-level) if true, PASS if false
- Evidence: latest version string if update available

#### NC-AUTH-001 — Reverse proxy trust correctly configured
- Source: `security_audit`
- Check: `findings` contains `{ checkId: 'gateway.trusted_proxies_missing' }`
- FAIL if found, PASS if absent

#### NC-VERS-001 — OpenClaw is behind latest release
- Source: `update_status`
- Check: `availability.hasRegistryUpdate == true`
- FAIL if true (Medium, scored), PASS if false
- Note: overlaps with NC-OC-009 (Info, not scored) — both exist; NC-VERS-001 contributes to score

#### NC-VERS-002 — OpenClaw not more than 2 minor versions behind
- Source: `update_status` + `version_cmd`
- Prerequisite: `version_cmd.ok == true && version_cmd.version != null`
- Skip reason: "Current version not determinable"
- Check: parse both version strings as `YYYY.M.D`; compute version distance; FAIL if current is more than 2 "minor" versions behind latest
- Version distance formula (handles year boundaries):
  ```
  totalMonthsBehind = (latestYear - currentYear) * 12 + (latestMonth - currentMonth)
  FAIL if totalMonthsBehind > 2
  ```
- Example: current `2025.12.1`, latest `2026.2.0` → (2026-2025)*12 + (2-12) = 12-10 = 2 → PASS (not more than 2)
- Example: current `2025.11.1`, latest `2026.2.0` → 12-11 = 1 net... = 3 → FAIL

#### Experimental controls (NC-OC-002, NC-OC-005, NC-OC-006, NC-OC-007, NC-AUTH-002, NC-AUTH-003, NC-VERS-004, NC-VERS-005):
- Evaluate using same logic as stable controls
- Results go into `experimental.evaluations[]` — never touch `stable`
- NC-OC-005 (elevated tools, Info): show acknowledgement prompt on first FAIL occurrence (check `usage.json` for prior acknowledgement)

### 5.3 Scorer (`scoring/index.ts`)

**Responsibility:** Compute primary score and per-domain scores from stable ControlEvaluations.

```typescript
class Scorer {
  score(evaluations: ControlEvaluation[]): ScoreResult
}
```

**Algorithm (stable controls only):**
```
base = 100
for each stable eval where result == 'FAIL':
  base -= SEVERITY_DEDUCTION[eval.severity]
  // critical: -25, high: -10, medium: -5, low: -2, info: 0
score = max(0, base)

evaluable = evals where result in ['PASS', 'FAIL']
if evaluable.length < 5: band = 'insufficient_data', score = null
else if score >= 90: band = 'green'
else if score >= 70: band = 'amber'
else: band = 'red'
```

**Per-domain:**
- Same algorithm applied to each domain subset
- If domain has < 2 evaluable controls: domain score = 'insufficient_data'

### 5.4 DeltaDetector (`scoring/delta.ts`)

```typescript
class DeltaDetector {
  detect(current: RunReport, previous: RunReport | null): DeltaResult
}
```

**Rules:**
- If `previous == null`: all current FAILs are `new_findings` (first run)
- New finding: current FAIL, previous was PASS/SKIP/not-evaluated, AND `control.introduced_in <= previous.library_version`
- New check: `control.introduced_in > previous.library_version`
- Resolved: previous FAIL, current PASS
- Stable controls only for alert triggering; all controls in delta report

### 5.5 ReportGenerator (`reporting/index.ts`)

Formats the RunReport into two outputs:

**Summary message** (≤ 400 chars, delivered to messaging surface immediately):
```
🏥 ClawVitals — {host_name}
Score: {score}/100 {band_emoji} {band}
Critical/High findings: {n}
{↑ Improved / ↓ Regressed / → No change} from last scan
Full report: clawvitals details
```

**Full detail** (delivered on request or on first run):
```
📋 ClawVitals Full Report — {host_name}
Scan: {timestamp} | Mode 1 | Library v{lib_version}
OpenClaw: {oc_version}

🔴 CRITICAL / HIGH FINDINGS:
  [NC-OC-004] No open (unauthenticated) groups — FAIL
  Source: openclaw security audit --json (authoritative)
  Found: Unauthenticated groups with elevated tools exposure
  Fix: {remediation}
  Docs: https://clawvitals.io/docs/NC-OC-004

🟡 MEDIUM FINDINGS:
  ...

✅ PASSED: {n} controls (run `clawvitals full report` for list)

⚡ EXPERIMENTAL OBSERVATIONS (not scored):
  ...

📊 DELTA:
  New since last scan: NC-X-XXX, ...
  Resolved: NC-Y-YYY, ...

ℹ️ SKIPPED: NC-OC-001 (not applicable: see control notes)
```

**Band emoji:** 🟢 Green · 🟡 Amber · 🔴 Red

### 5.6 StorageManager (`reporting/storage.ts`)

```typescript
class StorageManager {
  getRunsDir(): string              // {workspace}/clawvitals/runs/
  writeRun(report: RunReport): void // writes JSON + text to runs/{ISO-ts}/
  loadLastRun(): RunReport | null   // loads from last-success.json pointer
  listRuns(limit: number): RunMeta[] // for history command (all runs, success + failed)
  purgeOldRuns(retentionDays: number): void
}
```

- Run directory: `{workspace}/clawvitals/runs/{ISO-timestamp}/`
  - `report.json` — full RunReport (includes `meta.success` field)
  - `report.txt` — human-readable detail
- **Last-success pointer:** `{workspace}/clawvitals/last-success.json` — a file containing `{ "run_dir": "{ISO-timestamp}" }`. This file is only written/updated when `report.meta.success == true` (all 3 primary sources succeeded). Failed runs are written to their own directory but do NOT update this pointer.
- `loadLastRun()` reads `last-success.json` to find the directory, then loads `report.json` from it. Returns `null` if: the pointer file doesn't exist, the file is corrupted/unparseable, the `run_dir` field is missing, or the pointed-to run file is missing. Never throw from `loadLastRun()` — callers must be able to treat `null` as "no prior run".
- **Success definition:** `meta.success = true` when `sources.security_audit.ok && sources.health.ok && sources.update_status.ok`. The version_cmd source is allowed to fail without marking the run failed.

### 5.7 SchedulerManager (`scheduling/index.ts`)

```typescript
class SchedulerManager {
  async ensureSchedule(cadence: 'daily' | 'weekly' | 'monthly' | 'none'): Promise<void>
  async removeSchedule(): Promise<void>
  async isScheduled(): Promise<boolean>
}
```

- Uses `openclaw cron list` → parse for job name `clawvitals:scheduled-scan`
- If exists: `openclaw cron edit --name clawvitals:scheduled-scan --cron "{expr}"`
- If not exists: `openclaw cron add --name clawvitals:scheduled-scan --cron "{expr}" --handler clawvitals:handleScheduledScan`
- Cron expressions: daily=`0 8 * * *`, weekly=`0 8 * * 1`, monthly=`0 8 1 * *`

### 5.8 TelemetryClient (`telemetry/index.ts`)

```typescript
class TelemetryClient {
  async ping(report: RunReport, usage: UsageState, config: ClawVitalsConfig): Promise<void>
}
```

- Only fires when `config.telemetry_enabled == true`
- Constructs GET request to `config.telemetry_endpoint` with all parameters from REQUIREMENTS.md §12.2
- Wrapped in try/catch — any error is swallowed silently
- No retry on failure

### 5.9 ConfigManager (`config/index.ts`)

```typescript
class ConfigManager {
  getConfig(): ClawVitalsConfig
  setConfig(partial: Partial<ClawVitalsConfig>): void
  getUsage(): UsageState
  updateUsage(partial: Partial<UsageState>): void
  getExclusions(): Exclusion[]
  addExclusion(ex: Exclusion): void
  isExclusionActive(ex: Exclusion): boolean
  // Agent session management
  getAgentSession(): AgentSession | null   // returns null if file missing or expired
  saveAgentSession(session: AgentSession): void
  clearAgentSession(): void
}
```

- Config path: `{workspace}/clawvitals/config.json`
- Usage path: `{workspace}/clawvitals/usage.json`
- Exclusions path: from `config.exclusions_path` (default `{workspace}/clawvitals/exclusions.json`)
- Agent session path: `{workspace}/clawvitals/agent-session.json`
- On first run: generate `install_id` (uuid v4), write both files with defaults
- All file writes use `chmod 600`
- `getAgentSession()`: reads `agent-session.json`; if missing, corrupted, or `expires_at` is past, returns `null` (do not throw)
- `saveAgentSession()`: writes with chmod 600; overwrites any existing session
- **Exclusion `target` field:** Currently not used in evaluation logic. A coding agent should store it in the JSON but ignore it during control evaluation. It is reserved for a future version where per-resource exclusions will be supported. Do not implement matching logic in v0.1.

---

## 6. Intent Handlers (`src/index.ts`)

### 6.1 handleScan (manual scan)
1. `ConfigManager.getConfig()` → load config
2. Check for concurrent run:
   - Lock file path: `{workspace}/clawvitals/.lock`
   - Lock file content: `{ "pid": <process.pid>, "started_at": "<ISO-ts>" }`
   - If lock exists: read PID and check if process is still running (`process.kill(pid, 0)` — throws if not running)
     - If process is alive AND lock is < 120 seconds old: reply "A scan is already in progress" and exit
     - If process is dead OR lock is ≥ 120 seconds old: remove stale lock and proceed
     - **Platform note:** `process.kill(pid, 0)` is POSIX-only. On non-POSIX platforms (Windows), fall back to lock age check only (≥ 120s = stale). OpenClaw targets macOS/Linux so POSIX check is the default; add `process.platform !== 'win32'` guard.
3. Write lock file (with current PID)
4. `CollectorOrchestrator.collect()` → `CollectorResult`
5. Load `ControlLibrary`
6. `ControlEvaluator.evaluate()` → `ControlEvaluation[]`
7. `Scorer.score()` → `ScoreResult`
8. Load previous run via `StorageManager.loadLastRun()`
9. `DeltaDetector.detect()` → `DeltaResult`
10. Assemble `RunReport`
11. `StorageManager.writeRun(report)`
12. `ConfigManager.updateUsage(...)` (increment totals, update last_run_at etc.)
13. `ReportGenerator` → format summary message → deliver to messaging surface
    - **Check for stale exclusions:** before formatting, call `ConfigManager.getExclusions()` and flag any exclusion without an `expires` field that has been active for >90 days. Include a "⚠️ Review exclusions" notice in the report if any are flagged (FR-8).
14. Remove lock file (always — in a finally block so crash doesn't leave a stale lock)
15. **After delivery:** check `telemetry_prompt_state`; if `not_shown` → prompt user for opt-in (shown inline after first report)
16. `TelemetryClient.ping()` (fire and forget, if enabled)
17. **If first run:** prompt scheduling

### 6.2 handleDetail
1. Load last run from `StorageManager`
2. If none: reply "No scan found — run 'run clawvitals' first"
3. Format full detail report → deliver
4. Increment `usage.detail_requests`

### 6.3 handleHistory
1. `StorageManager.listRuns(10)` → format as table
2. Show: timestamp, score, band, delta summary for each run

### 6.4 handleSchedule
- Interactive: present options 1-4 (daily/weekly/monthly/manual)
- Call `SchedulerManager.ensureSchedule()`
- Confirm to user

### 6.5 handleScheduledScan (invoked by cron)
1. Check lock — skip if running (same stale-lock logic as §6.1)
2. Run full scan (same as handleScan but `is_scheduled: true`)
3. Only deliver message if: new Critical/High findings in stable controls
4. Alert message format (FR-27): delta summary + **top 3 new findings with remediation text** (sorted by severity)
   ```
   🚨 ClawVitals Alert — {host_name}
   New findings since last scan: {n}
   
   1. [NC-OC-004] No open groups — CRITICAL
      Fix: {remediation}
   2. [NC-AUTH-001] Reverse proxy trust — HIGH
      Fix: {remediation}
   3. [NC-VERS-001] Version currency — MEDIUM
      Fix: {remediation}
   
   Full report: run "show clawvitals details"
   ```
5. If messaging fails: log to run file, do not retry more than once

### 6.6 handleTelemetry
- "clawvitals telemetry on" → set `config.telemetry_enabled = true`, reply "Telemetry enabled. Your anonymous scan summaries will help us improve ClawVitals."
- "clawvitals telemetry off" → set `config.telemetry_enabled = false`, reply "Telemetry disabled."

### 6.7 handleLink
- Parse org token from message (the `cvt_`-prefixed token)
- **Call platform API:** `POST https://api.clawvitals.io/agent/link` with `{ org_token, install_id, host_name, agent_fingerprint }`
  - On success: 
    - Write `config.org_token = token` (NOT `org_id` — the skill never stores the internal UUID)
    - Save the returned `agent_session_token` via `ConfigManager.saveAgentSession()`
    - Both writes must succeed atomically — if session save fails, revert config write
  - On network failure: surface error to user — do NOT write to config if platform call fails. Set `config.pending_org_token = token` so the next scan can retry automatically.
  - If platform is unreachable: reply "Platform unreachable — I've saved your token and will link on the next scan automatically."
- Reply on success: "✅ ClawVitals linked to your Anguarda account. Your fleet dashboard: https://clawvitals.io/dashboard"
- **Retry on next scan:** `ScanOrchestrator.run()` checks `config.pending_org_token` at the start. If set, attempts `handleLink` silently before the scan; on success clears the pending token; on failure logs and continues scan (skill still works offline).

### 6.11 Agent Session Management
- `{workspace}/clawvitals/agent-session.json` (chmod 600) stores:
  ```json
  {
    "token": "cvs_...",
    "org_id": "...",
    "scopes": ["clawvitals:read", "clawvitals:write"],
    "expires_at": "ISO-8601",
    "created_at": "ISO-8601"
  }
  ```
- Tokens are refreshed automatically: before each API call, check `expires_at`; if within 1 hour of expiry, request a new token
- If token is expired and refresh fails: surface "Your ClawVitals session has expired. Run 'clawvitals link {token}' to re-authenticate." — do not silently fail
- **Phase 1 (pre-platform):** `agent-session.json` does not exist. All `handleLink` and platform API calls are gracefully no-ops with a clear "platform not yet available" message. Reserve the file path.

### 6.8 handleConfig
- "clawvitals config host_name {value}" → update config
- "clawvitals config retention_days {n}" → update config
- "clawvitals config alert_threshold {severity}" → update config
- Return updated config summary

### 6.9 handleStatus
- Show: host_name, OpenClaw version, last scan date+score, schedule status, telemetry status, skill version, library version

---

## 7. Control Library v0.1 JSON

The file `src/controls/library.v0.1.json` must be bundled with the skill. Full schema in REQUIREMENTS.md §14.

**Stable controls for v0.1 (score-contributing):**
- NC-OC-003: No ineffective deny command entries
- NC-OC-004: No open (unauthenticated) groups
- NC-OC-008: All configured channels healthy
- NC-AUTH-001: Reverse proxy trust correctly configured
- NC-VERS-001: OpenClaw is behind latest release
- NC-VERS-002: OpenClaw not more than 2 minor versions behind

**Stable controls (Info, not scored):**
- NC-OC-009: OpenClaw update available

**Experimental controls (reported separately, not scored):**
- NC-OC-002, NC-OC-005, NC-OC-006, NC-OC-007
- NC-AUTH-002, NC-AUTH-003
- NC-VERS-004, NC-VERS-005

**Deferred (not implemented in v0.1):**
- NC-OC-001: Webhook signing secret — not implementable in Mode 1

---

## 8. Error Handling Reference

| Situation | Behaviour |
|---|---|
| CLI command times out (>30s) | Source marked `{ ok: false, error: "Timeout after 30s" }` |
| CLI command returns non-zero | Source marked `{ ok: false, error: stderr content }` |
| JSON parse failure | Source marked `{ ok: false, error: "JSON parse error: ..." }` |
| Schema mismatch | Source marked `{ ok: false, error: "Schema mismatch at field X" }` |
| attack_surface parse failure | All dependent controls marked ERROR |
| <5 stable controls evaluable | Score = "insufficient_data" |
| Concurrent scan in progress | Immediate "already running" reply |
| Messaging surface down | Log warning to run file; run still completes |
| Telemetry ping fails | Silent swallow |
| Run storage write fails | Surface to user; run still reports in-session |

---

## 9. Testing Requirements

### Unit tests (required before merge)

| Test file | What it must cover |
|---|---|
| `attack-surface.test.ts` | Parse normal, missing fields, garbage input, empty string |
| `evaluator.test.ts` | All 6 stable controls PASS+FAIL against fixtures |
| `scoring.test.ts` | Score calculation, band thresholds, insufficient_data edge case |
| `delta.test.ts` | New finding, resolved, new check, first-run (null previous) |

### Integration tests (using real fixtures)

Run the full pipeline against each of the 8 fixture directories and assert the `expected-results.json` matches the actual output.

---

## 10. Dependency Constraints

- **Runtime:** Node.js 20+ (LTS)
- **Language:** TypeScript 5+
- **Allowed dependencies:**
  - `zod` (schema validation)
  - `uuid` (install_id generation)
  - No HTTP client libraries (use native `fetch` for telemetry ping)
  - No external AI/ML dependencies
- **Zero production dependencies** beyond the above. The skill must be lightweight.
- Bundle size target: <200KB uncompressed

---

## 11. First-Run UX Script

**First-run detection:** `usage.json` does not exist OR `usage.last_run_at == null` (handles partial-write edge case).

When first run is detected:

```
👋 Welcome to ClawVitals — your OpenClaw security health check.

Running your first scan now...

[scan output]

---
📅 Set up recurring scans? Reply with one of:
  • "clawvitals schedule daily"
  • "clawvitals schedule weekly"
  • "clawvitals schedule monthly"
  • "clawvitals schedule off" (manual only)
```

**Important:** Do NOT use numbered choices (1/2/3/4) — those won't match any intent pattern. Use the exact command strings shown above. The skill MUST register these as valid intent patterns in `skill.json`:

```json
{ "pattern": ["clawvitals schedule daily"], "handler": "handleSchedule" },
{ "pattern": ["clawvitals schedule weekly"], "handler": "handleSchedule" },
{ "pattern": ["clawvitals schedule monthly"], "handler": "handleSchedule" },
{ "pattern": ["clawvitals schedule off"], "handler": "handleSchedule" }
```

`handleSchedule` reads the word after "schedule" to determine cadence.

After scheduling prompt, if `telemetry_prompt_state == 'not_shown'`:

```
📊 Want to track your security posture over time?

Enable anonymous scan summaries and see your score history at clawvitals.io/dashboard — free, no account required. No findings, file paths, or secrets are ever shared.

Reply "clawvitals telemetry on" to enable, or ignore to skip.
```

---

## 12. Versioning

- Skill version: `{skill.version}` in package.json (SemVer: 0.1.0 for MVP)
- Control Library version: `{library.version}` in library.v0.1.json (SemVer: 0.1.0 for MVP)
- These are independent; skill may update without library updates and vice versa
- Library MAJOR bump: breaking change to schema or removal of stable control
- Library MINOR bump: new control added
- Library PATCH bump: fix to existing control logic or text

---

## 13. Security Requirements

- All run files written with `chmod 600`
- No credentials, API keys, tokens, or secret values ever written to run files (boolean presence only)
- NC-AUTH-002/003 filesystem scans: record file path and count only, never matched content
- All exec calls use the OpenClaw exec primitive (never `child_process.exec` with user-controlled input)
- Telemetry endpoint must be HTTPS only

---

## 14. Build & Distribution

```bash
# Build
cd clawvitals/skill
npm install
npm run build        # tsc → dist/

# Test
npm test             # jest unit + integration

# Publish to ClawHub
openclaw skills publish --dir .
```

- `package.json` must include `"main": "dist/index.js"` and `"types": "dist/index.d.ts"`
- `skill.json` at root of skill directory (not inside src/)
- `README.md` must include: install command, usage examples, what controls are checked, how to get help

---

## 14. Implementation Notes for Coding Agents

**FR-30, FR-34, FR-35 implementation status:** REQUIREMENTS.md marks these as "non-critical for MVP — deprioritize if scope pressure." This spec deliberately implements them (`handleConfig`, `handleExclusions`) because they significantly improve the product and are not complex. A coding agent should implement them. If scope is a problem, drop FR-35 (list exclusions) first, then FR-34 (add exclusion), then FR-30 (config via conversation).

**Experimental controls implementation:** Implement all 8 experimental controls as stubs that return `SKIP` with reason "experimental control — not yet validated." Full evaluation logic can be filled in later. This ensures the control library JSON is complete and the report structure handles experimental entries correctly from day one.

**Platform API calls in Phase 1:** All platform API calls (`/agent/link`, `/agent/register`, etc.) should be wrapped in a `PlatformClient` class that is a no-op returning `{ ok: false, error: "platform_not_available" }` in Phase 1. When Phase 3 ships the platform, only `PlatformClient` needs updating — no changes to `handleLink` or `ScanOrchestrator`.

---

## Revision History

| Version | Date | Changes |
|---|---|---|
| 1.0.0 | 2026-03-19 | Initial implementation spec derived from REQUIREMENTS.md v0.8.1. |
| 1.1.0 | 2026-03-19 | Post peer-review revisions: added CliRunner module (§5.0), ScanOrchestrator extract (§5.0a), fixed RunReport shape to match FR-16, added `meta.success` + last-success pointer to StorageManager (§5.6), added `elevated_tools_acknowledged` to UsageState, added `controlLibraryVersionRange` to skill.json, fixed lock file to include PID + stale detection (§6.1), added stale exclusion 90-day flag (§6.1 step 13), fixed handleScheduledScan alert format to include top-3 remediation (FR-27), rewrote first-run UX to use command strings not numbers (§11), added handleLink platform API call + agent-session.json spec (§6.7, §6.11), added Phase 1 PlatformClient no-op pattern (§14). |
| 1.2.0 | 2026-03-19 | Gemini 2.5 Pro review revisions: renamed `config.org_id` → `config.org_token` throughout (canonical alignment with SPEC-PLATFORM §1.1a); added `pending_org_token` to ClawVitalsConfig; added `AgentSession` type; added `getAgentSession/saveAgentSession/clearAgentSession` to ConfigManager (§5.9); updated `handleLink` to store `org_token` not `org_id`, receive and save `agent_session_token` from API response, handle partial failure atomically (§6.7); scoped `exec` permissions to specific subcommands (§3); fixed NC-VERS-002 year-boundary formula (§5.2); added POSIX caveat to PID check (§6.1); added corruption handling to `loadLastRun` (§5.6); clarified `Exclusion.target` reserved/unused in v0.1 (§5.9); added `agent-session.json` to file structure. |
