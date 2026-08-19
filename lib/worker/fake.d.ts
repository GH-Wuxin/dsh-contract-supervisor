import type { FrozenWorkerConfig, WorkerPort, WorkerResult, WorkerRun, WorkerSpawnRequest } from './types.js';
export interface FakeWorkerRunOptions {
    readonly workerId?: string;
    readonly sessionId?: string;
    readonly result?: WorkerResult;
    readonly rejectResult?: boolean;
    readonly resultError?: Error;
    readonly rejectDispose?: boolean;
    readonly disposeError?: Error;
    readonly deferredDispose?: boolean;
}
export interface FakeWorkerRun extends WorkerRun {
    readonly executionCount: number;
    disposeCount: number;
    readonly disposeStarted: Promise<void>;
    readonly disposeSettled: Promise<void>;
    resolveDispose(): void;
    rejectDispose(error?: unknown): void;
}
export declare function createFakeWorkerRun(options?: FakeWorkerRunOptions): FakeWorkerRun;
export declare class FakeWorkerPort implements WorkerPort {
    readonly runs: FakeWorkerRun[];
    spawnCount: number;
    failSpawn: boolean;
    deferredSpawn: boolean;
    spawnStarted: Promise<void>;
    private spawnStartedResolve;
    private deferredSpawnResolve;
    private deferredSpawnReject;
    spawnError: unknown;
    nextWorkerId: string | undefined;
    nextSessionId: string | undefined;
    defaultResult: WorkerResult;
    rejectResult: boolean;
    resultError: Error | undefined;
    rejectDispose: boolean;
    disposeError: Error | undefined;
    deferredDispose: boolean;
    lastRequest: WorkerSpawnRequest | undefined;
    lastConfig: FrozenWorkerConfig | undefined;
    spawn(request: WorkerSpawnRequest): Promise<FakeWorkerRun>;
    resolveSpawn(run?: FakeWorkerRun): void;
    rejectSpawn(error?: unknown): void;
    private createRun;
}
//# sourceMappingURL=fake.d.ts.map