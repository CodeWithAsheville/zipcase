declare module 'mammoth' {
    export interface MammothResult {
        value: string;
        messages: any[];
    }

    export interface MammothInput {
        path?: string;
        buffer?: Buffer;
        arrayBuffer?: ArrayBuffer;
    }

    export function extractRawText(input: MammothInput): Promise<MammothResult>;
}
