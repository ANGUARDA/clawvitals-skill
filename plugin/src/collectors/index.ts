/**
 * collectors/index.ts — CollectorOrchestrator: parallel data collection from all CLI sources.
 *
 * Invokes all 4 CLI data sources in parallel using Promise.allSettled so that
 * one failure never aborts the others. After security_audit completes, the
 * attack_surface detail string is parsed immediately.
 */

import type { CliRunner } from '../cli-runner';
import type { CollectorResult } from '../types';
import { collectSecurityAudit } from './security-audit';
import { collectHealth } from './health';
import { collectUpdateStatus } from './update-status';
import { collectVersion } from './version';
import { parseAttackSurface } from '../controls/attack-surface';

/**
 * CollectorOrchestrator runs all data collection in parallel and assembles
 * a unified CollectorResult. Uses Promise.allSettled to ensure resilience —
 * each source is independent and a failure in one does not affect others.
 */
export class CollectorOrchestrator {
  constructor(private readonly cli: CliRunner) {}

  /**
   * Collect data from all four CLI sources in parallel.
   *
   * @returns Combined results from all sources, including parsed attack surface
   */
  async collect(): Promise<CollectorResult> {
    const [securityResult, healthResult, updateResult, versionResult] =
      await Promise.allSettled([
        collectSecurityAudit(this.cli),
        collectHealth(this.cli),
        collectUpdateStatus(this.cli),
        collectVersion(this.cli),
      ]);

    const security_audit = securityResult.status === 'fulfilled'
      ? securityResult.value
      : { ok: false as const, data: null, ts: null, error: securityResult.reason instanceof Error ? securityResult.reason.message : 'Unknown error' };

    const health = healthResult.status === 'fulfilled'
      ? healthResult.value
      : { ok: false as const, data: null, ts: null, error: healthResult.reason instanceof Error ? healthResult.reason.message : 'Unknown error' };

    const update_status = updateResult.status === 'fulfilled'
      ? updateResult.value
      : { ok: false as const, data: null, ts: null, error: updateResult.reason instanceof Error ? updateResult.reason.message : 'Unknown error' };

    const version_cmd = versionResult.status === 'fulfilled'
      ? versionResult.value
      : { ok: false as const, version: null, error: versionResult.reason instanceof Error ? versionResult.reason.message : 'Unknown error' };

    // Parse attack_surface detail from the security audit findings
    let attack_surface = null;
    if (security_audit.ok && security_audit.data) {
      const attackSurfaceFinding = security_audit.data.findings.find(
        f => f.checkId === 'summary.attack_surface'
      );
      if (attackSurfaceFinding) {
        attack_surface = parseAttackSurface(attackSurfaceFinding.detail);
      }
    }

    return {
      security_audit,
      health,
      update_status,
      version_cmd,
      attack_surface,
    };
  }
}
