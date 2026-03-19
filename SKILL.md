---
name: clawvitals
description: Security health check and recurring posture tracking for OpenClaw. Finds real misconfigurations across authentication, version currency, and platform config. Tracks whether your security posture improves or regresses over time. Alerts on new critical findings. Run "run clawvitals" to get your first score in under 30 seconds.
homepage: https://clawvitals.io
tags: [security, health-check, audit, posture, monitoring, anguarda]
metadata: {"openclaw": {"requires": {}, "minVersion": "2026.3.0"}}
---

# ClawVitals

Security health check and recurring assessment for self-hosted OpenClaw installations.

## Install

```bash
clawhub install clawvitals
```

Or via OpenClaw directly:
```
openclaw skills install clawvitals
```

## What it does

ClawVitals runs your first security scan in under 30 seconds. It checks your OpenClaw installation against a library of security controls, scores it with a RAG band (🟢 Green / 🟡 Amber / 🔴 Red), and tells you exactly what to fix.

On subsequent scans it detects regressions — new critical findings trigger an alert. Clean scans are silent.

## What it checks (v0.1 — 6 scored controls)

| Control | Severity | What it checks |
|---|---|---|
| NC-OC-003 | High | No ineffective deny command entries |
| NC-OC-004 | Critical | No open (unauthenticated) groups |
| NC-OC-008 | Medium | All configured channels healthy |
| NC-AUTH-001 | High | Reverse proxy trust correctly configured |
| NC-VERS-001 | Medium | OpenClaw not behind latest release |
| NC-VERS-002 | Medium | OpenClaw not more than 2 versions behind |

Plus 8 experimental controls (reported separately, not scored).

Full control docs: [clawvitals.io/docs](https://clawvitals.io/docs)

## Usage

```
run clawvitals              → run a manual scan
show clawvitals details     → full report with remediation steps
clawvitals history          → last 10 scan summaries
clawvitals schedule daily   → set up recurring daily scans (8am)
clawvitals schedule weekly  → weekly (Monday 8am)
clawvitals schedule off     → manual only
clawvitals status           → show current config + last scan
clawvitals telemetry on     → enable anonymous posture tracking dashboard
clawvitals config host_name "my-server"  → set a friendly name for this install
```

## How scoring works

- Starts at 100, deductions for each failing control (Critical: -25, High: -10, Medium: -5)
- 🟢 Green: 90–100 (no urgent action)
- 🟡 Amber: 70–89 (review recommended)
- 🔴 Red: 0–69 (immediate action required)

## Recurring scans

On first run, ClawVitals prompts you to set up a schedule. Scheduled scans are **silent** — you only get a message if a new critical or high finding appears since the last scan.

## Optional: track your posture over time

Enable anonymous telemetry to see your score history at [clawvitals.io/dashboard](https://clawvitals.io/dashboard) — free, no account required for basic view. No findings, file paths, hostnames, or secrets are ever shared.

```
clawvitals telemetry on
```

## By Anguarda

ClawVitals is built and maintained by [Anguarda](https://anguarda.com) — AI agent trust infrastructure.

- GitHub: [github.com/ANGUARDA/Portfolio](https://github.com/ANGUARDA/Portfolio)
- Docs: [clawvitals.io/docs](https://clawvitals.io/docs)
- Control library: [clawvitals.io/docs/controls](https://clawvitals.io/docs/controls)
