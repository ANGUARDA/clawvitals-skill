/**
 * expanded-collectors.test.ts — Unit tests for expanded collectors.
 */

// Mock child_process.execSync before imports
const mockExecSync = jest.fn();
jest.mock('node:child_process', () => ({
  execSync: mockExecSync,
}));

// Mock fs for file-reading collectors
const mockExistsSync = jest.fn();
const mockReadFileSync = jest.fn();
jest.mock('node:fs', () => ({
  existsSync: mockExistsSync,
  readFileSync: mockReadFileSync,
}));

// Mock os.homedir and os.platform
const mockHomedir = jest.fn(() => '/home/testuser');
const mockPlatform = jest.fn(() => 'darwin');
jest.mock('node:os', () => ({
  homedir: () => mockHomedir(),
  platform: () => mockPlatform(),
}));

import { collectOllama } from '../../src/collectors/expanded/ollama';
import { collectNetwork } from '../../src/collectors/expanded/network';
import { collectSecretsFiles } from '../../src/collectors/expanded/secrets-files';
import { collectSecretsHistory } from '../../src/collectors/expanded/secrets-history';
import { collectCloudflareTunnel } from '../../src/collectors/expanded/cloudflare-tunnel';
import { collectDocker } from '../../src/collectors/expanded/docker';
import { collectOsUpdates } from '../../src/collectors/expanded/os-updates';
import { collectDiskEncryption } from '../../src/collectors/expanded/disk-encryption';
import { ExpandedCollectorOrchestrator } from '../../src/collectors/expanded/index';

beforeEach(() => {
  jest.clearAllMocks();
  mockExistsSync.mockReturnValue(false);
  mockReadFileSync.mockReturnValue('');
  mockHomedir.mockReturnValue('/home/testuser');
  mockPlatform.mockReturnValue('darwin');
});

// ── Ollama ────────────────────────────────────────────────────────

describe('collectOllama', () => {
  it('returns PASS when ollama is not running (lsof fails)', () => {
    mockExecSync.mockImplementation(() => { throw new Error('no matches'); });
    const result = collectOllama();
    expect(result.ok).toBe(true);
    expect(result.bound_to_public).toBe(false);
  });

  it('detects ollama bound to 0.0.0.0', () => {
    mockExecSync.mockReturnValue(
      'COMMAND   PID USER   FD   TYPE DEVICE SIZE/OFF NODE NAME\nollama  1234 user   3u  IPv4 0xabc 0t0  TCP *:11434 (LISTEN)\n'
    );
    const result = collectOllama();
    expect(result.ok).toBe(true);
    expect(result.bound_to_public).toBe(true);
    expect(result.host).toBe('0.0.0.0');
  });

  it('detects ollama bound to localhost', () => {
    mockExecSync.mockReturnValue(
      'COMMAND   PID USER   FD   TYPE DEVICE SIZE/OFF NODE NAME\nollama  1234 user   3u  IPv4 0xabc 0t0  TCP 127.0.0.1:11434 (LISTEN)\n'
    );
    const result = collectOllama();
    expect(result.ok).toBe(true);
    expect(result.bound_to_public).toBe(false);
  });
});

// ── Network ──────────────────────────────────────────────────────

describe('collectNetwork', () => {
  it('returns no exposed ports when lsof finds nothing', () => {
    mockExecSync.mockImplementation(() => { throw new Error('no matches'); });
    const result = collectNetwork();
    expect(result.ok).toBe(true);
    expect(result.exposed_ports).toHaveLength(0);
  });

  it('detects port 22 exposed on 0.0.0.0', () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if (typeof cmd === 'string' && cmd.includes(':22')) {
        return 'COMMAND PID USER FD TYPE NODE NAME\nsshd 123 root 3u IPv4 TCP *:22 (LISTEN)\n';
      }
      throw new Error('no matches');
    });
    const result = collectNetwork();
    expect(result.ok).toBe(true);
    expect(result.exposed_ports.length).toBeGreaterThanOrEqual(1);
    expect(result.exposed_ports[0].port).toBe(22);
  });
});

// ── Secrets Files ────────────────────────────────────────────────

describe('collectSecretsFiles', () => {
  it('returns no findings when files do not exist', () => {
    mockExistsSync.mockReturnValue(false);
    const result = collectSecretsFiles();
    expect(result.ok).toBe(true);
    expect(result.findings).toHaveLength(0);
  });

  it('detects OpenAI key in .env', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('OPENAI_API_KEY=sk-abcdefghijklmnopqrstuvwxyz1234567890');
    const result = collectSecretsFiles();
    expect(result.ok).toBe(true);
    expect(result.findings.length).toBeGreaterThanOrEqual(1);
    expect(result.findings[0].pattern).toBe('OpenAI');
  });

  it('detects AWS key pattern', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('AWS_KEY=AKIAIOSFODNN7EXAMPLE');
    const result = collectSecretsFiles();
    expect(result.ok).toBe(true);
    const aws = result.findings.find(f => f.pattern === 'AWS');
    expect(aws).toBeDefined();
  });

  it('detects generic API_KEY pattern', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('API_KEY=supersecretvalue12345');
    const result = collectSecretsFiles();
    expect(result.ok).toBe(true);
    const generic = result.findings.find(f => f.pattern === 'Generic API Key');
    expect(generic).toBeDefined();
  });
});

// ── Secrets History ──────────────────────────────────────────────

describe('collectSecretsHistory', () => {
  it('returns no findings when history files do not exist', () => {
    mockExistsSync.mockReturnValue(false);
    const result = collectSecretsHistory();
    expect(result.ok).toBe(true);
    expect(result.findings).toHaveLength(0);
  });

  it('detects Anthropic key in history', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('curl -H "Authorization: Bearer sk-ant-abcdefghijklmnopqrstuvwxyz"');
    const result = collectSecretsHistory();
    expect(result.ok).toBe(true);
    const anthropic = result.findings.find(f => f.pattern === 'Anthropic');
    expect(anthropic).toBeDefined();
  });
});

// ── Cloudflare Tunnel ────────────────────────────────────────────

describe('collectCloudflareTunnel', () => {
  it('returns tunnel_found=false when config does not exist', () => {
    mockExistsSync.mockReturnValue(false);
    const result = collectCloudflareTunnel();
    expect(result.ok).toBe(true);
    expect(result.tunnel_found).toBe(false);
  });

  it('detects unauthenticated hostname', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      'ingress:\n  - hostname: app.example.com\n    service: http://localhost:8080\n  - service: http_status:404\n'
    );
    const result = collectCloudflareTunnel();
    expect(result.ok).toBe(true);
    expect(result.tunnel_found).toBe(true);
    expect(result.unauthenticated_hostnames).toContain('app.example.com');
  });

  it('passes when access_required is true', () => {
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue(
      'ingress:\n  - hostname: app.example.com\n    access_required: true\n    service: http://localhost:8080\n'
    );
    const result = collectCloudflareTunnel();
    expect(result.ok).toBe(true);
    expect(result.unauthenticated_hostnames).toHaveLength(0);
  });
});

// ── Docker ───────────────────────────────────────────────────────

describe('collectDocker', () => {
  it('returns docker_available=false when docker is not installed', () => {
    mockExecSync.mockImplementation(() => { throw new Error('docker not found'); });
    const result = collectDocker();
    expect(result.ok).toBe(true);
    expect(result.docker_available).toBe(false);
  });

  it('detects privileged container', () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if (typeof cmd === 'string' && cmd.includes('docker ps')) return 'abc123\n';
      if (typeof cmd === 'string' && cmd.includes('docker inspect')) {
        return JSON.stringify([{
          Id: 'abc123',
          Name: '/test-container',
          HostConfig: { Privileged: true, CapAdd: [] },
          Config: { User: 'nobody' },
        }]);
      }
      throw new Error('unexpected');
    });
    const result = collectDocker();
    expect(result.ok).toBe(true);
    expect(result.docker_available).toBe(true);
    expect(result.containers).toHaveLength(1);
    expect(result.containers[0].privileged).toBe(true);
    expect(result.containers[0].root_user).toBe(false);
  });

  it('detects root user container', () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if (typeof cmd === 'string' && cmd.includes('docker ps')) return 'def456\n';
      if (typeof cmd === 'string' && cmd.includes('docker inspect')) {
        return JSON.stringify([{
          Id: 'def456',
          Name: '/root-container',
          HostConfig: { Privileged: false, CapAdd: null },
          Config: { User: '' },
        }]);
      }
      throw new Error('unexpected');
    });
    const result = collectDocker();
    expect(result.ok).toBe(true);
    expect(result.containers[0].root_user).toBe(true);
  });

  it('detects dangerous capabilities', () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if (typeof cmd === 'string' && cmd.includes('docker ps')) return 'ghi789\n';
      if (typeof cmd === 'string' && cmd.includes('docker inspect')) {
        return JSON.stringify([{
          Id: 'ghi789',
          Name: '/cap-container',
          HostConfig: { Privileged: false, CapAdd: ['SYS_ADMIN', 'NET_RAW'] },
          Config: { User: 'nobody' },
        }]);
      }
      throw new Error('unexpected');
    });
    const result = collectDocker();
    expect(result.ok).toBe(true);
    expect(result.containers[0].dangerous_caps).toEqual(['SYS_ADMIN']);
  });
});

// ── OS Updates ───────────────────────────────────────────────────

describe('collectOsUpdates', () => {
  it('detects macOS up to date', () => {
    mockPlatform.mockReturnValue('darwin');
    mockExecSync.mockReturnValue('Software Update Tool\n\nNo new software available.');
    const result = collectOsUpdates();
    expect(result.ok).toBe(true);
    expect(result.platform).toBe('macos');
    expect(result.auto_updates_enabled).toBe(true);
  });

  it('detects macOS updates available', () => {
    mockPlatform.mockReturnValue('darwin');
    mockExecSync.mockReturnValue('Software Update Tool\n\n* macOS 15.1\n');
    const result = collectOsUpdates();
    expect(result.ok).toBe(true);
    expect(result.auto_updates_enabled).toBe(false);
  });

  it('detects linux unattended upgrades enabled', () => {
    mockPlatform.mockReturnValue('linux');
    mockExistsSync.mockReturnValue(true);
    mockReadFileSync.mockReturnValue('APT::Periodic::Unattended-Upgrade "1";');
    const result = collectOsUpdates();
    expect(result.ok).toBe(true);
    expect(result.platform).toBe('linux');
    expect(result.auto_updates_enabled).toBe(true);
  });

  it('detects linux without auto-upgrades config', () => {
    mockPlatform.mockReturnValue('linux');
    mockExistsSync.mockReturnValue(false);
    const result = collectOsUpdates();
    expect(result.ok).toBe(true);
    expect(result.auto_updates_enabled).toBe(false);
  });

  it('returns unknown for unsupported platform', () => {
    mockPlatform.mockReturnValue('win32');
    const result = collectOsUpdates();
    expect(result.ok).toBe(true);
    expect(result.platform).toBe('unknown');
  });
});

// ── Disk Encryption ──────────────────────────────────────────────

describe('collectDiskEncryption', () => {
  it('detects macOS FileVault enabled', () => {
    mockPlatform.mockReturnValue('darwin');
    mockExecSync.mockReturnValue('FileVault is On.');
    const result = collectDiskEncryption();
    expect(result.ok).toBe(true);
    expect(result.encrypted).toBe(true);
  });

  it('detects macOS FileVault disabled', () => {
    mockPlatform.mockReturnValue('darwin');
    mockExecSync.mockReturnValue('FileVault is Off.');
    const result = collectDiskEncryption();
    expect(result.ok).toBe(true);
    expect(result.encrypted).toBe(false);
  });

  it('detects linux LUKS encryption', () => {
    mockPlatform.mockReturnValue('linux');
    mockExecSync.mockReturnValue('NAME FSTYPE\nsda1 crypto_LUKS\nsda2 ext4\n');
    const result = collectDiskEncryption();
    expect(result.ok).toBe(true);
    expect(result.encrypted).toBe(true);
  });

  it('detects linux without encryption', () => {
    mockPlatform.mockReturnValue('linux');
    mockExecSync.mockReturnValue('NAME FSTYPE\nsda1 ext4\n');
    const result = collectDiskEncryption();
    expect(result.ok).toBe(true);
    expect(result.encrypted).toBe(false);
  });
});

// ── Orchestrator ─────────────────────────────────────────────────

describe('ExpandedCollectorOrchestrator', () => {
  it('collects all 8 results in parallel', async () => {
    // All collectors use mocked dependencies, so they'll return defaults
    mockExecSync.mockImplementation(() => { throw new Error('not found'); });
    mockExistsSync.mockReturnValue(false);

    const orchestrator = new ExpandedCollectorOrchestrator();
    const result = await orchestrator.collect();

    expect(result.ollama).toBeDefined();
    expect(result.network).toBeDefined();
    expect(result.secrets_files).toBeDefined();
    expect(result.secrets_history).toBeDefined();
    expect(result.cloudflare_tunnel).toBeDefined();
    expect(result.docker).toBeDefined();
    expect(result.os_updates).toBeDefined();
    expect(result.disk_encryption).toBeDefined();
  });
});
