/**
 * Unit tests for CliRunner.
 *
 * Tests the binary allowlist enforcement, timeout behavior,
 * error handling for non-zero exit codes, and argument safety.
 */

import { CliRunner, CliDisallowedBinaryError, CliTimeoutError, CliExecError } from '../../src/cli-runner';

describe('CliRunner', () => {
  const runner = new CliRunner();

  describe('binary allowlist', () => {
    it('should reject disallowed binaries with CliDisallowedBinaryError', async () => {
      await expect(runner.run('curl', ['https://example.com']))
        .rejects.toThrow(CliDisallowedBinaryError);
    });

    it('should reject bash as a binary', async () => {
      await expect(runner.run('bash', ['-c', 'echo hello']))
        .rejects.toThrow(CliDisallowedBinaryError);
    });

    it('should reject sh as a binary', async () => {
      await expect(runner.run('sh', ['-c', 'echo hello']))
        .rejects.toThrow(CliDisallowedBinaryError);
    });

    it('should reject python as a binary', async () => {
      await expect(runner.run('python', ['-c', 'print("hello")']))
        .rejects.toThrow(CliDisallowedBinaryError);
    });

    it('should include allowed binaries in the error message', async () => {
      try {
        await runner.run('wget', []);
        fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(CliDisallowedBinaryError);
        expect((err as CliDisallowedBinaryError).message).toContain('openclaw');
        expect((err as CliDisallowedBinaryError).message).toContain('node');
      }
    });

    it('should allow node as a binary', async () => {
      // node -e will run and exit 0
      const result = await runner.run('node', ['-e', 'process.stdout.write("hello")']);
      expect(result.stdout).toBe('hello');
      expect(result.exitCode).toBe(0);
    });
  });

  describe('timeout behavior', () => {
    it('should throw CliTimeoutError when command exceeds timeout', async () => {
      // Use a very short timeout with a sleep command via node
      await expect(
        runner.run('node', ['-e', 'setTimeout(() => {}, 10000)'], { timeoutMs: 200 })
      ).rejects.toThrow(CliTimeoutError);
    }, 10000);
  });

  describe('non-zero exit handling', () => {
    it('should throw CliExecError on non-zero exit code', async () => {
      await expect(
        runner.run('node', ['-e', 'process.exit(1)'])
      ).rejects.toThrow(CliExecError);
    });

    it('should include stderr content in CliExecError', async () => {
      try {
        await runner.run('node', ['-e', 'process.stderr.write("error msg"); process.exit(1)']);
        fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(CliExecError);
        expect((err as CliExecError).stderr).toContain('error msg');
      }
    });
  });

  describe('successful execution', () => {
    it('should return stdout and exitCode 0 for successful commands', async () => {
      const result = await runner.run('node', ['-e', 'console.log("test output")']);
      expect(result.stdout.trim()).toBe('test output');
      expect(result.exitCode).toBe(0);
    });

    it('should pass arguments as array without shell interpolation', async () => {
      // This tests that args with spaces/special chars are passed correctly
      const result = await runner.run('node', ['-e', 'console.log(process.argv[1])', '--', 'hello world; rm -rf /']);
      expect(result.stdout.trim()).toBe('hello world; rm -rf /');
    });
  });
});
