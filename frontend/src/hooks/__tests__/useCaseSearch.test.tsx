/**
 * Tests for the useCaseSearch hooks
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { useSearchResults, useConsolidatedPolling } from '../useCaseSearch';

// Create a wrapper for the tests that need React Query context
const createTestQueryClient = (initialData = null) => {
    const queryClient = new QueryClient({
        defaultOptions: {
            queries: {
                retry: false,
            },
        },
    });

    if (initialData) {
        queryClient.setQueryData(['searchResults'], initialData);
    }

    return queryClient;
};

const createWrapper = (queryClient?: QueryClient) => {
    const testQueryClient = queryClient || createTestQueryClient();
    return ({ children }: { children: React.ReactNode }) => (
        <QueryClientProvider client={testQueryClient}>{children}</QueryClientProvider>
    );
};

// Basic tests for the hooks
describe('useSearchResults', () => {
    beforeEach(() => {
        vi.resetAllMocks();
    });

    afterEach(() => {
        vi.resetAllMocks();
    });

    it('should return empty results when no data is available', () => {
        const { result } = renderHook(() => useSearchResults(), {
            wrapper: createWrapper(),
        });

        expect(result.current.data).toEqual({
            results: {},
            searchBatches: [],
        });
    });

    it('should return data from the query client cache', () => {
        const testData = {
            results: {
                case123: {
                    zipCase: {
                        caseNumber: 'case123',
                        fetchStatus: { status: 'complete' },
                    },
                },
            },
            searchBatches: [['case123']],
        };

        const queryClient = createTestQueryClient();
        queryClient.setQueryData(['searchResults'], testData);
        const wrapper = createWrapper(queryClient);

        const { result } = renderHook(() => useSearchResults(), { wrapper });

        // Should return the data we put in the cache
        expect(result.current.data).toEqual(testData);
    });
});

// Instead of mocking ZipCaseClient directly, we'll test the hook behavior
describe('useConsolidatedPolling - state management', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('should initially not be polling', () => {
        const { result } = renderHook(() => useConsolidatedPolling(), {
            wrapper: createWrapper(),
        });

        expect(result.current.isPolling).toBe(false);
    });

    it('should expose polling control methods', () => {
        const { result } = renderHook(() => useConsolidatedPolling(), {
            wrapper: createWrapper(),
        });

        expect(typeof result.current.startPolling).toBe('function');
        expect(typeof result.current.stopPolling).toBe('function');
        expect(typeof result.current.pollNow).toBe('function');
    });

    it('should toggle polling state correctly', async () => {
        // Create a special wrapper that gives access to pollingRef.current.active
        // which is how the hook internally tracks polling state
        const { result } = renderHook(() => useConsolidatedPolling(), {
            wrapper: createWrapper(),
        });

        // Inspect isPolling initially (should be false)
        expect(result.current.isPolling).toBe(false);

        // Start polling
        await act(async () => {
            const startResult = result.current.startPolling();
            // The function returns true if it successfully started polling
            expect(startResult).toBe(true);
        });

        // Stop polling
        await act(async () => {
            const stopResult = result.current.stopPolling();
            // The function returns true if it successfully stopped polling
            expect(stopResult).toBe(true);
        });
    });
});
