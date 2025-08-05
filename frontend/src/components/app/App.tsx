'use client';

import { Amplify } from 'aws-amplify';
import { ThemeProvider, defaultTheme, Authenticator } from '@aws-amplify/ui-react';
import '@aws-amplify/ui-react/styles.css';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import awsExports from '../../aws-exports';
import { AppContextProvider } from './AppContextProvider';
import Shell from './Shell';
import ZipCaseLogo from '../../assets/ZipCaseLogo.svg';

import Search from '../../pages/Search';
import Clients from '../../pages/Clients';
import Settings from '../../pages/Settings';
import Help from '../../pages/Help';

import React, { useContext, useEffect } from 'react';
import { AppContext } from './AppContext';
import { useZipCaseApi } from '../../hooks';
import { useNavigate, useLocation } from 'react-router-dom';

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

// Onboarding logic: check for portal credentials on login, set firstTimeUser, and redirect if needed
const App: React.FC = () => {
    return (
        <ThemeProvider theme={{ ...defaultTheme, ...amplifyTheme }}>
            <Authenticator hideSignUp={true} components={components}>
                <QueryClientProvider client={queryClient}>
                    <BrowserRouter>
                        <AppContextProvider>
                            <OnboardingRouter />
                        </AppContextProvider>
                    </BrowserRouter>
                </QueryClientProvider>
            </Authenticator>
        </ThemeProvider>
    );
};

const OnboardingRouter: React.FC = () => {
    const { dispatch } = useContext(AppContext);
    const getPortalCredentials = useZipCaseApi(client => client.credentials.get()).callApi;
    const [checked, setChecked] = React.useState(false);
    const navigate = useNavigate();
    const location = useLocation();

    useEffect(() => {
        // Check onboarding on first mount and on login (when location or credentials change)
        let cancelled = false;
        (async () => {
            try {
                const resp = await getPortalCredentials();
                const isFirstTime = !resp.success || !resp.data || !resp.data.username;
                dispatch({ type: 'SET_FIRST_TIME_USER', payload: isFirstTime });
                if (isFirstTime && location.pathname.startsWith('/search')) {
                    navigate('/settings', { replace: true });
                }
            } catch {
                dispatch({ type: 'SET_FIRST_TIME_USER', payload: true });
                if (location.pathname.startsWith('/search')) {
                    navigate('/settings', { replace: true });
                }
            } finally {
                if (!cancelled) setChecked(true);
            }
        })();
        return () => {
            cancelled = true;
        };
        // Run on mount and when location changes (to catch initial login)
    }, [location.pathname, dispatch, getPortalCredentials, navigate]);

    // Wait until onboarding check is done before rendering routes
    if (!checked) return null;

    return (
        <Routes>
            <Route path="/" element={<Navigate to="/search/case" />} />
            <Route element={<Shell />}>
                <Route path="/search" element={<Navigate to="/search/case" />} />
                <Route path="/search/case" element={<Search type="case" />} />
                <Route path="/search/name" element={<Search type="name" />} />
                <Route path="/clients" element={<Clients />} />
                <Route path="/settings" element={<Settings />} />
                <Route path="/help" element={<Help />} />
            </Route>
        </Routes>
    );
};

export default App;
