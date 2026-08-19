import { FsError } from './errors.js';
import type { PreparedSliceFsAuthority } from './authority.js';
import type { SliceFsAuthority } from './types.js';
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
/**
 * Narrow Supervisor-owned session binding registry for S5 audited filesystem
 * authority.
 *
 * Bindings are keyed by the trusted worker session id captured by the
 * Supervisor when a WorkerRun is created. Tool arguments never carry session,
 * attempt, slice, or authority identity.
 */
export declare class SliceFsSessionRegistry {
    private readonly sessions;
    bind(sessionIdValue: unknown, attemptIdValue: unknown, authority: SliceFsAuthority): SliceFsSessionBinding;
    getBinding(sessionId: unknown): SliceFsSessionBinding | null;
    requireBinding(sessionId: unknown): SliceFsSessionBinding;
    getViolation(sessionId: string): FsError | null;
    release(sessionId: string): void;
    get liveSessionCount(): number;
    /**
     * Total retained authorization records. After release this is zero; the
     * registry deliberately does not distinguish previously-released from
     * never-known sessions.
     */
    get retainedRecordCount(): number;
    /** Alias matching the review vocabulary: retained authorization records. */
    get retainedAuthorizationRecordCount(): number;
    hasLiveSession(sessionId: string): boolean;
}
export declare function createSliceFsSessionRegistry(): SliceFsSessionRegistry;
//# sourceMappingURL=session.d.ts.map