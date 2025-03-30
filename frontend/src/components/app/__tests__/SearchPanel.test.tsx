import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import SearchPanel from '../SearchPanel';
import { useCaseSearch } from '../../../hooks';

// Mock the useCaseSearch hook
vi.mock('../../../hooks', () => ({
    useCaseSearch: vi.fn(() => ({
        mutate: vi.fn((caseNumber, options) => {
            // Simulate successful mutation by default
            if (options && options.onSuccess) {
                options.onSuccess({ results: { [caseNumber]: { zipCase: { caseNumber } } } });
            }
        }),
        isPending: false,
    })),
}));

// Setup for wrapping component with QueryClientProvider
const createWrapper = () => {
    const queryClient = new QueryClient({
        defaultOptions: {
            queries: {
                retry: false,
            },
        },
    });

    return ({ children }: { children: React.ReactNode }) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
};

describe('SearchPanel Component', () => {
    let user: ReturnType<typeof userEvent.setup>;

    beforeEach(() => {
        user = userEvent.setup();
        // Clear all mocks before each test
        vi.clearAllMocks();
    });

    it('renders correctly with initial empty state', () => {
        render(<SearchPanel />, { wrapper: createWrapper() });

        // Check for main elements
        expect(screen.getByText('Case Search')).toBeInTheDocument();
        expect(screen.getByLabelText('Case Numbers')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /search/i })).toBeInTheDocument();

        // Button should be disabled when input is empty
        expect(screen.getByRole('button', { name: /search/i })).toBeDisabled();

        // Input should be empty
        expect(screen.getByLabelText('Case Numbers')).toHaveValue('');

        // No error message should be visible
        expect(screen.queryByText(/please enter a case number/i)).not.toBeInTheDocument();
    });

    it('enables the search button when input is not empty', async () => {
        render(<SearchPanel />, { wrapper: createWrapper() });

        const input = screen.getByLabelText('Case Numbers');
        const searchButton = screen.getByRole('button', { name: /search/i });

        // Initially button is disabled
        expect(searchButton).toBeDisabled();

        // Enter a case number
        await user.type(input, '22CR123456-789');

        // Button should now be enabled
        expect(searchButton).toBeEnabled();
    });

    it('submits the form with the entered case number', async () => {
        // Create a mock onSearch callback
        const onSearchMock = vi.fn();

        render(<SearchPanel onSearch={onSearchMock} />, { wrapper: createWrapper() });

        const input = screen.getByLabelText('Case Numbers');
        const searchButton = screen.getByRole('button', { name: /search/i });

        // Enter a case number
        await user.type(input, '22CR123456-789');

        // Click the search button
        await user.click(searchButton);

        // Verify onSearch was called with the correct case number
        expect(onSearchMock).toHaveBeenCalledWith('22CR123456-789');
    });

    it('displays an error when submitting with empty input', async () => {
        render(<SearchPanel />, { wrapper: createWrapper() });

        // Find the form using query selector since it doesn't have a role
        const form = document.querySelector('form');
        if (!form) throw new Error('Form not found');

        // Submit the empty form
        fireEvent.submit(form);

        // Should show error message
        expect(screen.getByText('Please enter a case number')).toBeInTheDocument();
    });

    it('clears the input field on successful search', async () => {
        render(<SearchPanel />, { wrapper: createWrapper() });

        const input = screen.getByLabelText('Case Numbers');
        const searchButton = screen.getByRole('button', { name: /search/i });

        // Enter a case number
        await user.type(input, '22CR123456-789');

        // Click the search button
        await user.click(searchButton);

        // Input should be cleared after success
        await waitFor(() => {
            expect(input).toHaveValue('');
        });
    });

    it('handles keyboard shortcut (Ctrl+Enter) for form submission', async () => {
        const onSearchMock = vi.fn();

        render(<SearchPanel onSearch={onSearchMock} />, { wrapper: createWrapper() });

        const input = screen.getByLabelText('Case Numbers');

        // Enter a case number
        await user.type(input, '22CR123456-789');

        // Press Ctrl+Enter to submit
        await user.keyboard('{Control>}{Enter}{/Control}');

        // Verify onSearch was called
        expect(onSearchMock).toHaveBeenCalledWith('22CR123456-789');
    });

    it('disables the input and shows loading state during search', async () => {
        // Mock the useCaseSearch hook to return isPending: true
        const mockUseCaseSearch = vi.mocked(useCaseSearch);
        mockUseCaseSearch.mockImplementation(() => ({
            mutate: vi.fn(),
            isPending: true,
        }));

        render(<SearchPanel />, { wrapper: createWrapper() });

        const input = screen.getByLabelText('Case Numbers');
        const searchButton = screen.getByRole('button', { name: /search/i });

        // Input should be disabled
        expect(input).toBeDisabled();

        // Button should be disabled and show loading state
        expect(searchButton).toBeDisabled();
        expect(screen.getByText('Searching...')).toBeInTheDocument();
    });

    it('shows an error message when search fails', async () => {
        // Mock the useCaseSearch hook to simulate an error
        const mockUseCaseSearch = vi.mocked(useCaseSearch);
        mockUseCaseSearch.mockImplementation(() => ({
            mutate: vi.fn((_, options) => {
                if (options && options.onError) {
                    options.onError(new Error('Search failed'));
                }
            }),
            isPending: false,
        }));

        render(<SearchPanel />, { wrapper: createWrapper() });

        const input = screen.getByLabelText('Case Numbers');
        const searchButton = screen.getByRole('button', { name: /search/i });

        // Enter a case number
        await user.type(input, '22CR123456-789');

        // Click the search button
        await user.click(searchButton);

        // Should show error message
        expect(screen.getByText('Search failed')).toBeInTheDocument();

        // Input should not be cleared on error
        expect(input).toHaveValue('22CR123456-789');
    });
});
