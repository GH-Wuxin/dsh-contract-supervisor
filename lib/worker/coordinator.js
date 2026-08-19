import { beginDisposeAttempt, completeDisposeAttempt, failSpawnAttempt, finalizeActiveAttempt, runAttempt as runAttemptState, settleAttempt, spawnAttempt as spawnAttemptState, startActiveAttempt, } from '../state/index.js';
import { FrozenSlice } from '../domain/index.js';
import { createSliceFsAuthority } from '../fs/authority.js';
import { createSliceFsSessionRegistry, } from '../fs/session.js';
import { canonicalizeRepositoryRoot } from '../fs/path.js';
import { SLICE_FS_TOOL_NAMES } from '../fs/toolNames.js';
import { assertValidWorkerConfig, freezeWorkerConfig } from './config.js';
import { WorkerError, WORKER_ERROR_CODES } from './errors.js';
import { WORKER_FS_BINDING, createWorkerFsBindingRequest, } from './types.js';
function asWorkerError(code, message, cause) {
    const error = new WorkerError(code, message);
    if (cause !== undefined) {
        error.cause = cause;
    }
    return error;
}
function executionErrorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}
const WORKER_OUTCOMES = [
    'SUCCESS',
    'FAILED',
    'INVALIDATED',
];
function isWorkerResult(value) {
    if (typeof value !== 'object' || value === null) {
        return false;
    }
    const candidate = value;
    return (typeof candidate.outcome === 'string' &&
        WORKER_OUTCOMES.includes(candidate.outcome));
}
function safeStringify(value) {
    try {
        return JSON.stringify(value);
    }
    catch {
        return Object.prototype.toString.call(value);
    }
}
function normalizeWorkerResult(value, attemptId, cause) {
    if (isWorkerResult(value)) {
        return value;
    }
    const detail = cause !== undefined
        ? `: ${executionErrorMessage(cause)}`
        : `: ${typeof value === 'string' ? value : safeStringify(value)}`;
    return {
        outcome: 'FAILED',
        message: `Worker returned a malformed result for attempt '${attemptId}'${detail}`,
        error: asWorkerError(WORKER_ERROR_CODES.WORKER_EXECUTION_FAILED, `Worker returned a malformed result for attempt '${attemptId}'${detail}`, cause),
    };
}
export function createWorkerLifecycleCoordinator(port, config, sliceFsSessions = createSliceFsSessionRegistry(), workerFsConfig) {
    return new WorkerLifecycleCoordinator(port, config, sliceFsSessions, workerFsConfig);
}
function freezeWorkerFsConfig(config) {
    if (config === undefined) {
        return null;
    }
    if (typeof config !== 'object' ||
        config === null ||
        typeof config.repoRoot !== 'string' ||
        config.repoRoot.length === 0 ||
        config.repoRoot.includes('\0') ||
        !Array.isArray(config.slices)) {
        throw new WorkerError(WORKER_ERROR_CODES.WORKER_CONFIGURATION_INVALID, 'Worker filesystem config must provide a repoRoot string and a frozen Slice array');
    }
    const slices = new Map();
    for (const [index, slice] of config.slices.entries()) {
        if (!(slice instanceof FrozenSlice)) {
            throw new WorkerError(WORKER_ERROR_CODES.WORKER_CONFIGURATION_INVALID, `Worker filesystem config slices[${index}] is not an authentic FrozenSlice`);
        }
        if (!slices.has(slice.sliceHash)) {
            slices.set(slice.sliceHash, slice);
        }
    }
    let repoRoot;
    try {
        repoRoot = canonicalizeRepositoryRoot(config.repoRoot);
    }
    catch (error) {
        throw new WorkerError(WORKER_ERROR_CODES.WORKER_CONFIGURATION_INVALID, `Worker filesystem config repository root is invalid: ${error instanceof Error ? error.message : String(error)}`);
    }
    return {
        repoRoot,
        slices,
    };
}
function invalidatedFsResult(violation) {
    return {
        outcome: 'INVALIDATED',
        message: violation.message,
        error: violation,
    };
}
export class WorkerLifecycleCoordinator {
    port;
    config;
    active = false;
    activeRun = null;
    activeAttemptId = null;
    fsCatalog;
    sliceFsSessions;
    constructor(port, config, sliceFsSessions = createSliceFsSessionRegistry(), workerFsConfig) {
        assertValidWorkerConfig(config);
        this.port = port;
        this.config = freezeWorkerConfig(config);
        this.sliceFsSessions = sliceFsSessions;
        this.fsCatalog = freezeWorkerFsConfig(workerFsConfig);
    }
    get isActive() {
        return this.active;
    }
    get activeWorkerId() {
        return this.activeRun?.workerId ?? null;
    }
    /**
     * The single authority provenance root: the authentic Attempt produced by
     * the S3 state machine selects one frozen Slice from the Supervisor-owned
     * catalog installed at coordinator construction. No per-attempt
     * fsAuthority/slice/read/write authority object is accepted.
     */
    deriveAttemptFsAuthority(attempt) {
        if (this.fsCatalog === null) {
            return null;
        }
        const frozenSlice = this.fsCatalog.slices.get(attempt.sliceHash);
        if (frozenSlice === undefined) {
            throw new WorkerError(WORKER_ERROR_CODES.ACTIVE_SLICE_AUTHORITY_NOT_RECOVERABLE, `Active Slice '${attempt.sliceHash}' has no frozen Slice entry in the Supervisor-owned S5 filesystem config; filesystem authority is not recoverable`);
        }
        return createSliceFsAuthority({
            repoRoot: this.fsCatalog.repoRoot,
            sliceId: frozenSlice.sliceHash,
            allowedReads: frozenSlice.allowedReads,
            allowedWrites: frozenSlice.allowedWrites,
        });
    }
    /**
     * Effective tool policy comes only from the authentic FrozenSlice selected
     * by the Attempt hash. The frozen worker config is an upper bound, never a
     * per-Attempt authority source. If the authentic Slice requests any tool
     * outside that upper bound, the attempt fails closed before any child is
     * created.
     */
    deriveAttemptEffectiveToolAllowlist(attempt) {
        if (this.fsCatalog === null) {
            return Object.freeze([]);
        }
        const frozenSlice = this.fsCatalog.slices.get(attempt.sliceHash);
        if (frozenSlice === undefined) {
            throw new WorkerError(WORKER_ERROR_CODES.ACTIVE_SLICE_AUTHORITY_NOT_RECOVERABLE, `Active Slice '${attempt.sliceHash}' has no frozen Slice entry in the Supervisor-owned S5 filesystem config; filesystem tool policy is not recoverable`);
        }
        const requested = Array.from(new Set(frozenSlice.workerToolAllowlist));
        for (const tool of requested) {
            if (!this.config.toolAllowlist.includes(tool)) {
                throw new WorkerError(WORKER_ERROR_CODES.ACTIVE_SLICE_TOOL_POLICY_NOT_RECOVERABLE, `Active Slice '${attempt.sliceHash}' requests worker tool '${tool}' outside the FrozenWorkerConfig upper bound [${this.config.toolAllowlist.join(', ')}]; supported universe is [${SLICE_FS_TOOL_NAMES.join(', ')}]`);
            }
        }
        return Object.freeze(requested);
    }
    async runAttempt(input) {
        if (this.active) {
            throw new WorkerError(WORKER_ERROR_CODES.WORKER_ALREADY_ACTIVE, `Cannot start worker attempt '${input.attemptId}' while another worker is active`);
        }
        this.active = true;
        this.activeRun = null;
        this.activeAttemptId = input.attemptId;
        let clearActiveOnExit = true;
        try {
            const started = startActiveAttempt(input.runtime, input.attemptId);
            const createdAttempt = started.attempt;
            const spawningAttempt = spawnAttemptState(createdAttempt);
            const runtimeAfterStart = started.runtime;
            const fsAuthority = this.deriveAttemptFsAuthority(createdAttempt);
            let run;
            const effectiveToolAllowlist = this.deriveAttemptEffectiveToolAllowlist(createdAttempt);
            const fsBinding = fsAuthority === null
                ? undefined
                : createWorkerFsBindingRequest(input.attemptId, fsAuthority, this.sliceFsSessions, effectiveToolAllowlist);
            try {
                run = await this.port.spawn({
                    attemptId: input.attemptId,
                    prompt: input.prompt,
                    config: this.config,
                    [WORKER_FS_BINDING]: fsBinding,
                });
            }
            catch (error) {
                if (error instanceof WorkerError &&
                    error.code === WORKER_ERROR_CODES.WORKER_DISPOSE_FAILED) {
                    // The port created an AgentHandle, failed to bind session authority,
                    // and then failed to dispose that handle. The child could still be
                    // live, so this is NOT an ordinary recoverable SPAWN_FAILED.
                    clearActiveOnExit = false;
                    return {
                        runtime: runtimeAfterStart,
                        attempt: spawningAttempt,
                        outcome: 'FAILED',
                        error,
                        settled: false,
                    };
                }
                const failedAttempt = failSpawnAttempt(spawningAttempt);
                const finalRuntime = finalizeActiveAttempt(runtimeAfterStart, failedAttempt);
                return {
                    runtime: finalRuntime,
                    attempt: failedAttempt,
                    outcome: 'FAILED',
                    error: asWorkerError(WORKER_ERROR_CODES.WORKER_SPAWN_FAILED, `Worker spawn failed for attempt '${input.attemptId}': ${executionErrorMessage(error)}`, error),
                    settled: true,
                };
            }
            this.activeRun = run;
            // Production DSH ports bind during the unpublished child-creation
            // window. Fake/minimal ports may not implement the S5 seam, so bind here
            // exactly once when no live binding exists yet.
            if (fsAuthority !== null && !this.sliceFsSessions.hasLiveSession(run.sessionId)) {
                try {
                    this.sliceFsSessions.bind(run.sessionId, input.attemptId, fsAuthority);
                }
                catch (error) {
                    let disposeFailure;
                    try {
                        await run.dispose();
                    }
                    catch (disposeError) {
                        disposeFailure = disposeError;
                    }
                    if (disposeFailure !== undefined) {
                        clearActiveOnExit = false;
                        return {
                            runtime: runtimeAfterStart,
                            attempt: spawningAttempt,
                            outcome: 'FAILED',
                            error: asWorkerError(WORKER_ERROR_CODES.WORKER_DISPOSE_FAILED, `Worker dispose failed while recovering from an S5 session binding failure for attempt '${input.attemptId}' (binding: ${executionErrorMessage(error)}; dispose: ${executionErrorMessage(disposeFailure)})`, disposeFailure),
                            settled: false,
                        };
                    }
                    const failedAttempt = failSpawnAttempt(spawningAttempt);
                    const finalRuntime = finalizeActiveAttempt(runtimeAfterStart, failedAttempt);
                    return {
                        runtime: finalRuntime,
                        attempt: failedAttempt,
                        outcome: 'FAILED',
                        error: asWorkerError(WORKER_ERROR_CODES.WORKER_SPAWN_FAILED, `Worker filesystem session binding failed for attempt '${input.attemptId}': ${executionErrorMessage(error)}`, error),
                        settled: true,
                    };
                }
            }
            const runningAttempt = runAttemptState(spawningAttempt);
            let workerResult;
            try {
                workerResult = await run.result;
            }
            catch (error) {
                workerResult = {
                    outcome: 'FAILED',
                    message: `Worker execution failed: ${executionErrorMessage(error)}`,
                    error: asWorkerError(WORKER_ERROR_CODES.WORKER_EXECUTION_FAILED, `Worker execution failed for attempt '${input.attemptId}': ${executionErrorMessage(error)}`, error),
                };
            }
            // Trusted S5 filesystem violations outrank model completion and normal
            // transport failures. The recorder is Supervisor-owned; model text can
            // never create or clear it.
            if (workerResult.outcome !== 'INVALIDATED') {
                const fsViolation = this.sliceFsSessions.getViolation(run.sessionId);
                if (fsViolation !== null) {
                    workerResult = invalidatedFsResult(fsViolation);
                }
            }
            // Malformed/unknown post-spawn results are normalized before state
            // settlement so dispose is still attempted exactly once.
            workerResult = normalizeWorkerResult(workerResult, input.attemptId);
            const settledAttempt = settleAttempt(runningAttempt, workerResult.outcome);
            const disposingAttempt = beginDisposeAttempt(settledAttempt);
            // Session authority release happens no later than disposal. A failed
            // dispose therefore can never leave filesystem authority alive.
            this.sliceFsSessions.release(run.sessionId);
            try {
                await run.dispose();
            }
            catch (error) {
                clearActiveOnExit = false;
                return {
                    runtime: runtimeAfterStart,
                    attempt: disposingAttempt,
                    outcome: workerResult.outcome,
                    error: asWorkerError(WORKER_ERROR_CODES.WORKER_DISPOSE_FAILED, `Worker dispose failed for attempt '${input.attemptId}': ${executionErrorMessage(error)}`, error),
                    settled: false,
                };
            }
            const disposedAttempt = completeDisposeAttempt(disposingAttempt);
            const finalRuntime = finalizeActiveAttempt(runtimeAfterStart, disposedAttempt);
            return {
                runtime: finalRuntime,
                attempt: disposedAttempt,
                outcome: workerResult.outcome,
                error: workerResult.error ?? null,
                settled: true,
            };
        }
        finally {
            if (clearActiveOnExit) {
                this.active = false;
                this.activeRun = null;
                this.activeAttemptId = null;
            }
        }
    }
}
//# sourceMappingURL=coordinator.js.map