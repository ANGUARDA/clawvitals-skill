/**
 * controls/evaluator.ts — ControlEvaluator: per-control PASS/FAIL/SKIP/ERROR logic.
 *
 * Given collected data and the control library, evaluates every control
 * and returns a ControlEvaluation array. Implements all 6 stable controls
 * with full logic and 8 experimental controls as stubs returning SKIP.
 */

import type {
  Control,
  ControlLibrary,
  ControlEvaluation,
  CollectorResult,
  Exclusion,
  SecurityAuditFinding,
} from '../types';
import { MAX_MINOR_VERSIONS_BEHIND, VERSION_REGEX } from '../constants';

/**
 * ControlEvaluator evaluates each control in the library against collected data.
 *
 * Evaluation order per control:
 * 1. Check if control is applicable (mode == 1 for MVP)
 * 2. Check if excluded → EXCLUDED
 * 3. Check prerequisite → SKIP if not met
 * 4. Check if required source is available → ERROR if not
 * 5. Run check logic → PASS or FAIL
 */
export class ControlEvaluator {
  constructor(
    private readonly library: ControlLibrary,
    private readonly exclusions: Exclusion[]
  ) {}

  /**
   * Evaluate all controls in the library against collected data.
   *
   * @param collected - The combined data from all collectors
   * @returns An evaluation result for every control in the library
   */
  evaluate(collected: CollectorResult): ControlEvaluation[] {
    return this.library.controls.map(control =>
      this.evaluateControl(control, collected)
    );
  }

  /**
   * Evaluate a single control against collected data.
   * Handles the full evaluation pipeline: mode check, exclusion, prerequisite,
   * source availability, and control-specific logic.
   */
  private evaluateControl(
    control: Control,
    collected: CollectorResult
  ): ControlEvaluation {
    const base = this.buildBaseEvaluation(control);

    // Deferred controls are always skipped
    if (control.status === 'deferred') {
      return {
        ...base,
        result: 'SKIP',
        skip_reason: 'Control is deferred — not implementable in Mode 1',
      };
    }

    // Check mode applicability (MVP = mode 1 only)
    if (control.mode > 1) {
      return {
        ...base,
        result: 'SKIP',
        skip_reason: `Control requires Mode ${control.mode} — current mode is 1`,
      };
    }

    // Check exclusions
    const exclusion = this.findActiveExclusion(control.id);
    if (exclusion) {
      return {
        ...base,
        result: 'EXCLUDED',
        exclusion_reason: exclusion.reason,
        exclusion_expires: exclusion.expires ?? null,
      };
    }

    // Experimental controls — return SKIP stub (except for those with implemented logic)
    if (control.status === 'experimental') {
      return this.evaluateExperimental(control, collected, base);
    }

    // Dispatch to control-specific evaluation
    return this.evaluateStable(control, collected, base);
  }

  /**
   * Evaluate a stable control with full check logic.
   */
  private evaluateStable(
    control: Control,
    collected: CollectorResult,
    base: ControlEvaluation
  ): ControlEvaluation {
    switch (control.id) {
      case 'NC-OC-003':
        return this.evalNCOC003(collected, base);
      case 'NC-OC-004':
        return this.evalNCOC004(collected, base);
      case 'NC-OC-008':
        return this.evalNCOC008(collected, base);
      case 'NC-OC-009':
        return this.evalNCOC009(collected, base);
      case 'NC-AUTH-001':
        return this.evalNCAUTH001(collected, base);
      case 'NC-VERS-001':
        return this.evalNCVERS001(collected, base);
      case 'NC-VERS-002':
        return this.evalNCVERS002(collected, base);
      default:
        return {
          ...base,
          result: 'ERROR',
          error_detail: `No evaluation logic implemented for stable control ${control.id}`,
        };
    }
  }

  /**
   * Evaluate experimental controls. Some have real logic, others return SKIP stubs.
   */
  private evaluateExperimental(
    _control: Control,
    _collected: CollectorResult,
    base: ControlEvaluation
  ): ControlEvaluation {
    return {
      ...base,
      result: 'SKIP',
      skip_reason: 'Experimental control — not yet validated for scoring',
    };
  }

  // ── Stable control implementations ──────────────────────────────

  /** NC-OC-003: No ineffective deny command entries */
  private evalNCOC003(
    collected: CollectorResult,
    base: ControlEvaluation
  ): ControlEvaluation {
    if (!collected.security_audit.ok || !collected.security_audit.data) {
      return {
        ...base,
        result: 'ERROR',
        error_detail: `Security audit source unavailable: ${collected.security_audit.error ?? 'unknown error'}`,
      };
    }

    const found = this.hasFinding(
      collected.security_audit.data.findings,
      'gateway.nodes.deny_commands_ineffective'
    );

    return found
      ? { ...base, result: 'FAIL', evidence: 'Ineffective deny command entries detected', remediation: base.remediation }
      : { ...base, result: 'PASS', evidence: 'No ineffective deny command entries', remediation: null };
  }

  /** NC-OC-004: No open (unauthenticated) groups */
  private evalNCOC004(
    collected: CollectorResult,
    base: ControlEvaluation
  ): ControlEvaluation {
    if (!collected.security_audit.ok || !collected.security_audit.data) {
      return {
        ...base,
        result: 'ERROR',
        error_detail: `Security audit source unavailable: ${collected.security_audit.error ?? 'unknown error'}`,
      };
    }

    const findings = collected.security_audit.data.findings;
    const openElevated = this.hasFinding(findings, 'security.exposure.open_groups_with_elevated');
    const openRuntime = this.hasFinding(findings, 'security.exposure.open_groups_with_runtime_or_fs');

    if (openElevated || openRuntime) {
      const checkIds: string[] = [];
      if (openElevated) checkIds.push('security.exposure.open_groups_with_elevated');
      if (openRuntime) checkIds.push('security.exposure.open_groups_with_runtime_or_fs');
      return {
        ...base,
        result: 'FAIL',
        evidence: `Open group exposure detected: ${checkIds.join(', ')}`,
        remediation: base.remediation,
      };
    }

    return {
      ...base,
      result: 'PASS',
      evidence: 'No open unauthenticated groups detected',
      remediation: null,
    };
  }

  /** NC-OC-008: All configured channels healthy */
  private evalNCOC008(
    collected: CollectorResult,
    base: ControlEvaluation
  ): ControlEvaluation {
    if (!collected.health.ok || !collected.health.data) {
      return {
        ...base,
        result: 'ERROR',
        error_detail: `Health source unavailable: ${collected.health.error ?? 'unknown error'}`,
      };
    }

    const channels = collected.health.data.channels;
    const unhealthy: string[] = [];

    for (const [name, channel] of Object.entries(channels)) {
      if (channel.configured && !channel.probe.ok) {
        const errorMsg = channel.probe.error ?? 'probe failed';
        unhealthy.push(`${name}: ${errorMsg}`);
      }
    }

    if (unhealthy.length > 0) {
      return {
        ...base,
        result: 'FAIL',
        evidence: `Unhealthy channels: ${unhealthy.join('; ')}`,
        remediation: base.remediation,
      };
    }

    return {
      ...base,
      result: 'PASS',
      evidence: 'All configured channels are healthy',
      remediation: null,
    };
  }

  /** NC-OC-009: OpenClaw update available (INFO, not scored) */
  private evalNCOC009(
    collected: CollectorResult,
    base: ControlEvaluation
  ): ControlEvaluation {
    if (!collected.update_status.ok || !collected.update_status.data) {
      return {
        ...base,
        result: 'ERROR',
        error_detail: `Update status source unavailable: ${collected.update_status.error ?? 'unknown error'}`,
      };
    }

    const hasUpdate = collected.update_status.data.availability.hasRegistryUpdate;

    if (hasUpdate) {
      const latest = collected.update_status.data.availability.latestVersion
        ?? collected.update_status.data.update.registry.latestVersion;
      return {
        ...base,
        result: 'FAIL',
        evidence: `Update available: latest version is ${latest}`,
        remediation: base.remediation,
      };
    }

    return {
      ...base,
      result: 'PASS',
      evidence: 'OpenClaw is up to date',
      remediation: null,
    };
  }

  /** NC-AUTH-001: Reverse proxy trust correctly configured */
  private evalNCAUTH001(
    collected: CollectorResult,
    base: ControlEvaluation
  ): ControlEvaluation {
    if (!collected.security_audit.ok || !collected.security_audit.data) {
      return {
        ...base,
        result: 'ERROR',
        error_detail: `Security audit source unavailable: ${collected.security_audit.error ?? 'unknown error'}`,
      };
    }

    const found = this.hasFinding(
      collected.security_audit.data.findings,
      'gateway.trusted_proxies_missing'
    );

    return found
      ? { ...base, result: 'FAIL', evidence: 'Trusted proxies not configured', remediation: base.remediation }
      : { ...base, result: 'PASS', evidence: 'Trusted proxies correctly configured', remediation: null };
  }

  /** NC-VERS-001: OpenClaw is behind latest release */
  private evalNCVERS001(
    collected: CollectorResult,
    base: ControlEvaluation
  ): ControlEvaluation {
    if (!collected.update_status.ok || !collected.update_status.data) {
      return {
        ...base,
        result: 'ERROR',
        error_detail: `Update status source unavailable: ${collected.update_status.error ?? 'unknown error'}`,
      };
    }

    const hasUpdate = collected.update_status.data.availability.hasRegistryUpdate;

    if (hasUpdate) {
      const latest = collected.update_status.data.availability.latestVersion
        ?? collected.update_status.data.update.registry.latestVersion;
      return {
        ...base,
        result: 'FAIL',
        evidence: `Behind latest release: ${latest} available`,
        remediation: base.remediation,
      };
    }

    return {
      ...base,
      result: 'PASS',
      evidence: 'Running latest release',
      remediation: null,
    };
  }

  /** NC-VERS-002: OpenClaw not more than 2 minor versions behind */
  private evalNCVERS002(
    collected: CollectorResult,
    base: ControlEvaluation
  ): ControlEvaluation {
    // Prerequisite: version_cmd must be available
    if (!collected.version_cmd.ok || !collected.version_cmd.version) {
      return {
        ...base,
        result: 'SKIP',
        skip_reason: 'Current version not determinable',
      };
    }

    if (!collected.update_status.ok || !collected.update_status.data) {
      return {
        ...base,
        result: 'ERROR',
        error_detail: `Update status source unavailable: ${collected.update_status.error ?? 'unknown error'}`,
      };
    }

    const currentVersion = collected.version_cmd.version;
    const latestVersion = collected.update_status.data.availability.latestVersion
      ?? collected.update_status.data.update.registry.latestVersion;

    const distance = this.computeVersionDistance(currentVersion, latestVersion);
    if (distance === null) {
      return {
        ...base,
        result: 'ERROR',
        error_detail: `Could not parse version strings: current="${currentVersion}", latest="${latestVersion}"`,
      };
    }

    if (distance > MAX_MINOR_VERSIONS_BEHIND) {
      return {
        ...base,
        result: 'FAIL',
        evidence: `${distance} minor versions behind (current: ${currentVersion}, latest: ${latestVersion})`,
        remediation: base.remediation,
      };
    }

    return {
      ...base,
      result: 'PASS',
      evidence: `Within version currency threshold (${distance} minor versions behind)`,
      remediation: null,
    };
  }

  // ── Helper methods ──────────────────────────────────────────────

  /** Build a base evaluation object with defaults for a control */
  private buildBaseEvaluation(control: Control): ControlEvaluation {
    return {
      control_id: control.id,
      control_name: control.name,
      domain: control.domain,
      severity: control.severity,
      status: control.status,
      result: 'ERROR',
      source: control.check.source,
      source_type: control.check.source_type,
      evidence: '',
      remediation: control.remediation,
      exclusion_reason: null,
      exclusion_expires: null,
      error_detail: null,
      skip_reason: null,
      introduced_in: control.introduced_in,
    };
  }

  /** Check if a finding with the given checkId exists in the findings list */
  private hasFinding(findings: SecurityAuditFinding[], checkId: string): boolean {
    return findings.some(f => f.checkId === checkId);
  }

  /** Find an active (non-expired) exclusion for the given control ID */
  private findActiveExclusion(controlId: string): Exclusion | undefined {
    const now = new Date();
    return this.exclusions.find(ex => {
      if (ex.controlId !== controlId) return false;
      if (ex.expires) {
        return new Date(ex.expires) > now;
      }
      return true;
    });
  }

  /**
   * Compute the "minor version" distance between two YYYY.M.D version strings.
   * Uses the year-boundary formula from spec:
   * totalMonthsBehind = (latestYear - currentYear) * 12 + (latestMonth - currentMonth)
   *
   * @returns The distance in months, or null if versions can't be parsed
   */
  private computeVersionDistance(current: string, latest: string): number | null {
    const currentMatch = VERSION_REGEX.exec(current);
    const latestMatch = VERSION_REGEX.exec(latest);

    if (!currentMatch?.[1] || !latestMatch?.[1]) return null;

    const currentParts = currentMatch[1].split('.');
    const latestParts = latestMatch[1].split('.');

    const currentYear = parseInt(currentParts[0] ?? '0', 10);
    const currentMonth = parseInt(currentParts[1] ?? '0', 10);
    const latestYear = parseInt(latestParts[0] ?? '0', 10);
    const latestMonth = parseInt(latestParts[1] ?? '0', 10);

    return (latestYear - currentYear) * 12 + (latestMonth - currentMonth);
  }
}
