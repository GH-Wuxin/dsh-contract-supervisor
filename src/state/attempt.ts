import { StateError, STATE_ERROR_CODES } from './errors.js';
import type { AttemptOutcome, AttemptState } from './types.js';

export interface CreateAttemptInput {
  readonly attemptId: string;
  readonly attemptNo: number;
  readonly sliceHash: string;
}

const ATTEMPT_BRAND = Symbol('dsh-contract-supervisor.attemptState');

function invalidTransition(message: string): never {
  throw new StateError(STATE_ERROR_CODES.INVALID_STATE_TRANSITION, message);
}

function isAttemptState(value: unknown): value is AttemptState {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Record<PropertyKey, unknown>)[ATTEMPT_BRAND] === true
  );
}

export function assertAttemptState(attempt: AttemptState): void {
  if (!isAttemptState(attempt)) {
    invalidTransition('Cannot operate on a non-authentic AttemptState');
  }
}

function makeAttemptState(fields: AttemptState): AttemptState {
  const state: AttemptState = { ...fields };
  Object.defineProperty(state, ATTEMPT_BRAND, {
    value: true,
    enumerable: false,
    writable: false,
    configurable: false,
  });
  return Object.freeze(state);
}

export function createAttemptState(input: CreateAttemptInput): AttemptState {
  return makeAttemptState({
    phase: 'CREATED',
    attemptId: input.attemptId,
    attemptNo: input.attemptNo,
    sliceHash: input.sliceHash,
    outcome: null,
  });
}

export function spawnAttempt(attempt: AttemptState): AttemptState {
  assertAttemptState(attempt);
  if (attempt.phase !== 'CREATED') {
    invalidTransition(`Cannot spawn attempt '${attempt.attemptId}' from phase ${attempt.phase}`);
  }
  return makeAttemptState({ ...attempt, phase: 'SPAWNING' });
}

export function failSpawnAttempt(attempt: AttemptState): AttemptState {
  assertAttemptState(attempt);
  if (attempt.phase !== 'SPAWNING') {
    invalidTransition(`Cannot fail spawn attempt '${attempt.attemptId}' from phase ${attempt.phase}`);
  }
  return makeAttemptState({ ...attempt, phase: 'SPAWN_FAILED', outcome: 'FAILED' });
}

export function runAttempt(attempt: AttemptState): AttemptState {
  assertAttemptState(attempt);
  if (attempt.phase !== 'SPAWNING') {
    invalidTransition(`Cannot run attempt '${attempt.attemptId}' from phase ${attempt.phase}`);
  }
  return makeAttemptState({ ...attempt, phase: 'RUNNING' });
}

export function settleAttempt(
  attempt: AttemptState,
  outcome: Exclude<AttemptOutcome, null>,
): AttemptState {
  assertAttemptState(attempt);
  if (attempt.phase !== 'RUNNING') {
    invalidTransition(`Cannot settle attempt '${attempt.attemptId}' from phase ${attempt.phase}`);
  }
  return makeAttemptState({ ...attempt, phase: 'SETTLED', outcome });
}

export function beginDisposeAttempt(attempt: AttemptState): AttemptState {
  assertAttemptState(attempt);
  if (attempt.phase !== 'SETTLED') {
    invalidTransition(
      `Cannot dispose attempt '${attempt.attemptId}' before it is settled (current phase ${attempt.phase})`,
    );
  }
  return makeAttemptState({ ...attempt, phase: 'DISPOSING' });
}

export function completeDisposeAttempt(attempt: AttemptState): AttemptState {
  assertAttemptState(attempt);
  if (attempt.phase !== 'DISPOSING') {
    invalidTransition(
      `Cannot complete dispose attempt '${attempt.attemptId}' from phase ${attempt.phase}`,
    );
  }
  return makeAttemptState({ ...attempt, phase: 'DISPOSED' });
}
