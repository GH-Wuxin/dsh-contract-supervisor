export declare const DRIVER_COMMANDER_PROVIDER: 'deepseek-ai';
export declare const DRIVER_COMMANDER_MODEL: 'Pro';
export declare const DRIVER_WORKER_PROVIDER: 'deepseek-ai';
export declare const DRIVER_WORKER_MODEL: 'Flash';
export declare const RUNSPEC_VERSION: 1;
/**
 * Authority-confusing / derived fields that a RunSpec MUST NOT supply. They
 * are rejected (not silently ignored) so a human author cannot accidentally or
 * adversarially pin identity, authority, or model configuration through the
 * trusted input seam.
 */
export declare const REJECTED_RUNSPEC_TOP_LEVEL_KEYS: readonly ["attemptId", "sliceHash", "contractHash", "effectiveToolNames", "effectiveAuthority", "fsSessionId", "fsAuthority", "commanderProvider", "commanderModel", "workerProvider", "workerModel"];
export declare const REJECTED_RUNSPEC_SLICE_KEYS: readonly ["contractHash", "sliceHash", "attemptId", "effectiveToolNames", "effectiveAuthority"];
/**
 * The maximum authoritative commander instruction size, in UTF-8 bytes. An
 * oversized instruction fails closed: no Flash worker is spawned.
 */
export declare const COMMANDER_OUTPUT_MAX_BYTES = 16384;
export type WorkerOutcome = 'SUCCESS' | 'FAILED' | 'INVALIDATED';
/**
 * Exit-code bands so a caller can tell WHERE the driver stopped without
 * parsing messages.
 *
 *   0 — worker Attempt settled SUCCESS
 *   1 — worker Attempt settled non-SUCCESS (FAILED / INVALIDATED) or threw
 *   2 — commander-stage failure (before any Flash Attempt was created)
 *   3 — pre-commander failure (RunSpec / Contract / Slice / admission)
 */
export declare const EXIT_CODE_SUCCESS: 0;
export declare const EXIT_CODE_WORKER_FAILURE: 1;
export declare const EXIT_CODE_COMMANDER_FAILURE: 2;
export declare const EXIT_CODE_PRE_COMMANDER_FAILURE: 3;
export interface DriverResult {
    /** true iff the worker Attempt settled with outcome SUCCESS. */
    readonly ok: boolean;
    readonly exitCode: number;
    readonly contractHash: string | null;
    readonly sliceHash: string | null;
    readonly attemptId: string | null;
    readonly commanderTurn: number | null;
    readonly commanderTerminalKind: string | null;
    readonly commanderInstructionBytes: number | null;
    readonly workerOutcome: WorkerOutcome | null;
    readonly workerPhase: string | null;
    readonly workerSettled: boolean;
    readonly error: {
        readonly code: string;
        readonly message: string;
    } | null;
}
export declare const DRIVER_ERROR_CODES: {
    readonly RUNSPEC_INVALID: 'RUNSPEC_INVALID';
    readonly RUNSPEC_VERSION_UNSUPPORTED: 'RUNSPEC_VERSION_UNSUPPORTED';
    readonly RUNSPEC_REJECTED_FIELD: 'RUNSPEC_REJECTED_FIELD';
    readonly CONTRACT_CREATION_FAILED: 'CONTRACT_CREATION_FAILED';
    readonly SLICE_CREATION_FAILED: 'SLICE_CREATION_FAILED';
    readonly ADMISSION_FAILED: 'ADMISSION_FAILED';
    readonly COMMANDER_SPAWN_FAILED: 'COMMANDER_SPAWN_FAILED';
    readonly COMMANDER_RUNTIME_FAILED: 'COMMANDER_RUNTIME_FAILED';
    readonly COMMANDER_TERMINAL_NOT_COMPLETED: 'COMMANDER_TERMINAL_NOT_COMPLETED';
    readonly COMMANDER_OUTPUT_MISSING: 'COMMANDER_OUTPUT_MISSING';
    readonly COMMANDER_OUTPUT_EMPTY: 'COMMANDER_OUTPUT_EMPTY';
    readonly COMMANDER_OUTPUT_OVERSIZED: 'COMMANDER_OUTPUT_OVERSIZED';
    readonly WORKER_ATTEMPT_FAILED: 'WORKER_ATTEMPT_FAILED';
    readonly DRIVER_INTERNAL: 'DRIVER_INTERNAL';
};
export type DriverErrorCode = (typeof DRIVER_ERROR_CODES)[keyof typeof DRIVER_ERROR_CODES];
export declare class DriverError extends Error {
    readonly cause?: unknown;
    readonly code: DriverErrorCode;
    constructor(code: DriverErrorCode, message: string, cause?: unknown);
}
//# sourceMappingURL=types.d.ts.map