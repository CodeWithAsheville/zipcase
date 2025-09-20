export type FetchStatus =
    | { status: 'complete' }
    | { status: 'failed'; message: string }
    | { status: 'found' } // New status - caseId exists but case data not yet fetched
    | { status: 'notFound' }
    | { status: 'processing' }
    | { status: 'reprocessing'; tryCount: number }
    | { status: 'queued' };

export interface ChargeDegree {
    code: string;
    description: string;
}

export interface Disposition {
    date: string;
    code: string;
    description: string;
}

export interface Charge {
    offenseDate: string;
    filedDate: string;
    description: string;
    statute: string;
    degree: ChargeDegree;
    fine: number;
    dispositions: Disposition[];
}

export interface CaseSummary {
    caseName: string;
    court: string;
    charges: Charge[];
}

export interface ZipCase {
    caseNumber: string;
    fetchStatus: FetchStatus;
    lastUpdated?: string;
    caseId?: string;
}
