/**
 * scheduler.test.ts — Tests for cron expression validation and config resolution.
 */
import { validateCron, resolveSchedulerConfig, DEFAULT_CRON } from '../../src/scheduler';
import type { PluginConfig } from '../../src/plugin-config';

describe('validateCron', () => {
  describe('valid expressions', () => {
    it('accepts standard 5-field daily cron', () => {
      expect(validateCron('0 9 * * *')).toBeNull();
    });

    it('accepts weekly cron', () => {
      expect(validateCron('0 9 * * 1')).toBeNull();
    });

    it('accepts monthly cron', () => {
      expect(validateCron('0 9 1 * *')).toBeNull();
    });

    it('accepts the default cron expression', () => {
      expect(validateCron(DEFAULT_CRON)).toBeNull();
    });

    it('accepts cron with extra whitespace between fields', () => {
      expect(validateCron('0  9  *  *  *')).toBeNull();
    });
  });

  describe('invalid expressions', () => {
    it('rejects 4-field expression', () => {
      const err = validateCron('0 9 * *');
      expect(err).not.toBeNull();
      expect(err).toMatch(/4/);
    });

    it('rejects 6-field expression', () => {
      const err = validateCron('0 9 * * * *');
      expect(err).not.toBeNull();
      expect(err).toMatch(/6/);
    });

    it('rejects empty string', () => {
      const err = validateCron('');
      expect(err).not.toBeNull();
    });

    it('rejects single word', () => {
      const err = validateCron('daily');
      expect(err).not.toBeNull();
    });
  });
});

describe('resolveSchedulerConfig', () => {
  it('returns defaults when no schedule config provided', () => {
    const config: PluginConfig = {};
    const result = resolveSchedulerConfig(config);
    expect(result.enabled).toBe(true);
    expect(result.cron).toBe(DEFAULT_CRON);
  });

  it('returns enabled=false when explicitly disabled', () => {
    const config: PluginConfig = { schedule: { enabled: false } };
    const result = resolveSchedulerConfig(config);
    expect(result.enabled).toBe(false);
  });

  it('returns custom cron when set', () => {
    const config: PluginConfig = { schedule: { cron: '0 8 * * 1' } };
    const result = resolveSchedulerConfig(config);
    expect(result.cron).toBe('0 8 * * 1');
  });

  it('returns default cron even when only enabled is specified', () => {
    const config: PluginConfig = { schedule: { enabled: true } };
    const result = resolveSchedulerConfig(config);
    expect(result.cron).toBe(DEFAULT_CRON);
  });
});

describe('DEFAULT_CRON', () => {
  it('is a valid 5-field expression', () => {
    expect(validateCron(DEFAULT_CRON)).toBeNull();
  });

  it('is 9 AM daily', () => {
    expect(DEFAULT_CRON).toBe('0 9 * * *');
  });
});
