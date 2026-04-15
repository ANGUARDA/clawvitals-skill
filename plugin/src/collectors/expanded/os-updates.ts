/**
 * os-updates.ts — Checks whether automatic OS updates are enabled.
 */

import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import type { OsUpdatesResult } from '../../types';

function checkMacOS(): OsUpdatesResult {
  try {
    const output = execSync('softwareupdate -l 2>&1', { encoding: 'utf8', timeout: 30000 });
    // If output says "No new software available", auto-updates are working
    const upToDate = output.includes('No new software available');
    return { ok: true, platform: 'macos', auto_updates_enabled: upToDate, error: null };
  } catch {
    // Command failed — can't determine
    return { ok: true, platform: 'macos', auto_updates_enabled: false, error: null };
  }
}

function checkLinux(): OsUpdatesResult {
  try {
    const configPath = '/etc/apt/apt.conf.d/20auto-upgrades';
    if (!fs.existsSync(configPath)) {
      return { ok: true, platform: 'linux', auto_updates_enabled: false, error: null };
    }
    const content = fs.readFileSync(configPath, 'utf8');
    const enabled = content.includes('Unattended-Upgrade "1"');
    return { ok: true, platform: 'linux', auto_updates_enabled: enabled, error: null };
  } catch {
    return { ok: true, platform: 'linux', auto_updates_enabled: false, error: null };
  }
}

export function collectOsUpdates(): OsUpdatesResult {
  try {
    const platform = os.platform();
    if (platform === 'darwin') return checkMacOS();
    if (platform === 'linux') return checkLinux();
    return { ok: true, platform: 'unknown', auto_updates_enabled: false, error: null };
  } catch (err) {
    return { ok: false, platform: 'unknown', auto_updates_enabled: false, error: (err as Error).message };
  }
}
