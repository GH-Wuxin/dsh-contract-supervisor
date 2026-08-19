export const WORKER_ROLE = 'implementation_worker';
export const WORKER_MODEL = 'Flash';
export const WORKER_PRESENTATION = 'native';
/**
 * Internal, module-owned S5 binding capability. It is intentionally not
 * re-exported from the package index: only the lifecycle coordinator can
 * create it, and only the DSH port can consume it. Ordinary WorkerPort
 * callers cannot fabricate the opaque brand.
 */
export const WORKER_FS_BINDING = Symbol('dsh-contract-supervisor.workerFsBinding');
export function createWorkerFsBindingRequest(attemptId, authority, sessions, effectiveToolAllowlist) {
    return {
        [WORKER_FS_BINDING]: true,
        attemptId,
        authority,
        sessions,
        effectiveToolAllowlist: Object.freeze([...effectiveToolAllowlist]),
    };
}
export function getWorkerFsBindingRequest(request) {
    const binding = request[WORKER_FS_BINDING];
    return binding && binding[WORKER_FS_BINDING] === true ? binding : null;
}
//# sourceMappingURL=types.js.map