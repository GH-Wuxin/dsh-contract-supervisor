import type { WriteOperation } from '../domain/types.js';
import { resolveRequestPath } from './path.js';
import type { SliceFsAuthority } from './types.js';
export interface PreparedReadRule {
    readonly raw: string;
    readonly relative: string;
    readonly key: string;
    readonly recursive: boolean;
    readonly absoluteRoot: string;
}
export interface PreparedWriteRule {
    readonly rawPath: string;
    readonly relative: string;
    readonly key: string;
    readonly operation: WriteOperation;
}
export interface PreparedSliceFsAuthority extends SliceFsAuthority {
    readonly readRules: readonly PreparedReadRule[];
    readonly writeRules: readonly PreparedWriteRule[];
    readonly recursiveReadPrefixes: readonly string[];
}
export declare function pathKey(relativePath: string): string;
export declare function isPreparedSliceFsAuthority(value: SliceFsAuthority): value is PreparedSliceFsAuthority;
/**
 * Freeze the Supervisor-owned authority that is later bound to one worker
 * session. The repo root is realpath'ed once here; audited tools never accept
 * a root from model arguments.
 */
export declare function createSliceFsAuthority(input: SliceFsAuthority): PreparedSliceFsAuthority;
export declare function isReadPathAllowed(authority: PreparedSliceFsAuthority, relativePath: string): boolean;
/**
 * Search roots may name a directory that only exists as a recursive
 * `dir/**` authority prefix. That does not make `dir/outside` readable; the
 * walk still filters every file through isReadPathAllowed.
 */
export declare function isReadSearchRootAllowed(authority: PreparedSliceFsAuthority, relativePath: string): boolean;
export declare function hasWritePath(authority: PreparedSliceFsAuthority, relativePath: string): boolean;
export declare function hasWriteOperation(authority: PreparedSliceFsAuthority, relativePath: string, operation: WriteOperation): boolean;
export declare function resolveAuthorityPath(authority: PreparedSliceFsAuthority, rawPath: unknown): ReturnType<typeof resolveRequestPath>;
//# sourceMappingURL=authority.d.ts.map