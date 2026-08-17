import { hashCanonical } from '../hash/canonical.js';
import { DomainError, ERROR_CODES } from './errors.js';
import { deepFreeze } from './immutable.js';
import type { SliceData, SliceInput, WriteAuthorityRule } from './types.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new DomainError(
      ERROR_CODES.INVALID_SLICE,
      `Slice field '${field}' must be a string`,
    );
  }
  return value;
}

function requireStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    throw new DomainError(
      ERROR_CODES.INVALID_SLICE,
      `Slice field '${field}' must be an array of strings`,
    );
  }
  return [...value];
}

function requireWriteAuthority(value: unknown): WriteAuthorityRule[] {
  if (!Array.isArray(value)) {
    throw new DomainError(
      ERROR_CODES.INVALID_SLICE,
      "Slice field 'allowedWrites' must be an array",
    );
  }
  return value.map((item) => {
    if (!isRecord(item) || typeof item.path !== 'string') {
      throw new DomainError(
        ERROR_CODES.INVALID_SLICE,
        "Slice allowedWrites entry must be an object with a string 'path'",
      );
    }
    if (item.operation !== 'create' && item.operation !== 'update') {
      throw new DomainError(
        ERROR_CODES.INVALID_SLICE,
        "Slice allowedWrites operation must be 'create' or 'update'",
      );
    }
    return {
      path: item.path,
      operation: item.operation,
    };
  });
}

function requireFiniteNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new DomainError(
      ERROR_CODES.INVALID_SLICE,
      `Slice field '${field}' must be a finite number`,
    );
  }
  return value;
}

export function normalizeSliceInput(input: SliceInput): SliceData {
  if (!isRecord(input)) {
    throw new DomainError(
      ERROR_CODES.INVALID_SLICE,
      'Slice input must be a plain object',
    );
  }

  const turnBudget =
    input.turnBudget === undefined || input.turnBudget === null
      ? null
      : requireFiniteNumber(input.turnBudget, 'turnBudget');

  const data: SliceData = {
    sliceId: requireString(input.sliceId, 'sliceId'),
    contractHash: requireString(input.contractHash, 'contractHash'),
    parentCheckpointHash: requireString(input.parentCheckpointHash, 'parentCheckpointHash'),
    objective: requireString(input.objective, 'objective'),
    postcondition: requireString(input.postcondition, 'postcondition'),
    allowedReads: requireStringArray(input.allowedReads, 'allowedReads'),
    allowedWrites: requireWriteAuthority(input.allowedWrites),
    frozenApiRefs: requireStringArray(input.frozenApiRefs, 'frozenApiRefs'),
    invariantRefs: requireStringArray(input.invariantRefs, 'invariantRefs'),
    prohibitionRefs: requireStringArray(input.prohibitionRefs, 'prohibitionRefs'),
    verifierRefs: requireStringArray(input.verifierRefs, 'verifierRefs'),
    regressionVerifierRefs: requireStringArray(input.regressionVerifierRefs, 'regressionVerifierRefs'),
    workerToolAllowlist: requireStringArray(input.workerToolAllowlist, 'workerToolAllowlist'),
    maxAttempts: requireFiniteNumber(input.maxAttempts, 'maxAttempts'),
    wallTimeout: requireFiniteNumber(input.wallTimeout, 'wallTimeout'),
    turnBudget,
  };

  return deepFreeze(data);
}

export class FrozenSlice {
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

  get hash(): string {
    return this.sliceHash;
  }

  private constructor(data: SliceData, sliceHash: string) {
    this.sliceId = data.sliceId;
    this.contractHash = data.contractHash;
    this.parentCheckpointHash = data.parentCheckpointHash;
    this.objective = data.objective;
    this.postcondition = data.postcondition;
    this.allowedReads = data.allowedReads;
    this.allowedWrites = data.allowedWrites;
    this.frozenApiRefs = data.frozenApiRefs;
    this.invariantRefs = data.invariantRefs;
    this.prohibitionRefs = data.prohibitionRefs;
    this.verifierRefs = data.verifierRefs;
    this.regressionVerifierRefs = data.regressionVerifierRefs;
    this.workerToolAllowlist = data.workerToolAllowlist;
    this.maxAttempts = data.maxAttempts;
    this.wallTimeout = data.wallTimeout;
    this.turnBudget = data.turnBudget;
    this.sliceHash = sliceHash;
    Object.freeze(this);
  }

  static create(input: SliceInput): FrozenSlice {
    const data = normalizeSliceInput(input);
    const sliceHash = hashCanonical(data);
    return new FrozenSlice(data, sliceHash);
  }

  toObject(): SliceData {
    const data: SliceData = {
      sliceId: this.sliceId,
      contractHash: this.contractHash,
      parentCheckpointHash: this.parentCheckpointHash,
      objective: this.objective,
      postcondition: this.postcondition,
      allowedReads: [...this.allowedReads],
      allowedWrites: this.allowedWrites.map((rule) => ({ ...rule })),
      frozenApiRefs: [...this.frozenApiRefs],
      invariantRefs: [...this.invariantRefs],
      prohibitionRefs: [...this.prohibitionRefs],
      verifierRefs: [...this.verifierRefs],
      regressionVerifierRefs: [...this.regressionVerifierRefs],
      workerToolAllowlist: [...this.workerToolAllowlist],
      maxAttempts: this.maxAttempts,
      wallTimeout: this.wallTimeout,
      turnBudget: this.turnBudget,
    };
    return deepFreeze(data);
  }
}
