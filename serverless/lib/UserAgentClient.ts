/**
 * UserAgentClient - A utility for managing user agent strings
 *
 * This module handles fetching, storing, and retrieving browser user agents.
 * It implements a tiered fallback strategy:
 * 1. Use the provided user agent if available (from client request)
 * 2. Look for a stored user agent for the specific user
 * 3. Use a random one from the collection of desktop user agents
 * 4. Use one of the hardcoded fallback user agents
 */
import axios from 'axios';
import StorageClient from './StorageClient';

// Constants
const USERAGENTS_API_URL = 'https://api.useragents.me/';
const DEFAULT_USER_AGENT =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36';

// Fallback user agents in case both the API and DynamoDB fail
const FALLBACK_USER_AGENTS = [
    // Chrome (Windows)
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    // Chrome (Mac)
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    // Edge (Windows)
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0',
    // Firefox (Windows)
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) Gecko/20100101 Firefox/126.0',
    // Safari (Mac)
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
];

interface UserAgentsApiResponse {
    success: boolean;
    data: {
        desktop: string[];
        mobile: string[];
        all: string[];
    };
}

/**
 * Fetches browser user agent strings from the useragents.me API
 *
 * @returns A list of desktop user agent strings or null if the API call fails
 */
async function fetchUserAgents(): Promise<string[] | null> {
    try {
        const response = await axios.get<UserAgentsApiResponse>(USERAGENTS_API_URL, {
            timeout: 5000, // 5 second timeout
        });

        if (response.data.success && response.data.data.desktop.length > 0) {
            return response.data.data.desktop;
        }

        return null;
    } catch (error) {
        console.error('Error fetching user agents from API:', error);
        return null;
    }
}

/**
 * Refreshes the collection of user agents in DynamoDB
 * @returns Promise that resolves when collection is refreshed
 */
async function refreshUserAgentsCollection(): Promise<string[]> {
    try {
        const userAgents = await fetchUserAgents();

        if (userAgents && userAgents.length > 0) {
            await StorageClient.saveUserAgentCollection(userAgents);
            console.log(`Successfully saved ${userAgents.length} user agents to DynamoDB`);
            return userAgents;
        } else {
            console.warn('No user agents fetched from API, using fallback values');
            await StorageClient.saveUserAgentCollection(FALLBACK_USER_AGENTS);
            return FALLBACK_USER_AGENTS;
        }
    } catch (error) {
        console.error('Failed to refresh user agent collection:', error);
        return FALLBACK_USER_AGENTS;
    }
}

const UserAgentClient = {
    /**
     * Gets a user agent based on the following priority:
     * 1. Use provided user agent (from client request)
     * 2. Get user's stored user agent
     * 3. Get random user agent from collection
     * 4. Use fallback user agents
     *
     * This also ensures user agents are refreshed on a regular basis.
     *
     * @param userId The user ID to look up
     * @param providedUserAgent Optional user agent from the client request
     * @returns A user agent string
     */
    async getUserAgent(userId: string, providedUserAgent?: string): Promise<string> {
        // Priority 1: Use provided user agent if it exists and appears valid
        if (providedUserAgent && providedUserAgent.includes('Mozilla/')) {
            // Store this user agent for future use
            await StorageClient.saveUserAgent(userId, providedUserAgent);
            return providedUserAgent;
        }

        try {
            // Priority 2: Try to get user's stored user agent
            const userAgent = await StorageClient.getUserAgent(userId);
            if (userAgent) {
                return userAgent;
            }

            // Priority 3: Get a random user agent from the collection
            const agentCollection = await StorageClient.getUserAgentCollection();

            if (agentCollection && agentCollection.length > 0) {
                // Choose a random user agent from the collection
                const randomIndex = Math.floor(Math.random() * agentCollection.length);
                const selectedUserAgent = agentCollection[randomIndex];

                // Save this user agent for this user
                await StorageClient.saveUserAgent(userId, selectedUserAgent);

                return selectedUserAgent;
            }

            // Collection doesn't exist or is empty - refresh the collection
            const freshUserAgents = await refreshUserAgentsCollection();

            if (freshUserAgents && freshUserAgents.length > 0) {
                // Choose a random user agent from the fresh collection
                const randomIndex = Math.floor(Math.random() * freshUserAgents.length);
                const selectedUserAgent = freshUserAgents[randomIndex];

                // Save this user agent for this user
                await StorageClient.saveUserAgent(userId, selectedUserAgent);

                return selectedUserAgent;
            }

            // Priority 4: Use a fallback user agent
            const fallbackIndex = Math.floor(Math.random() * FALLBACK_USER_AGENTS.length);
            const fallbackUserAgent = FALLBACK_USER_AGENTS[fallbackIndex];

            // Save this fallback user agent for the user
            await StorageClient.saveUserAgent(userId, fallbackUserAgent);

            return fallbackUserAgent;
        } catch (error) {
            console.error('Error getting user agent:', error);
            return DEFAULT_USER_AGENT;
        }
    },
};

export default UserAgentClient;
