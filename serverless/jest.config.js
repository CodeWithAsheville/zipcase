/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    testMatch: ['**/__tests__/**/*.test.ts'],
    setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
    collectCoverage: true,
    collectCoverageFrom: [
        'lib/**/*.ts',
        'api/handlers/**/*.ts',
        'app/handlers/**/*.ts',
        '!**/__tests__/**',
    ],
};
