/**
 * evaluator.test.ts — Unit tests for ControlEvaluator (NC-OC-012, NC-OC-013, NC-OC-014).
 */
import { ControlEvaluator } from '../../src/controls/evaluator';
import type {
  CollectorResult,
  ControlLibrary,
  SecurityAuditFinding,
} from '../../src/types';

const library: ControlLibrary = require('../../src/controls/library.v1.0.json');

function makeCollectorResult(overrides: Partial<CollectorResult> = {}): CollectorResult {
  return {
    security_audit: {
      ok: true,
      data: {
        ts: 1710900000,
        summary: { critical: 0, warn: 0, info: 0 },
        findings: [],
      },
      ts: 1710900000,
      error: null,
    },
    health: {
      ok: true,
      data: {
        ok: true,
        ts: 1710900000,
        durationMs: 100,
        channels: {},
        agents: [{ agentId: 'default', isDefault: true, heartbeat: null, sessions: null }],
        heartbeatSeconds: 30,
      },
      ts: 1710900000,
      error: null,
    },
    update_status: {
      ok: true,
      data: {
        update: {
          root: '/opt/openclaw',
          installKind: 'global',
          packageManager: 'npm',
          registry: { latestVersion: '2026.3.13' },
          deps: { status: 'ok' },
        },
        availability: {
          available: false,
          hasRegistryUpdate: false,
          latestVersion: null,
        },
        channel: { value: 'stable' },
      },
      ts: 1710900000,
      error: null,
    },
    version_cmd: {
      ok: true,
      version: '2026.3.13',
      error: null,
    },
    attack_surface: null,
    ...overrides,
  };
}

function findingsWith(...checkIds: string[]): SecurityAuditFinding[] {
  return checkIds.map(checkId => ({
    checkId,
    severity: 'warn' as const,
    title: `Finding: ${checkId}`,
    detail: `Detail for ${checkId}`,
  }));
}

function makeAuditWith(...checkIds: string[]): CollectorResult['security_audit'] {
  return {
    ok: true,
    data: {
      ts: 1710900000,
      summary: { critical: 0, warn: checkIds.length, info: 0 },
      findings: findingsWith(...checkIds),
    },
    ts: 1710900000,
    error: null,
  };
}

const failedAudit: CollectorResult['security_audit'] = {
  ok: false,
  data: null,
  ts: null,
  error: 'Connection refused',
};

describe('NC-OC-012 — Gateway authentication not configured', () => {
  const evaluator = new ControlEvaluator(library, []);

  it('PASS when gateway.loopback_no_auth finding is absent', () => {
    const collected = makeCollectorResult();
    const evals = evaluator.evaluate(collected);
    const ev = evals.find(e => e.control_id === 'NC-OC-012')!;
    expect(ev.result).toBe('PASS');
    expect(ev.evidence).toContain('configured');
    expect(ev.remediation).toBeNull();
  });

  it('FAIL when gateway.loopback_no_auth finding is present', () => {
    const collected = makeCollectorResult({
      security_audit: makeAuditWith('gateway.loopback_no_auth'),
    });
    const evals = evaluator.evaluate(collected);
    const ev = evals.find(e => e.control_id === 'NC-OC-012')!;
    expect(ev.result).toBe('FAIL');
    expect(ev.severity).toBe('critical');
    expect(ev.evidence).toContain('no authentication token');
    expect(ev.remediation).toBeTruthy();
  });

  it('ERROR when security audit source is unavailable', () => {
    const collected = makeCollectorResult({ security_audit: failedAudit });
    const evals = evaluator.evaluate(collected);
    const ev = evals.find(e => e.control_id === 'NC-OC-012')!;
    expect(ev.result).toBe('ERROR');
    expect(ev.error_detail).toContain('Connection refused');
  });
});

describe('NC-OC-013 — Browser control requires gateway authentication', () => {
  const evaluator = new ControlEvaluator(library, []);

  it('PASS when browser.control_no_auth finding is absent', () => {
    const collected = makeCollectorResult();
    const evals = evaluator.evaluate(collected);
    const ev = evals.find(e => e.control_id === 'NC-OC-013')!;
    expect(ev.result).toBe('PASS');
    expect(ev.evidence).toContain('auth check passed');
    expect(ev.remediation).toBeNull();
  });

  it('FAIL when browser.control_no_auth finding is present', () => {
    const collected = makeCollectorResult({
      security_audit: makeAuditWith('browser.control_no_auth'),
    });
    const evals = evaluator.evaluate(collected);
    const ev = evals.find(e => e.control_id === 'NC-OC-013')!;
    expect(ev.result).toBe('FAIL');
    expect(ev.severity).toBe('critical');
    expect(ev.evidence).toContain('Browser control enabled without gateway authentication');
    expect(ev.remediation).toBeTruthy();
  });

  it('ERROR when security audit source is unavailable', () => {
    const collected = makeCollectorResult({ security_audit: failedAudit });
    const evals = evaluator.evaluate(collected);
    const ev = evals.find(e => e.control_id === 'NC-OC-013')!;
    expect(ev.result).toBe('ERROR');
    expect(ev.error_detail).toContain('Connection refused');
  });
});

describe('NC-OC-014 — Gateway auth token meets minimum length', () => {
  const evaluator = new ControlEvaluator(library, []);

  it('PASS when gateway.token_too_short finding is absent', () => {
    const collected = makeCollectorResult();
    const evals = evaluator.evaluate(collected);
    const ev = evals.find(e => e.control_id === 'NC-OC-014')!;
    expect(ev.result).toBe('PASS');
    expect(ev.evidence).toContain('meets minimum length');
    expect(ev.remediation).toBeNull();
  });

  it('FAIL when gateway.token_too_short finding is present', () => {
    const collected = makeCollectorResult({
      security_audit: makeAuditWith('gateway.token_too_short'),
    });
    const evals = evaluator.evaluate(collected);
    const ev = evals.find(e => e.control_id === 'NC-OC-014')!;
    expect(ev.result).toBe('FAIL');
    expect(ev.severity).toBe('high');
    expect(ev.evidence).toContain('below minimum required length');
    expect(ev.remediation).toBeTruthy();
  });

  it('ERROR when security audit source is unavailable', () => {
    const collected = makeCollectorResult({ security_audit: failedAudit });
    const evals = evaluator.evaluate(collected);
    const ev = evals.find(e => e.control_id === 'NC-OC-014')!;
    expect(ev.result).toBe('ERROR');
    expect(ev.error_detail).toContain('Connection refused');
  });
});
