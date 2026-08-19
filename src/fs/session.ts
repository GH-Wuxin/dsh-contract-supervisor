import {
  FsError,
  FS_ERROR_CODES,
  isTrustedFsViolationCode,
} from './errors.js';
import {
  createSliceFsAuthority,
  isPreparedSliceFsAuthority,
} from './authority.js';
import type { PreparedSliceFsAuthority } from './authority.js';
import type { SliceFsAuthority } from './types.js';

function sessionError(code: FsError['code'], message: string): FsError {
  return new FsError(code, message);
}

function validateIdentity(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 1024) {
    throw sessionError(
      FS_ERROR_CODES.FS_INVALID_ARGUMENT,
      `${field} must be a non-empty string of at most 1024 characters`,
    );
  }
  if (value.includes('\0')) {
    throw sessionError(FS_ERROR_CODES.FS_INVALID_ARGUMENT, `${field} must not contain NUL`);
  }
  return value;
}

export interface SliceFsSessionBinding {
  readonly sessionId: string;
  readonly attemptId: string;
  readonly authority: PreparedSliceFsAuthority;
  readonly violation: FsError | null;

  /**
   * Supervisor-owned recorder. Tool bodies call this when a trusted filesystem
   * violation is detected. The first violation wins and cannot be cleared or
   * downgraded by later model activity.
   */
  recordViolation(violation: FsError): void;
}

class BindingRecord implements SliceFsSessionBinding {
  readonly sessionId: string;
  readonly attemptId: string;
  readonly authority: PreparedSliceFsAuthority;
  violationValue: FsError | null = null;

  constructor(sessionId: string, attemptId: string, authority: PreparedSliceFsAuthority) {
    this.sessionId = sessionId;
    this.attemptId = attemptId;
    this.authority = authority;
  }

  get violation(): FsError | null {
    return this.violationValue;
  }

  recordViolation(violation: FsError): void {
    if (this.violationValue !== null) {
      return;
    }
    if (!isTrustedFsViolationCode(violation.code)) {
      throw sessionError(
        FS_ERROR_CODES.FS_INVALID_ARGUMENT,
        `Code '${violation.code}' is not a trusted filesystem violation`,
      );
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
  private readonly sessions = new Map<string, SliceFsSessionBinding>();

  bind(
    sessionIdValue: unknown,
    attemptIdValue: unknown,
    authority: SliceFsAuthority,
  ): SliceFsSessionBinding {
    const sessionId = validateIdentity(sessionIdValue, 'sessionId');
    const attemptId = validateIdentity(attemptIdValue, 'attemptId');
    const prepared = isPreparedSliceFsAuthority(authority)
      ? authority
      : createSliceFsAuthority(authority);

    const existing = this.sessions.get(sessionId);
    if (existing !== undefined) {
      throw sessionError(
        FS_ERROR_CODES.FS_SESSION_ALREADY_BOUND,
        `Session '${sessionId}' already has a live filesystem authority binding`,
      );
    }

    const binding = new BindingRecord(sessionId, attemptId, prepared);
    this.sessions.set(sessionId, binding);
    return binding;
  }

  getBinding(sessionId: unknown): SliceFsSessionBinding | null {
    if (typeof sessionId !== 'string') {
      return null;
    }
    return this.sessions.get(sessionId) ?? null;
  }

  requireBinding(sessionId: unknown): SliceFsSessionBinding {
    if (typeof sessionId !== 'string') {
      throw sessionError(
        FS_ERROR_CODES.FS_INVALID_ARGUMENT,
        'sessionId must be a string',
      );
    }
    const record = this.sessions.get(sessionId);
    if (record === undefined) {
      throw sessionError(
        FS_ERROR_CODES.FS_SESSION_UNKNOWN,
        `Session '${sessionId}' has no Supervisor-owned filesystem authority binding`,
      );
    }
    return record;
  }

  getViolation(sessionId: string): FsError | null {
    return this.sessions.get(sessionId)?.violation ?? null;
  }

  release(sessionId: string): void {
    if (typeof sessionId !== 'string') {
      return;
    }
    // Deletion, not a tombstone: a released worker must not leave unbounded
    // per-session retained state behind.
    this.sessions.delete(sessionId);
  }

  get liveSessionCount(): number {
    return this.sessions.size;
  }

  /**
   * Total retained authorization records. After release this is zero; the
   * registry deliberately does not distinguish previously-released from
   * never-known sessions.
   */
  get retainedRecordCount(): number {
    return this.sessions.size;
  }

  /** Alias matching the review vocabulary: retained authorization records. */
  get retainedAuthorizationRecordCount(): number {
    return this.sessions.size;
  }

  hasLiveSession(sessionId: string): boolean {
    return this.getBinding(sessionId) !== null;
  }
}

export function createSliceFsSessionRegistry(): SliceFsSessionRegistry {
  return new SliceFsSessionRegistry();
}
