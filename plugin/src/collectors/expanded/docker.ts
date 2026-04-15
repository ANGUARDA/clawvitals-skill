/**
 * docker.ts — Inspects running Docker containers for privilege escalation risks.
 */

import { execSync } from 'node:child_process';
import type { DockerResult, DockerContainer } from '../../types';

const MAX_CONTAINERS = 20;
const DANGEROUS_CAPS = ['SYS_ADMIN', 'NET_ADMIN', 'ALL'];

export function collectDocker(): DockerResult {
  try {
    let ids: string;
    try {
      ids = execSync('docker ps --format "{{.ID}}"', { encoding: 'utf8', timeout: 5000 });
    } catch {
      // Docker not installed or not running
      return { ok: true, docker_available: false, containers: [], error: null };
    }

    const containerIds = ids.split('\n').filter(l => l.trim().length > 0).slice(0, MAX_CONTAINERS);
    if (containerIds.length === 0) {
      return { ok: true, docker_available: true, containers: [], error: null };
    }

    const containers: DockerContainer[] = [];

    for (const id of containerIds) {
      try {
        const raw = execSync(`docker inspect ${id}`, { encoding: 'utf8', timeout: 5000 });
        const inspected = JSON.parse(raw) as Array<{
          Id: string;
          Name: string;
          HostConfig?: { Privileged?: boolean; CapAdd?: string[] | null };
          Config?: { User?: string };
        }>;

        const info = inspected[0];
        if (!info) continue;

        const privileged = info.HostConfig?.Privileged === true;
        const user = info.Config?.User ?? '';
        const rootUser = user === '' || user === 'root' || user === '0';
        const capAdd = info.HostConfig?.CapAdd ?? [];
        const dangerousCaps = capAdd.filter(c => DANGEROUS_CAPS.includes(c));

        containers.push({
          id: id.trim(),
          name: (info.Name ?? '').replace(/^\//, ''),
          privileged,
          root_user: rootUser,
          dangerous_caps: dangerousCaps,
        });
      } catch {
        // Skip containers that fail to inspect
      }
    }

    return { ok: true, docker_available: true, containers, error: null };
  } catch (err) {
    return { ok: false, docker_available: false, containers: [], error: (err as Error).message };
  }
}
