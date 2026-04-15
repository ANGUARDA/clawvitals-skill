/**
 * secrets-history.ts — Scans shell history files for API key patterns.
 *
 * NEVER includes actual secret values in results — only pattern name + file + line number.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { SecretsHistoryResult, SecretFinding } from '../../types';
import { SECRET_PATTERNS } from './secrets-files';

const HISTORY_FILES = ['.zsh_history', '.bash_history'];

function scanFile(filePath: string): SecretFinding[] {
  const findings: SecretFinding[] = [];
  try {
    if (!fs.existsSync(filePath)) return findings;
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      for (const { name, regex } of SECRET_PATTERNS) {
        if (regex.test(lines[i])) {
          findings.push({
            file: filePath,
            pattern: name,
            line_hint: i + 1,
          });
        }
      }
    }
  } catch {
    // File unreadable — skip silently
  }
  return findings;
}

export function collectSecretsHistory(): SecretsHistoryResult {
  try {
    const home = os.homedir();
    const findings: SecretFinding[] = [];

    for (const file of HISTORY_FILES) {
      findings.push(...scanFile(path.join(home, file)));
    }

    return { ok: true, findings, error: null };
  } catch (err) {
    return { ok: false, findings: [], error: (err as Error).message };
  }
}
