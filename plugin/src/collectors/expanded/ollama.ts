/**
 * ollama.ts — Checks if Ollama's API port is bound to 0.0.0.0 (externally accessible).
 *
 * Reads OLLAMA_HOST from environment to discover the configured port.
 * Uses `lsof -i :<port>` to detect listening sockets and parses the bind address.
 * Returns bound_to_public=true only when the socket is on 0.0.0.0, [::], or *.
 * If lsof exits non-zero (port not in use), returns a safe default (not bound).
 */

import { runExpanded } from './runner';
import type { OllamaResult } from '../../types';

/** Parse port from OLLAMA_HOST env var. Returns 11434 if unset or unparseable. */
function discoverPort(): number {
  const host = process.env.OLLAMA_HOST;
  if (!host) return 11434;

  // host:port format — port is the part after the last colon
  const colonIdx = host.lastIndexOf(':');
  if (colonIdx !== -1) {
    const portStr = host.slice(colonIdx + 1);
    const port = parseInt(portStr, 10);
    if (!isNaN(port) && port > 0 && port <= 65535) return port;
  }

  // host only (no port) — use default
  return 11434;
}

/**
 * Check whether Ollama's API port is externally accessible.
 * Returns bound_to_public=true when the discovered port is bound to a wildcard address.
 */
export function collectOllama(): OllamaResult {
  const port = discoverPort();

  try {
    const output = runExpanded(`lsof -i :${port}`, 5000);
    const lines = output.split('\n').filter(l => l.trim().length > 0);

    // Skip header line
    const portPattern = new RegExp(`\\*:${port}|0\\.0\\.0\\.0:${port}|\\[::\\]:${port}`);
    const hostPattern = new RegExp(`([\\d.]+):${port}|localhost:${port}|127\\.0\\.0\\.1:${port}`);

    for (const line of lines.slice(1)) {
      if (portPattern.test(line)) {
        return { ok: true, bound_to_public: true, host: '0.0.0.0', port, error: null };
      }

      const hostMatch = line.match(hostPattern);
      if (hostMatch) {
        const host = hostMatch[1] ?? '127.0.0.1';
        return { ok: true, bound_to_public: false, host, port, error: null };
      }
    }

    // Port is open but couldn't parse bind address — assume localhost
    if (lines.length > 1) {
      return { ok: true, bound_to_public: false, host: null, port, error: null };
    }

    // No listeners on port
    return { ok: true, bound_to_public: false, host: null, port, error: null };
  } catch {
    // lsof returns non-zero when no matches — port not in use
    return { ok: true, bound_to_public: false, host: null, port, error: null };
  }
}
