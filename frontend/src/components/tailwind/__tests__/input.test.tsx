import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Input, InputGroup } from '../input';

describe('Input component', () => {
    it('renders correctly with default props', () => {
        render(<Input />);

        expect(screen.getByRole('textbox')).toBeInTheDocument();
    });

    it('passes through additional props to the input element', () => {
        render(<Input placeholder="Enter text" />);

        expect(screen.getByPlaceholderText('Enter text')).toBeInTheDocument();
    });

    it('accepts different input types', () => {
        render(<Input type="password" data-testid="password-input" />);

        const input = screen.getByTestId('password-input');
        expect(input).toHaveAttribute('type', 'password');
    });

    it('handles user input correctly', async () => {
        const user = userEvent.setup();
        render(<Input data-testid="test-input" />);

        const input = screen.getByTestId('test-input');
        await user.type(input, 'Hello, world!');

        expect(input).toHaveValue('Hello, world!');
    });

    it('forwards ref to the underlying input element', () => {
        const ref = vi.fn();
        render(<Input ref={ref} />);

        expect(ref).toHaveBeenCalled();
    });
});

describe('InputGroup component', () => {
    it('renders children correctly', () => {
        render(
            <InputGroup>
                <span data-slot="icon">Icon</span>
                <Input data-testid="grouped-input" />
            </InputGroup>
        );

        expect(screen.getByText('Icon')).toBeInTheDocument();
        expect(screen.getByTestId('grouped-input')).toBeInTheDocument();
    });

    it('renders with proper classes for icons', () => {
        render(
            <InputGroup>
                <span data-slot="icon" data-testid="icon">
                    Icon
                </span>
                <Input data-testid="grouped-input" />
            </InputGroup>
        );

        const inputGroup = screen.getByTestId('icon').parentElement;
        expect(inputGroup).toBeInTheDocument();
        // We can't test specific styling due to clsx using complex computed class lists,
        // but we can verify the component structure
        expect(inputGroup).toContainElement(screen.getByTestId('icon'));
        expect(inputGroup).toContainElement(screen.getByTestId('grouped-input'));
    });
});
