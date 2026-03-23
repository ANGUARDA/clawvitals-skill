/**
 * collectors.test.ts — Tests for collector functions and CollectorOrchestrator.
 */
import { collectHealth } from '../../src/collectors/health';
import { collectVersion } from '../../src/collectors/version';
import { collectSecurityAudit } from '../../src/collectors/security-audit';
import { collectUpdateStatus } from '../../src/collectors/update-status';
import { CollectorOrchestrator } from '../../src/collectors/index';

// Mock CliRunner — never import CliRunner directly (it imports ESM SDK)
function makeMockCli(responses: Record<string, { stdout: string; stderr: string; exitCode: number }>) {
  return {
    run: jest.fn(async (args: string[]) => {
      const key = args.join(' ');
      for (const [pattern, response] of Object.entries(responses)) {
        if (key.includes(pattern)) return response;
      }
      throw new Error(`Unexpected CLI args: ${key}`);
    }),
  };
}

describe('collectSecurityAudit', () => {
  it('returns parsed security audit data on success', async () => {
    const cli = makeMockCli({
      'security audit': {
        stdout: JSON.stringify({
          ts: 1710900000,
          summary: { critical: 0, warn: 1, info: 2 },
          findings: [
            {
              checkId: 'gateway.trusted_proxies_missing',
              severity: 'warn',
              title: 'Trusted proxies missing',
              detail: 'No trusted proxies configured',
            },
          ],
        }),
        stderr: '',
        exitCode: 0,
      },
    });

    const result = await collectSecurityAudit(cli as any);
    expect(result.ok).toBe(true);
    expect(result.data).toBeDefined();
    expect(result.data!.findings).toHaveLength(1);
    expect(result.data!.findings[0].checkId).toBe('gateway.trusted_proxies_missing');
    expect(result.ts).toBe(1710900000);
  });

  it('returns error on invalid JSON', async () => {
    const cli = makeMockCli({
      'security audit': { stdout: 'not json', stderr: '', exitCode: 0 },
    });
    const result = await collectSecurityAudit(cli as any);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('JSON parse error');
  });

  it('returns error on CLI failure', async () => {
    const cli = {
      run: jest.fn(async () => { throw new Error('CLI crashed'); }),
    };
    const result = await collectSecurityAudit(cli as any);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('CLI crashed');
  });

  it('returns error on schema mismatch', async () => {
    const cli = makeMockCli({
      'security audit': {
        stdout: JSON.stringify({ ts: 'not-a-number', summary: {}, findings: [] }),
        stderr: '',
        exitCode: 0,
      },
    });
    const result = await collectSecurityAudit(cli as any);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('Schema mismatch');
  });
});

describe('collectHealth', () => {
  it('returns parsed health data on success', async () => {
    const cli = makeMockCli({
      'health': {
        stdout: JSON.stringify({
          ok: true,
          ts: 1710900000,
          durationMs: 150,
          channels: {
            slack: { configured: true, running: true, probe: { ok: true } },
          },
          agents: [{ agentId: 'default', isDefault: true }],
          heartbeatSeconds: 30,
        }),
        stderr: '',
        exitCode: 0,
      },
    });

    const result = await collectHealth(cli as any);
    expect(result.ok).toBe(true);
    expect(result.data!.channels.slack.probe.ok).toBe(true);
  });

  it('returns error on CLI failure', async () => {
    const cli = { run: jest.fn(async () => { throw new Error('Connection refused'); }) };
    const result = await collectHealth(cli as any);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('Connection refused');
  });
});

describe('collectVersion', () => {
  it('extracts version from CLI output', async () => {
    const cli = makeMockCli({
      '--version': { stdout: 'OpenClaw 2026.3.13 (abc1234)', stderr: '', exitCode: 0 },
    });
    const result = await collectVersion(cli as any);
    expect(result.ok).toBe(true);
    expect(result.version).toBe('2026.3.13');
  });

  it('returns error when version pattern not found', async () => {
    const cli = makeMockCli({
      '--version': { stdout: 'unknown version format', stderr: '', exitCode: 0 },
    });
    const result = await collectVersion(cli as any);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('Could not parse version');
  });

  it('returns error on CLI failure', async () => {
    const cli = { run: jest.fn(async () => { throw new Error('Not found'); }) };
    const result = await collectVersion(cli as any);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('Not found');
  });
});

describe('collectUpdateStatus', () => {
  it('returns parsed update status on success', async () => {
    const cli = makeMockCli({
      'update status': {
        stdout: JSON.stringify({
          update: {
            root: '/opt/openclaw',
            installKind: 'global',
            packageManager: 'npm',
            registry: { latestVersion: '2026.3.15' },
            deps: { status: 'ok' },
          },
          availability: {
            available: true,
            hasRegistryUpdate: true,
            latestVersion: '2026.3.15',
          },
          channel: { value: 'stable' },
        }),
        stderr: '',
        exitCode: 0,
      },
    });

    const result = await collectUpdateStatus(cli as any);
    expect(result.ok).toBe(true);
    expect(result.data!.availability.hasRegistryUpdate).toBe(true);
    expect(result.data!.availability.latestVersion).toBe('2026.3.15');
  });

  it('returns error on schema mismatch', async () => {
    const cli = makeMockCli({
      'update status': {
        stdout: JSON.stringify({ invalid: true }),
        stderr: '',
        exitCode: 0,
      },
    });
    const result = await collectUpdateStatus(cli as any);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('Schema mismatch');
  });
});

describe('CollectorOrchestrator', () => {
  it('collects from all sources in parallel', async () => {
    const cli = makeMockCli({
      'security audit': {
        stdout: JSON.stringify({
          ts: 1710900000,
          summary: { critical: 0, warn: 0, info: 1 },
          findings: [{
            checkId: 'summary.attack_surface',
            severity: 'info',
            title: 'Attack Surface',
            detail: 'groups: open=0\ntools.elevated: disabled\nhooks.webhooks: disabled\nhooks.internal: enabled\nbrowser control: disabled',
          }],
        }),
        stderr: '',
        exitCode: 0,
      },
      'health': {
        stdout: JSON.stringify({
          ok: true, ts: 1710900000, durationMs: 100,
          channels: {},
          agents: [{ agentId: 'default', isDefault: true }],
          heartbeatSeconds: 30,
        }),
        stderr: '',
        exitCode: 0,
      },
      'update status': {
        stdout: JSON.stringify({
          update: { root: '/', installKind: 'global', packageManager: 'npm', registry: { latestVersion: '2026.3.13' }, deps: { status: 'ok' } },
          availability: { available: false, hasRegistryUpdate: false },
          channel: { value: 'stable' },
        }),
        stderr: '',
        exitCode: 0,
      },
      '--version': {
        stdout: 'OpenClaw 2026.3.13 (abc123)',
        stderr: '',
        exitCode: 0,
      },
    });

    const orchestrator = new CollectorOrchestrator(cli as any);
    const result = await orchestrator.collect();

    expect(result.security_audit.ok).toBe(true);
    expect(result.health.ok).toBe(true);
    expect(result.update_status.ok).toBe(true);
    expect(result.version_cmd.ok).toBe(true);
    expect(result.attack_surface).toBeDefined();
    expect(result.attack_surface!.groups_open).toBe(0);
    expect(result.attack_surface!.hooks_internal).toBe(true);
  });

  it('handles individual source failures gracefully', async () => {
    const cli = {
      run: jest.fn(async (args: string[]) => {
        if (args.includes('health')) throw new Error('Health failed');
        if (args.includes('--version')) return { stdout: 'OpenClaw 2026.3.13', stderr: '', exitCode: 0 };
        if (args.includes('security')) {
          return {
            stdout: JSON.stringify({
              ts: 1710900000,
              summary: { critical: 0, warn: 0, info: 0 },
              findings: [],
            }),
            stderr: '',
            exitCode: 0,
          };
        }
        if (args.includes('update')) {
          return {
            stdout: JSON.stringify({
              update: { root: '/', installKind: 'global', packageManager: 'npm', registry: { latestVersion: '2026.3.13' }, deps: { status: 'ok' } },
              availability: { available: false, hasRegistryUpdate: false },
              channel: { value: 'stable' },
            }),
            stderr: '',
            exitCode: 0,
          };
        }
        throw new Error('Unexpected');
      }),
    };

    const orchestrator = new CollectorOrchestrator(cli as any);
    const result = await orchestrator.collect();

    expect(result.security_audit.ok).toBe(true);
    expect(result.health.ok).toBe(false);
    expect(result.update_status.ok).toBe(true);
    expect(result.version_cmd.ok).toBe(true);
  });

  it('returns null attack_surface when no summary.attack_surface finding', async () => {
    const cli = makeMockCli({
      'security audit': {
        stdout: JSON.stringify({
          ts: 1710900000,
          summary: { critical: 0, warn: 0, info: 0 },
          findings: [],
        }),
        stderr: '',
        exitCode: 0,
      },
      'health': {
        stdout: JSON.stringify({
          ok: true, ts: 1710900000, durationMs: 100,
          channels: {},
          agents: [{ agentId: 'default', isDefault: true }],
          heartbeatSeconds: 30,
        }),
        stderr: '',
        exitCode: 0,
      },
      'update status': {
        stdout: JSON.stringify({
          update: { root: '/', installKind: 'global', packageManager: 'npm', registry: { latestVersion: '2026.3.13' }, deps: { status: 'ok' } },
          availability: { available: false, hasRegistryUpdate: false },
          channel: { value: 'stable' },
        }),
        stderr: '',
        exitCode: 0,
      },
      '--version': { stdout: 'OpenClaw 2026.3.13', stderr: '', exitCode: 0 },
    });

    const orchestrator = new CollectorOrchestrator(cli as any);
    const result = await orchestrator.collect();
    expect(result.attack_surface).toBeNull();
  });
});
