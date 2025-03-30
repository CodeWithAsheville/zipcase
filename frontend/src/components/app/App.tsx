'use client';

import { Amplify } from 'aws-amplify';
import { ThemeProvider, defaultTheme, Authenticator } from '@aws-amplify/ui-react';
import '@aws-amplify/ui-react/styles.css';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import awsExports from '../../aws-exports';
import { AppContextProvider } from './AppContext';
import Shell from './Shell';
import ZipCaseLogo from '../../assets/ZipCaseLogo.svg';

import Search from '../../pages/Search';
import Clients from '../../pages/Clients';
import Settings from '../../pages/Settings';
import Help from '../../pages/Help';

// Create theme for Amplify UI components
const amplifyTheme = {
    tokens: {
        colors: {
            brand: {
                primary: {
                    10: '#e6edf5',
                    20: '#ccdaeb',
                    40: '#99b6d6',
                    60: '#6691c2',
                    80: '#336dad',
                    90: '#336699', // Main primary color
                    100: '#2d5a89', // Slightly darker for hover effects
                },
            },
        },
        components: {
            button: {
                primary: {
                    backgroundColor: {
                        value: '{colors.brand.primary.90}',
                    },
                    _hover: {
                        backgroundColor: {
                            value: '{colors.brand.primary.100}',
                        },
                    },
                    _focus: {
                        backgroundColor: {
                            value: '{colors.brand.primary.100}',
                        },
                    },
                },
            },
        },
    },
};

const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            staleTime: 15 * 60 * 1000, // 15 minutes
            gcTime: 60 * 60 * 1000, // 60 minutes
        },
    },
});

Amplify.configure(awsExports);

// Define custom components for the Authenticator
const components = {
    Header() {
        return (
            <div
                style={{
                    padding: '2rem 0 1rem 0',
                    textAlign: 'center',
                    backgroundColor: '#ffffff',
                }}
            >
                <div
                    style={{
                        backgroundColor: '#ffffff',
                        padding: '10px',
                        display: 'inline-block',
                        maxWidth: '200px',
                    }}
                >
                    <img
                        src={ZipCaseLogo}
                        alt="ZipCase Logo"
                        style={{
                            width: '100%',
                            height: 'auto',
                        }}
                    />
                </div>
            </div>
        );
    },
    Footer() {
        return (
            <div
                style={{
                    textAlign: 'center',
                    margin: '16px 0',
                    backgroundColor: '#ffffff',
                    padding: '12px',
                    borderRadius: '4px',
                }}
            >
                <p
                    style={{
                        fontSize: '14px',
                        color: '#666',
                        margin: 0,
                    }}
                >
                    Contact us at{' '}
                    <a
                        href="mailto:info@zipcase.org"
                        style={{
                            color: '#336699',
                            textDecoration: 'none',
                        }}
                    >
                        info@zipcase.org
                    </a>
                </p>
            </div>
        );
    },
};

const App: React.FC = () => {
    return (
        <ThemeProvider theme={{ ...defaultTheme, ...amplifyTheme }}>
            <Authenticator hideSignUp={true} components={components}>
                <QueryClientProvider client={queryClient}>
                    <AppContextProvider>
                        <BrowserRouter>
                            <Routes>
                                <Route path="/" element={<Navigate to="/search" />} />
                                <Route element={<Shell />}>
                                    <Route path="/search" element={<Search />} />
                                    <Route path="/clients" element={<Clients />} />
                                    <Route path="/settings" element={<Settings />} />
                                    <Route path="/help" element={<Help />} />
                                </Route>
                            </Routes>
                        </BrowserRouter>
                    </AppContextProvider>
                </QueryClientProvider>
            </Authenticator>
        </ThemeProvider>
    );
};

export default App;
