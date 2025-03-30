import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import SearchStatus from '../SearchStatus';
import { FetchStatus } from '../../../../../shared/types';

// Mock Puff from react-loader-spinner
vi.mock('react-loader-spinner', () => ({
    Puff: () => <div data-testid="loader-spinner">Loading...</div>,
}));

// Helper to create different status objects
const createStatus = (status: string, message?: string): FetchStatus => ({
    status: status as any,
    message,
});

describe('SearchStatus component', () => {
    it('renders processing status with spinner', () => {
        render(<SearchStatus status={createStatus('processing')} />);

        expect(screen.getByTestId('loader-spinner')).toBeInTheDocument();
        expect(screen.getByLabelText('processing')).toBeInTheDocument();
    });

    it('renders queued status with clock icon', () => {
        render(<SearchStatus status={createStatus('queued')} />);

        expect(screen.getByLabelText('queued')).toBeInTheDocument();
    });

    it('renders failed status with error icon and message', () => {
        const errorMessage = 'Error: Failed to fetch case';
        render(<SearchStatus status={createStatus('failed', errorMessage)} />);

        expect(screen.getByLabelText('failed')).toBeInTheDocument();
        expect(screen.getByText(errorMessage)).toBeInTheDocument();
    });

    it('renders failed status without message when none provided', () => {
        render(<SearchStatus status={createStatus('failed')} />);

        expect(screen.getByLabelText('failed')).toBeInTheDocument();
        expect(screen.queryByText(/Error/)).not.toBeInTheDocument();
    });

    it('renders notFound status with X icon', () => {
        render(<SearchStatus status={createStatus('notFound')} />);

        expect(screen.getByLabelText('not found')).toBeInTheDocument();
    });

    it('renders found status with yellow check icon', () => {
        render(<SearchStatus status={createStatus('found')} />);

        expect(screen.getByLabelText('case found')).toBeInTheDocument();
    });

    it('renders complete status with green check icon', () => {
        render(<SearchStatus status={createStatus('complete')} />);

        expect(screen.getByLabelText('complete')).toBeInTheDocument();
    });

    it('returns null for unknown status', () => {
        const { container } = render(
            <SearchStatus status={createStatus('unknown-status' as any)} />
        );

        // Container should be empty as unknown status renders null
        expect(container).toBeEmptyDOMElement();
    });

    it('renders with the expected structure', () => {
        const { container } = render(<SearchStatus status={createStatus('complete')} />);

        // Check that we have the container div structure without checking specific class names
        expect(container.querySelector('div')).toBeInTheDocument();

        // The SVG icon should exist and be properly labeled
        const icon = screen.getByLabelText('complete');
        expect(icon.tagName.toLowerCase()).toBe('svg');
    });
});
