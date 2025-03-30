export type FetchStatus =
    | { status: 'complete' }
    | { status: 'failed'; message: string }
    | { status: 'found' } // New status - caseId exists but case data not yet fetched
    | { status: 'notFound' }
    | { status: 'processing' }
    | { status: 'queued' };

// export interface CaseData {
//     readonly caseSummary: Json;
//     readonly parties?: Json;
//     readonly dispositionEvents?: Json;
//     readonly hearings?: Json;
//     readonly serviceEvents?: Json;
//     readonly financialSummary?: Json;
//     readonly conditions?: Json;
//     readonly bondSettings?: Json;
//     readonly placements?: Json;
// }

export interface Disposition {
    readonly date: string;
    readonly description: string;
}

export interface CaseSummary {
    caseName: string;
    court: string;
    dispositions?: Disposition[];
    offenseDescription?: string;
}

export interface ZipCase {
    caseNumber: string;
    fetchStatus: FetchStatus;
    lastUpdated?: string;
    caseId?: string;
}
