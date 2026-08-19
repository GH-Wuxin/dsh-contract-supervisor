export declare const STATE_ERROR_CODES: {
    readonly INVALID_STATE_TRANSITION: 'INVALID_STATE_TRANSITION';
    readonly SLICE_CONTRACT_MISMATCH: 'SLICE_CONTRACT_MISMATCH';
    readonly ACTIVE_SLICE_EXISTS: 'ACTIVE_SLICE_EXISTS';
    readonly ATTEMPT_LIMIT_REACHED: 'ATTEMPT_LIMIT_REACHED';
    readonly ATTEMPT_ID_REUSED: 'ATTEMPT_ID_REUSED';
    readonly ATTEMPT_SLICE_MISMATCH: 'ATTEMPT_SLICE_MISMATCH';
    readonly ATTEMPT_NOT_DISPOSED: 'ATTEMPT_NOT_DISPOSED';
    readonly NO_ACTIVE_SLICE: 'NO_ACTIVE_SLICE';
    readonly SLICE_NOT_RELEASABLE: 'SLICE_NOT_RELEASABLE';
};
export type StateErrorCode = (typeof STATE_ERROR_CODES)[keyof typeof STATE_ERROR_CODES];
export declare class StateError extends Error {
    readonly code: StateErrorCode;
    constructor(code: StateErrorCode, message: string);
}
//# sourceMappingURL=errors.d.ts.map