/**
 * cloudflare-tunnel.ts — Checks for unauthenticated tunnel ingress and detects other tunnel processes.
 *
 * Reads cloudflared config from multiple paths to find hostname entries
 * that lack a nearby `access_required: true` directive. Also detects
 * non-Cloudflare tunnel processes (ngrok, bore, frpc, tailscale funnel).
 * If no config file is found, returns tunnel_found=false (SKIP).
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { runExpanded } from './runner';
import type { CloudflareTunnelResult } from '../../types';

const CONFIG_PATHS = [
  () => path.join(os.homedir(), '.cloudflared', 'config.yml'),
  () => '/etc/cloudflared/config.yml',
];

/** Find the first existing cloudflared config path, or null. */
function findConfigPath(): string | null {
  for (const pathFn of CONFIG_PATHS) {
    const p = pathFn();
    if (fs.existsSync(p)) return p;
  }
  return null;
}

/**
 * Block-aware YAML parsing for ingress rules.
 * First: identify YAML list item boundaries (lines starting with `- `).
 * Then: for each hostname, find its containing list item and check for access_required.
 */
function parseUnauthenticatedHostnames(content: string): string[] {
  const lines = content.split('\n');

  // Find list item start indices (lines matching /^\s*- /)
  const itemStarts: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (/^\s*-\s/.test(lines[i])) {
      itemStarts.push(i);
    }
  }

  // For each list item, extract hostname and check for access_required
  const unauthenticated: string[] = [];
  for (let s = 0; s < itemStarts.length; s++) {
    const blockStart = itemStarts[s];
    const blockEnd = s + 1 < itemStarts.length ? itemStarts[s + 1] : lines.length;

    let hostname: string | null = null;
    let hasAccessRequired = false;

    for (let i = blockStart; i < blockEnd; i++) {
      const hostnameMatch = lines[i].match(/hostname:\s*(.+)/);
      if (hostnameMatch) {
        hostname = hostnameMatch[1].trim();
      }
      if (/access[._]required:\s*true/i.test(lines[i])) {
        hasAccessRequired = true;
      }
    }

    if (hostname && !hasAccessRequired) {
      unauthenticated.push(hostname);
    }
  }

  return unauthenticated;
}

/** Detect other tunnel processes via ps aux and tailscale funnel status. */
function detectOtherTunnels(cfConfigFound: boolean): string[] {
  const tunnels: string[] = [];

  try {
    const psOutput = runExpanded('ps aux', 3000);
    const processes = ['ngrok', 'bore', 'frpc'];
    if (!cfConfigFound) processes.push('cloudflared');

    for (const proc of processes) {
      // Match process name but not our own grep/ps command
      if (psOutput.split('\n').some(line => line.includes(proc) && !line.includes('ps aux'))) {
        tunnels.push(proc);
      }
    }
  } catch {
    // ps not available — skip silently
  }

  try {
    const funnelOutput = runExpanded('tailscale funnel status', 3000);
    if (funnelOutput.trim().length > 0) {
      tunnels.push('tailscale funnel');
    }
  } catch {
    // tailscale not installed or funnel not active — skip silently
  }

  return tunnels;
}

/**
 * Check cloudflared config for ingress rules that lack authentication,
 * and detect other tunnel processes.
 */
export function collectCloudflareTunnel(): CloudflareTunnelResult {
  try {
    const configPath = findConfigPath();
    const otherTunnels = detectOtherTunnels(configPath !== null);

    if (!configPath) {
      return { ok: true, tunnel_found: false, unauthenticated_hostnames: [], other_tunnels_detected: otherTunnels, error: null };
    }

    const content = fs.readFileSync(configPath, 'utf8');
    const unauthenticated = parseUnauthenticatedHostnames(content);

    return {
      ok: true,
      tunnel_found: true,
      unauthenticated_hostnames: unauthenticated,
      other_tunnels_detected: otherTunnels,
      error: null,
    };
  } catch (err) {
    return { ok: false, tunnel_found: false, unauthenticated_hostnames: [], other_tunnels_detected: [], error: (err as Error).message };
  }
}
