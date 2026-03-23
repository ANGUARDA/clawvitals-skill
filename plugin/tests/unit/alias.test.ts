/**
 * alias.test.ts — Tests for alias validation and display formatting.
 */
import { validateAlias, formatInstallDisplay, MAX_ALIAS_LENGTH } from '../../src/alias';

describe('validateAlias', () => {
  describe('valid inputs', () => {
    it('accepts a simple alphanumeric alias', () => {
      const result = validateAlias('prod-server-1');
      expect(result.valid).toBe(true);
      expect(result.normalized).toBe('prod-server-1');
    });

    it('accepts alias with spaces', () => {
      const result = validateAlias('My Dev Laptop');
      expect(result.valid).toBe(true);
      expect(result.normalized).toBe('My Dev Laptop');
    });

    it('accepts alias with underscores', () => {
      const result = validateAlias('home_server_01');
      expect(result.valid).toBe(true);
      expect(result.normalized).toBe('home_server_01');
    });

    it('trims leading/trailing whitespace', () => {
      const result = validateAlias('  prod  ');
      expect(result.valid).toBe(true);
      expect(result.normalized).toBe('prod');
    });

    it('accepts alias at exactly max length', () => {
      const alias = 'a'.repeat(MAX_ALIAS_LENGTH);
      const result = validateAlias(alias);
      expect(result.valid).toBe(true);
    });
  });

  describe('invalid inputs', () => {
    it('rejects empty string', () => {
      const result = validateAlias('');
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/empty/i);
    });

    it('rejects whitespace-only string', () => {
      const result = validateAlias('   ');
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/empty/i);
    });

    it('rejects alias exceeding max length', () => {
      const alias = 'a'.repeat(MAX_ALIAS_LENGTH + 1);
      const result = validateAlias(alias);
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/too long/i);
    });

    it('rejects alias with special characters (@)', () => {
      const result = validateAlias('prod@server');
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/letters|alphanumeric/i);
    });

    it('rejects alias with dots', () => {
      const result = validateAlias('prod.server.1');
      expect(result.valid).toBe(false);
    });

    it('rejects alias with slashes', () => {
      const result = validateAlias('prod/server');
      expect(result.valid).toBe(false);
    });
  });
});

describe('formatInstallDisplay', () => {
  const installId = 'a3f2b1c0-d4e5-4f6a-8b9c-0d1e2f3a4b5c';

  it('shows alias and truncated id when alias is set', () => {
    const display = formatInstallDisplay(installId, 'prod-server-1');
    expect(display).toBe('prod-server-1 (iid: a3f2b1c0...)');
  });

  it('shows <unnamed> when no alias', () => {
    const display = formatInstallDisplay(installId);
    expect(display).toBe('<unnamed> (iid: a3f2b1c0...)');
  });

  it('shows <unnamed> when alias is empty string', () => {
    const display = formatInstallDisplay(installId, '');
    expect(display).toBe('<unnamed> (iid: a3f2b1c0...)');
  });

  it('shows <unnamed> when alias is whitespace only', () => {
    const display = formatInstallDisplay(installId, '   ');
    expect(display).toBe('<unnamed> (iid: a3f2b1c0...)');
  });

  it('truncates install ID to first 8 characters', () => {
    const longId = '12345678-abcd-4000-8000-000000000001';
    const display = formatInstallDisplay(longId, 'test');
    expect(display).toContain('12345678...');
  });
});
