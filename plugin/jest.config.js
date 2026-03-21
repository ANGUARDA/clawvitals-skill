/** @type {import('jest').Config} */
const path = require('path');

const sdkPath = (() => {
  // Resolve OpenClaw plugin SDK — installed globally via npm or as a local dep
  try {
    return path.dirname(require.resolve('openclaw/dist/plugin-sdk/index'));
  } catch {
    // Fallback: global npm path
    return '/opt/homebrew/lib/node_modules/openclaw/dist/plugin-sdk/index';
  }
})();

// In test environments, the OpenClaw plugin SDK (ESM bundle) cannot be loaded
// by Jest's CommonJS transformer. We stub it out with a lightweight mock.
// The real SDK is used at runtime inside OpenClaw's process.
const moduleNameMapper = {
  '^@openclaw/plugin-sdk$': '<rootDir>/tests/__mocks__/openclaw-plugin-sdk.js',
};

module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  moduleNameMapper,
  collectCoverageFrom: ['src/**/*.ts', '!src/index.ts'],
  coverageDirectory: 'coverage',
  projects: [
    {
      displayName: 'unit',
      preset: 'ts-jest',
      testEnvironment: 'node',
      testMatch: ['<rootDir>/tests/unit/**/*.test.ts'],
      moduleNameMapper,
    },
    {
      displayName: 'integration',
      preset: 'ts-jest',
      testEnvironment: 'node',
      testMatch: ['<rootDir>/tests/integration/**/*.test.ts'],
      moduleNameMapper,
    },
  ],
};
