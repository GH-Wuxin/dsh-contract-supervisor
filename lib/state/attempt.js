import { StateError, STATE_ERROR_CODES } from './errors.js';
const ATTEMPT_BRAND = Symbol('dsh-contract-supervisor.attemptState');
function invalidTransition(message) {
    throw new StateError(STATE_ERROR_CODES.INVALID_STATE_TRANSITION, message);
}
function isAttemptState(value) {
    return (typeof value === 'object' &&
        value !== null &&
        value[ATTEMPT_BRAND] === true);
}
export function assertAttemptState(attempt) {
    if (!isAttemptState(attempt)) {
        invalidTransition('Cannot operate on a non-authentic AttemptState');
    }
}
function makeAttemptState(fields) {
    const state = { ...fields };
    Object.defineProperty(state, ATTEMPT_BRAND, {
        value: true,
        enumerable: false,
        writable: false,
        configurable: false,
    });
    return Object.freeze(state);
}
export function createAttemptState(input) {
    return makeAttemptState({
        phase: 'CREATED',
        attemptId: input.attemptId,
        attemptNo: input.attemptNo,
        sliceHash: input.sliceHash,
        outcome: null,
    });
}
export function spawnAttempt(attempt) {
    assertAttemptState(attempt);
    if (attempt.phase !== 'CREATED') {
        invalidTransition(`Cannot spawn attempt '${attempt.attemptId}' from phase ${attempt.phase}`);
    }
    return makeAttemptState({ ...attempt, phase: 'SPAWNING' });
}
export function failSpawnAttempt(attempt) {
    assertAttemptState(attempt);
    if (attempt.phase !== 'SPAWNING') {
        invalidTransition(`Cannot fail spawn attempt '${attempt.attemptId}' from phase ${attempt.phase}`);
    }
    return makeAttemptState({ ...attempt, phase: 'SPAWN_FAILED', outcome: 'FAILED' });
}
export function runAttempt(attempt) {
    assertAttemptState(attempt);
    if (attempt.phase !== 'SPAWNING') {
        invalidTransition(`Cannot run attempt '${attempt.attemptId}' from phase ${attempt.phase}`);
    }
    return makeAttemptState({ ...attempt, phase: 'RUNNING' });
}
export function settleAttempt(attempt, outcome) {
    assertAttemptState(attempt);
    if (attempt.phase !== 'RUNNING') {
        invalidTransition(`Cannot settle attempt '${attempt.attemptId}' from phase ${attempt.phase}`);
    }
    return makeAttemptState({ ...attempt, phase: 'SETTLED', outcome });
}
export function beginDisposeAttempt(attempt) {
    assertAttemptState(attempt);
    if (attempt.phase !== 'SETTLED') {
        invalidTransition(`Cannot dispose attempt '${attempt.attemptId}' before it is settled (current phase ${attempt.phase})`);
    }
    return makeAttemptState({ ...attempt, phase: 'DISPOSING' });
}
export function completeDisposeAttempt(attempt) {
    assertAttemptState(attempt);
    if (attempt.phase !== 'DISPOSING') {
        invalidTransition(`Cannot complete dispose attempt '${attempt.attemptId}' from phase ${attempt.phase}`);
    }
    return makeAttemptState({ ...attempt, phase: 'DISPOSED' });
}
//# sourceMappingURL=attempt.js.map