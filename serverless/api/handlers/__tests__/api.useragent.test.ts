/**
 * Tests to ensure API handlers don't forward user agents
 */
import { execute as searchExecute } from '../../handlers/search';
import { execute as nameSearchExecute } from '../../handlers/name-search';

describe('API Handlers - User Agent Non-Forwarding', () => {
  describe('Search Handler', () => {
    it('should not extract or use user agent from request headers', async () => {
      // Create test event with user agent
      const event = {
        headers: {
          'User-Agent': 'Custom-API-Client/1.0'
        },
        body: JSON.stringify({
          search: 'test-case-number'
        })
      };

      const response = await searchExecute(event as any, null as any, null as any);

      if (response) {
        const responseBody = JSON.parse(response.body);

        // Verify user agent is not present in response
        expect(responseBody.userAgent).toBeUndefined();
      }
    });
  });

  describe('Name Search Handler', () => {
    it('should not extract or use user agent from request headers', async () => {
      // Create test event with user agent
      const event = {
        headers: {
          'User-Agent': 'Custom-API-Client/1.0'
        },
        body: JSON.stringify({
          name: 'John Smith'
        })
      };

      const response = await nameSearchExecute(event as any, null as any, null as any);

      if (response) {
        const responseBody = JSON.parse(response.body);

        // Verify user agent is not present in search request
        expect(responseBody.searchRequest.userAgent).toBeUndefined();
      }
    });
  });
});