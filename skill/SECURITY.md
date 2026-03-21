# Security

## What this skill executes

Five CLI commands only:
- `openclaw security audit --json`
- `openclaw health --json`
- `openclaw --version`
- `openclaw update status --json`
- `node --version`

No other commands are issued. Args are never interpolated into shell strings.

## Network access

None. This skill has no outbound network permissions. No data leaves your machine.

## Local storage

Nothing is stored. This skill is stateless — no config files, no usage files, no history, no identifiers.

## Reporting a vulnerability

Open an issue at [github.com/ANGUARDA/clawvitals](https://github.com/ANGUARDA/clawvitals).
