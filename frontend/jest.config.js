const nextJest = require('next/jest')

const createJestConfig = nextJest({ dir: './' })

/** @type {import('jest').Config} */
const config = {
  testEnvironment: 'jsdom',
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  moduleNameMapper: { '^@/(.*)$': '<rootDir>/src/$1' },
  testMatch: ['<rootDir>/**/*.test.{ts,tsx}'],
  collectCoverageFrom: ['src/components/**/*.{ts,tsx}', 'src/hooks/**/*.{ts,tsx}'],
}

module.exports = createJestConfig(config)
