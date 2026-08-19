import { type ErrorCode } from './errors.js';
import type { VerifierDescriptor, WriteAuthorityRule } from './types.js';
type ContractLike = {
    readonly readAuthority: readonly string[];
    readonly writeAuthority: readonly WriteAuthorityRule[];
    readonly verifierCatalog: readonly VerifierDescriptor[];
    readonly workerToolAllowlist: readonly string[];
};
type SliceLike = {
    readonly allowedReads: readonly string[];
    readonly allowedWrites: readonly WriteAuthorityRule[];
    readonly verifierRefs: readonly string[];
    readonly regressionVerifierRefs: readonly string[];
    readonly workerToolAllowlist: readonly string[];
};
export declare function assertSliceAuthority(contract: ContractLike, slice: SliceLike): void;
export type AuthorityValidationResult = {
    ok: true;
} | {
    ok: false;
    code: ErrorCode;
    message: string;
};
export declare function validateSliceAuthority(contract: ContractLike, slice: SliceLike): AuthorityValidationResult;
export {};
//# sourceMappingURL=authority.d.ts.map