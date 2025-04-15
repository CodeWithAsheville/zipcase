import { renderHook, act, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import useZipCaseApi from '../useZipCaseApi';
import { ZipCaseClient } from '../../services';

vi.mock('../../aws-exports', () => ({
  API_URL: 'http://test-api.example.com'
}));

// Since the module itself uses a singleton instance, we need to manually mock
// the entire module, not just the imported functions
vi.mock('../../services', () => {
    const mockClient = {
        get: vi.fn(),
        post: vi.fn(),
        put: vi.fn(),
        delete: vi.fn(),
    };
    
    return {
        ZipCaseClient: function() {
            return mockClient;
        }
    };
});

describe('useZipCaseApi', () => {
    let mockClient: any;
    
    beforeEach(() => {
        vi.clearAllMocks();
        // Get a reference to the mocked client for each test
        mockClient = new ZipCaseClient();
    });

    it('initializes with correct default state', () => {
        const { result } = renderHook(() =>
            useZipCaseApi(() => Promise.resolve({
                success: true,
                status: 200,
                data: null,
                error: null
            }))
        );

        // Default state
        expect(result.current.data).toBeNull();
        expect(result.current.error).toBeNull();
        expect(result.current.loading).toBe(false);
    });

    it('executes API call on mount when onMount is true', async () => {
        // Setup the mock to return a successful response
        const mockResponse = { 
            success: true, 
            status: 200, 
            data: { testData: 'value' }, 
            error: null 
        };
        const mockFn = vi.fn().mockResolvedValue(mockResponse);

        const { result } = renderHook(() => useZipCaseApi(mockFn, true));

        // Wait for state to update after API call
        await waitFor(() => {
            expect(result.current.loading).toBe(false);
        });

        // Verify the mock was called
        expect(mockFn).toHaveBeenCalled();
        expect(result.current.data).toEqual(mockResponse.data);
        expect(result.current.error).toBeNull();
    });

    it('updates state correctly on successful API call', async () => {
        // Setup the mock to return a successful response
        const mockData = { testData: 'success' };
        const mockResponse = { 
            success: true, 
            status: 200, 
            data: mockData, 
            error: null 
        };
        const mockFn = vi.fn().mockResolvedValue(mockResponse);

        const { result } = renderHook(() => useZipCaseApi(mockFn));

        // Initial state
        expect(result.current.loading).toBe(false);

        // Call the API
        await act(async () => {
            await result.current.callApi();
        });

        // Verify state was updated
        expect(mockFn).toHaveBeenCalled();
        expect(result.current.data).toEqual(mockData);
        expect(result.current.error).toBeNull();
        expect(result.current.loading).toBe(false);
    });

    it('handles API errors correctly', async () => {
        // Setup the mock to return an error response
        const errorMessage = 'API error';
        const mockResponse = { 
            success: false, 
            status: 400, 
            data: null, 
            error: errorMessage 
        };
        const mockFn = vi.fn().mockResolvedValue(mockResponse);

        const { result } = renderHook(() => useZipCaseApi(mockFn));

        // Call the API
        await act(async () => {
            await result.current.callApi();
        });

        // Verify state was updated
        expect(mockFn).toHaveBeenCalled();
        expect(result.current.data).toBeNull();
        expect(result.current.error).toBe(errorMessage);
        expect(result.current.loading).toBe(false);
    });

    it('handles exceptions in API calls', async () => {
        // Setup the mock to throw an error
        const errorMessage = 'Network Error';
        const mockFn = vi.fn().mockRejectedValue(new Error(errorMessage));

        const { result } = renderHook(() => useZipCaseApi(mockFn));

        // Call the API
        await act(async () => {
            await result.current.callApi();
        });

        // Verify state was updated
        expect(mockFn).toHaveBeenCalled();
        expect(result.current.data).toBeNull();
        expect(result.current.error).toBe(errorMessage);
        expect(result.current.loading).toBe(false);
    });

    it('updates endpoint reference when it changes', async () => {
        // Setup mock for initial and updated calls
        mockClient.get.mockImplementationOnce(() => 
            Promise.resolve({
                success: true,
                status: 200,
                data: { test: 'initial' },
                error: null
            })
        ).mockImplementationOnce(() => 
            Promise.resolve({
                success: true,
                status: 200,
                data: { test: 'updated' },
                error: null
            })
        );

        // Create a hook that uses the client's get method with the endpoint
        const { result, rerender } = renderHook(
            (props) => useZipCaseApi(() => mockClient.get(props.endpoint)),
            {
                initialProps: { endpoint: '/initial' }
            }
        );

        // Call with initial endpoint
        await act(async () => {
            await result.current.callApi();
        });

        // Verify client was called with correct endpoint
        expect(mockClient.get).toHaveBeenCalledWith('/initial');
        expect(result.current.data).toEqual({ test: 'initial' });

        // Rerender with new endpoint
        rerender({ endpoint: '/updated' });

        // Call API again
        await act(async () => {
            await result.current.callApi();
        });

        // Verify client was called with updated endpoint
        expect(mockClient.get).toHaveBeenCalledWith('/updated');
        expect(result.current.data).toEqual({ test: 'updated' });
    });
});