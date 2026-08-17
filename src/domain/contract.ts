import { hashCanonical } from '../hash/canonical.js';
import { DomainError, ERROR_CODES } from './errors.js';
import { deepFreeze } from './immutable.js';
import type {
  ContractData,
  ContractInput,
  VerifierDescriptor,
  WriteAuthorityRule,
} from './types.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new DomainError(
      ERROR_CODES.INVALID_CONTRACT,
      `Contract field '${field}' must be a string`,
    );
  }
  return value;
}

function requireStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    throw new DomainError(
      ERROR_CODES.INVALID_CONTRACT,
      `Contract field '${field}' must be an array of strings`,
    );
  }
  return [...value];
}

function requireWriteAuthority(value: unknown): WriteAuthorityRule[] {
  if (!Array.isArray(value)) {
    throw new DomainError(
      ERROR_CODES.INVALID_CONTRACT,
      "Contract field 'writeAuthority' must be an array",
    );
  }
  return value.map((item) => {
    if (!isRecord(item) || typeof item.path !== 'string') {
      throw new DomainError(
        ERROR_CODES.INVALID_CONTRACT,
        "Contract writeAuthority entry must be an object with a string 'path'",
      );
    }
    if (item.operation !== 'create' && item.operation !== 'update') {
      throw new DomainError(
        ERROR_CODES.INVALID_CONTRACT,
        "Contract writeAuthority operation must be 'create' or 'update'",
      );
    }
    return {
      path: item.path,
      operation: item.operation,
    };
  });
}

function requireVerifierCatalog(value: unknown): VerifierDescriptor[] {
  if (!Array.isArray(value)) {
    throw new DomainError(
      ERROR_CODES.INVALID_CONTRACT,
      "Contract field 'verifierCatalog' must be an array",
    );
  }
  return value.map((item) => {
    if (!isRecord(item) || typeof item.verifierId !== 'string') {
      throw new DomainError(
        ERROR_CODES.INVALID_CONTRACT,
        "Contract verifierCatalog entry must have a string 'verifierId'",
      );
    }
    return { verifierId: item.verifierId };
  });
}

export function normalizeContractInput(input: ContractInput): ContractData {
  if (!isRecord(input)) {
    throw new DomainError(
      ERROR_CODES.INVALID_CONTRACT,
      'Contract input must be a plain object',
    );
  }

  const parentContractHash =
    input.parentContractHash === undefined || input.parentContractHash === null
      ? null
      : requireString(input.parentContractHash, 'parentContractHash');

  const data: ContractData = {
    contractId: requireString(input.contractId, 'contractId'),
    version: requireString(input.version, 'version'),
    schemaVersion: requireString(input.schemaVersion, 'schemaVersion'),
    parentContractHash,
    repoIdentity: requireString(input.repoIdentity, 'repoIdentity'),
    baselineTree: requireString(input.baselineTree, 'baselineTree'),
    objective: requireString(input.objective, 'objective'),
    nonGoals: requireStringArray(input.nonGoals, 'nonGoals'),
    readAuthority: requireStringArray(input.readAuthority, 'readAuthority'),
    writeAuthority: requireWriteAuthority(input.writeAuthority),
    frozenApis: requireStringArray(input.frozenApis, 'frozenApis'),
    invariants: requireStringArray(input.invariants, 'invariants'),
    prohibitions: requireStringArray(input.prohibitions, 'prohibitions'),
    verifierCatalog: requireVerifierCatalog(input.verifierCatalog),
    regressionVerifierRefs: requireStringArray(input.regressionVerifierRefs, 'regressionVerifierRefs'),
    workerToolAllowlist: requireStringArray(input.workerToolAllowlist, 'workerToolAllowlist'),
    reviewerToolAllowlist: requireStringArray(input.reviewerToolAllowlist, 'reviewerToolAllowlist'),
    threatModel: requireString(input.threatModel, 'threatModel'),
    createdAt: requireString(input.createdAt, 'createdAt'),
    frozenAt: requireString(input.frozenAt, 'frozenAt'),
    frozenBy: requireString(input.frozenBy, 'frozenBy'),
  };

  return deepFreeze(data);
}

export class FrozenContract {
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

  get hash(): string {
    return this.contractHash;
  }

  private constructor(data: ContractData, contractHash: string) {
    this.contractId = data.contractId;
    this.version = data.version;
    this.schemaVersion = data.schemaVersion;
    this.parentContractHash = data.parentContractHash;
    this.repoIdentity = data.repoIdentity;
    this.baselineTree = data.baselineTree;
    this.objective = data.objective;
    this.nonGoals = data.nonGoals;
    this.readAuthority = data.readAuthority;
    this.writeAuthority = data.writeAuthority;
    this.frozenApis = data.frozenApis;
    this.invariants = data.invariants;
    this.prohibitions = data.prohibitions;
    this.verifierCatalog = data.verifierCatalog;
    this.regressionVerifierRefs = data.regressionVerifierRefs;
    this.workerToolAllowlist = data.workerToolAllowlist;
    this.reviewerToolAllowlist = data.reviewerToolAllowlist;
    this.threatModel = data.threatModel;
    this.createdAt = data.createdAt;
    this.frozenAt = data.frozenAt;
    this.frozenBy = data.frozenBy;
    this.contractHash = contractHash;
    Object.freeze(this);
  }

  static create(input: ContractInput): FrozenContract {
    const data = normalizeContractInput(input);
    const contractHash = hashCanonical(data);
    return new FrozenContract(data, contractHash);
  }

  toObject(): ContractData {
    const data: ContractData = {
      contractId: this.contractId,
      version: this.version,
      schemaVersion: this.schemaVersion,
      parentContractHash: this.parentContractHash,
      repoIdentity: this.repoIdentity,
      baselineTree: this.baselineTree,
      objective: this.objective,
      nonGoals: [...this.nonGoals],
      readAuthority: [...this.readAuthority],
      writeAuthority: this.writeAuthority.map((rule) => ({ ...rule })),
      frozenApis: [...this.frozenApis],
      invariants: [...this.invariants],
      prohibitions: [...this.prohibitions],
      verifierCatalog: this.verifierCatalog.map((verifier) => ({ ...verifier })),
      regressionVerifierRefs: [...this.regressionVerifierRefs],
      workerToolAllowlist: [...this.workerToolAllowlist],
      reviewerToolAllowlist: [...this.reviewerToolAllowlist],
      threatModel: this.threatModel,
      createdAt: this.createdAt,
      frozenAt: this.frozenAt,
      frozenBy: this.frozenBy,
    };
    return deepFreeze(data);
  }
}
