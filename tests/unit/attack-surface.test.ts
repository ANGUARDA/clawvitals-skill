/**
 * Unit tests for the AttackSurfaceParser.
 *
 * Validates parsing of the summary.attack_surface detail string into
 * structured data, including edge cases for missing fields, garbage
 * input, and partial parse failures.
 */

import { parseAttackSurface } from '../../src/controls/attack-surface';

describe('AttackSurfaceParser', () => {
  describe('parseAttackSurface', () => {
    it('should parse a complete, well-formed attack surface detail string', () => {
      const detail = [
        'groups: open=0, allowlist=2',
        'tools.elevated: enabled',
        'hooks.webhooks: disabled',
        'hooks.internal: enabled',
        'browser control: enabled',
      ].join('\n');

      const result = parseAttackSurface(detail);

      expect(result.groups_open).toBe(0);
      expect(result.tools_elevated).toBe(true);
      expect(result.hooks_webhooks).toBe(false);
      expect(result.hooks_internal).toBe(true);
      expect(result.browser_control).toBe(true);
      expect(result.parse_ok).toBe(true);
      expect(result.parse_errors).toHaveLength(0);
      expect(result.raw).toBe(detail);
    });

    it('should parse groups with open > 0 correctly', () => {
      const detail = [
        'groups: open=3, allowlist=1',
        'tools.elevated: disabled',
        'hooks.webhooks: enabled',
        'hooks.internal: disabled',
        'browser control: disabled',
      ].join('\n');

      const result = parseAttackSurface(detail);

      expect(result.groups_open).toBe(3);
      expect(result.tools_elevated).toBe(false);
      expect(result.hooks_webhooks).toBe(true);
      expect(result.hooks_internal).toBe(false);
      expect(result.browser_control).toBe(false);
      expect(result.parse_ok).toBe(true);
    });

    it('should handle extra lines (like trust model) without errors', () => {
      const detail = [
        'groups: open=0, allowlist=2',
        'tools.elevated: enabled',
        'hooks.webhooks: disabled',
        'hooks.internal: enabled',
        'browser control: enabled',
        'trust model: personal assistant (one trusted operator boundary), not hostile multi-tenant on one shared gateway',
      ].join('\n');

      const result = parseAttackSurface(detail);

      expect(result.parse_ok).toBe(true);
      expect(result.groups_open).toBe(0);
      expect(result.parse_errors).toHaveLength(0);
    });

    it('should return null fields and parse_ok=false for empty string', () => {
      const result = parseAttackSurface('');

      expect(result.groups_open).toBeNull();
      expect(result.tools_elevated).toBeNull();
      expect(result.hooks_webhooks).toBeNull();
      expect(result.hooks_internal).toBeNull();
      expect(result.browser_control).toBeNull();
      expect(result.parse_ok).toBe(false);
      expect(result.parse_errors.length).toBeGreaterThan(0);
    });

    it('should handle garbage input gracefully', () => {
      const result = parseAttackSurface('this is not valid attack surface data');

      expect(result.parse_ok).toBe(true); // No known fields failed, just no known fields found
      expect(result.groups_open).toBeNull();
      expect(result.tools_elevated).toBeNull();
    });

    it('should set parse_ok=false when groups line has unparseable format', () => {
      const detail = [
        'groups: something_invalid',
        'tools.elevated: enabled',
      ].join('\n');

      const result = parseAttackSurface(detail);

      expect(result.groups_open).toBeNull();
      expect(result.parse_ok).toBe(false);
      expect(result.parse_errors.length).toBeGreaterThan(0);
      // Other fields should still parse fine
      expect(result.tools_elevated).toBe(true);
    });

    it('should handle missing fields by leaving them null', () => {
      const detail = 'tools.elevated: enabled';
      const result = parseAttackSurface(detail);

      expect(result.tools_elevated).toBe(true);
      expect(result.groups_open).toBeNull();
      expect(result.hooks_webhooks).toBeNull();
      expect(result.hooks_internal).toBeNull();
      expect(result.browser_control).toBeNull();
      expect(result.parse_ok).toBe(true); // No parse errors for known fields
    });

    it('should be case-insensitive for keys', () => {
      const detail = [
        'Groups: open=1, allowlist=0',
        'Tools.Elevated: Enabled',
        'Hooks.Webhooks: Disabled',
        'Hooks.Internal: Enabled',
        'Browser Control: Disabled',
      ].join('\n');

      const result = parseAttackSurface(detail);

      expect(result.groups_open).toBe(1);
      expect(result.tools_elevated).toBe(true);
      expect(result.hooks_webhooks).toBe(false);
      expect(result.hooks_internal).toBe(true);
      expect(result.browser_control).toBe(false);
      expect(result.parse_ok).toBe(true);
    });

    it('should preserve the raw detail string', () => {
      const detail = 'groups: open=5, allowlist=0';
      const result = parseAttackSurface(detail);
      expect(result.raw).toBe(detail);
    });

    it('should parse the normal fixture attack surface correctly', () => {
      const detail = 'groups: open=0, allowlist=2\ntools.elevated: enabled\nhooks.webhooks: disabled\nhooks.internal: enabled\nbrowser control: enabled\ntrust model: personal assistant (one trusted operator boundary), not hostile multi-tenant on one shared gateway';

      const result = parseAttackSurface(detail);

      expect(result.groups_open).toBe(0);
      expect(result.tools_elevated).toBe(true);
      expect(result.hooks_webhooks).toBe(false);
      expect(result.hooks_internal).toBe(true);
      expect(result.browser_control).toBe(true);
      expect(result.parse_ok).toBe(true);
    });

    it('should parse the misconfigured fixture attack surface correctly', () => {
      const detail = 'groups: open=1, allowlist=0\ntools.elevated: enabled\nhooks.webhooks: disabled\nhooks.internal: enabled\nbrowser control: enabled\ntrust model: personal assistant (one trusted operator boundary), not hostile multi-tenant on one shared gateway';

      const result = parseAttackSurface(detail);

      expect(result.groups_open).toBe(1);
      expect(result.tools_elevated).toBe(true);
      expect(result.hooks_webhooks).toBe(false);
      expect(result.hooks_internal).toBe(true);
      expect(result.browser_control).toBe(true);
      expect(result.parse_ok).toBe(true);
    });
  });
});
