import { useState, useEffect, useCallback, useRef } from 'react';
import { ZipCaseClient, ZipCaseResponse } from '../services/ZipCaseClient';

const client = new ZipCaseClient();

/**
 * Hook for making API calls to ZipCase backend
 *
 * @param endpointFn Function that takes a client and returns a promise with ZipCaseResponse
 * @param executeOnMount Whether to execute the API call when component mounts (defaults to false)
 */
export function useZipCaseApi<T>(
    endpointFn: (client: ZipCaseClient) => Promise<ZipCaseResponse<T>>,
    executeOnMount?: boolean
) {
    // Default executeOnMount to false for safety
    const shouldExecuteOnMount = executeOnMount ?? false;

    const [data, setData] = useState<T | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [status, setStatus] = useState<number | null>(null);
    const [loading, setLoading] = useState<boolean>(shouldExecuteOnMount);

    // Store the latest function in a ref to avoid dependency issues
    const endpointFnRef = useRef(endpointFn);
    endpointFnRef.current = endpointFn; // Always keep updated

    const callApi = useCallback(async () => {
        setLoading(true);
        try {
            const response = await endpointFnRef.current(client);
            setStatus(response.status);
            setData(response.data);
            setError(response.error);
            return response;
        } catch (e) {
            const errorMessage = (e as Error).message;
            setError(errorMessage);
            setStatus(0);
            return {
                success: false,
                status: 0,
                data: null,
                error: errorMessage,
            } as ZipCaseResponse<T>;
        } finally {
            setLoading(false);
        }
    }, []);

    // Execute on mount if requested
    useEffect(() => {
        if (shouldExecuteOnMount) {
            callApi().catch(err => {
                console.error('Error in API call:', err);
            });
        }
    }, [shouldExecuteOnMount, callApi]);

    return {
        data,
        error,
        status,
        loading,
        callApi,
        _raw: {
            data,
            error,
            status,
            loading,
            callApi,
        },
    };
}

export default useZipCaseApi;
