import { ZipCase, CaseSummary } from './ZipCase';

export interface SearchRequest {
    input: string;
    userId: string;
}

export interface StatusRequest {
    caseNumbers: string[];
}

export interface SearchResult {
    zipCase: ZipCase;
    caseSummary?: CaseSummary;
}

export interface SearchResponse {
    results: Record<string, SearchResult>;
}
