/**
 * collectors/security-audit.ts — Collects and validates `openclaw security audit --json` output.
 *
 * This collector invokes the security audit CLI command and validates the
 * response against a Zod schema to ensure data integrity before downstream
 * processing.
 */

import { z } from 'zod';
import type { CliRunner } from '../cli-runner';
import type { SecurityAuditOutput, SourceResult } from '../types';

/** Zod schema for runtime validation of security audit output */
const SecurityAuditFindingSchema = z.object({
  checkId: z.string(),
  severity: z.enum(['info', 'warn', 'critical']),
  title: z.string(),
  detail: z.string(),
  remediation: z.string().optional(),
});

const SecurityAuditSchema = z.object({
  ts: z.number(),
  summary: z.object({
    critical: z.number(),
    warn: z.number(),
    info: z.number(),
  }),
  findings: z.array(SecurityAuditFindingSchema),
});

/**
 * Collect security audit data from the OpenClaw CLI.
 *
 * @param cli - The CliRunner instance for executing commands
 * @returns A source result wrapping the parsed security audit output
 */
export async function collectSecurityAudit(
  cli: CliRunner
): Promise<SourceResult<SecurityAuditOutput>> {
  try {
    const result = await cli.run(['security', 'audit', '--json']);
    const parsed = JSON.parse(result.stdout) as unknown;
    const validated = SecurityAuditSchema.parse(parsed);
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
          : 'Unknown error during security audit collection';
    return { ok: false, data: null, ts: null, error: message };
  }
}
