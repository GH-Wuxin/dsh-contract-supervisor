export declare const SLICE_PHASES: readonly ['PROPOSED', 'ADMITTED', 'RUNNING', 'WORKER_STOPPED', 'ATTEMPT_FAILED', 'SCOPE_BLOCKED', 'SCOPE_AUDIT', 'VERIFYING', 'REVIEWING', 'READY_TO_SEAL', 'REJECTED_ADMISSION', 'REJECTED_SCOPE', 'REJECTED_VERIFIER', 'INDETERMINATE', 'REJECTED_IMPLEMENTATION', 'ESCALATED'];
export type SlicePhase = (typeof SLICE_PHASES)[number];
export declare const ATTEMPT_PHASES: readonly ['CREATED', 'SPAWNING', 'SPAWN_FAILED', 'RUNNING', 'SETTLED', 'DISPOSING', 'DISPOSED'];
export type AttemptPhase = (typeof ATTEMPT_PHASES)[number];
export type AttemptOutcome = null | 'SUCCESS' | 'FAILED' | 'INVALIDATED';
export interface SliceState {
    readonly phase: SlicePhase;
    readonly sliceHash: string;
    readonly contractHash: string;
    readonly maxAttempts: number;
    readonly attemptCount: number;
    readonly currentAttemptId: string | null;
    readonly usedAttemptIds: readonly string[];
}
export interface AttemptState {
    readonly phase: AttemptPhase;
    readonly attemptId: string;
    readonly attemptNo: number;
    readonly sliceHash: string;
    readonly outcome: AttemptOutcome;
}
export interface SupervisorRuntimeState {
    readonly activeSliceHash: string | null;
    readonly activeSlice: SliceState | null;
}
export type ScopeVerdict = 'PASS' | 'FAIL';
export type VerifierVerdict = 'PASS' | 'FAIL' | 'INDETERMINATE';
export type ReviewVerdict = 'APPROVE' | 'REJECT_IMPLEMENTATION' | 'CONTRACT_CONFLICT' | 'REQUIRED_SCOPE_EXPANSION' | 'VERIFIER_INSUFFICIENT';
//# sourceMappingURL=types.d.ts.map