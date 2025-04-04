import { ResourcesConfig } from 'aws-amplify';

// Use environment variables with fallbacks for local development
export const API_URL = import.meta.env.VITE_API_URL;

// Court portal URL - this should match the PORTAL_URL in the backend environment
export const PORTAL_URL = import.meta.env.VITE_PORTAL_URL;

// Court portal case URL - this should match the PORTAL_CASE_URL in the backend environment
export const PORTAL_CASE_URL = import.meta.env.VITE_PORTAL_CASE_URL;

// Cognito configuration - these should also come from environment in a real deployment
const awsExports: ResourcesConfig = {
    Auth: {
        Cognito: {
            userPoolId: import.meta.env.VITE_COGNITO_USER_POOL_ID,
            userPoolClientId: import.meta.env.VITE_COGNITO_CLIENT_ID,
            identityPoolId: import.meta.env.VITE_COGNITO_IDENTITY_POOL_ID || undefined,
        }
    },
};

export default awsExports;
