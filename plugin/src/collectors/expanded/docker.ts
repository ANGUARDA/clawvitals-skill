/**
 * docker.ts — Inspects running Docker containers for privilege escalation risks.
 *
 * Checks for: privileged mode, root user, and dangerous Linux capabilities
 * (SYS_ADMIN, NET_ADMIN, ALL). Caps at {@link MAX_CONTAINERS} containers to
 * bound execution time. Docker not being installed results in a graceful SKIP.
 */

import { runExpanded } from './runner';
import type { DockerResult, DockerContainer } from '../../types';

const MAX_CONTAINERS = 20;
const DANGEROUS_CAPS = ['SYS_ADMIN', 'NET_ADMIN', 'ALL'];

/** Validates that a string looks like a Docker container short/long ID (hex only). */
const CONTAINER_ID_RE = /^[0-9a-f]+$/i;

/**
 * Collect Docker container security posture.
 * Returns details on privileged, root-user, and dangerous-cap containers.
 * Returns docker_available=false when Docker is not installed or not running.
 */
export function collectDocker(): DockerResult {
  try {
    let ids: string;
    try {
      ids = runExpanded('docker ps --format "{{.ID}}"', 5000);
    } catch {
      // Docker not installed or not running
      return { ok: true, docker_available: false, containers: [], error: null };
    }

    const containerIds = ids
      .split('\n')
      .map(l => l.trim())
      .filter(l => l.length > 0 && CONTAINER_ID_RE.test(l))
      .slice(0, MAX_CONTAINERS);
    if (containerIds.length === 0) {
      return { ok: true, docker_available: true, containers: [], error: null };
    }

    const containers: DockerContainer[] = [];

    for (const id of containerIds) {
      try {
        const raw = runExpanded(`docker inspect ${id}`, 5000);
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
