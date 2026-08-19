// S5.2 Tier-2 helper: construct a GENUINE minimal DSH runtime context
// (AgentRegistry / SessionStore / LlmRuntime / ToolRuntime / SystemPrompt /
// AgentLoop — all the real installed rc.7 services) with a deterministic
// scripted LLM adapter, so Pro/Flash agents run through the real AgentLoop /
// Session / ToolRuntime mechanics with ZERO network. No createFakeDshHarness
// is used; every service object below is the genuine installed class.
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Context } from '@deepseek-ai/cordis';
import { AgentRegistry } from '@deepseek-ai/dsh-agent';
import { SessionStore } from '@deepseek-ai/dsh-session';
import { LlmRuntime, LlmAdapter, CallId } from '@deepseek-ai/dsh-llm';
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm';
import { ToolRuntime } from '@deepseek-ai/dsh-tools';
import { SystemPrompt } from '@deepseek-ai/dsh-system-prompt';
import { AgentLoop } from '@deepseek-ai/dsh-agent-loop';
import WorkerThreadCodeRuntime from '@deepseek-ai/dsh-code-runtime-worker-thread';
import {
  createSupervisorRuntimeState,
  admitSlice,
} from '../../src/state/index.js';
import { FrozenContract, FrozenSlice } from '../../src/domain/index.js';
import {
  createDshWorkerPort,
  createWorkerLifecycleCoordinator,
} from '../../src/worker/index.js';
import { createSliceFsSessionRegistry } from '../../src/fs/index.js';
import type { ContractSupervisorService } from '../../src/integration/plugin.js';

/**
 * Deterministic scripted LLM adapter for provider 'deepseek-ai'. Routes on the
 * model id:
 *   - 'Pro'  → one completed turn emitting the commander instruction text.
 *   - 'Flash' → two-step: first a slice_read (or slice_write) tool-call, then
 *     (after the real tool result returns) a final completed text turn.
 *   - 'Probe' → one completed text turn. Used by the hostile-mode test: a
 *     plain probe agent WITHOUT the S5.2 zero-tool setup, proving what the
 *     deployment default surface exposes to a non-overridden agent.
 *
 * Every request is recorded so Tier-2 can prove the Pro, Flash, and Probe
 * requests were dispatched separately with the right provider/model/tools.
 */
export class ScriptedDshAdapter extends LlmAdapter {
  readonly proRequests: GenerateOptions[] = [];
  readonly flashRequests: GenerateOptions[] = [];
  readonly probeRequests: GenerateOptions[] = [];
  readonly proInstruction = 'Read src/a.ts using slice_read and report success.';
  readonly readPath = 'src/a.ts';
  /** When true, Pro yields an empty completed turn (fail-closed exercise). */
  readonly proEmpty: boolean;
  /** Which worker tool the Flash worker flow scripts. */
  readonly workerTool: 'slice_read' | 'slice_write';
  readonly writePath: string;
  readonly writeContent: string;

  constructor(
    options: {
      proEmpty?: boolean;
      workerTool?: 'slice_read' | 'slice_write';
      writePath?: string;
      writeContent?: string;
    } = {},
  ) {
    super();
    this.proEmpty = options.proEmpty === true;
    this.workerTool = options.workerTool ?? 'slice_read';
    this.writePath = options.writePath ?? 'src/a.ts';
    this.writeContent = options.writeContent ?? 'slice-written-by-s52';
  }

  providerInfo(provider: string) {
    return { id: provider, name: 'Scripted DSH (S5.2 Tier-2)' };
  }

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    if (options.model === 'Pro') {
      this.proRequests.push(options);
      yield { type: 'usage', usage: { inputTokens: 0, outputTokens: 0 } };
      if (!this.proEmpty) {
        yield { type: 'block-start', index: 0, blockType: 'text' };
        yield {
          type: 'block-end',
          index: 0,
          block: { type: 'text', text: this.proInstruction },
        };
      }
      yield { type: 'finish', reason: { kind: 'stop' } };
      return;
    }

    // Hostile-mode probe agent: no S5.2 setup ever runs on this agent, so its
    // request tools reflect the deployment default presentation verbatim.
    if (options.model === 'Probe') {
      this.probeRequests.push(options);
      yield { type: 'usage', usage: { inputTokens: 0, outputTokens: 0 } };
      yield { type: 'block-start', index: 0, blockType: 'text' };
      yield {
        type: 'block-end',
        index: 0,
        block: { type: 'text', text: 'Probe turn complete.' },
      };
      yield { type: 'finish', reason: { kind: 'stop' } };
      return;
    }

    // Flash worker.
    this.flashRequests.push(options);
    const hasToolResult = options.messages.some(
      (m) =>
        Array.isArray(m.content) &&
        m.content.some((b) => b && typeof b === 'object' && b.type === 'tool-result'),
    );
    yield { type: 'usage', usage: { inputTokens: 0, outputTokens: 0 } };
    if (!hasToolResult) {
      const callId = CallId('flash-slice-read-1');
      const toolName = this.workerTool;
      const args = JSON.stringify(
        toolName === 'slice_read'
          ? { path: this.readPath }
          : { path: this.writePath, content: this.writeContent },
      );
      yield { type: 'block-start', index: 0, blockType: 'tool-call' };
      yield {
        type: 'tool-call-delta',
        index: 0,
        id: callId,
        name: toolName,
        argumentsDelta: args,
      };
      yield {
        type: 'block-end',
        index: 0,
        block: { type: 'tool-call', id: callId, name: toolName, arguments: args },
      };
      yield { type: 'finish', reason: { kind: 'tool-calls' } };
    } else {
      yield { type: 'block-start', index: 0, blockType: 'text' };
      yield {
        type: 'block-end',
        index: 0,
        block: { type: 'text', text: 'Done. The file was read successfully.' },
      };
      yield { type: 'finish', reason: { kind: 'stop' } };
    }
  }
}

export interface Tier2Boot {
  readonly ctx: Context;
  readonly adapter: ScriptedDshAdapter;
  cleanup(): Promise<void>;
}

/**
 * Construct a genuine minimal DSH runtime context: the real installed
 * AgentRegistry, SessionStore, LlmRuntime, ToolRuntime, SystemPrompt, and
 * AgentLoop services on a fresh Cordis Context, plus the contractSupervisor
 * service seam built from the real C5 factories. A scripted adapter is
 * registered for provider 'deepseek-ai'. No profile/boot/disk persistence is
 * involved; every service object is the genuine installed class.
 *
 * `toolsMode: 'code'` mounts a GENUINE WorkerThreadCodeRuntime and constructs
 * ToolRuntime with the deployment default `mode: 'code'` — the hostile
 * deployment the M-2 repair must survive (a plain agent would see `run_code`;
 * the commander's zero-tool surface must still win).
 */
export async function bootTier2Context(
  options: {
    proEmpty?: boolean;
    toolsMode?: 'native' | 'code';
    workerTool?: 'slice_read' | 'slice_write';
    writePath?: string;
    writeContent?: string;
  } = {},
): Promise<Tier2Boot> {
  const adapter = new ScriptedDshAdapter(options);
  const root = new Context();
  new SystemPrompt(root, {});
  new ToolRuntime(root, options.toolsMode === 'code' ? { mode: 'code' } : {});
  if (options.toolsMode === 'code') {
    // Inert until a run_code program executes; the probe proves the exposed
    // surface, it never runs code. Without this the non-native default fails
    // prompt assembly (requireCodeRuntime), masking the very hostility proved.
    // The class validates its raw config directly (no schema resolution), so
    // every cap is passed explicitly.
    new WorkerThreadCodeRuntime(root, {
      computeMs: 60_000,
      maxWallMs: 600_000,
      maxOutputBytes: 67_108_864,
      maxOldGenerationSizeMb: 512,
    });
  }
  new SessionStore(root);
  const llm = new LlmRuntime(root);
  new AgentRegistry(root);
  new AgentLoop(root, { agents: [] });
  llm.registerAdapter(['deepseek-ai'], adapter);

  const service: ContractSupervisorService = Object.freeze({
    name: 'contractSupervisor',
    createSupervisorRuntimeState,
    admitSlice,
    createFrozenContract: (input: never) => FrozenContract.create(input),
    createFrozenSlice: (input: never) => FrozenSlice.create(input),
    createDshWorkerPort,
    createWorkerLifecycleCoordinator,
    createSliceFsSessionRegistry,
  });
  root.provide('contractSupervisor', service);

  // Let the fiber settle so all services reach ACTIVE before agents are created.
  await root.fiber.await();

  return {
    ctx: root,
    adapter,
    async cleanup() {
      try {
        await root.fiber.dispose();
      } catch {
        // Best-effort cleanup; the temp context is discarded either way.
      }
    },
  };
}

/** Create a temp repo root with src/a.ts and return it. */
export async function makeTier2Repo(content = 'hello-s52'): Promise<{
  root: string;
  cleanup: () => Promise<void>;
}> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-s52-repo-'));
  await mkdir(join(root, 'src'), { recursive: true });
  await writeFile(join(root, 'src', 'a.ts'), content, 'utf8');
  return { root, cleanup: () => rm(root, { recursive: true, force: true }) };
}

/** A valid RunSpec v1 document for Tier-2, bound to a repo root. */
export function tier2RunSpec(
  repoRoot: string,
  options: {
    workerTool?: 'slice_read' | 'slice_write';
    writePath?: string;
    writeOperation?: 'create' | 'update';
  } = {},
): Record<string, unknown> {
  const workerTool = options.workerTool ?? 'slice_read';
  const writePath = options.writePath ?? 'src/a.ts';
  const writeOperation = options.writeOperation ?? 'update';
  return {
    version: 1,
    repoRoot,
    contract: {
      contractId: 's52-tier2',
      version: '1.0.0',
      schemaVersion: '1',
      repoIdentity: 'tier2-repo',
      baselineTree: '0000000000000000000000000000000000000000',
      objective: 'Tier-2 end-to-end Pro commander -> Flash worker',
      nonGoals: [],
      readAuthority: ['src/**'],
      writeAuthority: [{ path: writePath, operation: writeOperation }],
      frozenApis: [],
      invariants: [],
      prohibitions: [],
      verifierCatalog: [],
      regressionVerifierRefs: [],
      workerToolAllowlist: [workerTool],
      reviewerToolAllowlist: [],
      threatModel: 'none',
      createdAt: '2024-01-01',
      frozenAt: '2024-01-01',
      frozenBy: 'tier2',
    },
    slice: {
      sliceId: 's52-tier2-slice',
      parentCheckpointHash: '0000000000000000000000000000000000000000',
      objective: 'Read src/a.ts and report',
      postcondition: 'src/a.ts was read via slice_read',
      allowedReads: ['src/**'],
      allowedWrites: [{ path: writePath, operation: writeOperation }],
      frozenApiRefs: [],
      invariantRefs: [],
      prohibitionRefs: [],
      verifierRefs: [],
      regressionVerifierRefs: [],
      workerToolAllowlist: [workerTool],
      maxAttempts: 1,
      wallTimeout: 60_000,
      turnBudget: null,
    },
  };
}
