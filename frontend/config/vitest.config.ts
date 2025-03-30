import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
    plugins: [
        react({
            // Add the plugin options here
            babel: {
                plugins: [],
            },
        }),
    ],
    resolve: {
        alias: {
            '@': path.resolve(__dirname, './src'),
        },
    },
    test: {
        globals: true,
        environment: 'jsdom',
        setupFiles: ['./config/vitest.setup.ts'],
        include: ['src/**/*.test.{ts,tsx}'],
    },
});
