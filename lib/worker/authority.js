import { WorkerError, WORKER_ERROR_CODES } from './errors.js';
export function authorizeWorkerTool(toolName, allowlist) {
    if (!allowlist.includes(toolName)) {
        throw new WorkerError(WORKER_ERROR_CODES.UNAUTHORIZED_TOOL, `Tool '${toolName}' is not in the worker tool allowlist`);
    }
}
export function createToolAuthorizer(allowlist) {
    const frozenAllowlist = Object.freeze([...allowlist]);
    return (toolName) => authorizeWorkerTool(toolName, frozenAllowlist);
}
//# sourceMappingURL=authority.js.map