/**
 * secrets-files.ts — Regex-scans ~/.env and ~/.envrc for API key patterns.
 *
 * NEVER includes actual secret values in results — only pattern name + file + line number.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { SecretsFilesResult, SecretFinding } from '../../types';

export const SECRET_PATTERNS: Array<{ name: string; regex: RegExp }> = [
  { name: 'OpenAI', regex: /sk-[a-zA-Z0-9]{20,}/ },
  { name: 'Anthropic', regex: /sk-ant-[a-zA-Z0-9]{20,}/ },
  { name: 'GitHub', regex: /gh[ps]_[a-zA-Z0-9]{36}/ },
  { name: 'AWS', regex: /AKIA[0-9A-Z]{16}/ },
  { name: 'Slack', regex: /xox[baprs]-[a-zA-Z0-9-]{10,}/ },
  { name: 'Generic API Key', regex: /[Aa][Pp][Ii]_?[Kk][Ee][Yy]\s*=\s*[^\s]{10,}/ },
];

const TARGET_FILES = ['.env', '.envrc'];

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

export function collectSecretsFiles(): SecretsFilesResult {
  try {
    const home = os.homedir();
    const findings: SecretFinding[] = [];

    for (const file of TARGET_FILES) {
      findings.push(...scanFile(path.join(home, file)));
    }

    return { ok: true, findings, error: null };
  } catch (err) {
    return { ok: false, findings: [], error: (err as Error).message };
  }
}
