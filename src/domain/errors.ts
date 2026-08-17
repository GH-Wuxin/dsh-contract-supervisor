export const ERROR_CODES = {
  INVALID_CANONICAL_VALUE: 'INVALID_CANONICAL_VALUE',
  INVALID_CONTRACT: 'INVALID_CONTRACT',
  INVALID_SLICE: 'INVALID_SLICE',
  READ_AUTHORITY_EXPANSION: 'READ_AUTHORITY_EXPANSION',
  WRITE_AUTHORITY_EXPANSION: 'WRITE_AUTHORITY_EXPANSION',
  UNKNOWN_VERIFIER_REF: 'UNKNOWN_VERIFIER_REF',
  WORKER_TOOL_AUTHORITY_EXPANSION: 'WORKER_TOOL_AUTHORITY_EXPANSION',
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

export class DomainError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
  }
}
