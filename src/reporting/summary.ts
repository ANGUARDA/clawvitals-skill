/**
 * reporting/summary.ts — Summary message formatter.
 *
 * Produces a concise (<=400 character) summary message suitable for
 * delivery to messaging surfaces. Includes score, band, critical/high
 * finding count, and delta indicator.
 */

import type { RunReport, DeltaResult } from '../types';
import { SUMMARY_MAX_CHARS, BAND_EMOJI } from '../constants';

/**
 * Format a summary message for delivery to the messaging surface.
 *
 * @param report - The complete run report
 * @param delta - The delta result from comparison with previous scan
 * @param staleExclusions - Whether there are stale exclusions (>90 days)
 * @returns A summary message string (<= 400 chars)
 */
export function formatSummary(
  report: RunReport,
  delta: DeltaResult,
  staleExclusions: boolean
): string {
  const { stable } = report.dock_analysis;
  const scoreDisplay = typeof stable.score === 'number'
    ? `${stable.score}/100`
    : 'N/A';
  const bandEmoji = BAND_EMOJI[stable.band] ?? '';
  const bandDisplay = stable.band.toUpperCase();

  // Count critical/high findings in stable controls
  const critHighCount = stable.findings.filter(
    f => f.result === 'FAIL' && (f.severity === 'critical' || f.severity === 'high')
  ).length;

  // Delta indicator
  let deltaLine: string;
  if (delta.resolved_findings.length > 0 && delta.new_findings.length === 0) {
    deltaLine = '\u{2B06}\u{FE0F} Improved from last scan';
  } else if (delta.new_findings.length > 0 && delta.resolved_findings.length === 0) {
    deltaLine = '\u{2B07}\u{FE0F} Regressed from last scan';
  } else if (delta.new_findings.length > 0 && delta.resolved_findings.length > 0) {
    deltaLine = `\u{2195}\u{FE0F} Mixed: ${delta.new_findings.length} new, ${delta.resolved_findings.length} resolved`;
  } else {
    deltaLine = '\u{27A1}\u{FE0F} No change from last scan';
  }

  let msg = `\u{1F3E5} ClawVitals \u{2014} ${report.meta.host_name}\n`;
  msg += `Score: ${scoreDisplay} ${bandEmoji} ${bandDisplay}\n`;
  msg += `Critical/High findings: ${critHighCount}\n`;
  msg += `${deltaLine}\n`;
  if (staleExclusions) {
    msg += `\u{26A0}\u{FE0F} Review exclusions: some are older than 90 days\n`;
  }
  msg += `Full report: clawvitals details`;

  // Truncate if over limit
  if (msg.length > SUMMARY_MAX_CHARS) {
    msg = msg.substring(0, SUMMARY_MAX_CHARS - 3) + '...';
  }

  return msg;
}
