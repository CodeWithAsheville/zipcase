import { createRemoteJWKSet, jwtVerify } from 'jose';

const issuerUrl = process.env.COGNITO_ISSUER_URL;
const appClientId = process.env.COGNITO_APP_CLIENT_ID;

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

function getJwks() {
    if (!issuerUrl) {
        throw new Error('COGNITO_ISSUER_URL is not configured');
    }

    if (!jwks) {
        jwks = createRemoteJWKSet(new URL(`${issuerUrl}/.well-known/jwks.json`));
    }

    return jwks;
}

export async function getUserIdFromBearerToken(authHeader: string | undefined): Promise<string | null> {
    if (!authHeader) {
        return null;
    }

    const header = authHeader.trim();
    const match = header.match(/^Bearer\s+(.+)$/i);
    if (!match) {
        return null;
    }

    if (!issuerUrl || !appClientId) {
        throw new Error('Cognito auth configuration missing');
    }

    const token = match[1];
    const { payload } = await jwtVerify(token, getJwks(), {
        issuer: issuerUrl,
    });

    const tokenUse = payload.token_use;
    const audience = payload.aud;
    const clientId = payload.client_id;

    if (tokenUse === 'access') {
        if (clientId !== appClientId) {
            return null;
        }
    } else if (tokenUse === 'id') {
        if (audience !== appClientId) {
            return null;
        }
    } else {
        return null;
    }

    return typeof payload.sub === 'string' ? payload.sub : null;
}
