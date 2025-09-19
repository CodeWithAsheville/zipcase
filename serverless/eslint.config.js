const js = require('@eslint/js');
const globals = require('globals');
const tseslint = require('typescript-eslint');

module.exports = tseslint.config(
    { 
        ignores: [
            'dist', 
            'coverage', 
            'node_modules', 
            '.build', 
            '**/.serverless/**',
            '**/cdk.out/**'
        ] 
    },
    // Base configuration for all files
    {
        extends: [js.configs.recommended, ...tseslint.configs.recommended],
        files: ['**/*.{ts,js}'],
        languageOptions: {
            ecmaVersion: 2020,
            globals: {
                ...globals.node,
                ...globals.jest,
            },
        },
        rules: {
            'max-len': [
                'error',
                {
                    code: 140,
                    ignoreUrls: true,
                    ignoreStrings: true,
                    ignoreTemplateLiterals: true,
                    ignoreRegExpLiterals: true,
                    ignoreComments: true,
                },
            ],
            'object-curly-newline': [
                'error',
                {
                    multiline: true,
                    consistent: true,
                },
            ],
            'array-element-newline': ['error', 'consistent'],
            'function-paren-newline': ['error', 'consistent'],
        },
    },
    // Specific configuration for test files
    {
        files: ['**/__tests__/**/*.ts', '**/*.test.ts'],
        rules: {
            '@typescript-eslint/no-explicit-any': 'off',
            '@typescript-eslint/ban-ts-comment': 'off',
        },
    },
    // Exemption for eslint.config.js
    {
        files: ['eslint.config.js'],
        rules: {
            '@typescript-eslint/no-require-imports': 'off',
        },
    }
);
