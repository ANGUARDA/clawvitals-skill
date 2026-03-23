/**
 * config.test.ts — Tests for ConfigManager class.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { ConfigManager } from '../../src/config/index';
import { DEFAULT_CONFIG, WORKSPACE_DIR, EXCLUSION_STALE_DAYS } from '../../src/constants';

describe('ConfigManager', () => {
  let tmpDir: string;
  let manager: ConfigManager;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clawvitals-test-'));
    manager = new ConfigManager(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('getConfig', () => {
    it('returns defaults on first call', () => {
      const config = manager.getConfig();
      expect(config.host_name).toBe(DEFAULT_CONFIG.host_name);
      expect(config.retention_days).toBe(DEFAULT_CONFIG.retention_days);
      expect(config.telemetry_enabled).toBe(false);
    });

    it('creates config file on first call', () => {
      manager.getConfig();
      const configPath = path.join(tmpDir, WORKSPACE_DIR, 'config.json');
      expect(fs.existsSync(configPath)).toBe(true);
    });

    it('returns saved config on subsequent calls', () => {
      manager.setConfig({ host_name: 'my-host' });
      const config = manager.getConfig();
      expect(config.host_name).toBe('my-host');
    });

    it('merges partial saved config with defaults', () => {
      const configPath = path.join(tmpDir, WORKSPACE_DIR);
      fs.mkdirSync(configPath, { recursive: true });
      fs.writeFileSync(
        path.join(configPath, 'config.json'),
        JSON.stringify({ host_name: 'partial-host' })
      );
      const config = manager.getConfig();
      expect(config.host_name).toBe('partial-host');
      expect(config.retention_days).toBe(DEFAULT_CONFIG.retention_days);
    });
  });

  describe('setConfig', () => {
    it('updates specific fields', () => {
      manager.setConfig({ host_name: 'updated-host', retention_days: 30 });
      const config = manager.getConfig();
      expect(config.host_name).toBe('updated-host');
      expect(config.retention_days).toBe(30);
    });

    it('preserves other fields when updating', () => {
      manager.setConfig({ host_name: 'first' });
      manager.setConfig({ retention_days: 60 });
      const config = manager.getConfig();
      expect(config.host_name).toBe('first');
      expect(config.retention_days).toBe(60);
    });
  });

  describe('getUsage', () => {
    it('initializes usage state on first call', () => {
      const usage = manager.getUsage();
      expect(usage.install_id).toBeDefined();
      expect(usage.total_runs).toBe(0);
      expect(usage.manual_runs).toBe(0);
      expect(usage.last_run_at).toBeNull();
      expect(usage.schedule_enabled).toBe(false);
      expect(usage.telemetry_prompt_state).toBe('not_shown');
    });

    it('generates a UUID for install_id', () => {
      const usage = manager.getUsage();
      expect(usage.install_id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      );
    });

    it('creates usage file on first call', () => {
      manager.getUsage();
      const usagePath = path.join(tmpDir, WORKSPACE_DIR, 'usage.json');
      expect(fs.existsSync(usagePath)).toBe(true);
    });
  });

  describe('updateUsage', () => {
    it('updates specific fields', () => {
      manager.getUsage(); // initialize
      manager.updateUsage({ total_runs: 5, last_run_at: '2026-03-20T00:00:00Z' });
      const usage = manager.getUsage();
      expect(usage.total_runs).toBe(5);
      expect(usage.last_run_at).toBe('2026-03-20T00:00:00Z');
    });

    it('preserves install_id on update', () => {
      const initial = manager.getUsage();
      manager.updateUsage({ total_runs: 1 });
      const updated = manager.getUsage();
      expect(updated.install_id).toBe(initial.install_id);
    });
  });

  describe('exclusions', () => {
    it('returns empty array when no exclusions', () => {
      const exclusions = manager.getExclusions();
      expect(exclusions).toEqual([]);
    });

    it('adds and retrieves exclusions', () => {
      manager.addExclusion({
        controlId: 'NC-OC-003',
        reason: 'Test exclusion',
        created_at: '2026-03-20T00:00:00Z',
      });
      const exclusions = manager.getExclusions();
      expect(exclusions).toHaveLength(1);
      expect(exclusions[0].controlId).toBe('NC-OC-003');
      expect(exclusions[0].reason).toBe('Test exclusion');
    });

    it('adds multiple exclusions', () => {
      manager.addExclusion({
        controlId: 'NC-OC-003',
        reason: 'First',
        created_at: '2026-03-20T00:00:00Z',
      });
      manager.addExclusion({
        controlId: 'NC-OC-004',
        reason: 'Second',
        created_at: '2026-03-20T00:00:00Z',
      });
      const exclusions = manager.getExclusions();
      expect(exclusions).toHaveLength(2);
    });
  });

  describe('isExclusionActive', () => {
    it('returns true for exclusion without expiry', () => {
      const active = manager.isExclusionActive({
        controlId: 'NC-OC-003',
        reason: 'Permanent',
        created_at: '2026-01-01T00:00:00Z',
      });
      expect(active).toBe(true);
    });

    it('returns true for exclusion with future expiry', () => {
      const futureDate = new Date(Date.now() + 86400000).toISOString();
      const active = manager.isExclusionActive({
        controlId: 'NC-OC-003',
        reason: 'Temporary',
        created_at: '2026-03-20T00:00:00Z',
        expires: futureDate,
      });
      expect(active).toBe(true);
    });

    it('returns false for exclusion with past expiry', () => {
      const active = manager.isExclusionActive({
        controlId: 'NC-OC-003',
        reason: 'Expired',
        created_at: '2025-01-01T00:00:00Z',
        expires: '2025-06-01T00:00:00Z',
      });
      expect(active).toBe(false);
    });
  });

  describe('hasStaleExclusions', () => {
    it('returns false when no exclusions', () => {
      expect(manager.hasStaleExclusions()).toBe(false);
    });

    it('returns false for exclusion with expiry', () => {
      manager.addExclusion({
        controlId: 'NC-OC-003',
        reason: 'Has expiry',
        created_at: '2020-01-01T00:00:00Z',
        expires: '2030-01-01T00:00:00Z',
      });
      expect(manager.hasStaleExclusions()).toBe(false);
    });

    it('returns true for old exclusion without expiry', () => {
      const oldDate = new Date(
        Date.now() - (EXCLUSION_STALE_DAYS + 1) * 24 * 60 * 60 * 1000
      ).toISOString();
      manager.addExclusion({
        controlId: 'NC-OC-003',
        reason: 'Old and stale',
        created_at: oldDate,
      });
      expect(manager.hasStaleExclusions()).toBe(true);
    });

    it('returns false for recent exclusion without expiry', () => {
      manager.addExclusion({
        controlId: 'NC-OC-003',
        reason: 'Recent',
        created_at: new Date().toISOString(),
      });
      expect(manager.hasStaleExclusions()).toBe(false);
    });
  });

  describe('isFirstRun', () => {
    it('returns true before any usage initialization', () => {
      expect(manager.isFirstRun()).toBe(true);
    });

    it('returns true when usage exists but last_run_at is null', () => {
      manager.getUsage(); // creates usage.json with last_run_at: null
      expect(manager.isFirstRun()).toBe(true);
    });

    it('returns false after last_run_at is set', () => {
      manager.getUsage();
      manager.updateUsage({ last_run_at: '2026-03-20T00:00:00Z' });
      expect(manager.isFirstRun()).toBe(false);
    });
  });
});
