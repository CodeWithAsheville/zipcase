import { ZipCase, CaseSummary } from './ZipCase';

export interface CaseSearchRequest {
    input: string;
    userId: string;
    userAgent?: string;
}

export interface NameSearchRequest {
    name: string;
    userId: string;
    dateOfBirth?: string;
    soundsLike: boolean;
    criminalOnly: boolean;
    userAgent?: string;
}

export interface CaseSearchStatusRequest {
    caseNumbers: string[];
}

export interface NameSearchStatusRequest {
    searchId: string;
}

export interface SearchResult {
    zipCase: ZipCase;
    caseSummary?: CaseSummary;
}

export interface CaseSearchResponse {
    results: Record<string, SearchResult>;
}

export interface NameSearchResponse {
    searchId: string;
    results: Record<string, SearchResult>;
    success?: boolean;
    error?: string;
    status?: 'queued' | 'processing' | 'complete' | 'failed';
}

export interface NameSearchData {
    originalName: string;
    normalizedName: string;
    dateOfBirth?: string;
    soundsLike: boolean;
    criminalOnly: boolean;
    cases: string[];
    status?: 'queued' | 'processing' | 'complete' | 'failed';
    message?: string;
}
