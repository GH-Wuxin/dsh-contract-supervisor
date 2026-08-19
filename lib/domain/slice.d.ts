import type { SliceData, SliceInput, WriteAuthorityRule } from './types.js';
export declare function normalizeSliceInput(input: SliceInput): SliceData;
export declare class FrozenSlice {
    readonly sliceId: string;
    readonly contractHash: string;
    readonly parentCheckpointHash: string;
    readonly objective: string;
    readonly postcondition: string;
    readonly allowedReads: readonly string[];
    readonly allowedWrites: readonly WriteAuthorityRule[];
    readonly frozenApiRefs: readonly string[];
    readonly invariantRefs: readonly string[];
    readonly prohibitionRefs: readonly string[];
    readonly verifierRefs: readonly string[];
    readonly regressionVerifierRefs: readonly string[];
    readonly workerToolAllowlist: readonly string[];
    readonly maxAttempts: number;
    readonly wallTimeout: number;
    readonly turnBudget: number | null;
    readonly sliceHash: string;
    get hash(): string;
    private constructor();
    static create(input: SliceInput): FrozenSlice;
    toObject(): SliceData;
}
//# sourceMappingURL=slice.d.ts.map