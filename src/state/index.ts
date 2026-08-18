export { STATE_ERROR_CODES, StateError } from './errors.js';
export type { StateErrorCode } from './errors.js';
export {
  SLICE_PHASES,
  ATTEMPT_PHASES,
} from './types.js';
export type {
  AttemptOutcome,
  AttemptPhase,
  AttemptState,
  ReviewVerdict,
  ScopeVerdict,
  SlicePhase,
  SliceState,
  SupervisorRuntimeState,
  VerifierVerdict,
} from './types.js';
export {
  createAttemptState,
  spawnAttempt,
  failSpawnAttempt,
  runAttempt,
  settleAttempt,
  beginDisposeAttempt,
  completeDisposeAttempt,
} from './attempt.js';
export type { CreateAttemptInput } from './attempt.js';
export {
  createSliceState,
  rejectAdmission,
  startAttempt,
  requestRetry,
  finalizeAttemptForSlice,
  beginScopeAudit,
  completeScopeAudit,
  completeVerification,
  reviewSlice,
} from './slice.js';
export type { CreateSliceStateInput } from './slice.js';
export {
  createSupervisorRuntimeState,
  admitSlice,
  startActiveAttempt,
  finalizeActiveAttempt,
  beginActiveScopeAudit,
  completeActiveScopeAudit,
  completeActiveVerification,
  reviewActiveSlice,
  retryActiveSlice,
  releaseActiveSlice,
  isReleasablePhase,
} from './supervisor.js';
export type {
  AdmissibleContract,
  AdmissibleSlice,
} from './supervisor.js';
