# ClawVitals Plugin

Extends the [ClawVitals skill](https://clawhub.com/skills/clawvitals) with recurring scans, posture history, and fleet management on [clawvitals.io/dashboard](https://clawvitals.io/dashboard).

## Skill vs Plugin

The **ClawVitals skill** (on ClawHub) is stateless — it runs a point-in-time scan, prints the result, and stores nothing. No telemetry, no network calls, no persistent state. It is locked and will not change.

The **plugin** is the upgrade path. It adds everything the skill deliberately omits:

| Feature | Skill | Plugin |
|---|---|---|
| Point-in-time scans | ✅ | ✅ |
| Scan history & delta | ❌ | ✅ |
| Recurring scheduled scans | ❌ | ✅ |
| Regression + critical alerts | ❌ | ✅ |
| Posture trend on dashboard | ❌ | ✅ |
| Fleet management (alias) | ❌ | ✅ |
| Telemetry | none | **on by default (opt-out)** |

## Telemetry

The plugin defaults telemetry **on**. This is intentional: the plugin exists to power [clawvitals.io/dashboard](https://clawvitals.io/dashboard) — without telemetry, the dashboard has no data.

**What is sent (nothing else):**
- Plugin version, control library version
- Numeric score + band (green/amber/red)
- FAIL count, PASS count
- Total lifetime scan count (integer)
- Scheduled/manual flag
- Random install UUID generated at plugin install time (no PII)
- **Alias** — only if you explicitly set one (see Fleet Management below)

**What is never sent:**
- Hostnames, usernames, IP addresses, or file paths
- Finding details, control IDs, or failure reasons
- OpenClaw config, tokens, credentials, or secrets
- Any machine-derived identifier

**Opt out at any time:**
```
openclaw plugins config clawvitals set telemetry.enabled false
```

## Fleet Management

Give each installation a human-readable name for the dashboard:

```
set clawvitals alias prod-server-1
set clawvitals alias dev-laptop
```

The alias is **always user-set** — never derived from the machine hostname, username, or any other identifier. The dashboard shows it alongside the install UUID:

```
prod-server-1   (iid: a3f2...)   85/100  🟢  last scan: 2h ago
dev-laptop      (iid: 7c1b...)   70/100  🟡  last scan: 1d ago
<unnamed>       (iid: 9e4d...)   45/100  🔴  last scan: 3d ago
```

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

## Agent commands

```
set clawvitals alias <name>    — set fleet display name for this installation
show clawvitals identity       — show install ID, alias, and dashboard link
clawvitals telemetry on|off    — enable or disable telemetry
clawvitals schedule            — show/set recurring scan schedule
clawvitals status              — current plugin config and state
clawvitals trial               — check Pro trial status
upgrade clawvitals             — initiate Pro upgrade (Stripe checkout)
```

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
