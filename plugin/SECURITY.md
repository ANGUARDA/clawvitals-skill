# Security

This document describes the security behaviour of the ClawVitals Plugin for users and for ClawHub's automated security review.

---

## Network activity

The plugin sends a single anonymous HTTP GET ping to `telemetry.clawvitals.io/ping` after each scan, if telemetry is enabled (default: on).

**What is sent (full list — nothing else):**

| Field | Description |
|---|---|
| `v` | Plugin version (e.g. `"0.1.0"`) |
| `lv` | Control library version (e.g. `"0.1.0"`) |
| `s` | Numeric score 0–100 |
| `b` | Score band (`"green"` / `"amber"` / `"red"`) |
| `sf` | Count of FAIL findings |
| `sp` | Count of PASS findings |
| `tr` | Total lifetime scan count for this install (integer) |
| `sc` | `1` if scheduled scan, `0` if manual |
| `iid` | Random UUID generated at plugin install time — no PII, no machine derivation |
| `alias` | User-set display name — **only if explicitly configured by the user** |

**What is never sent:**
- Hostnames, usernames, IP addresses, or file paths
- Finding details, control IDs, or failure reasons
- OpenClaw config, gateway tokens, credentials, or secrets
- Any machine-derived identifier (the `iid` is purely random, generated at install time)

**To disable telemetry at any time:**
```
clawvitals telemetry off
```

Or via config:
```json
{
  "telemetry": { "enabled": false }
}
```

The telemetry endpoint URL is configurable (`telemetry.endpoint` in plugin config) and can be pointed at a self-hosted instance.

---

## Filesystem access

The plugin reads and writes **only** within `~/.openclaw/workspace/clawvitals/`:

| Path | Access | Purpose |
|---|---|---|
| `~/.openclaw/workspace/clawvitals/config.json` | Read/Write | Plugin configuration |
| `~/.openclaw/workspace/clawvitals/state.json` | Read/Write | Install state, UUID, scan count |
| `~/.openclaw/workspace/clawvitals/runs/{timestamp}/` | Write | Local scan history (JSON + text reports) |
| `~/.openclaw/workspace/clawvitals/exclusions.json` | Read/Write | User-defined control exclusions |

**Expanded mode only** (`run clawvitals --expanded`):
- Reads `~/.env`, `~/.bashrc`, `~/.zshrc`, `~/.bash_history`, `~/.zsh_history` for secret pattern scanning — read-only, never written or transmitted
- Reads `~/.cloudflared/config.yml` for tunnel authentication check — read-only

No files are read outside these paths. No file contents are ever sent via telemetry or any other channel.

---

## CLI invocations

The plugin invokes the following commands during a standard scan. No other shell commands are executed.

**Standard mode:**
- `openclaw security audit --json`
- `openclaw health --json`
- `openclaw update status --json`
- `openclaw --version`
- `openclaw cron list` / `openclaw cron add` / `openclaw cron edit` (scheduling only)

**Expanded mode only** (`--expanded`):
- `curl -s --max-time 5 http://localhost:11434/api/tags` (checks if Ollama is running)
- `lsof -i :11434` (checks if port 11434 is externally bound)
- `docker ps --format json` + `docker inspect` (if Docker is available)
- `fdesetup status` (macOS) or `lsblk -f` (Linux) for disk encryption check
- `softwareupdate --list` (macOS) or `apt-get --simulate upgrade` (Linux) for OS update check
- `ss -tlnp` or `netstat -tlnp` for open port enumeration

All commands are read-only. No system configuration is modified.

---

## Autonomous actions

The plugin runs OpenClaw cron commands (`openclaw cron add/edit`) autonomously when a schedule is configured. These commands only affect the OpenClaw cron schedule — they do not modify system configuration, install software, or change files outside the workspace.

Autonomous scan execution (scheduled scans) can be disabled by setting schedule to manual:
```
clawvitals set schedule none
```

---

## Credentials and secrets

The plugin does not store, transmit, or log credentials. The install UUID (`iid`) in `state.json` is a randomly generated value with no relationship to any user, machine, or account identifier.

If you have concerns about a specific file or behaviour, please open an issue at [github.com/ANGUARDA/clawvitals](https://github.com/ANGUARDA/clawvitals) or email security@anguarda.com.
