/**
 * Unit tests for the ControlEvaluator.
 *
 * Tests all 6 stable controls in both PASS and FAIL states using
 * representative fixture data. Also tests exclusion handling,
 * prerequisite skipping, and source unavailability.
 */

import { ControlEvaluator } from '../../src/controls/evaluator';
import { loadControlLibrary } from '../../src/controls/library';
import type { CollectorResult, SecurityAuditOutput } from '../../src/types';

/** Build a minimal CollectorResult for testing */
function makeCollectorResult(overrides: Partial<CollectorResult> = {}): CollectorResult {
  return {
    security_audit: {
      ok: true,
      data: {
        ts: Date.now(),
        summary: { critical: 0, warn: 0, info: 1 },
        findings: [
          {
            checkId: 'summary.attack_surface',
            severity: 'info',
            title: 'Attack surface summary',
            detail: 'groups: open=0, allowlist=1\ntools.elevated: enabled\nhooks.webhooks: disabled\nhooks.internal: disabled\nbrowser control: enabled',
          },
        ],
      },
      ts: Date.now(),
      error: null,
    },
    health: {
      ok: true,
      data: {
        ok: true,
        ts: Date.now(),
        durationMs: 100,
        channels: {
          slack: { configured: true, running: false, probe: { ok: true } },
        },
        agents: [{ agentId: 'main', isDefault: true, heartbeat: null, sessions: null }],
        heartbeatSeconds: 1800,
      },
      ts: Date.now(),
      error: null,
    },
    update_status: {
      ok: true,
      data: {
        update: {
          root: '/opt/homebrew/lib/node_modules/openclaw',
          installKind: 'package',
          packageManager: 'pnpm',
          registry: { latestVersion: '2026.3.13' },
          deps: { status: 'unknown', reason: 'lockfile missing' },
        },
        availability: {
          available: false,
          hasRegistryUpdate: false,
          latestVersion: null,
        },
        channel: { value: 'stable' },
      },
      ts: Date.now(),
      error: null,
    },
    version_cmd: { ok: true, version: '2026.3.13', error: null },
    attack_surface: {
      groups_open: 0,
      tools_elevated: true,
      hooks_webhooks: false,
      hooks_internal: false,
      browser_control: true,
      raw: 'groups: open=0, allowlist=1\ntools.elevated: enabled\nhooks.webhooks: disabled\nhooks.internal: disabled\nbrowser control: enabled',
      parse_ok: true,
      parse_errors: [],
    },
    ...overrides,
  };
}

describe('ControlEvaluator', () => {
  const library = loadControlLibrary();

  describe('NC-OC-003 — No ineffective deny command entries', () => {
    it('should PASS when deny_commands_ineffective is not present', () => {
      const evaluator = new ControlEvaluator(library, []);
      const collected = makeCollectorResult();
      const results = evaluator.evaluate(collected);
      const oc003 = results.find(r => r.control_id === 'NC-OC-003');

      expect(oc003).toBeDefined();
      expect(oc003!.result).toBe('PASS');
    });

    it('should FAIL when deny_commands_ineffective finding is present', () => {
      const evaluator = new ControlEvaluator(library, []);
      const collected = makeCollectorResult({
        security_audit: {
          ok: true,
          data: {
            ts: Date.now(),
            summary: { critical: 0, warn: 1, info: 1 },
            findings: [
              {
                checkId: 'summary.attack_surface',
                severity: 'info',
                title: 'Attack surface',
                detail: 'groups: open=0\ntools.elevated: enabled\nhooks.webhooks: disabled\nhooks.internal: disabled\nbrowser control: enabled',
              },
              {
                checkId: 'gateway.nodes.deny_commands_ineffective',
                severity: 'warn',
                title: 'Ineffective deny commands',
                detail: 'Some entries are ineffective',
              },
            ],
          },
          ts: Date.now(),
          error: null,
        },
      });

      const results = evaluator.evaluate(collected);
      const oc003 = results.find(r => r.control_id === 'NC-OC-003');

      expect(oc003!.result).toBe('FAIL');
      expect(oc003!.severity).toBe('high');
    });
  });

  describe('NC-OC-004 — No open (unauthenticated) groups', () => {
    it('should PASS when no open group checkIds are present', () => {
      const evaluator = new ControlEvaluator(library, []);
      const collected = makeCollectorResult();
      const results = evaluator.evaluate(collected);
      const oc004 = results.find(r => r.control_id === 'NC-OC-004');

      expect(oc004!.result).toBe('PASS');
    });

    it('should FAIL when open_groups_with_elevated is present', () => {
      const evaluator = new ControlEvaluator(library, []);
      const auditData: SecurityAuditOutput = {
        ts: Date.now(),
        summary: { critical: 1, warn: 0, info: 1 },
        findings: [
          {
            checkId: 'summary.attack_surface',
            severity: 'info',
            title: 'Attack surface',
            detail: 'groups: open=1\ntools.elevated: enabled\nhooks.webhooks: disabled\nhooks.internal: disabled\nbrowser control: enabled',
          },
          {
            checkId: 'security.exposure.open_groups_with_elevated',
            severity: 'critical',
            title: 'Open groups with elevated',
            detail: 'Open groups found',
          },
        ],
      };

      const collected = makeCollectorResult({
        security_audit: { ok: true, data: auditData, ts: Date.now(), error: null },
      });

      const results = evaluator.evaluate(collected);
      const oc004 = results.find(r => r.control_id === 'NC-OC-004');

      expect(oc004!.result).toBe('FAIL');
      expect(oc004!.severity).toBe('critical');
      expect(oc004!.evidence).toContain('open_groups_with_elevated');
    });

    it('should FAIL when open_groups_with_runtime_or_fs is present', () => {
      const evaluator = new ControlEvaluator(library, []);
      const collected = makeCollectorResult({
        security_audit: {
          ok: true,
          data: {
            ts: Date.now(),
            summary: { critical: 1, warn: 0, info: 1 },
            findings: [
              { checkId: 'summary.attack_surface', severity: 'info', title: 'AS', detail: 'groups: open=1' },
              { checkId: 'security.exposure.open_groups_with_runtime_or_fs', severity: 'critical', title: 'Open', detail: 'Open' },
            ],
          },
          ts: Date.now(),
          error: null,
        },
      });

      const results = evaluator.evaluate(collected);
      const oc004 = results.find(r => r.control_id === 'NC-OC-004');

      expect(oc004!.result).toBe('FAIL');
    });
  });

  describe('NC-OC-008 — All configured channels healthy', () => {
    it('should PASS when all channels are healthy', () => {
      const evaluator = new ControlEvaluator(library, []);
      const collected = makeCollectorResult({
        health: {
          ok: true,
          data: {
            ok: true,
            ts: Date.now(),
            durationMs: 100,
            channels: {
              slack: { configured: true, running: false, probe: { ok: true } },
            },
            agents: [{ agentId: 'main', isDefault: true, heartbeat: null, sessions: null }],
            heartbeatSeconds: 1800,
          },
          ts: Date.now(),
          error: null,
        },
      });

      const results = evaluator.evaluate(collected);
      const oc008 = results.find(r => r.control_id === 'NC-OC-008');

      expect(oc008!.result).toBe('PASS');
    });

    it('should FAIL when a configured channel probe fails', () => {
      const evaluator = new ControlEvaluator(library, []);
      const collected = makeCollectorResult({
        health: {
          ok: true,
          data: {
            ok: true,
            ts: Date.now(),
            durationMs: 100,
            channels: {
              slack: { configured: true, running: false, probe: { ok: true } },
              imessage: { configured: true, running: false, probe: { ok: false, error: 'imsg rpc failed' } },
            },
            agents: [{ agentId: 'main', isDefault: true, heartbeat: null, sessions: null }],
            heartbeatSeconds: 1800,
          },
          ts: Date.now(),
          error: null,
        },
      });

      const results = evaluator.evaluate(collected);
      const oc008 = results.find(r => r.control_id === 'NC-OC-008');

      expect(oc008!.result).toBe('FAIL');
      expect(oc008!.evidence).toContain('imessage');
    });
  });

  describe('NC-AUTH-001 — Reverse proxy trust correctly configured', () => {
    it('should PASS when trusted_proxies_missing is not present', () => {
      const evaluator = new ControlEvaluator(library, []);
      const collected = makeCollectorResult();
      const results = evaluator.evaluate(collected);
      const auth001 = results.find(r => r.control_id === 'NC-AUTH-001');

      expect(auth001!.result).toBe('PASS');
    });

    it('should FAIL when trusted_proxies_missing finding is present', () => {
      const evaluator = new ControlEvaluator(library, []);
      const collected = makeCollectorResult({
        security_audit: {
          ok: true,
          data: {
            ts: Date.now(),
            summary: { critical: 0, warn: 1, info: 1 },
            findings: [
              { checkId: 'summary.attack_surface', severity: 'info', title: 'AS', detail: 'groups: open=0' },
              { checkId: 'gateway.trusted_proxies_missing', severity: 'warn', title: 'Proxy', detail: 'Missing' },
            ],
          },
          ts: Date.now(),
          error: null,
        },
      });

      const results = evaluator.evaluate(collected);
      const auth001 = results.find(r => r.control_id === 'NC-AUTH-001');

      expect(auth001!.result).toBe('FAIL');
      expect(auth001!.severity).toBe('high');
    });
  });

  describe('NC-VERS-001 — OpenClaw is behind latest release', () => {
    it('should PASS when no update is available', () => {
      const evaluator = new ControlEvaluator(library, []);
      const collected = makeCollectorResult();
      const results = evaluator.evaluate(collected);
      const vers001 = results.find(r => r.control_id === 'NC-VERS-001');

      expect(vers001!.result).toBe('PASS');
    });

    it('should FAIL when an update is available', () => {
      const evaluator = new ControlEvaluator(library, []);
      const collected = makeCollectorResult({
        update_status: {
          ok: true,
          data: {
            update: {
              root: '/opt/openclaw',
              installKind: 'package',
              packageManager: 'pnpm',
              registry: { latestVersion: '2026.4.1' },
              deps: { status: 'unknown' },
            },
            availability: { available: true, hasRegistryUpdate: true, latestVersion: '2026.4.1' },
            channel: { value: 'stable' },
          },
          ts: Date.now(),
          error: null,
        },
      });

      const results = evaluator.evaluate(collected);
      const vers001 = results.find(r => r.control_id === 'NC-VERS-001');

      expect(vers001!.result).toBe('FAIL');
      expect(vers001!.severity).toBe('medium');
    });
  });

  describe('NC-VERS-002 — Not more than 2 minor versions behind', () => {
    it('should PASS when current version is latest', () => {
      const evaluator = new ControlEvaluator(library, []);
      const collected = makeCollectorResult();
      const results = evaluator.evaluate(collected);
      const vers002 = results.find(r => r.control_id === 'NC-VERS-002');

      expect(vers002!.result).toBe('PASS');
    });

    it('should PASS when only 1 minor version behind', () => {
      const evaluator = new ControlEvaluator(library, []);
      const collected = makeCollectorResult({
        version_cmd: { ok: true, version: '2026.3.13', error: null },
        update_status: {
          ok: true,
          data: {
            update: { root: '/opt', installKind: 'package', packageManager: 'pnpm', registry: { latestVersion: '2026.4.1' }, deps: { status: 'unknown' } },
            availability: { available: true, hasRegistryUpdate: true, latestVersion: '2026.4.1' },
            channel: { value: 'stable' },
          },
          ts: Date.now(),
          error: null,
        },
      });

      const results = evaluator.evaluate(collected);
      const vers002 = results.find(r => r.control_id === 'NC-VERS-002');

      expect(vers002!.result).toBe('PASS');
    });

    it('should FAIL when 3 minor versions behind', () => {
      const evaluator = new ControlEvaluator(library, []);
      const collected = makeCollectorResult({
        version_cmd: { ok: true, version: '2026.3.13', error: null },
        update_status: {
          ok: true,
          data: {
            update: { root: '/opt', installKind: 'package', packageManager: 'pnpm', registry: { latestVersion: '2026.6.0' }, deps: { status: 'unknown' } },
            availability: { available: true, hasRegistryUpdate: true, latestVersion: '2026.6.0' },
            channel: { value: 'stable' },
          },
          ts: Date.now(),
          error: null,
        },
      });

      const results = evaluator.evaluate(collected);
      const vers002 = results.find(r => r.control_id === 'NC-VERS-002');

      expect(vers002!.result).toBe('FAIL');
      expect(vers002!.severity).toBe('medium');
    });

    it('should SKIP when version command fails', () => {
      const evaluator = new ControlEvaluator(library, []);
      const collected = makeCollectorResult({
        version_cmd: { ok: false, version: null, error: 'command not found' },
      });

      const results = evaluator.evaluate(collected);
      const vers002 = results.find(r => r.control_id === 'NC-VERS-002');

      expect(vers002!.result).toBe('SKIP');
      expect(vers002!.skip_reason).toContain('version not determinable');
    });

    it('should handle year boundary correctly (2025.12 to 2026.2 = 2 months)', () => {
      const evaluator = new ControlEvaluator(library, []);
      const collected = makeCollectorResult({
        version_cmd: { ok: true, version: '2025.12.1', error: null },
        update_status: {
          ok: true,
          data: {
            update: { root: '/opt', installKind: 'package', packageManager: 'pnpm', registry: { latestVersion: '2026.2.0' }, deps: { status: 'unknown' } },
            availability: { available: true, hasRegistryUpdate: true, latestVersion: '2026.2.0' },
            channel: { value: 'stable' },
          },
          ts: Date.now(),
          error: null,
        },
      });

      const results = evaluator.evaluate(collected);
      const vers002 = results.find(r => r.control_id === 'NC-VERS-002');

      // (2026-2025)*12 + (2-12) = 12-10 = 2 → PASS
      expect(vers002!.result).toBe('PASS');
    });

    it('should FAIL on year boundary when > 2 months behind (2025.11 to 2026.2 = 3 months)', () => {
      const evaluator = new ControlEvaluator(library, []);
      const collected = makeCollectorResult({
        version_cmd: { ok: true, version: '2025.11.1', error: null },
        update_status: {
          ok: true,
          data: {
            update: { root: '/opt', installKind: 'package', packageManager: 'pnpm', registry: { latestVersion: '2026.2.0' }, deps: { status: 'unknown' } },
            availability: { available: true, hasRegistryUpdate: true, latestVersion: '2026.2.0' },
            channel: { value: 'stable' },
          },
          ts: Date.now(),
          error: null,
        },
      });

      const results = evaluator.evaluate(collected);
      const vers002 = results.find(r => r.control_id === 'NC-VERS-002');

      // (2026-2025)*12 + (2-11) = 12-9 = 3 → FAIL
      expect(vers002!.result).toBe('FAIL');
    });
  });

  describe('NC-OC-009 — OpenClaw update available', () => {
    it('should PASS when no update is available', () => {
      const evaluator = new ControlEvaluator(library, []);
      const collected = makeCollectorResult();
      const results = evaluator.evaluate(collected);
      const oc009 = results.find(r => r.control_id === 'NC-OC-009');

      expect(oc009!.result).toBe('PASS');
    });

    it('should FAIL (info level) when an update is available', () => {
      const evaluator = new ControlEvaluator(library, []);
      const collected = makeCollectorResult({
        update_status: {
          ok: true,
          data: {
            update: { root: '/opt', installKind: 'package', packageManager: 'pnpm', registry: { latestVersion: '2026.4.0' }, deps: { status: 'unknown' } },
            availability: { available: true, hasRegistryUpdate: true, latestVersion: '2026.4.0' },
            channel: { value: 'stable' },
          },
          ts: Date.now(),
          error: null,
        },
      });

      const results = evaluator.evaluate(collected);
      const oc009 = results.find(r => r.control_id === 'NC-OC-009');

      expect(oc009!.result).toBe('FAIL');
      expect(oc009!.severity).toBe('info');
    });
  });

  describe('Exclusion handling', () => {
    it('should return EXCLUDED when a control has an active exclusion', () => {
      const evaluator = new ControlEvaluator(library, [
        {
          controlId: 'NC-OC-003',
          reason: 'Known false positive',
          created_at: new Date().toISOString(),
        },
      ]);

      const collected = makeCollectorResult();
      const results = evaluator.evaluate(collected);
      const oc003 = results.find(r => r.control_id === 'NC-OC-003');

      expect(oc003!.result).toBe('EXCLUDED');
      expect(oc003!.exclusion_reason).toBe('Known false positive');
    });

    it('should not exclude when the exclusion is expired', () => {
      const evaluator = new ControlEvaluator(library, [
        {
          controlId: 'NC-OC-003',
          reason: 'Temporary',
          created_at: '2020-01-01T00:00:00Z',
          expires: '2020-02-01T00:00:00Z',
        },
      ]);

      const collected = makeCollectorResult();
      const results = evaluator.evaluate(collected);
      const oc003 = results.find(r => r.control_id === 'NC-OC-003');

      expect(oc003!.result).not.toBe('EXCLUDED');
    });
  });

  describe('Source unavailability', () => {
    it('should ERROR when security_audit source is unavailable', () => {
      const evaluator = new ControlEvaluator(library, []);
      const collected = makeCollectorResult({
        security_audit: { ok: false, data: null, ts: null, error: 'Timeout after 30s' },
        attack_surface: null,
      });

      const results = evaluator.evaluate(collected);
      const oc003 = results.find(r => r.control_id === 'NC-OC-003');

      expect(oc003!.result).toBe('ERROR');
      expect(oc003!.error_detail).toContain('unavailable');
    });

    it('should ERROR when health source is unavailable', () => {
      const evaluator = new ControlEvaluator(library, []);
      const collected = makeCollectorResult({
        health: { ok: false, data: null, ts: null, error: 'Connection refused' },
      });

      const results = evaluator.evaluate(collected);
      const oc008 = results.find(r => r.control_id === 'NC-OC-008');

      expect(oc008!.result).toBe('ERROR');
    });
  });

  describe('Deferred controls', () => {
    it('should SKIP NC-OC-001 as deferred', () => {
      const evaluator = new ControlEvaluator(library, []);
      const collected = makeCollectorResult();
      const results = evaluator.evaluate(collected);
      const oc001 = results.find(r => r.control_id === 'NC-OC-001');

      expect(oc001!.result).toBe('SKIP');
      expect(oc001!.skip_reason).toContain('deferred');
    });
  });
});
