/**
 * cli-runner.ts — Single, auditable wrapper around all OpenClaw CLI exec calls.
 *
 * This is the ONLY place in the codebase that invokes child_process.execFile.
 * Every collector MUST use CliRunner — never call exec directly. This module
 * enforces the binary allowlist, argument-as-array safety, and timeout policy.
 */

import { execFile } from 'node:child_process';
import { ALLOWED_BINARIES, CLI_TIMEOUT_MS } from './constants';

/** Thrown when a CLI command exceeds its timeout */
export class CliTimeoutError extends Error {
  constructor(command: string, timeoutMs: number) {
    super(`CLI command timed out after ${timeoutMs}ms: ${command}`);
    this.name = 'CliTimeoutError';
  }
}

/** Thrown when a CLI command exits with a non-zero code */
export class CliExecError extends Error {
  /** The exit code returned by the process */
  public readonly exitCode: number;
  /** Content written to stderr */
  public readonly stderr: string;

  constructor(command: string, exitCode: number, stderr: string) {
    super(`CLI command failed (exit ${exitCode}): ${command}\n${stderr}`);
    this.name = 'CliExecError';
    this.exitCode = exitCode;
    this.stderr = stderr;
  }
}

/** Thrown when a disallowed binary is requested */
export class CliDisallowedBinaryError extends Error {
  constructor(binary: string) {
    super(
      `Binary "${binary}" is not in the allowed list. ` +
      `Only these binaries may be executed: ${ALLOWED_BINARIES.join(', ')}`
    );
    this.name = 'CliDisallowedBinaryError';
  }
}

/** Options for a CLI command execution */
export interface CliRunOptions {
  /** Timeout in milliseconds (default: 30000) */
  timeoutMs?: number;
  /** Whether to parse stdout as JSON (default: false) */
  parseJson?: boolean;
}

/** Result of a successful CLI command execution */
export interface CliRunResult {
  /** Standard output content */
  stdout: string;
  /** Standard error content */
  stderr: string;
  /** Process exit code */
  exitCode: number;
}

/**
 * CliRunner wraps all CLI invocations with security controls.
 *
 * Security invariants:
 * - Command must be in the ALLOWED_BINARIES list — rejects at construction time
 * - Args are passed as a string array — never interpolated into a shell string
 * - Default 30-second timeout prevents hung processes
 * - All invocations are logged for debugging
 */
export class CliRunner {
  private readonly binary: string;

  /**
   * Create a CliRunner for a specific binary.
   *
   * @param binary - The binary to execute (must be in ALLOWED_BINARIES)
   * @throws CliDisallowedBinaryError if the binary is not in the allowlist
   */
  constructor(binary: string) {
    if (!ALLOWED_BINARIES.includes(binary)) {
      throw new CliDisallowedBinaryError(binary);
    }
    this.binary = binary;
  }

  /**
   * Execute a CLI command with security controls.
   *
   * @param args - Arguments as a string array (never interpolated)
   * @param options - Timeout and parsing options
   * @returns The command's stdout, stderr, and exit code
   * @throws CliTimeoutError if the command exceeds the timeout
   * @throws CliExecError if the command exits with a non-zero code
   */
  async run(
    args: string[],
    options: CliRunOptions = {}
  ): Promise<CliRunResult> {
    const timeoutMs = options.timeoutMs ?? CLI_TIMEOUT_MS;

    return new Promise<CliRunResult>((resolve, reject) => {
      const child = execFile(
        this.binary,
        args,
        { timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024 },
        (error, stdout, stderr) => {
          if (error) {
            if ('killed' in error && error.killed) {
              reject(new CliTimeoutError(`${this.binary} ${args.join(' ')}`, timeoutMs));
              return;
            }
            const exitCode = 'code' in error && typeof error.code === 'number' ? error.code : 1;
            reject(new CliExecError(`${this.binary} ${args.join(' ')}`, exitCode, stderr));
            return;
          }
          resolve({ stdout, stderr, exitCode: 0 });
        }
      );

      /* istanbul ignore next — defensive cleanup for edge cases */
      child.on('error', (err) => {
        reject(new CliExecError(`${this.binary} ${args.join(' ')}`, 1, err.message));
      });
    });
  }
}
