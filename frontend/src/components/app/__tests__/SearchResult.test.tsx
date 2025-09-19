import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom';
import SearchResult from '../SearchResult';
import { SearchResult as SearchResultType, ZipCase } from '../../../../../shared/types';

// Mock SearchStatus component
vi.mock('../SearchStatus', () => ({
    default: vi.fn(({ status }) => (
        <div data-testid="search-status" data-status={status.status}>
            Status: {status.status}
        </div>
    )),
}));

// Mock constants from aws-exports
vi.mock('../../../aws-exports', () => ({
    PORTAL_URL: 'https://portal.example.com',
    PORTAL_CASE_URL: 'https://portal.example.com/search-results',
}));

// Create sample case for testing
const createTestCase = (override = {}): SearchResultType => ({
    zipCase: {
        caseNumber: '22CR123456-789',
        caseId: 'case-id-123',
        lastUpdated: '2023-05-10T12:00:00Z',
        fetchStatus: {
            status: 'complete',
        },
    } as ZipCase,
    caseSummary: {
        caseName: 'State vs. Doe',
        court: 'Circuit Court',
        charges: [
            {
                offenseDate: '2022-01-01',
                filedDate: '2022-01-02',
                description: 'Theft',
                statute: '123.456',
                degree: {
                    code: 'M',
                    description: 'Misdemeanor',
                },
                fine: 125.5,
                dispositions: [
                    {
                        date: '2023-01-15',
                        code: 'Guilty',
                        description: 'Guilty',
                    },
                ],
            },
        ],
    },
    ...override,
});

describe('SearchResult component', () => {
    it('renders case information correctly', () => {
        const testCase = createTestCase();
        render(<SearchResult searchResult={testCase} />);

        // Check case number is displayed
        expect(screen.getByText('22CR123456-789')).toBeInTheDocument();

        // Check that status component is rendered
        expect(screen.getByTestId('search-status')).toBeInTheDocument();
        expect(screen.getByTestId('search-status')).toHaveAttribute('data-status', 'complete');

        // Check summary information is displayed - only case name and court are shown in the current implementation
        expect(screen.getByText('State vs. Doe')).toBeInTheDocument();
        expect(screen.getByText('Circuit Court')).toBeInTheDocument();
        // Offense and disposition are commented out in the component
        // expect(screen.getByText('Misdemeanor')).toBeInTheDocument();
        // expect(screen.getByText('Guilty (2023-01-15)')).toBeInTheDocument();
    });

    it('renders case as a link when caseId is present', () => {
        const testCase = createTestCase();
        render(<SearchResult searchResult={testCase} />);

        // Check that case number is rendered as a link
        const link = screen.getByRole('link', { name: /22CR123456-789/ });
        expect(link).toHaveAttribute('href', 'https://portal.example.com/search-results/#/case-id-123');
        expect(link).toHaveAttribute('target', '_blank');
        expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    });

    it('renders case as text when caseId is not present', () => {
        const testCase = createTestCase({
            zipCase: {
                caseNumber: '22CR123456-789',
                caseId: undefined,
                fetchStatus: {
                    status: 'processing',
                },
            },
        });
        render(<SearchResult searchResult={testCase} />);

        // Check that case number is rendered as text, not a link
        expect(screen.queryByRole('link')).not.toBeInTheDocument();
        expect(screen.getByText('22CR123456-789')).toBeInTheDocument();
    });

    it('handles missing lastUpdated field', () => {
        const testCase = createTestCase({
            zipCase: {
                caseNumber: '22CR123456-789',
                lastUpdated: undefined,
                fetchStatus: {
                    status: 'queued',
                },
            },
        });
        render(<SearchResult searchResult={testCase} />);

        // Last updated text should not be present
        expect(screen.queryByText(/Last Updated:/)).not.toBeInTheDocument();
    });

    it('handles missing caseSummary', () => {
        const testCase = createTestCase({
            caseSummary: undefined,
        });
        render(<SearchResult searchResult={testCase} />);

        // Summary information should not be present
        expect(screen.queryByText('State vs. Doe')).not.toBeInTheDocument();
        expect(screen.queryByText('Circuit Court')).not.toBeInTheDocument();
        expect(screen.queryByText('Misdemeanor')).not.toBeInTheDocument();
    });

    it('returns null for invalid case data', () => {
        // Mock console.error to prevent test logs
        const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        // Render with invalid data (missing caseNumber)
        const { container } = render(<SearchResult searchResult={{} as SearchResultType} />);

        // Component should render nothing
        expect(container).toBeEmptyDOMElement();

        // Error should be logged
        expect(consoleErrorSpy).toHaveBeenCalled();

        // Cleanup
        consoleErrorSpy.mockRestore();
    });

    it('displays error message for failed cases', () => {
        const testCase = createTestCase({
            zipCase: {
                caseNumber: '22CR123456-789',
                caseId: undefined,
                fetchStatus: {
                    status: 'failed',
                    message: 'Error: Failed to fetch case data',
                },
            },
        });
        render(<SearchResult searchResult={testCase} />);

        // Check that error message is displayed
        expect(screen.getByText('Error: Failed to fetch case data')).toBeInTheDocument();

        // Check that the error message is styled correctly
        const errorMessage = screen.getByText('Error: Failed to fetch case data');
        expect(errorMessage).toHaveClass('text-sm', 'text-red-600');
    });
});
