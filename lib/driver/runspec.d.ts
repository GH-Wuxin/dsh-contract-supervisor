import type { ContractInput, SliceInput } from '../domain/index.js';
export interface ParsedRunSpec {
    readonly repoRoot: string;
    readonly contractInput: ContractInput;
    /**
     * The authentic Slice creation input MINUS contractHash. The host injects the
     * derived contractHash from the created FrozenContract before FrozenSlice
     * construction, so the RunSpec cannot pin a Slice to a foreign Contract.
     */
    readonly sliceInputBase: Omit<SliceInput, 'contractHash'>;
}
/**
 * Parse and validate a RunSpec v1 document. `raw` is the parsed JSON value.
 *
 * Rejection is explicit: version mismatch, missing repoRoot, presence of any
 * rejected derived/authority field, or malformed contract/slice inputs each
 * raise a {@link DriverError} with a precise code. The host never silently
 * accepts and ignores authority-confusing fields.
 */
export declare function parseRunSpec(raw: unknown): ParsedRunSpec;
//# sourceMappingURL=runspec.d.ts.map