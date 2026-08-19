// S5.2 — Pro Commander Host Driver orchestration.
//
// Implements the narrow developer-only Section 11 sequence:
//
//   1. parse RunSpec            11. extract/validate commander output
//   2. validate RunSpec         12. construct Flash prompt
//   3. create FrozenContract    13. create DSH worker port from Pro parent
//   4. create FrozenSlice       14. create Slice FS session registry
//   5. create Supervisor state  15. create WorkerLifecycleCoordinator
//   6. admit Slice              16. generate fresh host attemptId
//   7. create zero-tool Pro     17. runAttempt exactly once
//   8. build commander prompt   18. worker disposal stays C5-owned
//   9. one Pro commander turn   19. dispose Pro parent in finally
//  10. classify terminal        20. return structured result / exit code
//
// Model configuration is HARD-FROZEN: commander = deepseek-ai/Pro,
// worker = deepseek-ai/Flash. The RunSpec cannot override these. Exactly ONE
// Flash Attempt is performed per invocation (no automatic retry loop).
//
// The driver never modifies C5 core (state/domain/hash/ledger/fs/worker). It
// composes existing authentic authorities through the public service seam.
import { randomUUID } from 'node:crypto';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { SessionId } from '@deepseek-ai/dsh-session';
import { SLICE_FS_TOOL_NAMES } from '../fs/index.js';
import { buildCommanderPrompt, buildFlashPrompt, extractCommanderInstruction, } from './commander.js';
import { parseRunSpec } from './runspec.js';
import { DRIVER_COMMANDER_MODEL, DRIVER_COMMANDER_PROVIDER, DRIVER_ERROR_CODES, DriverError, EXIT_CODE_COMMANDER_FAILURE, EXIT_CODE_PRE_COMMANDER_FAILURE, EXIT_CODE_SUCCESS, EXIT_CODE_WORKER_FAILURE, } from './types.js';
function initialState() {
    return {
        contractHash: null,
        sliceHash: null,
        attemptId: null,
        commanderTurn: null,
        commanderTerminalKind: null,
        commanderInstructionBytes: null,
    };
}
function failureResult(stage, exitCode, code, message, workerOutcome = null, workerPhase = null, workerSettled = false) {
    return {
        ok: false,
        exitCode,
        contractHash: stage.contractHash,
        sliceHash: stage.sliceHash,
        attemptId: stage.attemptId,
        commanderTurn: stage.commanderTurn,
        commanderTerminalKind: stage.commanderTerminalKind,
        commanderInstructionBytes: stage.commanderInstructionBytes,
        workerOutcome,
        workerPhase,
        workerSettled,
        error: { code, message },
    };
}
function asDriverError(error) {
    if (error instanceof DriverError) {
        return error;
    }
    const message = error instanceof Error ? error.message : String(error);
    return new DriverError(DRIVER_ERROR_CODES.DRIVER_INTERNAL, message, error);
}
/**
 * Build the hard-frozen Flash worker config. The toolAllowlist is the
 * Supervisor-owned UPPER BOUND (the full audited S5 universe); the per-Attempt
 * effective tools are derived by the coordinator from the authentic FrozenSlice.
 */
function buildFlashWorkerConfig() {
    return Object.freeze({
        role: 'implementation_worker',
        provider: 'deepseek-ai',
        model: 'Flash',
        presentation: 'native',
        oneShot: true,
        toolAllowlist: Object.freeze([...SLICE_FS_TOOL_NAMES]),
        maxDepth: 1,
    });
}
/**
 * Run the S5.2 Pro Commander Host Driver against a parsed RunSpec document.
 *
 * `ctx` is the genuine booted DSH context (same-boot). `rawRunSpec` is the
 * parsed JSON RunSpec v1 document. Returns a structured {@link DriverResult};
 * never throws driver-internal exceptions (they are captured into the result).
 */
export async function runContractSupervisorDriver(ctx, rawRunSpec, trace) {
    const stage = initialState();
    const service = ctx.get('contractSupervisor');
    let proHandle = null;
    try {
        // Steps 1-2: parse and validate RunSpec.
        let runSpec;
        try {
            runSpec = parseRunSpec(rawRunSpec);
        }
        catch (error) {
            const de = asDriverError(error);
            return failureResult(stage, EXIT_CODE_PRE_COMMANDER_FAILURE, de.code, de.message);
        }
        // Step 3: create authentic FrozenContract.
        let contract;
        try {
            contract = service.createFrozenContract(runSpec.contractInput);
        }
        catch (error) {
            const de = asDriverError(error);
            return failureResult(stage, EXIT_CODE_PRE_COMMANDER_FAILURE, de.code === DRIVER_ERROR_CODES.DRIVER_INTERNAL
                ? DRIVER_ERROR_CODES.CONTRACT_CREATION_FAILED
                : de.code, `FrozenContract creation failed: ${de.message}`);
        }
        stage.contractHash = contract.contractHash;
        // Step 4: create authentic FrozenSlice using the derived contractHash.
        let slice;
        try {
            slice = service.createFrozenSlice({
                ...runSpec.sliceInputBase,
                contractHash: contract.contractHash,
            });
        }
        catch (error) {
            const de = asDriverError(error);
            return failureResult(stage, EXIT_CODE_PRE_COMMANDER_FAILURE, de.code === DRIVER_ERROR_CODES.DRIVER_INTERNAL
                ? DRIVER_ERROR_CODES.SLICE_CREATION_FAILED
                : de.code, `FrozenSlice creation failed: ${de.message}`);
        }
        stage.sliceHash = slice.sliceHash;
        // Step 5-6: create Supervisor runtime state and admit the authentic Slice.
        let runtime;
        try {
            runtime = service.createSupervisorRuntimeState();
            runtime = service.admitSlice(runtime, {
                contractHash: contract.contractHash,
                readAuthority: [...contract.readAuthority],
                writeAuthority: contract.writeAuthority.map((rule) => ({ ...rule })),
                verifierCatalog: contract.verifierCatalog.map((v) => ({ ...v })),
                workerToolAllowlist: [...contract.workerToolAllowlist],
            }, {
                contractHash: slice.contractHash,
                sliceHash: slice.sliceHash,
                maxAttempts: slice.maxAttempts,
                allowedReads: [...slice.allowedReads],
                allowedWrites: slice.allowedWrites.map((rule) => ({ ...rule })),
                verifierRefs: [...slice.verifierRefs],
                regressionVerifierRefs: [...slice.regressionVerifierRefs],
                workerToolAllowlist: [...slice.workerToolAllowlist],
            });
        }
        catch (error) {
            const de = asDriverError(error);
            return failureResult(stage, EXIT_CODE_PRE_COMMANDER_FAILURE, DRIVER_ERROR_CODES.ADMISSION_FAILED, `Slice admission failed: ${de.message}`);
        }
        // Step 7: create fresh same-boot zero-tool Pro commander parent.
        const effectiveWorkerToolNames = [...slice.workerToolAllowlist];
        // Step 8: build commander prompt from frozen facts.
        const commanderPrompt = buildCommanderPrompt(contract, slice, effectiveWorkerToolNames);
        const proSetup = (agentCtx) => {
            // Zero-tool surface: hide every inherited/global tool. No local tools are
            // registered, so the commander's model-visible tool schemas are exactly
            // []. The commander receives all necessary context in its prompt and gets
            // NO filesystem session binding.
            //
            // Ordering is load-bearing (M-2 repair): FIRST force the agent-scoped
            // presentation to 'native', THEN restrict the inherited/global surface to
            // []. The native presentation is what prevents the reserved `run_code`
            // transport from ever being appended to this scope's model-visible
            // surface under a non-native deployment default (tools.mode = code/both);
            // restrict([]) then removes every inherited/global tool. Both run during
            // the unpublished creation window, before the first Pro request.
            agentCtx.tools.presentAs('native');
            agentCtx.tools.restrict({ allow: [] });
        };
        try {
            proHandle = await ctx.agents.create({
                sessionId: SessionId(randomUUID()),
                meta: { cwd: runSpec.repoRoot },
                agentOptions: {
                    provider: DRIVER_COMMANDER_PROVIDER,
                    model: DRIVER_COMMANDER_MODEL,
                    subagentDepth: 0,
                },
                signal: new AbortController().signal,
                setup: proSetup,
            });
        }
        catch (error) {
            const de = asDriverError(error);
            return failureResult(stage, EXIT_CODE_COMMANDER_FAILURE, DRIVER_ERROR_CODES.COMMANDER_SPAWN_FAILED, `Pro commander spawn failed: ${de.message}`);
        }
        const proAgent = proHandle.agent;
        if (trace !== undefined) {
            trace.proId = String(proAgent.id);
            trace.proSessionId = String(proAgent.session.id);
        }
        // Step 9: perform exactly one Pro commander turn.
        try {
            proAgent.followup(createUserMessage({
                content: [{ type: 'text', text: commanderPrompt }],
                source: { kind: 'user' },
            }));
            await proAgent.whenIdle();
        }
        catch (error) {
            const de = asDriverError(error);
            return failureResult(stage, EXIT_CODE_COMMANDER_FAILURE, DRIVER_ERROR_CODES.COMMANDER_RUNTIME_FAILED, `Pro commander runtime failed: ${de.message}`);
        }
        // Step 10-11: classify authoritative terminal and extract/validate output.
        const activationBoundary = proAgent.session.header.seedLength ?? 0;
        const commanderEvents = proAgent.session.events.slice(activationBoundary);
        let instruction;
        let instructionBytes;
        let commanderTurn;
        try {
            const extracted = extractCommanderInstruction(commanderEvents, String(proAgent.session.id));
            instruction = extracted.instruction;
            instructionBytes = extracted.bytes;
            commanderTurn = extracted.turn;
            stage.commanderTurn = commanderTurn;
            stage.commanderTerminalKind = 'completed';
            stage.commanderInstructionBytes = instructionBytes;
        }
        catch (error) {
            // FAIL CLOSED: no Flash worker spawned, no fallback instruction, no
            // silent truncation, no host-generated replacement.
            const de = asDriverError(error);
            // Record the terminal classification for diagnostics if available.
            return failureResult(stage, EXIT_CODE_COMMANDER_FAILURE, de.code, de.message);
        }
        // Step 12: construct Flash prompt with the two-level trust boundary.
        const flashPrompt = buildFlashPrompt(slice, instruction);
        // Steps 13-16: create worker port from the real Pro parent, FS session
        // registry, coordinator, and a fresh host attemptId.
        const flashConfig = buildFlashWorkerConfig();
        const rawPort = service.createDshWorkerPort({ agent: proAgent }, flashConfig);
        const sessions = service.createSliceFsSessionRegistry();
        // When tracing, wrap the port to record the Flash child identity (req 11-13).
        const port = trace === undefined
            ? rawPort
            : {
                spawn: async (request) => {
                    const run = await rawPort.spawn(request);
                    trace.flashWorkerId = run.workerId;
                    trace.flashSessionId = run.sessionId;
                    return run;
                },
            };
        const coordinator = service.createWorkerLifecycleCoordinator(port, flashConfig, sessions, {
            repoRoot: runSpec.repoRoot,
            slices: [slice],
        });
        const attemptId = randomUUID();
        stage.attemptId = attemptId;
        // Step 17: runAttempt exactly once. No automatic retry loop (Section 14).
        let attemptResult;
        try {
            attemptResult = await coordinator.runAttempt({
                runtime,
                attemptId,
                prompt: flashPrompt,
            });
        }
        catch (error) {
            // runAttempt throws only for pre-spawn policy failures (e.g. a Slice
            // requesting tools outside the FrozenWorkerConfig upper bound). The
            // worker cleanup remains C5-owned; no Flash child survives.
            if (trace !== undefined) {
                trace.sessionsLiveAfter = sessions.liveSessionCount;
            }
            const de = asDriverError(error);
            return failureResult(stage, EXIT_CODE_WORKER_FAILURE, DRIVER_ERROR_CODES.WORKER_ATTEMPT_FAILED, `Worker attempt threw: ${de.message}`);
        }
        // Step 18: worker disposal is C5-owned (coordinator disposed the child
        // inside runAttempt). Step 19: Pro parent disposed in finally.
        const workerOutcome = attemptResult.outcome;
        const workerPhase = attemptResult.runtime?.activeSlice?.phase ?? null;
        const workerSettled = attemptResult.settled;
        if (trace !== undefined) {
            trace.sessionsLiveAfter = sessions.liveSessionCount;
        }
        if (workerOutcome === 'SUCCESS' && workerSettled) {
            return {
                ok: true,
                exitCode: EXIT_CODE_SUCCESS,
                contractHash: stage.contractHash,
                sliceHash: stage.sliceHash,
                attemptId: stage.attemptId,
                commanderTurn: stage.commanderTurn,
                commanderTerminalKind: stage.commanderTerminalKind,
                commanderInstructionBytes: stage.commanderInstructionBytes,
                workerOutcome,
                workerPhase,
                workerSettled,
                error: null,
            };
        }
        // Worker settled non-SUCCESS or threw a recorded error.
        const err = attemptResult.error;
        return failureResult(stage, EXIT_CODE_WORKER_FAILURE, err ? err.code ?? DRIVER_ERROR_CODES.WORKER_ATTEMPT_FAILED : DRIVER_ERROR_CODES.WORKER_ATTEMPT_FAILED, err ? err.message : `Worker attempt settled with outcome ${String(workerOutcome)} (settled=${String(workerSettled)})`, workerOutcome, workerPhase, workerSettled);
    }
    finally {
        // Step 19: dispose the Pro parent exactly once. Worker (Flash child)
        // disposal is already C5-owned inside runAttempt; this only tears down the
        // commander. A dispose failure is swallowed so it cannot mask the real
        // result, but it is surfaced when the driver had not yet produced one.
        if (proHandle !== null) {
            try {
                await proHandle.dispose();
                if (trace !== undefined) {
                    trace.proDisposed = true;
                }
            }
            catch {
                // Dispose failure of the commander does not change the authoritative
                // worker/terminal outcome already recorded.
            }
        }
    }
}
//# sourceMappingURL=run.js.map