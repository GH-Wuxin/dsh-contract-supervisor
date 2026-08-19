import { hashCanonical } from '../hash/canonical.js';
import { DomainError, ERROR_CODES } from './errors.js';
import { deepFreeze } from './immutable.js';
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function requireString(value, field) {
    if (typeof value !== 'string') {
        throw new DomainError(ERROR_CODES.INVALID_SLICE, `Slice field '${field}' must be a string`);
    }
    return value;
}
function requireStringArray(value, field) {
    if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
        throw new DomainError(ERROR_CODES.INVALID_SLICE, `Slice field '${field}' must be an array of strings`);
    }
    return [...value];
}
function requireWriteAuthority(value) {
    if (!Array.isArray(value)) {
        throw new DomainError(ERROR_CODES.INVALID_SLICE, "Slice field 'allowedWrites' must be an array");
    }
    return value.map((item) => {
        if (!isRecord(item) || typeof item.path !== 'string') {
            throw new DomainError(ERROR_CODES.INVALID_SLICE, "Slice allowedWrites entry must be an object with a string 'path'");
        }
        if (item.operation !== 'create' && item.operation !== 'update') {
            throw new DomainError(ERROR_CODES.INVALID_SLICE, "Slice allowedWrites operation must be 'create' or 'update'");
        }
        return {
            path: item.path,
            operation: item.operation,
        };
    });
}
function requireFiniteNumber(value, field) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new DomainError(ERROR_CODES.INVALID_SLICE, `Slice field '${field}' must be a finite number`);
    }
    return value;
}
export function normalizeSliceInput(input) {
    if (!isRecord(input)) {
        throw new DomainError(ERROR_CODES.INVALID_SLICE, 'Slice input must be a plain object');
    }
    const turnBudget = input.turnBudget === undefined || input.turnBudget === null
        ? null
        : requireFiniteNumber(input.turnBudget, 'turnBudget');
    const data = {
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
    sliceId;
    contractHash;
    parentCheckpointHash;
    objective;
    postcondition;
    allowedReads;
    allowedWrites;
    frozenApiRefs;
    invariantRefs;
    prohibitionRefs;
    verifierRefs;
    regressionVerifierRefs;
    workerToolAllowlist;
    maxAttempts;
    wallTimeout;
    turnBudget;
    sliceHash;
    get hash() {
        return this.sliceHash;
    }
    constructor(data, sliceHash) {
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
    static create(input) {
        const data = normalizeSliceInput(input);
        const sliceHash = hashCanonical(data);
        return new FrozenSlice(data, sliceHash);
    }
    toObject() {
        const data = {
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
//# sourceMappingURL=slice.js.map