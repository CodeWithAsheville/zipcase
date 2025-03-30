import StorageClient from './StorageClient';
import { SearchResponse, StatusRequest } from '../../shared/types';

/**
 * Process a status request for existing cases without re-queuing.
 * Used for polling existing cases without causing state thrashing.
 */
export async function getStatusForCases(req: StatusRequest): Promise<SearchResponse> {
    try {
        // Get results for the requested case numbers - never requeue anything
        const results = await StorageClient.getSearchResults(req.caseNumbers);

        console.log(
            `Status check for ${req.caseNumbers.length} cases: ${req.caseNumbers.join(', ')}`
        );

        // Return search results for all cases
        return { results };
    } catch (error) {
        console.error('Error processing status check request:', error);
        return { results: {} };
    }
}
