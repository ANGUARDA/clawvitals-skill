/**
 * cloudflare-tunnel.ts — Reads ~/.cloudflared/config.yml to check for unauthenticated ingress.
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { CloudflareTunnelResult } from '../../types';

export function collectCloudflareTunnel(): CloudflareTunnelResult {
  try {
    const configPath = path.join(os.homedir(), '.cloudflared', 'config.yml');

    if (!fs.existsSync(configPath)) {
      return { ok: true, tunnel_found: false, unauthenticated_hostnames: [], error: null };
    }

    const content = fs.readFileSync(configPath, 'utf8');
    const unauthenticated: string[] = [];

    // Simple YAML parsing for ingress rules — look for hostname entries
    // that don't have access.required: true nearby
    const lines = content.split('\n');
    let currentHostname: string | null = null;
    let hasAccessRequired = false;

    for (const line of lines) {
      const hostnameMatch = line.match(/^\s*-?\s*hostname:\s*(.+)/);
      if (hostnameMatch) {
        // Save previous hostname if it lacked access.required
        if (currentHostname && !hasAccessRequired) {
          unauthenticated.push(currentHostname.trim());
        }
        currentHostname = hostnameMatch[1].trim();
        hasAccessRequired = false;
      }

      if (line.match(/access[._]required:\s*true/i)) {
        hasAccessRequired = true;
      }
    }

    // Check last hostname
    if (currentHostname && !hasAccessRequired) {
      unauthenticated.push(currentHostname);
    }

    return {
      ok: true,
      tunnel_found: true,
      unauthenticated_hostnames: unauthenticated,
      error: null,
    };
  } catch (err) {
    return { ok: false, tunnel_found: false, unauthenticated_hostnames: [], error: (err as Error).message };
  }
}
