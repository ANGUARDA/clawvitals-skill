/**
 * collectors/health.ts — Collects and validates `openclaw health --json` output.
 *
 * This collector invokes the health check CLI command which connects to
 * the running gateway process. The output includes per-channel probe
 * results used by NC-OC-008 to evaluate channel health.
 */

import { z } from 'zod';
import type { CliRunner } from '../cli-runner';
import type { HealthOutput, SourceResult } from '../types';

/** Zod schema for runtime validation of health output */
const HealthChannelSchema = z.object({
  configured: z.boolean(),
  running: z.boolean(),
  probe: z.object({
    ok: z.boolean(),
    error: z.string().optional(),
  }).passthrough(),
}).passthrough();

const HealthSchema = z.object({
  ok: z.boolean(),
  ts: z.number(),
  durationMs: z.number(),
  channels: z.record(z.string(), HealthChannelSchema),
  agents: z.array(z.object({
    agentId: z.string(),
    isDefault: z.boolean(),
  }).passthrough()),
  heartbeatSeconds: z.number(),
}).passthrough();

/**
 * Collect gateway health data from the OpenClaw CLI.
 *
 * @param cli - The CliRunner instance for executing commands
 * @returns A source result wrapping the parsed health output
 */
export async function collectHealth(
  cli: CliRunner
): Promise<SourceResult<HealthOutput>> {
  try {
    const result = await cli.run(['health', '--json']);
    const parsed = JSON.parse(result.stdout) as unknown;
    const validated = HealthSchema.parse(parsed) as unknown as HealthOutput;
    return {
      ok: true,
      data: validated,
      ts: validated.ts,
      error: null,
    };
  } catch (err) {
    const message = err instanceof z.ZodError
      ? `Schema mismatch: ${err.errors.map(e => `${e.path.join('.')}: ${e.message}`).join('; ')}`
      : err instanceof SyntaxError
        ? `JSON parse error: ${err.message}`
        : err instanceof Error
          ? err.message
          : 'Unknown error during health collection';
    return { ok: false, data: null, ts: null, error: message };
  }
}
