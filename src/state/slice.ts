import { StateError, STATE_ERROR_CODES } from './errors.js';
import { assertAttemptState, createAttemptState } from './attempt.js';
import type {
  AttemptState,
  ReviewVerdict,
  ScopeVerdict,
  SliceState,
  VerifierVerdict,
} from './types.js';

export interface CreateSliceStateInput {
  readonly sliceHash: string;
  readonly contractHash: string;
  readonly maxAttempts: number;
}

const SLICE_BRAND = Symbol('dsh-contract-supervisor.sliceState');

function invalidTransition(message: string): never {
  throw new StateError(STATE_ERROR_CODES.INVALID_STATE_TRANSITION, message);
}

function isSliceState(value: unknown): value is SliceState {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Record<PropertyKey, unknown>)[SLICE_BRAND] === true
  );
}

function assertSliceState(slice: SliceState): void {
  if (!isSliceState(slice)) {
    invalidTransition('Cannot operate on a non-authentic SliceState');
  }
}

function makeSliceState(fields: SliceState): SliceState {
  const state: SliceState = { ...fields };
  Object.defineProperty(state, SLICE_BRAND, {
    value: true,
    enumerable: false,
    writable: false,
    configurable: false,
  });
  return Object.freeze(state);
}

function ensureSlicePhase(slice: SliceState, expected: SliceState['phase'], action: string): void {
  assertSliceState(slice);
  if (slice.phase !== expected) {
    invalidTransition(`Cannot ${action} while Slice is in phase ${slice.phase}`);
  }
}

export function createSliceState(input: CreateSliceStateInput): SliceState {
  return makeSliceState({
    phase: 'PROPOSED',
    sliceHash: input.sliceHash,
    contractHash: input.contractHash,
    maxAttempts: input.maxAttempts,
    attemptCount: 0,
    currentAttemptId: null,
    usedAttemptIds: Object.freeze([]),
  });
}

export function createAdmittedSliceState(input: CreateSliceStateInput): SliceState {
  return makeSliceState({
    phase: 'ADMITTED',
    sliceHash: input.sliceHash,
    contractHash: input.contractHash,
    maxAttempts: input.maxAttempts,
    attemptCount: 0,
    currentAttemptId: null,
    usedAttemptIds: Object.freeze([]),
  });
}

export function rejectAdmission(slice: SliceState): SliceState {
  ensureSlicePhase(slice, 'PROPOSED', 'reject admission');
  return makeSliceState({ ...slice, phase: 'REJECTED_ADMISSION' });
}

export function startAttempt(
  slice: SliceState,
  attemptId: string,
): { readonly slice: SliceState; readonly attempt: AttemptState } {
  ensureSlicePhase(slice, 'ADMITTED', 'start an Attempt');

  if (slice.usedAttemptIds.includes(attemptId)) {
    throw new StateError(
      STATE_ERROR_CODES.ATTEMPT_ID_REUSED,
      `Attempt ID '${attemptId}' has already been used for Slice '${slice.sliceHash}'`,
    );
  }

  const attemptNo = slice.attemptCount + 1;
  if (attemptNo > slice.maxAttempts) {
    throw new StateError(
      STATE_ERROR_CODES.ATTEMPT_LIMIT_REACHED,
      `Slice '${slice.sliceHash}' has reached maxAttempts=${slice.maxAttempts}`,
    );
  }

  const attempt = createAttemptState({
    attemptId,
    attemptNo,
    sliceHash: slice.sliceHash,
  });

  const nextSlice = makeSliceState({
    ...slice,
    phase: 'RUNNING',
    attemptCount: attemptNo,
    currentAttemptId: attemptId,
    usedAttemptIds: Object.freeze([...slice.usedAttemptIds, attemptId]),
  });

  return { slice: nextSlice, attempt };
}

export function requestRetry(slice: SliceState): SliceState {
  assertSliceState(slice);
  if (slice.phase !== 'ATTEMPT_FAILED' && slice.phase !== 'REJECTED_IMPLEMENTATION') {
    invalidTransition(
      `Cannot request retry while Slice is in phase ${slice.phase}`,
    );
  }

  if (slice.attemptCount >= slice.maxAttempts) {
    throw new StateError(
      STATE_ERROR_CODES.ATTEMPT_LIMIT_REACHED,
      `Slice '${slice.sliceHash}' has reached maxAttempts=${slice.maxAttempts}`,
    );
  }

  return makeSliceState({
    ...slice,
    phase: 'ADMITTED',
    currentAttemptId: null,
  });
}

export function finalizeAttemptForSlice(
  slice: SliceState,
  attempt: AttemptState,
): SliceState {
  ensureSlicePhase(slice, 'RUNNING', 'finalize an Attempt for a Slice');
  assertAttemptState(attempt);

  if (attempt.phase !== 'DISPOSED') {
    throw new StateError(
      STATE_ERROR_CODES.ATTEMPT_NOT_DISPOSED,
      `Attempt '${attempt.attemptId}' must be DISPOSED before finalizing (current phase ${attempt.phase})`,
    );
  }

  if (attempt.sliceHash !== slice.sliceHash || attempt.attemptId !== slice.currentAttemptId) {
    throw new StateError(
      STATE_ERROR_CODES.ATTEMPT_SLICE_MISMATCH,
      `Attempt '${attempt.attemptId}' does not match current attempt of Slice '${slice.sliceHash}'`,
    );
  }

  switch (attempt.outcome) {
    case 'SUCCESS':
      return makeSliceState({ ...slice, phase: 'WORKER_STOPPED' });
    case 'FAILED':
      return makeSliceState({ ...slice, phase: 'ATTEMPT_FAILED' });
    case 'INVALIDATED':
      return makeSliceState({ ...slice, phase: 'SCOPE_BLOCKED' });
    default:
      throw new StateError(
        STATE_ERROR_CODES.INVALID_STATE_TRANSITION,
        `Attempt '${attempt.attemptId}' was DISPOSED without a settled outcome`,
      );
  }
}

export function beginScopeAudit(slice: SliceState): SliceState {
  ensureSlicePhase(slice, 'WORKER_STOPPED', 'begin scope audit');
  return makeSliceState({ ...slice, phase: 'SCOPE_AUDIT' });
}

export function completeScopeAudit(slice: SliceState, verdict: ScopeVerdict): SliceState {
  ensureSlicePhase(slice, 'SCOPE_AUDIT', 'complete scope audit');
  if (verdict === 'PASS') {
    return makeSliceState({ ...slice, phase: 'VERIFYING' });
  }
  if (verdict === 'FAIL') {
    return makeSliceState({ ...slice, phase: 'REJECTED_SCOPE' });
  }
  invalidTransition(`Unknown scope verdict '${verdict as string}'`);
}

export function completeVerification(slice: SliceState, verdict: VerifierVerdict): SliceState {
  ensureSlicePhase(slice, 'VERIFYING', 'complete verification');
  switch (verdict) {
    case 'PASS':
      return makeSliceState({ ...slice, phase: 'REVIEWING' });
    case 'FAIL':
      return makeSliceState({ ...slice, phase: 'REJECTED_VERIFIER' });
    case 'INDETERMINATE':
      return makeSliceState({ ...slice, phase: 'INDETERMINATE' });
    default:
      invalidTransition(`Unknown verifier verdict '${verdict as string}'`);
  }
}

export function reviewSlice(slice: SliceState, verdict: ReviewVerdict): SliceState {
  ensureSlicePhase(slice, 'REVIEWING', 'review Slice');
  switch (verdict) {
    case 'APPROVE':
      return makeSliceState({ ...slice, phase: 'READY_TO_SEAL' });
    case 'REJECT_IMPLEMENTATION':
      return makeSliceState({ ...slice, phase: 'REJECTED_IMPLEMENTATION' });
    case 'CONTRACT_CONFLICT':
    case 'REQUIRED_SCOPE_EXPANSION':
    case 'VERIFIER_INSUFFICIENT':
      return makeSliceState({ ...slice, phase: 'ESCALATED' });
    default:
      invalidTransition(`Unknown review verdict '${verdict as string}'`);
  }
}
