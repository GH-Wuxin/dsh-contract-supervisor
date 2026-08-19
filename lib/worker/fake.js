import { WorkerError, WORKER_ERROR_CODES } from './errors.js';
export function createFakeWorkerRun(options = {}) {
    let disposeCount = 0;
    let resolveStarted;
    let rejectStarted;
    let resolveSettled;
    let rejectSettled;
    let resolveGate;
    let rejectGate;
    const disposeStarted = new Promise((resolve, reject) => {
        resolveStarted = resolve;
        rejectStarted = reject;
    });
    const disposeSettled = new Promise((resolve, reject) => {
        resolveSettled = resolve;
        rejectSettled = reject;
    });
    const disposeGate = new Promise((resolve, reject) => {
        resolveGate = resolve;
        rejectGate = reject;
    });
    const result = options.rejectResult
        ? Promise.reject(options.resultError ?? new Error('fake worker execution failed'))
        : Promise.resolve(options.result ?? { outcome: 'SUCCESS' });
    const run = {
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
                }
                else if (options.rejectDispose) {
                    throw options.disposeError ?? new WorkerError(WORKER_ERROR_CODES.WORKER_DISPOSE_FAILED, 'fake worker dispose failed');
                }
                resolveSettled();
            }
            catch (error) {
                resolveSettled();
                throw error;
            }
        },
        resolveDispose() {
            resolveGate();
        },
        rejectDispose(error) {
            rejectGate(error ?? new WorkerError(WORKER_ERROR_CODES.WORKER_DISPOSE_FAILED, 'fake worker dispose rejected'));
        },
    };
    return run;
}
export class FakeWorkerPort {
    runs = [];
    spawnCount = 0;
    failSpawn = false;
    deferredSpawn = false;
    spawnStarted = Promise.resolve();
    spawnStartedResolve;
    deferredSpawnResolve;
    deferredSpawnReject;
    spawnError = new WorkerError(WORKER_ERROR_CODES.WORKER_SPAWN_FAILED, 'fake worker spawn failed');
    nextWorkerId;
    nextSessionId;
    defaultResult = { outcome: 'SUCCESS' };
    rejectResult = false;
    resultError;
    rejectDispose = false;
    disposeError;
    deferredDispose = false;
    lastRequest;
    lastConfig;
    async spawn(request) {
        this.lastRequest = request;
        this.lastConfig = request.config;
        this.spawnCount += 1;
        this.spawnStarted = new Promise((resolve) => {
            this.spawnStartedResolve = resolve;
        });
        if (this.failSpawn) {
            this.spawnStartedResolve?.();
            throw this.spawnError;
        }
        if (this.deferredSpawn) {
            return new Promise((resolve, reject) => {
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
    resolveSpawn(run) {
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
    rejectSpawn(error) {
        const resolve = this.deferredSpawnResolve;
        const reject = this.deferredSpawnReject;
        if (resolve === undefined || reject === undefined) {
            throw new Error('No deferred spawn is pending');
        }
        this.deferredSpawnResolve = undefined;
        this.deferredSpawnReject = undefined;
        reject(error ?? this.spawnError);
    }
    createRun() {
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
//# sourceMappingURL=fake.js.map