/**
 * Unit tests for CliRunner.
 *
 * Tests the binary allowlist enforcement, timeout behavior,
 * error handling for non-zero exit codes, and argument safety.
 */

import { CliRunner, CliDisallowedBinaryError, CliTimeoutError, CliExecError } from '../../src/cli-runner';

describe('CliRunner', () => {
  describe('binary allowlist (constructor validation)', () => {
    it('should reject disallowed binaries at construction time', () => {
      expect(() => new CliRunner('curl')).toThrow(CliDisallowedBinaryError);
    });

    it('should reject bash as a binary', () => {
      expect(() => new CliRunner('bash')).toThrow(CliDisallowedBinaryError);
    });

    it('should reject sh as a binary', () => {
      expect(() => new CliRunner('sh')).toThrow(CliDisallowedBinaryError);
    });

    it('should reject python as a binary', () => {
      expect(() => new CliRunner('python')).toThrow(CliDisallowedBinaryError);
    });

    it('should include allowed binaries in the error message', () => {
      try {
        new CliRunner('wget');
        fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(CliDisallowedBinaryError);
        expect((err as CliDisallowedBinaryError).message).toContain('openclaw');
        expect((err as CliDisallowedBinaryError).message).toContain('node');
      }
    });

    it('should allow node as a binary', async () => {
      const runner = new CliRunner('node');
      const result = await runner.run(['-e', 'process.stdout.write("hello")']);
      expect(result.stdout).toBe('hello');
      expect(result.exitCode).toBe(0);
    });
  });

  describe('timeout behavior', () => {
    it('should throw CliTimeoutError when command exceeds timeout', async () => {
      const runner = new CliRunner('node');
      await expect(
        runner.run(['-e', 'setTimeout(() => {}, 10000)'], { timeoutMs: 200 })
      ).rejects.toThrow(CliTimeoutError);
    }, 10000);
  });

  describe('non-zero exit handling', () => {
    it('should throw CliExecError on non-zero exit code', async () => {
      const runner = new CliRunner('node');
      await expect(
        runner.run(['-e', 'process.exit(1)'])
      ).rejects.toThrow(CliExecError);
    });

    it('should include stderr content in CliExecError', async () => {
      const runner = new CliRunner('node');
      try {
        await runner.run(['-e', 'process.stderr.write("error msg"); process.exit(1)']);
        fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(CliExecError);
        expect((err as CliExecError).stderr).toContain('error msg');
      }
    });
  });

  describe('successful execution', () => {
    it('should return stdout and exitCode 0 for successful commands', async () => {
      const runner = new CliRunner('node');
      const result = await runner.run(['-e', 'console.log("test output")']);
      expect(result.stdout.trim()).toBe('test output');
      expect(result.exitCode).toBe(0);
    });

    it('should pass arguments as array without shell interpolation', async () => {
      const runner = new CliRunner('node');
      const result = await runner.run(['-e', 'console.log(process.argv[1])', '--', 'hello world; rm -rf /']);
      expect(result.stdout.trim()).toBe('hello world; rm -rf /');
    });
  });
});
