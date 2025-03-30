import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { SettingsPortalCredentials, SettingsApiKeys } from '../components';
import { useZipCaseApi } from '../hooks';

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

    return (
        <>
            <SettingsPortalCredentials portalCredentials={credentialsQuery} />
            <SettingsApiKeys apiSettings={apiSettingsQuery} />
        </>
    );
};

export default Settings;
