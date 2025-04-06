import { ZipCase, CaseSummary } from './ZipCase';

export interface SearchRequest {
    input: string;
    userId: string;
    userAgent?: string;
}

export interface NameSearchRequest {
    name: string;
    dateOfBirth?: string;
    soundsLike: boolean;
    userAgent?: string;
}

export interface StatusRequest {
    caseNumbers: string[];
}

export interface NameSearchStatusRequest {
    searchId: string;
}

export interface SearchResult {
    zipCase: ZipCase;
    caseSummary?: CaseSummary;
}

export interface SearchResponse {
    results: Record<string, SearchResult>;
}

export interface NameSearchResponse {
    searchId: string;
    results: Record<string, SearchResult>;
    success?: boolean;
    error?: string;
}

export interface NameSearchData {
    originalName: string;
    normalizedName: string;
    dateOfBirth?: string;
    soundsLike: boolean;
    cases: string[]; // Array of case numbers found
    status?: 'queued' | 'processing' | 'complete' | 'failed';
    message?: string;
}
