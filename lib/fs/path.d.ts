import { lstat } from 'node:fs/promises';
/**
 * Canonicalize the Supervisor-owned repository root exactly once.
 *
 * The caller's alias is resolved here; only the canonical absolute local
 * directory is returned. Subsequent alias retargeting cannot redirect
 * authorities that were frozen from this result.
 */
export declare function canonicalizeRepositoryRoot(repoRoot: string): string;
export declare function portableRelative(relativePath: string): string;
export declare function isInsideRoot(root: string, absolutePath: string): boolean;
export declare function validateRequestPath(rawPath: unknown): asserts rawPath is string;
export type RequestPathResolution = {
    readonly ok: true;
    readonly absolute: string;
    readonly relative: string;
} | {
    readonly ok: false;
    readonly outside: true;
    readonly absolute: string;
    readonly relative: string;
};
/**
 * Canonicalize a model-supplied request path against the frozen repository
 * root WITHOUT touching the filesystem in a way that follows symlinks.
 *
 * `path.resolve` removes `.`, `..` and duplicate separators and yields one
 * absolute normalized path. Containment is checked on that normalized path
 * before any lstat/open work occurs.
 */
export declare function resolveRequestPath(repoRoot: string, rawPath: unknown): RequestPathResolution;
export declare function assertInsideRoot(repoRoot: string, absolute: string): void;
export type PathInspectionMode = 'read' | 'mutate';
export interface PathInspection {
    readonly final: 'present' | 'missing';
    readonly finalStats: Awaited<ReturnType<typeof lstat>> | null;
}
/** Narrow injectable lstat seam for deterministic identity-failure tests. */
export type PathLstat = (path: string) => Promise<Awaited<ReturnType<typeof lstat>>>;
export interface PathInspectionOptions {
    /** Search collection treats any missing component as a missing rule root. */
    readonly missingComponents?: 'error' | 'missing';
}
/**
 * Walk each component from the repository root and lstat it. lstat never
 * follows a final symlink or a parent junction, so this is the S5
 * SYMLINK_POLICY_BLOCK checkpoint. The returned final lstat result is the
 * identity snapshot used for regular-file/hardlink checks.
 */
export declare function inspectPathNoSymlinksWithOps(repoRoot: string, absolute: string, mode: PathInspectionMode, lstatImpl: PathLstat, options?: PathInspectionOptions): Promise<PathInspection>;
export declare function inspectPathNoSymlinks(repoRoot: string, absolute: string, mode: PathInspectionMode): Promise<PathInspection>;
export declare function isRegularFileStats(stats: Awaited<ReturnType<typeof lstat>>): boolean;
export declare function assertSameFileIdentity(before: Awaited<ReturnType<typeof lstat>>, after: Awaited<ReturnType<typeof lstat>>): boolean;
//# sourceMappingURL=path.d.ts.map