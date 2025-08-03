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

it('should stop polling when status is complete', async () => {
    vi.useFakeTimers();
    const queryClient = new QueryClient();
    const wrapper = ({ children }: { children: React.ReactNode }) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    // First call returns processing, second call returns complete
    mockNameSearch.mockResolvedValueOnce({
        success: true,
        data: { searchId: 'poll-id', results: {}, success: true },
    });
    mockNameSearchStatus
        .mockResolvedValueOnce({ success: true, data: { status: 'processing', results: {} } })
        .mockResolvedValueOnce({ success: true, data: { status: 'complete', results: {} } });

    const { result } = renderHook(() => useNameSearch(), { wrapper });
    const mutateAsync = result.current.mutateAsync || result.current.mutate;
    await act(async () => {
        await mutateAsync({ name: 'Poll Test', soundsLike: false });
    });

    // Fast-forward timers to trigger polling
    await act(async () => {
        vi.advanceTimersByTime(3000); // first poll
    });
    await act(async () => {
        vi.advanceTimersByTime(3000); // second poll (should complete)
    });

    // Should have called nameSearchStatus twice
    expect(mockNameSearchStatus).toHaveBeenCalledTimes(2);

    // After completion, further polling should not occur
    await act(async () => {
        vi.advanceTimersByTime(6000);
    });
    expect(mockNameSearchStatus).toHaveBeenCalledTimes(2);

    vi.useRealTimers();
});
