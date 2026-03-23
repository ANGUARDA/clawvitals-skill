/**
 * scoring/delta.ts — DeltaDetector: new/resolved/new-check distinction.
 *
 * Compares current scan results against a previous run to detect:
 * - New findings: controls that are now FAIL but weren't before
 * - Resolved findings: controls that were FAIL but are now PASS
 * - New checks: controls introduced in a newer library version
 */

import type { RunReport, DeltaResult, ControlEvaluation } from '../types';

/**
 * DeltaDetector computes changes between consecutive scan runs.
 *
 * On first run (previous === null), all current FAILs are treated
 * as new findings since there's no baseline to compare against.
 */
export class DeltaDetector {
  /**
   * Detect changes between current and previous scan results.
   *
   * @param current - The current scan's run report
   * @param previous - The previous scan's run report (null on first run)
   * @returns Delta result with new findings, resolved findings, and new checks
   */
  detect(current: RunReport, previous: RunReport | null): DeltaResult {
    const allCurrentFindings = [
      ...current.dock_analysis.stable.findings,
      ...current.dock_analysis.experimental.findings,
    ];

    // First run: all FAILs are new findings
    if (!previous) {
      return {
        new_findings: allCurrentFindings.filter(e => e.result === 'FAIL'),
        resolved_findings: [],
        new_checks: [],
      };
    }

    const allPreviousFindings = [
      ...previous.dock_analysis.stable.findings,
      ...previous.dock_analysis.experimental.findings,
    ];

    const previousMap = new Map<string, ControlEvaluation>();
    for (const ev of allPreviousFindings) {
      previousMap.set(ev.control_id, ev);
    }

    const newFindings: ControlEvaluation[] = [];
    const resolvedFindings: ControlEvaluation[] = [];
    const newChecks: ControlEvaluation[] = [];

    for (const currentEval of allCurrentFindings) {
      const prevEval = previousMap.get(currentEval.control_id);

      if (!prevEval) {
        if (currentEval.result === 'FAIL') {
          // Distinguish new_check vs new_finding using introduced_in semver
          if (this.semverGreaterThan(currentEval.introduced_in, previous.library_version)) {
            newChecks.push(currentEval);
          } else {
            newFindings.push(currentEval);
          }
        }
        continue;
      }

      // New finding: was not FAIL, now is FAIL
      if (currentEval.result === 'FAIL' && prevEval.result !== 'FAIL') {
        newFindings.push(currentEval);
      }
    }

    // Resolved: was FAIL, now PASS
    for (const prevEval of allPreviousFindings) {
      const currentEval = allCurrentFindings.find(
        e => e.control_id === prevEval.control_id
      );
      if (prevEval.result === 'FAIL' && currentEval?.result === 'PASS') {
        resolvedFindings.push(currentEval);
      }
    }

    return { new_findings: newFindings, resolved_findings: resolvedFindings, new_checks: newChecks };
  }

  /**
   * Compare two semver strings (a > b).
   * Splits on '.', compares each numeric component left-to-right.
   * Strips pre-release suffixes (e.g. "1.2.3-rc1" → 1.2.3) before comparing.
   */
  private semverGreaterThan(a: string, b: string): boolean {
    // M4: Strip pre-release suffixes and use parseInt with fallback to 0
    const parsePart = (part: string): number => {
      const numeric = parseInt(part, 10);
      return isNaN(numeric) ? 0 : numeric;
    };
    // Strip pre-release suffix from the full version string before splitting
    const aParts = a.replace(/-.*$/, '').split('.').map(parsePart);
    const bParts = b.replace(/-.*$/, '').split('.').map(parsePart);
    const len = Math.max(aParts.length, bParts.length);
    for (let i = 0; i < len; i++) {
      const av = aParts[i] ?? 0;
      const bv = bParts[i] ?? 0;
      if (av > bv) return true;
      if (av < bv) return false;
    }
    return false;
  }
}
