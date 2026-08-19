import { FsError, FS_ERROR_CODES, isTrustedFsViolationCode, } from './errors.js';
import { createSliceFsAuthority, isPreparedSliceFsAuthority, } from './authority.js';
function sessionError(code, message) {
    return new FsError(code, message);
}
function validateIdentity(value, field) {
    if (typeof value !== 'string' || value.length === 0 || value.length > 1024) {
        throw sessionError(FS_ERROR_CODES.FS_INVALID_ARGUMENT, `${field} must be a non-empty string of at most 1024 characters`);
    }
    if (value.includes('\0')) {
        throw sessionError(FS_ERROR_CODES.FS_INVALID_ARGUMENT, `${field} must not contain NUL`);
    }
    return value;
}
class BindingRecord {
    sessionId;
    attemptId;
    authority;
    violationValue = null;
    constructor(sessionId, attemptId, authority) {
        this.sessionId = sessionId;
        this.attemptId = attemptId;
        this.authority = authority;
    }
    get violation() {
        return this.violationValue;
    }
    recordViolation(violation) {
        if (this.violationValue !== null) {
            return;
        }
        if (!isTrustedFsViolationCode(violation.code)) {
            throw sessionError(FS_ERROR_CODES.FS_INVALID_ARGUMENT, `Code '${violation.code}' is not a trusted filesystem violation`);
        }
        this.violationValue = violation;
    }
}
/**
 * Narrow Supervisor-owned session binding registry for S5 audited filesystem
 * authority.
 *
 * Bindings are keyed by the trusted worker session id captured by the
 * Supervisor when a WorkerRun is created. Tool arguments never carry session,
 * attempt, slice, or authority identity.
 */
export class SliceFsSessionRegistry {
    sessions = new Map();
    bind(sessionIdValue, attemptIdValue, authority) {
        const sessionId = validateIdentity(sessionIdValue, 'sessionId');
        const attemptId = validateIdentity(attemptIdValue, 'attemptId');
        const prepared = isPreparedSliceFsAuthority(authority)
            ? authority
            : createSliceFsAuthority(authority);
        const existing = this.sessions.get(sessionId);
        if (existing !== undefined) {
            throw sessionError(FS_ERROR_CODES.FS_SESSION_ALREADY_BOUND, `Session '${sessionId}' already has a live filesystem authority binding`);
        }
        const binding = new BindingRecord(sessionId, attemptId, prepared);
        this.sessions.set(sessionId, binding);
        return binding;
    }
    getBinding(sessionId) {
        if (typeof sessionId !== 'string') {
            return null;
        }
        return this.sessions.get(sessionId) ?? null;
    }
    requireBinding(sessionId) {
        if (typeof sessionId !== 'string') {
            throw sessionError(FS_ERROR_CODES.FS_INVALID_ARGUMENT, 'sessionId must be a string');
        }
        const record = this.sessions.get(sessionId);
        if (record === undefined) {
            throw sessionError(FS_ERROR_CODES.FS_SESSION_UNKNOWN, `Session '${sessionId}' has no Supervisor-owned filesystem authority binding`);
        }
        return record;
    }
    getViolation(sessionId) {
        return this.sessions.get(sessionId)?.violation ?? null;
    }
    release(sessionId) {
        if (typeof sessionId !== 'string') {
            return;
        }
        // Deletion, not a tombstone: a released worker must not leave unbounded
        // per-session retained state behind.
        this.sessions.delete(sessionId);
    }
    get liveSessionCount() {
        return this.sessions.size;
    }
    /**
     * Total retained authorization records. After release this is zero; the
     * registry deliberately does not distinguish previously-released from
     * never-known sessions.
     */
    get retainedRecordCount() {
        return this.sessions.size;
    }
    /** Alias matching the review vocabulary: retained authorization records. */
    get retainedAuthorizationRecordCount() {
        return this.sessions.size;
    }
    hasLiveSession(sessionId) {
        return this.getBinding(sessionId) !== null;
    }
}
export function createSliceFsSessionRegistry() {
    return new SliceFsSessionRegistry();
}
//# sourceMappingURL=session.js.map