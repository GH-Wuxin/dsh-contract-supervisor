export declare const FS_ERROR_CODES: {
    readonly SLICE_READ_SCOPE_VIOLATION: 'SLICE_READ_SCOPE_VIOLATION';
    readonly SLICE_WRITE_SCOPE_VIOLATION: 'SLICE_WRITE_SCOPE_VIOLATION';
    readonly SYMLINK_POLICY_BLOCK: 'SYMLINK_POLICY_BLOCK';
    readonly TARGET_IDENTITY_UNSAFE: 'TARGET_IDENTITY_UNSAFE';
    readonly SLICE_EDIT_MISMATCH: 'SLICE_EDIT_MISMATCH';
    readonly FILESYSTEM_OPERATION_FAILED: 'FILESYSTEM_OPERATION_FAILED';
    readonly FS_INVALID_ARGUMENT: 'FS_INVALID_ARGUMENT';
    readonly FS_AUTHORITY_CONFIG_INVALID: 'FS_AUTHORITY_CONFIG_INVALID';
    readonly FS_SESSION_UNKNOWN: 'FS_SESSION_UNKNOWN';
    readonly FS_SESSION_RELEASED: 'FS_SESSION_RELEASED';
    readonly FS_SESSION_ALREADY_BOUND: 'FS_SESSION_ALREADY_BOUND';
};
export type FsErrorCode = (typeof FS_ERROR_CODES)[keyof typeof FS_ERROR_CODES];
/**
 * The exact Supervisor-owned filesystem authority violations. Recording one of
 * these against the current session/Attempt is what monotonically invalidates
 * the Attempt in the S4 coordinator. Generic operational failures never enter
 * this set.
 */
export declare const TRUSTED_FS_VIOLATION_CODES: readonly FsErrorCode[];
export declare function isTrustedFsViolationCode(code: string): boolean;
export declare class FsError extends Error {
    readonly code: FsErrorCode;
    constructor(code: FsErrorCode, message: string);
}
export { FsError as SliceFsError };
//# sourceMappingURL=errors.d.ts.map