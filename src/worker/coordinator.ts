import {
  beginDisposeAttempt,
  completeDisposeAttempt,
  failSpawnAttempt,
  finalizeActiveAttempt,
  runAttempt as runAttemptState,
  settleAttempt,
  spawnAttempt as spawnAttemptState,
  startActiveAttempt,
} from '../state/index.js';
import { assertValidWorkerConfig, freezeWorkerConfig } from './config.js';
import { WorkerError, WORKER_ERROR_CODES } from './errors.js';
import type {
  FrozenWorkerConfig,
  WorkerAttemptInput,
  WorkerAttemptResult,
  WorkerExecutionOutcome,
  WorkerPort,
  WorkerResult,
  WorkerRun,
} from './types.js';

function asWorkerError(
  code: WorkerError['code'],
  message: string,
  cause?: unknown,
): WorkerError {
  const error = new WorkerError(code, message);
  if (cause !== undefined) {
    (error as Error & { cause?: unknown }).cause = cause;
  }
  return error;
}

function executionErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const WORKER_OUTCOMES: readonly WorkerExecutionOutcome[] = [
  'SUCCESS',
  'FAILED',
  'INVALIDATED',
];

function isWorkerResult(value: unknown): value is WorkerResult {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as { outcome?: unknown };
  return (
    typeof candidate.outcome === 'string' &&
    WORKER_OUTCOMES.includes(candidate.outcome as WorkerExecutionOutcome)
  );
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return Object.prototype.toString.call(value);
  }
}

function normalizeWorkerResult(
  value: unknown,
  attemptId: string,
  cause?: unknown,
): WorkerResult {
  if (isWorkerResult(value)) {
    return value;
  }

  const detail =
    cause !== undefined
      ? `: ${executionErrorMessage(cause)}`
      : `: ${typeof value === 'string' ? value : safeStringify(value)}`;
  return {
    outcome: 'FAILED',
    message: `Worker returned a malformed result for attempt '${attemptId}'${detail}`,
    error: asWorkerError(
      WORKER_ERROR_CODES.WORKER_EXECUTION_FAILED,
      `Worker returned a malformed result for attempt '${attemptId}'${detail}`,
      cause,
    ),
  };
}

export function createWorkerLifecycleCoordinator(
  port: WorkerPort,
  config: FrozenWorkerConfig,
): WorkerLifecycleCoordinator {
  return new WorkerLifecycleCoordinator(port, config);
}

export class WorkerLifecycleCoordinator {
  private readonly port: WorkerPort;
  private readonly config: FrozenWorkerConfig;
  private active = false;
  private activeRun: WorkerRun | null = null;
  private activeAttemptId: string | null = null;

  constructor(port: WorkerPort, config: FrozenWorkerConfig) {
    assertValidWorkerConfig(config);
    this.port = port;
    this.config = freezeWorkerConfig(config);
  }

  get isActive(): boolean {
    return this.active;
  }

  get activeWorkerId(): string | null {
    return this.activeRun?.workerId ?? null;
  }

  async runAttempt(input: WorkerAttemptInput): Promise<WorkerAttemptResult> {
    if (this.active) {
      throw new WorkerError(
        WORKER_ERROR_CODES.WORKER_ALREADY_ACTIVE,
        `Cannot start worker attempt '${input.attemptId}' while another worker is active`,
      );
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

      let run: WorkerRun;
      try {
        run = await this.port.spawn({
          attemptId: input.attemptId,
          prompt: input.prompt,
          config: this.config,
        });
      } catch (error) {
        const failedAttempt = failSpawnAttempt(spawningAttempt);
        const finalRuntime = finalizeActiveAttempt(runtimeAfterStart, failedAttempt);
        return {
          runtime: finalRuntime,
          attempt: failedAttempt,
          outcome: 'FAILED',
          error: asWorkerError(
            WORKER_ERROR_CODES.WORKER_SPAWN_FAILED,
            `Worker spawn failed for attempt '${input.attemptId}': ${executionErrorMessage(error)}`,
            error,
          ),
          settled: true,
        };
      }

      this.activeRun = run;
      const runningAttempt = runAttemptState(spawningAttempt);

      let workerResult: WorkerResult;
      try {
        workerResult = await run.result;
      } catch (error) {
        workerResult = {
          outcome: 'FAILED',
          message: `Worker execution failed: ${executionErrorMessage(error)}`,
          error: asWorkerError(
            WORKER_ERROR_CODES.WORKER_EXECUTION_FAILED,
            `Worker execution failed for attempt '${input.attemptId}': ${executionErrorMessage(error)}`,
            error,
          ),
        };
      }

      // Malformed/unknown post-spawn results are normalized before state
      // settlement so dispose is still attempted exactly once.
      workerResult = normalizeWorkerResult(
        workerResult,
        input.attemptId,
      );

      const settledAttempt = settleAttempt(runningAttempt, workerResult.outcome);
      const disposingAttempt = beginDisposeAttempt(settledAttempt);

      try {
        await run.dispose();
      } catch (error) {
        clearActiveOnExit = false;
        return {
          runtime: runtimeAfterStart,
          attempt: disposingAttempt,
          outcome: workerResult.outcome,
          error: asWorkerError(
            WORKER_ERROR_CODES.WORKER_DISPOSE_FAILED,
            `Worker dispose failed for attempt '${input.attemptId}': ${executionErrorMessage(error)}`,
            error,
          ),
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
    } finally {
      if (clearActiveOnExit) {
        this.active = false;
        this.activeRun = null;
        this.activeAttemptId = null;
      }
    }
  }
}
