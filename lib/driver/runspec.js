import { DRIVER_ERROR_CODES, DriverError, REJECTED_RUNSPEC_SLICE_KEYS, REJECTED_RUNSPEC_TOP_LEVEL_KEYS, RUNSPEC_VERSION, } from './types.js';
function isPlainObject(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function rejectKeys(obj, rejected, where) {
    for (const key of rejected) {
        if (Object.prototype.hasOwnProperty.call(obj, key)) {
            throw new DriverError(DRIVER_ERROR_CODES.RUNSPEC_REJECTED_FIELD, `RunSpec ${where} must not supply derived/authority field '${key}'; it is host-derived and cannot be supplied by trusted input`);
        }
    }
}
/**
 * Parse and validate a RunSpec v1 document. `raw` is the parsed JSON value.
 *
 * Rejection is explicit: version mismatch, missing repoRoot, presence of any
 * rejected derived/authority field, or malformed contract/slice inputs each
 * raise a {@link DriverError} with a precise code. The host never silently
 * accepts and ignores authority-confusing fields.
 */
export function parseRunSpec(raw) {
    if (!isPlainObject(raw)) {
        throw new DriverError(DRIVER_ERROR_CODES.RUNSPEC_INVALID, 'RunSpec must be a plain JSON object');
    }
    // Reject authority-confusing top-level fields before anything else.
    rejectKeys(raw, REJECTED_RUNSPEC_TOP_LEVEL_KEYS, 'top level');
    const version = raw.version;
    if (version !== RUNSPEC_VERSION) {
        throw new DriverError(DRIVER_ERROR_CODES.RUNSPEC_VERSION_UNSUPPORTED, `RunSpec version must be ${RUNSPEC_VERSION}; received ${JSON.stringify(version)}`);
    }
    const repoRoot = raw.repoRoot;
    if (typeof repoRoot !== 'string' || repoRoot.length === 0) {
        throw new DriverError(DRIVER_ERROR_CODES.RUNSPEC_INVALID, "RunSpec field 'repoRoot' must be a non-empty string");
    }
    if (repoRoot.includes('\0')) {
        throw new DriverError(DRIVER_ERROR_CODES.RUNSPEC_INVALID, "RunSpec field 'repoRoot' must not contain NUL bytes");
    }
    const contractRaw = raw.contract;
    if (!isPlainObject(contractRaw)) {
        throw new DriverError(DRIVER_ERROR_CODES.RUNSPEC_INVALID, "RunSpec field 'contract' must be a plain object");
    }
    // The Contract carries no host-derived identity of its own (contractHash is
    // computed by FrozenContract.create), but reject an explicit contractHash
    // pin so a caller cannot pre-assert an identity the host must derive.
    if (Object.prototype.hasOwnProperty.call(contractRaw, 'contractHash')) {
        throw new DriverError(DRIVER_ERROR_CODES.RUNSPEC_REJECTED_FIELD, "RunSpec contract must not supply 'contractHash'; it is host-derived from authentic FrozenContract creation");
    }
    const sliceRaw = raw.slice;
    if (!isPlainObject(sliceRaw)) {
        throw new DriverError(DRIVER_ERROR_CODES.RUNSPEC_INVALID, "RunSpec field 'slice' must be a plain object");
    }
    rejectKeys(sliceRaw, REJECTED_RUNSPEC_SLICE_KEYS, 'slice');
    // Defer deep field validation to the authentic domain constructors
    // (normalizeContractInput / normalizeSliceInput). The host only strips the
    // derived contractHash seam here and re-injects it after FrozenContract
    // creation, so the RunSpec slice is structurally SliceInput minus
    // contractHash. We do NOT duplicate validation semantics.
    const contractInput = contractRaw;
    // Build the slice input base without contractHash. The presence of the
    // remaining fields is validated by FrozenSlice.create after contractHash
    // injection; here we only forward the trusted object.
    const sliceInputBase = sliceRaw;
    return Object.freeze({
        repoRoot,
        contractInput,
        sliceInputBase,
    });
}
//# sourceMappingURL=runspec.js.map