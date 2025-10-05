/**
 * Tests for the CaseProcessor module
 */
import CaseProcessor from '../CaseProcessor';
import QueueClient from '../QueueClient';
import { CookieJar } from 'tough-cookie';
import axios from 'axios';

// Mock dependencies
jest.mock('../PortalAuthenticator');
jest.mock('../QueueClient');
jest.mock('../StorageClient');
jest.mock('axios');
jest.mock('axios-cookiejar-support', () => ({
    wrapper: jest.fn(axios => axios),
}));
jest.mock('tough-cookie');

// Mock environment variable
process.env.PORTAL_URL = 'https://test-portal.example.com';

describe('CaseProcessor', () => {
    beforeEach(() => {
        // Reset all mocks before each test
        jest.clearAllMocks();
    });

    describe('fetchCaseIdFromPortal', () => {
        it('should return error if PORTAL_URL is not set', async () => {
            // Temporarily remove the environment variable
            const originalUrl = process.env.PORTAL_URL;
            delete process.env.PORTAL_URL;

            const mockJar = new CookieJar();
            const result = await CaseProcessor.fetchCaseIdFromPortal('22CR123456-789', mockJar);

            // Restore environment variable
            process.env.PORTAL_URL = originalUrl;

            expect(result.caseId).toBeNull();
            expect(result.error).toBeDefined();
            expect(result.error?.isSystemError).toBe(true);
        });

        it('should make requests to search for a case and extract the case ID', async () => {
            const mockJar = new CookieJar();
            const mockCaseId = '123ABC456DEF';

            // Mock axios post/get methods
            const mockPost = jest.fn().mockResolvedValue({
                status: 200,
                data: 'search form submitted',
            });

            const mockGet = jest.fn().mockResolvedValue({
                status: 200,
                data: `<html><body><a class="caseLink" data-caseid="${mockCaseId}">Case Link</a></body></html>`,
            });

            // @ts-ignore - mock the axios create method
            axios.create.mockReturnValue({
                post: mockPost,
                get: mockGet,
            });

            const result = await CaseProcessor.fetchCaseIdFromPortal('22CR123456-789', mockJar);

            expect(mockPost).toHaveBeenCalledWith(
                expect.stringContaining('/Portal/SmartSearch/SmartSearch/SmartSearch'),
                expect.any(URLSearchParams)
            );
            expect(mockGet).toHaveBeenCalledWith(expect.stringContaining('/Portal/SmartSearch/SmartSearchResults'));
            expect(result.caseId).toBe(mockCaseId);
            expect(result.error).toBeUndefined();
        });

        it('should return error with isSystemError=false if no case links are found', async () => {
            const mockJar = new CookieJar();

            // Mock axios post/get methods
            const mockPost = jest.fn().mockResolvedValue({
                status: 200,
                data: 'search form submitted',
            });

            const mockGet = jest.fn().mockResolvedValue({
                status: 200,
                data: '<html><body>No cases found</body></html>', // No caseLink elements
            });

            // @ts-ignore - mock the axios create method
            axios.create.mockReturnValue({
                post: mockPost,
                get: mockGet,
            });

            const result = await CaseProcessor.fetchCaseIdFromPortal('22CR123456-789', mockJar);

            expect(result.caseId).toBeNull();
            expect(result.error).toBeDefined();
            expect(result.error?.isSystemError).toBe(false); // Not a system error, a legitimate "not found"
        });

        it('should return error with isSystemError=true if the search request fails', async () => {
            const mockJar = new CookieJar();

            // Mock axios post method to fail
            const mockPost = jest.fn().mockResolvedValue({
                status: 500,
                data: 'server error',
            });

            // @ts-ignore - mock the axios create method
            axios.create.mockReturnValue({
                post: mockPost,
                get: jest.fn(),
            });

            const result = await CaseProcessor.fetchCaseIdFromPortal('22CR123456-789', mockJar);

            expect(mockPost).toHaveBeenCalled();
            expect(result.caseId).toBeNull();
            expect(result.error).toBeDefined();
            expect(result.error?.isSystemError).toBe(true);
        });
    });

    describe('queueCasesForSearch', () => {
        // We'll test the queueCasesForSearch function which is the correct one according to our implementation

        it('should queue cases for search', async () => {
            // @ts-ignore - mock implementation
            QueueClient.queueCasesForSearch.mockResolvedValue(undefined);

            const cases = ['22CR123456-789', '23CV654321-456'];
            const userId = 'test-user';

            await CaseProcessor.queueCasesForSearch(cases, userId);

            expect(QueueClient.queueCasesForSearch).toHaveBeenCalledWith(cases, userId);
        });
    });

    // Tests for buildCaseSummary (moved from separate test file)
    describe('buildCaseSummary', () => {
        const { buildCaseSummary } = CaseProcessor as any;

        it('extracts the earliest LPSD Event.EventDate and sets arrestOrCitationDate and type as Arrest', () => {
            const rawData = {
                summary: {
                    CaseSummaryHeader: {
                        Style: 'State vs. Someone',
                        Heading: 'Circuit Court',
                        CaseId: 'case-123',
                    },
                },
                charges: {
                    Charges: [
                        {
                            ChargeId: 1,
                            OffenseDate: '2020-01-01',
                            FiledDate: '2020-01-02',
                            ChargeOffense: {
                                ChargeOffenseDescription: 'Theft',
                                Statute: '123',
                                Degree: 'M',
                                DegreeDescription: 'Misdemeanor',
                                FineAmount: 0,
                            },
                        },
                    ],
                },
                dispositionEvents: {
                    Events: [],
                },
                caseEvents: {
                    Events: [
                        { Event: { TypeId: { Word: 'LPSD' }, EventDate: '03/15/2021' } },
                        { Event: { TypeId: { Word: 'LPSD' }, EventDate: '02/10/2021' } },
                        { Event: { TypeId: { Word: 'OTHER' }, EventDate: '01/01/2020' } },
                    ],
                },
            };

            const summary = buildCaseSummary(rawData);

            expect(summary).not.toBeNull();
            expect(summary?.arrestOrCitationDate).toBeDefined();
            expect(summary?.arrestOrCitationType).toBe('Arrest');

            // Expected earliest LPSD date is 02/10/2021 -> construct UTC Date and compare ISO
            const expectedIso = new Date(Date.UTC(2021, 1, 10)).toISOString();
            expect(summary?.arrestOrCitationDate).toBe(expectedIso);
        });

        it('selects CIT over LPSD if earlier (sets type Citation)', () => {
            const rawData = {
                summary: {
                    CaseSummaryHeader: {
                        Style: 'State vs. Someone',
                        Heading: 'Circuit Court',
                        CaseId: 'case-234',
                    },
                },
                charges: { Charges: [] },
                dispositionEvents: { Events: [] },
                caseEvents: {
                    Events: [
                        { Event: { TypeId: { Word: 'LPSD' }, EventDate: '03/15/2021' } },
                        { Event: { TypeId: { Word: 'CIT' }, EventDate: '02/09/2021' } },
                    ],
                },
            };

            const summary = buildCaseSummary(rawData);

            expect(summary).not.toBeNull();
            expect(summary?.arrestOrCitationDate).toBeDefined();
            expect(summary?.arrestOrCitationType).toBe('Citation');

            const expectedIso = new Date(Date.UTC(2021, 1, 9)).toISOString();
            expect(summary?.arrestOrCitationDate).toBe(expectedIso);
        });

        it('does not set arrestOrCitationDate when no LPSD/CIT events present', () => {
            const rawData = {
                summary: {
                    CaseSummaryHeader: {
                        Style: 'State vs. Someone',
                        Heading: 'Circuit Court',
                        CaseId: 'case-456',
                    },
                },
                charges: {
                    Charges: [],
                },
                dispositionEvents: {
                    Events: [],
                },
                caseEvents: {
                    Events: [{ Event: { TypeId: { Word: 'OTHER' }, EventDate: '03/15/2021' } }],
                },
            };

            const summary = buildCaseSummary(rawData);

            expect(summary).not.toBeNull();
            expect(summary?.arrestOrCitationDate).toBeUndefined();
            expect(summary?.arrestOrCitationType).toBeUndefined();
        });

        it('ignores malformed LPSD Event.EventDate values', () => {
            const { buildCaseSummary } = CaseProcessor as any;

            const rawData = {
                summary: {
                    CaseSummaryHeader: {
                        Style: 'State vs. Someone',
                        Heading: 'Circuit Court',
                        CaseId: 'case-789',
                    },
                },
                charges: { Charges: [] },
                dispositionEvents: { Events: [] },
                caseEvents: {
                    Events: [
                        { Event: { TypeId: { Word: 'LPSD' }, EventDate: 'not-a-date' } },
                        { Event: { TypeId: { Word: 'LPSD' }, EventDate: '' } },
                        { Event: { TypeId: { Word: 'LPSD' }, EventDate: null } },
                    ],
                },
            };

            const summary = buildCaseSummary(rawData);
            expect(summary).not.toBeNull();
            expect(summary?.arrestOrCitationDate).toBeUndefined();
            expect(summary?.arrestOrCitationType).toBeUndefined();
        });
    });
});
