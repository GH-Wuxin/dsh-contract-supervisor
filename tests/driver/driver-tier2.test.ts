import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { SessionId } from '@deepseek-ai/dsh-session';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { foldConsumedWork } from '@deepseek-ai/dsh-agent';
import { runContractSupervisorDriver } from '../../src/driver/run.js';
import type { DriverTrace } from '../../src/driver/run.js';
import {
  bootTier2Context,
  makeTier2Repo,
  tier2RunSpec,
} from './tier2-helpers.js';
import type { Tier2Boot } from './tier2-helpers.js';

const TIER2_TIMEOUT = 60_000;

let boot: Tier2Boot | null = null;
let repo: { root: string; cleanup: () => Promise<void> } | null = null;

async function freshBoot(options: { proEmpty?: boolean } = {}): Promise<Tier2Boot> {
  if (boot !== null) {
    await boot.cleanup();
    boot = null;
  }
  boot = await bootTier2Context(options);
  return boot;
}

beforeEach(async () => {
  repo = await makeTier2Repo();
});

afterEach(async () => {
  if (boot !== null) {
    await boot.cleanup();
    boot = null;
  }
  if (repo !== null) {
    await repo.cleanup();
    repo = null;
  }
});

// ---------- Test A: end-to-end driver run through genuine runtime ----------

describe('S5.2 Tier-2 genuine runtime: end-to-end driver (Pro -> Supervisor -> Flash)', () => {
  it(
    'S52-T2-A genuine Pro commander and Flash worker both run through the real AgentLoop',
    async () => {
      const { ctx, adapter } = await freshBoot();
      const trace: DriverTrace = {};
      const result = await runContractSupervisorDriver(
        ctx as never,
        tier2RunSpec(repo!.root),
        trace,
      );

      // req 16/17: worker outcome SUCCESS, phase WORKER_STOPPED
      expect(result.ok).toBe(true);
      expect(result.exitCode).toBe(0);
      expect(result.workerOutcome).toBe('SUCCESS');
      expect(result.workerPhase).toBe('WORKER_STOPPED');
      expect(result.workerSettled).toBe(true);

      // req 7/8: Pro authoritative terminal completed, instruction extracted
      expect(result.commanderTerminalKind).toBe('completed');
      expect(result.commanderTurn).not.toBeNull();
      expect(result.commanderInstructionBytes).toBeGreaterThan(0);

      // req 6: Pro followup actually dispatched (exactly one Pro request)
      expect(adapter.proRequests).toHaveLength(1);
      // req 3/4: Pro provider/model
      expect(adapter.proRequests[0].provider).toBe('deepseek-ai');
      expect(adapter.proRequests[0].model).toBe('Pro');
      // req 5: Pro model-visible tools exactly []
      expect(adapter.proRequests[0].tools ?? []).toHaveLength(0);

      // req 9/10: Flash provider/model (at least one Flash request)
      expect(adapter.flashRequests.length).toBeGreaterThanOrEqual(1);
      expect(adapter.flashRequests[0].provider).toBe('deepseek-ai');
      expect(adapter.flashRequests[0].model).toBe('Flash');
      // req 14: Flash visible tools exactly the authentic Slice effective tools
      const flashToolNames = (adapter.flashRequests[0].tools ?? []).map(
        (t) => t.name,
      );
      expect(flashToolNames).toEqual(['slice_read']);

      // req 15: one tiny authorized FS operation succeeds — the Flash made a
      // slice_read tool-call (step 1) and then a final completed turn (step 2),
      // which is only possible if slice_read executed and returned a result.
      expect(adapter.flashRequests.length).toBe(2);

      // req 11: Flash child is fresh (its session differs from Pro's)
      expect(trace.proSessionId).toBeTruthy();
      expect(trace.flashSessionId).toBeTruthy();
      expect(trace.flashSessionId).not.toBe(trace.proSessionId);
      // req 12: Pro ID != Flash child ID
      expect(trace.proId).not.toBe(trace.flashWorkerId);
      // req 13: Flash Agent.id == Session.id
      expect(trace.flashWorkerId).toBe(trace.flashSessionId);
      // req 18: live FS sessions after completion = 0
      expect(trace.sessionsLiveAfter).toBe(0);
      // req 19: Pro handle disposed
      expect(trace.proDisposed).toBe(true);

      // req 1 (same-boot Pro from ctx) is structural: the driver only reaches
      // ctx.agents, which is the genuine AgentRegistry on the booted context.
    },
    TIER2_TIMEOUT,
  );
});

// ---------- Test B: commander failure creates zero Flash children ----------

describe('S5.2 Tier-2 genuine runtime: commander failure creates zero Flash children', () => {
  it(
    'S52-T2-B empty commander output → no Flash request dispatched',
    async () => {
      const { ctx, adapter } = await freshBoot({ proEmpty: true });
      const trace: DriverTrace = {};
      const result = await runContractSupervisorDriver(
        ctx as never,
        tier2RunSpec(repo!.root),
        trace,
      );

      // Commander failed (empty output) before any Flash Attempt.
      expect(result.ok).toBe(false);
      expect(result.exitCode).toBe(2);
      expect(result.workerOutcome).toBeNull();
      // req 20: zero Flash children
      expect(adapter.flashRequests).toHaveLength(0);
      expect(trace.flashWorkerId).toBeUndefined();
      // Pro was still created and disposed.
      expect(adapter.proRequests).toHaveLength(1);
      expect(trace.proDisposed).toBe(true);
    },
    TIER2_TIMEOUT,
  );
});

// ---------- Test C: genuine Pro agent directly (ReactLoopAgent, zero tools, dispose) ----------

describe('S5.2 Tier-2 genuine runtime: real Pro commander agent', () => {
  it(
    'S52-T2-C same-boot Pro is a genuine ReactLoopAgent with zero tools, completed turn, disposable',
    async () => {
      const { ctx, adapter } = await freshBoot();

      // req 1/2: create a genuine top-level Pro agent from the booted ctx.
      const handle = await ctx.agents.create({
        sessionId: SessionId(randomUUID()),
        meta: { cwd: repo!.root },
        agentOptions: {
          provider: 'deepseek-ai',
          model: 'Pro',
          subagentDepth: 0,
        },
        signal: new AbortController().signal,
        setup: (agentCtx: { tools: { restrict(f: { allow: readonly string[] }): unknown } }) => {
          // Zero-tool surface: hide all inherited/global tools, register nothing.
          agentCtx.tools.restrict({ allow: [] });
        },
      });
      const agent = handle.agent as {
        id: unknown;
        session: { id: unknown; header: { seedLength?: number }; events: readonly unknown[] };
        followup(m: unknown): void;
        whenIdle(): Promise<void>;
        constructor: { name: string };
      };

      try {
        // req 2: genuine ReactLoopAgent constructor
        expect(agent.constructor.name).toBe('ReactLoopAgent');
        // req 13 (direct): Agent.id == Session.id
        expect(String(agent.id)).toBe(String(agent.session.id));
        // req 5 (direct): Pro model-visible tools exactly []
        const schemas = (ctx as { tools: { schemas(scope: unknown): { name: string }[] } }).tools.schemas(
          agent as never,
        );
        expect(schemas).toEqual([]);

        // req 6/7: followup actually dispatched -> authoritative completed turn
        agent.followup(
          createUserMessage({
            content: [{ type: 'text', text: 'Say hello.' }],
            source: { kind: 'user' },
          }),
        );
        await agent.whenIdle();
        const boundary = agent.session.header.seedLength ?? 0;
        const consumed = foldConsumedWork(
          agent.session.events.slice(boundary) as never,
        );
        expect(consumed.end).toBeDefined();
        expect(consumed.end?.data.reason.kind).toBe('completed');
        // The scripted Pro adapter served exactly one request.
        expect(adapter.proRequests).toHaveLength(1);
        expect(adapter.proRequests[0].model).toBe('Pro');
      } finally {
        // req 19 (direct): Pro handle is disposable
        await handle.dispose();
      }
    },
    TIER2_TIMEOUT,
  );
});
