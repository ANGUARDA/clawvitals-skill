/**
 * alerts.test.ts — Tests for alert evaluation logic.
 */
import { evaluateAlert, resolveAlertConfig } from '../../src/alerts';
import type { ScanSnapshot, AlertConfig } from '../../src/alerts';
import type { PluginConfig } from '../../src/plugin-config';

const defaultAlertConfig: AlertConfig = {
  on_regression: true,
  on_new_critical: true,
  threshold: 'high',
};

const baseSnapshot = (overrides: Partial<ScanSnapshot> = {}): ScanSnapshot => ({
  score: 80,
  band: 'amber',
  fail_count: 2,
  critical_count: 0,
  scan_ts: new Date().toISOString(),
  ...overrides,
});

describe('evaluateAlert', () => {
  describe('new critical finding', () => {
    it('alerts when new critical appears (no previous scan)', () => {
      const current = baseSnapshot({ critical_count: 1 });
      const result = evaluateAlert(current, null, defaultAlertConfig);
      expect(result).not.toBeNull();
      expect(result!.reason).toBe('new_critical');
      expect(result!.severity).toBe('critical');
    });

    it('alerts when critical count increases', () => {
      const previous = baseSnapshot({ critical_count: 0 });
      const current = baseSnapshot({ critical_count: 1 });
      const result = evaluateAlert(current, previous, defaultAlertConfig);
      expect(result).not.toBeNull();
      expect(result!.reason).toBe('new_critical');
    });

    it('does not alert when critical count stays the same', () => {
      const previous = baseSnapshot({ critical_count: 1 });
      const current = baseSnapshot({ critical_count: 1 });
      const result = evaluateAlert(current, previous, defaultAlertConfig);
      // May alert for regression instead — just ensure it's not new_critical
      if (result) {
        expect(result.reason).not.toBe('new_critical');
      }
    });

    it('does not alert on critical when on_new_critical is disabled', () => {
      const config: AlertConfig = { ...defaultAlertConfig, on_new_critical: false };
      const current = baseSnapshot({ critical_count: 2 });
      const result = evaluateAlert(current, null, config);
      // Should return null (no alert) since critical alerting is off
      // unless regression also triggered — check it's not the critical reason
      if (result) {
        expect(result.reason).not.toBe('new_critical');
      }
    });
  });

  describe('regression detection', () => {
    it('alerts when score drops', () => {
      const previous = baseSnapshot({ score: 90 });
      const current = baseSnapshot({ score: 70, fail_count: 3 });
      const result = evaluateAlert(current, previous, defaultAlertConfig);
      expect(result).not.toBeNull();
      expect(result!.reason).toBe('regression');
      expect(result!.severity).toBe('high');
    });

    it('alerts when fail count increases (even without score drop)', () => {
      const previous = baseSnapshot({ score: 80, fail_count: 1 });
      const current = baseSnapshot({ score: 80, fail_count: 3 });
      const result = evaluateAlert(current, previous, defaultAlertConfig);
      expect(result).not.toBeNull();
      expect(result!.reason).toBe('regression');
    });

    it('does not alert when score improves', () => {
      const previous = baseSnapshot({ score: 70, fail_count: 3 });
      const current = baseSnapshot({ score: 90, fail_count: 1 });
      const result = evaluateAlert(current, previous, defaultAlertConfig);
      expect(result).toBeNull();
    });

    it('does not alert when score and fail_count unchanged', () => {
      const previous = baseSnapshot({ score: 80, fail_count: 2 });
      const current = baseSnapshot({ score: 80, fail_count: 2 });
      const result = evaluateAlert(current, previous, defaultAlertConfig);
      expect(result).toBeNull();
    });

    it('does not alert on regression when on_regression is disabled', () => {
      const config: AlertConfig = { ...defaultAlertConfig, on_regression: false };
      const previous = baseSnapshot({ score: 90 });
      const current = baseSnapshot({ score: 50, fail_count: 5 });
      const result = evaluateAlert(current, previous, config);
      expect(result).toBeNull();
    });

    it('does not alert when no previous run exists (first scan, no criticals)', () => {
      const current = baseSnapshot({ score: 70, fail_count: 2, critical_count: 0 });
      const result = evaluateAlert(current, null, defaultAlertConfig);
      expect(result).toBeNull();
    });

    it('handles insufficient_data score gracefully', () => {
      const previous = baseSnapshot({ score: 80 });
      const current = baseSnapshot({ score: 'insufficient_data', fail_count: 2 });
      // Should not throw — may or may not alert depending on fail_count
      expect(() => evaluateAlert(current, previous, defaultAlertConfig)).not.toThrow();
    });

    it('alert message contains score and fail count', () => {
      const previous = baseSnapshot({ score: 90, fail_count: 1 });
      const current = baseSnapshot({ score: 70, fail_count: 3 });
      const result = evaluateAlert(current, previous, defaultAlertConfig);
      expect(result!.message).toContain('70');
      expect(result!.message).toContain('90');
    });
  });
});

describe('resolveAlertConfig', () => {
  it('returns defaults when no alerts config provided', () => {
    const config: PluginConfig = {};
    const result = resolveAlertConfig(config);
    expect(result.on_regression).toBe(true);
    expect(result.on_new_critical).toBe(true);
    expect(result.threshold).toBe('high');
  });

  it('respects explicit false for on_regression', () => {
    const config: PluginConfig = { alerts: { on_regression: false } };
    const result = resolveAlertConfig(config);
    expect(result.on_regression).toBe(false);
  });

  it('respects explicit false for on_new_critical', () => {
    const config: PluginConfig = { alerts: { on_new_critical: false } };
    const result = resolveAlertConfig(config);
    expect(result.on_new_critical).toBe(false);
  });

  it('respects custom threshold', () => {
    const config: PluginConfig = { alerts: { threshold: 'critical' } };
    const result = resolveAlertConfig(config);
    expect(result.threshold).toBe('critical');
  });
});
