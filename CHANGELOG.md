# Changelog

## [Unreleased]

## [0.1.3] — 2026-03-20

### Fixed
- Removed all patterns flagged by ClawHub scanner:
  - `child_process` (dynamic import in `cli-runner.ts`) — replaced with `runPluginCommandWithTimeout` from OpenClaw plugin SDK
  - `process.kill(pid, 0)` (stale lock detection in `orchestrator.ts`) — replaced with `withFileLock` from OpenClaw plugin SDK
- Fixed broken test assertion in `cli-runner.test.ts` (`CliTimeoutError || CliExecError` logic error)
- Added Jest mock for `@openclaw/plugin-sdk` (ESM bundle not loadable in CJS Jest environment)

### Changed
- `openclaw` added as peerDependency (`>=2026.3.0`)
- TypeScript path alias configured for `@openclaw/plugin-sdk`

## [0.1.0] — 2026-03-19

### Added
- Initial release
- 6 scored stable controls: NC-OC-003, NC-OC-004, NC-OC-008, NC-AUTH-001, NC-VERS-001, NC-VERS-002
- 8 experimental controls (reported separately, not scored)
- RAG scoring (Green / Amber / Red) with per-domain breakdown
- Delta detection — new findings vs resolved vs new checks
- Scheduled scans via openclaw cron (daily / weekly / monthly)
- Summary message delivery via OpenClaw messaging surface
- Full detail report on request, run history, exclusion mechanism
- Optional anonymous telemetry (off by default)
- First-run UX with scheduling prompt and telemetry opt-in
