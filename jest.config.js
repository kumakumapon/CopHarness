/** @type {import('jest').Config} */
const nextJest = require('next/jest')

const createJestConfig = nextJest({ dir: './' })

const customJestConfig = {
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.ts', '**/__tests__/**/*.test.tsx'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/$1',
    '^@github/copilot-sdk$': '<rootDir>/__mocks__/copilot-sdk.js',
  },
  setupFilesAfterEnv: ['./jest.setup.ts'],
}

module.exports = createJestConfig(customJestConfig)
