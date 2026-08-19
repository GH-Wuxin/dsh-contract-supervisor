// S5.2 Tier-3 (M-1 + M-2 repairs):
//
//   S52-LT-A — the production CLI seam (src/cli/cmdline.ts) exercised through
//   a GENUINE Cordis Loader tree in which the contractSupervisor plugin and
//   the agents runtime are SIBLING loader entries — the same topology the
//   real dogfood profile gets from dsh-base. The driver is reached through
//   the production subcommand path (provideCmdline + parseCmdline + appExit),
//   NOT through a direct call. This test FAILS if the plugin's
//   `inject: ['agents']` dependency is removed: the plugin fiber's `ctx.agents`
//   then throws and the seam exits 1 with COMMANDER_SPAWN_FAILED, and the
//   fiber-shape assertions below also fail.
//
//   S52-HM-A — the hostile deployment default: ToolRuntime with the genuine
//   `mode: 'code'` config plus a genuine WorkerThreadCodeRuntime. A plain
//   probe agent (no S5.2 setup) sees the reserved `run_code` transport in its
//   first request; the commander's zero-tool surface must still ship an empty
//   tools array, proving the M-2 repair (presentAs('native') then
//   restrict({ allow: [] })) freezes the commander against the deployment
//   default.
import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Context } from '@deepseek-ai/cordis';
import { boot } from '@deepseek-ai/dsh-app-boot';
import { provideCmdline } from '@deepseek-ai/dsh-cmdline';
import { AgentRegistry } from '@deepseek-ai/dsh-agent';
import { AgentLoop } from '@deepseek-ai/dsh-agent-loop';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { SessionId } from '@deepseek-ai/dsh-session';
import { LlmRuntime } from '@deepseek-ai/dsh-llm';
import { SessionStore } from '@deepseek-ai/dsh-session';
import { SystemPrompt } from '@deepseek-ai/dsh-system-prompt';
import { ToolRuntime } from '@deepseek-ai/dsh-tools';
import plugin from '../../src/integration/plugin.js';
import { runContractSupervisorDriver } from '../../src/driver/run.js';
import type { DriverTrace } from '../../src/driver/run.js';
import {
  bootTier2Context,
  makeTier2Repo,
  ScriptedDshAdapter,
  tier2RunSpec,
} from './tier2-helpers.js';
import type { Tier2Boot } from './tier2-helpers.js';

const TIER3_TIMEOUT = 120_000;

// ---------- loader-tree kit ----------

/**
 * Structural view of a Cordis Fiber sufficient for the topology assertions:
 * runtime (null for the root fiber), the resolved inject map, and the store
 * snapshot of required service implementations.
 */
interface LoaderFiberProbe {
  readonly runtime: { readonly name: string } | null;
  readonly inject: Record<string, unknown>;
  readonly store: Record<string, LoaderImplProbe | undefined>;
}

/** A service implementation record as snapshotted by `fiber.store`. */
interface LoaderImplProbe {
  readonly name: string;
  readonly value: unknown;
  readonly fiber: LoaderFiberProbe;
}

interface LoaderCtxProbe {
  readonly fiber: LoaderFiberProbe;
}

interface LoaderTreeKit {
  readonly plugin: typeof plugin;
  readonly adapter: ScriptedDshAdapter;
  readonly SystemPrompt: typeof SystemPrompt;
  readonly ToolRuntime: typeof ToolRuntime;
  readonly SessionStore: typeof SessionStore;
  readonly LlmRuntime: typeof LlmRuntime;
  readonly AgentRegistry: typeof AgentRegistry;
  readonly AgentLoop: typeof AgentLoop;
  readonly activationOrder: string[];
  readonly captureRuntimeContext: (ctx: unknown) => void;
  readonly capturePluginContext: (ctx: unknown) => void;
}

interface KitCapture {
  readonly activationOrder: string[];
  runtimeCtx: unknown;
  pluginCtx: unknown;
}

/**
 * Install the kit on globalThis so the temp loader entry modules (plain ESM,
 * ZERO imports) receive the genuine classes, the production plugin, and the
 * scripted adapter. The entry modules are the ONLY loader-visible surface;
 * the loader never sees this test file.
 */
function installKit(adapter: ScriptedDshAdapter): KitCapture {
  const capture: KitCapture = {
    activationOrder: [],
    runtimeCtx: null,
    pluginCtx: null,
  };
  (globalThis as unknown as { __S52_LOADER_TREE_KIT__?: LoaderTreeKit }).__S52_LOADER_TREE_KIT__ = {
    plugin,
    adapter,
    SystemPrompt,
    ToolRuntime,
    SessionStore,
    LlmRuntime,
    AgentRegistry,
    AgentLoop,
    activationOrder: capture.activationOrder,
    captureRuntimeContext: (ctx: unknown) => {
      capture.runtimeCtx = ctx;
    },
    capturePluginContext: (ctx: unknown) => {
      capture.pluginCtx = ctx;
    },
  };
  return capture;
}

function uninstallKit(): void {
  delete (globalThis as unknown as { __S52_LOADER_TREE_KIT__?: LoaderTreeKit }).__S52_LOADER_TREE_KIT__;
}

async function waitUntil(predicate: () => boolean, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error('timed out waiting for the production cmdline driver run (appExit)');
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

// ---------- S52-LT-A: loader-tree production CLI seam ----------

describe('S5.2 Tier-3 loader tree: production CLI seam over genuine sibling entries', () => {
  it(
    'S52-LT-A plugin fiber injects the sibling AgentRegistry; the driver runs through the real cmdline path',
    async () => {
      const bootDir = await mkdtemp(join(tmpdir(), 'dsh-s52-lt-boot-'));
      const repo = await makeTier2Repo();
      const adapter = new ScriptedDshAdapter({
        workerTool: 'slice_write',
        writePath: 'out/result.txt',
        writeContent: 'loader-tree-output',
      });
      const capture = installKit(adapter);

      // Temp boot dir: config + the two sibling entry modules (plain ESM,
      // zero imports — they receive everything through the kit).
      await writeFile(join(bootDir, 'cordis.yml'), '[]\n', 'utf8');
      await writeFile(
        join(bootDir, 'runtime-entry.mjs'),
        [
          'const kit = globalThis.__S52_LOADER_TREE_KIT__;',
          "export const name = 's52-runtime-entry';",
          'export function apply(ctx) {',
          "  kit.activationOrder.push('runtime-entry');",
          '  kit.captureRuntimeContext(ctx);',
          '  new kit.SystemPrompt(ctx, {});',
          '  new kit.ToolRuntime(ctx, {});',
          '  new kit.SessionStore(ctx);',
          '  const llm = new kit.LlmRuntime(ctx);',
          '  new kit.AgentRegistry(ctx);',
          '  new kit.AgentLoop(ctx, { agents: [] });',
          "  llm.registerAdapter(['deepseek-ai'], kit.adapter);",
          '}',
        ].join('\n'),
        'utf8',
      );
      await writeFile(
        join(bootDir, 'supervisor-entry.mjs'),
        [
          'const kit = globalThis.__S52_LOADER_TREE_KIT__;',
          'const plugin = kit.plugin;',
          'export const name = plugin.name;',
          'export const inject = plugin.inject;',
          'export const Config = plugin.Config;',
          'export function apply(ctx, config) {',
          "  kit.activationOrder.push('contract-supervisor');",
          '  kit.capturePluginContext(ctx);',
          '  return plugin.apply(ctx, config);',
          '}',
        ].join('\n'),
        'utf8',
      );
      const specPath = join(bootDir, 'run-spec.json');
      await writeFile(
        specPath,
        JSON.stringify(
          tier2RunSpec(repo.root, {
            workerTool: 'slice_write',
            writePath: 'out/result.txt',
            writeOperation: 'create',
          }),
        ),
        'utf8',
      );
      await mkdir(join(repo.root, 'out'), { recursive: true });

      // Capture stdout during the boot + driver window (forward everything).
      const originalWrite = process.stdout.write;
      const captured: string[] = [];
      const stdout = process.stdout as unknown as {
        write(chunk: string | Uint8Array): boolean;
      };
      stdout.write = (chunk) => {
        captured.push(String(chunk));
        return originalWrite.call(process.stdout, chunk) as boolean;
      };

      let exitCode: number | null = null;
      let ctx: Context | null = null;
      try {
        ctx = await boot(
          'dsh',
          join(bootDir, 'cordis.yml'),
          [
            {
              insert: [
                { id: 'runtime-entry', name: './runtime-entry.mjs', config: {} },
                { id: 'contract-supervisor', name: './supervisor-entry.mjs', config: {} },
              ],
            },
          ],
          (hostCtx) => {
            // The production launcher pattern: provideCmdline in the prepare
            // hook, before any config-tree entry mounts.
            provideCmdline(hostCtx, {
              args: ['contract-supervisor-run', '--spec', specPath],
              exit: (code: number) => {
                exitCode = code;
              },
            });
          },
        );

        // NOTE: the Cordis context is a service-resolution proxy: reading any
        // unknown property THROWS ("cannot get property ... without inject"),
        // and vitest's expect() introspects its argument (asymmetricMatch),
        // which would throw. Every value below is therefore extracted into a
        // plain shape BEFORE it reaches an assertion.
        const pluginCtx = capture.pluginCtx as unknown as LoaderCtxProbe;
        const runtimeCtx = capture.runtimeCtx as unknown as LoaderCtxProbe;
        const pluginFiber = pluginCtx.fiber;
        const runtimeFiber = runtimeCtx.fiber;
        const rootFiber = (ctx as unknown as LoaderCtxProbe).fiber;
        const pluginName = pluginFiber.runtime?.name;
        const runtimeEntryName = runtimeFiber.runtime?.name;
        const injectKeys = Object.keys(pluginFiber.inject);
        const agentsImpl = pluginFiber.store['agents'];
        const agentsValue = agentsImpl?.value;
        const agentsProviderFiber = agentsImpl?.fiber;
        const agentsViaInject = (pluginCtx as unknown as Record<string, unknown>)['agents'];
        const activationOrder = [...capture.activationOrder];

        // The plugin ran in its OWN fiber, a SIBLING of the runtime entry —
        // not the root fiber, not the runtime-entry fiber.
        expect(typeof pluginCtx).toBe('object');
        expect(typeof runtimeCtx).toBe('object');
        expect(pluginFiber).not.toBe(runtimeFiber);
        expect(pluginFiber).not.toBe(rootFiber);
        expect(pluginName).toBe('contract-supervisor');
        expect(runtimeEntryName).toBe('s52-runtime-entry');

        // B-1: the plugin fiber's inject map declares exactly `agents`, and
        // the resolved store entry is the SIBLING runtime entry's
        // AgentRegistry — the provider fiber is the runtime entry.
        expect(injectKeys).toEqual(['agents']);
        expect(agentsImpl).toBeTruthy();
        expect(agentsProviderFiber).toBe(runtimeFiber);
        expect(agentsValue).toBeInstanceOf(AgentRegistry);
        // The property the production seam reads (`ctx.agents`) resolves
        // through the inject snapshot to exactly that AgentRegistry. (The
        // context proxy hands back the value through its error-tracing
        // wrapper, so identity is compared semantically, not by reference.)
        expect(agentsViaInject).toBeInstanceOf(AgentRegistry);

        // The plugin's apply was gated on the provider: activation order is
        // deterministic — runtime entry first, THEN the plugin.
        expect(activationOrder).toEqual(['runtime-entry', 'contract-supervisor']);

        // Wait for the production cmdline action (parseCmdline → driver →
        // stdout JSON → appExit).
        await waitUntil(() => exitCode !== null, TIER3_TIMEOUT);
        expect(exitCode).toBe(0);

        // The driver result JSON on stdout: success, no COMMANDER_SPAWN_FAILED.
        const jsonLines = captured
          .join('')
          .split(/\r?\n/)
          .filter((line) => line.trim().startsWith('{'));
        expect(jsonLines).toHaveLength(1);
        const result = JSON.parse(jsonLines[0]) as {
          ok: boolean;
          exitCode: number;
          error: { code: string; message: string } | null;
          commanderTerminalKind: string | null;
          commanderInstructionBytes: number | null;
          commanderTurn: number | null;
          workerOutcome: string | null;
          workerPhase: string | null;
          workerSettled: boolean;
        };
        expect(result.ok).toBe(true);
        expect(result.exitCode).toBe(0);
        expect(result.error).toBeNull();
        expect(result.commanderTerminalKind).toBe('completed');
        expect(result.commanderInstructionBytes).toBeGreaterThan(0);
        expect(result.commanderTurn).toBe(1);
        expect(result.workerOutcome).toBe('SUCCESS');
        expect(result.workerPhase).toBe('WORKER_STOPPED');
        // C5-owned: the coordinator releases the slice FS session before the
        // child is disposed inside runAttempt, so workerSettled implies the
        // FS session was released.
        expect(result.workerSettled).toBe(true);

        // The Pro request the plugin-fiber driver made: provider/model and an
        // EMPTY model-visible tool surface (M-2 repair, native default).
        expect(adapter.proRequests).toHaveLength(1);
        expect(adapter.proRequests[0].provider).toBe('deepseek-ai');
        expect(adapter.proRequests[0].model).toBe('Pro');
        expect(adapter.proRequests[0].tools ?? []).toHaveLength(0);

        // Flash worker: fresh child flow through slice_write; the expected
        // output file mutation occurred on disk.
        expect(adapter.flashRequests.length).toBe(2);
        expect(adapter.flashRequests[0].provider).toBe('deepseek-ai');
        expect(adapter.flashRequests[0].model).toBe('Flash');
        expect((adapter.flashRequests[0].tools ?? []).map((t) => t.name)).toEqual([
          'slice_write',
        ]);
        const written = await readFile(join(repo.root, 'out', 'result.txt'), 'utf8');
        expect(written).toBe('loader-tree-output');

        // req 10/11 on the SAME booted tree: a second direct traced run proves
        // live FS sessions == 0 and the Pro handle disposed. The adapter
        // scripts slice_write, and out/result.txt already exists, so the spec
        // grants the matching update authority.
        const trace: DriverTrace = {};
        const direct = await runContractSupervisorDriver(
          ctx as never,
          tier2RunSpec(repo.root, {
            workerTool: 'slice_write',
            writePath: 'out/result.txt',
            writeOperation: 'update',
          }),
          trace,
        );
        expect(direct.ok).toBe(true);
        expect(trace.proDisposed).toBe(true);
        expect(trace.sessionsLiveAfter).toBe(0);

        // Clean disposal of the whole loader tree (no throw).
        await ctx.fiber.dispose();
      } finally {
        stdout.write = originalWrite;
        uninstallKit();
        await rm(bootDir, { recursive: true, force: true });
        await repo.cleanup();
      }
    },
    TIER3_TIMEOUT,
  );
});

// ---------- S52-HM-A: hostile deployment default (tools mode: code) ----------

describe('S5.2 Tier-3 hostile deployment default (tools mode: code)', () => {
  it(
    'S52-HM-A a plain agent sees run_code while the commander ships zero tools',
    async () => {
      const boot: Tier2Boot = await bootTier2Context({ toolsMode: 'code' });
      const repo = await makeTier2Repo();
      try {
        // Probe: a plain agent WITHOUT the S5.2 zero-tool setup, created
        // directly from the genuine AgentRegistry. Its first request exposes
        // the deployment default surface verbatim.
        const probeHandle = await boot.ctx.agents.create({
          sessionId: SessionId(randomUUID()),
          meta: { cwd: repo.root },
          agentOptions: {
            provider: 'deepseek-ai',
            model: 'Probe',
            subagentDepth: 0,
          },
          signal: new AbortController().signal,
        });
        const probe = probeHandle.agent as {
          followup(message: unknown): void;
          whenIdle(): Promise<void>;
        };
        probe.followup(
          createUserMessage({
            content: [{ type: 'text', text: 'Hello probe.' }],
            source: { kind: 'user' },
          }),
        );
        await probe.whenIdle();
        await probeHandle.dispose();

        // Hostility proven: under the genuine code-mode default, the plain
        // agent's FIRST request exposes the reserved run_code transport.
        expect(boot.adapter.probeRequests.length).toBeGreaterThanOrEqual(1);
        expect(boot.adapter.probeRequests[0].model).toBe('Probe');
        expect((boot.adapter.probeRequests[0].tools ?? []).map((t) => t.name)).toEqual([
          'run_code',
        ]);

        // Now the production driver on the SAME hostile tree.
        const trace: DriverTrace = {};
        const result = await runContractSupervisorDriver(
          boot.ctx as never,
          tier2RunSpec(repo.root),
          trace,
        );
        expect(result.ok).toBe(true);
        expect(result.exitCode).toBe(0);
        expect(result.commanderTerminalKind).toBe('completed');
        expect(result.commanderInstructionBytes).toBeGreaterThan(0);

        // M-2 repair: the commander's zero-tool surface wins despite the
        // hostile default — first Pro request has an EMPTY tools array.
        expect(boot.adapter.proRequests.length).toBeGreaterThanOrEqual(1);
        expect(boot.adapter.proRequests[0].provider).toBe('deepseek-ai');
        expect(boot.adapter.proRequests[0].model).toBe('Pro');
        expect(boot.adapter.proRequests[0].tools ?? []).toHaveLength(0);

        // The Flash worker still sees only the authentic Slice tools.
        expect(boot.adapter.flashRequests.length).toBeGreaterThanOrEqual(1);
        expect(boot.adapter.flashRequests[0].model).toBe('Flash');
        expect((boot.adapter.flashRequests[0].tools ?? []).map((t) => t.name)).toEqual([
          'slice_read',
        ]);

        // Lifecycle: Pro disposed, no live FS sessions after completion.
        expect(trace.proDisposed).toBe(true);
        expect(trace.sessionsLiveAfter).toBe(0);
      } finally {
        await repo.cleanup();
        await boot.cleanup();
      }
    },
    TIER3_TIMEOUT,
  );
});