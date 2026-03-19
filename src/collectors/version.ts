/**
 * collectors/version.ts — Collects the current OpenClaw version via `openclaw --version`.
 *
 * The version string is required by NC-VERS-002 to compute version distance.
 * Output format is "OpenClaw YYYY.M.D (hash)" — we extract just the version number.
 */

import type { CliRunner } from '../cli-runner';
import type { VersionResult } from '../types';
import { VERSION_REGEX } from '../constants';

/**
 * Collect the current OpenClaw version from the CLI.
 *
 * @param cli - The CliRunner instance for executing commands
 * @returns A version result with the parsed version string
 */
export async function collectVersion(
  cli: CliRunner
): Promise<VersionResult> {
  try {
    const result = await cli.run(['--version']);
    const match = VERSION_REGEX.exec(result.stdout.trim());
    if (!match?.[1]) {
      return {
        ok: false,
        version: null,
        error: `Could not parse version from output: "${result.stdout.trim()}"`,
      };
    }
    return { ok: true, version: match[1], error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error during version collection';
    return { ok: false, version: null, error: message };
  }
}
