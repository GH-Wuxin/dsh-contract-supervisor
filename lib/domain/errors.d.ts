export declare const ERROR_CODES: {
    readonly INVALID_CANONICAL_VALUE: 'INVALID_CANONICAL_VALUE';
    readonly INVALID_CONTRACT: 'INVALID_CONTRACT';
    readonly INVALID_SLICE: 'INVALID_SLICE';
    readonly READ_AUTHORITY_EXPANSION: 'READ_AUTHORITY_EXPANSION';
    readonly WRITE_AUTHORITY_EXPANSION: 'WRITE_AUTHORITY_EXPANSION';
    readonly UNKNOWN_VERIFIER_REF: 'UNKNOWN_VERIFIER_REF';
    readonly WORKER_TOOL_AUTHORITY_EXPANSION: 'WORKER_TOOL_AUTHORITY_EXPANSION';
};
export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];
export declare class DomainError extends Error {
    readonly code: ErrorCode;
    constructor(code: ErrorCode, message: string);
}
//# sourceMappingURL=errors.d.ts.map