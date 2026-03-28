describe('WebSocketStorage', () => {
    const mockSend = jest.fn();

    beforeEach(() => {
        jest.resetModules();
        jest.clearAllMocks();
        process.env.ZIPCASE_DATA_TABLE = 'zipcase-data-test';
    });

    async function loadStorage() {
        jest.doMock('@aws-sdk/client-dynamodb', () => ({
            DynamoDBClient: jest.fn().mockImplementation(() => ({})),
        }));

        jest.doMock('@aws-sdk/lib-dynamodb', () => ({
            DynamoDBDocumentClient: {
                from: jest.fn().mockReturnValue({
                    send: mockSend,
                }),
            },
            GetCommand: jest.fn().mockImplementation(params => params),
            PutCommand: jest.fn().mockImplementation(params => params),
            DeleteCommand: jest.fn().mockImplementation(params => params),
            QueryCommand: jest.fn().mockImplementation(params => params),
        }));

        return await import('../WebSocketStorage');
    }

    it('saveConnection writes connection and user index records', async () => {
        const { default: WebSocketStorage } = await loadStorage();
        mockSend.mockResolvedValue({});

        await WebSocketStorage.saveConnection('conn-1', 'user-1');

        expect(mockSend).toHaveBeenCalledTimes(2);
        const firstCall = mockSend.mock.calls[0][0];
        const secondCall = mockSend.mock.calls[1][0];

        expect(firstCall.TableName).toBe('zipcase-data-test');
        expect(firstCall.Item.PK).toBe('WSCONN#conn-1');
        expect(secondCall.Item.PK).toBe('WSUSER#user-1');
    });

    it('getConnectionIdsForSubject returns connection IDs only', async () => {
        const { default: WebSocketStorage } = await loadStorage();
        mockSend.mockResolvedValue({
            Items: [{ connectionId: 'conn-1' }, { connectionId: 'conn-2' }, { connectionId: '' }, { notConnectionId: 'x' }],
        });

        const ids = await WebSocketStorage.getConnectionIdsForSubject('user-1', 'case', '22cr123');

        expect(ids).toEqual(['conn-1', 'conn-2']);
        const queryCall = mockSend.mock.calls[0][0];
        expect(queryCall.ExpressionAttributeValues[':pk']).toBe('WSSUB#user-1#case#22CR123');
    });

    it('deleteConnection removes meta, user index, and subscriptions', async () => {
        const { default: WebSocketStorage } = await loadStorage();

        mockSend
            .mockResolvedValueOnce({ Item: { PK: 'WSCONN#conn-1', SK: 'META', userId: 'user-1' } })
            .mockResolvedValueOnce({
                Items: [{ PK: 'WSCONN#conn-1', SK: 'SUB#case#22CR123', subjectType: 'case', subjectId: '22CR123' }],
            })
            .mockResolvedValue({});

        await WebSocketStorage.deleteConnection('conn-1');

        expect(mockSend).toHaveBeenCalledTimes(6);
        const deleteCalls = mockSend.mock.calls.slice(2).map(call => call[0]);
        expect(deleteCalls.some(call => call.Key.PK === 'WSCONN#conn-1' && call.Key.SK === 'META')).toBe(true);
        expect(deleteCalls.some(call => call.Key.PK === 'WSUSER#user-1' && call.Key.SK === 'CONN#conn-1')).toBe(true);
        expect(deleteCalls.some(call => call.Key.PK === 'WSSUB#user-1#case#22CR123' && call.Key.SK === 'CONN#conn-1')).toBe(true);
    });
});
