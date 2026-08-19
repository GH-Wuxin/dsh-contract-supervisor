export declare const WORKER_ERROR_CODES: {
    readonly UNAUTHORIZED_TOOL: 'UNAUTHORIZED_TOOL';
    readonly WORKER_ALREADY_ACTIVE: 'WORKER_ALREADY_ACTIVE';
    readonly WORKER_SPAWN_FAILED: 'WORKER_SPAWN_FAILED';
    readonly WORKER_EXECUTION_FAILED: 'WORKER_EXECUTION_FAILED';
    readonly WORKER_DISPOSE_FAILED: 'WORKER_DISPOSE_FAILED';
    readonly WORKER_CONFIGURATION_INVALID: 'WORKER_CONFIGURATION_INVALID';
    readonly ACTIVE_SLICE_AUTHORITY_NOT_RECOVERABLE: 'ACTIVE_SLICE_AUTHORITY_NOT_RECOVERABLE';
    readonly ACTIVE_SLICE_TOOL_POLICY_NOT_RECOVERABLE: 'ACTIVE_SLICE_TOOL_POLICY_NOT_RECOVERABLE';
};
export type WorkerErrorCode = (typeof WORKER_ERROR_CODES)[keyof typeof WORKER_ERROR_CODES];
export declare class WorkerError extends Error {
    readonly code: WorkerErrorCode;
    constructor(code: WorkerErrorCode, message: string);
}
//# sourceMappingURL=errors.d.ts.map