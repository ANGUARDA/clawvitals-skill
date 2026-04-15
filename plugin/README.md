# ClawVitals Plugin

Programmatic security health check for self-hosted [OpenClaw](https://openclaw.ai) installations. Recurring posture tracking, delta detection, and regression-aware alerting.

> This is the **plugin** — the stateful, scheduled, telemetry-enabled upgrade from the [ClawVitals Skill](https://clawhub.com/skills/clawvitals). If both are installed, the plugin runs by default.

---

## Contents

- [Skill vs Plugin](#skill-vs-plugin)
- [Install](#install)
- [Uninstall](#uninstall)
- [Commands](#commands)
- [Running ClawVitals — skill vs plugin](#running-clawvitals--skill-vs-plugin)
- [Example output](#example-output)
- [Regression alerts](#regression-alerts)
- [Scheduling](#scheduling)
- [Fleet Management](#fleet-management)
- [Exclusion management](#exclusion-management)
- [Telemetry](#telemetry)
- [Configuration](#configuration)
- [Directory structure](#directory-structure)
- [License](#license)

---

## Skill vs Plugin

The **ClawVitals skill** (on ClawHub) is stateless — it runs a point-in-time scan, prints the result, and stores nothing. No telemetry, no network calls, no persistent state. It is locked and will not change.

The **plugin** is the upgrade path. It adds everything the skill deliberately omits:

| Feature | Skill | Plugin |
|---|---|---|
| Scan & score | ✅ | ✅ |
| Remediation steps | ✅ | ✅ |
| Experimental controls | ✅ | ✅ |
| Scan history & delta detection | ❌ | ✅ |
| Recurring scheduled scans | ❌ | ✅ |
| Regression + critical alerts | ❌ | ✅ |
| Exclusion management | ❌ | ✅ |
| Posture trend on dashboard | ❌ | ✅ |
| Fleet management (alias) | ❌ | ✅ |
| Telemetry | none | **on by default (opt-out)** |

---

## Install

ClawVitals Plugin is published on [ClawHub](https://clawhub.com) _(exact listing URL TBD)_.

### Step-by-step

**1. Install the plugin via ClawHub:**

```bash
npx clawhub install clawvitals --plugin
```

Or in your OpenClaw messaging surface (Slack, iMessage, etc.):

```
install clawvitals plugin
```

**2. Confirm the installation:**

```
clawvitals version
```

Expected output:

```
ClawVitals Plugin v0.1.0 🔌
Control Library v0.1.0
OpenClaw 2026.3.13 (61d171a)
```

**3. Run your first scan:**

```
run clawvitals
```

On first run, you will be prompted to set a scan schedule (daily, weekly, monthly, or manual only). You can skip this and configure it later with `clawvitals set schedule`.

---

## Uninstall

**1. Remove the scheduled scan (if configured):**

```
clawvitals set schedule none
```

This removes the `clawvitals:scheduled-scan` cron job from your OpenClaw installation.

**2. Uninstall the plugin via ClawHub:**

```bash
npx clawhub uninstall clawvitals --plugin
```

Or in your OpenClaw messaging surface:

```
uninstall clawvitals plugin
```

**3. Confirm removal:**

After uninstalling, `run clawvitals` will fall back to the skill if it is still installed, or return a "not found" error if neither is installed.

> **Note:** Uninstalling does not delete your scan history. Run files are stored at `{workspace}/clawvitals/runs/` and are retained according to your configured retention policy (default: 90 days). To remove all data, delete this directory manually.

---

## Commands

| Command | Description |
|---|---|
| `run clawvitals` | Run a full security scan |
| `run clawvitals --plugin` | Force the plugin to run (see [skill vs plugin](#running-clawvitals--skill-vs-plugin)) |
| `run clawvitals --skill` | Force the skill to run (see [skill vs plugin](#running-clawvitals--skill-vs-plugin)) |
| `show clawvitals details` | Full report with all findings and remediation steps |
| `show clawvitals identity` | Show install UUID, alias, and dashboard link |
| `clawvitals version` | Show plugin version, control library version, and OpenClaw version |
| `clawvitals status` | Show last scan time, score, schedule, and trial/plan status |
| `clawvitals set schedule <cadence>` | Configure recurring scan cadence |
| `clawvitals set alias <name>` | Set a friendly name for this host in reports and dashboard |
| `clawvitals exclude <control-id> <reason>` | Suppress a finding with a reason |
| `clawvitals exclusions` | List all active exclusions |
| `clawvitals telemetry on\|off` | Enable or disable telemetry |
| `clawvitals trial` | Show trial status and upgrade options |
| `clawvitals upgrade` | Upgrade to a paid plan |
| `clawvitals configure webhook` | Set up a webhook for alert delivery |

---

## Running ClawVitals — skill vs plugin

If both the **ClawVitals Skill** and the **ClawVitals Plugin** are installed, **the plugin takes priority by default.** The plugin header in the output makes it clear which one ran.

### Override switches

To explicitly choose which runs, use the `--plugin` or `--skill` flag:

```
run clawvitals --plugin    # force plugin (explicit)
run clawvitals --skill     # force skill (fallback to instruction-only mode)
```

These flags work regardless of which is installed — if you force `--skill` but only the plugin is installed (or vice versa), you'll get an error.

### How to tell which ran

Every plugin scan starts with a versioned header:

```
ClawVitals Plugin v0.1.0 🔌
```

The skill does not emit this header. If you don't see it, the skill ran.

---

## Example output

### Summary message (after `run clawvitals`)

```
ClawVitals Plugin v0.1.0 🔌

🔴 Security Score: 58 / 100  ·  RED
Host: mac-mini-home  ·  Scanned: 2026-04-15 15:38 BST

Findings: 2 Critical  ·  1 High  ·  1 Medium
Delta: ▲ 1 new finding since last scan (2026-04-08)

─────────────────────────────────────────
CRITICAL  NC-GW-001  Gateway auth disabled
CRITICAL  NC-OC-003  Command policy: deny-only mode
HIGH      NC-VERS-001  OpenClaw update available (2026.3.13 → 2026.4.1)
MEDIUM    NC-OC-008  Channel health degraded

▶ Reply "show clawvitals details" for full report with remediation steps.
📈 Track your posture over time → https://dashboard.clawvitals.io
```

### Full details (after `show clawvitals details`)

```
ClawVitals Plugin v0.1.0 🔌  ·  Full Report
Host: mac-mini-home  ·  Control Library v0.1.0  ·  OpenClaw 2026.3.13

━━━ CRITICAL ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

[NC-GW-001] Gateway auth disabled
Severity: Critical  ·  Source: security_audit (authoritative)
Evidence: groups[0].auth.type = "none"
Fix: openclaw gateway auth set --type bearer --token <your-token>
Docs: https://clawvitals.io/docs/NC-GW-001

[NC-OC-003] Command policy: deny-only mode
Severity: Critical  ·  Source: security_audit (authoritative)
Evidence: commandPolicy = "deny"
Fix: openclaw policy set --commands allowlist
Docs: https://clawvitals.io/docs/NC-OC-003

━━━ HIGH ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

[NC-VERS-001] OpenClaw update available
Severity: High  ·  Source: update_status (authoritative)
Evidence: current=2026.3.13, latest=2026.4.1, channel=stable
Fix: openclaw update
Docs: https://clawvitals.io/docs/NC-VERS-001

━━━ MEDIUM ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

[NC-OC-008] Channel health degraded
Severity: Medium  ·  Source: health (contextual)
Evidence: channels[0].status = "degraded"
Fix: Check channel configuration with: openclaw channels list --verbose
Docs: https://clawvitals.io/docs/NC-OC-008

━━━ PASSED (2) ━━━━━━━━━━━━━━━━━━━━━━━━━━━

✅ NC-AUTH-001  Trusted proxy configured
✅ NC-VERS-002  Running recent version

━━━ DELTA ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

▲ New finding (vs scan 2026-04-08):
  NC-OC-008  Channel health degraded  [MEDIUM]

No resolved findings since last scan.

━━━ EXPERIMENTAL ━━━━━━━━━━━━━━━━━━━━━━━━

(No experimental findings — does not affect score)

Run files saved to: ~/.openclaw/workspace/clawvitals/runs/2026-04-15T15-38-00Z/
```

### `clawvitals version` output

```
ClawVitals Plugin v0.1.0 🔌
Control Library v0.1.0
OpenClaw 2026.3.13 (61d171a)
```

### `clawvitals status` output

```
ClawVitals Plugin v0.1.0 🔌

Last scan:   2026-04-15 15:38 BST
Score:       58 / 100  🔴 RED
Schedule:    Weekly (Mondays 8:00am)
Next scan:   2026-04-20 08:00 BST
Plan:        Free trial  (12 days remaining)
Host alias:  mac-mini-home
```

---

## Regression alerts

When a **scheduled scan** detects new Critical or High findings that were not present in the previous scan, the plugin sends a **regression alert** to your OpenClaw messaging surface.

### Alert format

```
⚠️ ClawVitals Plugin v0.1.0 🔌 — Regression Detected

Host: mac-mini-home  ·  Scanned: 2026-04-15 08:00 BST
Score: 58 → 51  🔴 RED  (▼ 7 points)

1 new Critical finding, 1 new High finding.

─────────────────────────────────────────
🔴 CRITICAL  NC-GW-001  Gateway auth disabled
Evidence: groups[0].auth.type = "none"
Fix: openclaw gateway auth set --type bearer --token <your-token>
→ https://clawvitals.io/docs/NC-GW-001

🟠 HIGH  NC-VERS-001  OpenClaw update available (2026.3.13 → 2026.4.1)
Evidence: current=2026.3.13, latest=2026.4.1, channel=stable
Fix: openclaw update
→ https://clawvitals.io/docs/NC-VERS-001

(+1 more finding — reply "show clawvitals details" for full report)
─────────────────────────────────────────

Reply "show clawvitals details" for remediation steps on all findings.
```

### Alert rules

- Alerts fire **only for new Critical or High findings** in the stable control set.
- **Medium, Low, and Info** findings are in the full report but do not trigger an alert on their own.
- If no new Critical/High findings, scheduled scans run **silently** — no message is sent.
- On the **first ever scan** (no prior baseline), all findings are treated as new and the full report is sent.
- Alerts are delivered via your primary OpenClaw messaging surface (e.g. Slack). If delivery fails, the plugin retries once. If the retry also fails, the failure is logged to the run file — the scan is not marked as failed.
- To route alerts to a webhook instead (or in addition), use `clawvitals configure webhook`.

### Delivery channels

| Channel | Configured by |
|---|---|
| OpenClaw messaging surface (default) | Automatic |
| Webhook (Slack, Discord, Teams, etc.) | `clawvitals configure webhook` |
| Email digest | Phase 2 (not yet available) |

---

## Scheduling

On first run you'll be offered a schedule:

1. Daily (8am local time)
2. Weekly (Monday 8am local time)
3. Monthly (1st of month, 8am)
4. Manual only

Change it any time:

```
clawvitals set schedule weekly
clawvitals set schedule daily
clawvitals set schedule monthly
clawvitals set schedule none
```

---

## Fleet Management

Give each installation a human-readable alias for the dashboard:

```
set clawvitals alias prod-server-1
set clawvitals alias dev-laptop
```

The alias is **always user-set** — never derived from the machine hostname, username, or any system identifier. Each installation also has a random UUID generated at install time (`iid`). The dashboard shows both:

```
prod-server-1   (iid: a3f2...)   85/100  🟢  last scan: 2h ago
dev-laptop      (iid: 7c1b...)   70/100  🟡  last scan: 1d ago
<unnamed>       (iid: 9e4d...)   45/100  🔴  last scan: 3d ago
```

To view your current install identity:

```
show clawvitals identity
```

Output:

```
ClawVitals Plugin v0.1.0 🔌

Install ID (iid): a3f2c8e1-...
Alias:            prod-server-1
Dashboard:        https://dashboard.clawvitals.io
```

---

## Exclusion management

Suppress findings that are intentional or not applicable to your setup:

```
clawvitals exclude NC-OC-005 reason "personal assistant setup"
clawvitals exclude NC-AUTH-001 reason "no reverse proxy, local-only" expires 2026-09-01
clawvitals exclusions
```

Exclusions are stored in `~/.openclaw/workspace/clawvitals/exclusions.json` (mode 600). They appear as `EXCLUDED` in scan reports — never silently hidden. Expired exclusions are automatically inactivated on the next scan.

---

## Telemetry

The plugin defaults telemetry **on**. This is intentional: the plugin exists to power [clawvitals.io/dashboard](https://clawvitals.io/dashboard) — without telemetry, the dashboard has no data.

**What is sent (nothing else):**
- Plugin version, control library version
- Numeric score + band (green/amber/red)
- FAIL count, PASS count
- Total lifetime scan count (integer)
- Scheduled/manual flag
- Random install UUID generated at plugin install time (no PII)
- **Alias** — only if you explicitly set one (see [Fleet Management](#fleet-management))

**What is never sent:**
- Hostnames, usernames, IP addresses, or file paths
- Finding details, control IDs, or failure reasons
- OpenClaw config, tokens, credentials, or secrets
- Any machine-derived identifier

**Opt out at any time:**

```
clawvitals telemetry off
```

---

## Configuration

```json5
{
  plugins: {
    entries: {
      clawvitals: {
        telemetry: {
          enabled: true,          // opt OUT by setting false
          alias: "prod-server-1"  // optional — for fleet management
        },
        schedule: {
          enabled: true,
          cron: "0 9 * * *"       // 9 AM daily (default)
        },
        alerts: {
          on_regression: true,    // alert on score drop or new FAILs
          on_new_critical: true,  // alert immediately on new critical finding
          threshold: "high"       // minimum severity to alert
        },
        retention_days: 90
      }
    }
  }
}
```

---

## Directory structure

```
plugin/
├── src/
│   ├── index.ts           ← plugin entry point + tool registration + cron hook
│   ├── plugin-config.ts   ← plugin config, state, and trial types
│   ├── telemetry.ts       ← PluginTelemetryClient (opt-out default, alias support)
│   ├── scheduler.ts       ← cron config resolution + validation
│   ├── alerts.ts          ← regression and critical finding alert evaluation
│   ├── alias.ts           ← alias validation + fleet display formatting
│   ├── orchestrator.ts    ← full scan pipeline (ScanOrchestrator)
│   ├── collectors/        ← data collectors (security-audit, health, version, update-status)
│   ├── controls/          ← control library + evaluator
│   ├── scoring/           ← scorer + delta detection
│   ├── reporting/         ← summary, detail, storage
│   ├── config/            ← ConfigManager (config.json, usage.json, exclusions.json)
│   ├── telemetry/         ← TelemetryClient (skill telemetry — used internally by pipeline)
│   ├── scheduling/        ← SchedulerManager (openclaw cron wrappers)
│   └── types.ts           ← scan pipeline types (shared with skill pipeline)
├── openclaw.plugin.json
├── package.json
└── tsconfig.json
```

---

## Links

- [clawvitals.io](https://clawvitals.io)
- [Dashboard](https://dashboard.clawvitals.io)
- [Docs](https://clawvitals.io/docs)
- [Controls reference](https://clawvitals.io/docs/controls)
- [ClawHub listing](https://clawhub.com) _(exact URL TBD)_

---

## License

MIT
