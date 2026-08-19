import { type LedgerAppendInput, type LedgerRecord, type LedgerSnapshot } from './types.js';
export declare class JsonlLedger {
    private readonly filePathValue;
    private recordsValue;
    private handle;
    private appendQueue;
    private closedValue;
    private failedValue;
    private constructor();
    static open(filePath: string): Promise<JsonlLedger>;
    get filePath(): string;
    get records(): readonly LedgerRecord[];
    get lastSeq(): number | null;
    get tailHash(): string | null;
    getRecords(): LedgerRecord[];
    readAll(): LedgerRecord[];
    replay(): Promise<LedgerRecord[]>;
    readDurableRecords(): Promise<LedgerRecord[]>;
    snapshot(): LedgerSnapshot;
    append(input: LedgerAppendInput): Promise<LedgerRecord>;
    private appendNow;
    close(): Promise<void>;
}
export declare function openLedger(filePath: string): Promise<JsonlLedger>;
export declare function createLedger(filePath: string): Promise<JsonlLedger>;
//# sourceMappingURL=ledger.d.ts.map