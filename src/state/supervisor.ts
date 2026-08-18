import { assertSliceAuthority } from '../domain/index.js';
import type {
  VerifierDescriptor,
  WriteAuthorityRule,
} from '../domain/index.js';
import { StateError, STATE_ERROR_CODES } from './errors.js';
import {
  beginScopeAudit,
  completeScopeAudit,
  completeVerification,
  createAdmittedSliceState,
  finalizeAttemptForSlice,
  requestRetry,
  reviewSlice,
  startAttempt,
} from './slice.js';
import type {
  AttemptState,
  ReviewVerdict,
  ScopeVerdict,
  SlicePhase,
  SliceState,
  SupervisorRuntimeState,
  VerifierVerdict,
} from './types.js';

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

const RUNTIME_BRAND = Symbol('dsh-contract-supervisor.supervisorRuntimeState');

const RELEASABLE_PHASES: readonly SlicePhase[] = [
  'REJECTED_ADMISSION',
  'REJECTED_SCOPE',
  'REJECTED_VERIFIER',
  'INDETERMINATE',
  'ESCALATED',
];

export function isReleasablePhase(phase: SlicePhase): boolean {
  return RELEASABLE_PHASES.includes(phase);
}

function invalidTransition(message: string): never {
  throw new StateError(STATE_ERROR_CODES.INVALID_STATE_TRANSITION, message);
}

function isRuntimeState(value: unknown): value is SupervisorRuntimeState {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Record<PropertyKey, unknown>)[RUNTIME_BRAND] === true
  );
}

function assertRuntimeState(runtime: SupervisorRuntimeState): void {
  if (!isRuntimeState(runtime)) {
    invalidTransition('Cannot operate on a non-authentic SupervisorRuntimeState');
  }
}

function makeRuntimeState(
  activeSliceHash: string | null,
  activeSlice: SliceState | null,
): SupervisorRuntimeState {
  const state: SupervisorRuntimeState = {
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

export function createSupervisorRuntimeState(): SupervisorRuntimeState {
  return makeRuntimeState(null, null);
}

export function admitSlice(
  runtime: SupervisorRuntimeState,
  contract: AdmissibleContract,
  slice: AdmissibleSlice,
): SupervisorRuntimeState {
  assertRuntimeState(runtime);

  if (runtime.activeSliceHash !== null) {
    throw new StateError(
      STATE_ERROR_CODES.ACTIVE_SLICE_EXISTS,
      `Cannot activate Slice '${slice.sliceHash}' while Slice '${runtime.activeSliceHash}' is active`,
    );
  }

  if (runtime.activeSlice !== null) {
    invalidTransition(
      'Cannot admit a Slice because runtime activeSlice is present without activeSliceHash',
    );
  }

  if (slice.contractHash !== contract.contractHash) {
    throw new StateError(
      STATE_ERROR_CODES.SLICE_CONTRACT_MISMATCH,
      `Slice '${slice.sliceHash}' belongs to contract '${slice.contractHash}', expected '${contract.contractHash}'`,
    );
  }

  assertSliceAuthority(contract, slice);

  const admittedSlice = createAdmittedSliceState({
    sliceHash: slice.sliceHash,
    contractHash: slice.contractHash,
    maxAttempts: slice.maxAttempts,
  });

  return makeRuntimeState(slice.sliceHash, admittedSlice);
}

function assertRuntimeConsistency(runtime: SupervisorRuntimeState): void {
  assertRuntimeState(runtime);

  if (runtime.activeSliceHash === null) {
    if (runtime.activeSlice !== null) {
      invalidTransition('Cannot update a Slice because runtime activeSlice is present without activeSliceHash');
    }

    throw new StateError(
      STATE_ERROR_CODES.NO_ACTIVE_SLICE,
      'Cannot update a Slice because no Slice is active',
    );
  }

  if (runtime.activeSlice === null) {
    invalidTransition('Cannot update a Slice because runtime activeSlice is missing');
  }

  if (runtime.activeSliceHash !== runtime.activeSlice.sliceHash) {
    invalidTransition(
      `Cannot update Slice because activeSliceHash '${runtime.activeSliceHash}' does not match activeSlice.sliceHash '${runtime.activeSlice.sliceHash}'`,
    );
  }
}

function setActiveSlice(nextSlice: SliceState): SupervisorRuntimeState {
  return makeRuntimeState(nextSlice.sliceHash, nextSlice);
}

export function startActiveAttempt(
  runtime: SupervisorRuntimeState,
  attemptId: string,
): { readonly runtime: SupervisorRuntimeState; readonly attempt: AttemptState } {
  assertRuntimeConsistency(runtime);
  const { slice, attempt } = startAttempt(runtime.activeSlice!, attemptId);
  return {
    runtime: setActiveSlice(slice),
    attempt,
  };
}

export function finalizeActiveAttempt(
  runtime: SupervisorRuntimeState,
  attempt: AttemptState,
): SupervisorRuntimeState {
  assertRuntimeConsistency(runtime);
  return setActiveSlice(
    finalizeAttemptForSlice(runtime.activeSlice!, attempt),
  );
}

export function beginActiveScopeAudit(
  runtime: SupervisorRuntimeState,
): SupervisorRuntimeState {
  assertRuntimeConsistency(runtime);
  return setActiveSlice(beginScopeAudit(runtime.activeSlice!));
}

export function completeActiveScopeAudit(
  runtime: SupervisorRuntimeState,
  verdict: ScopeVerdict,
): SupervisorRuntimeState {
  assertRuntimeConsistency(runtime);
  return setActiveSlice(
    completeScopeAudit(runtime.activeSlice!, verdict),
  );
}

export function completeActiveVerification(
  runtime: SupervisorRuntimeState,
  verdict: VerifierVerdict,
): SupervisorRuntimeState {
  assertRuntimeConsistency(runtime);
  return setActiveSlice(
    completeVerification(runtime.activeSlice!, verdict),
  );
}

export function reviewActiveSlice(
  runtime: SupervisorRuntimeState,
  verdict: ReviewVerdict,
): SupervisorRuntimeState {
  assertRuntimeConsistency(runtime);
  return setActiveSlice(reviewSlice(runtime.activeSlice!, verdict));
}

export function retryActiveSlice(
  runtime: SupervisorRuntimeState,
): SupervisorRuntimeState {
  assertRuntimeConsistency(runtime);
  return setActiveSlice(requestRetry(runtime.activeSlice!));
}

export function releaseActiveSlice(
  runtime: SupervisorRuntimeState,
): SupervisorRuntimeState {
  assertRuntimeConsistency(runtime);

  if (!isReleasablePhase(runtime.activeSlice!.phase)) {
    throw new StateError(
      STATE_ERROR_CODES.SLICE_NOT_RELEASABLE,
      `Slice '${runtime.activeSliceHash}' in phase ${runtime.activeSlice!.phase} cannot be released by S3`,
    );
  }

  return makeRuntimeState(null, null);
}
