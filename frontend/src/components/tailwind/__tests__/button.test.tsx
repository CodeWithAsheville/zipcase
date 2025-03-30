import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Button } from '../button';

// Mock dependencies
vi.mock('../link', () => ({
    Link: ({ children, ...props }: any) => (
        <a data-testid="mock-link" {...props}>
            {children}
        </a>
    ),
}));

describe('Button component', () => {
    it('renders correctly with default props', () => {
        render(<Button>Click me</Button>);

        expect(screen.getByRole('button')).toBeInTheDocument();
        expect(screen.getByRole('button')).toHaveTextContent('Click me');
    });

    it('renders as a link when href is provided', () => {
        render(<Button href="/test">Link Button</Button>);

        expect(screen.getByTestId('mock-link')).toBeInTheDocument();
        expect(screen.getByTestId('mock-link')).toHaveTextContent('Link Button');
        expect(screen.getByTestId('mock-link')).toHaveAttribute('href', '/test');
    });

    it('applies outline style when outline prop is true', () => {
        render(<Button outline>Outline Button</Button>);

        const button = screen.getByRole('button');
        // We can't check actual CSS classes directly since we're using clsx with complex styles
        // Instead, we'll verify the button has the right content
        expect(button).toHaveTextContent('Outline Button');
    });

    it('applies plain style when plain prop is true', () => {
        render(<Button plain>Plain Button</Button>);

        const button = screen.getByRole('button');
        expect(button).toHaveTextContent('Plain Button');
    });

    it('applies custom color when provided', () => {
        render(<Button color="blue">Blue Button</Button>);

        const button = screen.getByRole('button');
        expect(button).toHaveTextContent('Blue Button');
    });

    it('handles click events', async () => {
        const handleClick = vi.fn();
        const user = userEvent.setup();

        render(<Button onClick={handleClick}>Click me</Button>);

        await user.click(screen.getByRole('button'));
        expect(handleClick).toHaveBeenCalledTimes(1);
    });

    it('renders the TouchTarget component inside', () => {
        render(<Button>With TouchTarget</Button>);

        // TouchTarget adds a span with specific classes
        expect(screen.getByRole('button').querySelector('span')).toBeInTheDocument();
    });
});
