import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../aws-exports', () => ({
    API_URL: 'http://test-api.example.com',
}));

// Set up the mock before importing the component
const mockMutate = vi.fn();
vi.mock('../../../hooks/useNameSearch', () => {
    return {
        useNameSearch: () => ({
            mutate: mockMutate,
            isLoading: false,
            isSuccess: false,
            isError: false,
            error: null,
        }),
    };
});

import { render, fireEvent, screen } from '@testing-library/react';
import NameSearchPanel from '../NameSearchPanel';

describe('NameSearchPanel', () => {
    it('should render the criminal cases only checkbox and pass its value to the mutation', () => {
        render(<NameSearchPanel />);

        // Find the checkbox
        const checkbox = screen.getByLabelText(/criminal cases only/i);
        expect(checkbox).toBeInTheDocument();
        // Default should be checked
        expect(checkbox).toBeChecked();

        // Toggle: click to uncheck
        fireEvent.click(checkbox);
        expect(checkbox).not.toBeChecked();

        // Toggle: click again to check
        fireEvent.click(checkbox);
        expect(checkbox).toBeChecked();

        // Fill in the name field (simulate user input)
        const nameInput = screen.getByLabelText(/name/i);
        fireEvent.change(nameInput, { target: { value: 'John Doe' } });

        // Submit the form
        const submitButton = screen.getByRole('button', { name: /search/i });
        fireEvent.click(submitButton);

        // Assert: mutate should be called with criminalOnly: true
        expect(mockMutate).toHaveBeenCalled();
        const callArgs = mockMutate.mock.calls[0][0];
        expect(callArgs).toEqual(
            expect.objectContaining({
                name: 'John Doe',
                criminalOnly: true,
            })
        );
    });
});
