export { WORKER_ERROR_CODES, WorkerError } from './errors.js';
export type { WorkerErrorCode } from './errors.js';
export { assertValidWorkerConfig, freezeWorkerConfig, FORBIDDEN_WORKER_TOOLS, SUPPORTED_WORKER_TOOLS } from './config.js';
export { authorizeWorkerTool, createToolAuthorizer } from './authority.js';
export {
  createWorkerLifecycleCoordinator,
  WorkerLifecycleCoordinator,
} from './coordinator.js';
export { createDshWorkerPort } from './dsh.js';
export type {
  DshToolRuntime,
  DshWorkerContext,
} from './dsh.js';
export {
  classifyDshOneShotTerminal,
} from './terminal.js';
export type {
  DshTerminalClassification,
} from './terminal.js';
export {
  createFakeWorkerRun,
  FakeWorkerPort,
} from './fake.js';
export type {
  FakeWorkerRun,
  FakeWorkerRunOptions,
} from './fake.js';
export {
  WORKER_MODEL,
  WORKER_PRESENTATION,
  WORKER_ROLE,
} from './types.js';
export type {
  FrozenWorkerConfig,
  WorkerAttemptInput,
  WorkerAttemptResult,
  WorkerExecutionOutcome,
  WorkerFsConfig,
  WorkerPort,
  WorkerResult,
  WorkerRun,
  WorkerSpawnRequest,
} from './types.js';
