// S5.2 — Pro Commander Host Driver.
//
// Narrow developer-only types for the RunSpec v1 input contract and the
// structured host result. The driver is host-side, not model-visible, and
// same-boot: it is driven by the booted DSH context that already owns the
// genuine AgentRegistry/ToolRuntime/Session machinery.
//
// Model configuration is HARD-FROZEN for S5.2 v1:
//   commander = deepseek-ai / Pro
//   worker    = deepseek-ai / Flash
// RunSpec cannot override these. The driver never reads model configuration
// from the RunSpec.
export const DRIVER_COMMANDER_PROVIDER = 'deepseek-ai';
export const DRIVER_COMMANDER_MODEL = 'Pro';
export const DRIVER_WORKER_PROVIDER = 'deepseek-ai';
export const DRIVER_WORKER_MODEL = 'Flash';
export const RUNSPEC_VERSION = 1;
/**
 * Authority-confusing / derived fields that a RunSpec MUST NOT supply. They
 * are rejected (not silently ignored) so a human author cannot accidentally or
 * adversarially pin identity, authority, or model configuration through the
 * trusted input seam.
 */
export const REJECTED_RUNSPEC_TOP_LEVEL_KEYS = Object.freeze([
    'attemptId',
    'sliceHash',
    'contractHash',
    'effectiveToolNames',
    'effectiveAuthority',
    'fsSessionId',
    'fsAuthority',
    'commanderProvider',
    'commanderModel',
    'workerProvider',
    'workerModel',
]);
export const REJECTED_RUNSPEC_SLICE_KEYS = Object.freeze([
    'contractHash',
    'sliceHash',
    'attemptId',
    'effectiveToolNames',
    'effectiveAuthority',
]);
/**
 * The maximum authoritative commander instruction size, in UTF-8 bytes. An
 * oversized instruction fails closed: no Flash worker is spawned.
 */
export const COMMANDER_OUTPUT_MAX_BYTES = 16384;
/**
 * Exit-code bands so a caller can tell WHERE the driver stopped without
 * parsing messages.
 *
 *   0 — worker Attempt settled SUCCESS
 *   1 — worker Attempt settled non-SUCCESS (FAILED / INVALIDATED) or threw
 *   2 — commander-stage failure (before any Flash Attempt was created)
 *   3 — pre-commander failure (RunSpec / Contract / Slice / admission)
 */
export const EXIT_CODE_SUCCESS = 0;
export const EXIT_CODE_WORKER_FAILURE = 1;
export const EXIT_CODE_COMMANDER_FAILURE = 2;
export const EXIT_CODE_PRE_COMMANDER_FAILURE = 3;
export const DRIVER_ERROR_CODES = {
    RUNSPEC_INVALID: 'RUNSPEC_INVALID',
    RUNSPEC_VERSION_UNSUPPORTED: 'RUNSPEC_VERSION_UNSUPPORTED',
    RUNSPEC_REJECTED_FIELD: 'RUNSPEC_REJECTED_FIELD',
    CONTRACT_CREATION_FAILED: 'CONTRACT_CREATION_FAILED',
    SLICE_CREATION_FAILED: 'SLICE_CREATION_FAILED',
    ADMISSION_FAILED: 'ADMISSION_FAILED',
    COMMANDER_SPAWN_FAILED: 'COMMANDER_SPAWN_FAILED',
    COMMANDER_RUNTIME_FAILED: 'COMMANDER_RUNTIME_FAILED',
    COMMANDER_TERMINAL_NOT_COMPLETED: 'COMMANDER_TERMINAL_NOT_COMPLETED',
    COMMANDER_OUTPUT_MISSING: 'COMMANDER_OUTPUT_MISSING',
    COMMANDER_OUTPUT_EMPTY: 'COMMANDER_OUTPUT_EMPTY',
    COMMANDER_OUTPUT_OVERSIZED: 'COMMANDER_OUTPUT_OVERSIZED',
    WORKER_ATTEMPT_FAILED: 'WORKER_ATTEMPT_FAILED',
    DRIVER_INTERNAL: 'DRIVER_INTERNAL',
};
export class DriverError extends Error {
    cause;
    code;
    constructor(code, message, cause) {
        super(message);
        this.cause = cause;
        this.name = 'DriverError';
        this.code = code;
    }
}
//# sourceMappingURL=types.js.map