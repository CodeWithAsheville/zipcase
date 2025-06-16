import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
    BatchGetCommand,
    DynamoDBDocumentClient,
    GetCommand,
    PutCommand,
} from '@aws-sdk/lib-dynamodb';
import { KMSClient, EncryptCommand, DecryptCommand } from '@aws-sdk/client-kms';
import {
    ApiKeyData,
    CaseSummary,
    PortalCredentials,
    PortalCredentialsResponse,
    SearchResult,
    WebhookSettings,
    ZipCase,
} from '../../shared/types';
import { NameSearchData } from '../../shared/types/Search';

// DynamoDB-specific attributes that should be removed from API responses
const DYNAMO_ATTRIBUTES = ['PK', 'SK', 'ttl', 'GSI1PK', 'GSI1SK'];

/**
 * Removes DynamoDB-specific attributes from an object or array of objects
 * @param data The data to clean
 * @returns Cleaned data without DynamoDB attributes
 */
function removeDynamoAttributes<T>(data: T): T {
    if (!data) {
        return data;
    }

    if (Array.isArray(data)) {
        return data.map(removeDynamoAttributes) as unknown as T;
    }

    if (typeof data === 'object' && data !== null) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const cleanedObject = { ...(data as object) } as any;

        // Remove DynamoDB attributes
        DYNAMO_ATTRIBUTES.forEach(attr => {
            if (attr in cleanedObject) {
                delete cleanedObject[attr];
            }
        });

        // Recursively clean nested objects and arrays
        Object.keys(cleanedObject).forEach(key => {
            if (typeof cleanedObject[key] === 'object' && cleanedObject[key] !== null) {
                cleanedObject[key] = removeDynamoAttributes(cleanedObject[key]);
            }
        });

        return cleanedObject;
    }

    return data;
}

export interface DynamoCompositeKey {
    PK: string;
    SK: string;
}

export const Key = {
    User: (userId: string) => {
        const PK = `USER#${userId}`;
        return {
            API_KEY: { PK, SK: 'API_KEY' },
            PORTAL_CREDENTIALS: { PK, SK: 'PORTAL_CREDENTIALS' },
            SESSION: { PK, SK: 'SESSION' },
            WEBHOOK_SETTINGS: { PK, SK: 'WEBHOOK_SETTINGS' },
            USER_AGENT: { PK, SK: 'USER-AGENT' },
        };
    },

    Case: (caseNumber: string) => {
        const PK = `CASE#${caseNumber.toUpperCase()}`;
        return {
            ID: { PK, SK: 'ID' },
            SUMMARY: { PK, SK: 'SUMMARY' },
        };
    },

    NameSearch: (searchId: string) => {
        const PK = `NAMESEARCH#${searchId}`;
        return {
            ID: { PK, SK: 'ID' },
        };
    },

    UserAgents: {
        COLLECTION: { PK: 'USERAGENTS', SK: 'COLLECTION' },
    },
};

const ddbClient = new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-2' });
const dynamoDb = DynamoDBDocumentClient.from(ddbClient);
const kms = new KMSClient({ region: process.env.AWS_REGION || 'us-east-2' });

const TABLE_NAME = process.env.ZIPCASE_DATA_TABLE || 'zipcase-data-dev';

export const BatchHelper = {
    BATCH_GET_MAX_ITEMS: 25, // DynamoDB BatchGet allows max 25 items per request

    /**
     * Splits an array into chunks of specified size
     * @param array The array to chunk
     * @param chunkSize Size of each chunk
     * @returns Array of chunks
     */
    chunkArray<T>(array: T[], chunkSize: number): T[][] {
        const chunks: T[][] = [];
        for (let i = 0; i < array.length; i += chunkSize) {
            chunks.push(array.slice(i, i + chunkSize));
        }
        return chunks;
    },

    /**
     * Executes BatchGet operations in chunks to respect DynamoDB limits
     * @param keys Array of composite keys to get
     * @returns Map of composite keys to their corresponding items
     */
    async getMany<T extends Record<string, unknown>>(
        keys: DynamoCompositeKey[]
    ): Promise<Map<DynamoCompositeKey, T>> {
        if (keys.length === 0) {
            return new Map();
        }

        const keyChunks = BatchHelper.chunkArray(keys, BatchHelper.BATCH_GET_MAX_ITEMS);

        // Process all chunks with Promise.all
        const batchPromises = keyChunks.map(chunk => {
            const command = new BatchGetCommand({
                RequestItems: {
                    [TABLE_NAME]: {
                        Keys: chunk,
                    },
                },
            });
            return dynamoDb.send(command);
        });

        const results = await Promise.all(batchPromises);

        // Build a map of composite keys to items
        const resultMap = new Map<DynamoCompositeKey, T>();

        results.forEach(result => {
            if (result.Responses && result.Responses[TABLE_NAME]) {
                result.Responses[TABLE_NAME].forEach(item => {
                    // Find the original key for this item
                    const key = keys.find(k => k.PK === item.PK && k.SK === item.SK);
                    if (key) {
                        resultMap.set(key, removeDynamoAttributes(item as T));
                    }
                });
            }
        });

        return resultMap;
    },
};

/**
 * Helper function to execute a DynamoDB GetCommand with the specified key
 * @param key The composite key to get
 * @returns The item or undefined if not found
 */
async function get<T>(key: DynamoCompositeKey): Promise<T | null> {
    const result = await dynamoDb.send(
        new GetCommand({
            TableName: TABLE_NAME,
            Key: key,
        })
    );

    if (!result.Item) {
        return null;
    }

    return removeDynamoAttributes(result.Item as T);
}

/**
 * Helper function to save an item to the DynamoDB table
 * @param key The composite key for the item
 * @param item The item data to save (without PK and SK)
 * @returns Promise that resolves when the item is saved
 */
async function save<T>(key: DynamoCompositeKey, item: T): Promise<void> {
    await dynamoDb.send(
        new PutCommand({
            TableName: TABLE_NAME,
            Item: {
                ...key,
                ...item,
            }
        })
    );
}

/**
 * Retrieves multiple items from the DynamoDB table.
 *
 * @param keys - An array of composite keys to fetch
 * @returns A Promise that resolves to a Map of composite keys to their corresponding items
 * @throws {Error} If the operation fails
 */
function getMany<T extends Record<string, unknown> = Record<string, unknown>>(
    keys: DynamoCompositeKey[]
): Promise<Map<DynamoCompositeKey, T>> {
    return BatchHelper.getMany<T>(keys);
}

async function encryptValue(value: string): Promise<string> {
    const result = await kms.send(
        new EncryptCommand({
            KeyId: process.env.KMS_KEY_ID!,
            Plaintext: Buffer.from(value),
        })
    );

    return Buffer.from(result.CiphertextBlob!).toString('base64');
}

async function decryptValue(encryptedValue: string): Promise<string> {
    const result = await kms.send(
        new DecryptCommand({ CiphertextBlob: Buffer.from(encryptedValue, 'base64') })
    );
    return Buffer.from(result.Plaintext!).toString();
}

const StorageClient = {
    async saveUserAgent(userId: string, userAgent: string): Promise<void> {
        // 90 days TTL (in seconds)
        const expiresAt = Math.floor(Date.now() / 1000) + 90 * 24 * 60 * 60;

        await save(Key.User(userId).USER_AGENT, {
            userAgent,
            ttl: expiresAt,
        });
    },

    async getUserAgent(userId: string): Promise<string | null> {
        const result = await get<{ userAgent: string }>(Key.User(userId).USER_AGENT);
        return result?.userAgent || null;
    },

    async saveUserAgentCollection(userAgents: string[]): Promise<void> {
        // 90 days TTL (in seconds)
        const expiresAt = Math.floor(Date.now() / 1000) + 90 * 24 * 60 * 60;

        await save(Key.UserAgents.COLLECTION, {
            userAgents,
            ttl: expiresAt,
        });
    },

    async getUserAgentCollection(): Promise<string[] | null> {
        const result = await get<{ userAgents: string[] }>(Key.UserAgents.COLLECTION);
        return result?.userAgents || null;
    },

    async savePortalCredentials(userId: string, username: string, password: string): Promise<void> {
        const encryptedUsername = await encryptValue(username);
        const encryptedPassword = await encryptValue(password);

        await save(Key.User(userId).PORTAL_CREDENTIALS, {
            username: encryptedUsername,
            password: encryptedPassword,
            isBad: false,
        });
    },

    async getPortalCredentials(userId: string): Promise<{
        username: string;
        isBad: boolean;
    } | null> {
        const credentials = await get<PortalCredentialsResponse>(
            Key.User(userId).PORTAL_CREDENTIALS
        );

        if (!credentials) {
            return null;
        }

        const decryptedUsername = await decryptValue(credentials.username);

        return {
            username: decryptedUsername,
            isBad: !!credentials.isBad,
        };
    },

    async sensitiveGetPortalCredentials(userId: string): Promise<{
        username: string;
        password: string;
        isBad: boolean;
    } | null> {
        const credentials = await get<PortalCredentials>(Key.User(userId).PORTAL_CREDENTIALS);

        if (!credentials) {
            return null;
        }

        const decryptedUsername = await decryptValue(credentials.username);
        const decryptedPassword = await decryptValue(credentials.password);

        return {
            username: decryptedUsername,
            password: decryptedPassword,
            isBad: !!credentials.isBad,
        };
    },

    async saveUserSession(
        userId: string,
        sessionToken: string,
        expiresAtIso: string
    ): Promise<void> {
        await save(Key.User(userId).SESSION, {
            sessionToken,
            expiresAtIso,
            expiresAt: new Date(expiresAtIso).getTime() / 1000,
        });
    },

    async getUserSession(userId: string): Promise<string | null> {
        const session = await get<{
            sessionToken: string;
            expiresAt: number;
            expiresAtIso: string;
        }>(Key.User(userId).SESSION);

        if (!session) {
            return null;
        }

        // Check if session is expired (TTL might not have processed yet)
        const expiresAt = new Date(session.expiresAt * 1000);
        const nowPlusOneHour = new Date(Date.now() + 60 * 60 * 1000);
        if (expiresAt < nowPlusOneHour) {
            console.log(
                `Saved portal session is considered expired for userId ${userId} as of ${session.expiresAtIso}`
            );
            return null;
        }

        return session.sessionToken;
    },

    async saveApiKey(userId: string, apiKeyId: string, apiKey: string): Promise<void> {
        await save(Key.User(userId).API_KEY, {
            apiKeyId,
            apiKey,
        });
    },

    async getApiKeyId(userId: string): Promise<string | null> {
        const result = await get<ApiKeyData>(Key.User(userId).API_KEY);
        return result?.apiKeyId ?? null;
    },

    async getApiKey(userId: string): Promise<{
        apiKey: string;
        webhookUrl: string;
        sharedSecret: string;
    } | null> {
        const keys: DynamoCompositeKey[] = [
            Key.User(userId).API_KEY,
            Key.User(userId).WEBHOOK_SETTINGS,
        ];

        const resultMap = await getMany(keys);

        if (resultMap.size === 0) {
            return null;
        }

        let apiKey: ApiKeyData | null = null;
        let webhook: WebhookSettings | null = null;

        // Check each of the possible keys
        const apiKeyItem = resultMap.get(keys[0]);
        const webhookItem = resultMap.get(keys[1]);

        if (apiKeyItem) {
            apiKey = apiKeyItem as unknown as ApiKeyData;
        }

        if (webhookItem) {
            webhook = webhookItem as unknown as WebhookSettings;
        }

        if (!apiKey) {
            return null;
        }

        return {
            apiKey: apiKey.apiKey,
            webhookUrl: webhook?.webhookUrl || '',
            sharedSecret: webhook?.sharedSecret || '',
        };
    },

    async saveWebhook(userId: string, webhookUrl: string, sharedSecret: string): Promise<void> {
        await save(Key.User(userId).WEBHOOK_SETTINGS, {
            webhookUrl,
            sharedSecret,
        });
    },

    async getCase(caseNumber: string): Promise<ZipCase | null> {
        const result = await get<ZipCase>(Key.Case(caseNumber).ID);
        return result ?? null;
    },

    async batchGetCases(caseNumbers: string[]): Promise<Record<string, ZipCase>> {
        if (caseNumbers.length === 0) {
            return {};
        }

        const keys: DynamoCompositeKey[] = caseNumbers.map(caseNumber => Key.Case(caseNumber).ID);

        const resultMap = await BatchHelper.getMany(keys);

        // Convert the Map to the expected Record format
        const casesMap: Record<string, ZipCase> = {};

        keys.forEach((key, index) => {
            const item = resultMap.get(key);
            const caseNumber = caseNumbers[index];

            if (item) {
                const zipCase = item as unknown as ZipCase;
                if (zipCase) {
                    casesMap[caseNumber] = zipCase;
                    return;
                }
            }

            // If we didn't find a case or couldn't process it, use a default
            casesMap[caseNumber] = { caseNumber, fetchStatus: { status: 'queued' } };
        });

        return casesMap;
    },

    async saveCase(zipCase: ZipCase): Promise<void> {
        await save(Key.Case(zipCase.caseNumber).ID, zipCase);
    },

    async saveNameSearch(
        searchId: string,
        nameSearchData: NameSearchData,
        expiresAt?: number
    ): Promise<void> {
        await save(Key.NameSearch(searchId).ID, {
            ...nameSearchData,
            ...(expiresAt ? { ttl: expiresAt } : {}),
        });
    },

    async getNameSearch(searchId: string): Promise<NameSearchData | null> {
        const result = await get<NameSearchData>(Key.NameSearch(searchId).ID);
        return result ?? null;
    },

    async updateNameSearchCases(searchId: string, caseNumbers: string[]): Promise<void> {
        const existingSearch = await this.getNameSearch(searchId);

        if (!existingSearch) {
            throw new Error(`Name search with ID ${searchId} not found`);
        }

        // Merge with existing case numbers, removing duplicates
        const allCases = Array.from(new Set([...existingSearch.cases, ...caseNumbers]));

        await this.saveNameSearch(searchId, {
            ...existingSearch,
            cases: allCases,
        });
    },

    async getSearchResults(caseNumbers: string[]): Promise<Record<string, SearchResult>> {
        if (caseNumbers.length === 0) {
            return {};
        }

        // Create all the keys we need to fetch (case + summary for each case)
        const allKeys: DynamoCompositeKey[] = [];
        const keyMapping: Record<
            string,
            { caseKey: DynamoCompositeKey; summaryKey: DynamoCompositeKey }
        > = {};

        caseNumbers.forEach(caseNumber => {
            const caseKey = Key.Case(caseNumber).ID;
            const summaryKey = Key.Case(caseNumber).SUMMARY;

            keyMapping[caseNumber] = { caseKey, summaryKey };
            allKeys.push(caseKey, summaryKey);
        });

        const resultMap = await getMany(allKeys);

        const results: Record<string, SearchResult> = {};

        caseNumbers.forEach(caseNumber => {
            const { caseKey, summaryKey } = keyMapping[caseNumber];
            const caseItem = resultMap.get(caseKey);

            if (!caseItem) {
                return;
            }

            const caseData = caseItem as unknown as ZipCase;
            if (!caseData) {
                return;
            }

            const summaryItem = resultMap.get(summaryKey);
            const summary = summaryItem as unknown as CaseSummary;

            results[caseNumber] = {
                zipCase: caseData,
                caseSummary: summary ?? undefined,
            };
        });

        return results;
    },

    async getSearchResult(caseNumber: string): Promise<SearchResult | null> {
        const results = await this.getSearchResults([caseNumber]);
        return results[caseNumber] || null;
    },

    async saveCaseSummary(caseNumber: string, caseSummary: CaseSummary): Promise<void> {
        await save(Key.Case(caseNumber).SUMMARY, caseSummary);
    },
};

export default StorageClient;
