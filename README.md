# ClawVitals

Security health check and recurring posture tracking for [OpenClaw](https://openclaw.ai) installations.

Finds real misconfigurations. Tracks whether your security posture improves or regresses over time. Alerts on new critical findings. Silent when clean.

## Install

```bash
clawhub install clawvitals
```

## Quick start

In your OpenClaw messaging surface (Slack, Signal, etc.):

```
run clawvitals
```

Gets your first security score in under 30 seconds.

## What it checks (v0.1)

| Control | Severity | What |
|---|---|---|
| NC-OC-003 | High | No ineffective deny command entries |
| NC-OC-004 | Critical | No open (unauthenticated) groups |
| NC-OC-008 | Medium | All configured channels healthy |
| NC-AUTH-001 | High | Reverse proxy trust correctly configured |
| NC-VERS-001 | Medium | OpenClaw not behind latest release |
| NC-VERS-002 | Medium | OpenClaw not more than 2 versions behind |

Full control docs: [clawvitals.io/docs](https://clawvitals.io/docs)

## Usage

```
run clawvitals              → manual scan
show clawvitals details     → full report with remediation steps
clawvitals history          → last 10 scan summaries
clawvitals schedule daily   → recurring daily scans (8am)
clawvitals schedule weekly  → weekly (Monday 8am)
clawvitals schedule off     → manual only
clawvitals status           → config + last scan summary
clawvitals telemetry on     → enable posture dashboard at clawvitals.io
```

## Requirements

- OpenClaw 2026.3.0+
- Node.js 20+

## Contributing

Issues and pull requests welcome. See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT — see [LICENSE](LICENSE)

## By Anguarda

Built and maintained by [Anguarda](https://anguarda.com) — AI agent trust infrastructure.

- Website: [clawvitals.io](https://clawvitals.io)
- Docs: [clawvitals.io/docs](https://clawvitals.io/docs)
