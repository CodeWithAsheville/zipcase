/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    testMatch: ['**/__integration_tests__/**/*.test.ts'],
    testTimeout: 30000, // 30 seconds timeout for integration tests
    // Don't collect coverage for integration tests
    collectCoverage: false,
};
