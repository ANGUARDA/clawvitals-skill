/**
 * telemetry.test.ts — Tests for PluginTelemetryClient.
 */
import { PluginTelemetryClient } from '../../src/telemetry';
import type { PluginConfig, PluginInstallState } from '../../src/plugin-config';

const baseState: PluginInstallState = {
  install_id: '00000000-0000-4000-8000-000000000001',
  installed_at: '2026-03-01T00:00:00.000Z',
  total_pings: 5,
  last_ping_at: '2026-03-20T09:00:00.000Z',
};

const baseScan = {
  version: '0.1.0',
  library_version: '1.0.0',
  score: 82 as number | 'insufficient_data',
  band: 'amber',
  fail_count: 2,
  pass_count: 4,
  is_scheduled: false,
};

describe('PluginTelemetryClient', () => {
  describe('isEnabled', () => {
    it('defaults to true when no telemetry config', () => {
      const client = new PluginTelemetryClient({}, baseState);
      expect(client.isEnabled).toBe(true);
    });

    it('defaults to true when telemetry object present but enabled not set', () => {
      const config: PluginConfig = { telemetry: { alias: 'test' } };
      const client = new PluginTelemetryClient(config, baseState);
      expect(client.isEnabled).toBe(true);
    });

    it('returns false when explicitly disabled', () => {
      const config: PluginConfig = { telemetry: { enabled: false } };
      const client = new PluginTelemetryClient(config, baseState);
      expect(client.isEnabled).toBe(false);
    });

    it('returns true when explicitly enabled', () => {
      const config: PluginConfig = { telemetry: { enabled: true } };
      const client = new PluginTelemetryClient(config, baseState);
      expect(client.isEnabled).toBe(true);
    });
  });

  describe('endpoint', () => {
    it('returns default endpoint when not configured', () => {
      const client = new PluginTelemetryClient({}, baseState);
      expect(client.endpoint).toBe('https://telemetry.clawvitals.io/ping');
    });

    it('returns custom endpoint when configured', () => {
      const config: PluginConfig = { telemetry: { endpoint: 'https://custom.example.com/ping' } };
      const client = new PluginTelemetryClient(config, baseState);
      expect(client.endpoint).toBe('https://custom.example.com/ping');
    });

    it('falls back to default when endpoint does not start with https://', () => {
      const config: PluginConfig = { telemetry: { endpoint: 'http://insecure.example.com/ping' } };
      const client = new PluginTelemetryClient(config, baseState);
      expect(client.endpoint).toBe('https://telemetry.clawvitals.io/ping');
    });

    it('falls back to default when endpoint is empty string', () => {
      const config: PluginConfig = { telemetry: { endpoint: '' } };
      const client = new PluginTelemetryClient(config, baseState);
      expect(client.endpoint).toBe('https://telemetry.clawvitals.io/ping');
    });
  });

  describe('ping', () => {
    let fetchSpy: jest.SpyInstance;

    beforeEach(() => {
      fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        status: 200,
      } as Response);
    });

    afterEach(() => {
      fetchSpy.mockRestore();
    });

    it('calls fetch when telemetry is enabled', async () => {
      const client = new PluginTelemetryClient({}, baseState);
      await client.ping(baseScan);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('does not call fetch when telemetry is disabled', async () => {
      const config: PluginConfig = { telemetry: { enabled: false } };
      const client = new PluginTelemetryClient(config, baseState);
      await client.ping(baseScan);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('sends GET request to the endpoint', async () => {
      const client = new PluginTelemetryClient({}, baseState);
      await client.ping(baseScan);
      const url = fetchSpy.mock.calls[0][0] as string;
      expect(url).toContain('https://telemetry.clawvitals.io/ping');
    });

    it('includes required query parameters', async () => {
      const client = new PluginTelemetryClient({}, baseState);
      await client.ping(baseScan);
      const url = fetchSpy.mock.calls[0][0] as string;
      expect(url).toContain('v=0.1.0');
      expect(url).toContain('lv=1.0.0');
      expect(url).toContain('b=amber');
      expect(url).toContain('sf=2');
      expect(url).toContain('sp=4');
      expect(url).toContain('iid=00000000-0000-4000-8000-000000000001');
    });

    it('sends sc=1 for scheduled scans', async () => {
      const client = new PluginTelemetryClient({}, baseState);
      await client.ping({ ...baseScan, is_scheduled: true });
      const url = fetchSpy.mock.calls[0][0] as string;
      expect(url).toContain('sc=1');
    });

    it('sends sc=0 for manual scans', async () => {
      const client = new PluginTelemetryClient({}, baseState);
      await client.ping({ ...baseScan, is_scheduled: false });
      const url = fetchSpy.mock.calls[0][0] as string;
      expect(url).toContain('sc=0');
    });

    it('sends s=nd for insufficient_data score', async () => {
      const client = new PluginTelemetryClient({}, baseState);
      await client.ping({ ...baseScan, score: 'insufficient_data' });
      const url = fetchSpy.mock.calls[0][0] as string;
      expect(url).toContain('s=nd');
    });

    it('includes alias when configured', async () => {
      const config: PluginConfig = { telemetry: { alias: 'prod-server-1' } };
      const client = new PluginTelemetryClient(config, baseState);
      await client.ping(baseScan);
      const url = fetchSpy.mock.calls[0][0] as string;
      expect(url).toContain('alias=prod-server-1');
    });

    it('does not include alias when not configured', async () => {
      const client = new PluginTelemetryClient({}, baseState);
      await client.ping(baseScan);
      const url = fetchSpy.mock.calls[0][0] as string;
      expect(url).not.toContain('alias=');
    });

    it('never includes hostname, username, or machine identifiers', async () => {
      const config: PluginConfig = { telemetry: { alias: 'safe-name' } };
      const client = new PluginTelemetryClient(config, baseState);
      await client.ping(baseScan);
      const url = fetchSpy.mock.calls[0][0] as string;
      // Should not contain system-derived identifiers
      const os = require('os');
      expect(url).not.toContain(os.hostname());
      expect(url).not.toContain(os.userInfo().username);
    });

    it('swallows fetch errors silently', async () => {
      fetchSpy.mockRejectedValue(new Error('Network error'));
      const client = new PluginTelemetryClient({}, baseState);
      // Must not throw
      await expect(client.ping(baseScan)).resolves.not.toThrow();
    });

    it('swallows non-200 responses silently', async () => {
      fetchSpy.mockResolvedValue({ ok: false, status: 500 } as Response);
      const client = new PluginTelemetryClient({}, baseState);
      await expect(client.ping(baseScan)).resolves.not.toThrow();
    });

    it('uses custom endpoint when configured', async () => {
      const config: PluginConfig = { telemetry: { endpoint: 'https://self-hosted.example.com/ping' } };
      const client = new PluginTelemetryClient(config, baseState);
      await client.ping(baseScan);
      const url = fetchSpy.mock.calls[0][0] as string;
      expect(url).toContain('https://self-hosted.example.com/ping');
    });

    it('truncates alias at 64 chars', async () => {
      const longAlias = 'a'.repeat(100);
      const config: PluginConfig = { telemetry: { alias: longAlias } };
      const client = new PluginTelemetryClient(config, baseState);
      await client.ping(baseScan);
      const url = fetchSpy.mock.calls[0][0] as string;
      const aliasParam = new URL(url).searchParams.get('alias');
      expect(aliasParam!.length).toBeLessThanOrEqual(64);
    });
  });
});
