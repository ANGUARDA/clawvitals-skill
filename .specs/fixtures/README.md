# Dock Fixtures

Real captured output from OpenClaw CLI commands, used as the parser and scoring contract for v0.1 implementation.

**Captured:** 2026-03-18
**OpenClaw version:** 2026.3.13 (61d171a)
**Method:** `openclaw --profile <name>` for isolated config states on the same installation

---

## Fixture Overview

| Fixture | Description | Security Score | Key Findings |
|---|---|---|---|
| `normal/` | Default OpenClaw install as-deployed | ~75 Amber | deny_commands, trusted_proxies, iMessage probe failing |
| `misconfigured/` | groupPolicy=open, no gateway auth | ~60 Red | 4 Critical, 2 Warn |
| `hardened/` | groupPolicy=allowlist, gateway auth set | ~85 Amber | trusted_proxies still warns |

---

## Files Per Fixture

Each fixture directory contains:
- `security-audit.json` — output of `openclaw [--profile X] security audit --json`
- `health.json` — output of `openclaw health --json` (gateway-level, same for all profiles)
- `update-status.json` — output of `openclaw update status --json`
- `version.txt` — output of `openclaw --version`
- `expected-results.json` — what Dock MUST produce from this input (parser + scoring contract)

---

## Key Findings from Fixture Capture

### New checkIds discovered (not in v0.1 control library)

The misconfigured fixture revealed 4 new Critical checkIds that require controls:

| CheckId | Condition | Recommended Control |
|---|---|---|
| `security.exposure.open_groups_with_elevated` | groupPolicy=open + tools.elevated=enabled | Add NC-OC-010 |
| `security.exposure.open_groups_with_runtime_or_fs` | groupPolicy=open + runtime/fs tools exposed | Add NC-OC-011 |
| `gateway.loopback_no_auth` | No gateway auth token on loopback | Add NC-OC-012 |
| `browser.control_no_auth` | Browser control on, no gateway auth | Add NC-OC-013 |

These should be added to the control library in v0.2 of the library (after v0.1 stable controls are validated).

### NC-OC-001 (Webhook signing secret) — needs redesign

`hooks.webhooks` in the attack_surface detail refers to OpenClaw's **internal webhook receiver**, not Slack webhooks. The config key `hooks.webhooks` is not user-configurable via `openclaw config set`. The signing secret check as originally designed (NC-OC-001) cannot be triggered via standard configuration.

**Resolution:** NC-OC-001 remains Experimental and SKIPPED on all current fixtures. Before promoting to Stable, investigate whether OpenClaw's webhook intake has a configurable signing secret and what config path/checkId that would produce.

### NC-AUTH-001 (Reverse proxy trust) — expected FAIL on loopback installs

`gateway.trusted_proxies_missing` fires whenever `gateway.bind=loopback` and `gateway.trustedProxies` is empty. This is expected behaviour for the majority of OpenClaw installs that don't use a reverse proxy. In the hardened fixture, this is the only remaining Warn finding despite the installation being otherwise well-configured.

**Resolution options (for future):**
1. Add an acknowledgement mechanism ("I don't use a reverse proxy, suppress this")
2. Downgrade to Medium or Low severity
3. Add prerequisite: only FAIL if a reverse proxy is actually configured

---

## health.json Notes

`openclaw health --json` connects to the **running gateway process** — it is not profile-isolated. All three fixtures use the same health.json output (captured from the live default install on 2026-03-18). The iMessage `probe.ok=false` finding in NC-OC-008 is real and expected on this installation.

---

## Hardened Profile — Why Amber, Not Green?

Two findings prevent Green:
1. `gateway.trusted_proxies_missing` (NC-AUTH-001) — see note above; expected on loopback-only installs
2. iMessage probe failing (NC-OC-008) — expected on this install where iMessage is not functional

A truly Green score would require: configured trustedProxies OR acknowledgement, AND no broken configured channels.

---

## Additional Fixtures (captured/synthetic, 2026-03-18)

| Fixture | Type | Purpose | Key Controls Tested |
|---|---|---|---|
| `trusted-proxy/` | Real | NC-AUTH-001 PASS state | NC-AUTH-001 PASS when trustedProxies configured |
| `deny-commands-only/` | Real | NC-OC-003 isolated | NC-OC-003 FAIL only finding |
| `update-available/` | Synthetic | NC-VERS-001 FAIL | NC-VERS-001 FAIL, NC-VERS-002 PASS (1 minor behind) |
| `version-behind/` | Synthetic | NC-VERS-002 FAIL | NC-VERS-001+002 FAIL (3 minor behind) |
| `healthy-channels/` | Synthetic | NC-OC-008 PASS | NC-OC-008 PASS (all channels healthy) |

### Additional checkIds discovered

| CheckId | Severity | Condition | Recommended Control |
|---|---|---|---|
| `gateway.token_too_short` | Warn | Auth token below minimum length | NC-OC-014 |

### Complete known checkId inventory (as of 2026-03-18)

| CheckId | Severity | In Library | Control |
|---|---|---|---|
| `summary.attack_surface` | Info | — | Source for derived controls |
| `gateway.trusted_proxies_missing` | Warn | ✅ | NC-AUTH-001 (Stable) |
| `gateway.nodes.deny_commands_ineffective` | Warn | ✅ | NC-OC-003 (Stable) |
| `security.trust_model.multi_user_heuristic` | Warn | ✅ | NC-OC-002 (Experimental) |
| `security.exposure.open_groups_with_elevated` | Critical | ❌ | Add NC-OC-010 in lib v0.2 |
| `security.exposure.open_groups_with_runtime_or_fs` | Critical | ❌ | Add NC-OC-011 in lib v0.2 |
| `gateway.loopback_no_auth` | Critical | ❌ | Add NC-OC-012 in lib v0.2 |
| `browser.control_no_auth` | Critical | ❌ | Add NC-OC-013 in lib v0.2 |
| `gateway.token_too_short` | Warn | ❌ | Add NC-OC-014 in lib v0.2 |
