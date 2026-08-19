import type { FrozenSlice } from '../domain/index.js';
import type { AttemptState, SupervisorRuntimeState } from '../state/index.js';
import type { FsError } from '../fs/errors.js';
import type { SliceFsSessionRegistry } from '../fs/session.js';
import type { SliceFsAuthority } from '../fs/types.js';
import type { WorkerError } from './errors.js';
export declare const WORKER_ROLE: 'implementation_worker';
export declare const WORKER_MODEL: 'Flash';
export declare const WORKER_PRESENTATION: 'native';
export interface FrozenWorkerConfig {
    readonly role: typeof WORKER_ROLE;
    readonly provider: 'deepseek-ai';
    readonly model: typeof WORKER_MODEL;
    readonly presentation: typeof WORKER_PRESENTATION;
    readonly oneShot: true;
    readonly toolAllowlist: readonly string[];
    readonly maxDepth?: number;
}
export type WorkerExecutionOutcome = 'SUCCESS' | 'FAILED' | 'INVALIDATED';
export interface WorkerResult {
    readonly outcome: WorkerExecutionOutcome;
    readonly message?: string;
    readonly transcript?: string;
    /**
     * Trusted error supplied by the worker adapter. The coordinator preserves it
     * instead of replacing it with a generic execution error. Model text can
     * never set this field; only the adapter's trusted guard/transport path can.
     */
    readonly error?: WorkerError | FsError | null;
}
export interface WorkerRun {
    readonly workerId: string;
    readonly sessionId: string;
    readonly result: Promise<WorkerResult>;
    dispose(): Promise<void>;
}
/**
 * Internal, module-owned S5 binding capability. It is intentionally not
 * re-exported from the package index: only the lifecycle coordinator can
 * create it, and only the DSH port can consume it. Ordinary WorkerPort
 * callers cannot fabricate the opaque brand.
 */
export declare const WORKER_FS_BINDING: unique symbol;
export interface WorkerFsBindingRequest {
    readonly [WORKER_FS_BINDING]: true;
    readonly attemptId: string;
    readonly authority: SliceFsAuthority;
    readonly sessions: SliceFsSessionRegistry;
    /**
     * Effective per-Attempt tool policy derived by the coordinator from the SAME
     * authentic FrozenSlice that supplied allowedReads/allowedWrites/slice
     * identity. It is never a public WorkerSpawnRequest field.
     */
    readonly effectiveToolAllowlist: readonly string[];
}
export declare function createWorkerFsBindingRequest(attemptId: string, authority: SliceFsAuthority, sessions: SliceFsSessionRegistry, effectiveToolAllowlist: readonly string[]): WorkerFsBindingRequest;
export declare function getWorkerFsBindingRequest(request: WorkerSpawnRequest): WorkerFsBindingRequest | null;
export interface WorkerSpawnRequest {
    readonly attemptId: string;
    readonly prompt: string;
    readonly config: FrozenWorkerConfig;
    /**
     * Opaque S5 binding capability created only by the lifecycle coordinator
     * from the authentic Supervisor-owned WorkerFsConfig. The symbol is not
     * exported from the package index, so ordinary callers cannot construct it.
     */
    readonly [WORKER_FS_BINDING]?: WorkerFsBindingRequest;
}
export interface WorkerPort {
    spawn(request: WorkerSpawnRequest): Promise<WorkerRun>;
}
/**
 * Supervisor-owned S5 filesystem authority source installed at coordinator
 * construction time.
 *
 * It is NOT a per-attempt authority injection seam. runAttempt selects a
 * FrozenSlice exclusively by the authentic Attempt/Slice hash carried in the
 * SupervisorRuntimeState; a caller cannot combine runtime Slice A with the
 * allowedReads/allowedWrites of Slice B.
 */
export interface WorkerFsConfig {
    readonly repoRoot: string;
    readonly slices: readonly FrozenSlice[];
}
export interface WorkerAttemptInput {
    readonly runtime: SupervisorRuntimeState;
    readonly attemptId: string;
    readonly prompt: string;
}
export interface WorkerAttemptResult {
    readonly runtime: SupervisorRuntimeState;
    readonly attempt: AttemptState;
    readonly outcome: WorkerExecutionOutcome | null;
    readonly error: WorkerError | FsError | null;
    readonly settled: boolean;
}
//# sourceMappingURL=types.d.ts.map