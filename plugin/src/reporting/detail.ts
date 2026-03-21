/**
 * reporting/detail.ts — Full detail report formatter.
 *
 * Produces a comprehensive human-readable report showing all findings
 * organized by severity, passed controls, experimental observations,
 * delta information, and skipped controls.
 */

import type { RunReport, DeltaResult, ControlEvaluation } from '../types';
import { BAND_EMOJI } from '../constants';

/**
 * Format a full detail report for display or file storage.
 *
 * @param report - The complete run report
 * @param delta - The delta result from comparison with previous scan
 * @returns Full multi-line detail report string
 */
export function formatDetail(report: RunReport, delta: DeltaResult): string {
  const { stable, experimental, skipped } = report.dock_analysis;
  const scoreDisplay = typeof stable.score === 'number'
    ? `${stable.score}/100`
    : 'insufficient data';
  const bandEmoji = BAND_EMOJI[stable.band] ?? '';

  const lines: string[] = [];

  // Header
  lines.push(`\u{1F4CB} ClawVitals Full Report \u{2014} ${report.meta.host_name}`);
  lines.push(`Scan: ${report.meta.scan_ts} | Mode 1 | Library v${report.library_version}`);
  lines.push(`OpenClaw: ${report.meta.openclaw_version ?? 'unknown'}`);
  lines.push(`Score: ${scoreDisplay} ${bandEmoji} ${stable.band.toUpperCase()}`);
  lines.push('');

  // Critical/High findings
  const critHigh = stable.findings.filter(
    f => f.result === 'FAIL' && (f.severity === 'critical' || f.severity === 'high')
  );
  if (critHigh.length > 0) {
    lines.push('\u{1F534} CRITICAL / HIGH FINDINGS:');
    for (const finding of critHigh) {
      formatFinding(lines, finding);
    }
    lines.push('');
  }

  // Medium findings
  const medium = stable.findings.filter(
    f => f.result === 'FAIL' && f.severity === 'medium'
  );
  if (medium.length > 0) {
    lines.push('\u{1F7E1} MEDIUM FINDINGS:');
    for (const finding of medium) {
      formatFinding(lines, finding);
    }
    lines.push('');
  }

  // Low/Info findings
  const lowInfo = stable.findings.filter(
    f => f.result === 'FAIL' && (f.severity === 'low' || f.severity === 'info')
  );
  if (lowInfo.length > 0) {
    lines.push('\u{2139}\u{FE0F} LOW / INFO FINDINGS:');
    for (const finding of lowInfo) {
      formatFinding(lines, finding);
    }
    lines.push('');
  }

  // Passed controls
  const passed = stable.findings.filter(f => f.result === 'PASS');
  if (passed.length > 0) {
    lines.push(`\u{2705} PASSED: ${passed.length} controls`);
    for (const p of passed) {
      lines.push(`  [${p.control_id}] ${p.control_name}`);
    }
    lines.push('');
  }

  // Experimental observations
  if (experimental.findings.length > 0) {
    lines.push('\u{26A1} EXPERIMENTAL OBSERVATIONS (not scored):');
    for (const finding of experimental.findings) {
      if (finding.result === 'FAIL') {
        lines.push(`  [${finding.control_id}] ${finding.control_name} \u{2014} FAIL`);
        lines.push(`    ${finding.evidence}`);
      } else if (finding.result === 'PASS') {
        lines.push(`  [${finding.control_id}] ${finding.control_name} \u{2014} PASS`);
      } else {
        lines.push(`  [${finding.control_id}] ${finding.control_name} \u{2014} ${finding.result}`);
        if (finding.skip_reason) {
          lines.push(`    Reason: ${finding.skip_reason}`);
        }
      }
    }
    lines.push('');
  }

  // Delta
  if (delta.new_findings.length > 0 || delta.resolved_findings.length > 0 || delta.new_checks.length > 0) {
    lines.push('\u{1F4CA} DELTA:');
    if (delta.new_findings.length > 0) {
      lines.push(`  New since last scan: ${delta.new_findings.map(f => f.control_id).join(', ')}`);
    }
    if (delta.resolved_findings.length > 0) {
      lines.push(`  Resolved: ${delta.resolved_findings.map(f => f.control_id).join(', ')}`);
    }
    if (delta.new_checks.length > 0) {
      lines.push(`  New checks: ${delta.new_checks.map(f => f.control_id).join(', ')}`);
    }
    lines.push('');
  }

  // Skipped controls
  if (skipped.length > 0) {
    lines.push(`\u{2139}\u{FE0F} SKIPPED: ${skipped.length} controls`);
    for (const s of skipped) {
      lines.push(`  [${s.control_id}] ${s.control_name} (${s.skip_reason ?? 'not applicable'})`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

/** Format a single finding with evidence, remediation, and docs link */
function formatFinding(lines: string[], finding: ControlEvaluation): void {
  lines.push(`  [${finding.control_id}] ${finding.control_name} \u{2014} ${finding.severity.toUpperCase()}`);
  lines.push(`  Source: ${finding.source} (${finding.source_type})`);
  lines.push(`  Found: ${finding.evidence}`);
  if (finding.remediation) {
    lines.push(`  Fix: ${finding.remediation}`);
  }
}
