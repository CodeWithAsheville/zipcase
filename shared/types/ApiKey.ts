export interface ApiKeyData {
    apiKeyId: string;
    apiKey: string;
}

export interface ApiKeyResponse {
    apiKey: string;
    webhookUrl: string;
    sharedSecret: string;
}
