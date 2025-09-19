import React, { useContext, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { SettingsPortalCredentials, SettingsApiKeys, TextLink } from '../components';
import { Dialog, DialogTitle, DialogDescription, DialogBody, DialogActions } from '../components/tailwind/dialog';
import { useZipCaseApi } from '../hooks';
import { AppContext } from '../components/app/AppContext';

const Settings: React.FC = () => {
    const getPortalCredentials = useZipCaseApi(client => client.credentials.get()).callApi;
    const credentialsQuery = useQuery({
        queryKey: ['credentials'],
        queryFn: () =>
            getPortalCredentials()
                .then(data => data.data)
                .catch(error => {
                    console.error('Failed to fetch credentials:', error);
                    throw error;
                }),
    });

    const getApiSettings = useZipCaseApi(client => client.apiKeys.get()).callApi;
    const apiSettingsQuery = useQuery({
        queryKey: ['apiSettings'],
        queryFn: () =>
            getApiSettings()
                .then(data => data.data)
                .catch(error => {
                    console.error('Failed to fetch API keys:', error);
                    throw error;
                }),
    });

    // Onboarding modal logic
    const { firstTimeUser, dispatch } = useContext(AppContext);
    const [showModal, setShowModal] = useState(firstTimeUser);
    const [hasVisited, setHasVisited] = useState(false);

    React.useEffect(() => {
        if (firstTimeUser && !hasVisited) {
            setShowModal(true);
            setHasVisited(true);
        }
    }, [firstTimeUser, hasVisited]);

    const handleClose = () => {
        setShowModal(false);
        dispatch({ type: 'SET_FIRST_TIME_USER', payload: false });
    };

    return (
        <>
            <SettingsPortalCredentials portalCredentials={credentialsQuery} />
            <SettingsApiKeys apiSettings={apiSettingsQuery} />
            <Dialog open={showModal} onClose={handleClose} size="md">
                <DialogTitle>Welcome to ZipCase!</DialogTitle>
                <DialogDescription>
                    <span role="img" aria-label="wave">
                        👋
                    </span>{' '}
                    Before you can start looking up cases, you'll need to add your court portal credentials here.
                </DialogDescription>
                <DialogBody>
                    <p className="mb-2">
                        If you have questions about why we need your credentials or how your data is protected, check out our{' '}
                        <TextLink href="/help" onClick={handleClose}>
                            FAQ
                        </TextLink>
                        .
                    </p>
                </DialogBody>
                <DialogActions>
                    <button
                        type="button"
                        onClick={handleClose}
                        className="bg-primary hover:bg-primary-light active:bg-primary-dark rounded-md px-3 py-2 text-sm font-semibold text-white shadow-xs focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                    >
                        Got it
                    </button>
                </DialogActions>
            </Dialog>
        </>
    );
};

export default Settings;
