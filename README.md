# ClawVitals

Security vitals checker for self-hosted [OpenClaw](https://openclaw.ai) installations.

🌐 **[clawvitals.io](https://clawvitals.io)** · [Docs](https://clawvitals.io/docs) · [Plugin](https://clawvitals.io/plugin)

---

## What this repo contains

This repository contains two distinct products built from the same codebase:

### 1. ClawVitals Skill (`skill/`)

An instruction-based OpenClaw skill — stateless, no runtime code, no permissions beyond running five OpenClaw CLI commands. Published on ClawHub at [clawhub.ai/bk-cm/clawvitals](https://clawhub.ai/bk-cm/clawvitals).

Install: `npx clawhub install clawvitals`

### 2. ClawVitals Plugin (`plugin/`)

A full OpenClaw code plugin — compiled TypeScript, persistent state, scheduled scans, delta detection, telemetry, and optional expanded system-level checks. Published on ClawHub at [clawhub.ai/plugins/claw-security-vitals](https://clawhub.ai/plugins/claw-security-vitals).

Install: `openclaw plugins install clawhub:claw-security-vitals`

The plugin is **not** instruction-only — it contains a compiled codebase (`dist/`) and an `openclaw.plugin.json` manifest. See [plugin/SECURITY.md](plugin/SECURITY.md) for a full audit of what the plugin does, what files it reads, what commands it runs, and what telemetry it sends.

---

## Repository structure

```
skill/      → ClawHub skill (instruction-based, stateless)
plugin/     → ClawHub code plugin (compiled TypeScript, persistent)
shared/
  controls/ → Control library (shared between skill and plugin)
scripts/    → Publishing scripts
```

---

## Publishing

### Skill (two slugs, one source)

Both `clawvitals` and `securityvitals` are built from `skill/SKILL.md`.

```bash
./scripts/publish.sh <version> "<changelog message>"
```

### Plugin

```bash
npx clawhub package publish plugin/ \
  --family code-plugin \
  --name "claw-security-vitals" \
  --display-name "ClawVitals" \
  --version <version>
```

---

## License

MIT — see [skill/LICENSE](skill/LICENSE)
