/**
 * network.ts — Scans for management ports exposed beyond localhost.
 *
 * Checks a configurable list of management ports. Uses `lsof` first,
 * falling back to `ss` on Linux. Only flags ports bound to 0.0.0.0/[::]/*
 * as exposed — localhost-only bindings are not reported.
 */

import { runExpanded } from './runner';
import type { NetworkResult, ExposedPort } from '../../types';

export const MANAGEMENT_PORTS: Array<{ port: number; service: string }> = [
  { port: 22, service: 'SSH' },
  { port: 2375, service: 'Docker API (plaintext)' },
  { port: 2376, service: 'Docker API (TLS)' },
  { port: 4000, service: 'Dev/Admin Server' },
  { port: 5000, service: 'API/Dev Server' },
  { port: 8080, service: 'HTTP Proxy/Admin' },
  { port: 8443, service: 'HTTPS Admin' },
  { port: 8888, service: 'Jupyter/Admin' },
  { port: 9000, service: 'Management Console' },
  { port: 9090, service: 'Prometheus/Admin' },
];

/** Attempt to detect a port's bind address via lsof. Returns null if lsof is unavailable. */
function tryLsof(port: number): { bound: boolean; bind: string } | null {
  try {
    const output = runExpanded(`lsof -i :${port} -sTCP:LISTEN`, 5000);
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

/** Attempt to detect a port's bind address via ss (Linux fallback). Returns null if ss is unavailable. */
function trySs(port: number): { bound: boolean; bind: string } | null {
  try {
    const output = runExpanded(`ss -tlnp sport = :${port}`, 5000);
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

/** Validate that a port entry has a safe integer port in 1-65535. */
function isValidPort(entry: { port: number; service: string }): boolean {
  return Number.isInteger(entry.port) && entry.port >= 1 && entry.port <= 65535;
}

/**
 * Scan management ports for external exposure.
 * Returns a list of ports bound to wildcard addresses (0.0.0.0/[::]).
 * @param ports - Optional custom port list. Defaults to MANAGEMENT_PORTS.
 */
export function collectNetwork(ports?: Array<{ port: number; service: string }>): NetworkResult {
  try {
    const portList = ports ?? MANAGEMENT_PORTS;
    const invalid = portList.filter(e => !isValidPort(e));
    const validPorts = portList.filter(isValidPort);
    const exposed: ExposedPort[] = [];

    for (const { port, service } of validPorts) {
      const result = tryLsof(port) ?? trySs(port);
      if (result?.bound) {
        exposed.push({ port, service, bind: result.bind });
      }
    }

    const error = invalid.length > 0
      ? `Skipped invalid extra_ports: ${invalid.map(e => JSON.stringify(e.port)).join(', ')} (must be integer 1-65535)`
      : null;
    return { ok: true, exposed_ports: exposed, error };
  } catch (err) {
    return { ok: false, exposed_ports: [], error: (err as Error).message };
  }
}
