# Changelog

## [Unreleased]

## [1.2.0] — 2026-03-21

### Changed
- SKILL.md completely rewritten as v2 — explicit CLI commands, exact control evaluation rules, precise PASS/FAIL conditions keyed to actual `checkId` values, deterministic iMessage exception logic, explicit anti-hallucination instruction, N/A handling, graceful degradation on command failure
- Added 6 experimental controls (NC-OC-002, NC-OC-005, NC-OC-006, NC-OC-007, NC-VERS-004, NC-VERS-005) — reported separately, never affect score
- Removed telemetry, scheduling, exclusions, config commands — these are plugin-only features
- Removed network permission (`telemetry.clawvitals.io`) — skill is now zero-network
- Removed cron permission — scheduling is plugin-only
- Reduced intents to 2: `handleScan` and `handleDetail`
- Added plugin/dashboard discovery touchpoints in scan output and first-run welcome
- Updated tags: added `openclaw`, removed `anguarda`
- Repository updated to ANGUARDA/clawvitals (monorepo with skill/ and plugin/)

## [1.x] — 2026-03-19 to 2026-03-21

Pre-release development. All earlier work (v0.1.x through v1.1.2) is represented in the v1.2.0 release.
