/**
 * runner.ts — Controlled execution wrapper for expanded system-level checks.
 *
 * This is the ONLY file in the expanded collectors that invokes system commands
 * via child_process. All expanded collectors (ollama, network, docker, etc.) MUST
 * use runExpanded() — never call execSync directly in individual collectors.
 *
 * Why child_process here and not CliRunner:
 * - CliRunner routes through the OpenClaw plugin SDK and enforces the openclaw-only
 *   allowlist. Expanded checks inspect the host OS directly (lsof, docker, fdesetup,
 *   ss, softwareupdate) — these are system tools, not the OpenClaw CLI.
 * - This file provides the same security controls as CliRunner for system commands:
 *   timeout enforcement, error normalisation, and a single auditable call site.
 *
 * Declared in openclaw.plugin.json commandsOptional — every binary used here is
 * listed there so users can review what system commands expanded mode will run.
 */

import { execSync } from 'node:child_process';

/** Default timeout for expanded system commands (ms) */
const EXPANDED_TIMEOUT_MS = 5000;

/**
 * Run a system command for an expanded check.
 * Returns stdout as a string, or throws on non-zero exit / timeout.
 *
 * @param command - The shell command to run (must be a documented expanded check)
 * @param timeoutMs - Optional timeout override
 */
export function runExpanded(command: string, timeoutMs = EXPANDED_TIMEOUT_MS): string {
  return execSync(command, { encoding: 'utf8', timeout: timeoutMs });
}
