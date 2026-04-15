/**
 * disk-encryption.ts — Checks whether full disk encryption is enabled.
 */

import { execSync } from 'node:child_process';
import * as os from 'node:os';
import type { DiskEncryptionResult } from '../../types';

function checkMacOS(): DiskEncryptionResult {
  try {
    const output = execSync('fdesetup status', { encoding: 'utf8', timeout: 5000 });
    const encrypted = output.includes('FileVault is On');
    return { ok: true, platform: 'macos', encrypted, error: null };
  } catch {
    return { ok: true, platform: 'macos', encrypted: false, error: null };
  }
}

function checkLinux(): DiskEncryptionResult {
  try {
    const output = execSync('lsblk -f', { encoding: 'utf8', timeout: 5000 });
    const encrypted = output.includes('crypto_LUKS');
    return { ok: true, platform: 'linux', encrypted, error: null };
  } catch {
    return { ok: true, platform: 'linux', encrypted: false, error: null };
  }
}

export function collectDiskEncryption(): DiskEncryptionResult {
  try {
    const platform = os.platform();
    if (platform === 'darwin') return checkMacOS();
    if (platform === 'linux') return checkLinux();
    return { ok: true, platform: 'unknown', encrypted: false, error: null };
  } catch (err) {
    return { ok: false, platform: 'unknown', encrypted: false, error: (err as Error).message };
  }
}
