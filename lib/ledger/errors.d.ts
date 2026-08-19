export declare const LEDGER_ERROR_CODES: {
    readonly INVALID_LEDGER_RECORD: 'INVALID_LEDGER_RECORD';
    readonly LEDGER_SCHEMA_UNSUPPORTED: 'LEDGER_SCHEMA_UNSUPPORTED';
    readonly LEDGER_SEQUENCE_MISMATCH: 'LEDGER_SEQUENCE_MISMATCH';
    readonly LEDGER_PREV_HASH_MISMATCH: 'LEDGER_PREV_HASH_MISMATCH';
    readonly LEDGER_HASH_MISMATCH: 'LEDGER_HASH_MISMATCH';
    readonly LEDGER_CORRUPT: 'LEDGER_CORRUPT';
    readonly LEDGER_IO_FAILURE: 'LEDGER_IO_FAILURE';
    readonly LEDGER_CLOSED: 'LEDGER_CLOSED';
};
export type LedgerErrorCode = (typeof LEDGER_ERROR_CODES)[keyof typeof LEDGER_ERROR_CODES];
export declare class LedgerError extends Error {
    readonly code: LedgerErrorCode;
    constructor(code: LedgerErrorCode, message: string);
}
//# sourceMappingURL=errors.d.ts.map