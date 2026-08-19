export const FS_ERROR_CODES = {
  SLICE_READ_SCOPE_VIOLATION: 'SLICE_READ_SCOPE_VIOLATION',
  SLICE_WRITE_SCOPE_VIOLATION: 'SLICE_WRITE_SCOPE_VIOLATION',
  SYMLINK_POLICY_BLOCK: 'SYMLINK_POLICY_BLOCK',
  TARGET_IDENTITY_UNSAFE: 'TARGET_IDENTITY_UNSAFE',
  SLICE_EDIT_MISMATCH: 'SLICE_EDIT_MISMATCH',
  FILESYSTEM_OPERATION_FAILED: 'FILESYSTEM_OPERATION_FAILED',
  FS_INVALID_ARGUMENT: 'FS_INVALID_ARGUMENT',
  FS_AUTHORITY_CONFIG_INVALID: 'FS_AUTHORITY_CONFIG_INVALID',
  FS_SESSION_UNKNOWN: 'FS_SESSION_UNKNOWN',
  FS_SESSION_RELEASED: 'FS_SESSION_RELEASED',
  FS_SESSION_ALREADY_BOUND: 'FS_SESSION_ALREADY_BOUND',
} as const;

export type FsErrorCode = (typeof FS_ERROR_CODES)[keyof typeof FS_ERROR_CODES];

/**
 * The exact Supervisor-owned filesystem authority violations. Recording one of
 * these against the current session/Attempt is what monotonically invalidates
 * the Attempt in the S4 coordinator. Generic operational failures never enter
 * this set.
 */
export const TRUSTED_FS_VIOLATION_CODES: readonly FsErrorCode[] = Object.freeze([
  FS_ERROR_CODES.SLICE_READ_SCOPE_VIOLATION,
  FS_ERROR_CODES.SLICE_WRITE_SCOPE_VIOLATION,
  FS_ERROR_CODES.SYMLINK_POLICY_BLOCK,
  FS_ERROR_CODES.TARGET_IDENTITY_UNSAFE,
]);

export function isTrustedFsViolationCode(code: string): boolean {
  return TRUSTED_FS_VIOLATION_CODES.includes(code as FsErrorCode);
}

export class FsError extends Error {
  readonly code: FsErrorCode;

  constructor(code: FsErrorCode, message: string) {
    super(message);
    this.name = 'FsError';
    this.code = code;
  }
}

export { FsError as SliceFsError };
