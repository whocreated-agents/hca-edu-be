/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  rootDir: '.',
  testMatch: ['<rootDir>/test/**/*.spec.ts'],
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json', diagnostics: { ignoreCodes: [151001] } }] },
  moduleNameMapper: { '^@hca/contracts$': '<rootDir>/../../packages/contracts/src/index.ts' },
  globalSetup: '<rootDir>/test/global-setup.ts',
  testTimeout: 30000,
};
