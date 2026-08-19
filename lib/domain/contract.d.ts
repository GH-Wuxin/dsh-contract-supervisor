import type { ContractData, ContractInput, VerifierDescriptor, WriteAuthorityRule } from './types.js';
export declare function normalizeContractInput(input: ContractInput): ContractData;
export declare class FrozenContract {
    readonly contractId: string;
    readonly version: string;
    readonly schemaVersion: string;
    readonly parentContractHash: string | null;
    readonly repoIdentity: string;
    readonly baselineTree: string;
    readonly objective: string;
    readonly nonGoals: readonly string[];
    readonly readAuthority: readonly string[];
    readonly writeAuthority: readonly WriteAuthorityRule[];
    readonly frozenApis: readonly string[];
    readonly invariants: readonly string[];
    readonly prohibitions: readonly string[];
    readonly verifierCatalog: readonly VerifierDescriptor[];
    readonly regressionVerifierRefs: readonly string[];
    readonly workerToolAllowlist: readonly string[];
    readonly reviewerToolAllowlist: readonly string[];
    readonly threatModel: string;
    readonly createdAt: string;
    readonly frozenAt: string;
    readonly frozenBy: string;
    readonly contractHash: string;
    get hash(): string;
    private constructor();
    static create(input: ContractInput): FrozenContract;
    toObject(): ContractData;
}
//# sourceMappingURL=contract.d.ts.map