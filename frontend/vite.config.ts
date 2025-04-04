import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
    // Load env file based on `mode` in the current directory.
    // Set the third parameter to '' to load all env regardless of the `VITE_` prefix.
    const env = loadEnv(mode, process.cwd(), '');

    return {
        plugins: [react(), tailwindcss()],
        // Ensure Vite replaces env variables in the build
        define: {
            'import.meta.env.VITE_COGNITO_USER_POOL_ID': JSON.stringify(env.VITE_COGNITO_USER_POOL_ID),
            'import.meta.env.VITE_COGNITO_CLIENT_ID': JSON.stringify(env.VITE_COGNITO_CLIENT_ID),
            'import.meta.env.VITE_API_URL': JSON.stringify(env.VITE_API_URL),
            'import.meta.env.VITE_PORTAL_URL': JSON.stringify(env.VITE_PORTAL_URL),
            'import.meta.env.VITE_PORTAL_CASE_URL': JSON.stringify(env.VITE_PORTAL_CASE_URL),
        },
        // Add build configuration for proper handling of environment variables
        build: {
            outDir: 'dist',
            sourcemap: true,
            // Ensure environment variables are included in the build
            assetsInlineLimit: 0, // Ensures small assets are not inlined as base64
        }
    };
});
