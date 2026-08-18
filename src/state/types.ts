export const SLICE_PHASES = [
  'PROPOSED',
  'ADMITTED',
  'RUNNING',
  'WORKER_STOPPED',
  'ATTEMPT_FAILED',
  'SCOPE_BLOCKED',
  'SCOPE_AUDIT',
  'VERIFYING',
  'REVIEWING',
  'READY_TO_SEAL',
  'REJECTED_ADMISSION',
  'REJECTED_SCOPE',
  'REJECTED_VERIFIER',
  'INDETERMINATE',
  'REJECTED_IMPLEMENTATION',
  'ESCALATED',
] as const;

export type SlicePhase = (typeof SLICE_PHASES)[number];

export const ATTEMPT_PHASES = [
  'CREATED',
  'SPAWNING',
  'RUNNING',
  'SETTLED',
  'DISPOSING',
  'DISPOSED',
] as const;

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
export type ReviewVerdict =
  | 'APPROVE'
  | 'REJECT_IMPLEMENTATION'
  | 'CONTRACT_CONFLICT'
  | 'REQUIRED_SCOPE_EXPANSION'
  | 'VERIFIER_INSUFFICIENT';
