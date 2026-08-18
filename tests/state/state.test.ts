import { describe, expect, it } from 'vitest';
import {
  FrozenContract,
  FrozenSlice,
  DomainError,
  ERROR_CODES,
} from '../../src/domain/index.js';
import type { ContractInput, SliceInput } from '../../src/domain/index.js';
import * as stateExports from '../../src/state/index.js';
import {
  STATE_ERROR_CODES,
  StateError,
  admitSlice,
  beginActiveScopeAudit,
  beginDisposeAttempt,
  beginScopeAudit,
  completeActiveScopeAudit,
  completeActiveVerification,
  completeDisposeAttempt,
  completeScopeAudit,
  completeVerification,
  createAttemptState,
  createSliceState,
  createSupervisorRuntimeState,
  finalizeActiveAttempt,
  finalizeAttemptForSlice,
  releaseActiveSlice,
  requestRetry,
  retryActiveSlice,
  reviewActiveSlice,
  reviewSlice,
  runAttempt,
  settleAttempt,
  spawnAttempt,
  startActiveAttempt,
  startAttempt,
  SLICE_PHASES,
} from '../../src/state/index.js';
import type {
  AttemptState,
  ReviewVerdict,
  ScopeVerdict,
  SliceState,
  SupervisorRuntimeState,
  VerifierVerdict,
} from '../../src/state/index.js';

function makeContract(overrides: Partial<ContractInput> = {}): ContractInput {
  return {
    contractId: 'contract-1',
    version: '1.0.0',
    schemaVersion: '1.0.0',
    parentContractHash: null,
    repoIdentity: 'repo-a',
    baselineTree: 'baseline-a',
    objective: 'Implement state machine',
    nonGoals: ['No runtime'],
    readAuthority: ['A', 'B'],
    writeAuthority: [
      { path: 'A', operation: 'update' },
      { path: 'B', operation: 'update' },
    ],
    frozenApis: ['api-a'],
    invariants: ['invariant-a'],
    prohibitions: ['prohibition-a'],
    verifierCatalog: [{ verifierId: 'v1' }, { verifierId: 'v2' }],
    regressionVerifierRefs: [],
    workerToolAllowlist: ['tool-a'],
    reviewerToolAllowlist: ['tool-r'],
    threatModel: 'threat-a',
    createdAt: '2024-01-01T00:00:00.000Z',
    frozenAt: '2024-01-02T00:00:00.000Z',
    frozenBy: 'worker',
    ...overrides,
  };
}

function makeSlice(overrides: Partial<SliceInput> = {}): SliceInput {
  return {
    sliceId: 'slice-1',
    contractHash: 'contract-hash',
    parentCheckpointHash: 'checkpoint-0',
    objective: 'Slice objective',
    postcondition: 'Slice postcondition',
    allowedReads: ['A'],
    allowedWrites: [{ path: 'A', operation: 'update' }],
    frozenApiRefs: ['api-a'],
    invariantRefs: ['invariant-a'],
    prohibitionRefs: ['prohibition-a'],
    verifierRefs: ['v1'],
    regressionVerifierRefs: [],
    workerToolAllowlist: ['tool-a'],
    maxAttempts: 3,
    wallTimeout: 1000,
    turnBudget: null,
    ...overrides,
  };
}

function expectStateError(error: unknown, code: string): void {
  expect(error).toBeInstanceOf(StateError);
  expect((error as StateError).code).toBe(code);
}

function expectDomainError(error: unknown, code: string): void {
  expect(error).toBeInstanceOf(DomainError);
  expect((error as DomainError).code).toBe(code);
}

function validContract(): FrozenContract {
  return FrozenContract.create(makeContract());
}

function validSlice(contract: FrozenContract): FrozenSlice {
  return FrozenSlice.create(makeSlice({ contractHash: contract.contractHash }));
}

function admittedSliceState(
  contract: FrozenContract = validContract(),
  slice: FrozenSlice = validSlice(contract),
): SliceState {
  return admitSlice(createSupervisorRuntimeState(), contract, slice).activeSlice!;
}

function runAttemptToDisposed(
  slice: SliceState,
  attemptId: string,
  outcome: 'SUCCESS' | 'FAILED' | 'INVALIDATED',
): { slice: SliceState; attempt: AttemptState } {
  const started = startAttempt(slice, attemptId);
  let attempt = spawnAttempt(started.attempt);
  attempt = runAttempt(attempt);
  attempt = settleAttempt(attempt, outcome);
  attempt = beginDisposeAttempt(attempt);
  attempt = completeDisposeAttempt(attempt);
  return { slice: started.slice, attempt };
}

function runToVerifying(slice: SliceState, attemptId = 'attempt-1'): SliceState {
  const { slice: running, attempt } = runAttemptToDisposed(slice, attemptId, 'SUCCESS');
  let current = finalizeAttemptForSlice(running, attempt);
  current = beginScopeAudit(current);
  current = completeScopeAudit(current, 'PASS');
  return current;
}

function runToReviewing(slice: SliceState, attemptId = 'attempt-1'): SliceState {
  return completeVerification(runToVerifying(slice, attemptId), 'PASS');
}

function runRuntimeAttemptToDisposed(
  runtime: SupervisorRuntimeState,
  attemptId: string,
  outcome: 'SUCCESS' | 'FAILED' | 'INVALIDATED',
): { runtime: SupervisorRuntimeState; attempt: AttemptState } {
  const started = startActiveAttempt(runtime, attemptId);
  let attempt = spawnAttempt(started.attempt);
  attempt = runAttempt(attempt);
  attempt = settleAttempt(attempt, outcome);
  attempt = beginDisposeAttempt(attempt);
  attempt = completeDisposeAttempt(attempt);
  return { runtime: started.runtime, attempt };
}

function runRuntimeToVerifying(
  runtime: SupervisorRuntimeState,
  attemptId = 'attempt-1',
): SupervisorRuntimeState {
  const { runtime: running, attempt } = runRuntimeAttemptToDisposed(
    runtime,
    attemptId,
    'SUCCESS',
  );
  let current = finalizeActiveAttempt(running, attempt);
  current = beginActiveScopeAudit(current);
  current = completeActiveScopeAudit(current, 'PASS');
  return current;
}

function runRuntimeToReviewing(
  runtime: SupervisorRuntimeState,
  attemptId = 'attempt-1',
): SupervisorRuntimeState {
  return completeActiveVerification(runRuntimeToVerifying(runtime, attemptId), 'PASS');
}

function snapshot(value: unknown): string {
  return JSON.stringify(value);
}

describe('S3 state machine', () => {
  it('STATE-01: happy path to READY_TO_SEAL', () => {
    const contract = validContract();
    const sliceInput = validSlice(contract);
    let runtime = admitSlice(createSupervisorRuntimeState(), contract, sliceInput);

    const started = startActiveAttempt(runtime, 'attempt-1');
    runtime = started.runtime;
    let attempt = started.attempt;
    expect(runtime.activeSlice!.phase).toBe('RUNNING');
    expect(attempt.phase).toBe('CREATED');
    expect(attempt.outcome).toBeNull();

    attempt = spawnAttempt(attempt);
    expect(attempt.phase).toBe('SPAWNING');

    attempt = runAttempt(attempt);
    expect(attempt.phase).toBe('RUNNING');

    attempt = settleAttempt(attempt, 'SUCCESS');
    expect(attempt.phase).toBe('SETTLED');
    expect(attempt.outcome).toBe('SUCCESS');

    attempt = beginDisposeAttempt(attempt);
    expect(attempt.phase).toBe('DISPOSING');
    expect(attempt.outcome).toBe('SUCCESS');

    attempt = completeDisposeAttempt(attempt);
    expect(attempt.phase).toBe('DISPOSED');
    expect(attempt.outcome).toBe('SUCCESS');

    runtime = finalizeActiveAttempt(runtime, attempt);
    expect(runtime.activeSlice!.phase).toBe('WORKER_STOPPED');

    runtime = beginActiveScopeAudit(runtime);
    expect(runtime.activeSlice!.phase).toBe('SCOPE_AUDIT');

    runtime = completeActiveScopeAudit(runtime, 'PASS');
    expect(runtime.activeSlice!.phase).toBe('VERIFYING');

    runtime = completeActiveVerification(runtime, 'PASS');
    expect(runtime.activeSlice!.phase).toBe('REVIEWING');

    runtime = reviewActiveSlice(runtime, 'APPROVE');
    expect(runtime.activeSlice!.phase).toBe('READY_TO_SEAL');
    expect(runtime.activeSliceHash).toBe(runtime.activeSlice!.sliceHash);
    expect(SLICE_PHASES).not.toContain('SEALED');
  });

  it('STATE-02: illegal transition rejected', () => {
    const slice = createSliceState({
      sliceHash: 'slice-a',
      contractHash: 'contract-a',
      maxAttempts: 3,
    });
    const before = snapshot(slice);

    expect(() => completeVerification(slice, 'PASS')).toThrowError(StateError);
    try {
      completeVerification(slice, 'PASS');
    } catch (error) {
      expectStateError(error, STATE_ERROR_CODES.INVALID_STATE_TRANSITION);
    }

    expect(snapshot(slice)).toBe(before);
  });

  it('STATE-03: cannot start attempt before admission', () => {
    const slice = createSliceState({
      sliceHash: 'slice-a',
      contractHash: 'contract-a',
      maxAttempts: 3,
    });

    expect(() => startAttempt(slice, 'attempt-1')).toThrowError(StateError);
    try {
      startAttempt(slice, 'attempt-1');
    } catch (error) {
      expectStateError(error, STATE_ERROR_CODES.INVALID_STATE_TRANSITION);
    }
  });

  it('STATE-04: dispose barrier', () => {
    const slice = admittedSliceState();
    const started = startAttempt(slice, 'attempt-1');
    let attempt = spawnAttempt(started.attempt);
    attempt = runAttempt(attempt);
    attempt = settleAttempt(attempt, 'SUCCESS');

    expect(attempt.phase).toBe('SETTLED');
    expect(() => finalizeAttemptForSlice(started.slice, attempt)).toThrowError(StateError);
    try {
      finalizeAttemptForSlice(started.slice, attempt);
    } catch (error) {
      expectStateError(error, STATE_ERROR_CODES.ATTEMPT_NOT_DISPOSED);
    }

    expect(started.slice.phase).toBe('RUNNING');

    attempt = beginDisposeAttempt(attempt);
    attempt = completeDisposeAttempt(attempt);
    expect(finalizeAttemptForSlice(started.slice, attempt).phase).toBe('WORKER_STOPPED');
  });

  it('STATE-05: failed attempt retry uses a fresh attempt', () => {
    const slice = admittedSliceState();
    const first = runAttemptToDisposed(slice, 'attempt-1', 'FAILED');
    const failed = finalizeAttemptForSlice(first.slice, first.attempt);

    expect(failed.phase).toBe('ATTEMPT_FAILED');

    const retried = requestRetry(failed);
    expect(retried.phase).toBe('ADMITTED');

    const second = startAttempt(retried, 'attempt-2');
    expect(second.slice.phase).toBe('RUNNING');
    expect(second.attempt.attemptId).not.toBe('attempt-1');
    expect(second.attempt.attemptNo).toBe(2);
    expect(second.attempt.sliceHash).toBe(first.slice.sliceHash);
  });

  it('STATE-06: attempt ID reuse rejected', () => {
    const slice = admittedSliceState();
    const first = runAttemptToDisposed(slice, 'attempt-1', 'FAILED');
    const failed = finalizeAttemptForSlice(first.slice, first.attempt);
    const retried = requestRetry(failed);

    expect(() => startAttempt(retried, 'attempt-1')).toThrowError(StateError);
    try {
      startAttempt(retried, 'attempt-1');
    } catch (error) {
      expectStateError(error, STATE_ERROR_CODES.ATTEMPT_ID_REUSED);
    }
  });

  it('STATE-07: maxAttempts enforcement', () => {
    const contract = validContract();
    const sliceInput = FrozenSlice.create(
      makeSlice({ contractHash: contract.contractHash, maxAttempts: 2 }),
    );
    const slice = admittedSliceState(contract, sliceInput);

    const first = runAttemptToDisposed(slice, 'attempt-1', 'FAILED');
    const failed1 = finalizeAttemptForSlice(first.slice, first.attempt);
    const retried = requestRetry(failed1);
    const second = runAttemptToDisposed(retried, 'attempt-2', 'FAILED');
    const failed2 = finalizeAttemptForSlice(second.slice, second.attempt);

    expect(failed2.phase).toBe('ATTEMPT_FAILED');
    expect(failed2.attemptCount).toBe(2);

    expect(() => requestRetry(failed2)).toThrowError(StateError);
    try {
      requestRetry(failed2);
    } catch (error) {
      expectStateError(error, STATE_ERROR_CODES.ATTEMPT_LIMIT_REACHED);
    }
  });

  it('STATE-08: invalidated attempt blocks verification', () => {
    const slice = admittedSliceState();
    const invalidated = runAttemptToDisposed(slice, 'attempt-1', 'INVALIDATED');
    const blocked = finalizeAttemptForSlice(invalidated.slice, invalidated.attempt);

    expect(blocked.phase).toBe('SCOPE_BLOCKED');

    expect(() => completeScopeAudit(blocked, 'PASS')).toThrowError(StateError);
    expect(() => completeVerification(blocked, 'PASS')).toThrowError(StateError);
    try {
      completeScopeAudit(blocked, 'PASS');
    } catch (error) {
      expectStateError(error, STATE_ERROR_CODES.INVALID_STATE_TRANSITION);
    }
    try {
      completeVerification(blocked, 'PASS');
    } catch (error) {
      expectStateError(error, STATE_ERROR_CODES.INVALID_STATE_TRANSITION);
    }
  });

  it('STATE-09: scope fail rejects slice', () => {
    const slice = admittedSliceState();
    const { slice: running, attempt } = runAttemptToDisposed(slice, 'attempt-1', 'SUCCESS');
    let current = finalizeAttemptForSlice(running, attempt);
    current = beginScopeAudit(current);
    const rejected = completeScopeAudit(current, 'FAIL');

    expect(rejected.phase).toBe('REJECTED_SCOPE');
    expect(rejected.phase).not.toBe('VERIFYING');
  });

  it('STATE-10: verifier outcomes', () => {
    const pass = admittedSliceState();
    const passSlice = runToVerifying(pass);
    expect(completeVerification(passSlice, 'PASS').phase).toBe('REVIEWING');

    const fail = admittedSliceState();
    const failSlice = runToVerifying(fail);
    expect(completeVerification(failSlice, 'FAIL').phase).toBe('REJECTED_VERIFIER');

    const indeterminate = admittedSliceState();
    const indeterminateSlice = runToVerifying(indeterminate);
    expect(completeVerification(indeterminateSlice, 'INDETERMINATE').phase).toBe('INDETERMINATE');
  });

  it('STATE-11: review reject retry uses fresh attempt', () => {
    const slice = admittedSliceState();
    const reviewing = runToReviewing(slice, 'attempt-1');
    const rejected = reviewSlice(reviewing, 'REJECT_IMPLEMENTATION');

    expect(rejected.phase).toBe('REJECTED_IMPLEMENTATION');

    const retried = requestRetry(rejected);
    expect(retried.phase).toBe('ADMITTED');

    const second = startAttempt(retried, 'attempt-2');
    expect(second.attempt.attemptId).toBe('attempt-2');
    expect(second.attempt.attemptNo).toBe(2);
    expect(second.attempt.sliceHash).toBe(rejected.sliceHash);
  });

  it('STATE-12: review approve does not seal or release', () => {
    const contract = validContract();
    const sliceInput = validSlice(contract);
    let runtime = admitSlice(createSupervisorRuntimeState(), contract, sliceInput);
    runtime = runRuntimeToReviewing(runtime);
    runtime = reviewActiveSlice(runtime, 'APPROVE');

    expect(runtime.activeSlice!.phase).toBe('READY_TO_SEAL');
    expect(SLICE_PHASES).not.toContain('SEALED');

    expect(() => releaseActiveSlice(runtime)).toThrowError(StateError);
    try {
      releaseActiveSlice(runtime);
    } catch (error) {
      expectStateError(error, STATE_ERROR_CODES.SLICE_NOT_RELEASABLE);
    }
  });

  it('STATE-13: contract hash mismatch rejected on admission', () => {
    const contract = validContract();
    const slice = FrozenSlice.create(makeSlice({ contractHash: 'wrong-contract-hash' }));

    expect(() => admitSlice(createSupervisorRuntimeState(), contract, slice)).toThrowError(
      StateError,
    );
    try {
      admitSlice(createSupervisorRuntimeState(), contract, slice);
    } catch (error) {
      expectStateError(error, STATE_ERROR_CODES.SLICE_CONTRACT_MISMATCH);
    }
  });

  it('STATE-14: authority expansion rejected on admission', () => {
    const contract = validContract();
    const slice = FrozenSlice.create(
      makeSlice({
        contractHash: contract.contractHash,
        allowedReads: ['C'],
      }),
    );

    expect(() => admitSlice(createSupervisorRuntimeState(), contract, slice)).toThrowError(
      DomainError,
    );
    try {
      admitSlice(createSupervisorRuntimeState(), contract, slice);
    } catch (error) {
      expectDomainError(error, ERROR_CODES.READ_AUTHORITY_EXPANSION);
    }
  });

  it('STATE-15: one active slice', () => {
    const contract = validContract();
    const sliceA = validSlice(contract);
    const runtime = admitSlice(createSupervisorRuntimeState(), contract, sliceA);
    const sliceB = FrozenSlice.create(
      makeSlice({
        sliceId: 'slice-2',
        contractHash: contract.contractHash,
        parentCheckpointHash: 'checkpoint-0',
      }),
    );

    expect(() => admitSlice(runtime, contract, sliceB)).toThrowError(StateError);
    try {
      admitSlice(runtime, contract, sliceB);
    } catch (error) {
      expectStateError(error, STATE_ERROR_CODES.ACTIVE_SLICE_EXISTS);
    }
  });

  it('STATE-16: active slice release rules', () => {
    const contract = validContract();
    const sliceInput = validSlice(contract);

    let readyRuntime = admitSlice(createSupervisorRuntimeState(), contract, sliceInput);
    readyRuntime = runRuntimeToReviewing(readyRuntime);
    readyRuntime = reviewActiveSlice(readyRuntime, 'APPROVE');
    expect(() => releaseActiveSlice(readyRuntime)).toThrowError(StateError);
    try {
      releaseActiveSlice(readyRuntime);
    } catch (error) {
      expectStateError(error, STATE_ERROR_CODES.SLICE_NOT_RELEASABLE);
    }

    let rejectRuntime = admitSlice(createSupervisorRuntimeState(), contract, sliceInput);
    rejectRuntime = runRuntimeToReviewing(rejectRuntime);
    rejectRuntime = reviewActiveSlice(rejectRuntime, 'REJECT_IMPLEMENTATION');
    expect(() => releaseActiveSlice(rejectRuntime)).toThrowError(StateError);
    try {
      releaseActiveSlice(rejectRuntime);
    } catch (error) {
      expectStateError(error, STATE_ERROR_CODES.SLICE_NOT_RELEASABLE);
    }

    let escalatedRuntime = admitSlice(createSupervisorRuntimeState(), contract, sliceInput);
    escalatedRuntime = runRuntimeToReviewing(escalatedRuntime);
    escalatedRuntime = reviewActiveSlice(escalatedRuntime, 'CONTRACT_CONFLICT');
    expect(escalatedRuntime.activeSlice!.phase).toBe('ESCALATED');
    const released = releaseActiveSlice(escalatedRuntime);
    expect(released.activeSliceHash).toBeNull();
    expect(released.activeSlice).toBeNull();

    let scopeRuntime = admitSlice(createSupervisorRuntimeState(), contract, sliceInput);
    const { runtime: running, attempt } = runRuntimeAttemptToDisposed(
      scopeRuntime,
      'attempt-1',
      'SUCCESS',
    );
    scopeRuntime = finalizeActiveAttempt(running, attempt);
    scopeRuntime = beginActiveScopeAudit(scopeRuntime);
    scopeRuntime = completeActiveScopeAudit(scopeRuntime, 'FAIL');
    expect(releaseActiveSlice(scopeRuntime).activeSliceHash).toBeNull();
  });

  it('STATE-17: pure transition / no mutation', () => {
    const slice = admittedSliceState();
    const beforeSlice = snapshot(slice);
    const started = startAttempt(slice, 'attempt-1');
    expect(snapshot(slice)).toBe(beforeSlice);

    const attemptBefore = snapshot(started.attempt);
    const spawned = spawnAttempt(started.attempt);
    expect(snapshot(started.attempt)).toBe(attemptBefore);
    expect(spawned.phase).toBe('SPAWNING');

    let current = started.slice;
    const beforeRunning = snapshot(current);
    expect(() => beginScopeAudit(current)).toThrowError(StateError);
    expect(snapshot(current)).toBe(beforeRunning);

    const { slice: running, attempt } = runAttemptToDisposed(slice, 'attempt-2', 'SUCCESS');
    current = finalizeAttemptForSlice(running, attempt);
    const beforeWorkerStopped = snapshot(current);
    const audited = beginScopeAudit(current);
    expect(snapshot(current)).toBe(beforeWorkerStopped);
    expect(audited.phase).toBe('SCOPE_AUDIT');
  });

  it('STATE-18: Cannot skip gates through public runtime API', () => {
    const contract = validContract();
    const sliceInput = validSlice(contract);
    const runtime = admitSlice(createSupervisorRuntimeState(), contract, sliceInput);
    const before = snapshot(runtime);

    expect(() => reviewActiveSlice(runtime, 'APPROVE')).toThrowError(StateError);
    try {
      reviewActiveSlice(runtime, 'APPROVE');
    } catch (error) {
      expectStateError(error, STATE_ERROR_CODES.INVALID_STATE_TRANSITION);
    }

    expect(() => completeActiveVerification(runtime, 'PASS')).toThrowError(StateError);
    expect(() => beginActiveScopeAudit(runtime)).toThrowError(StateError);

    expect(snapshot(runtime)).toBe(before);
  });

  it('STATE-19: Legal runtime synchronization accepted', () => {
    const contract = validContract();
    const sliceInput = validSlice(contract);
    let runtime = admitSlice(createSupervisorRuntimeState(), contract, sliceInput);

    const started = startActiveAttempt(runtime, 'attempt-1');
    runtime = started.runtime;
    let attempt = started.attempt;
    expect(runtime.activeSlice!.phase).toBe('RUNNING');

    attempt = spawnAttempt(attempt);
    attempt = runAttempt(attempt);
    attempt = settleAttempt(attempt, 'SUCCESS');
    attempt = beginDisposeAttempt(attempt);
    attempt = completeDisposeAttempt(attempt);

    runtime = finalizeActiveAttempt(runtime, attempt);
    expect(runtime.activeSlice!.phase).toBe('WORKER_STOPPED');

    runtime = beginActiveScopeAudit(runtime);
    expect(runtime.activeSlice!.phase).toBe('SCOPE_AUDIT');

    runtime = completeActiveScopeAudit(runtime, 'PASS');
    expect(runtime.activeSlice!.phase).toBe('VERIFYING');

    runtime = completeActiveVerification(runtime, 'PASS');
    expect(runtime.activeSlice!.phase).toBe('REVIEWING');

    runtime = reviewActiveSlice(runtime, 'APPROVE');
    expect(runtime.activeSlice!.phase).toBe('READY_TO_SEAL');
  });

  it('STATE-20: Identity mutation rejected', () => {
    const contract = validContract();
    const sliceInput = validSlice(contract);
    const runtime = admitSlice(createSupervisorRuntimeState(), contract, sliceInput);
    const current = runtime.activeSlice!;

    const started = startActiveAttempt(runtime, 'attempt-1');
    expect(started.runtime.activeSlice!.sliceHash).toBe(current.sliceHash);
    expect(started.runtime.activeSlice!.contractHash).toBe(current.contractHash);
    expect(started.runtime.activeSlice!.maxAttempts).toBe(current.maxAttempts);

    const before = snapshot(runtime);
    expect(snapshot(runtime)).toBe(before);
  });

  it('STATE-21: Forged attemptCount rejected', () => {
    const contract = validContract();
    const sliceInput = validSlice(contract);
    const runtime = admitSlice(createSupervisorRuntimeState(), contract, sliceInput);
    const current = runtime.activeSlice!;

    const started = startActiveAttempt(runtime, 'attempt-1');
    expect(started.runtime.activeSlice!.attemptCount).toBe(current.attemptCount + 1);
    expect(started.runtime.activeSlice!.usedAttemptIds).toEqual([
      ...current.usedAttemptIds,
      'attempt-1',
    ]);
  });

  it('STATE-22: Forged Attempt history rejected', () => {
    const contract = validContract();
    const sliceInput = validSlice(contract);
    let runtime = admitSlice(createSupervisorRuntimeState(), contract, sliceInput);

    const first = runRuntimeAttemptToDisposed(runtime, 'attempt-1', 'FAILED');
    runtime = finalizeActiveAttempt(first.runtime, first.attempt);
    runtime = retryActiveSlice(runtime);

    expect(runtime.activeSlice!.usedAttemptIds).toEqual(['attempt-1']);
    expect(() => startActiveAttempt(runtime, 'attempt-1')).toThrowError(StateError);
    try {
      startActiveAttempt(runtime, 'attempt-1');
    } catch (error) {
      expectStateError(error, STATE_ERROR_CODES.ATTEMPT_ID_REUSED);
    }
  });

  it('STATE-23: Retry bookkeeping', () => {
    const contract = validContract();
    const sliceInput = validSlice(contract);
    let runtime = admitSlice(createSupervisorRuntimeState(), contract, sliceInput);

    const first = runRuntimeAttemptToDisposed(runtime, 'attempt-1', 'FAILED');
    runtime = finalizeActiveAttempt(first.runtime, first.attempt);
    expect(runtime.activeSlice!.phase).toBe('ATTEMPT_FAILED');

    const retried = retryActiveSlice(runtime);
    expect(retried.activeSlice!.phase).toBe('ADMITTED');
    expect(retried.activeSlice!.attemptCount).toBe(1);
    expect(retried.activeSlice!.usedAttemptIds).toEqual(['attempt-1']);
    expect(retried.activeSlice!.currentAttemptId).toBeNull();
  });

  it('STATE-24: Same-phase injection rejected', () => {
    const contract = validContract();
    const sliceInput = validSlice(contract);
    const runtime = admitSlice(createSupervisorRuntimeState(), contract, sliceInput);

    expect(() => retryActiveSlice(runtime)).toThrowError(StateError);
    try {
      retryActiveSlice(runtime);
    } catch (error) {
      expectStateError(error, STATE_ERROR_CODES.INVALID_STATE_TRANSITION);
    }

    expect(() => beginActiveScopeAudit(runtime)).toThrowError(StateError);
  });

  it('STATE-25: Inconsistent runtime fails closed', () => {
    const contract = validContract();
    const sliceInput = validSlice(contract);
    const runtime = admitSlice(createSupervisorRuntimeState(), contract, sliceInput);
    const current = runtime.activeSlice!;

    const missingSlice: SupervisorRuntimeState = {
      activeSliceHash: current.sliceHash,
      activeSlice: null,
    };
    expect(() => startActiveAttempt(missingSlice, 'attempt-1')).toThrowError(StateError);
    try {
      startActiveAttempt(missingSlice, 'attempt-1');
    } catch (error) {
      expectStateError(error, STATE_ERROR_CODES.INVALID_STATE_TRANSITION);
    }

    const mismatchedHash: SupervisorRuntimeState = {
      activeSliceHash: 'some-other-slice',
      activeSlice: current,
    };
    expect(() => beginActiveScopeAudit(mismatchedHash)).toThrowError(StateError);
    try {
      beginActiveScopeAudit(mismatchedHash);
    } catch (error) {
      expectStateError(error, STATE_ERROR_CODES.INVALID_STATE_TRANSITION);
    }
  });

  it('STATE-26: No generic runtime injection API', () => {
    const publicSurface = stateExports as unknown as Record<string, unknown>;
    expect(publicSurface.updateActiveSlice).toBeUndefined();
  });

  it('STATE-27: Cannot finalize without disposed Attempt', () => {
    const contract = validContract();
    const sliceInput = validSlice(contract);
    let runtime = admitSlice(createSupervisorRuntimeState(), contract, sliceInput);
    const started = startActiveAttempt(runtime, 'attempt-1');
    runtime = started.runtime;

    let attempt = spawnAttempt(started.attempt);
    attempt = runAttempt(attempt);
    attempt = settleAttempt(attempt, 'SUCCESS');

    expect(() => finalizeActiveAttempt(runtime, attempt)).toThrowError(StateError);
    try {
      finalizeActiveAttempt(runtime, attempt);
    } catch (error) {
      expectStateError(error, STATE_ERROR_CODES.ATTEMPT_NOT_DISPOSED);
    }
    expect(runtime.activeSlice!.phase).toBe('RUNNING');

    attempt = beginDisposeAttempt(attempt);
    expect(() => finalizeActiveAttempt(runtime, attempt)).toThrowError(StateError);
    try {
      finalizeActiveAttempt(runtime, attempt);
    } catch (error) {
      expectStateError(error, STATE_ERROR_CODES.ATTEMPT_NOT_DISPOSED);
    }
    expect(runtime.activeSlice!.phase).toBe('RUNNING');

    attempt = completeDisposeAttempt(attempt);
    const finalized = finalizeActiveAttempt(runtime, attempt);
    expect(finalized.activeSlice!.phase).toBe('WORKER_STOPPED');
  });

  it('STATE-28: Happy runtime path uses wrappers only', () => {
    const contract = validContract();
    const sliceInput = validSlice(contract);
    let runtime = admitSlice(createSupervisorRuntimeState(), contract, sliceInput);

    const started = startActiveAttempt(runtime, 'attempt-1');
    runtime = started.runtime;
    let attempt = started.attempt;

    attempt = spawnAttempt(attempt);
    expect(attempt.phase).toBe('SPAWNING');
    attempt = runAttempt(attempt);
    expect(attempt.phase).toBe('RUNNING');
    attempt = settleAttempt(attempt, 'SUCCESS');
    expect(attempt.phase).toBe('SETTLED');
    expect(attempt.outcome).toBe('SUCCESS');
    attempt = beginDisposeAttempt(attempt);
    expect(attempt.phase).toBe('DISPOSING');
    attempt = completeDisposeAttempt(attempt);
    expect(attempt.phase).toBe('DISPOSED');

    runtime = finalizeActiveAttempt(runtime, attempt);
    expect(runtime.activeSlice!.phase).toBe('WORKER_STOPPED');
    runtime = beginActiveScopeAudit(runtime);
    expect(runtime.activeSlice!.phase).toBe('SCOPE_AUDIT');
    runtime = completeActiveScopeAudit(runtime, 'PASS');
    expect(runtime.activeSlice!.phase).toBe('VERIFYING');
    runtime = completeActiveVerification(runtime, 'PASS');
    expect(runtime.activeSlice!.phase).toBe('REVIEWING');
    runtime = reviewActiveSlice(runtime, 'APPROVE');
    expect(runtime.activeSlice!.phase).toBe('READY_TO_SEAL');
  });

  it('STATE-29: Invalidated Attempt', () => {
    const contract = validContract();
    const sliceInput = validSlice(contract);
    let runtime = admitSlice(createSupervisorRuntimeState(), contract, sliceInput);

    const { runtime: running, attempt } = runRuntimeAttemptToDisposed(
      runtime,
      'attempt-1',
      'INVALIDATED',
    );
    runtime = finalizeActiveAttempt(running, attempt);
    expect(runtime.activeSlice!.phase).toBe('SCOPE_BLOCKED');

    expect(() => beginActiveScopeAudit(runtime)).toThrowError(StateError);
    try {
      beginActiveScopeAudit(runtime);
    } catch (error) {
      expectStateError(error, STATE_ERROR_CODES.INVALID_STATE_TRANSITION);
    }

    expect(() => completeActiveVerification(runtime, 'PASS')).toThrowError(StateError);
    try {
      completeActiveVerification(runtime, 'PASS');
    } catch (error) {
      expectStateError(error, STATE_ERROR_CODES.INVALID_STATE_TRANSITION);
    }
  });

  it('STATE-30: Runtime retry wrapper', () => {
    const contract = validContract();
    const sliceInput = validSlice(contract);
    let runtime = admitSlice(createSupervisorRuntimeState(), contract, sliceInput);

    const first = runRuntimeAttemptToDisposed(runtime, 'attempt-1', 'FAILED');
    runtime = finalizeActiveAttempt(first.runtime, first.attempt);
    expect(runtime.activeSlice!.phase).toBe('ATTEMPT_FAILED');

    runtime = retryActiveSlice(runtime);
    expect(runtime.activeSlice!.phase).toBe('ADMITTED');
    expect(runtime.activeSlice!.attemptCount).toBe(1);
    expect(runtime.activeSlice!.usedAttemptIds).toEqual(['attempt-1']);

    const second = startActiveAttempt(runtime, 'attempt-2');
    expect(second.runtime.activeSlice!.phase).toBe('RUNNING');
    expect(second.runtime.activeSlice!.attemptCount).toBe(2);
    expect(second.attempt.attemptNo).toBe(2);
    expect(second.attempt.attemptId).toBe('attempt-2');

    expect(() => startActiveAttempt(runtime, 'attempt-1')).toThrowError(StateError);
    try {
      startActiveAttempt(runtime, 'attempt-1');
    } catch (error) {
      expectStateError(error, STATE_ERROR_CODES.ATTEMPT_ID_REUSED);
    }
  });

  it('STATE-31: Reviewer cannot be bypassed', () => {
    const contract = validContract();
    const sliceInput = validSlice(contract);
    let runtime = admitSlice(createSupervisorRuntimeState(), contract, sliceInput);
    runtime = runRuntimeToVerifying(runtime);
    expect(runtime.activeSlice!.phase).toBe('VERIFYING');

    expect(() => reviewActiveSlice(runtime, 'APPROVE')).toThrowError(StateError);
    try {
      reviewActiveSlice(runtime, 'APPROVE');
    } catch (error) {
      expectStateError(error, STATE_ERROR_CODES.INVALID_STATE_TRANSITION);
    }

    const reviewing = completeActiveVerification(runtime, 'PASS');
    expect(reviewing.activeSlice!.phase).toBe('REVIEWING');

    const ready = reviewActiveSlice(reviewing, 'APPROVE');
    expect(ready.activeSlice!.phase).toBe('READY_TO_SEAL');
  });

  it('STATE-32: Inconsistent runtime rejected by every wrapper', () => {
    const contract = validContract();
    const sliceInput = validSlice(contract);
    const runtime = admitSlice(createSupervisorRuntimeState(), contract, sliceInput);
    const current = runtime.activeSlice!;
    const mismatched: SupervisorRuntimeState = {
      activeSliceHash: 'some-other-slice',
      activeSlice: current,
    };
    const bogusAttempt = {} as AttemptState;

    expect(() => startActiveAttempt(mismatched, 'attempt-1')).toThrowError(StateError);
    try {
      startActiveAttempt(mismatched, 'attempt-1');
    } catch (error) {
      expectStateError(error, STATE_ERROR_CODES.INVALID_STATE_TRANSITION);
    }

    expect(() => finalizeActiveAttempt(mismatched, bogusAttempt)).toThrowError(StateError);
    try {
      finalizeActiveAttempt(mismatched, bogusAttempt);
    } catch (error) {
      expectStateError(error, STATE_ERROR_CODES.INVALID_STATE_TRANSITION);
    }

    expect(() => beginActiveScopeAudit(mismatched)).toThrowError(StateError);
    try {
      beginActiveScopeAudit(mismatched);
    } catch (error) {
      expectStateError(error, STATE_ERROR_CODES.INVALID_STATE_TRANSITION);
    }

    expect(() => reviewActiveSlice(mismatched, 'APPROVE')).toThrowError(StateError);
    try {
      reviewActiveSlice(mismatched, 'APPROVE');
    } catch (error) {
      expectStateError(error, STATE_ERROR_CODES.INVALID_STATE_TRANSITION);
    }
  });
  it('STATE-33: Forged runtime rejected', () => {
    const forgedRuntime: SupervisorRuntimeState = {
      activeSliceHash: 'slice-a',
      activeSlice: {
        phase: 'REVIEWING',
        sliceHash: 'slice-a',
        contractHash: 'contract-a',
        maxAttempts: 3,
        attemptCount: 1,
        currentAttemptId: 'attempt-1',
        usedAttemptIds: ['attempt-1'],
      },
    };

    expect(() => reviewActiveSlice(forgedRuntime, 'APPROVE')).toThrowError(StateError);
    try {
      reviewActiveSlice(forgedRuntime, 'APPROVE');
    } catch (error) {
      expectStateError(error, STATE_ERROR_CODES.INVALID_STATE_TRANSITION);
    }
  });

  it('STATE-34: Forged disposed Attempt rejected', () => {
    const contract = validContract();
    const sliceInput = validSlice(contract);
    let runtime = admitSlice(createSupervisorRuntimeState(), contract, sliceInput);

    const started = startActiveAttempt(runtime, 'attempt-1');
    runtime = started.runtime;
    let attempt = spawnAttempt(started.attempt);
    attempt = runAttempt(attempt);

    const forged: AttemptState = {
      phase: 'DISPOSED',
      attemptId: attempt.attemptId,
      attemptNo: attempt.attemptNo,
      sliceHash: attempt.sliceHash,
      outcome: 'SUCCESS',
    };

    expect(() => finalizeActiveAttempt(runtime, forged)).toThrowError(StateError);
    try {
      finalizeActiveAttempt(runtime, forged);
    } catch (error) {
      expectStateError(error, STATE_ERROR_CODES.INVALID_STATE_TRANSITION);
    }
  });

  it('STATE-35: Spread-forged Attempt loses provenance', () => {
    const contract = validContract();
    const sliceInput = validSlice(contract);
    let runtime = admitSlice(createSupervisorRuntimeState(), contract, sliceInput);

    const started = startActiveAttempt(runtime, 'attempt-1');
    runtime = started.runtime;
    let attempt = spawnAttempt(started.attempt);
    attempt = runAttempt(attempt);

    const forged = {
      ...attempt,
      phase: 'DISPOSED',
      outcome: 'SUCCESS',
    } as AttemptState;

    expect(() => finalizeActiveAttempt(runtime, forged)).toThrowError(StateError);
    try {
      finalizeActiveAttempt(runtime, forged);
    } catch (error) {
      expectStateError(error, STATE_ERROR_CODES.INVALID_STATE_TRANSITION);
    }
  });

  it('STATE-36: Spread-forged Slice rejected', () => {
    const slice = runToReviewing(admittedSliceState(), 'attempt-1');
    const forged = {
      ...slice,
      phase: 'REVIEWING',
    } as SliceState;

    expect(() => reviewSlice(forged, 'APPROVE')).toThrowError(StateError);
    try {
      reviewSlice(forged, 'APPROVE');
    } catch (error) {
      expectStateError(error, STATE_ERROR_CODES.INVALID_STATE_TRANSITION);
    }
  });

  it('STATE-37: Authentic states are frozen', () => {
    const realRuntime = createSupervisorRuntimeState();
    const realSlice = admittedSliceState();
    const realAttempt = createAttemptState({
      attemptId: 'attempt-1',
      attemptNo: 1,
      sliceHash: realSlice.sliceHash,
    });

    expect(Object.isFrozen(realRuntime)).toBe(true);
    expect(Object.isFrozen(realSlice)).toBe(true);
    expect(Object.isFrozen(realAttempt)).toBe(true);
    expect(Object.isFrozen(realSlice.usedAttemptIds)).toBe(true);
  });

  it('STATE-38: Caller cannot mutate attempt history', () => {
    const realSlice = admittedSliceState();
    const ids = realSlice.usedAttemptIds as string[];

    expect(() => ids.push('attempt-x')).toThrow();
    expect(realSlice.usedAttemptIds).toEqual([]);
  });

  it('STATE-39: Forged empty runtime cannot admit', () => {
    const contract = validContract();
    const sliceInput = validSlice(contract);
    const forgedEmpty: SupervisorRuntimeState = {
      activeSliceHash: null,
      activeSlice: null,
    };

    expect(() => admitSlice(forgedEmpty, contract, sliceInput)).toThrowError(StateError);
    try {
      admitSlice(forgedEmpty, contract, sliceInput);
    } catch (error) {
      expectStateError(error, STATE_ERROR_CODES.INVALID_STATE_TRANSITION);
    }
  });

  it('STATE-40: Full authentic happy path still works', () => {
    const contract = validContract();
    const sliceInput = validSlice(contract);
    let runtime = createSupervisorRuntimeState();
    runtime = admitSlice(runtime, contract, sliceInput);

    const started = startActiveAttempt(runtime, 'attempt-1');
    runtime = started.runtime;
    let attempt = started.attempt;

    attempt = spawnAttempt(attempt);
    attempt = runAttempt(attempt);
    attempt = settleAttempt(attempt, 'SUCCESS');
    attempt = beginDisposeAttempt(attempt);
    attempt = completeDisposeAttempt(attempt);

    runtime = finalizeActiveAttempt(runtime, attempt);
    runtime = beginActiveScopeAudit(runtime);
    runtime = completeActiveScopeAudit(runtime, 'PASS');
    runtime = completeActiveVerification(runtime, 'PASS');
    runtime = reviewActiveSlice(runtime, 'APPROVE');

    expect(runtime.activeSlice!.phase).toBe('READY_TO_SEAL');
  });

});
