import { describe, expect, it } from 'vitest';
import {
  ERROR_CODES,
  FrozenContract,
  FrozenSlice,
  assertSliceAuthority,
  validateSliceAuthority,
} from '../../src/domain/index.js';
import type { ContractInput, SliceInput } from '../../src/domain/index.js';

function makeContract(overrides: Partial<ContractInput> = {}): ContractInput {
  return {
    contractId: 'contract-1',
    version: '1.0.0',
    schemaVersion: '1.0.0',
    parentContractHash: null,
    repoIdentity: 'repo-a',
    baselineTree: 'baseline-a',
    objective: 'Implement S1',
    nonGoals: ['No runtime'],
    readAuthority: ['A', 'B'],
    writeAuthority: [
      { path: 'A', operation: 'update' },
      { path: 'B', operation: 'update' },
    ],
    frozenApis: ['api-a'],
    invariants: ['invariant-a'],
    prohibitions: ['prohibition-a'],
    verifierCatalog: [{ verifierId: 'v1' }, { verifierId: 'v2' }],
    regressionVerifierRefs: [],
    workerToolAllowlist: ['tool-a'],
    reviewerToolAllowlist: ['tool-r'],
    threatModel: 'threat-a',
    createdAt: '2024-01-01T00:00:00.000Z',
    frozenAt: '2024-01-02T00:00:00.000Z',
    frozenBy: 'worker',
    ...overrides,
  };
}

function makeSlice(overrides: Partial<SliceInput> = {}): SliceInput {
  return {
    sliceId: 'slice-1',
    contractHash: 'contract-hash',
    parentCheckpointHash: 'checkpoint-0',
    objective: 'Slice objective',
    postcondition: 'Slice postcondition',
    allowedReads: ['A'],
    allowedWrites: [{ path: 'A', operation: 'update' }],
    frozenApiRefs: ['api-a'],
    invariantRefs: ['invariant-a'],
    prohibitionRefs: ['prohibition-a'],
    verifierRefs: ['v1'],
    regressionVerifierRefs: [],
    workerToolAllowlist: ['tool-a'],
    maxAttempts: 3,
    wallTimeout: 1000,
    turnBudget: null,
    ...overrides,
  };
}

describe('contract identity', () => {
  it('CONTRACT-01: identical semantic contracts have the same hash', () => {
    const first = FrozenContract.create(makeContract());
    const second = FrozenContract.create(makeContract());

    expect(first.contractHash).toBe(second.contractHash);
  });

  it('CONTRACT-02: changing version changes the hash', () => {
    const original = FrozenContract.create(makeContract());
    const changed = FrozenContract.create(makeContract({ version: '2.0.0' }));

    expect(original.contractHash).not.toBe(changed.contractHash);
  });

  it('CONTRACT-03: changing any frozen semantic content changes the hash', () => {
    const original = FrozenContract.create(makeContract());
    const changed = FrozenContract.create(makeContract({ objective: 'Different objective' }));

    expect(original.contractHash).not.toBe(changed.contractHash);
  });
});

describe('slice identity', () => {
  it('SLICE-01: identical slices have the same hash', () => {
    const first = FrozenSlice.create(makeSlice());
    const second = FrozenSlice.create(makeSlice());

    expect(first.sliceHash).toBe(second.sliceHash);
  });

  it('SLICE-02: changing parentCheckpointHash changes the hash', () => {
    const original = FrozenSlice.create(makeSlice());
    const changed = FrozenSlice.create(makeSlice({ parentCheckpointHash: 'checkpoint-1' }));

    expect(original.sliceHash).not.toBe(changed.sliceHash);
  });

  it('SLICE-03: adding an allowed write changes the hash', () => {
    const original = FrozenSlice.create(makeSlice());
    const changed = FrozenSlice.create(
      makeSlice({
        allowedWrites: [
          { path: 'A', operation: 'update' },
          { path: 'B', operation: 'update' },
        ],
      }),
    );

    expect(original.sliceHash).not.toBe(changed.sliceHash);
  });
});

describe('authority subset validation', () => {
  it('AUTH-01: valid slice passes', () => {
    const contract = FrozenContract.create(makeContract());
    const slice = FrozenSlice.create(makeSlice({ contractHash: contract.contractHash }));

    expect(validateSliceAuthority(contract, slice)).toEqual({ ok: true });
    expect(() => assertSliceAuthority(contract, slice)).not.toThrow();
  });

  it('AUTH-02: write path expansion is rejected', () => {
    const contract = FrozenContract.create(makeContract());
    const slice = FrozenSlice.create(
      makeSlice({
        contractHash: contract.contractHash,
        allowedWrites: [{ path: 'C', operation: 'update' }],
      }),
    );

    const result = validateSliceAuthority(contract, slice);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe(ERROR_CODES.WRITE_AUTHORITY_EXPANSION);
    }
  });

  it('AUTH-03: write operation expansion is rejected', () => {
    const contract = FrozenContract.create(makeContract());
    const slice = FrozenSlice.create(
      makeSlice({
        contractHash: contract.contractHash,
        allowedWrites: [{ path: 'A', operation: 'create' }],
      }),
    );

    const result = validateSliceAuthority(contract, slice);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe(ERROR_CODES.WRITE_AUTHORITY_EXPANSION);
    }
  });

  it('AUTH-04: read expansion is rejected', () => {
    const contract = FrozenContract.create(makeContract());
    const slice = FrozenSlice.create(
      makeSlice({
        contractHash: contract.contractHash,
        allowedReads: ['C'],
      }),
    );

    const result = validateSliceAuthority(contract, slice);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe(ERROR_CODES.READ_AUTHORITY_EXPANSION);
    }
  });

  it('AUTH-05: unknown verifier ref is rejected', () => {
    const contract = FrozenContract.create(makeContract());
    const slice = FrozenSlice.create(
      makeSlice({
        contractHash: contract.contractHash,
        verifierRefs: ['unknown-verifier'],
      }),
    );

    const result = validateSliceAuthority(contract, slice);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe(ERROR_CODES.UNKNOWN_VERIFIER_REF);
    }
  });

  it('AUTH-05b: unknown regression verifier ref is rejected', () => {
    const contract = FrozenContract.create(makeContract());
    const slice = FrozenSlice.create(
      makeSlice({
        contractHash: contract.contractHash,
        regressionVerifierRefs: ['unknown-verifier'],
      }),
    );

    const result = validateSliceAuthority(contract, slice);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe(ERROR_CODES.UNKNOWN_VERIFIER_REF);
    }
  });

  it('AUTH-06: worker tool expansion is rejected', () => {
    const contract = FrozenContract.create(makeContract());
    const slice = FrozenSlice.create(
      makeSlice({
        contractHash: contract.contractHash,
        workerToolAllowlist: ['unknown-tool'],
      }),
    );

    const result = validateSliceAuthority(contract, slice);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe(ERROR_CODES.WORKER_TOOL_AUTHORITY_EXPANSION);
    }
  });
});

describe('immutability', () => {
  it('IMMUTABLE-01: mutating original contract input does not change frozen contract or hash', () => {
    const input = makeContract();
    const contract = FrozenContract.create(input);
    const originalHash = contract.contractHash;

    input.nonGoals.push('mutated');
    input.readAuthority.push('C');
    input.writeAuthority[0].path = 'mutated.ts';
    input.verifierCatalog[0].verifierId = 'mutated-verifier';

    expect(contract.nonGoals).not.toContain('mutated');
    expect(contract.readAuthority).not.toContain('C');
    expect(contract.writeAuthority[0].path).toBe('A');
    expect(contract.verifierCatalog[0].verifierId).toBe('v1');
    expect(contract.contractHash).toBe(originalHash);
  });

  it('IMMUTABLE-02: mutating original slice input does not change frozen slice or hash', () => {
    const input = makeSlice();
    const slice = FrozenSlice.create(input);
    const originalHash = slice.sliceHash;

    input.allowedReads.push('B');
    input.allowedWrites[0].path = 'B';
    input.verifierRefs.push('v2');

    expect(slice.allowedReads).not.toContain('B');
    expect(slice.allowedWrites[0].path).toBe('A');
    expect(slice.verifierRefs).not.toContain('v2');
    expect(slice.sliceHash).toBe(originalHash);
  });

  it('IMMUTABLE-03: frozen contract nested state cannot be mutated', () => {
    const contract = FrozenContract.create(makeContract());
    const originalHash = contract.contractHash;

    expect(() => {
      (contract.nonGoals as unknown as string[]).push('mutated');
    }).toThrow();
    expect(contract.nonGoals).not.toContain('mutated');

    expect(() => {
      (contract.writeAuthority[0] as unknown as { path: string }).path = 'mutated.ts';
    }).toThrow();
    expect(contract.writeAuthority[0].path).toBe('A');

    expect(contract.contractHash).toBe(originalHash);
  });

  it('IMMUTABLE-03b: frozen slice nested state cannot be mutated', () => {
    const slice = FrozenSlice.create(makeSlice());
    const originalHash = slice.sliceHash;

    expect(() => {
      (slice.allowedReads as unknown as string[]).push('B');
    }).toThrow();
    expect(slice.allowedReads).not.toContain('B');

    expect(() => {
      (slice.allowedWrites[0] as unknown as { path: string }).path = 'B';
    }).toThrow();
    expect(slice.allowedWrites[0].path).toBe('A');

    expect(slice.sliceHash).toBe(originalHash);
  });
});
