import { WorkerError, WORKER_ERROR_CODES } from './errors.js';

export function authorizeWorkerTool(
  toolName: string,
  allowlist: readonly string[],
): void {
  if (!allowlist.includes(toolName)) {
    throw new WorkerError(
      WORKER_ERROR_CODES.UNAUTHORIZED_TOOL,
      `Tool '${toolName}' is not in the worker tool allowlist`,
    );
  }
}

export function createToolAuthorizer(
  allowlist: readonly string[],
): (toolName: string) => void {
  const frozenAllowlist = Object.freeze([...allowlist]);
  return (toolName: string) => authorizeWorkerTool(toolName, frozenAllowlist);
}
