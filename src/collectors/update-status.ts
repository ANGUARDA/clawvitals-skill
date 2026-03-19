/**
 * collectors/update-status.ts — Collects and validates `openclaw update status --json` output.
 *
 * This collector gathers version currency information used by NC-VERS-001,
 * NC-VERS-002, and NC-OC-009 to evaluate whether the installation is
 * up to date.
 */

import { z } from 'zod';
import type { CliRunner } from '../cli-runner';
import type { UpdateStatusOutput, SourceResult } from '../types';

/** Zod schema for runtime validation of update status output */
const UpdateStatusSchema = z.object({
  update: z.object({
    root: z.string(),
    installKind: z.string(),
    packageManager: z.string(),
    registry: z.object({
      latestVersion: z.string(),
    }).passthrough(),
    deps: z.object({
      status: z.string(),
      reason: z.string().optional(),
    }).passthrough(),
  }).passthrough(),
  availability: z.object({
    available: z.boolean(),
    hasRegistryUpdate: z.boolean(),
    latestVersion: z.string().nullable().optional(),
  }).passthrough(),
  channel: z.object({
    value: z.string(),
  }).passthrough(),
}).passthrough();

/**
 * Collect update status data from the OpenClaw CLI.
 *
 * @param cli - The CliRunner instance for executing commands
 * @returns A source result wrapping the parsed update status output
 */
export async function collectUpdateStatus(
  cli: CliRunner
): Promise<SourceResult<UpdateStatusOutput>> {
  try {
    const result = await cli.run(['update', 'status', '--json']);
    const parsed = JSON.parse(result.stdout) as unknown;
    const validated = UpdateStatusSchema.parse(parsed) as UpdateStatusOutput;
    return {
      ok: true,
      data: validated,
      ts: Date.now(),
      error: null,
    };
  } catch (err) {
    const message = err instanceof z.ZodError
      ? `Schema mismatch: ${err.errors.map(e => `${e.path.join('.')}: ${e.message}`).join('; ')}`
      : err instanceof SyntaxError
        ? `JSON parse error: ${err.message}`
        : err instanceof Error
          ? err.message
          : 'Unknown error during update status collection';
    return { ok: false, data: null, ts: null, error: message };
  }
}
