import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import SearchPanel from '../SearchPanel';
import { useCaseSearch, useFileSearch } from '../../../hooks';

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
        isLoading: false,
        isError: false,
        isSuccess: false,
        isIdle: true,
        status: 'idle',
        data: undefined,
        error: null,
        reset: vi.fn(),
        variables: undefined,
        failureCount: 0,
        failureReason: null,
        context: undefined,
        mutateAsync: vi.fn().mockResolvedValue({ results: {} }),
        isPaused: false,
        submittedAt: Date.now(),
    })),
    useFileSearch: vi.fn(() => ({
        mutate: vi.fn((file, options) => {
            if (options && options.onSuccess) {
                options.onSuccess({ results: { '22CR123456-789': { zipCase: { caseNumber: '22CR123456-789' } } } });
            }
        }),
        isPending: false,
        isLoading: false,
        isError: false,
        isSuccess: false,
        isIdle: true,
        status: 'idle',
        data: undefined,
        error: null,
        reset: vi.fn(),
        variables: undefined,
        failureCount: 0,
        failureReason: null,
        context: undefined,
        mutateAsync: vi.fn().mockResolvedValue({ results: {} }),
        isPaused: false,
        submittedAt: Date.now(),
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

    return ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
};

describe('SearchPanel Component', () => {
    let user: ReturnType<typeof userEvent.setup>;

    beforeEach(() => {
        user = userEvent.setup();
        // Clear all mocks before each test
        vi.clearAllMocks();

        const mockUseCaseSearch = vi.mocked(useCaseSearch);
        mockUseCaseSearch.mockImplementation(() => ({
            mutate: vi.fn((caseNumber, options) => {
                if (options && options.onSuccess) {
                    options.onSuccess({ results: { [caseNumber]: { zipCase: { caseNumber } } } });
                }
            }),
            isPending: false,
            isLoading: false,
            isError: false,
            isSuccess: false,
            isIdle: true,
            status: 'idle',
            data: undefined,
            error: null,
            reset: vi.fn(),
            variables: undefined,
            failureCount: 0,
            failureReason: null,
            context: undefined,
            mutateAsync: vi.fn().mockResolvedValue({ results: {} }),
            isPaused: false,
            submittedAt: Date.now(),
        }));

        const mockUseFileSearch = vi.mocked(useFileSearch);
        mockUseFileSearch.mockImplementation(() => ({
            mutate: vi.fn((file, options) => {
                if (options && options.onSuccess) {
                    options.onSuccess({ results: { '22CR123456-789': { zipCase: { caseNumber: '22CR123456-789' } } } });
                }
            }),
            isPending: false,
            isLoading: false,
            isError: false,
            isSuccess: false,
            isIdle: true,
            status: 'idle',
            data: undefined,
            error: null,
            reset: vi.fn(),
            variables: undefined,
            failureCount: 0,
            failureReason: null,
            context: undefined,
            mutateAsync: vi.fn().mockResolvedValue({ results: {} }),
            isPaused: false,
            submittedAt: Date.now(),
        }));
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
            isLoading: true,
            isError: false,
            isSuccess: false,
            isIdle: false,
            status: 'pending',
            data: undefined,
            error: null,
            reset: vi.fn(),
            variables: '',
            failureCount: 0,
            failureReason: null,
            context: undefined,
            mutateAsync: vi.fn().mockResolvedValue({ results: {} }),
            isPaused: false,
            submittedAt: Date.now(),
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

    it('disables the input and shows loading state during file processing', async () => {
        const mockUseFileSearch = vi.mocked(useFileSearch);
        mockUseFileSearch.mockImplementation(() => ({
            mutate: vi.fn(),
            isPending: true,
            isLoading: true,
            isError: false,
            isSuccess: false,
            isIdle: false,
            status: 'pending',
            data: undefined,
            error: null,
            reset: vi.fn(),
            variables: undefined,
            failureCount: 0,
            failureReason: null,
            context: undefined,
            mutateAsync: vi.fn().mockResolvedValue({ results: {} }),
            isPaused: false,
            submittedAt: Date.now(),
        }));

        render(<SearchPanel />, { wrapper: createWrapper() });

        const input = screen.getByLabelText('Case Numbers');
        const searchButton = screen.getByRole('button', { name: /search/i });
        const uploadButton = screen.getByRole('button', { name: /processing/i });

        expect(input).toBeDisabled();
        expect(searchButton).toBeDisabled();
        expect(uploadButton).toBeDisabled();
        expect(screen.getByText('Processing...')).toBeInTheDocument();
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
            isLoading: false,
            isError: true,
            isSuccess: false,
            isIdle: false,
            status: 'error',
            data: undefined,
            error: new Error('Search failed'),
            reset: vi.fn(),
            variables: '',
            failureCount: 1,
            failureReason: new Error('Search failed'),
            context: undefined,
            mutateAsync: vi.fn().mockRejectedValue(new Error('Search failed')),
            isPaused: false,
            submittedAt: Date.now(),
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

    describe('Case Count Feedback', () => {
        it('shows "Found 1 case number" when one case is returned', async () => {
            // Mock useCaseSearch to return 1 case
            const mockUseCaseSearch = vi.mocked(useCaseSearch);
            mockUseCaseSearch.mockImplementation(() => ({
                mutate: vi.fn((_, options) => {
                    if (options && options.onSuccess) {
                        options.onSuccess({
                            results: {
                                '22CR123456-789': { zipCase: { caseNumber: '22CR123456-789' } },
                            },
                        });
                    }
                }),
                isPending: false,
                isLoading: false,
                isError: false,
                isSuccess: false,
                isIdle: true,
                status: 'idle' as const,
                data: undefined,
                error: null,
                reset: vi.fn(),
                variables: undefined,
                failureCount: 0,
                failureReason: null,
                context: undefined,
                mutateAsync: vi.fn().mockResolvedValue({ results: {} }),
                isPaused: false,
                submittedAt: Date.now(),
            }));

            render(<SearchPanel />, { wrapper: createWrapper() });

            const input = screen.getByLabelText('Case Numbers');
            const searchButton = screen.getByRole('button', { name: /search/i });

            // Enter a case number
            await user.type(input, '22CR123456-789');

            // Click the search button
            await user.click(searchButton);

            // Should show feedback message for 1 case
            await waitFor(() => {
                expect(screen.getByText('Found 1 case number')).toBeInTheDocument();
            });

            // Input should be cleared after success
            expect(input).toHaveValue('');
        });

        it('shows "Found X case numbers" when multiple cases are returned', async () => {
            // Mock useCaseSearch to return 3 cases
            const mockUseCaseSearch = vi.mocked(useCaseSearch);
            mockUseCaseSearch.mockImplementation(() => ({
                mutate: vi.fn((_, options) => {
                    if (options && options.onSuccess) {
                        options.onSuccess({
                            results: {
                                '22CR123456-789': { zipCase: { caseNumber: '22CR123456-789' } },
                                '23CV654321-456': { zipCase: { caseNumber: '23CV654321-456' } },
                                '24CR789012-345': { zipCase: { caseNumber: '24CR789012-345' } },
                            },
                        });
                    }
                }),
                isPending: false,
                isLoading: false,
                isError: false,
                isSuccess: false,
                isIdle: true,
                status: 'idle' as const,
                data: undefined,
                error: null,
                reset: vi.fn(),
                variables: undefined,
                failureCount: 0,
                failureReason: null,
                context: undefined,
                mutateAsync: vi.fn().mockResolvedValue({ results: {} }),
                isPaused: false,
                submittedAt: Date.now(),
            }));

            render(<SearchPanel />, { wrapper: createWrapper() });

            const input = screen.getByLabelText('Case Numbers');
            const searchButton = screen.getByRole('button', { name: /search/i });

            // Enter case numbers
            await user.type(input, '22CR123456-789 23CV654321-456 24CR789012-345');

            // Click the search button
            await user.click(searchButton);

            // Should show feedback message for multiple cases
            await waitFor(() => {
                expect(screen.getByText('Found 3 case numbers')).toBeInTheDocument();
            });

            // Input should be cleared after success
            expect(input).toHaveValue('');
        });

        it('shows error message and preserves input when no case numbers found', async () => {
            // Mock useCaseSearch to return empty results
            const mockUseCaseSearch = vi.mocked(useCaseSearch);
            mockUseCaseSearch.mockImplementation(() => ({
                mutate: vi.fn((_, options) => {
                    if (options && options.onSuccess) {
                        options.onSuccess({ results: {} });
                    }
                }),
                isPending: false,
                isLoading: false,
                isError: false,
                isSuccess: false,
                isIdle: true,
                status: 'idle' as const,
                data: undefined,
                error: null,
                reset: vi.fn(),
                variables: undefined,
                failureCount: 0,
                failureReason: null,
                context: undefined,
                mutateAsync: vi.fn().mockResolvedValue({ results: {} }),
                isPaused: false,
                submittedAt: Date.now(),
            }));

            render(<SearchPanel />, { wrapper: createWrapper() });

            const input = screen.getByLabelText('Case Numbers');
            const searchButton = screen.getByRole('button', { name: /search/i });

            // Enter invalid text
            await user.type(input, 'invalid text with no case numbers');

            // Click the search button
            await user.click(searchButton);

            // Should show error feedback message
            await waitFor(() => {
                expect(screen.getByText('No case numbers found in search text')).toBeInTheDocument();
            });

            // Input should NOT be cleared when no cases found
            expect(input).toHaveValue('invalid text with no case numbers');
        });

        it('clears feedback message when user starts typing', async () => {
            // First, trigger a successful search to show feedback
            const mockUseCaseSearch = vi.mocked(useCaseSearch);
            mockUseCaseSearch.mockImplementation(() => ({
                mutate: vi.fn((_, options) => {
                    if (options && options.onSuccess) {
                        options.onSuccess({
                            results: {
                                '22CR123456-789': { zipCase: { caseNumber: '22CR123456-789' } },
                            },
                        });
                    }
                }),
                isPending: false,
                isLoading: false,
                isError: false,
                isSuccess: false,
                isIdle: true,
                status: 'idle' as const,
                data: undefined,
                error: null,
                reset: vi.fn(),
                variables: undefined,
                failureCount: 0,
                failureReason: null,
                context: undefined,
                mutateAsync: vi.fn().mockResolvedValue({ results: {} }),
                isPaused: false,
                submittedAt: Date.now(),
            }));

            render(<SearchPanel />, { wrapper: createWrapper() });

            const input = screen.getByLabelText('Case Numbers');
            const searchButton = screen.getByRole('button', { name: /search/i });

            // Enter a case number and search
            await user.type(input, '22CR123456-789');
            await user.click(searchButton);

            // Verify feedback message appears
            await waitFor(() => {
                expect(screen.getByText('Found 1 case number')).toBeInTheDocument();
            });

            // Start typing in the now-empty input
            await user.type(input, 'new text');

            // Feedback message should be cleared
            expect(screen.queryByText('Found 1 case number')).not.toBeInTheDocument();
        });

        it('clears feedback message on search error', async () => {
            // First show a successful feedback message
            let shouldSucceed = true;
            const mockUseCaseSearch = vi.mocked(useCaseSearch);
            mockUseCaseSearch.mockImplementation(() => ({
                mutate: vi.fn((_, options) => {
                    if (shouldSucceed && options && options.onSuccess) {
                        options.onSuccess({
                            results: {
                                '22CR123456-789': { zipCase: { caseNumber: '22CR123456-789' } },
                            },
                        });
                    } else if (!shouldSucceed && options && options.onError) {
                        options.onError(new Error('Network error'));
                    }
                }),
                isPending: false,
                isLoading: false,
                isError: false,
                isSuccess: false,
                isIdle: true,
                status: 'idle' as const,
                data: undefined,
                error: null,
                reset: vi.fn(),
                variables: undefined,
                failureCount: 0,
                failureReason: null,
                context: undefined,
                mutateAsync: vi.fn().mockResolvedValue({ results: {} }),
                isPaused: false,
                submittedAt: Date.now(),
            }));

            render(<SearchPanel />, { wrapper: createWrapper() });

            const input = screen.getByLabelText('Case Numbers');
            const searchButton = screen.getByRole('button', { name: /search/i });

            // First successful search
            await user.type(input, '22CR123456-789');
            await user.click(searchButton);

            // Verify feedback message appears
            await waitFor(() => {
                expect(screen.getByText('Found 1 case number')).toBeInTheDocument();
            });

            // Now trigger an error
            shouldSucceed = false;
            await user.type(input, 'some other text');
            await user.click(searchButton);

            // Feedback message should be cleared, error message should show
            await waitFor(() => {
                expect(screen.queryByText('Found 1 case number')).not.toBeInTheDocument();
                expect(screen.getByText('Network error')).toBeInTheDocument();
            });
        });

        it('displays feedback message with correct styling for success and error states', async () => {
            // Test success state styling
            const mockUseCaseSearch = vi.mocked(useCaseSearch);
            mockUseCaseSearch.mockImplementation(() => ({
                mutate: vi.fn((_, options) => {
                    if (options && options.onSuccess) {
                        options.onSuccess({
                            results: {
                                '22CR123456-789': { zipCase: { caseNumber: '22CR123456-789' } },
                            },
                        });
                    }
                }),
                isPending: false,
                isLoading: false,
                isError: false,
                isSuccess: false,
                isIdle: true,
                status: 'idle' as const,
                data: undefined,
                error: null,
                reset: vi.fn(),
                variables: undefined,
                failureCount: 0,
                failureReason: null,
                context: undefined,
                mutateAsync: vi.fn().mockResolvedValue({ results: {} }),
                isPaused: false,
                submittedAt: Date.now(),
            }));

            const { rerender } = render(<SearchPanel />, { wrapper: createWrapper() });

            const input = screen.getByLabelText('Case Numbers');
            const searchButton = screen.getByRole('button', { name: /search/i });

            // Test success state (gray text)
            await user.type(input, '22CR123456-789');
            await user.click(searchButton);

            await waitFor(() => {
                const feedbackElement = screen.getByText('Found 1 case number');
                expect(feedbackElement).toBeInTheDocument();
                expect(feedbackElement).toHaveClass('text-gray-500');
            });

            // Clear and test error state
            await user.clear(input);

            // Mock to return no results
            mockUseCaseSearch.mockImplementation(() => ({
                mutate: vi.fn((_, options) => {
                    if (options && options.onSuccess) {
                        options.onSuccess({ results: {} });
                    }
                }),
                isPending: false,
                isLoading: false,
                isError: false,
                isSuccess: false,
                isIdle: true,
                status: 'idle' as const,
                data: undefined,
                error: null,
                reset: vi.fn(),
                variables: undefined,
                failureCount: 0,
                failureReason: null,
                context: undefined,
                mutateAsync: vi.fn().mockResolvedValue({ results: {} }),
                isPaused: false,
                submittedAt: Date.now(),
            }));
            rerender(<SearchPanel />);

            // Test error state (red text)
            await user.type(input, 'invalid text');
            await user.click(searchButton);

            await waitFor(() => {
                const errorElement = screen.getByText('No case numbers found in search text');
                expect(errorElement).toBeInTheDocument();
                expect(errorElement).toHaveClass('text-red-600');
            });
        });
    });

    describe('File Upload', () => {
        it('submits a selected file for processing', async () => {
            const mockUseFileSearch = vi.mocked(useFileSearch);
            const mutateSpy = vi.fn((file, options) => {
                if (options?.onSuccess) {
                    options.onSuccess({ results: { '22CR123456-789': { zipCase: { caseNumber: '22CR123456-789' } } } });
                }
            });
            mockUseFileSearch.mockImplementation(() => ({
                mutate: mutateSpy,
                isPending: false,
                isLoading: false,
                isError: false,
                isSuccess: false,
                isIdle: true,
                status: 'idle',
                data: undefined,
                error: null,
                reset: vi.fn(),
                variables: undefined,
                failureCount: 0,
                failureReason: null,
                context: undefined,
                mutateAsync: vi.fn().mockResolvedValue({ results: {} }),
                isPaused: false,
                submittedAt: Date.now(),
            }));

            const { container } = render(<SearchPanel />, { wrapper: createWrapper() });

            const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
            const file = new File(['sample content'], 'cases.pdf', { type: 'application/pdf' });

            await user.upload(fileInput, file);

            expect(mutateSpy).toHaveBeenCalledWith(file, expect.any(Object));
            await waitFor(() => {
                expect(screen.getByText('Found 1 case number')).toBeInTheDocument();
            });
        });

        it('processes a dropped file', async () => {
            const mockUseFileSearch = vi.mocked(useFileSearch);
            const mutateSpy = vi.fn((file, options) => {
                if (options?.onSuccess) {
                    options.onSuccess({ results: { '22CR123456-789': { zipCase: { caseNumber: '22CR123456-789' } } } });
                }
            });
            mockUseFileSearch.mockImplementation(() => ({
                mutate: mutateSpy,
                isPending: false,
                isLoading: false,
                isError: false,
                isSuccess: false,
                isIdle: true,
                status: 'idle',
                data: undefined,
                error: null,
                reset: vi.fn(),
                variables: undefined,
                failureCount: 0,
                failureReason: null,
                context: undefined,
                mutateAsync: vi.fn().mockResolvedValue({ results: {} }),
                isPaused: false,
                submittedAt: Date.now(),
            }));

            render(<SearchPanel />, { wrapper: createWrapper() });

            const file = new File(['sample content'], 'cases.pdf', { type: 'application/pdf' });
            const form = document.querySelector('form');
            if (!form) throw new Error('Form not found');

            const dataTransfer = {
                files: [file],
            } as unknown as DataTransfer;

            fireEvent.drop(form, { dataTransfer });

            expect(mutateSpy).toHaveBeenCalledWith(file, expect.any(Object));
            await waitFor(() => {
                expect(screen.getByText('Found 1 case number')).toBeInTheDocument();
            });
        });

        it('processes a pasted file', async () => {
            const mockUseFileSearch = vi.mocked(useFileSearch);
            const mutateSpy = vi.fn((file, options) => {
                if (options?.onSuccess) {
                    options.onSuccess({ results: { '22CR123456-789': { zipCase: { caseNumber: '22CR123456-789' } } } });
                }
            });
            mockUseFileSearch.mockImplementation(() => ({
                mutate: mutateSpy,
                isPending: false,
                isLoading: false,
                isError: false,
                isSuccess: false,
                isIdle: true,
                status: 'idle',
                data: undefined,
                error: null,
                reset: vi.fn(),
                variables: undefined,
                failureCount: 0,
                failureReason: null,
                context: undefined,
                mutateAsync: vi.fn().mockResolvedValue({ results: {} }),
                isPaused: false,
                submittedAt: Date.now(),
            }));

            render(<SearchPanel />, { wrapper: createWrapper() });

            const file = new File(['sample content'], 'cases.pdf', { type: 'application/pdf' });
            const input = screen.getByLabelText('Case Numbers');

            fireEvent.paste(input, {
                clipboardData: {
                    files: [file],
                },
            });

            expect(mutateSpy).toHaveBeenCalledWith(file, expect.any(Object));
            await waitFor(() => {
                expect(screen.getByText('Found 1 case number')).toBeInTheDocument();
            });
        });

        it('handles pasted image data from the clipboard', async () => {
            const mockUseFileSearch = vi.mocked(useFileSearch);
            const mutateSpy = vi.fn((file, options) => {
                if (options?.onSuccess) {
                    options.onSuccess({ results: { '22CR123456-789': { zipCase: { caseNumber: '22CR123456-789' } } } });
                }
            });
            mockUseFileSearch.mockImplementation(() => ({
                mutate: mutateSpy,
                isPending: false,
                isLoading: false,
                isError: false,
                isSuccess: false,
                isIdle: true,
                status: 'idle',
                data: undefined,
                error: null,
                reset: vi.fn(),
                variables: undefined,
                failureCount: 0,
                failureReason: null,
                context: undefined,
                mutateAsync: vi.fn().mockResolvedValue({ results: {} }),
                isPaused: false,
                submittedAt: Date.now(),
            }));

            render(<SearchPanel />, { wrapper: createWrapper() });

            const file = new File(['image content'], 'pasted.png', { type: 'image/png' });
            const input = screen.getByLabelText('Case Numbers');

            fireEvent.paste(input, {
                clipboardData: {
                    files: [file],
                },
            });

            expect(mutateSpy).toHaveBeenCalledWith(file, expect.any(Object));
            await waitFor(() => {
                expect(screen.getByText('Found 1 case number')).toBeInTheDocument();
            });
        });
    });
});
