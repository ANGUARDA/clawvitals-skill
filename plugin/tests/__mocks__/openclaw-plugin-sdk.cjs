/**
 * Lightweight stub for @openclaw/plugin-sdk.
 *
 * The real SDK is an ESM bundle that Jest (CommonJS) cannot transform.
 * Tests that exercise plugin logic directly don't need the runtime —
 * they test pure functions. This mock satisfies any import statements.
 */
'use strict';

function withFileLock(_filePath, _options, fn) {
  return fn();
}

function acquireFileLock(_filePath, _options) {
  return Promise.resolve({ lockPath: _filePath, release: async () => {} });
}

function runPluginCommandWithTimeout(_options) {
  return Promise.resolve({ code: 0, stdout: '', stderr: '' });
}

function emptyPluginConfigSchema() {
  return { jsonSchema: { type: 'object', properties: {}, additionalProperties: true } };
}

module.exports = {
  withFileLock,
  acquireFileLock,
  runPluginCommandWithTimeout,
  emptyPluginConfigSchema,
};
