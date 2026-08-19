import type { SliceFsSessionRegistry } from '../fs/session.js';
import { type FrozenWorkerConfig, type WorkerAttemptInput, type WorkerAttemptResult, type WorkerFsConfig, type WorkerPort } from './types.js';
export declare function createWorkerLifecycleCoordinator(port: WorkerPort, config: FrozenWorkerConfig, sliceFsSessions?: SliceFsSessionRegistry, workerFsConfig?: WorkerFsConfig): WorkerLifecycleCoordinator;
export declare class WorkerLifecycleCoordinator {
    private readonly port;
    private readonly config;
    private active;
    private activeRun;
    private activeAttemptId;
    private readonly fsCatalog;
    readonly sliceFsSessions: SliceFsSessionRegistry;
    constructor(port: WorkerPort, config: FrozenWorkerConfig, sliceFsSessions?: SliceFsSessionRegistry, workerFsConfig?: WorkerFsConfig);
    get isActive(): boolean;
    get activeWorkerId(): string | null;
    /**
     * The single authority provenance root: the authentic Attempt produced by
     * the S3 state machine selects one frozen Slice from the Supervisor-owned
     * catalog installed at coordinator construction. No per-attempt
     * fsAuthority/slice/read/write authority object is accepted.
     */
    private deriveAttemptFsAuthority;
    /**
     * Effective tool policy comes only from the authentic FrozenSlice selected
     * by the Attempt hash. The frozen worker config is an upper bound, never a
     * per-Attempt authority source. If the authentic Slice requests any tool
     * outside that upper bound, the attempt fails closed before any child is
     * created.
     */
    private deriveAttemptEffectiveToolAllowlist;
    runAttempt(input: WorkerAttemptInput): Promise<WorkerAttemptResult>;
}
//# sourceMappingURL=coordinator.d.ts.map