/**
 * controls/expanded-evaluator.ts — ExpandedEvaluator: per-control logic for expanded checks.
 *
 * Evaluates the 8 system-level expanded controls against ExpandedCollectorResult.
 * Results are reported separately from the primary stable score.
 */

import type { ExpandedCollectorResult, ExpandedEvaluation, Severity } from '../types';

interface ControlDef {
  control_id: string;
  name: string;
  severity: Severity;
  remediation: string;
}

const CONTROLS: Record<string, ControlDef> = {
  'NC-OLLAMA-001': {
    control_id: 'NC-OLLAMA-001',
    name: 'Ollama not bound to public interface',
    severity: 'high',
    remediation: 'Bind Ollama to 127.0.0.1 by setting OLLAMA_HOST=127.0.0.1 in your environment.',
  },
  'NC-NET-001': {
    control_id: 'NC-NET-001',
    name: 'No management ports exposed externally',
    severity: 'high',
    remediation: 'Bind management services (SSH, Docker API, etc.) to 127.0.0.1 or use a firewall to restrict access.',
  },
  'NC-SECRET-001': {
    control_id: 'NC-SECRET-001',
    name: 'No API keys in dotfiles',
    severity: 'critical',
    remediation: 'Remove API keys from ~/.env and ~/.envrc. Use a secrets manager or environment-specific config.',
  },
  'NC-SECRET-002': {
    control_id: 'NC-SECRET-002',
    name: 'No API keys in shell history',
    severity: 'medium',
    remediation: 'Clear sensitive entries from shell history. Use environment variables or secrets managers instead of inline keys.',
  },
  'NC-TUNNEL-001': {
    control_id: 'NC-TUNNEL-001',
    name: 'Cloudflare tunnels require authentication',
    severity: 'high',
    remediation: 'Add access.required: true to all ingress rules in ~/.cloudflared/config.yml.',
  },
  'NC-DOCKER-001': {
    control_id: 'NC-DOCKER-001',
    name: 'No privileged or root Docker containers',
    severity: 'high',
    remediation: 'Run containers as non-root users, remove --privileged flag, and avoid SYS_ADMIN/NET_ADMIN/ALL capabilities.',
  },
  'NC-OS-001': {
    control_id: 'NC-OS-001',
    name: 'Automatic OS updates enabled',
    severity: 'medium',
    remediation: 'Enable automatic updates: macOS System Settings > Software Update > Automatic Updates. Linux: configure unattended-upgrades.',
  },
  'NC-OS-002': {
    control_id: 'NC-OS-002',
    name: 'Full disk encryption enabled',
    severity: 'high',
    remediation: 'Enable FileVault (macOS) or LUKS (Linux) to protect data at rest.',
  },
};

export class ExpandedEvaluator {
  evaluate(result: ExpandedCollectorResult): ExpandedEvaluation[] {
    return [
      this.evalOllama(result),
      this.evalNetwork(result),
      this.evalSecretsFiles(result),
      this.evalSecretsHistory(result),
      this.evalTunnel(result),
      this.evalDocker(result),
      this.evalOsUpdates(result),
      this.evalDiskEncryption(result),
    ];
  }

  private evalOllama(r: ExpandedCollectorResult): ExpandedEvaluation {
    const def = CONTROLS['NC-OLLAMA-001'];
    if (!r.ollama.ok) {
      return { ...def, result: 'SKIP', evidence: `Collector error: ${r.ollama.error}`, remediation: def.remediation };
    }
    if (r.ollama.bound_to_public) {
      return { ...def, result: 'FAIL', evidence: `Ollama bound to ${r.ollama.host ?? '0.0.0.0'} (externally accessible)`, remediation: def.remediation };
    }
    return { ...def, result: 'PASS', evidence: 'Ollama not bound to public interface', remediation: def.remediation };
  }

  private evalNetwork(r: ExpandedCollectorResult): ExpandedEvaluation {
    const def = CONTROLS['NC-NET-001'];
    if (!r.network.ok) {
      return { ...def, result: 'ERROR', evidence: `Collector error: ${r.network.error}`, remediation: def.remediation };
    }
    if (r.network.exposed_ports.length > 0) {
      const ports = r.network.exposed_ports.map(p => `${p.port} (${p.service})`).join(', ');
      return { ...def, result: 'FAIL', evidence: `Exposed management ports: ${ports}`, remediation: def.remediation };
    }
    return { ...def, result: 'PASS', evidence: 'No management ports exposed externally', remediation: def.remediation };
  }

  private evalSecretsFiles(r: ExpandedCollectorResult): ExpandedEvaluation {
    const def = CONTROLS['NC-SECRET-001'];
    if (!r.secrets_files.ok) {
      return { ...def, result: 'ERROR', evidence: `Collector error: ${r.secrets_files.error}`, remediation: def.remediation };
    }
    if (r.secrets_files.findings.length > 0) {
      const summary = r.secrets_files.findings.map(f => `${f.pattern} in ${f.file}:${f.line_hint}`).join(', ');
      return { ...def, result: 'FAIL', evidence: `API keys found: ${summary}`, remediation: def.remediation };
    }
    return { ...def, result: 'PASS', evidence: 'No API keys found in dotfiles', remediation: def.remediation };
  }

  private evalSecretsHistory(r: ExpandedCollectorResult): ExpandedEvaluation {
    const def = CONTROLS['NC-SECRET-002'];
    if (!r.secrets_history.ok) {
      return { ...def, result: 'ERROR', evidence: `Collector error: ${r.secrets_history.error}`, remediation: def.remediation };
    }
    if (r.secrets_history.findings.length > 0) {
      const summary = r.secrets_history.findings.map(f => `${f.pattern} in ${f.file}:${f.line_hint}`).join(', ');
      return { ...def, result: 'FAIL', evidence: `API keys found in history: ${summary}`, remediation: def.remediation };
    }
    return { ...def, result: 'PASS', evidence: 'No API keys found in shell history', remediation: def.remediation };
  }

  private evalTunnel(r: ExpandedCollectorResult): ExpandedEvaluation {
    const def = CONTROLS['NC-TUNNEL-001'];
    if (!r.cloudflare_tunnel.ok) {
      return { ...def, result: 'ERROR', evidence: `Collector error: ${r.cloudflare_tunnel.error}`, remediation: def.remediation };
    }
    if (!r.cloudflare_tunnel.tunnel_found) {
      return { ...def, result: 'SKIP', evidence: 'No Cloudflare tunnel configuration found', remediation: def.remediation };
    }
    if (r.cloudflare_tunnel.unauthenticated_hostnames.length > 0) {
      const hosts = r.cloudflare_tunnel.unauthenticated_hostnames.join(', ');
      return { ...def, result: 'FAIL', evidence: `Unauthenticated tunnel hostnames: ${hosts}`, remediation: def.remediation };
    }
    return { ...def, result: 'PASS', evidence: 'All tunnel ingress rules require authentication', remediation: def.remediation };
  }

  private evalDocker(r: ExpandedCollectorResult): ExpandedEvaluation {
    const def = CONTROLS['NC-DOCKER-001'];
    if (!r.docker.ok) {
      return { ...def, result: 'ERROR', evidence: `Collector error: ${r.docker.error}`, remediation: def.remediation };
    }
    if (!r.docker.docker_available) {
      return { ...def, result: 'SKIP', evidence: 'Docker not available', remediation: def.remediation };
    }
    const risky = r.docker.containers.filter(
      c => c.privileged || c.root_user || c.dangerous_caps.length > 0
    );
    if (risky.length > 0) {
      const details = risky.map(c => {
        const issues: string[] = [];
        if (c.privileged) issues.push('privileged');
        if (c.root_user) issues.push('root');
        if (c.dangerous_caps.length > 0) issues.push(`caps: ${c.dangerous_caps.join(',')}`);
        return `${c.name || c.id} (${issues.join(', ')})`;
      }).join('; ');
      return { ...def, result: 'FAIL', evidence: `Risky containers: ${details}`, remediation: def.remediation };
    }
    return { ...def, result: 'PASS', evidence: 'No privileged or root Docker containers', remediation: def.remediation };
  }

  private evalOsUpdates(r: ExpandedCollectorResult): ExpandedEvaluation {
    const def = CONTROLS['NC-OS-001'];
    if (!r.os_updates.ok) {
      return { ...def, result: 'ERROR', evidence: `Collector error: ${r.os_updates.error}`, remediation: def.remediation };
    }
    if (!r.os_updates.auto_updates_enabled) {
      return { ...def, result: 'FAIL', evidence: `Automatic updates not enabled (${r.os_updates.platform})`, remediation: def.remediation };
    }
    return { ...def, result: 'PASS', evidence: `Automatic updates enabled (${r.os_updates.platform})`, remediation: def.remediation };
  }

  private evalDiskEncryption(r: ExpandedCollectorResult): ExpandedEvaluation {
    const def = CONTROLS['NC-OS-002'];
    if (!r.disk_encryption.ok) {
      return { ...def, result: 'ERROR', evidence: `Collector error: ${r.disk_encryption.error}`, remediation: def.remediation };
    }
    if (!r.disk_encryption.encrypted) {
      return { ...def, result: 'FAIL', evidence: `Disk encryption not enabled (${r.disk_encryption.platform})`, remediation: def.remediation };
    }
    return { ...def, result: 'PASS', evidence: `Disk encryption enabled (${r.disk_encryption.platform})`, remediation: def.remediation };
  }
}
