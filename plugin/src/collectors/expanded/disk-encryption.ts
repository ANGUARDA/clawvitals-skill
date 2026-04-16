/**
 * disk-encryption.ts — Checks whether full disk encryption is enabled.
 *
 * macOS: runs `fdesetup status` and checks for "FileVault is On".
 * Linux: runs `lsblk -f` and checks for `crypto_LUKS`.
 * Unknown platforms return platform='unknown' so the evaluator can SKIP.
 */

import { runExpanded } from './runner';
import * as os from 'node:os';
import type { DiskEncryptionResult } from '../../types';

/** Check macOS FileVault status. */
function checkMacOS(): DiskEncryptionResult {
  try {
    const output = runExpanded('fdesetup status', 5000);
    const encrypted = output.includes('FileVault is On');
    return { ok: true, platform: 'macos', encrypted, error: null };
  } catch {
    return { ok: true, platform: 'macos', encrypted: false, error: null };
  }
}

/** Check Linux LUKS encryption via lsblk. */
function checkLinux(): DiskEncryptionResult {
  try {
    const output = runExpanded('lsblk -f', 5000);
    const encrypted = output.includes('crypto_LUKS');
    return { ok: true, platform: 'linux', encrypted, error: null };
  } catch {
    return { ok: true, platform: 'linux', encrypted: false, error: null };
  }
}

/**
 * Check whether full disk encryption is enabled.
 * Returns platform='unknown' for unsupported platforms (evaluator will SKIP).
 */
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
