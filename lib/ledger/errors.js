export const LEDGER_ERROR_CODES = {
    INVALID_LEDGER_RECORD: 'INVALID_LEDGER_RECORD',
    LEDGER_SCHEMA_UNSUPPORTED: 'LEDGER_SCHEMA_UNSUPPORTED',
    LEDGER_SEQUENCE_MISMATCH: 'LEDGER_SEQUENCE_MISMATCH',
    LEDGER_PREV_HASH_MISMATCH: 'LEDGER_PREV_HASH_MISMATCH',
    LEDGER_HASH_MISMATCH: 'LEDGER_HASH_MISMATCH',
    LEDGER_CORRUPT: 'LEDGER_CORRUPT',
    LEDGER_IO_FAILURE: 'LEDGER_IO_FAILURE',
    LEDGER_CLOSED: 'LEDGER_CLOSED',
};
export class LedgerError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.name = 'LedgerError';
        this.code = code;
    }
}
//# sourceMappingURL=errors.js.map