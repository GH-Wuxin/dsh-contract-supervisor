import { WorkerError, WORKER_ERROR_CODES } from './errors.js';
import type {
  FrozenWorkerConfig,
  WorkerPort,
  WorkerResult,
  WorkerRun,
  WorkerSpawnRequest,
} from './types.js';

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

export function createFakeWorkerRun(
  options: FakeWorkerRunOptions = {},
): FakeWorkerRun {
  let disposeCount = 0;
  let resolveStarted!: () => void;
  let rejectStarted!: (error?: unknown) => void;
  let resolveSettled!: () => void;
  let rejectSettled!: (error?: unknown) => void;
  let resolveGate!: () => void;
  let rejectGate!: (error?: unknown) => void;

  const disposeStarted = new Promise<void>((resolve, reject) => {
    resolveStarted = resolve;
    rejectStarted = reject;
  });
  const disposeSettled = new Promise<void>((resolve, reject) => {
    resolveSettled = resolve;
    rejectSettled = reject;
  });
  const disposeGate = new Promise<void>((resolve, reject) => {
    resolveGate = resolve;
    rejectGate = reject;
  });

  const result: Promise<WorkerResult> = options.rejectResult
    ? Promise.reject(
        options.resultError ?? new Error('fake worker execution failed'),
      )
    : Promise.resolve(
        options.result ?? { outcome: 'SUCCESS' },
      );

  const run: FakeWorkerRun = {
    workerId: options.workerId ?? 'fake-worker',
    sessionId: options.sessionId ?? 'fake-session',
    result,
    executionCount: 1,
    disposeCount: 0,
    disposeStarted,
    disposeSettled,
    async dispose() {
      disposeCount += 1;
      run.disposeCount = disposeCount;
      resolveStarted();
      try {
        if (options.deferredDispose) {
          await disposeGate;
        } else if (options.rejectDispose) {
          throw options.disposeError ?? new WorkerError(
            WORKER_ERROR_CODES.WORKER_DISPOSE_FAILED,
            'fake worker dispose failed',
          );
        }
        resolveSettled();
      } catch (error) {
        resolveSettled();
        throw error;
      }
    },
    resolveDispose() {
      resolveGate();
    },
    rejectDispose(error?: unknown) {
      rejectGate(error ?? new WorkerError(
        WORKER_ERROR_CODES.WORKER_DISPOSE_FAILED,
        'fake worker dispose rejected',
      ));
    },
  };

  return run;
}

export class FakeWorkerPort implements WorkerPort {
  readonly runs: FakeWorkerRun[] = [];
  spawnCount = 0;
  failSpawn = false;
  deferredSpawn = false;
  spawnStarted: Promise<void> = Promise.resolve();
  private spawnStartedResolve: (() => void) | undefined;
  private deferredSpawnResolve: ((run: FakeWorkerRun) => void) | undefined;
  private deferredSpawnReject: ((error?: unknown) => void) | undefined;
  spawnError: unknown = new WorkerError(
    WORKER_ERROR_CODES.WORKER_SPAWN_FAILED,
    'fake worker spawn failed',
  );
  nextWorkerId: string | undefined;
  nextSessionId: string | undefined;
  defaultResult: WorkerResult = { outcome: 'SUCCESS' };
  rejectResult = false;
  resultError: Error | undefined;
  rejectDispose = false;
  disposeError: Error | undefined;
  deferredDispose = false;
  lastRequest: WorkerSpawnRequest | undefined;
  lastConfig: FrozenWorkerConfig | undefined;

  async spawn(request: WorkerSpawnRequest): Promise<FakeWorkerRun> {
    this.lastRequest = request;
    this.lastConfig = request.config;
    this.spawnCount += 1;
    this.spawnStarted = new Promise<void>((resolve) => {
      this.spawnStartedResolve = resolve;
    });

    if (this.failSpawn) {
      this.spawnStartedResolve?.();
      throw this.spawnError;
    }

    if (this.deferredSpawn) {
      return new Promise<FakeWorkerRun>((resolve, reject) => {
        this.deferredSpawnResolve = resolve;
        this.deferredSpawnReject = reject;
        this.spawnStartedResolve?.();
      });
    }

    const run = this.createRun();
    this.runs.push(run);
    this.spawnStartedResolve?.();
    return run;
  }

  resolveSpawn(run?: FakeWorkerRun): void {
    const resolve = this.deferredSpawnResolve;
    const reject = this.deferredSpawnReject;
    if (resolve === undefined || reject === undefined) {
      throw new Error('No deferred spawn is pending');
    }

    const actualRun = run ?? this.createRun();
    this.runs.push(actualRun);
    this.deferredSpawnResolve = undefined;
    this.deferredSpawnReject = undefined;
    resolve(actualRun);
  }

  rejectSpawn(error?: unknown): void {
    const resolve = this.deferredSpawnResolve;
    const reject = this.deferredSpawnReject;
    if (resolve === undefined || reject === undefined) {
      throw new Error('No deferred spawn is pending');
    }

    this.deferredSpawnResolve = undefined;
    this.deferredSpawnReject = undefined;
    reject(error ?? this.spawnError);
  }

  private createRun(): FakeWorkerRun {
    return createFakeWorkerRun({
      workerId: this.nextWorkerId ?? `fake-worker-${this.runs.length + 1}`,
      sessionId: this.nextSessionId ?? `fake-session-${this.runs.length + 1}`,
      result: this.defaultResult,
      rejectResult: this.rejectResult,
      resultError: this.resultError,
      rejectDispose: this.rejectDispose,
      disposeError: this.disposeError,
      deferredDispose: this.deferredDispose,
    });
  }
}
