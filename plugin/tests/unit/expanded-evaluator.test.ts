/**
 * expanded-evaluator.test.ts — Unit tests for ExpandedEvaluator.
 */

import { ExpandedEvaluator } from '../../src/controls/expanded-evaluator';
import type { ExpandedCollectorResult } from '../../src/types';

function makeBaseResult(): ExpandedCollectorResult {
  return {
    ollama: { ok: true, bound_to_public: false, host: '127.0.0.1', error: null },
    network: { ok: true, exposed_ports: [], error: null },
    secrets_files: { ok: true, findings: [], error: null },
    secrets_history: { ok: true, findings: [], error: null },
    cloudflare_tunnel: { ok: true, tunnel_found: false, unauthenticated_hostnames: [], error: null },
    docker: { ok: true, docker_available: false, containers: [], error: null },
    os_updates: { ok: true, platform: 'macos', auto_updates_enabled: true, error: null },
    disk_encryption: { ok: true, platform: 'macos', encrypted: true, error: null },
  };
}

describe('ExpandedEvaluator', () => {
  const evaluator = new ExpandedEvaluator();

  it('returns 8 evaluations', () => {
    const result = evaluator.evaluate(makeBaseResult());
    expect(result).toHaveLength(8);
  });

  // ── NC-OLLAMA-001 ──────────────────────────────────────────────

  describe('NC-OLLAMA-001', () => {
    it('PASS when ollama not bound to public', () => {
      const r = makeBaseResult();
      const evals = evaluator.evaluate(r);
      const e = evals.find(e => e.control_id === 'NC-OLLAMA-001')!;
      expect(e.result).toBe('PASS');
    });

    it('FAIL when ollama bound to 0.0.0.0', () => {
      const r = makeBaseResult();
      r.ollama = { ok: true, bound_to_public: true, host: '0.0.0.0', error: null };
      const evals = evaluator.evaluate(r);
      const e = evals.find(e => e.control_id === 'NC-OLLAMA-001')!;
      expect(e.result).toBe('FAIL');
    });

    it('SKIP when collector fails', () => {
      const r = makeBaseResult();
      r.ollama = { ok: false, bound_to_public: false, host: null, error: 'timeout' };
      const evals = evaluator.evaluate(r);
      const e = evals.find(e => e.control_id === 'NC-OLLAMA-001')!;
      expect(e.result).toBe('SKIP');
    });
  });

  // ── NC-NET-001 ─────────────────────────────────────────────────

  describe('NC-NET-001', () => {
    it('PASS when no exposed ports', () => {
      const r = makeBaseResult();
      const evals = evaluator.evaluate(r);
      const e = evals.find(e => e.control_id === 'NC-NET-001')!;
      expect(e.result).toBe('PASS');
    });

    it('FAIL when ports are exposed', () => {
      const r = makeBaseResult();
      r.network = {
        ok: true,
        exposed_ports: [{ port: 22, service: 'SSH', bind: '0.0.0.0' }],
        error: null,
      };
      const evals = evaluator.evaluate(r);
      const e = evals.find(e => e.control_id === 'NC-NET-001')!;
      expect(e.result).toBe('FAIL');
      expect(e.evidence).toContain('22');
    });
  });

  // ── NC-SECRET-001 ──────────────────────────────────────────────

  describe('NC-SECRET-001', () => {
    it('PASS when no secrets found', () => {
      const r = makeBaseResult();
      const evals = evaluator.evaluate(r);
      const e = evals.find(e => e.control_id === 'NC-SECRET-001')!;
      expect(e.result).toBe('PASS');
    });

    it('FAIL when secrets found', () => {
      const r = makeBaseResult();
      r.secrets_files = {
        ok: true,
        findings: [{ file: '~/.env', pattern: 'OpenAI', line_hint: 3 }],
        error: null,
      };
      const evals = evaluator.evaluate(r);
      const e = evals.find(e => e.control_id === 'NC-SECRET-001')!;
      expect(e.result).toBe('FAIL');
    });
  });

  // ── NC-SECRET-002 ──────────────────────────────────────────────

  describe('NC-SECRET-002', () => {
    it('PASS when no secrets in history', () => {
      const r = makeBaseResult();
      const evals = evaluator.evaluate(r);
      const e = evals.find(e => e.control_id === 'NC-SECRET-002')!;
      expect(e.result).toBe('PASS');
    });

    it('FAIL when secrets found in history', () => {
      const r = makeBaseResult();
      r.secrets_history = {
        ok: true,
        findings: [{ file: '~/.bash_history', pattern: 'AWS', line_hint: 100 }],
        error: null,
      };
      const evals = evaluator.evaluate(r);
      const e = evals.find(e => e.control_id === 'NC-SECRET-002')!;
      expect(e.result).toBe('FAIL');
    });
  });

  // ── NC-TUNNEL-001 ──────────────────────────────────────────────

  describe('NC-TUNNEL-001', () => {
    it('SKIP when no tunnel found', () => {
      const r = makeBaseResult();
      const evals = evaluator.evaluate(r);
      const e = evals.find(e => e.control_id === 'NC-TUNNEL-001')!;
      expect(e.result).toBe('SKIP');
    });

    it('PASS when tunnel has auth', () => {
      const r = makeBaseResult();
      r.cloudflare_tunnel = {
        ok: true,
        tunnel_found: true,
        unauthenticated_hostnames: [],
        error: null,
      };
      const evals = evaluator.evaluate(r);
      const e = evals.find(e => e.control_id === 'NC-TUNNEL-001')!;
      expect(e.result).toBe('PASS');
    });

    it('FAIL when tunnel has unauthenticated hostnames', () => {
      const r = makeBaseResult();
      r.cloudflare_tunnel = {
        ok: true,
        tunnel_found: true,
        unauthenticated_hostnames: ['app.example.com'],
        error: null,
      };
      const evals = evaluator.evaluate(r);
      const e = evals.find(e => e.control_id === 'NC-TUNNEL-001')!;
      expect(e.result).toBe('FAIL');
      expect(e.evidence).toContain('app.example.com');
    });
  });

  // ── NC-DOCKER-001 ──────────────────────────────────────────────

  describe('NC-DOCKER-001', () => {
    it('SKIP when docker not available', () => {
      const r = makeBaseResult();
      const evals = evaluator.evaluate(r);
      const e = evals.find(e => e.control_id === 'NC-DOCKER-001')!;
      expect(e.result).toBe('SKIP');
    });

    it('PASS when docker available but no risky containers', () => {
      const r = makeBaseResult();
      r.docker = {
        ok: true,
        docker_available: true,
        containers: [{
          id: 'abc', name: 'safe', privileged: false, root_user: false, dangerous_caps: [],
        }],
        error: null,
      };
      const evals = evaluator.evaluate(r);
      const e = evals.find(e => e.control_id === 'NC-DOCKER-001')!;
      expect(e.result).toBe('PASS');
    });

    it('FAIL when privileged container exists', () => {
      const r = makeBaseResult();
      r.docker = {
        ok: true,
        docker_available: true,
        containers: [{
          id: 'abc', name: 'risky', privileged: true, root_user: false, dangerous_caps: [],
        }],
        error: null,
      };
      const evals = evaluator.evaluate(r);
      const e = evals.find(e => e.control_id === 'NC-DOCKER-001')!;
      expect(e.result).toBe('FAIL');
    });

    it('FAIL when root user container exists', () => {
      const r = makeBaseResult();
      r.docker = {
        ok: true,
        docker_available: true,
        containers: [{
          id: 'def', name: 'rootbox', privileged: false, root_user: true, dangerous_caps: [],
        }],
        error: null,
      };
      const evals = evaluator.evaluate(r);
      const e = evals.find(e => e.control_id === 'NC-DOCKER-001')!;
      expect(e.result).toBe('FAIL');
    });

    it('FAIL when container has dangerous caps', () => {
      const r = makeBaseResult();
      r.docker = {
        ok: true,
        docker_available: true,
        containers: [{
          id: 'ghi', name: 'capbox', privileged: false, root_user: false, dangerous_caps: ['SYS_ADMIN'],
        }],
        error: null,
      };
      const evals = evaluator.evaluate(r);
      const e = evals.find(e => e.control_id === 'NC-DOCKER-001')!;
      expect(e.result).toBe('FAIL');
    });
  });

  // ── NC-OS-001 ──────────────────────────────────────────────────

  describe('NC-OS-001', () => {
    it('PASS when auto updates enabled', () => {
      const r = makeBaseResult();
      const evals = evaluator.evaluate(r);
      const e = evals.find(e => e.control_id === 'NC-OS-001')!;
      expect(e.result).toBe('PASS');
    });

    it('FAIL when auto updates disabled', () => {
      const r = makeBaseResult();
      r.os_updates = { ok: true, platform: 'macos', auto_updates_enabled: false, error: null };
      const evals = evaluator.evaluate(r);
      const e = evals.find(e => e.control_id === 'NC-OS-001')!;
      expect(e.result).toBe('FAIL');
    });
  });

  // ── NC-OS-002 ──────────────────────────────────────────────────

  describe('NC-OS-002', () => {
    it('PASS when disk encrypted', () => {
      const r = makeBaseResult();
      const evals = evaluator.evaluate(r);
      const e = evals.find(e => e.control_id === 'NC-OS-002')!;
      expect(e.result).toBe('PASS');
    });

    it('FAIL when disk not encrypted', () => {
      const r = makeBaseResult();
      r.disk_encryption = { ok: true, platform: 'linux', encrypted: false, error: null };
      const evals = evaluator.evaluate(r);
      const e = evals.find(e => e.control_id === 'NC-OS-002')!;
      expect(e.result).toBe('FAIL');
    });
  });

  // ── All pass scenario ──────────────────────────────────────────

  it('all controls pass in a clean environment', () => {
    const r = makeBaseResult();
    // Set docker and tunnel to available+clean to get PASS instead of SKIP
    r.docker = { ok: true, docker_available: true, containers: [], error: null };
    r.cloudflare_tunnel = { ok: true, tunnel_found: true, unauthenticated_hostnames: [], error: null };

    const evals = evaluator.evaluate(r);
    const passes = evals.filter(e => e.result === 'PASS');
    expect(passes).toHaveLength(8);
  });
});
