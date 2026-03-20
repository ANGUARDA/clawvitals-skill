/**
 * Lightweight mock of @openclaw/plugin-sdk for Jest.
 *
 * The real SDK is an ESM bundle that cannot be loaded by Jest's CommonJS
 * transformer. At runtime inside OpenClaw, the real SDK is used. These stubs
 * allow unit/integration tests to run without OpenClaw being present.
 */
'use strict';

/**
 * runPluginCommandWithTimeout — stub that delegates to child_process.execFile.
 * Only used in tests; production code runs inside OpenClaw where the real SDK
 * is available and child_process is never imported directly by skill code.
 */
async function runPluginCommandWithTimeout({ argv, timeoutMs }) {
  const { execFile } = require('node:child_process');
  const [binary, ...args] = argv;
  return new Promise((resolve, reject) => {
    const child = execFile(binary, args, { timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        if ('killed' in error && error.killed) {
          // Emulate SDK timeout error so CliRunner can detect it
          reject(new Error(`Command timed out after ${timeoutMs}ms`));
          return;
        }
        resolve({
          code: typeof error.code === 'number' ? error.code : 1,
          stdout: stdout || '',
          stderr: stderr || error.message || '',
        });
      } else {
        resolve({ code: 0, stdout: stdout || '', stderr: stderr || '' });
      }
    });
    // Suppress unhandled error events from the child process
    child.on('error', () => {});
  });
}

/**
 * withFileLock — stub that runs the callback immediately without locking.
 * Concurrent scan prevention is not needed in tests.
 */
async function withFileLock(_filePath, _options, fn) {
  return fn();
}

/**
 * acquireFileLock — stub that returns a no-op release handle.
 */
async function acquireFileLock(_filePath, _options) {
  return {
    lockPath: _filePath,
    release: async () => {},
  };
}

module.exports = {
  runPluginCommandWithTimeout,
  withFileLock,
  acquireFileLock,
};
