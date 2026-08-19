import { assertSliceAuthority } from '../domain/index.js';
import { StateError, STATE_ERROR_CODES } from './errors.js';
import { beginScopeAudit, completeScopeAudit, completeVerification, createAdmittedSliceState, finalizeAttemptForSlice, requestRetry, reviewSlice, startAttempt, } from './slice.js';
const RUNTIME_BRAND = Symbol('dsh-contract-supervisor.supervisorRuntimeState');
const RELEASABLE_PHASES = [
    'REJECTED_ADMISSION',
    'REJECTED_SCOPE',
    'REJECTED_VERIFIER',
    'INDETERMINATE',
    'ESCALATED',
];
export function isReleasablePhase(phase) {
    return RELEASABLE_PHASES.includes(phase);
}
function invalidTransition(message) {
    throw new StateError(STATE_ERROR_CODES.INVALID_STATE_TRANSITION, message);
}
function isRuntimeState(value) {
    return (typeof value === 'object' &&
        value !== null &&
        value[RUNTIME_BRAND] === true);
}
function assertRuntimeState(runtime) {
    if (!isRuntimeState(runtime)) {
        invalidTransition('Cannot operate on a non-authentic SupervisorRuntimeState');
    }
}
function makeRuntimeState(activeSliceHash, activeSlice) {
    const state = {
        activeSliceHash,
        activeSlice,
    };
    Object.defineProperty(state, RUNTIME_BRAND, {
        value: true,
        enumerable: false,
        writable: false,
        configurable: false,
    });
    return Object.freeze(state);
}
export function createSupervisorRuntimeState() {
    return makeRuntimeState(null, null);
}
export function admitSlice(runtime, contract, slice) {
    assertRuntimeState(runtime);
    if (runtime.activeSliceHash !== null) {
        throw new StateError(STATE_ERROR_CODES.ACTIVE_SLICE_EXISTS, `Cannot activate Slice '${slice.sliceHash}' while Slice '${runtime.activeSliceHash}' is active`);
    }
    if (runtime.activeSlice !== null) {
        invalidTransition('Cannot admit a Slice because runtime activeSlice is present without activeSliceHash');
    }
    if (slice.contractHash !== contract.contractHash) {
        throw new StateError(STATE_ERROR_CODES.SLICE_CONTRACT_MISMATCH, `Slice '${slice.sliceHash}' belongs to contract '${slice.contractHash}', expected '${contract.contractHash}'`);
    }
    assertSliceAuthority(contract, slice);
    const admittedSlice = createAdmittedSliceState({
        sliceHash: slice.sliceHash,
        contractHash: slice.contractHash,
        maxAttempts: slice.maxAttempts,
    });
    return makeRuntimeState(slice.sliceHash, admittedSlice);
}
function assertRuntimeConsistency(runtime) {
    assertRuntimeState(runtime);
    if (runtime.activeSliceHash === null) {
        if (runtime.activeSlice !== null) {
            invalidTransition('Cannot update a Slice because runtime activeSlice is present without activeSliceHash');
        }
        throw new StateError(STATE_ERROR_CODES.NO_ACTIVE_SLICE, 'Cannot update a Slice because no Slice is active');
    }
    if (runtime.activeSlice === null) {
        invalidTransition('Cannot update a Slice because runtime activeSlice is missing');
    }
    if (runtime.activeSliceHash !== runtime.activeSlice.sliceHash) {
        invalidTransition(`Cannot update Slice because activeSliceHash '${runtime.activeSliceHash}' does not match activeSlice.sliceHash '${runtime.activeSlice.sliceHash}'`);
    }
}
function setActiveSlice(nextSlice) {
    return makeRuntimeState(nextSlice.sliceHash, nextSlice);
}
export function startActiveAttempt(runtime, attemptId) {
    assertRuntimeConsistency(runtime);
    const { slice, attempt } = startAttempt(runtime.activeSlice, attemptId);
    return {
        runtime: setActiveSlice(slice),
        attempt,
    };
}
export function finalizeActiveAttempt(runtime, attempt) {
    assertRuntimeConsistency(runtime);
    return setActiveSlice(finalizeAttemptForSlice(runtime.activeSlice, attempt));
}
export function beginActiveScopeAudit(runtime) {
    assertRuntimeConsistency(runtime);
    return setActiveSlice(beginScopeAudit(runtime.activeSlice));
}
export function completeActiveScopeAudit(runtime, verdict) {
    assertRuntimeConsistency(runtime);
    return setActiveSlice(completeScopeAudit(runtime.activeSlice, verdict));
}
export function completeActiveVerification(runtime, verdict) {
    assertRuntimeConsistency(runtime);
    return setActiveSlice(completeVerification(runtime.activeSlice, verdict));
}
export function reviewActiveSlice(runtime, verdict) {
    assertRuntimeConsistency(runtime);
    return setActiveSlice(reviewSlice(runtime.activeSlice, verdict));
}
export function retryActiveSlice(runtime) {
    assertRuntimeConsistency(runtime);
    return setActiveSlice(requestRetry(runtime.activeSlice));
}
export function releaseActiveSlice(runtime) {
    assertRuntimeConsistency(runtime);
    if (!isReleasablePhase(runtime.activeSlice.phase)) {
        throw new StateError(STATE_ERROR_CODES.SLICE_NOT_RELEASABLE, `Slice '${runtime.activeSliceHash}' in phase ${runtime.activeSlice.phase} cannot be released by S3`);
    }
    return makeRuntimeState(null, null);
}
//# sourceMappingURL=supervisor.js.map