import type { AttemptState, SupervisorRuntimeState } from '../state/index.js';
import type { WorkerError } from './errors.js';

export const WORKER_ROLE = 'implementation_worker' as const;
export const WORKER_MODEL = 'Flash' as const;
export const WORKER_PRESENTATION = 'native' as const;

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
  readonly error?: WorkerError | null;
}

export interface WorkerRun {
  readonly workerId: string;
  readonly sessionId: string;
  readonly result: Promise<WorkerResult>;
  dispose(): Promise<void>;
}

export interface WorkerSpawnRequest {
  readonly attemptId: string;
  readonly prompt: string;
  readonly config: FrozenWorkerConfig;
}

export interface WorkerPort {
  spawn(request: WorkerSpawnRequest): Promise<WorkerRun>;
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
  readonly error: WorkerError | null;
  readonly settled: boolean;
}
