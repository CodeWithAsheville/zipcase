// jest.setup.ts

// Set NODE_ENV to test for consistent test environment
process.env.NODE_ENV = 'test';

// Mock DynamoDB for testing to avoid actual AWS calls
jest.mock('@aws-sdk/client-dynamodb', () => ({
    DynamoDBClient: jest.fn().mockImplementation(() => ({
        send: jest.fn().mockResolvedValue({
            Item: null,
            Attributes: null,
        }),
    })),
    GetItemCommand: jest.fn(),
    PutItemCommand: jest.fn(),
    UpdateItemCommand: jest.fn(),
}));

// Mock DynamoDB Document Client
jest.mock('@aws-sdk/lib-dynamodb', () => ({
    DynamoDBDocumentClient: {
        from: jest.fn().mockImplementation(() => ({
            send: jest.fn().mockResolvedValue({
                Item: null,
                Items: [],
                Count: 0,
                ScannedCount: 0,
            }),
        })),
    },
    GetCommand: jest.fn(),
    PutCommand: jest.fn(),
    UpdateCommand: jest.fn(),
    QueryCommand: jest.fn(),
    ScanCommand: jest.fn(),
    DeleteCommand: jest.fn(),
}));
