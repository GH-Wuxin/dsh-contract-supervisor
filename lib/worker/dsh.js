import { randomUUID } from 'node:crypto';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { SessionId } from '@deepseek-ai/dsh-session';
import { resolveChildDepth } from '@deepseek-ai/dsh-subagent';
import { createSliceFsRuntime, createSliceFsToolDefinitions, } from '../fs/index.js';
import { SLICE_FS_TOOL_NAMES } from '../fs/toolNames.js';
import { assertValidWorkerConfig, freezeWorkerConfig } from './config.js';
import { WorkerError, WORKER_ERROR_CODES } from './errors.js';
import { classifyDshOneShotTerminal, } from './terminal.js';
import { getWorkerFsBindingRequest, } from './types.js';
function assertConfigMatches(expected, actual) {
    const same = actual.role === expected.role &&
        actual.provider === expected.provider &&
        actual.model === expected.model &&
        actual.presentation === expected.presentation &&
        actual.oneShot === expected.oneShot &&
        actual.maxDepth === expected.maxDepth &&
        actual.toolAllowlist.length === expected.toolAllowlist.length &&
        expected.toolAllowlist.every((tool) => actual.toolAllowlist.includes(tool));
    if (!same) {
        throw new WorkerError(WORKER_ERROR_CODES.WORKER_CONFIGURATION_INVALID, 'Caller attempted to override the frozen worker configuration');
    }
}
function promptBlocks(prompt) {
    return [{ type: 'text', text: prompt }];
}
function invalidatedResult(violation) {
    return {
        outcome: 'INVALIDATED',
        message: violation.message,
        error: violation,
    };
}
function failedResult(message, cause) {
    const error = new WorkerError(WORKER_ERROR_CODES.WORKER_EXECUTION_FAILED, message);
    if (cause !== undefined) {
        error.cause = cause;
    }
    return {
        outcome: 'FAILED',
        message,
        error,
    };
}
function terminalWorkerResult(terminal) {
    if (terminal.outcome === 'SUCCESS') {
        return {
            outcome: 'SUCCESS',
            message: terminal.message,
        };
    }
    return failedResult(terminal.message);
}
export function createDshWorkerPort(context, config) {
    assertValidWorkerConfig(config);
    const frozenConfig = freezeWorkerConfig(config);
    const parent = context.agent;
    return {
        async spawn(request) {
            assertConfigMatches(frozenConfig, request.config);
            // Each spawn gets a fresh violation marker. It is deliberately not shared
            // between attempts or runs.
            const authorityViolation = { current: null };
            // Effective tool policy comes exclusively from the trusted opaque S5
            // binding. A WorkerRun without that binding remains deny-all even when
            // the frozen config upper bound contains audited FS names.
            const fsBinding = getWorkerFsBindingRequest(request);
            const effectiveToolNames = fsBinding === null ? [] : fsBinding.effectiveToolAllowlist;
            const effectiveToolSet = new Set(effectiveToolNames);
            const sliceRuntime = fsBinding === null ? null : createSliceFsRuntime(fsBinding.sessions);
            const sliceDefinitions = sliceRuntime === null
                ? null
                : createSliceFsToolDefinitions(sliceRuntime);
            // The stock DSH depth resolver enforces the exact one-child-level policy
            // before a child is constructed.
            const childDepth = resolveChildDepth(parent, frozenConfig.maxDepth);
            const signal = new AbortController().signal;
            const toolDisposers = [];
            const setup = (childCtx) => {
                // Presentation, registration, restrict, and guard are all installed
                // during the unpublished creation window, before any prompt is
                // delivered to that child. The Supervisor-owned definitions are
                // registered on the fresh child scope itself, matching rc.7
                // AgentLoop's independent per-Agent scope construction. No shell or
                // generic tools are ever registered.
                childCtx.tools.presentAs('native');
                // Register ONLY Supervisor-owned definitions for names admitted by the
                // authentic Slice. Child-scoped registration keeps the parent surface
                // clean and gives each Attempt its own disposable tool scope.
                if (sliceDefinitions !== null) {
                    for (const name of SLICE_FS_TOOL_NAMES) {
                        if (effectiveToolSet.has(name)) {
                            toolDisposers.push(childCtx.tools.register(sliceDefinitions[name]));
                        }
                    }
                }
                // C4A.1 frozen visibility policy.
                //
                // The normal audited S5 visible surface is the set of child-local
                // Supervisor-owned definitions registered just above. rc.7 restrict()
                // validates/filters only the INHERITED/GLOBAL tool surface; child-local
                // names are not restrictable, so an empty allow-list hides the entire
                // inherited/global surface while leaving the child-local definitions
                // visible. Guard authorization still uses effectiveToolSet (never [])
                // as the final execution authority for late/local registrations.
                //
                // No try/catch: a restrict() installation failure must FAIL CLOSED by
                // rejecting agents.create — it is never swallowed.
                childCtx.tools.restrict({ allow: [] });
                childCtx.tools.guard((execution) => {
                    if (!effectiveToolSet.has(execution.name)) {
                        authorityViolation.current = new WorkerError(WORKER_ERROR_CODES.UNAUTHORIZED_TOOL, `Tool '${execution.name}' is not in the effective Slice worker tool allowlist`);
                        return `Worker tool '${execution.name}' is not allowed`;
                    }
                    return undefined;
                });
            };
            // Exact live runtime ownership: the child registry comes from the parent
            // Agent's own scoped context. There is no separately injectable
            // `context.agents` authority root.
            let handle;
            try {
                handle = await parent.ctx.agents.create({
                    sessionId: SessionId(randomUUID()),
                    meta: {
                        parentSession: parent.session.id,
                        origin: 'subagent',
                        delegationDepth: childDepth,
                    },
                    agentOptions: {
                        provider: frozenConfig.provider,
                        model: frozenConfig.model,
                        subagentDepth: childDepth,
                    },
                    signal,
                    setup,
                });
            }
            catch (error) {
                for (const disposeTool of toolDisposers) {
                    disposeTool();
                }
                throw error;
            }
            const child = handle.agent;
            let disposeCount = 0;
            // S5 trusted session binding is installed before prompt delivery. The
            // child session identity comes from the live DSH child, never from model
            // arguments. If binding fails, the handle is disposed and spawn rejects;
            // no live filesystem authority can be left behind.
            if (fsBinding !== null) {
                try {
                    fsBinding.sessions.bind(child.session.id, fsBinding.attemptId, fsBinding.authority);
                }
                catch (bindingError) {
                    try {
                        await handle.dispose();
                    }
                    catch (disposeError) {
                        // Once AgentHandle exists, cleanup failure must fail closed. It is
                        // classified as a dispose failure (not an ordinary SPAWN_FAILED) so
                        // the coordinator keeps occupancy and cannot start another worker
                        // while this child could still be live.
                        const cleanupFailure = new WorkerError(WORKER_ERROR_CODES.WORKER_DISPOSE_FAILED, `Worker dispose failed while recovering from an S5 session binding failure for attempt '${request.attemptId}' (binding: ${bindingError instanceof Error ? bindingError.message : String(bindingError)}; dispose: ${disposeError instanceof Error ? disposeError.message : String(disposeError)})`);
                        cleanupFailure.cause = disposeError;
                        for (const disposeTool of toolDisposers) {
                            disposeTool();
                        }
                        throw cleanupFailure;
                    }
                    for (const disposeTool of toolDisposers) {
                        disposeTool();
                    }
                    throw bindingError;
                }
            }
            const result = (async () => {
                let executionError;
                let terminal = null;
                try {
                    // Exactly one followup per WorkerRun; the child is already fresh and
                    // fully configured by the creation setup above. This line is reached
                    // only after any S5 session binding has succeeded.
                    child.followup(createUserMessage({
                        content: promptBlocks(request.prompt),
                        source: { kind: 'user' },
                    }));
                    await child.whenIdle();
                    // `whenIdle()` is only the quiescence boundary. The authoritative
                    // terminal outcome comes from THIS child's durable session record,
                    // sliced from its activation boundary so no seed/parent history can
                    // be mistaken for current-child work.
                    const activationBoundary = child.session.header.seedLength ?? 0;
                    terminal = classifyDshOneShotTerminal(child.session.events.slice(activationBoundary), child.session.id);
                }
                catch (error) {
                    executionError = error;
                }
                // Trusted per-run guard violation has the highest priority, above both
                // raw transport results and authoritative terminal accounting.
                if (authorityViolation.current !== null) {
                    return invalidatedResult(authorityViolation.current);
                }
                if (executionError !== undefined) {
                    const message = `Worker execution failed: ${executionError instanceof Error
                        ? executionError.message
                        : String(executionError)}`;
                    return failedResult(message, executionError);
                }
                if (terminal === null) {
                    // Classification itself can only return a value; this is a
                    // fail-closed backstop for an impossible internal path.
                    return failedResult(`Worker one-shot terminal classification failed for child session '${child.session.id}'`);
                }
                return terminalWorkerResult(terminal);
            })();
            return {
                workerId: child.id,
                sessionId: child.session.id,
                result,
                async dispose() {
                    if (disposeCount > 0) {
                        return;
                    }
                    disposeCount += 1;
                    try {
                        await handle.dispose();
                    }
                    finally {
                        for (const disposeTool of toolDisposers) {
                            disposeTool();
                        }
                    }
                },
            };
        },
    };
}
//# sourceMappingURL=dsh.js.map