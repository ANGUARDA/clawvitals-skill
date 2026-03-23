/**
 * attack-surface.test.ts — Tests for parseAttackSurface.
 */
import { parseAttackSurface } from '../../src/controls/attack-surface';

describe('parseAttackSurface', () => {
  describe('valid input', () => {
    it('parses a complete detail string', () => {
      const detail = [
        'groups: open=0, allowlist=2',
        'tools.elevated: enabled',
        'hooks.webhooks: disabled',
        'hooks.internal: enabled',
        'browser control: disabled',
      ].join('\n');

      const result = parseAttackSurface(detail);
      expect(result.parse_ok).toBe(true);
      expect(result.parse_errors).toHaveLength(0);
      expect(result.groups_open).toBe(0);
      expect(result.tools_elevated).toBe(true);
      expect(result.hooks_webhooks).toBe(false);
      expect(result.hooks_internal).toBe(true);
      expect(result.browser_control).toBe(false);
      expect(result.raw).toBe(detail);
    });

    it('parses groups with nonzero open count', () => {
      const detail = 'groups: open=5, allowlist=3';
      const result = parseAttackSurface(detail);
      expect(result.groups_open).toBe(5);
    });

    it('parses all fields disabled', () => {
      const detail = [
        'groups: open=0',
        'tools.elevated: disabled',
        'hooks.webhooks: disabled',
        'hooks.internal: disabled',
        'browser control: disabled',
      ].join('\n');

      const result = parseAttackSurface(detail);
      expect(result.parse_ok).toBe(true);
      expect(result.tools_elevated).toBe(false);
      expect(result.hooks_webhooks).toBe(false);
      expect(result.hooks_internal).toBe(false);
      expect(result.browser_control).toBe(false);
    });

    it('parses all fields enabled', () => {
      const detail = [
        'groups: open=3',
        'tools.elevated: enabled',
        'hooks.webhooks: enabled',
        'hooks.internal: enabled',
        'browser control: enabled',
      ].join('\n');

      const result = parseAttackSurface(detail);
      expect(result.parse_ok).toBe(true);
      expect(result.tools_elevated).toBe(true);
      expect(result.hooks_webhooks).toBe(true);
      expect(result.hooks_internal).toBe(true);
      expect(result.browser_control).toBe(true);
    });

    it('ignores unknown fields silently', () => {
      const detail = [
        'groups: open=1',
        'some.unknown: value',
        'tools.elevated: enabled',
      ].join('\n');

      const result = parseAttackSurface(detail);
      expect(result.parse_ok).toBe(true);
      expect(result.parse_errors).toHaveLength(0);
      expect(result.groups_open).toBe(1);
      expect(result.tools_elevated).toBe(true);
    });

    it('handles blank lines between fields', () => {
      const detail = [
        'groups: open=2',
        '',
        'tools.elevated: disabled',
        '',
      ].join('\n');

      const result = parseAttackSurface(detail);
      expect(result.parse_ok).toBe(true);
      expect(result.groups_open).toBe(2);
      expect(result.tools_elevated).toBe(false);
    });

    it('is case-insensitive for keys and values', () => {
      const detail = [
        'Groups: open=7',
        'Tools.Elevated: Enabled',
        'Browser Control: Disabled',
      ].join('\n');

      const result = parseAttackSurface(detail);
      expect(result.groups_open).toBe(7);
      expect(result.tools_elevated).toBe(true);
      expect(result.browser_control).toBe(false);
    });

    it('leaves unparsed fields as null', () => {
      const detail = 'groups: open=1';
      const result = parseAttackSurface(detail);
      expect(result.parse_ok).toBe(true);
      expect(result.groups_open).toBe(1);
      expect(result.tools_elevated).toBeNull();
      expect(result.hooks_webhooks).toBeNull();
      expect(result.hooks_internal).toBeNull();
      expect(result.browser_control).toBeNull();
    });
  });

  describe('invalid input', () => {
    it('returns parse_ok=false for empty string', () => {
      const result = parseAttackSurface('');
      expect(result.parse_ok).toBe(false);
      expect(result.parse_errors).toContain('Empty detail string');
    });

    it('returns parse_ok=false for whitespace-only string', () => {
      const result = parseAttackSurface('   ');
      expect(result.parse_ok).toBe(false);
      expect(result.parse_errors).toContain('Empty detail string');
    });

    it('records error when groups open count is unparseable', () => {
      const detail = 'groups: no-number-here';
      const result = parseAttackSurface(detail);
      expect(result.parse_ok).toBe(false);
      expect(result.parse_errors.length).toBeGreaterThan(0);
      expect(result.groups_open).toBeNull();
    });

    it('ignores lines without colon-space separator', () => {
      const detail = 'this line has no colon space';
      const result = parseAttackSurface(detail);
      expect(result.parse_ok).toBe(true);
      expect(result.groups_open).toBeNull();
    });

    it('preserves raw detail in all cases', () => {
      const detail = 'garbage input!!!';
      const result = parseAttackSurface(detail);
      expect(result.raw).toBe(detail);
    });
  });
});
