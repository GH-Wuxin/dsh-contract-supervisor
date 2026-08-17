export type WriteOperation = 'create' | 'update';

export interface WriteAuthorityRule {
  path: string;
  operation: WriteOperation;
}

export interface VerifierDescriptor {
  verifierId: string;
}

export interface ContractInput {
  contractId: string;
  version: string;
  schemaVersion: string;
  parentContractHash?: string | null;
  repoIdentity: string;
  baselineTree: string;
  objective: string;
  nonGoals: string[];
  readAuthority: string[];
  writeAuthority: WriteAuthorityRule[];
  frozenApis: string[];
  invariants: string[];
  prohibitions: string[];
  verifierCatalog: VerifierDescriptor[];
  regressionVerifierRefs: string[];
  workerToolAllowlist: string[];
  reviewerToolAllowlist: string[];
  threatModel: string;
  createdAt: string;
  frozenAt: string;
  frozenBy: string;
}

export interface SliceInput {
  sliceId: string;
  contractHash: string;
  parentCheckpointHash: string;
  objective: string;
  postcondition: string;
  allowedReads: string[];
  allowedWrites: WriteAuthorityRule[];
  frozenApiRefs: string[];
  invariantRefs: string[];
  prohibitionRefs: string[];
  verifierRefs: string[];
  regressionVerifierRefs: string[];
  workerToolAllowlist: string[];
  maxAttempts: number;
  wallTimeout: number;
  turnBudget?: number | null;
}

export type ContractData = Required<ContractInput>;

export type SliceData = Omit<SliceInput, 'turnBudget'> & {
  turnBudget: number | null;
};
