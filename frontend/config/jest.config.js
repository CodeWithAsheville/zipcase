export default {
    testEnvironment: 'jsdom',
    transform: {
        '^.+\\.(ts|tsx)$': [
            'ts-jest',
            {
                useESM: true,
            },
        ],
    },
    extensionsToTreatAsEsm: ['.ts', '.tsx'],
    moduleNameMapper: {
        '^(\\.{1,2}/.*)\\.js$': '$1',
        '\\.(css|less|sass|scss)$': 'identity-obj-proxy',
        // Static file imports are handled automatically by Vitest
        // If Jest testing is needed, you can use another mock approach here
    },
    setupFilesAfterEnv: ['<rootDir>/config/jest.setup.js'],
    testMatch: ['**/__tests__/**/*.test.(ts|tsx)'],
    moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
};
