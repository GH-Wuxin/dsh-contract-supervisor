export const STATE_ERROR_CODES = {
  INVALID_STATE_TRANSITION: 'INVALID_STATE_TRANSITION',
  SLICE_CONTRACT_MISMATCH: 'SLICE_CONTRACT_MISMATCH',
  ACTIVE_SLICE_EXISTS: 'ACTIVE_SLICE_EXISTS',
  ATTEMPT_LIMIT_REACHED: 'ATTEMPT_LIMIT_REACHED',
  ATTEMPT_ID_REUSED: 'ATTEMPT_ID_REUSED',
  ATTEMPT_SLICE_MISMATCH: 'ATTEMPT_SLICE_MISMATCH',
  ATTEMPT_NOT_DISPOSED: 'ATTEMPT_NOT_DISPOSED',
  NO_ACTIVE_SLICE: 'NO_ACTIVE_SLICE',
  SLICE_NOT_RELEASABLE: 'SLICE_NOT_RELEASABLE',
} as const;

export type StateErrorCode =
  (typeof STATE_ERROR_CODES)[keyof typeof STATE_ERROR_CODES];

export class StateError extends Error {
  readonly code: StateErrorCode;

  constructor(code: StateErrorCode, message: string) {
    super(message);
    this.name = 'StateError';
    this.code = code;
  }
}
