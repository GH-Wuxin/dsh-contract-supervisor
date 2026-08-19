import type { VerifierDescriptor, WriteAuthorityRule } from '../domain/index.js';
import type { AttemptState, ReviewVerdict, ScopeVerdict, SlicePhase, SupervisorRuntimeState, VerifierVerdict } from './types.js';
export interface AdmissibleContract {
    readonly contractHash: string;
    readonly readAuthority: readonly string[];
    readonly writeAuthority: readonly WriteAuthorityRule[];
    readonly verifierCatalog: readonly VerifierDescriptor[];
    readonly workerToolAllowlist: readonly string[];
}
export interface AdmissibleSlice {
    readonly contractHash: string;
    readonly sliceHash: string;
    readonly maxAttempts: number;
    readonly allowedReads: readonly string[];
    readonly allowedWrites: readonly WriteAuthorityRule[];
    readonly verifierRefs: readonly string[];
    readonly regressionVerifierRefs: readonly string[];
    readonly workerToolAllowlist: readonly string[];
}
export declare function isReleasablePhase(phase: SlicePhase): boolean;
export declare function createSupervisorRuntimeState(): SupervisorRuntimeState;
export declare function admitSlice(runtime: SupervisorRuntimeState, contract: AdmissibleContract, slice: AdmissibleSlice): SupervisorRuntimeState;
export declare function startActiveAttempt(runtime: SupervisorRuntimeState, attemptId: string): {
    readonly runtime: SupervisorRuntimeState;
    readonly attempt: AttemptState;
};
export declare function finalizeActiveAttempt(runtime: SupervisorRuntimeState, attempt: AttemptState): SupervisorRuntimeState;
export declare function beginActiveScopeAudit(runtime: SupervisorRuntimeState): SupervisorRuntimeState;
export declare function completeActiveScopeAudit(runtime: SupervisorRuntimeState, verdict: ScopeVerdict): SupervisorRuntimeState;
export declare function completeActiveVerification(runtime: SupervisorRuntimeState, verdict: VerifierVerdict): SupervisorRuntimeState;
export declare function reviewActiveSlice(runtime: SupervisorRuntimeState, verdict: ReviewVerdict): SupervisorRuntimeState;
export declare function retryActiveSlice(runtime: SupervisorRuntimeState): SupervisorRuntimeState;
export declare function releaseActiveSlice(runtime: SupervisorRuntimeState): SupervisorRuntimeState;
//# sourceMappingURL=supervisor.d.ts.map