# ClawVitals Plugin

Security vitals checker for self-hosted [OpenClaw](https://openclaw.ai) installations. Recurring security checks, scan history, delta detection, and regression-aware alerting.

> This is the **plugin** — the stateful, scheduled, telemetry-enabled upgrade from the [ClawVitals Skill](https://clawhub.ai/bk-cm/clawvitals).

---

## Contents

- [Skill vs Plugin](#skill-vs-plugin)
- [Install](#install)
- [Uninstall](#uninstall)
- [Commands](#commands)
- [Agent tools](#agent-tools)
- [Standard vs Expanded controls](#standard-vs-expanded-controls)
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
| Scan history on dashboard (coming soon) | ❌ | ✅ |
| Fleet management (alias) | ❌ | ✅ |
| Telemetry | none | **on by default (opt-out)** |

---

## Install

ClawVitals Plugin is published on [ClawHub](https://clawhub.ai/plugins/claw-security-vitals).

```bash
openclaw plugins install clawhub:claw-security-vitals
```

After installing, run your first scan:

```
run clawvitals
```

---

## Uninstall

```bash
openclaw plugins uninstall claw-security-vitals
```

After uninstalling, `run clawvitals` will fall back to the skill if it is still installed, or return a "not found" error if neither is installed.

> **Note:** Uninstalling does not delete your scan history. Run files are stored at `{workspace}/clawvitals/runs/` and are retained according to your configured retention policy (default: 90 days). To remove all data, delete this directory manually.

---

## Commands

These are chat commands you type directly in your OpenClaw messaging surface:

| Command | Description |
|---|---|
| `run clawvitals` | Run a full security scan (standard controls) |
| `run clawvitals --expanded` | Run scan with expanded system-level controls (see [expanded controls](#standard-vs-expanded-controls)) |
| `run clawvitals --standard` | Run scan with standard controls only (explicit) |
| `show clawvitals details` | Full report with all findings and remediation steps |
| `clawvitals status` | Show last scan time, score, schedule, and trial/plan status |
| `clawvitals help` | Show command reference |

---

## Agent tools

The following tools are invoked by the agent (not typed as chat commands). You can trigger them via natural language — for example, say "set clawvitals schedule to daily" and the agent will call the appropriate tool.

| Tool | Description |
|---|---|
| `clawvitals_set_alias` | Set a friendly name for this host in reports and dashboard |
| `clawvitals_show_identity` | Show install UUID, alias, and dashboard link |
| `clawvitals_telemetry` | Enable or disable telemetry |
| `clawvitals_set_schedule` | Configure recurring scan cadence |
| `clawvitals_status` | Show current status |
| `clawvitals_trial_status` | Show trial status and upgrade options |
| `clawvitals_upgrade` | Upgrade to a paid plan |
| `clawvitals_configure_webhook` | Set up a webhook for alert delivery |
| `clawvitals_exclude` | Suppress a finding with a reason |
| `clawvitals_list_exclusions` | List all active exclusions |
| `clawvitals_remove_exclusion` | Remove an exclusion |
| `clawvitals_get_report` | Retrieve a scan report |
| `clawvitals_approve_cognitive_file` | Approve a cognitive file |

---

## Standard vs Expanded controls

By default the plugin runs in **standard mode** — the same OpenClaw-native control set as the skill, plus scan history, delta detection, and alerting. Standard mode uses only the OpenClaw CLI (`openclaw security audit`, `openclaw health`, etc.) and requires no additional permissions.

**Expanded mode** adds a second layer of system-level checks that require direct filesystem and shell access. These are the checks the skill can never do.

### Switch to expanded mode

```
run clawvitals --expanded         # one-off expanded scan
run clawvitals --standard         # one-off standard scan (explicit default)
```

Or set it as your default via `openclaw.plugin.json`:
```json
{
  "controls": { "mode": "expanded" }
}
```

### What expanded mode adds

| ID | Control | Severity | What it checks |
|---|---|---|---|
| **NC-OLLAMA-001** | Ollama not externally accessible | 🔴 Critical | Checks whether Ollama is running and if port 11434 is bound to a public interface. 175,000+ exposed Ollama instances found in 2026 — active "LLMjacking" attacks target this. |
| **NC-NET-001** | Management interfaces not internet-exposed | 🔴 Critical | Scans open ports for SSH (22), Docker API (2375/2376), and common admin dashboards (8080, 9000) and checks whether they're reachable beyond localhost. |
| **NC-SECRET-001** | No secrets in env/config files | 🔴 Critical | Regex-scans `~/.env`, `.envrc`, and common config files for API key patterns. The most common cause of credential compromise. |
| **NC-SECRET-002** | No API keys in shell history | 🟠 High | Scans `~/.zsh_history` and `~/.bash_history` for secret patterns (API keys, tokens, passwords passed as arguments). Commonly overlooked. |
| **NC-TUNNEL-001** | Cloudflare tunnel endpoints authenticated | 🟠 High | Checks `~/.cloudflared/` config to confirm tunnel-exposed services require authentication. Unauthenticated tunnels are an open door. |
| **NC-DOCKER-001** | Containers not running as root or privileged | 🟠 High | Runs `docker inspect` on running containers to check for `--privileged`, root user, or dangerous capability grants. Aligns with CIS Docker Benchmark. |
| **NC-OS-001** | OS auto-updates enabled | 🟠 High | Checks that automatic OS updates are enabled (`softwareupdate` on macOS, `unattended-upgrades` on Linux). Often neglected on self-hosted machines. |
| **NC-OS-002** | Disk encryption enabled | 🟠 High | Checks FileVault status (macOS) or LUKS encryption (Linux). Critical for Mac Mini and home server deployments where physical access is a real risk. |

All expanded checks are **read-only** — nothing is modified. See [SECURITY.md](./SECURITY.md) for the full list of commands and file paths accessed.

### Expanded mode output

When expanded mode runs, the report clearly labels the section:

```
ClawVitals Plugin v1.0.1 🔌  ·  Expanded Scan

━━━ STANDARD CONTROLS ━━━━━━━━━━━━━━━━━━━━━
[standard control results — see example output below]

━━━ EXPANDED CONTROLS ━━━━━━━━━━━━━━━━━━━━━

🔴 CRITICAL  NC-OLLAMA-001  Ollama externally accessible
Evidence: Port 11434 bound to 0.0.0.0 — accessible from outside localhost
Fix: Set OLLAMA_HOST=127.0.0.1 in your Ollama environment and restart:
     launchctl setenv OLLAMA_HOST "127.0.0.1"   # macOS
     systemctl edit ollama                        # Linux (add Environment=OLLAMA_HOST=127.0.0.1)
→ https://clawvitals.io/docs/NC-OLLAMA-001

🟠 HIGH  NC-SECRET-002  API key pattern found in shell history
Evidence: Pattern matching sk-... found in ~/.zsh_history (line ~342)
Fix: Run `history -c` to clear in-memory history, then manually edit ~/.zsh_history
     to remove the line. Rotate the exposed key immediately.
→ https://clawvitals.io/docs/NC-SECRET-002

✅ NC-NET-001    No management interfaces exposed
✅ NC-SECRET-001  No secrets found in env/config files
✅ NC-TUNNEL-001  Cloudflare tunnel endpoints authenticated
✅ NC-DOCKER-001  Containers not privileged
✅ NC-OS-001     Auto-updates enabled
✅ NC-OS-002     Disk encryption enabled (FileVault ON)

Expanded score: 2 new findings  ·  6 passed
```

---

## Example output

### Summary message (after `run clawvitals`)

```
ClawVitals Plugin v1.0.1 🔌

🔴 Security Score: 58 / 100  ·  RED
Host: mac-mini-home  ·  Scanned: 2026-04-15 15:38 BST

Findings: 2 Critical  ·  1 High  ·  1 Medium
Delta: ▲ 1 new finding since last scan (2026-04-08)

─────────────────────────────────────────
CRITICAL  NC-OC-012  Gateway auth disabled
CRITICAL  NC-OC-003  Command policy: deny-only mode
HIGH      NC-VERS-001  OpenClaw update available (2026.3.13 → 2026.4.1)
MEDIUM    NC-OC-008  Channel health degraded

▶ Reply "show clawvitals details" for full report with remediation steps.
📈 Track your scans → https://clawvitals.io/dashboard
```

### Full details (after `show clawvitals details`)

```
ClawVitals Plugin v1.0.1 🔌  ·  Full Report
Host: mac-mini-home  ·  Control Library v1.0.1  ·  OpenClaw 2026.3.13

━━━ CRITICAL ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

[NC-OC-012] Gateway auth disabled
Severity: Critical  ·  Source: security_audit (authoritative)
Evidence: groups[0].auth.type = "none"
Fix: openclaw gateway auth set --type bearer --token <your-token>
Docs: https://clawvitals.io/docs/NC-OC-012

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

### `clawvitals status` output

```
ClawVitals Plugin v1.0.1 🔌

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
⚠️ ClawVitals Plugin v1.0.1 🔌 — Regression Detected

Host: mac-mini-home  ·  Scanned: 2026-04-15 08:00 BST
Score: 58 → 51  🔴 RED  (▼ 7 points)

1 new Critical finding, 1 new High finding.

─────────────────────────────────────────
🔴 CRITICAL  NC-OC-012  Gateway auth disabled
Evidence: groups[0].auth.type = "none"
Fix: openclaw gateway auth set --type bearer --token <your-token>
→ https://clawvitals.io/docs/NC-OC-012

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
- To route alerts to a webhook instead (or in addition), use the `clawvitals_configure_webhook` agent tool.

### Delivery channels

| Channel | Configured by |
|---|---|
| OpenClaw messaging surface (default) | Automatic |
| Webhook (Slack, Discord, Teams, etc.) | `clawvitals_configure_webhook` agent tool |
| Email digest | Phase 2 (not yet available) |

---

## Scheduling

Configure the scan schedule via the `clawvitals_set_schedule` agent tool, or say something like "set clawvitals schedule to daily" in natural language. The default cron schedule is 9 AM daily.

Available cadences: daily, weekly, monthly, or none (manual only).

---

## Fleet Management

Give each installation a human-readable alias for the dashboard using the `clawvitals_set_alias` agent tool. For example, say:

```
set alias for clawvitals to prod-server-1
set alias for clawvitals to dev-laptop
```

The alias is **always user-set** — never derived from the machine hostname, username, or any system identifier. Each installation also has a random UUID generated at install time (`iid`). The dashboard shows both:

```
prod-server-1   (iid: a3f2...)   85/100  🟢  last scan: 2h ago
dev-laptop      (iid: 7c1b...)   70/100  🟡  last scan: 1d ago
<unnamed>       (iid: 9e4d...)   45/100  🔴  last scan: 3d ago
```

To view your current install identity, use the `clawvitals_show_identity` agent tool.

Output:

```
ClawVitals Plugin v1.0.1 🔌

Install ID (iid): a3f2c8e1-...
Alias:            prod-server-1
Dashboard:        https://clawvitals.io/dashboard
```

---

## Exclusion management

Suppress findings that are intentional or not applicable to your setup using the `clawvitals_exclude` agent tool. For example:

```
exclude NC-OC-005 from clawvitals because "personal assistant setup"
exclude NC-AUTH-001 from clawvitals because "no reverse proxy, local-only" expires 2026-09-01
```

To list exclusions, use the `clawvitals_list_exclusions` agent tool. To remove one, use `clawvitals_remove_exclusion`.

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

**Opt out at any time** using the `clawvitals_telemetry` agent tool, or say "turn off clawvitals telemetry".

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
        controls: {
          mode: "standard"        // "standard" (default) or "expanded" (adds system-level checks)
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
- [Dashboard](https://clawvitals.io/dashboard)
- [Docs](https://clawvitals.io/docs)
- [Controls reference](https://clawvitals.io/docs/controls)
- [ClawHub plugin listing](https://clawhub.ai/plugins/claw-security-vitals)
- [GitHub](https://github.com/ANGUARDA/clawvitals)

---

## License

MIT
