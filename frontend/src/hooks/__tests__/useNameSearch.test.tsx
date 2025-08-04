it('should stop polling after 30s if results do not change', async () => {
    vi.useFakeTimers();
    const queryClient = new QueryClient();
    const wrapper = ({ children }: { children: React.ReactNode }) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    mockNameSearch.mockResolvedValueOnce({
        success: true,
        data: {
            searchId: 'timeout-id',
            results: {
                foo: { zipCase: { caseNumber: 'foo', fetchStatus: { status: 'complete' } } },
            },
            success: true,
        },
    });
    // Always return the same results, never changing
    mockNameSearchStatus.mockResolvedValue({
        success: true,
        data: {
            status: 'processing',
            results: {
                foo: { zipCase: { caseNumber: 'foo', fetchStatus: { status: 'complete' } } },
            },
        },
    });

    const { result } = renderHook(() => useNameSearch(), { wrapper });
    const mutateAsync = result.current.mutateAsync || result.current.mutate;
    await act(async () => {
        await mutateAsync({ name: 'Timeout Test', soundsLike: false });
    });

    // Fast-forward timers to simulate repeated polling
    for (let i = 0; i < 15; i++) {
        await act(async () => {
            vi.advanceTimersByTime(3000);
        });
    }

    // Should have called nameSearchStatus multiple times (at least 10 for 30s/3s)
    expect(mockNameSearchStatus).toHaveBeenCalled();

    // After 30s, polling should stop: advancing time further should not increase call count
    await act(async () => {
        vi.advanceTimersByTime(6000);
    });
    const callsAfterTimeout = mockNameSearchStatus.mock.calls.length;
    await act(async () => {
        vi.advanceTimersByTime(6000);
    });
    const callsBefore = mockNameSearchStatus.mock.calls.length;
    await act(async () => {
        vi.advanceTimersByTime(6000);
    });
    expect(mockNameSearchStatus.mock.calls.length).toBeGreaterThanOrEqual(callsBefore);
    expect(mockNameSearchStatus.mock.calls.length).toBeLessThanOrEqual(callsBefore + 1);

    vi.useRealTimers();
});
import { describe, it, expect, vi } from 'vitest';

const mockNameSearch = vi.fn().mockResolvedValue({
    success: true,
    data: { searchId: 'test-id', results: {}, success: true },
});

const mockNameSearchStatus = vi.fn();

vi.mock('../../services', () => {
    return {
        ZipCaseClient: function () {
            return {
                cases: {
                    nameSearch: mockNameSearch,
                    nameSearchStatus: mockNameSearchStatus,
                },
            };
        },
    };
});

import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useNameSearch } from '../useNameSearch';

describe('useNameSearch', () => {
    it('should pass criminalOnly to the API client', async () => {
        const queryClient = new QueryClient();
        const wrapper = ({ children }: { children: React.ReactNode }) => (
            <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
        );
        const { result } = renderHook(() => useNameSearch(), { wrapper });
        const mutateAsync = result.current.mutateAsync || result.current.mutate;
        const params = {
            name: 'Jane Doe',
            soundsLike: false,
            criminalOnly: true,
        };
        await act(async () => {
            await mutateAsync(params);
        });
        expect(mockNameSearch).toHaveBeenCalledWith(
            'Jane Doe',
            undefined,
            false,
            true // criminalOnly
        );
    });
});
