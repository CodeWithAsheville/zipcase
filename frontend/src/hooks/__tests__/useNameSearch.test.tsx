import { describe, it, expect, vi } from 'vitest';

const mockNameSearch = vi.fn().mockResolvedValue({
    success: true,
    data: { searchId: 'test-id', results: {}, success: true },
});

vi.mock('../../services', () => {
    return {
        ZipCaseClient: function () {
            return {
                cases: {
                    nameSearch: mockNameSearch,
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
