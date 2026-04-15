/**
 * network.ts — Scans for management ports exposed beyond localhost.
 */

import { execSync } from 'node:child_process';
import type { NetworkResult, ExposedPort } from '../../types';

const MANAGEMENT_PORTS: Array<{ port: number; service: string }> = [
  { port: 22, service: 'SSH' },
  { port: 2375, service: 'Docker API (plaintext)' },
  { port: 2376, service: 'Docker API (TLS)' },
  { port: 8080, service: 'HTTP Proxy/Admin' },
  { port: 9000, service: 'Management Console' },
];

function tryLsof(port: number): { bound: boolean; bind: string } | null {
  try {
    const output = execSync(`lsof -i :${port} -sTCP:LISTEN`, { encoding: 'utf8', timeout: 5000 });
    const lines = output.split('\n').filter(l => l.trim().length > 0);
    for (const line of lines.slice(1)) {
      if (line.match(/\*:\d+|0\.0\.0\.0:\d+|\[::\]:\d+/)) {
        return { bound: true, bind: '0.0.0.0' };
      }
    }
    // Listening but on localhost — not exposed
    if (lines.length > 1) return { bound: false, bind: '127.0.0.1' };
    return null;
  } catch {
    return null;
  }
}

function trySs(port: number): { bound: boolean; bind: string } | null {
  try {
    const output = execSync(`ss -tlnp sport = :${port}`, { encoding: 'utf8', timeout: 5000 });
    const lines = output.split('\n').filter(l => l.trim().length > 0);
    for (const line of lines.slice(1)) {
      if (line.includes('0.0.0.0:') || line.includes('*:') || line.includes('[::]:')) {
        return { bound: true, bind: '0.0.0.0' };
      }
      if (line.includes('127.0.0.1:') || line.includes('[::1]:')) {
        return { bound: false, bind: '127.0.0.1' };
      }
    }
    return null;
  } catch {
    return null;
  }
}

export function collectNetwork(): NetworkResult {
  try {
    const exposed: ExposedPort[] = [];

    for (const { port, service } of MANAGEMENT_PORTS) {
      const result = tryLsof(port) ?? trySs(port);
      if (result?.bound) {
        exposed.push({ port, service, bind: result.bind });
      }
    }

    return { ok: true, exposed_ports: exposed, error: null };
  } catch (err) {
    return { ok: false, exposed_ports: [], error: (err as Error).message };
  }
}
