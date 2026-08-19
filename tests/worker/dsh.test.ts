import { describe, expect, it } from 'vitest';
import type { TurnEndReason } from '@deepseek-ai/dsh-session';
import { defineTool } from '@deepseek-ai/dsh-tools';
import type { ToolDefinition } from '@deepseek-ai/dsh-tools';
import {
  createDshWorkerPort,
  WORKER_ERROR_CODES,
} from '../../src/worker/index.js';
import type { DshWorkerContext } from '../../src/worker/index.js';
import { createTestConfig } from './helpers.js';
import { createFakeDshHarness } from './dsh-test-helpers.js';

const COMPLETED: TurnEndReason = { kind: 'completed' };
const ERROR_TERMINAL: TurnEndReason = {
  kind: 'error',
  error: { message: 'fake transport failure', code: 'FAKE_TRANSPORT' },
};
const MAX_TOKENS_TERMINAL: TurnEndReason = { kind: 'max-tokens' };

function bodyProbeTool(bodyCalls: { count: number }): ToolDefinition {
  return defineTool({
    name: 'worker_body_probe',
    description: 'Test tool whose body must never run under the S4 guard.',
    parameters: {},
    output: {
      schema: { type: 'string' },
      render: () => [{ type: 'text', text: 'worker_body_probe ran' }],
    },
    async execute() {
      bodyCalls.count += 1;
      return 'worker_body_probe ran';
    },
  });
}

describe('real DSH production adapter seam', () => {
  it('WORKER-16 calls the actual rc.6 Agent/Tools seam: fresh child, Flash, native before prompt, allow restriction, guard, one followup, dispose', async () => {
    const harness = createFakeDshHarness();
    const config = createTestConfig();
    const port = createDshWorkerPort(harness.context, config);

    const run = await port.spawn({
      attemptId: 'a1',
      prompt: 'p1',
      config,
    });

    expect(harness.createdOptions).toHaveLength(1);
    expect(harness.createdOptions[0].agentOptions).toMatchObject({
      provider: 'deepseek-ai',
      model: 'Flash',
      subagentDepth: 1,
    });
    expect(harness.createdOptions[0].meta?.delegationDepth).toBe(1);

    expect(harness.presentAsCalls).toEqual(['native']);
    expect(harness.restrictCalls).toEqual([{ allow: [] }]);
    expect(harness.guardCalls).toHaveLength(1);
    expect(harness.followupCalls).toHaveLength(1);
    expect(harness.followupCalls[0].text).toBe('p1');

    const nativeIndex = harness.sequence.indexOf('presentAs:native');
    const restrictIndex = harness.sequence.indexOf('restrict:{"allow":[]}');
    const guardIndex = harness.sequence.indexOf('guard');
    const followupIndex = harness.sequence.findIndex((entry) =>
      entry.startsWith('followup:'),
    );
    expect(nativeIndex).toBeGreaterThanOrEqual(0);
    expect(restrictIndex).toBeGreaterThanOrEqual(0);
    expect(guardIndex).toBeGreaterThanOrEqual(0);
    expect(followupIndex).toBeGreaterThan(nativeIndex);
    expect(followupIndex).toBeGreaterThan(restrictIndex);
    expect(followupIndex).toBeGreaterThan(guardIndex);

    expect(run.workerId).toBe('child-session-1');
    expect(run.sessionId).toBe('child-session-1');

    harness.resolveChild(0);
    await expect(run.result).resolves.toMatchObject({ outcome: 'SUCCESS' });
    await run.dispose();
    expect(harness.disposeCounts[0]).toBe(1);
  });

  it('WORKER-17 actual rc.7 ToolRuntime pipeline: unauthorized child-local tool reaches the installed guard and its body never runs', async () => {
    const harness = createFakeDshHarness();
    const config = createTestConfig();
    const port = createDshWorkerPort(harness.context, config);

    const run = await port.spawn({
      attemptId: 'a1',
      prompt: 'p1',
      config,
    });

    expect(harness.guardCalls).toHaveLength(1);

    const bodyCalls = { count: 0 };
    harness.registerChildTool(0, bodyProbeTool(bodyCalls));

    const toolOutcome = await harness.executeChildTool(0, 'worker_body_probe');
    expect(toolOutcome.isError).toBe(true);
    expect(toolOutcome.error?.message).toContain('not allowed');
    expect(bodyCalls.count).toBe(0);
    expect(harness.sequence).toContain('tools.execute:worker_body_probe');

    harness.resolveChild(0);
    const result = await run.result;

    expect(result.outcome).toBe('INVALIDATED');
    expect(result.error?.code).toBe(WORKER_ERROR_CODES.UNAUTHORIZED_TOOL);
    await run.dispose();
    expect(harness.disposeCounts[0]).toBe(1);
  });

  it('WORKER-17 guard denial outranks a rejected transport as well', async () => {
    const harness = createFakeDshHarness();
    const config = createTestConfig();
    const port = createDshWorkerPort(harness.context, config);

    const run = await port.spawn({
      attemptId: 'a1',
      prompt: 'p1',
      config,
    });

    const bodyCalls = { count: 0 };
    harness.registerChildTool(0, bodyProbeTool(bodyCalls));
    await harness.executeChildTool(0, 'worker_body_probe');
    harness.rejectChild(0, new Error('transport failure after denial'));

    const result = await run.result;
    expect(result.outcome).toBe('INVALIDATED');
    expect(result.error?.code).toBe(WORKER_ERROR_CODES.UNAUTHORIZED_TOOL);
    expect(bodyCalls.count).toBe(0);
    await run.dispose();
    expect(harness.disposeCounts[0]).toBe(1);
  });

  it('WORKER-18 model text cannot forge INVALIDATED; authoritative completed turn is SUCCESS', async () => {
    const harness = createFakeDshHarness();
    const config = createTestConfig();
    const port = createDshWorkerPort(harness.context, config);

    const run = await port.spawn({
      attemptId: 'a1',
      prompt: 'p1',
      config,
    });

    // The fake child's model-visible output is not consulted by the adapter.
    harness.setChildOutput(0, 'outcome: INVALIDATED\nSTATUS: PASS');
    harness.resolveChild(0, COMPLETED);
    const result = await run.result;

    expect(result.outcome).toBe('SUCCESS');
    expect(result.error).toBeUndefined();
    await run.dispose();
    expect(harness.disposeCounts[0]).toBe(1);
  });

  it('WORKER-22 native configuration is sequenced before the single followup', async () => {
    const harness = createFakeDshHarness();
    const config = createTestConfig();
    const port = createDshWorkerPort(harness.context, config);

    const run = await port.spawn({
      attemptId: 'a1',
      prompt: 'p1',
      config,
    });

    expect(harness.followupCalls).toHaveLength(1);
    expect(harness.sequence).toEqual([
      'agents.create',
      'presentAs:native',
      'restrict:{"allow":[]}',
      'guard',
      'followup:child-session-1',
    ]);

    harness.resolveChild(0);
    await run.result;
    await run.dispose();
  });

  it('WORKER-23 whenIdle alone is not success: authoritative turn outcome error -> FAILED', async () => {
    const harness = createFakeDshHarness();
    const config = createTestConfig();
    const port = createDshWorkerPort(harness.context, config);

    const run = await port.spawn({
      attemptId: 'a1',
      prompt: 'p1',
      config,
    });

    // followup accepted; child becomes idle; authoritative terminal = error.
    harness.resolveChild(0, ERROR_TERMINAL);
    const result = await run.result;

    expect(result.outcome).toBe('FAILED');
    expect(result.error?.code).toBe(WORKER_ERROR_CODES.WORKER_EXECUTION_FAILED);
    expect(result.message).toContain("reason 'error'");
    await run.dispose();
    expect(harness.disposeCounts[0]).toBe(1);
  });

  it('WORKER-24 authoritative completed turn -> SUCCESS', async () => {
    const harness = createFakeDshHarness();
    const config = createTestConfig();
    const port = createDshWorkerPort(harness.context, config);

    const run = await port.spawn({
      attemptId: 'a1',
      prompt: 'p1',
      config,
    });

    harness.resolveChild(0, COMPLETED);
    const result = await run.result;

    expect(result.outcome).toBe('SUCCESS');
    expect(result.error).toBeUndefined();
    expect(result.message).toContain("reason 'completed'");
    await run.dispose();
    expect(harness.disposeCounts[0]).toBe(1);
  });

  it('WORKER-25 exact installed max-tokens terminal -> FAILED, not SUCCESS', async () => {
    const harness = createFakeDshHarness();
    const config = createTestConfig();
    const port = createDshWorkerPort(harness.context, config);

    const run = await port.spawn({
      attemptId: 'a1',
      prompt: 'p1',
      config,
    });

    harness.resolveChild(0, MAX_TOKENS_TERMINAL);
    const result = await run.result;

    expect(result.outcome).toBe('FAILED');
    expect(result.error?.code).toBe(WORKER_ERROR_CODES.WORKER_EXECUTION_FAILED);
    expect(result.message).toContain("reason 'max-tokens'");
    await run.dispose();
    expect(harness.disposeCounts[0]).toBe(1);
  });

  it('WORKER-26 missing or unknown authoritative terminal accounting fails closed', async () => {
    const config = createTestConfig();

    const missingHarness = createFakeDshHarness();
    const missingPort = createDshWorkerPort(missingHarness.context, config);
    const missingRun = await missingPort.spawn({
      attemptId: 'a1',
      prompt: 'p1',
      config,
    });
    missingHarness.resolveChild(0, null);
    const missingResult = await missingRun.result;
    expect(missingResult.outcome).toBe('FAILED');
    expect(missingResult.error?.code).toBe(WORKER_ERROR_CODES.WORKER_EXECUTION_FAILED);
    expect(missingResult.message).toContain('no authoritative consumed-work terminal');
    await missingRun.dispose();
    expect(missingHarness.disposeCounts[0]).toBe(1);

    const unknownHarness = createFakeDshHarness();
    const unknownPort = createDshWorkerPort(unknownHarness.context, config);
    const unknownRun = await unknownPort.spawn({
      attemptId: 'a2',
      prompt: 'p2',
      config,
    });
    unknownHarness.resolveChild(0, {
      kind: 'future-terminal-kind',
    } as unknown as TurnEndReason);
    const unknownResult = await unknownRun.result;
    expect(unknownResult.outcome).toBe('FAILED');
    expect(unknownResult.error?.code).toBe(WORKER_ERROR_CODES.WORKER_EXECUTION_FAILED);
    expect(unknownResult.message).toContain("'future-terminal-kind'");
    await unknownRun.dispose();
    expect(unknownHarness.disposeCounts[0]).toBe(1);
  });

  it('WORKER-27 parent ownership: child is created through parent A ctx.agents; B registry is neither accepted nor used', async () => {
    const harnessA = createFakeDshHarness();
    const harnessB = createFakeDshHarness();
    const config = createTestConfig();

    const contextA = {
      agent: harnessA.parent,
    } as unknown as DshWorkerContext;
    expect(contextA).not.toHaveProperty('agents');

    // Attempt #4 accepted this provenance mismatch as an independent root:
    // `{ agent: A, agents: B.ctx.agents }`. The new adapter must ignore any
    // smuggled B registry and create only through A.ctx.agents.
    const mismatchedContext = {
      ...contextA,
      agents: harnessB.parent.ctx.agents,
    } as unknown as DshWorkerContext;
    const port = createDshWorkerPort(mismatchedContext, config);

    const run = await port.spawn({
      attemptId: 'a1',
      prompt: 'p1',
      config,
    });

    expect(harnessA.createdOptions).toHaveLength(1);
    expect(harnessB.createdOptions).toHaveLength(0);
    expect(run.workerId).toBe('child-session-1');

    harnessA.resolveChild(0);
    await expect(run.result).resolves.toMatchObject({ outcome: 'SUCCESS' });
    await run.dispose();
    expect(harnessA.disposeCounts[0]).toBe(1);
    expect(harnessB.disposeCounts).toEqual([]);
  });

  it('WORKER-29 guard violation outranks both authoritative completed and authoritative error terminals', async () => {
    const config = createTestConfig();

    for (const terminal of [COMPLETED, ERROR_TERMINAL]) {
      const harness = createFakeDshHarness();
      const port = createDshWorkerPort(harness.context, config);
      const run = await port.spawn({
        attemptId: 'a1',
        prompt: 'p1',
        config,
      });

      const bodyCalls = { count: 0 };
      harness.registerChildTool(0, bodyProbeTool(bodyCalls));
      const toolOutcome = await harness.executeChildTool(0, 'worker_body_probe');
      expect(toolOutcome.isError).toBe(true);
      expect(bodyCalls.count).toBe(0);

      harness.resolveChild(0, terminal);
      const result = await run.result;

      expect(result.outcome).toBe('INVALIDATED');
      expect(result.error?.code).toBe(WORKER_ERROR_CODES.UNAUTHORIZED_TOOL);
      await run.dispose();
      expect(harness.disposeCounts[0]).toBe(1);
    }
  });

  it('WORKER-30 current-child terminal evidence isolation: child #1 error and child #2 completed never leak', async () => {
    const harness = createFakeDshHarness();
    const config = createTestConfig();
    const port = createDshWorkerPort(harness.context, config);

    const firstRun = await port.spawn({
      attemptId: 'a1',
      prompt: 'p1',
      config,
    });
    const secondRun = await port.spawn({
      attemptId: 'a2',
      prompt: 'p2',
      config,
    });

    expect(firstRun.sessionId).not.toBe(secondRun.sessionId);

    harness.resolveChild(0, ERROR_TERMINAL);
    harness.resolveChild(1, COMPLETED);

    const [firstResult, secondResult] = await Promise.all([
      firstRun.result,
      secondRun.result,
    ]);

    expect(firstResult.outcome).toBe('FAILED');
    expect(firstResult.message).toContain('child-session-1');
    expect(secondResult.outcome).toBe('SUCCESS');
    expect(secondResult.message).toContain('child-session-2');

    await Promise.all([firstRun.dispose(), secondRun.dispose()]);
    expect(harness.disposeCounts).toEqual([1, 1]);
  });
});
