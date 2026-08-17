import { DomainError, ERROR_CODES, type ErrorCode } from './errors.js';
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

export function assertSliceAuthority(contract: ContractLike, slice: SliceLike): void {
  const readAuthority = new Set(contract.readAuthority);
  for (const read of slice.allowedReads) {
    if (!readAuthority.has(read)) {
      throw new DomainError(
        ERROR_CODES.READ_AUTHORITY_EXPANSION,
        `Slice read '${read}' is not covered by contract readAuthority`,
      );
    }
  }

  const writeAuthority = contract.writeAuthority;
  for (const rule of slice.allowedWrites) {
    const allowed = writeAuthority.some(
      (candidate) =>
        candidate.path === rule.path && candidate.operation === rule.operation,
    );
    if (!allowed) {
      throw new DomainError(
        ERROR_CODES.WRITE_AUTHORITY_EXPANSION,
        `Slice write '${rule.operation} ${rule.path}' is not covered by contract writeAuthority`,
      );
    }
  }

  const verifierIds = new Set(contract.verifierCatalog.map((verifier) => verifier.verifierId));
  for (const verifierRef of [...slice.verifierRefs, ...slice.regressionVerifierRefs]) {
    if (!verifierIds.has(verifierRef)) {
      throw new DomainError(
        ERROR_CODES.UNKNOWN_VERIFIER_REF,
        `Slice references unknown verifier '${verifierRef}'`,
      );
    }
  }

  const workerToolAllowlist = new Set(contract.workerToolAllowlist);
  for (const tool of slice.workerToolAllowlist) {
    if (!workerToolAllowlist.has(tool)) {
      throw new DomainError(
        ERROR_CODES.WORKER_TOOL_AUTHORITY_EXPANSION,
        `Slice worker tool '${tool}' is not covered by contract workerToolAllowlist`,
      );
    }
  }
}

export type AuthorityValidationResult =
  | { ok: true }
  | { ok: false; code: ErrorCode; message: string };

export function validateSliceAuthority(
  contract: ContractLike,
  slice: SliceLike,
): AuthorityValidationResult {
  try {
    assertSliceAuthority(contract, slice);
    return { ok: true };
  } catch (error) {
    if (error instanceof DomainError) {
      return { ok: false, code: error.code, message: error.message };
    }
    throw error;
  }
}
