import type { AttemptState, ReviewVerdict, ScopeVerdict, SliceState, VerifierVerdict } from './types.js';
export interface CreateSliceStateInput {
    readonly sliceHash: string;
    readonly contractHash: string;
    readonly maxAttempts: number;
}
export declare function createSliceState(input: CreateSliceStateInput): SliceState;
export declare function createAdmittedSliceState(input: CreateSliceStateInput): SliceState;
export declare function rejectAdmission(slice: SliceState): SliceState;
export declare function startAttempt(slice: SliceState, attemptId: string): {
    readonly slice: SliceState;
    readonly attempt: AttemptState;
};
export declare function requestRetry(slice: SliceState): SliceState;
export declare function finalizeAttemptForSlice(slice: SliceState, attempt: AttemptState): SliceState;
export declare function beginScopeAudit(slice: SliceState): SliceState;
export declare function completeScopeAudit(slice: SliceState, verdict: ScopeVerdict): SliceState;
export declare function completeVerification(slice: SliceState, verdict: VerifierVerdict): SliceState;
export declare function reviewSlice(slice: SliceState, verdict: ReviewVerdict): SliceState;
//# sourceMappingURL=slice.d.ts.map