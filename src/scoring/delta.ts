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

      // New check: control was introduced after the previous library version
      if (!prevEval) {
        if (currentEval.result === 'FAIL') {
          newChecks.push(currentEval);
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
}
