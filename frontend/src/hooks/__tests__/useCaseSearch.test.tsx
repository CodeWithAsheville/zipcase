/**
 * Tests for the useCaseSearch hooks
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { useSearchResults, useConsolidatedPolling, useRemoveCase } from '../useCaseSearch';

vi.mock('../../aws-exports', () => ({
    API_URL: 'http://test-api.example.com',
}));

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
    return ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={testQueryClient}>{children}</QueryClientProvider>;
};

// Basic tests for the hooks
describe('useSearchResults', () => {
    beforeEach(() => {
        vi.resetAllMocks();
    });

    afterEach(() => {
        vi.resetAllMocks();
    });

    it('should return empty results when no data is available', async () => {
        const { result } = renderHook(() => useSearchResults(), {
            wrapper: createWrapper(),
        });

        await waitFor(() => {
            expect(result.current.data).toEqual({
                results: {},
                searchBatches: [],
            });
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

    it('should handle cases with reprocessing status in cached data', () => {
        const testData = {
            results: {
                case123: {
                    zipCase: {
                        caseNumber: 'case123',
                        fetchStatus: { status: 'reprocessing', tryCount: 1 },
                    },
                },
                case456: {
                    zipCase: {
                        caseNumber: 'case456',
                        fetchStatus: { status: 'complete' },
                    },
                },
            },
            searchBatches: [['case123', 'case456']],
        };

        const queryClient = createTestQueryClient();
        queryClient.setQueryData(['searchResults'], testData);
        const wrapper = createWrapper(queryClient);

        const { result } = renderHook(() => useSearchResults(), { wrapper });

        // Should return the data including reprocessing status
        expect(result.current.data).toEqual(testData);
        expect(result.current.data.results.case123.zipCase.fetchStatus.status).toBe('reprocessing');
        const reprocessingStatus = result.current.data.results.case123.zipCase.fetchStatus;
        if (reprocessingStatus.status === 'reprocessing') {
            expect(reprocessingStatus.tryCount).toBe(1);
        }
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

describe('useRemoveCase', () => {
    beforeEach(() => {
        vi.resetAllMocks();
    });

    afterEach(() => {
        vi.resetAllMocks();
    });

    it('should remove a case from results and batches', () => {
        const testData = {
            results: {
                case123: {
                    zipCase: {
                        caseNumber: 'case123',
                        fetchStatus: { status: 'complete' },
                    },
                },
                case456: {
                    zipCase: {
                        caseNumber: 'case456',
                        fetchStatus: { status: 'complete' },
                    },
                },
            },
            searchBatches: [['case123', 'case456']],
        };

        const queryClient = createTestQueryClient();
        queryClient.setQueryData(['searchResults'], testData);
        const wrapper = createWrapper(queryClient);

        const { result } = renderHook(() => useRemoveCase(), { wrapper });

        // Remove case123
        act(() => {
            result.current('case123');
        });

        // Check that the case was removed
        const updatedData = queryClient.getQueryData(['searchResults']);
        expect(updatedData).toEqual({
            results: {
                case456: {
                    zipCase: {
                        caseNumber: 'case456',
                        fetchStatus: { status: 'complete' },
                    },
                },
            },
            searchBatches: [['case456']],
        });
    });

    it('should remove empty batches after removing all cases', () => {
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

        const { result } = renderHook(() => useRemoveCase(), { wrapper });

        // Remove case123
        act(() => {
            result.current('case123');
        });

        // Check that the batch was removed too
        const updatedData = queryClient.getQueryData(['searchResults']);
        expect(updatedData).toEqual({
            results: {},
            searchBatches: [],
        });
    });

    it('should handle removing a non-existent case gracefully', () => {
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

        const { result } = renderHook(() => useRemoveCase(), { wrapper });

        // Remove non-existent case
        act(() => {
            result.current('case999');
        });

        // Check that the state remains the same
        const updatedData = queryClient.getQueryData(['searchResults']);
        expect(updatedData).toEqual({
            results: {
                case123: {
                    zipCase: {
                        caseNumber: 'case123',
                        fetchStatus: { status: 'complete' },
                    },
                },
            },
            searchBatches: [['case123']],
        });
    });
});
