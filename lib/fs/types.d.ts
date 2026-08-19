import type { WriteAuthorityRule } from '../domain/types.js';
/**
 * Supervisor-owned filesystem authority for one active Attempt.
 *
 * The repository root and Slice paths are frozen here by the Supervisor. A
 * worker model never supplies this object and no tool argument can replace it.
 */
export interface SliceFsAuthority {
    readonly repoRoot: string;
    readonly sliceId: string;
    readonly allowedReads: readonly string[];
    readonly allowedWrites: readonly WriteAuthorityRule[];
}
export interface SliceReadRequest {
    readonly path: string;
}
export interface SliceWriteRequest {
    readonly path: string;
    readonly content: string;
}
export interface SliceEditRequest {
    readonly path: string;
    readonly oldText: string;
    readonly newText: string;
}
export interface SliceSearchRequest {
    /**
     * Optional trusted search root. When omitted the search operates over every
     * path currently granted by the binding's allowedReads, and only over that
     * set. A model-supplied path can narrow that set but can never widen it.
     */
    readonly path?: string;
    readonly pattern: string;
}
export interface SliceFsReadResult {
    readonly path: string;
    readonly content: string;
}
export interface SliceFsWriteResult {
    readonly path: string;
    readonly written: true;
    readonly bytes: number;
    readonly created: boolean;
}
export interface SliceFsEditResult {
    readonly path: string;
    readonly replaced: true;
    readonly occurrences: 1;
    readonly bytes: number;
}
export interface SliceFsSearchMatch {
    readonly path: string;
    readonly line: number;
    readonly column: number;
    readonly lineText: string;
}
export interface SliceFsSearchResult {
    readonly pattern: string;
    readonly filesSearched: number;
    readonly matches: SliceFsSearchMatch[];
}
//# sourceMappingURL=types.d.ts.map