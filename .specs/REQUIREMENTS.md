# ClawVitals — Requirements Document

**Version:** 0.8.1  
**Date:** 2026-03-18  
**Status:** Build-ready — all open items resolved  
**Author:** Karnak  
**Reviewed by:** Gemini 2.5 Flash (v0.2), GPT-5.4 Pro, Claude Opus (v0.3/v0.4), Claude Sonnet (4.6)  

---

## 1. Purpose

This document defines the requirements for ClawVitals — an automated security health check and recurring assessment tool for self-hosted AI agent platforms. It covers functional requirements, non-functional requirements, the control library schema, open question resolutions, and explicit out-of-scope items.

---

## 2. Context

### 2.1 The Problem
Self-hosted AI platforms (OpenClaw, LocalAI, Open WebUI, Ollama) are being deployed by developers and small teams on Mac Minis, VPCs, and home servers with frequent security misconfigurations:

- Webhook endpoints with no signature verification
- Ollama model servers exposed publicly on port 11434
- API keys in plaintext bash history or world-readable .env files
- Cloudflare tunnels routing to unauthenticated endpoints
- Disk encryption disabled, SSH password auth enabled
- Outdated packages with known CVEs

There is no lightweight recurring health check tool focused on surfacing OpenClaw security issues with clear remediation and repeat-scan posture tracking for non-security-specialist developers.

### 2.2 The Solution
ClawVitals is a security health check and recurring assessment tool that:
1. Invokes existing OpenClaw CLI primitives to gather security signals
2. Normalizes structured OpenClaw findings into the Dock Control Library, applies scoring, and produces prioritised, actionable remediation guidance
3. Tracks whether security posture improves or regresses over time via delta detection
4. Schedules recurring scans and alerts on new critical/high findings

Dock's MVP value is:
- Finding real OpenClaw security and configuration issues
- Presenting them clearly with exact remediation steps
- Tracking whether posture improves or regresses over time

### 2.3 MVP Scope (Mode 1)
The MVP is an OpenClaw skill. It runs entirely within an existing OpenClaw installation using available primitives:
- `openclaw security audit --json`
- `openclaw health --json`
- `openclaw update status --json`
- `openclaw --version` (or equivalent, for current version determination)
- `openclaw cron add/list/edit`

No external daemon, no cloud backend, no paid tier, no external API calls in MVP. All output delivered via the OpenClaw messaging surface.

Dock is a security health check product. It is not a governance validation tool, a compliance certification platform, or a Compass implementation. These may follow later; they are explicitly out of scope for v0.1.

### 2.4 Competitive Landscape

The OpenClaw security tooling space is not empty.

ClawVitals is designed for: **lightweight recurring assessment**. The first scan finds real issues and tells you exactly how to fix them. Repeated scans become more valuable over time because of delta detection, posture tracking, and regression-aware alerting. Dock is intended to be useful on first scan and more valuable on every scan after that.

ClawVitals is not trying to win on check count, enterprise readiness, or replace one-shot auditing tools. Its lane is: easier to understand, easier to run repeatedly, more habit-forming, more operationally useful over time.

ClawVitals v0.1 control library (6 stable checks) covers the highest-impact misconfigurations that OpenClaw's own security audit surfaces directly. The controls are the minimum viable evidence needed to produce a meaningful, comparable score across scans. Users who want comprehensive one-shot auditing with automated hardening should use SecureClaw. Users who want to check whether their setup is secure, know exactly what to fix, and catch regressions over time — should use Dock. The two tools can coexist on the same installation.

---

## 3. Phase 0 — Interface Validation (COMPLETE)

Phase 0 was a pre-build gate requiring capture and documentation of all CLI interface schemas before implementation. This phase is now complete.

**Completed on:** 2026-03-18
**Confirmed on:** OpenClaw 2026.3.13 (stable channel, pnpm install)

All three primary data sources confirmed as producing stable, structured JSON output. See Section 4.0 for documented schemas and Section 6 for the control mappings derived from actual output.

**Fixture requirement: COMPLETE (2026-03-18).** Eight fixtures captured and committed to `clawvitals/fixtures/`. See `clawvitals/fixtures/README.md` for full inventory and `expected-results.json` per fixture.

Fixtures captured:
- `normal/` — default install, 3 warn findings, ~75 Amber
- `misconfigured/` — open groups, no gateway auth, 4 critical, ~60 Red
- `hardened/` — auth set, allowlist groups, 0 critical, ~85 Amber
- `trusted-proxy/` — NC-AUTH-001 PASS state confirmed
- `deny-commands-only/` — NC-OC-003 isolated FAIL state confirmed
- `update-available/` — NC-VERS-001 FAIL state (synthetic)
- `version-behind/` — NC-VERS-002 FAIL state (synthetic)
- `healthy-channels/` — NC-OC-008 PASS state (synthetic)

Every stable control now has both a confirmed PASS fixture and a confirmed FAIL fixture.

---

## 4. Data Sources

### 4.0 Confirmed Interface Schemas

#### Source 1: `openclaw security audit --json`
**Role:** Primary scoring source. Authoritative Mode 1 security finding source.

```json
{
  "ts": 1773838017635,
  "summary": {
    "critical": 0,
    "warn": 3,
    "info": 1
  },
  "findings": [
    {
      "checkId": "string",
      "severity": "info | warn | critical",
      "title": "string",
      "detail": "string",
      "remediation": "string (present on warn/critical only)"
    }
  ]
}
```

Detection pattern: **checkId presence in findings array**. If a checkId appears, the condition exists. If absent, the check passed. This is reliable and requires no fuzzy inference.

Known checkIds (as of OpenClaw 2026.3.13):
| CheckId | Severity | Meaning |
|---|---|---|
| `summary.attack_surface` | info | Always present; contains key-value detail string |
| `gateway.trusted_proxies_missing` | warn | Reverse proxy trust not configured |
| `gateway.nodes.deny_commands_ineffective` | warn | Deny command list contains unknown command names |
| `security.trust_model.multi_user_heuristic` | warn | Multi-user setup heuristic triggered |

The `summary.attack_surface` finding's `detail` field contains a line-delimited key-value structure (see FR-5a). It is always present and is not itself a failure condition.

#### Source 2: `openclaw health --json`
**Role:** Secondary source for host metadata, channel health, and operational checks.

Key fields:
- `ok` (boolean): overall health status
- `ts` (number): epoch milliseconds
- `durationMs` (number): probe duration
- `channels` (object): keyed by channel name, each with:
  - `configured` (boolean)
  - `running` (boolean)
  - `probe.ok` (boolean)
  - `probe.error` (string, present on failure)
- `agents` (array): each with `agentId`, `isDefault`, `heartbeat` config, `sessions`
- `heartbeatSeconds` (number)

#### Source 3: `openclaw update status --json`
**Role:** Version currency and install integrity checks.

Key fields:
- `update.root` (string): install path
- `update.installKind` (string): e.g. "package"
- `update.packageManager` (string): e.g. "pnpm"
- `update.registry.latestVersion` (string): latest published version
- `update.deps.status` (string): dependency integrity status (e.g. "unknown", "ok")
- `update.deps.reason` (string): reason if status is not "ok"
- `availability.available` (boolean): whether any update is available
- `availability.hasRegistryUpdate` (boolean): registry has newer version
- `channel.value` (string): release channel (e.g. "stable")

**Note:** This output does not include the current running version. See Source 4 below.

#### Source 4: `openclaw --version`
**Role:** Current running version determination (required for NC-VERS-002).

**Confirmed output format:** `OpenClaw {semver} ({commit-hash})`
Example: `OpenClaw 2026.3.13 (61d171a)`

Parse: split on space, take index 1. Version string is standard SemVer (`YYYY.M.D` format as of 2026.3.x).

The system MUST invoke `openclaw --version` to determine the current running version. If the command fails or output format cannot be parsed, version comparison controls MUST be marked `SKIPPED` with reason "current version not determinable." Fallback: read `package.json` at path from `update.root`.

**Note on `openclaw doctor`:** `--json` flag not supported. Doctor output is unstructured text — not usable as a Mode 1 data source. Ruled out.

**Note on `openclaw security audit --deep`:** The `--deep` flag adds "best-effort live Gateway probe checks." This may surface additional signals not available in the standard audit. However, the "best-effort" qualifier and live Gateway dependency makes it less reliable than the standard scan. Not used in MVP. Candidate for Mode 1.5 once the standard scan is stable and validated.

### 4.1 Severity Mapping

OpenClaw uses a 3-tier severity model. Dock uses a 5-tier model. The mapping is:

| OpenClaw severity | Dock severity | Notes |
|---|---|---|
| `critical` | `critical` | Direct mapping |
| `warn` | `high` or `medium` | Determined per control in the control library; default is `high` |
| `info` | `info` | Direct mapping |

The control library's `severity` field is authoritative. The OpenClaw severity is used only for initial triage when a new `checkId` appears that isn't yet mapped to a Dock control.

### 4.2 Data Collection Requirements

**FR-1:** The system MUST invoke `openclaw security audit --json` and treat its findings as the primary structured security signal source for Mode 1 scoring.

**FR-2:** The system MUST invoke `openclaw update status --json` (with the `--json` flag) and parse structured version, channel, install kind, and update availability information. The system MUST NOT attempt text parsing of the non-JSON `openclaw update status` output.

**FR-3:** The system MUST invoke `openclaw health --json` and use it for host metadata, channel health context, and secondary Mode 1 checks.

**FR-3a:** The system MUST invoke `openclaw --version` when version comparison controls are enabled. Parse: split output on space, take index 1 (e.g. `OpenClaw 2026.3.13 (61d171a)` → `2026.3.13`). If the command fails or output cannot be parsed, version comparison controls MUST be marked `SKIPPED` with reason "current version not determinable." Fallback: read `package.json` at path from `update.root`.

**FR-4:** The system MUST gracefully handle failure of any data collection command — surface a clear diagnostic rather than silently treating the run as passed or failed. A failed source does not abort the entire run; controls dependent on that source are marked `ERROR` or `SKIPPED`.

**FR-5:** The system MUST validate collected data against pinned JSON schema fixtures before scoring. On schema mismatch, the affected controls MUST be marked `ERROR` with an explicit parse/interface error message. The run does NOT abort on partial schema mismatch; only affected controls are impacted.

**FR-5a:** The system MUST parse the `detail` field of the `summary.attack_surface` info finding as a line-delimited key-value structure. The following signals MUST be extracted where present:
- `groups: open={n}` — number of open (unauthenticated) groups
- `tools.elevated: enabled|disabled`
- `hooks.webhooks: enabled|disabled`
- `hooks.internal: enabled|disabled`
- `browser control: enabled|disabled`
- sandbox mode (from multi-user heuristic detail or cross-reference)

If the attack surface detail format changes or cannot be parsed, all controls dependent on it MUST be marked `ERROR` with a diagnostic message. Silent failure is not permitted.

---

## 5. Control Evaluation

**FR-6:** The system MUST map parsed output to applicable controls in the Control Library using the `check` specification defined in each control.

**FR-7:** The system MUST evaluate each applicable control as:
- `PASS` — control condition satisfied
- `FAIL` — control condition not satisfied
- `SKIPPED` — check requires Mode 2+ capability, data source unavailable, or prerequisite condition not met (e.g. webhooks disabled makes NC-OC-001 inapplicable)
- `ERROR` — check could not be evaluated due to missing data, parse failure, or schema mismatch
- `EXCLUDED` — suppressed by a user-defined exclusion (see FR-8)

**FR-8:** The system MUST support an exclusion list per control. Each exclusion entry MUST support:
- `controlId` (string, required)
- `target` (string, optional): path, pattern, or value to match
- `reason` (string, required)
- `created_at` (ISO 8601, required)
- `expires` (ISO 8601, optional but recommended)
- `created_by` (string, optional)

Exclusions are stored in `{workspace}/clawvitals/exclusions.json`.

If `expires` is present and the date has passed, the exclusion is automatically deactivated and the control reverts to normal evaluation. Expired exclusions MUST be shown separately in the report and MUST NOT continue suppressing findings.

Exclusions without an `expires` field that have been active for more than 90 days MUST be flagged in the report as a review reminder.

**FR-9:** When a finding is suppressed by an active exclusion, the report MUST show it as `EXCLUDED` (not `PASS`) with the reason and expiry date. This ensures exclusions remain auditable over time.

---

## 6. Scoring

**FR-10:** The system MUST compute scores using only **stable** controls. Experimental controls are reported separately and do not affect the primary score.

**FR-10A:** The primary Dock score MUST be calculated using stable controls only, using weighted deductions from 100:
- Critical FAIL: -25 points
- High FAIL: -10 points
- Medium FAIL: -5 points
- Low FAIL: -2 points
- Info FAIL: 0 points (reported but not scored)
- Score floor: 0 (cannot go negative)

**FR-10B:** Experimental controls MUST be shown in a separate "Experimental observations" section of the report. They MUST NOT affect the primary score, the RAG band, or alert thresholds.

**FR-11:** The system MUST assign a RAG band based on the primary score:
- 🟢 Green (90–100): No urgent action required
- 🟡 Amber (70–89): Review recommended
- 🔴 Red (0–69): Immediate remediation required

The RAG band is an operational review priority indicator. Green does not certify that an installation is secure; it indicates no urgent action is required based on the controls evaluated.

**FR-11a:** If fewer than 5 stable controls produce a PASS or FAIL result (the rest being SKIPPED or ERROR), the overall score MUST be shown as "Insufficient data" rather than a potentially misleading number. The report MUST explain which sources failed and why.

**FR-12:** The system MUST compute per-domain sub-scores using the same algorithm as FR-10A. Per-domain scores MUST show "Insufficient data" when fewer than 2 stable controls in that domain produce a PASS or FAIL result (all others being SKIPPED or ERROR). Score is uncapped per domain in v0.1 — there is no per-domain maximum deduction. This is a conscious decision: with only 8 stable controls across 3 domains, a cap would mask real severity concentration. Revisit when the library grows.

**FR-13:** SKIPPED, ERROR, EXCLUDED, and Experimental controls MUST NOT contribute to the primary score (positively or negatively).

---

## 7. Report Generation

**FR-14:** The system MUST generate a structured report for each run containing:

*Header / metadata:*
- Host identifier (hostname or user-configured name)
- Scan timestamp (ISO 8601)
- Control Library version used
- Dock skill version
- Mode (always "1 — OpenClaw Native" for MVP)
- OpenClaw version (if determinable)
- Data sources invoked with their success/failure status and source timestamps (`ts` fields)

*Primary score section (stable controls only):*
- Overall score and RAG band (or "Insufficient data" if FR-11a applies)
- Per-domain score breakdown
- FAIL findings sorted by severity (critical first), each with:
  - Control ID and name
  - Severity
  - Source: command name and checkId (or field path) that produced the finding
  - Source type: `authoritative` (direct checkId match) | `contextual` (structured field) | `derived` (parsed from detail text)
  - Current state (exact evidence — what was found)
  - Exact remediation step(s)
  - Documentation URL: `clawvitals.io/docs/{control-id}`
- PASS findings (collapsed — count only, expandable on request)
- EXCLUDED findings with reason, created date, expiry date
- SKIPPED controls with reason

*Experimental observations section:*
- Clearly labelled as experimental
- FAIL experimental findings with evidence and remediation
- Does not contribute to score

*Delta section:*
- New failures since last run (defined in FR-19)
- Newly resolved findings
- New checks introduced by library update (labelled "New check" not "New finding" — see FR-19)

**FR-15:** The report MUST be delivered via the OpenClaw messaging surface (Slack for MVP) in two parts:
- **Summary message:** Score, RAG band, critical/high finding count, delta from last run — readable in 30 seconds
- **Full detail:** Available on follow-up request ("show clawvitals details") or via link to local report file

If messaging delivery fails:
- The run still completes
- Report files are still written locally
- Summary is available via follow-up command
- Failure to message is logged as a run warning, not a scan failure

Manual scans always return a summary if messaging is available. Scheduled scans are silent unless the alert threshold is crossed. Alert retry: one retry max in MVP; if second attempt fails, log failure and do not retry further.

**FR-16:** The system MUST write the full report as a JSON file and a human-readable text file to `{workspace}/clawvitals/runs/{ISO-timestamp}/`. The JSON report MUST use the following top-level structure:

```json
{
  "version": "string (Dock skill version)",
  "library_version": "string (Control Library SemVer)",
  "meta": {
    "host_name": "string",
    "scan_ts": "ISO 8601",
    "mode": "1",
    "openclaw_version": "string | null"
  },
  "sources": {
    "security_audit": { "ok": true, "ts": 0, "error": null },
    "health": { "ok": true, "ts": 0, "error": null },
    "update_status": { "ok": true, "ts": 0, "error": null },
    "version_cmd": { "ok": true, "version": "string | null", "error": null }
  },
  "native_findings": [],
  "dock_analysis": {
    "stable": {
      "score": 0,
      "band": "green | amber | red | insufficient_data",
      "domains": {},
      "findings": []
    },
    "experimental": {
      "findings": []
    },
    "excluded": [],
    "skipped": [],
    "delta": {
      "new_findings": [],
      "resolved_findings": [],
      "new_checks": []
    }
  }
}
```

The `check.condition` field in the control library JSON is human-readable documentation only. The authoritative implementation spec for each control is the control table in Section 14 (source, source_type, and notes columns). Developers MUST use the table as the implementation spec, not the JSON condition string.

**FR-17:** The system MUST implement a data retention policy: run files older than 90 days are automatically deleted on the next scheduled run. Retention period is user-configurable via `{workspace}/clawvitals/config.json`.

---

## 8. Delta Detection

**FR-18:** The system MUST load the most recent previous successful run to compute the delta.

**FR-19:** Definitions:
- **New finding:** A control that was `PASS`, `SKIPPED`, or not evaluated in the previous run, AND is `FAIL` in the current run, AND the control's `introduced_in` version is not newer than the library version used in the previous run.
- **New check:** A control whose `introduced_in` version is newer than the library version used in the previous run. These MUST be labelled "New check" in the delta section, not "New finding."
- **Resolved finding:** A control that was `FAIL` in the previous run and is `PASS` in the current run.

**FR-20:** Medium, Low, and Info findings MUST be reported in the full report but MUST NOT trigger an alert message on their own. Alerts are triggered only by new Critical or High findings in the stable control set.

**FR-21:** If no previous run exists, the system MUST treat all findings as new and send the full report (not just delta).

---

## 9. Scheduling

**FR-22:** On first run, the system MUST offer scheduling and present cadence options:
1. Daily (8am local time)
2. Weekly (Monday 8am local time)
3. Monthly (1st of month, 8am)
4. Manual only (no schedule)

**FR-23:** The system MUST use `openclaw cron list` to check for an existing `clawvitals:scheduled-scan` job before creating one.

**FR-24:** If the job exists, the system MUST use `openclaw cron edit` to update it rather than creating a duplicate.

**FR-25:** If the job does not exist, the system MUST use `openclaw cron add --name clawvitals:scheduled-scan` to create it.

**FR-26:** Scheduled runs MUST execute silently if no new critical or high findings (stable controls only) are detected.

**FR-27:** Scheduled runs MUST send an alert message if new critical or high stable-control findings are detected, containing the delta summary and top 3 new findings with remediation.

**FR-28:** The system MUST detect if a previous scheduled run is still in progress and skip the current run rather than running concurrently. Log the skip.

---

## 10. Configuration

**FR-29:** The system MUST maintain a configuration file at `{workspace}/clawvitals/config.json` containing:
- `host_name`: user-friendly label for this instance (default: `"clawvitals-instance"` — deliberately non-identifying). Users who want meaningful fleet labels set this explicitly via `clawvitals config host_name "mac-mini-home"`. The default MUST NOT be the system hostname.
- `retention_days`: how many days to retain run files (default: 90)
- `alert_threshold`: minimum severity to trigger alerts (default: "high")
- `exclusions_path`: path to exclusions file (default: `{workspace}/clawvitals/exclusions.json`)
- `version_source`: how to determine the current OpenClaw version — `"auto"` (try `openclaw --version`, fall back to package.json at `update.root`), `"manual"` (user sets it), or a specific command string (default: `"auto"`)
- `telemetry_enabled`: whether to send anonymous scan summary pings (default: `false`)
- `telemetry_endpoint`: ping URL (default: `https://telemetry.clawvitals.io/ping`)
- `org_id`: optional org token from anguarda.com account, set via `clawvitals link <token>` (default: `null`)

**FR-30:** Configuration MUST be settable via conversational commands. *This is non-critical for MVP. If scope pressure requires cuts, deprioritize FR-30, FR-34, FR-35 before FR reliability and scoring.*

---

## 11. User Interaction

**FR-31:** The user MUST be able to trigger a manual scan by saying "run clawvitals", "clawvitals scan", or "check clawvitals".

**FR-32:** The user MUST be able to request the full detail report after a summary: "show clawvitals details", "clawvitals full report".

**FR-33:** The user MUST be able to view run history: "clawvitals history" shows the last 10 run summaries with scores and deltas.

**FR-34:** The user MUST be able to add an exclusion: "clawvitals exclude NC-AUTH-002 for path ~/.config/tool/token" adds an entry to exclusions.json. *(Non-critical for MVP — deprioritize if scope pressure.)*

**FR-35:** The user MUST be able to view current exclusions: "clawvitals exclusions" lists all active exclusions. *(Non-critical for MVP.)*

---

## 12. Telemetry and Usage Tracking

### 12.0 Architecture Overview

Dock uses a permanent thin-client telemetry model: the OpenClaw skill always fires a simple GET ping. The backend evolves independently without any changes to the client. Users never need to install additional dependencies.

**Evolution path:**
- **Stage 1 (MVP):** GET ping → Cloudflare Analytics. Zero backend. Free.
- **Stage 2 (~50+ installs):** Cloudflare Worker receives pings, stores in D1. Same endpoint, same parameters. User-facing dashboard added.
- **Stage 3 (accounts + fleet):** Auth layer added, org_id tokens validated, OTLP export to Grafana Cloud on the server side. Client still just fires a GET.

OpenTelemetry, if adopted, lives as server-side middleware — converting GET pings to OTLP internally. The OpenClaw skill never changes its telemetry implementation regardless of backend evolution.

**Unique instance identification:** Every OpenClaw installation running Dock gets a `install_id` — a UUID generated on first run and stored in `usage.json`. This is the permanent, stable identifier for that instance. It never changes. It is the key that ties all pings from one installation together, and the basis for fleet management when `org_id` is also present.

### 12.1 Local Usage State (always-on, no opt-in required)

**FR-39:** The system MUST maintain a local usage state file at `{workspace}/clawvitals/usage.json` containing:
- `install_id` (UUID, generated on first run, never changes — unique per OpenClaw instance)
- `installed_at` (ISO 8601)
- `dock_version` (string)
- `total_runs` (number)
- `manual_runs` (number)
- `scheduled_runs` (number)
- `detail_requests` (number — how many times "show clawvitals details" was requested)
- `last_run_at` (ISO 8601)
- `last_score_band` (string: green/amber/red/insufficient_data)
- `last_stable_fail_count` (number)
- `schedule_enabled` (boolean)
- `telemetry_prompt_state` (string: `not_shown` | `accepted` | `declined`) — prevents the prompt being shown twice on edge cases

This file is local-only and never transmitted unless the user opts in. It powers UX features: run history, "you haven't scanned in 14 days" nudges, posture trend, repeat-use experience.

### 12.2 Optional Anonymous Telemetry (opt-in, off by default)

**FR-40:** The system MUST offer opt-in anonymous telemetry **after the first scan report has been delivered** — not before the user has seen any value.

Prompt (shown once, after first report, when `telemetry_prompt_state == "not_shown"`):
> "Want to see your security posture history over time? Enable anonymous scan summaries and track your score at clawvitals.io/dashboard — it's free. No findings, file paths, or secrets are ever shared. You can turn this off any time."

The dashboard is the value proposition, not altruism. Reframe opt-in as *something the user gets back*, not a favour to Anguarda.

Default: **off**. User must explicitly accept. Set `telemetry_prompt_state = "accepted"` or `"declined"` after response.

**FR-41:** When telemetry is enabled, the system MUST send a GET request to `https://telemetry.clawvitals.io/ping` after each completed scan, with the following query parameters:

| Parameter | Value | Notes |
|---|---|---|
| `id` | Anonymous install UUID | from `usage.json` — permanent, unique per OpenClaw instance |
| `v` | Dock version | e.g. `0.1.0` — always a param, never a different endpoint |
| `lib` | Control Library version | e.g. `0.1.0` |
| `oc` | OpenClaw version | e.g. `2026.3.13` |
| `band` | Score band | `green`, `amber`, `red`, `insufficient` |
| `sc` | Stable controls evaluated | number |
| `sp` | Stable controls passed | number |
| `sf` | Stable controls failed | number |
| `xf` | Experimental findings count | number |
| `improved` | Posture delta vs previous run | `1` (fewer failures), `0` (same), `-1` (more failures) |
| `sched` | Scheduled scan | `1` or `0` |
| `detail` | Detail report requested this session | `1` or `0` |
| `first` | First ever scan | `1` or `0` — key retention signal |
| `org` | Org token (optional) | null for anonymous installs; set via `clawvitals link <token>` when account exists |

**Parameter naming uses OTel-compatible conventions** so backend upgrade to OTLP is a drop-in replacement with no client changes required.

**Key signals:**
- `first=1` is the primary retention signal. If most pings have `first=1`, users aren't doing recurring scans.
- `improved` tells you whether Dock is actually changing behaviour — the most important product impact signal.
- All pings go into product analytics regardless of whether `org` is present. Anonymous installs are valid and valuable data.

No checkIds, finding content, file paths, hostnames, channel identifiers, remediation text, or credentials are ever sent.

**FR-41a — Dock version is always a parameter, never a different endpoint.** Version never determines the endpoint URL. The backend handles all versions and slices by `v` in analytics.

**FR-41b — org_id is a forward-compatible field.** The `org` parameter is included in v0.1 as a null/empty field so the ping schema is stable. It will be populated in Stage 2 when anguarda.com accounts exist. No backend logic depends on it in MVP. See the product roadmap document for fleet management and org account design.

### 12.3 Telemetry Requirements (continued)

**FR-42:** Telemetry failure MUST be completely silent. No retry on failure. No error surfaced to the user. Telemetry MUST NOT affect the scan, the report, or any part of the user experience.

**FR-43:** Users MUST be able to disable telemetry at any time via:
- Conversational command: "clawvitals telemetry off" / "clawvitals telemetry on"
- Config: `telemetry_enabled: false` in `{workspace}/clawvitals/config.json`

**FR-44:** Config additions for telemetry:
- `telemetry_enabled` (boolean, default: `false`)
- `telemetry_endpoint` (string, default: `https://telemetry.clawvitals.io/ping`)
- `org_id` (string, optional, default: null — set via `clawvitals link <token>`)

**Success metrics from telemetry (what we measure in v0.1):**
1. Unique `install_id`s that have ever pinged → adoption
2. `install_id`s with `first=0` pings → retention (are users doing recurring scans?)
3. `detail=1` rate → engagement (do users read the full report?)
4. `sched=1` rate → sticky usage (did they set up scheduled scans?)
5. `improved=1` rate over time → product impact (is Dock changing behaviour?)

For fleet management, org accounts, dashboard tiers, anti-abuse, and monetisation design — see `clawvitals/ROADMAP.md`.

---

## 13. Distribution

**FR-36:** The skill MUST be packaged and published to ClawHub: `openclaw skills install clawvitals`.

**FR-37:** The skill MUST declare its minimum supported OpenClaw version in its manifest.

**FR-38:** The skill MUST declare the Control Library version range it is compatible with in its manifest.

---

## 14. Control Library Schema

Each control in the library is a JSON object with the following schema:

```json
{
  "id": "NC-OC-001",
  "name": "Webhook signing secret configured",
  "domain": "OC",
  "severity": "critical",
  "mode": 1,
  "status": "stable",
  "introduced_in": "0.1.0",
  "description": "Verifies that a webhook signing secret is configured when webhooks are enabled.",
  "why_it_matters": "Without a signing secret, any actor with knowledge of your webhook URL can send arbitrary commands to your OpenClaw installation.",
  "check": {
    "source": "openclaw_security_audit",
    "source_type": "authoritative",
    "prerequisite": "attack_surface.hooks.webhooks == 'enabled'",
    "prerequisite_skip_reason": "Webhooks not enabled — check not applicable",
    "condition": "findings does NOT contain checkId matching signing-secret-related pattern"
  },
  "evidence_template": "Signing secret warning present: {present}",
  "remediation": "Set the webhook signing secret environment variable before starting the gateway. See: https://clawvitals.io/docs/NC-OC-001",
  "references": [
    "https://clawvitals.io/docs/NC-OC-001"
  ],
  "false_positive_notes": "None expected on enabled-webhook installs — this is a binary configuration check."
}
```

**Schema fields:**
- `id` (string, required): `NC-{DOMAIN}-{NUMBER}` format
- `name` (string, required): Human-readable, max 60 chars
- `domain` (string, required): One of OC, AUTH, VERS (active in v0.1); NET, DOCKER, OLLAMA, TUNNEL, SECRET, OS, PKG, EXT (reserved for future modes)
- `severity` (string, required): One of critical, high, medium, low, info — **authoritative Dock severity**
- `mode` (integer, required): Minimum mode required (1, 2, or 3)
- `status` (string, required): One of experimental, stable, deprecated
- `introduced_in` (string, required): SemVer of the Control Library version in which this control was first added. Used by delta detection to distinguish "new check" from "new finding."
- `description` (string, required): What this control checks
- `why_it_matters` (string, required): Plain-English explanation of the risk
- `check.source` (string, required): Which data source this check uses
- `check.source_type` (string, required): One of `authoritative` (direct checkId match), `contextual` (structured JSON field), `derived` (parsed from detail text)
- `check.prerequisite` (string, optional): Condition that must be true before this check applies. If false, control is SKIPPED.
- `check.prerequisite_skip_reason` (string, required if prerequisite present): Message shown when skipped due to prerequisite.
- `check.condition` (string, required): Human-readable condition description
- `evidence_template` (string, required): Template for the evidence string shown in the report
- `remediation` (string, required): Exact steps to fix. Must include a documentation URL.
- `references` (array, required): At least one URL
- `false_positive_notes` (string, required): Known FP scenarios and how to handle

---

## 15. Control Library v0.1 — Controls

### Domain: OpenClaw Platform (NC-OC-*)

| ID | Name | Sev | Source | Source Type | Status | Notes |
|---|---|---|---|---|---|---|
| NC-OC-001 | Webhook signing secret configured | Critical | security_audit | authoritative | Deferred | Fixture work confirmed: `hooks.webhooks` in attack_surface detail refers to OpenClaw's internal webhook receiver, which is NOT configurable via `openclaw config set`. The "webhooks enabled + no signing secret" state cannot be reproduced through standard user configuration. NC-OC-001 as designed is not implementable in Mode 1. Requires further investigation of the actual config path before this control can be implemented. Move out of active v0.1 control set. |
| NC-OC-002 | Sandbox mode appropriate for deployment context | High | security_audit | authoritative | Experimental | Prerequisite: `security.trust_model.multi_user_heuristic` checkId present. SKIPPED on single-user deployments. |
| NC-OC-003 | No ineffective deny command entries | High | security_audit | authoritative | Stable | Direct: `gateway.nodes.deny_commands_ineffective` |
| NC-OC-004 | No open (unauthenticated) groups | Critical | security_audit | authoritative | Stable | Fixture work confirmed: OpenClaw emits dedicated Critical checkIds when groups are open and dangerous. Check for presence of `security.exposure.open_groups_with_elevated` OR `security.exposure.open_groups_with_runtime_or_fs` in findings. Either present = FAIL Critical. Severity upgraded from Medium to Critical to match actual checkId severity. Source type upgraded from derived (text parse) to authoritative (checkId detection). |
| NC-OC-005 | Elevated tools usage acknowledged | Info | attack_surface detail | derived | Experimental | Parse `tools.elevated: enabled`; INFO (not scored) — prompts user to confirm intentional and exclude; expected config for personal-assistant deployments |
| NC-OC-006 | Workspace file access scoped | High | security_audit detail | derived | Experimental | Prerequisite: `security.trust_model.multi_user_heuristic` checkId present. Parse `fs.workspaceOnly=false` from detail. SKIPPED on single-user deployments. |
| NC-OC-007 | Dependency integrity verifiable | Medium | update_status_json | contextual | Experimental | `update.deps.status` is `"unknown"` on a standard pnpm install (lockfile missing). Demoted to Experimental until validated across multiple install types. FAIL only if status is a known failure value (not "ok" or "unknown"). Promote to Stable once confirmed reliable across package and git installs. |
| NC-OC-008 | All configured channels healthy | Medium | health_json | contextual | Stable | Any `channels.*.probe.ok == false` → FAIL |
| NC-OC-009 | OpenClaw update available | Info | update_status_json | contextual | Stable | `availability.hasRegistryUpdate == true` → INFO. Informational nudge only — not scored. See NC-VERS-001 note on overlap. |

**Notes on NC-OC-001:** Deferred — not implementable in Mode 1. Fixture work confirmed that `hooks.webhooks` in the attack_surface detail is OpenClaw's internal webhook receiver and cannot be enabled/configured via `openclaw config set hooks.webhooks.enabled true` (rejected as unrecognized key). The signing secret check scenario cannot be reproduced. This control needs redesign before it can be implemented. Removed from active v0.1 control set.

**Notes on NC-OC-004:** Upgraded from derived/Medium to authoritative/Critical following fixture validation. OpenClaw emits two dedicated Critical checkIds when groups are open: `security.exposure.open_groups_with_elevated` (open groups + elevated tools) and `security.exposure.open_groups_with_runtime_or_fs` (open groups + runtime/fs exposure). The attack_surface detail `groups: open=N` count is still useful as a quick parse, but the checkId-based detection is more reliable and surfaces the actual severity. Both checkIds must be checked; either present = FAIL.

**Notes on NC-OC-002:** Only fires when `security.trust_model.multi_user_heuristic` checkId is present. OpenClaw's security model explicitly permits sandbox-off for single-user personal-assistant deployments — this is not a misconfiguration in that context. Dock respects this by only flagging when OpenClaw itself signals the deployment has shifted outside personal-assistant territory.

**Notes on NC-OC-005:** INFO-level, not scored. Elevated tools are the default and correct configuration for personal-assistant deployments. Auto-failing would produce a false positive on the majority of OpenClaw installs and erode trust. Instead: surface once as an acknowledgement prompt. First occurrence message: "Elevated tools are enabled — expected for personal assistant deployments. If intentional, run "clawvitals exclude NC-OC-005 reason 'personal assistant setup'` to acknowledge." After exclusion, silent. Does not appear in hardened/enterprise configurations where elevated tools would be disabled.

### Domain: Authentication (NC-AUTH-*)

| ID | Name | Sev | Source | Source Type | Status | Notes |
|---|---|---|---|---|---|---|
| NC-AUTH-001 | Reverse proxy trust correctly configured | High | security_audit | authoritative | Stable | Direct: `gateway.trusted_proxies_missing`; severity is High not Critical |
| NC-AUTH-002 | No API tokens in workspace files | High | workspace_scan | n/a | Experimental | Independent filesystem scan — not derived from CLI outputs |
| NC-AUTH-003 | No tokens in OpenClaw log files | High | log_scan | n/a | Experimental | Independent filesystem scan — not derived from CLI outputs |

**Notes on NC-AUTH-001:** Renamed from "Webhook signature verification" to reflect what the checkId actually tests: reverse proxy trust configuration. The original control NC-AUTH-001 intent is preserved in NC-OC-001.

**Notes on NC-AUTH-002/003:** These controls require independent filesystem scanning and are NOT derived from any of the three CLI outputs. They remain Experimental and are subject to higher false-positive risk. See NFR-12.

### Domain: Version Currency (NC-VERS-*)

| ID | Name | Sev | Source | Source Type | Status | Notes |
|---|---|---|---|---|---|---|
| NC-VERS-001 | OpenClaw is behind latest release | Medium | update_status_json | contextual | Stable | `availability.hasRegistryUpdate == true` → FAIL at Medium (not High). Being behind latest is not always security-critical. Note: overlaps with NC-OC-009 (INFO nudge). NC-OC-009 fires always when behind; NC-VERS-001 is the scored finding. Consider collapsing in a future version — kept separate for now to allow independent scoring and messaging. |
| NC-VERS-002 | OpenClaw not more than 2 minor versions behind | Medium | update_status_json + openclaw --version | contextual | Stable | Requires current version; SKIPPED if unavailable |
| NC-VERS-004 | Node.js runtime within LTS support window | Medium | node --version | contextual | Experimental | Requires adding node as a 5th data source |
| NC-VERS-005 | No deprecated API usage warnings | Low | security_audit | authoritative | Experimental | Check for deprecation-related checkIds; uncertain data source |

**NC-VERS-003 (OpenClaw version has no known critical CVEs) — MOVED TO MODE 2.** Requires external CVE database call, which breaks Mode 1 "no external calls" positioning.

**Total v0.1: 16 controls**
- Severity (active controls only, excluding Deferred NC-OC-001): 1 Critical (NC-OC-004), 5 High, 5 Medium, 1 Low, 2 Info
- 7 Stable / 9 Experimental
- Score-contributing stable controls: 6 (NC-OC-009 is Stable/Info — not scored)
- Info-only controls: NC-OC-005 (Experimental), NC-OC-009 (Stable)

| Status | Controls |
|---|---|
| Stable (score) | NC-OC-003, NC-OC-004, NC-OC-008, NC-AUTH-001, NC-VERS-001, NC-VERS-002 |
| Stable (info) | NC-OC-009 |
| Experimental | NC-OC-002, NC-OC-005, NC-OC-006, NC-OC-007, NC-AUTH-002, NC-AUTH-003, NC-VERS-004, NC-VERS-005 |
| Deferred | NC-OC-001 (not implementable in Mode 1 — see control notes) |
- Stable controls contribute to the primary score. Experimental controls are reported separately.

---

## 16. Non-Functional Requirements

### 15.1 Performance
**NFR-1:** Complete Mode 1 assessment MUST finish within 60 seconds on standard hardware.
**NFR-2:** Report generation MUST complete within 5 seconds of assessment completion.
**NFR-3:** Concurrent run detection and skip MUST complete within 1 second.

### 15.2 Privacy and Security
**NFR-4:** The system MUST NOT transmit secret values, API keys, or credentials to any external service.
**NFR-5:** Run files MUST store only boolean indicators for secret presence, never actual values.
**NFR-6:** NC-AUTH-002/003 workspace/log scans MUST only log presence (count of matches) and file path — never the matched content.
**NFR-7:** Run storage files MUST have restrictive permissions (chmod 600 or equivalent).
**NFR-8:** The system MUST run with minimum required permissions — no elevated access.

### 15.3 Reliability
**NFR-9:** A failed/errored assessment run MUST NOT overwrite the last successful run in storage.
**NFR-10:** If Control Library cannot be fetched remotely, the system MUST use the last cached version and indicate in the report that the library may be outdated.
**NFR-11:** Parse failures in any data source output MUST produce a clear diagnostic message indicating which field failed to parse and why.

### 15.4 Accuracy
**NFR-12:** No stable control in v0.1 MUST have a false positive rate exceeding 5% across real OpenClaw installations before marking as `stable`.
**NFR-13:** All `stable` controls MUST be validated against at minimum 3 real OpenClaw configurations (normal install, misconfigured, hardened). Fixtures must exist for all three.
**NFR-14:** `experimental` controls are reported but clearly labelled and excluded from the primary score until promoted to `stable`.

### 15.5 Maintainability
**NFR-15:** Check logic MUST be separated from scoring and reporting logic.
**NFR-16:** Adding a new control MUST require only: adding a JSON entry to the control library and a corresponding check implementation. No changes to core scoring/reporting code.
**NFR-17:** The Control Library MUST follow SemVer. MAJOR for breaking changes (including removal of stable controls), MINOR for new controls, PATCH for fixes to existing controls.

---

## 17. v0.1 Success Criteria

Dock v0.1 is successful if:
1. It reliably parses OpenClaw CLI JSON outputs across real installations without errors
2. It produces findings users believe — low false-positive rate on stable controls
3. Stable controls catch at least a few real issues users would have missed
4. Users read the reports (request full detail, re-run after remediation)
5. Experimental controls do not damage product credibility or trust
6. Scheduled scans run silently when clean, alert when new issues appear

Success is NOT defined as "all FRs implemented." The core value is trust, usefulness, and repeat usage.

---

## 18. Out of Scope (MVP)

- Network exposure scanning (Mode 2)
- Docker/container inspection (Mode 2)
- Ollama model server exposure (Mode 2)
- OS hardening checks — disk encryption, SSH config (Mode 2)
- NC-VERS-003: Package CVE scanning against external CVE DB (Mode 2)
- External internet probe (Mode 3)
- Cloud backend — history storage, API (Phase 2)
- Paid tiers and billing (Phase 2)
- Shareable report URLs (Phase 2)
- Multi-host support (Phase 2)
- Email/webhook alerts (Phase 2)
- Governance or compliance validation (not in Dock scope at any tier)

---

## 19. Assumptions

1. `openclaw security audit --json` produces the schema documented in Section 4.0. Confirmed on OpenClaw 2026.3.x. Risk remains that schema may change between OpenClaw versions — parser MUST validate against expected schema per FR-5.
2. `openclaw update status --json` (with `--json` flag) is available. Confirmed on OpenClaw 2026.3.13. On older versions where the flag is not recognised, version currency controls MUST be marked SKIPPED.
3. `openclaw health --json` remains available without elevated permissions.
4. `openclaw cron add` supports named jobs and `openclaw cron list` is queryable.
5. ClawHub exists and supports skill publication at time of MVP launch.
6. The user has at least one OpenClaw messaging surface configured.
7. The workspace directory is writable for run and config storage.
8. The skill does not require elevated OS permissions to invoke OpenClaw CLI commands.

---

## 20. Key Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Upstream checkIds or schema changes break parsing | High | Parse defensively; pin to tested OpenClaw version range; maintain fixtures; validate on schema parse |
| False positives (especially NC-AUTH-002/003) erode trust | Critical | Exclusion mechanism; experimental tagging; validate on 3 configs before stable; track FP rate |
| `attack_surface` detail format changes break derived controls | High | Parse with explicit error on format mismatch; mark dependent controls ERROR, not silently pass |
| `openclaw cron` API surface changes | Medium | Abstract cron calls behind a wrapper; fail gracefully with manual fallback |
| ClawHub doesn't exist/has low traffic at launch | Medium | Distribute via GitHub and OpenClaw Discord as fallback |
| Users ignore reports — adoption loop fails | High | Prioritize clear 30-second summary; exact remediation steps; delta to show improvement |
| Experimental controls damage credibility if too prominent | Medium | Strict visual separation; experimental section clearly labelled; no headline score contribution |
| Current version not determinable — VERS controls all SKIPPED | Medium | Implement FR-3a `version_source` config; default to "auto" with multiple fallback strategies |
| `attack_surface` detail string format is not a versioned API | High | OpenClaw may change this human-readable string without considering it a breaking change. FR-5a handles ERROR on parse failure (non-fatal). NC-OC-004, NC-OC-005, NC-OC-006 all depend on this parser. Treat as the most fragile interface in Mode 1. Monitor on each OpenClaw version upgrade. |

---

## 21. Open Items (Pre-build)

| # | Item | Status |
|---|---|---|
| 1 | Phase 0 fixtures: normal, misconfigured, hardened installs | ✅ Complete — 8 fixtures in clawvitals/fixtures/, all stable controls have PASS+FAIL coverage |
| 2 | `openclaw --version` exact output format | ✅ Confirmed: `OpenClaw {semver} ({hash})` — parse index 1 |
| 3 | NC-VERS-004 (Node.js LTS): `node --version` confirmed as Source 5, keep as Experimental | ✅ Decided |
| 4 | NC-VERS-005 (Deprecated API warnings): `doctor --json` not supported; no structured source found — move to Mode 2 | ✅ Deferred to Mode 2 |
| 5 | NC-OC-002: only flag when multi-user heuristic fires — not standalone sandbox-off | ✅ Decided |
| 6 | NC-OC-005: INFO-level, not scored — acknowledgement prompt on first occurrence | ✅ Decided |

---

## 22. Revision History

| Version | Date | Changes |
|---|---|---|
| 0.1 | 2026-03-16 | Initial draft |
| 0.2 | 2026-03-16 | Gemini review: error handling, exclusions, retention, concurrent run detection, control schema, data retention, exclusion mechanism |
| 0.3 | 2026-03-18 | Phase 0 complete: confirmed interface schemas documented; severity mapping table; FR-1/2/3 updated to actual commands; FR-3a added (version source); FR-5a added (attack_surface parsing); FR-10A/10B explicit stable/experimental scoring split; FR-11a "insufficient data" band; FR-15 messaging fallback specified; FR-19 "new check" vs "new finding" distinction; exclusion expiry fields; `introduced_in` field on control library schema; source_type per finding; report split native/dock-added; RAG reframed as review-priority; NC-AUTH-001 renamed; NC-OC-007/008/009 added from live data; NC-VERS-003 moved to Mode 2; success criteria section; open items table; Compass/governance language removed |
| 0.4 | 2026-03-18 | Final pre-build cleanup: FR-3a SHOULD→MUST; FR-12 per-domain "insufficient data" + explicit no-cap decision; FR-16 JSON report schema defined; NC-OC-001 demoted to Experimental (checkId unconfirmed); NC-OC-002/006 prerequisites explicit; NC-OC-007 demoted to Experimental (unreliable on pnpm); NC-VERS-001 severity High→Medium; NC-OC-009 overlap noted; attack_surface fragility risk added; misconfigured fixture requirement for NC-OC-001 confirmation; attack_surface parser fixture coverage explicit |
| 0.4.2 | 2026-03-18 | Telemetry: new Section 12 added; FR-39 local usage state (always-on); FR-40–44 opt-in anonymous telemetry (GET ping, off by default, ask after first report); `install_id`, `first` flag, all parameters defined; Cloudflare Analytics backend (no code required); sections renumbered 13–22; control count corrected to 16 |
| 0.5 | 2026-03-18 | Telemetry expanded: architecture overview (permanent thin-client model, OTel server-side only); `install_id` as unique per-instance identifier; `improved` posture delta param; `org` and `host` params; org_id/fleet management design (FR-41b/c); anti-abuse rate limiting (FR-41d); monetisation tiers table; dashboard as opt-in value prop; `telemetry_prompt_state` added to usage.json; `org_id` added to config; `improved` metric added to FR-41; anonymous pings confirmed as valid product analytics; success metrics list |
| 0.6 | 2026-03-18 | Requirements trimmed to MVP scope: removed FR-41c (HMAC), FR-41d (rate limiting), Section 12.4 (anti-abuse), Section 12.5 (monetisation tiers) — moved to ROADMAP.md; `host` removed from v0.1 ping (fleet-only feature); `host_name` default changed to `"clawvitals-instance"` (non-identifying); FR-41 "when telemetry is enabled" wording deduped; `org` kept as null/forward-compatible param; non-MVP roadmap extracted to separate document |
| 0.7 | 2026-03-18 | Fixture work findings: Open Item #1 closed (8 fixtures complete); NC-OC-001 deferred (hooks.webhooks not user-configurable in Mode 1); NC-OC-004 upgraded derived/Medium → authoritative/Critical (checkIds: open_groups_with_elevated + open_groups_with_runtime_or_fs); Deferred category added to control table; severity summary updated |
