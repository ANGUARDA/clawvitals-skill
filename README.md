# ClawVitals

Security health check for self-hosted [OpenClaw](https://openclaw.ai) installations.

Check your OpenClaw security vitals — scans your installation, scores your setup, and shows you exactly what to fix.

🌐 **[clawvitals.io](https://clawvitals.io)**

---

## Repository structure

```
skill/      → ClawHub skill (instruction-based, stateless)
plugin/     → OpenClaw plugin (runtime, persistent) — coming soon
shared/
  controls/ → Control library (shared between skill and plugin)
```

## Skills

Two ClawHub slugs, one source. Both are built from `skill/SKILL.md` — content is identical, only the name differs.

| Slug | Install | Purpose |
|---|---|---|
| `clawvitals` | `npx clawhub install clawvitals` | Primary brand |
| `securityvitals` | `npx clawhub install securityvitals` | Search discoverability ("security vitals") |

Both point to clawvitals.io. One may be deprecated in future.

→ [skill/README.md](skill/README.md) · [clawvitals.io/docs](https://clawvitals.io/docs)

## Publishing

Use the publish script to keep both skills in sync:

```bash
./scripts/publish.sh <version> "<changelog message>"
```

This publishes `clawvitals` and `securityvitals` atomically from the same `skill/` source. Never publish one without the other.

## Plugin

The plugin adds scan history, delta detection, scheduled scans, exclusion management, and telemetry. Coming soon.

```bash
# When available:
openclaw plugins install @anguarda/clawvitals
```

→ [plugin/README.md](plugin/README.md)

## License

MIT — see [skill/LICENSE](skill/LICENSE)
