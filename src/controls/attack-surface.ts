/**
 * controls/attack-surface.ts — AttackSurfaceParser for the summary.attack_surface detail string.
 *
 * Parses the human-readable detail string from the `summary.attack_surface` finding
 * into a structured AttackSurface object. This parser is intentionally defensive:
 * unknown fields are logged but do not cause failure, and individual field parse
 * errors are tracked without aborting the entire parse.
 */

import type { AttackSurface } from '../types';

/**
 * Parse the attack_surface detail string into structured data.
 *
 * Expected format (one field per line, colon-separated):
 * ```
 * groups: open=0, allowlist=2
 * tools.elevated: enabled
 * hooks.webhooks: disabled
 * hooks.internal: enabled
 * browser control: disabled
 * ```
 *
 * @param detail - The raw detail string from the summary.attack_surface finding
 * @returns Structured attack surface data with parse status
 */
export function parseAttackSurface(detail: string): AttackSurface {
  const result: AttackSurface = {
    groups_open: null,
    tools_elevated: null,
    hooks_webhooks: null,
    hooks_internal: null,
    browser_control: null,
    raw: detail,
    parse_ok: true,
    parse_errors: [],
  };

  if (!detail || detail.trim().length === 0) {
    result.parse_ok = false;
    result.parse_errors.push('Empty detail string');
    return result;
  }

  const lines = detail.split('\n');

  if (lines.length === 0) {
    result.parse_ok = false;
    result.parse_errors.push('No line-delimited structure found');
    return result;
  }

  /** Track which known fields we've seen */
  const seen = new Set<string>();

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const colonIdx = trimmed.indexOf(': ');
    if (colonIdx === -1) continue;

    const key = trimmed.substring(0, colonIdx).trim().toLowerCase();
    const value = trimmed.substring(colonIdx + 2).trim().toLowerCase();

    if (key === 'groups') {
      seen.add('groups');
      const match = /open=(\d+)/.exec(value);
      if (match?.[1] !== undefined) {
        result.groups_open = parseInt(match[1], 10);
      } else {
        result.parse_errors.push(`Could not parse groups open count from: "${value}"`);
        result.parse_ok = false;
      }
    } else if (key === 'tools.elevated') {
      seen.add('tools.elevated');
      result.tools_elevated = value === 'enabled';
    } else if (key === 'hooks.webhooks') {
      seen.add('hooks.webhooks');
      result.hooks_webhooks = value === 'enabled';
    } else if (key === 'hooks.internal') {
      seen.add('hooks.internal');
      result.hooks_internal = value === 'enabled';
    } else if (key === 'browser control') {
      seen.add('browser control');
      result.browser_control = value === 'enabled';
    }
    // Unknown fields are silently ignored (not an error)
  }

  return result;
}
