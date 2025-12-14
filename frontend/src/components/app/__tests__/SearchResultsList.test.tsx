import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import SearchResultsList from '../SearchResultsList';
import { SearchResult, ZipCase } from '../../../../../shared/types';
import userEvent from '@testing-library/user-event';

// Import hooks to mock
import * as hooks from '../../../hooks/useCaseSearch';

// Mock the hooks from useCaseSearch
vi.mock('../../../hooks/useCaseSearch', () => {
    return {
        useSearchResults: vi.fn(),
        useConsolidatedPolling: vi.fn(() => ({
            isPolling: false,
            startPolling: vi.fn(),
            stopPolling: vi.fn(),
        })),
        useCaseStatusPolling: vi.fn(),
    };
});

// Mock the SearchResult component
vi.mock('../SearchResult', () => ({
    default: vi.fn(({ searchResult }) => (
        <div data-testid="search-result">
            <div data-testid="case-number">{searchResult.zipCase.caseNumber}</div>
            <div data-testid="status">{searchResult.zipCase.fetchStatus.status}</div>
        </div>
    )),
}));

// Mock the console methods to avoid noise in test output
vi.spyOn(console, 'log').mockImplementation(() => {});
vi.spyOn(console, 'error').mockImplementation(() => {});

// Helper to create a mock search result
const createSearchResult = (caseNumber: string, status: string): SearchResult => ({
    zipCase: {
        caseNumber,
        fetchStatus: { status } as any,
    } as ZipCase,
});

// Setup query client for the component
const createWrapper = () => {
    const queryClient = new QueryClient({
        defaultOptions: {
            queries: {
                retry: false,
            },
        },
    });

    return ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
};

describe('SearchResultsList', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('shows loading state when isLoading is true', () => {
        // Mock the hook to return loading state
        vi.mocked(hooks.useSearchResults).mockReturnValue({
            data: undefined,
            isLoading: true,
            isError: false,
            error: null,
        } as any);

        render(<SearchResultsList />, { wrapper: createWrapper() });

        // Check for loading indicator (animated pulse element)
        expect(screen.getByTestId('loading-pulse')).toBeInTheDocument();
    });

    it('renders empty div when no results are available', () => {
        // Mock the hook to return empty results
        vi.mocked(hooks.useSearchResults).mockReturnValue({
            data: { results: {}, searchBatches: [] },
            isLoading: false,
            isError: false,
            error: null,
        } as any);

        const { container } = render(<SearchResultsList />, { wrapper: createWrapper() });

        // Verify no search results are rendered
        expect(screen.queryByTestId('search-result')).not.toBeInTheDocument();
        // There should be a div structure but no actual content
        expect(container.querySelector('.max-w-4xl')).toBeInTheDocument();
    });

    it('renders search results in the correct order (newest batch first)', () => {
        const mockResults = {
            case1: createSearchResult('case1', 'complete'),
            case2: createSearchResult('case2', 'processing'),
            case3: createSearchResult('case3', 'queued'),
            case4: createSearchResult('case4', 'failed'),
        };

        // Mock batches with newest first (case3, case4 are the newest search)
        const mockBatches = [
            ['case3', 'case4'],
            ['case1', 'case2'],
        ];

        // Mock the hook to return the test data
        vi.mocked(hooks.useSearchResults).mockReturnValue({
            data: {
                results: mockResults,
                searchBatches: mockBatches,
            },
            isLoading: false,
            isError: false,
            error: null,
        } as any);

        render(<SearchResultsList />, { wrapper: createWrapper() });

        // Check that results are rendered in the order of batches
        const caseNumbers = screen.getAllByTestId('case-number').map(el => el.textContent);
        expect(caseNumbers).toEqual(['case3', 'case4', 'case1', 'case2']);
    });

    it('deduplicates case numbers that appear in multiple batches', () => {
        const mockResults = {
            case1: createSearchResult('case1', 'complete'),
            case2: createSearchResult('case2', 'processing'),
        };

        // Mock batches with duplication (case1 appears in both batches)
        const mockBatches = [['case1', 'case2'], ['case1']];

        // Mock the hook to return data with duplicates
        vi.mocked(hooks.useSearchResults).mockReturnValue({
            data: {
                results: mockResults,
                searchBatches: mockBatches,
            },
            isLoading: false,
            isError: false,
            error: null,
        } as any);

        render(<SearchResultsList />, { wrapper: createWrapper() });

        // Check that case1 appears only once (deduplicated)
        const caseNumbers = screen.getAllByTestId('case-number').map(el => el.textContent);
        expect(caseNumbers).toEqual(['case1', 'case2']);
        expect(caseNumbers.filter(num => num === 'case1')).toHaveLength(1);
    });

    it('starts polling when non-terminal cases are present', () => {
        const startPollingMock = vi.fn();
        vi.mocked(hooks.useConsolidatedPolling).mockReturnValue({
            isPolling: false,
            startPolling: startPollingMock,
            stopPolling: vi.fn(),
        } as any);

        const mockResults = {
            case1: createSearchResult('case1', 'complete'), // terminal
            case2: createSearchResult('case2', 'processing'), // non-terminal
            case3: createSearchResult('case3', 'notFound'), // non-terminal (should retry)
        };

        // Mock the hook to return a mix of terminal and non-terminal cases
        vi.mocked(hooks.useSearchResults).mockReturnValue({
            data: {
                results: mockResults,
                searchBatches: [['case1', 'case2', 'case3']],
            },
            isLoading: false,
            isError: false,
            error: null,
        } as any);

        render(<SearchResultsList />, { wrapper: createWrapper() });

        // Check that polling was started
        expect(startPollingMock).toHaveBeenCalled();
    });

    it('does not start polling when only terminal cases are present', () => {
        const startPollingMock = vi.fn();
        vi.mocked(hooks.useConsolidatedPolling).mockReturnValue({
            isPolling: false,
            startPolling: startPollingMock,
            stopPolling: vi.fn(),
        } as any);

        const mockResults = {
            case1: createSearchResult('case1', 'complete'),
            case2: createSearchResult('case2', 'failed'),
        };

        // Mock the hook to return only terminal cases
        vi.mocked(hooks.useSearchResults).mockReturnValue({
            data: {
                results: mockResults,
                searchBatches: [['case1', 'case2']],
            },
            isLoading: false,
            isError: false,
            error: null,
        } as any);

        render(<SearchResultsList />, { wrapper: createWrapper() });

        // Check that polling was not started
        expect(startPollingMock).not.toHaveBeenCalled();
    });

    it('handles error state correctly', () => {
        // Mock the hook to return an error
        vi.mocked(hooks.useSearchResults).mockReturnValue({
            data: undefined,
            isLoading: false,
            isError: true,
            error: new Error('Failed to fetch results'),
        } as any);

        render(<SearchResultsList />, { wrapper: createWrapper() });

        // Should not display any results
        expect(screen.queryByTestId('search-result')).not.toBeInTheDocument();

        // Console error should have been called
        expect(console.error).toHaveBeenCalled();
    });

    it('renders copy case numbers button when results are present', () => {
        const mockResults = {
            case1: createSearchResult('case1', 'complete'),
            case2: createSearchResult('case2', 'processing'),
        };

        vi.mocked(hooks.useSearchResults).mockReturnValue({
            data: {
                results: mockResults,
                searchBatches: [['case1', 'case2']],
            },
            isLoading: false,
            isError: false,
            error: null,
        } as any);

        render(<SearchResultsList />, { wrapper: createWrapper() });

        // Check that the copy button is rendered
        expect(screen.getByRole('button', { name: /copy all case numbers/i })).toBeInTheDocument();
    });

    it('does not render copy case numbers button when no results', () => {
        vi.mocked(hooks.useSearchResults).mockReturnValue({
            data: { results: {}, searchBatches: [] },
            isLoading: false,
            isError: false,
            error: null,
        } as any);

        render(<SearchResultsList />, { wrapper: createWrapper() });

        // Check that the copy button is not rendered
        expect(screen.queryByRole('button', { name: /copy all case numbers/i })).not.toBeInTheDocument();
    });

    it('copies case numbers to clipboard when button is clicked', async () => {
        const user = userEvent.setup();

        const mockResults = {
            'case1': createSearchResult('case1', 'complete'),
            'case2': createSearchResult('case2', 'processing'),
            'case3': createSearchResult('case3', 'queued'),
        };

        vi.mocked(hooks.useSearchResults).mockReturnValue({
            data: {
                results: mockResults,
                searchBatches: [['case1', 'case2', 'case3']],
            },
            isLoading: false,
            isError: false,
            error: null,
        } as any);

        // Mock clipboard API
        const writeTextMock = vi.fn().mockResolvedValue(undefined);
        Object.defineProperty(navigator, 'clipboard', {
            value: {
                writeText: writeTextMock,
            },
            writable: true,
            configurable: true,
        });

        render(<SearchResultsList />, { wrapper: createWrapper() });

        const copyButton = screen.getByRole('button', { name: /copy all case numbers/i });
        await user.click(copyButton);

        // Verify clipboard.writeText was called with correct case numbers
        expect(writeTextMock).toHaveBeenCalledWith('case1\ncase2\ncase3');

        // Verify button shows "Copied!" feedback
        expect(screen.getByText('Copied!')).toBeInTheDocument();
    });
});
