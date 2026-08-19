export declare const LEDGER_SCHEMA_VERSION: 1;
export interface LedgerRecord {
    schemaVersion: 1;
    seq: number;
    type: string;
    time: string;
    payload: unknown;
    prevHash: string | null;
    hash: string;
}
export interface LedgerAppendInput {
    type: string;
    payload: unknown;
    time?: string;
}
export interface LedgerSnapshot {
    records: readonly LedgerRecord[];
    lastSeq: number | null;
    tailHash: string | null;
}
export interface Ledger {
    readonly filePath: string;
    readonly records: readonly LedgerRecord[];
    readonly lastSeq: number | null;
    readonly tailHash: string | null;
    append(input: LedgerAppendInput): Promise<LedgerRecord>;
    getRecords(): LedgerRecord[];
    readAll(): LedgerRecord[];
    replay(): Promise<LedgerRecord[]>;
    readDurableRecords(): Promise<LedgerRecord[]>;
    close(): Promise<void>;
}
//# sourceMappingURL=types.d.ts.map