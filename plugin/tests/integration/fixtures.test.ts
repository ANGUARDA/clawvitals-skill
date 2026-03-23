/**
 * fixtures.test.ts — Integration tests using hardcoded fixture objects.
 * No real CLI calls — exercises evaluator + scorer + delta end-to-end.
 */
import { ControlEvaluator } from '../../src/controls/evaluator';
import { Scorer } from '../../src/scoring/index';
import { DeltaDetector } from '../../src/scoring/delta';
import type {
  CollectorResult,
  ControlLibrary,
  SecurityAuditFinding,
  HealthOutput,
  UpdateStatusOutput,
  RunReport,
  Exclusion,
} from '../../src/types';

// Load library using require (ts-jest CJS compatibility)
const library: ControlLibrary = require('../../src/controls/library.v1.0.json');

// ── Fixture helpers ───────────────────────────────────────────

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

function makeReport(
  evaluations: ReturnType<ControlEvaluator['evaluate']>,
  scorer: Scorer,
  libraryVersion = '1.0.0',
): RunReport {
  const stable = evaluations.filter(e => e.status === 'stable');
  const experimental = evaluations.filter(e => e.status === 'experimental');
  const scoreResult = scorer.score(evaluations);

  return {
    version: '1.1.2',
    library_version: libraryVersion,
    meta: {
      host_name: 'test',
      scan_ts: new Date().toISOString(),
      mode: '1',
      openclaw_version: '2026.3.13',
      run_id: 'fixture-run',
      is_scheduled: false,
      success: true,
    },
    sources: {} as CollectorResult,
    native_findings: [],
    dock_analysis: {
      stable: {
        score: scoreResult.score,
        band: scoreResult.band,
        domains: scoreResult.domains,
        findings: stable,
      },
      experimental: { findings: experimental },
      excluded: evaluations.filter(e => e.result === 'EXCLUDED'),
      skipped: evaluations.filter(e => e.result === 'SKIP'),
      delta: { new_findings: [], resolved_findings: [], new_checks: [] },
    },
  };
}

// ── Tests ─────────────────────────────────────────────────────

describe('Integration: clean baseline (no findings, up-to-date)', () => {
  const scorer = new Scorer();
  const evaluator = new ControlEvaluator(library, []);
  const collected = makeCollectorResult();

  it('evaluates all controls without error', () => {
    const evaluations = evaluator.evaluate(collected);
    expect(evaluations.length).toBe(library.controls.length);
  });

  it('stable controls that pass include NC-OC-003, NC-OC-004, NC-AUTH-001', () => {
    const evaluations = evaluator.evaluate(collected);
    for (const id of ['NC-OC-003', 'NC-OC-004', 'NC-AUTH-001']) {
      const ev = evaluations.find(e => e.control_id === id);
      expect(ev).toBeDefined();
      expect(ev!.result).toBe('PASS');
    }
  });

  it('NC-VERS-001 PASSes when no update available', () => {
    const evaluations = evaluator.evaluate(collected);
    const ev = evaluations.find(e => e.control_id === 'NC-VERS-001');
    expect(ev!.result).toBe('PASS');
  });

  it('NC-VERS-002 PASSes when version is current', () => {
    const evaluations = evaluator.evaluate(collected);
    const ev = evaluations.find(e => e.control_id === 'NC-VERS-002');
    expect(ev!.result).toBe('PASS');
  });

  it('deferred controls are SKIP', () => {
    const evaluations = evaluator.evaluate(collected);
    const deferred = evaluations.filter(e => e.status === 'deferred');
    expect(deferred.length).toBeGreaterThan(0);
    deferred.forEach(e => expect(e.result).toBe('SKIP'));
  });

  it('experimental controls are SKIP', () => {
    const evaluations = evaluator.evaluate(collected);
    const experimental = evaluations.filter(e => e.status === 'experimental');
    expect(experimental.length).toBeGreaterThan(0);
    experimental.forEach(e => expect(e.result).toBe('SKIP'));
  });
});

describe('Integration: NC-OC-003 — ineffective deny commands', () => {
  const evaluator = new ControlEvaluator(library, []);

  it('FAILs when finding present', () => {
    const collected = makeCollectorResult({
      security_audit: {
        ok: true,
        data: {
          ts: 1710900000,
          summary: { critical: 0, warn: 1, info: 0 },
          findings: findingsWith('gateway.nodes.deny_commands_ineffective'),
        },
        ts: 1710900000,
        error: null,
      },
    });

    const evaluations = evaluator.evaluate(collected);
    const ev = evaluations.find(e => e.control_id === 'NC-OC-003');
    expect(ev!.result).toBe('FAIL');
    expect(ev!.severity).toBe('high');
  });

  it('returns ERROR when security_audit source is unavailable', () => {
    const collected = makeCollectorResult({
      security_audit: { ok: false, data: null, ts: null, error: 'Connection refused' },
    });
    const evaluations = evaluator.evaluate(collected);
    const ev = evaluations.find(e => e.control_id === 'NC-OC-003');
    expect(ev!.result).toBe('ERROR');
  });
});

describe('Integration: NC-OC-004 — open groups', () => {
  const evaluator = new ControlEvaluator(library, []);

  it('FAILs when open_groups_with_elevated finding present', () => {
    const collected = makeCollectorResult({
      security_audit: {
        ok: true,
        data: {
          ts: 1710900000,
          summary: { critical: 1, warn: 0, info: 0 },
          findings: findingsWith('security.exposure.open_groups_with_elevated'),
        },
        ts: 1710900000,
        error: null,
      },
    });

    const evaluations = evaluator.evaluate(collected);
    const ev = evaluations.find(e => e.control_id === 'NC-OC-004');
    expect(ev!.result).toBe('FAIL');
    expect(ev!.severity).toBe('critical');
  });

  it('FAILs when open_groups_with_runtime_or_fs finding present', () => {
    const collected = makeCollectorResult({
      security_audit: {
        ok: true,
        data: {
          ts: 1710900000,
          summary: { critical: 1, warn: 0, info: 0 },
          findings: findingsWith('security.exposure.open_groups_with_runtime_or_fs'),
        },
        ts: 1710900000,
        error: null,
      },
    });

    const evaluations = evaluator.evaluate(collected);
    const ev = evaluations.find(e => e.control_id === 'NC-OC-004');
    expect(ev!.result).toBe('FAIL');
  });

  it('FAILs when both open group findings present', () => {
    const collected = makeCollectorResult({
      security_audit: {
        ok: true,
        data: {
          ts: 1710900000,
          summary: { critical: 2, warn: 0, info: 0 },
          findings: findingsWith(
            'security.exposure.open_groups_with_elevated',
            'security.exposure.open_groups_with_runtime_or_fs',
          ),
        },
        ts: 1710900000,
        error: null,
      },
    });

    const evaluations = evaluator.evaluate(collected);
    const ev = evaluations.find(e => e.control_id === 'NC-OC-004');
    expect(ev!.result).toBe('FAIL');
    expect(ev!.evidence).toContain('security.exposure.open_groups_with_elevated');
    expect(ev!.evidence).toContain('security.exposure.open_groups_with_runtime_or_fs');
  });
});

describe('Integration: NC-OC-008 — channel health', () => {
  const evaluator = new ControlEvaluator(library, []);

  it('PASSes when all channels healthy', () => {
    const collected = makeCollectorResult({
      health: {
        ok: true,
        data: {
          ok: true, ts: 1710900000, durationMs: 100,
          channels: {
            slack: { configured: true, running: true, probe: { ok: true } },
            discord: { configured: true, running: true, probe: { ok: true } },
          },
          agents: [{ agentId: 'default', isDefault: true, heartbeat: null, sessions: null }],
          heartbeatSeconds: 30,
        },
        ts: 1710900000,
        error: null,
      },
    });

    const evaluations = evaluator.evaluate(collected);
    const ev = evaluations.find(e => e.control_id === 'NC-OC-008');
    expect(ev!.result).toBe('PASS');
  });

  it('FAILs when a configured channel probe fails', () => {
    const collected = makeCollectorResult({
      health: {
        ok: true,
        data: {
          ok: false, ts: 1710900000, durationMs: 100,
          channels: {
            slack: { configured: true, running: true, probe: { ok: false, error: 'timeout' } },
          },
          agents: [{ agentId: 'default', isDefault: true, heartbeat: null, sessions: null }],
          heartbeatSeconds: 30,
        },
        ts: 1710900000,
        error: null,
      },
    });

    const evaluations = evaluator.evaluate(collected);
    const ev = evaluations.find(e => e.control_id === 'NC-OC-008');
    expect(ev!.result).toBe('FAIL');
    expect(ev!.evidence).toContain('slack');
  });

  it('PASSes when unconfigured channel probe fails', () => {
    const collected = makeCollectorResult({
      health: {
        ok: true,
        data: {
          ok: true, ts: 1710900000, durationMs: 100,
          channels: {
            slack: { configured: false, running: false, probe: { ok: false } },
          },
          agents: [{ agentId: 'default', isDefault: true, heartbeat: null, sessions: null }],
          heartbeatSeconds: 30,
        },
        ts: 1710900000,
        error: null,
      },
    });

    const evaluations = evaluator.evaluate(collected);
    const ev = evaluations.find(e => e.control_id === 'NC-OC-008');
    expect(ev!.result).toBe('PASS');
  });
});

describe('Integration: NC-AUTH-001 — trusted proxies', () => {
  const evaluator = new ControlEvaluator(library, []);

  it('FAILs when trusted proxies finding present', () => {
    const collected = makeCollectorResult({
      security_audit: {
        ok: true,
        data: {
          ts: 1710900000,
          summary: { critical: 0, warn: 1, info: 0 },
          findings: findingsWith('gateway.trusted_proxies_missing'),
        },
        ts: 1710900000,
        error: null,
      },
    });

    const evaluations = evaluator.evaluate(collected);
    const ev = evaluations.find(e => e.control_id === 'NC-AUTH-001');
    expect(ev!.result).toBe('FAIL');
    expect(ev!.severity).toBe('high');
  });
});

describe('Integration: NC-VERS-001 — behind latest release', () => {
  const evaluator = new ControlEvaluator(library, []);

  it('FAILs when hasRegistryUpdate is true', () => {
    const collected = makeCollectorResult({
      update_status: {
        ok: true,
        data: {
          update: {
            root: '/opt/openclaw', installKind: 'global', packageManager: 'npm',
            registry: { latestVersion: '2026.3.15' },
            deps: { status: 'ok' },
          },
          availability: { available: true, hasRegistryUpdate: true, latestVersion: '2026.3.15' },
          channel: { value: 'stable' },
        },
        ts: 1710900000,
        error: null,
      },
    });

    const evaluations = evaluator.evaluate(collected);
    const ev = evaluations.find(e => e.control_id === 'NC-VERS-001');
    expect(ev!.result).toBe('FAIL');
    expect(ev!.severity).toBe('medium');
  });
});

describe('Integration: NC-VERS-002 — version distance', () => {
  const evaluator = new ControlEvaluator(library, []);

  it('FAILs when >2 months behind', () => {
    const collected = makeCollectorResult({
      version_cmd: { ok: true, version: '2026.1.1', error: null },
      update_status: {
        ok: true,
        data: {
          update: {
            root: '/opt/openclaw', installKind: 'global', packageManager: 'npm',
            registry: { latestVersion: '2026.4.1' },
            deps: { status: 'ok' },
          },
          availability: { available: true, hasRegistryUpdate: true, latestVersion: '2026.4.1' },
          channel: { value: 'stable' },
        },
        ts: 1710900000,
        error: null,
      },
    });

    const evaluations = evaluator.evaluate(collected);
    const ev = evaluations.find(e => e.control_id === 'NC-VERS-002');
    expect(ev!.result).toBe('FAIL');
    expect(ev!.evidence).toContain('3 minor versions behind');
  });

  it('PASSes when exactly 2 months behind', () => {
    const collected = makeCollectorResult({
      version_cmd: { ok: true, version: '2026.1.1', error: null },
      update_status: {
        ok: true,
        data: {
          update: {
            root: '/opt/openclaw', installKind: 'global', packageManager: 'npm',
            registry: { latestVersion: '2026.3.1' },
            deps: { status: 'ok' },
          },
          availability: { available: true, hasRegistryUpdate: true, latestVersion: '2026.3.1' },
          channel: { value: 'stable' },
        },
        ts: 1710900000,
        error: null,
      },
    });

    const evaluations = evaluator.evaluate(collected);
    const ev = evaluations.find(e => e.control_id === 'NC-VERS-002');
    expect(ev!.result).toBe('PASS');
  });

  it('SKIPs when version_cmd unavailable', () => {
    const collected = makeCollectorResult({
      version_cmd: { ok: false, version: null, error: 'Not found' },
    });

    const evaluations = evaluator.evaluate(collected);
    const ev = evaluations.find(e => e.control_id === 'NC-VERS-002');
    expect(ev!.result).toBe('SKIP');
  });
});

describe('Integration: exclusions', () => {
  it('marks control as EXCLUDED when active exclusion exists', () => {
    const exclusions: Exclusion[] = [{
      controlId: 'NC-OC-003',
      reason: 'Known safe',
      created_at: '2026-03-20T00:00:00Z',
      expires: '2027-01-01T00:00:00Z',
    }];
    const evaluator = new ControlEvaluator(library, exclusions);
    const collected = makeCollectorResult({
      security_audit: {
        ok: true,
        data: {
          ts: 1710900000,
          summary: { critical: 0, warn: 1, info: 0 },
          findings: findingsWith('gateway.nodes.deny_commands_ineffective'),
        },
        ts: 1710900000,
        error: null,
      },
    });

    const evaluations = evaluator.evaluate(collected);
    const ev = evaluations.find(e => e.control_id === 'NC-OC-003');
    expect(ev!.result).toBe('EXCLUDED');
    expect(ev!.exclusion_reason).toBe('Known safe');
  });

  it('does not exclude when exclusion is expired', () => {
    const exclusions: Exclusion[] = [{
      controlId: 'NC-OC-003',
      reason: 'Expired',
      created_at: '2025-01-01T00:00:00Z',
      expires: '2025-06-01T00:00:00Z',
    }];
    const evaluator = new ControlEvaluator(library, exclusions);
    const collected = makeCollectorResult({
      security_audit: {
        ok: true,
        data: {
          ts: 1710900000,
          summary: { critical: 0, warn: 1, info: 0 },
          findings: findingsWith('gateway.nodes.deny_commands_ineffective'),
        },
        ts: 1710900000,
        error: null,
      },
    });

    const evaluations = evaluator.evaluate(collected);
    const ev = evaluations.find(e => e.control_id === 'NC-OC-003');
    expect(ev!.result).toBe('FAIL');
  });
});

describe('Integration: full pipeline — evaluator → scorer → delta', () => {
  const scorer = new Scorer();
  const delta = new DeltaDetector();

  it('computes score and detects new findings from clean baseline', () => {
    // Run 1: clean
    const evaluator1 = new ControlEvaluator(library, []);
    const collected1 = makeCollectorResult();
    const evals1 = evaluator1.evaluate(collected1);
    const report1 = makeReport(evals1, scorer);

    // Run 2: introduce a critical finding
    const evaluator2 = new ControlEvaluator(library, []);
    const collected2 = makeCollectorResult({
      security_audit: {
        ok: true,
        data: {
          ts: 1710900000,
          summary: { critical: 1, warn: 0, info: 0 },
          findings: findingsWith('security.exposure.open_groups_with_elevated'),
        },
        ts: 1710900000,
        error: null,
      },
    });
    const evals2 = evaluator2.evaluate(collected2);
    const report2 = makeReport(evals2, scorer);

    // Delta should detect the new finding
    const deltaResult = delta.detect(report2, report1);
    expect(deltaResult.new_findings.length).toBeGreaterThan(0);
    const ncOc004 = deltaResult.new_findings.find(f => f.control_id === 'NC-OC-004');
    expect(ncOc004).toBeDefined();

    // Score should be lower in run 2
    expect(report2.dock_analysis.stable.score).toBeLessThan(
      report1.dock_analysis.stable.score as number
    );
  });

  it('detects resolved findings when issue is fixed', () => {
    // Run 1: has a finding
    const evaluator1 = new ControlEvaluator(library, []);
    const collected1 = makeCollectorResult({
      security_audit: {
        ok: true,
        data: {
          ts: 1710900000,
          summary: { critical: 0, warn: 1, info: 0 },
          findings: findingsWith('gateway.trusted_proxies_missing'),
        },
        ts: 1710900000,
        error: null,
      },
    });
    const evals1 = evaluator1.evaluate(collected1);
    const report1 = makeReport(evals1, scorer);

    // Run 2: finding resolved
    const evaluator2 = new ControlEvaluator(library, []);
    const collected2 = makeCollectorResult();
    const evals2 = evaluator2.evaluate(collected2);
    const report2 = makeReport(evals2, scorer);

    const deltaResult = delta.detect(report2, report1);
    expect(deltaResult.resolved_findings.length).toBeGreaterThan(0);
    const resolved = deltaResult.resolved_findings.find(f => f.control_id === 'NC-AUTH-001');
    expect(resolved).toBeDefined();
  });
});
