import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { useContext } from 'react';
import { describe, expect, it } from 'vitest';
import { AppContext, AppContextProvider } from '../AppContext';

// Test component that consumes the context
const TestConsumer = () => {
    const { token, dispatch } = useContext(AppContext);

    return (
        <div>
            <div data-testid="token-value">{token}</div>
            <button
                onClick={() => dispatch({ type: 'SET_TOKEN', payload: 'test-token' })}
                data-testid="set-token-button"
            >
                Set Token
            </button>
        </div>
    );
};

describe('AppContext', () => {
    it('provides the default context value', () => {
        render(
            <AppContextProvider>
                <TestConsumer />
            </AppContextProvider>
        );

        // Check that the default token is empty
        expect(screen.getByTestId('token-value')).toHaveTextContent('');
    });

    it('updates the token state when dispatch is called', async () => {
        render(
            <AppContextProvider>
                <TestConsumer />
            </AppContextProvider>
        );

        // Initial state should be empty
        expect(screen.getByTestId('token-value')).toHaveTextContent('');

        // Click the button to dispatch a SET_TOKEN action
        fireEvent.click(screen.getByTestId('set-token-button'));

        // Token value should be updated (wait for state update)
        await waitFor(() => {
            expect(screen.getByTestId('token-value')).toHaveTextContent('test-token');
        });
    });

    it('provides context to multiple consumers', async () => {
        render(
            <AppContextProvider>
                <div>
                    <TestConsumer />
                    <TestConsumer />
                </div>
            </AppContextProvider>
        );

        // Both consumers should have access to the same context
        const tokenElements = screen.getAllByTestId('token-value');
        expect(tokenElements).toHaveLength(2);
        expect(tokenElements[0]).toHaveTextContent('');
        expect(tokenElements[1]).toHaveTextContent('');

        // Updating the state through one consumer should affect all
        fireEvent.click(screen.getAllByTestId('set-token-button')[0]);

        // Both consumers should reflect the updated state
        await waitFor(() => {
            expect(tokenElements[0]).toHaveTextContent('test-token');
            expect(tokenElements[1]).toHaveTextContent('test-token');
        });
    });

    it('maintains isolated state between different provider instances', async () => {
        render(
            <div>
                <AppContextProvider>
                    <div data-testid="provider-1">
                        <TestConsumer />
                    </div>
                </AppContextProvider>
                <AppContextProvider>
                    <div data-testid="provider-2">
                        <TestConsumer />
                    </div>
                </AppContextProvider>
            </div>
        );

        // Get button and token elements for each provider
        const provider1 = screen.getByTestId('provider-1');
        const provider2 = screen.getByTestId('provider-2');

        const button1 = provider1.querySelector('[data-testid="set-token-button"]') as HTMLElement;
        const button2 = provider2.querySelector('[data-testid="set-token-button"]') as HTMLElement;

        const token1 = provider1.querySelector('[data-testid="token-value"]') as HTMLElement;
        const token2 = provider2.querySelector('[data-testid="token-value"]') as HTMLElement;

        // Initial state should be empty for both
        expect(token1).toHaveTextContent('');
        expect(token2).toHaveTextContent('');

        // Update state in first provider
        fireEvent.click(button1);

        // Only the first provider should reflect the change
        await waitFor(() => {
            expect(token1).toHaveTextContent('test-token');
        });
        expect(token2).toHaveTextContent('');

        // Update state in second provider with a different value
        fireEvent.click(button2);

        // Each provider should maintain its own state
        await waitFor(() => {
            expect(token1).toHaveTextContent('test-token');
            expect(token2).toHaveTextContent('test-token');
        });
    });
});
