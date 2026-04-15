/**
 * ollama.ts — Checks if Ollama's port 11434 is bound to 0.0.0.0 (externally accessible).
 */

import { execSync } from 'node:child_process';
import type { OllamaResult } from '../../types';

export function collectOllama(): OllamaResult {
  try {
    const output = execSync('lsof -i :11434', { encoding: 'utf8', timeout: 5000 });
    const lines = output.split('\n').filter(l => l.trim().length > 0);

    // Skip header line
    for (const line of lines.slice(1)) {
      const match = line.match(/\*:11434|0\.0\.0\.0:11434|\[::\]:11434/);
      if (match) {
        return { ok: true, bound_to_public: true, host: '0.0.0.0', error: null };
      }

      const hostMatch = line.match(/([\d.]+):11434|localhost:11434|127\.0\.0\.1:11434/);
      if (hostMatch) {
        const host = hostMatch[1] ?? '127.0.0.1';
        return { ok: true, bound_to_public: false, host, error: null };
      }
    }

    // Port is open but couldn't parse bind address — assume localhost
    if (lines.length > 1) {
      return { ok: true, bound_to_public: false, host: null, error: null };
    }

    // No listeners on 11434
    return { ok: true, bound_to_public: false, host: null, error: null };
  } catch {
    // lsof returns non-zero when no matches — port not in use
    return { ok: true, bound_to_public: false, host: null, error: null };
  }
}
