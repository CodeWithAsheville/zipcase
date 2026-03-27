const mockJwtVerify = jest.fn();
const mockCreateRemoteJWKSet = jest.fn((url?: unknown) => {
    void url;
    return 'mock-jwks';
});

jest.mock('jose', () => ({
    jwtVerify: (token: unknown, jwks: unknown, options: unknown) => mockJwtVerify(token, jwks, options),
    createRemoteJWKSet: (url: unknown) => mockCreateRemoteJWKSet(url),
}));

describe('WebSocketAuth', () => {
    const originalIssuer = process.env.COGNITO_ISSUER_URL;
    const originalAudience = process.env.COGNITO_APP_CLIENT_ID;

    beforeEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
        process.env.COGNITO_ISSUER_URL = 'https://issuer.example.com/pool';
        process.env.COGNITO_APP_CLIENT_ID = 'app-client-id';
    });

    afterAll(() => {
        process.env.COGNITO_ISSUER_URL = originalIssuer;
        process.env.COGNITO_APP_CLIENT_ID = originalAudience;
    });

    it('returns null for missing or malformed auth header', async () => {
        const { getUserIdFromBearerToken } = await import('../WebSocketAuth');

        await expect(getUserIdFromBearerToken(undefined)).resolves.toBeNull();
        await expect(getUserIdFromBearerToken('Token abc')).resolves.toBeNull();
        expect(mockJwtVerify).not.toHaveBeenCalled();
    });

    it('verifies token and returns payload sub', async () => {
        mockJwtVerify.mockResolvedValue({ payload: { sub: 'user-1', token_use: 'access', client_id: 'app-client-id' } });
        const { getUserIdFromBearerToken } = await import('../WebSocketAuth');

        const userId = await getUserIdFromBearerToken('Bearer token-value');

        expect(userId).toBe('user-1');
        expect(mockCreateRemoteJWKSet).toHaveBeenCalledTimes(1);
        expect(mockJwtVerify).toHaveBeenCalledWith('token-value', 'mock-jwks', {
            issuer: 'https://issuer.example.com/pool',
        });
    });

    it('accepts id tokens when aud matches app client id', async () => {
        mockJwtVerify.mockResolvedValue({ payload: { sub: 'user-id-token', token_use: 'id', aud: 'app-client-id' } });
        const { getUserIdFromBearerToken } = await import('../WebSocketAuth');

        await expect(getUserIdFromBearerToken('Bearer token-value')).resolves.toBe('user-id-token');
    });

    it('returns null when access token client_id does not match app client id', async () => {
        mockJwtVerify.mockResolvedValue({ payload: { sub: 'user-1', token_use: 'access', client_id: 'another-client-id' } });
        const { getUserIdFromBearerToken } = await import('../WebSocketAuth');

        await expect(getUserIdFromBearerToken('Bearer token-value')).resolves.toBeNull();
    });

    it('throws when cognito env config is missing', async () => {
        delete process.env.COGNITO_APP_CLIENT_ID;
        const { getUserIdFromBearerToken } = await import('../WebSocketAuth');

        await expect(getUserIdFromBearerToken('Bearer token-value')).rejects.toThrow('Cognito auth configuration missing');
    });
});
