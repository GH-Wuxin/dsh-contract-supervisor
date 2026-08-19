import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { TurnEndReason } from '@deepseek-ai/dsh-session';
import { CallId } from '@deepseek-ai/dsh-llm';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { defineTool } from '@deepseek-ai/dsh-tools';
import type { ToolDefinition } from '@deepseek-ai/dsh-tools';
import {
  createSliceFsAuthority,
  createSliceFsSessionRegistry,
  isPreparedSliceFsAuthority,
  SLICE_FS_TOOL_NAMES,
} from '../../src/fs/index.js';
import {
  createDshWorkerPort,
  WorkerLifecycleCoordinator,
  WORKER_ERROR_CODES,
} from '../../src/worker/index.js';
import { createFakeDshHarness } from '../worker/dsh-test-helpers.js';
import { createTestConfig } from '../worker/helpers.js';
import {
  admitFrozenSlice,
  createFsFixture,
  makeFrozenSlice,
  makeWorkerFsConfig,
  putFile,
} from './helpers.js';
import type { FsFixture } from './helpers.js';

const COMPLETED_TERMINAL: TurnEndReason = { kind: 'completed' };

let fixture: FsFixture;

beforeEach(async () => {
  fixture = await createFsFixture();
});

afterEach(async () => {
  await fixture.cleanup();
});

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (predicate()) {
      return;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('Timed out waiting for S5 session binding');
}

function bodyProbeTool(name: string, bodyCalls: { count: number }): ToolDefinition {
  return defineTool({
    name,
    description: 'Test-only tool whose body must not run under the effective guard.',
    parameters: {},
    output: {
      schema: { type: 'string' },
      render: () => [{ type: 'text', text: `${name} ran` }],
    },
    async execute() {
      bodyCalls.count += 1;
      return `${name} ran`;
    },
  });
}

describe('C4A real DSH ToolRuntime S5 pipeline', () => {
  it('FS-36 real DSH ToolRuntime authorized slice_read succeeds', async () => {
    const root = fixture.root;
    await putFile(root, 'src/fs/a.ts', 'before');
    const frozenSlice = makeFrozenSlice(
      'slice-read',
      ['src/fs/**'],
      [],
      ['slice_read'],
    );
    const runtime = admitFrozenSlice(frozenSlice);
    const config = createTestConfig(['slice_read']);
    const harness = createFakeDshHarness();
    const port = createDshWorkerPort(harness.context, config);
    const sessions = createSliceFsSessionRegistry();
    const coordinator = new WorkerLifecycleCoordinator(
      port,
      config,
      sessions,
      makeWorkerFsConfig(root, [frozenSlice]),
    );

    const resultPromise = coordinator.runAttempt({
      runtime,
      attemptId: 'a1',
      prompt: 'p1',
    });
    await waitFor(() => sessions.liveSessionCount === 1);
    const child = harness.children[0];
    expect(child.id).toBe(child.session.id);
    expect(child.agent.id).toBe(child.session.id);
    expect(harness.sequence).toContain('tools.register:slice_read');
    expect(harness.followupCalls).toHaveLength(1);

    const outcome = await harness.executeChildTool(0, 'slice_read', {
      path: 'src/fs/a.ts',
    });

    expect(outcome.isError).toBe(false);
    if (!outcome.isError) {
      expect(outcome.value).toMatchObject({ path: 'src/fs/a.ts', content: 'before' });
    }
    expect(harness.executionInputs[0]?.agent).toBe(child.agent);
    expect(sessions.getBinding(child.session.id)).not.toBeNull();

    harness.resolveChild(0, COMPLETED_TERMINAL);
    const result = await resultPromise;

    expect(result.settled).toBe(true);
    expect(result.outcome).toBe('SUCCESS');
    expect(result.runtime.activeSlice?.phase).toBe('WORKER_STOPPED');
    expect(harness.disposeCounts[0]).toBe(1);
    expect(sessions.liveSessionCount).toBe(0);
  });

  it('FS-37 real DSH ToolRuntime authorized slice_write succeeds', async () => {
    const root = fixture.root;
    await putFile(root, 'src/fs/a.ts', 'before');
    const frozenSlice = makeFrozenSlice(
      'slice-write',
      ['src/fs/**'],
      [{ path: 'src/fs/a.ts', operation: 'update' }],
      ['slice_write'],
    );
    const runtime = admitFrozenSlice(frozenSlice);
    const config = createTestConfig(['slice_write']);
    const harness = createFakeDshHarness();
    const port = createDshWorkerPort(harness.context, config);
    const sessions = createSliceFsSessionRegistry();
    const coordinator = new WorkerLifecycleCoordinator(
      port,
      config,
      sessions,
      makeWorkerFsConfig(root, [frozenSlice]),
    );

    const resultPromise = coordinator.runAttempt({
      runtime,
      attemptId: 'a1',
      prompt: 'p1',
    });

    await waitFor(() => sessions.liveSessionCount === 1);
    const child = harness.children[0];
    expect(harness.sequence).toContain('tools.register:slice_write');

    const outcome = await harness.executeChildTool(0, 'slice_write', {
      path: 'src/fs/a.ts',
      content: 'after',
    });

    expect(outcome.isError).toBe(false);
    expect(await readFile(join(root, 'src/fs/a.ts'), 'utf8')).toBe('after');

    harness.resolveChild(0, COMPLETED_TERMINAL);
    const result = await resultPromise;

    expect(result.settled).toBe(true);
    expect(result.outcome).toBe('SUCCESS');
    expect(result.runtime.activeSlice?.phase).toBe('WORKER_STOPPED');
    expect(harness.disposeCounts[0]).toBe(1);
    expect(sessions.liveSessionCount).toBe(0);
  });

  it('FS-38 real registered slice_* path violation invalidates Attempt', async () => {
    const root = fixture.root;
    await putFile(root, 'src/fs/allowed.ts', 'allowed');
    const frozenSlice = makeFrozenSlice(
      'slice-write-scope',
      ['src/fs/**'],
      [{ path: 'src/fs/allowed.ts', operation: 'update' }],
      ['slice_write'],
    );
    const runtime = admitFrozenSlice(frozenSlice);
    const config = createTestConfig(['slice_write']);
    const harness = createFakeDshHarness();
    const port = createDshWorkerPort(harness.context, config);
    const sessions = createSliceFsSessionRegistry();
    const coordinator = new WorkerLifecycleCoordinator(
      port,
      config,
      sessions,
      makeWorkerFsConfig(root, [frozenSlice]),
    );

    const resultPromise = coordinator.runAttempt({
      runtime,
      attemptId: 'a1',
      prompt: 'p1',
    });

    await waitFor(() => sessions.liveSessionCount === 1);
    const child = harness.children[0];

    const outcome = await harness.executeChildTool(0, 'slice_write', {
      path: 'src/fs/not-allowed.ts',
      content: 'unauthorized',
    });

    expect(outcome.isError).toBe(true);
    expect(existsSync(join(root, 'src/fs/not-allowed.ts'))).toBe(false);
    expect(sessions.getViolation(child.session.id)?.code).toBe(
      'SLICE_WRITE_SCOPE_VIOLATION',
    );

    harness.resolveChild(0, COMPLETED_TERMINAL);
    const result = await resultPromise;

    expect(result.settled).toBe(true);
    expect(result.outcome).toBe('INVALIDATED');
    expect(result.error?.code).toBe('SLICE_WRITE_SCOPE_VIOLATION');
    expect(result.runtime.activeSlice?.phase).toBe('SCOPE_BLOCKED');
    expect(harness.disposeCounts[0]).toBe(1);
    expect(sessions.liveSessionCount).toBe(0);
  });

  it('FS-39 per-Slice omitted tool is denied by real guard before body', async () => {
    const root = fixture.root;
    await putFile(root, 'src/fs/a.ts', 'before');
    const frozenSlice = makeFrozenSlice(
      'slice-read-only',
      ['src/fs/**'],
      [{ path: 'src/fs/a.ts', operation: 'update' }],
      ['slice_read'],
    );
    const runtime = admitFrozenSlice(frozenSlice);
    const config = createTestConfig([...SLICE_FS_TOOL_NAMES]);
    const harness = createFakeDshHarness();
    const port = createDshWorkerPort(harness.context, config);
    const sessions = createSliceFsSessionRegistry();
    const coordinator = new WorkerLifecycleCoordinator(
      port,
      config,
      sessions,
      makeWorkerFsConfig(root, [frozenSlice]),
    );

    const resultPromise = coordinator.runAttempt({
      runtime,
      attemptId: 'a1',
      prompt: 'p1',
    });

    await waitFor(() => sessions.liveSessionCount === 1);
    expect(harness.sequence).toContain('tools.register:slice_read');
    expect(harness.sequence).not.toContain('tools.register:slice_write');

    const bodyCalls = { count: 0 };
    harness.registerChildTool(0, bodyProbeTool('slice_write', bodyCalls));
    const outcome = await harness.executeChildTool(0, 'slice_write', {
      path: 'src/fs/a.ts',
      content: 'mutated',
    });

    expect(outcome.isError).toBe(true);
    expect(outcome.error?.message).toContain('not allowed');
    expect(bodyCalls.count).toBe(0);
    expect(await readFile(join(root, 'src/fs/a.ts'), 'utf8')).toBe('before');

    harness.resolveChild(0, COMPLETED_TERMINAL);
    const result = await resultPromise;

    expect(result.settled).toBe(true);
    expect(result.outcome).toBe('INVALIDATED');
    expect(result.error?.code).toBe(WORKER_ERROR_CODES.UNAUTHORIZED_TOOL);
    expect(result.runtime.activeSlice?.phase).toBe('SCOPE_BLOCKED');
    expect(harness.disposeCounts[0]).toBe(1);
    expect(sessions.liveSessionCount).toBe(0);
  });

  it('FS-40 generic C4 WorkerRun without WorkerFsConfig remains deny-all', async () => {
    const config = createTestConfig([...SLICE_FS_TOOL_NAMES]);
    const harness = createFakeDshHarness();
    const port = createDshWorkerPort(harness.context, config);
    const sessions = createSliceFsSessionRegistry();

    const run = await port.spawn({
      attemptId: 'a1',
      prompt: 'p1',
      config,
    });

    const child = harness.children[0];
    expect(harness.restrictCalls).toEqual([{ allow: [] }]);
    expect(harness.sequence.some((entry) => entry.startsWith('tools.register:'))).toBe(false);
    expect(sessions.liveSessionCount).toBe(0);
    expect(sessions.getBinding(child.session.id)).toBeNull();

    const bodyCalls = { count: 0 };
    harness.registerChildTool(0, bodyProbeTool('slice_read', bodyCalls));
    const outcome = await harness.executeChildTool(0, 'slice_read', {
      path: 'src/fs/a.ts',
    });

    expect(outcome.isError).toBe(true);
    expect(outcome.error?.message).toContain('not allowed');
    expect(bodyCalls.count).toBe(0);

    harness.resolveChild(0, COMPLETED_TERMINAL);
    const result = await run.result;

    expect(result.outcome).toBe('INVALIDATED');
    expect(result.error?.code).toBe(WORKER_ERROR_CODES.UNAUTHORIZED_TOOL);
    await run.dispose();
    expect(harness.disposeCounts[0]).toBe(1);
  });

  it('FS-41 authentic Slice requests tool outside WorkerConfig upper bound', async () => {
    const root = fixture.root;
    await putFile(root, 'src/fs/a.ts', 'before');
    const frozenSlice = makeFrozenSlice(
      'slice-over-request',
      ['src/fs/**'],
      [{ path: 'src/fs/a.ts', operation: 'update' }],
      ['slice_read', 'slice_write'],
    );
    const runtime = admitFrozenSlice(frozenSlice);
    const config = createTestConfig(['slice_read']);
    const harness = createFakeDshHarness();
    const port = createDshWorkerPort(harness.context, config);
    const sessions = createSliceFsSessionRegistry();
    const coordinator = new WorkerLifecycleCoordinator(
      port,
      config,
      sessions,
      makeWorkerFsConfig(root, [frozenSlice]),
    );

    await expect(
      coordinator.runAttempt({
        runtime,
        attemptId: 'a1',
        prompt: 'p1',
      }),
    ).rejects.toMatchObject({
      code: WORKER_ERROR_CODES.ACTIVE_SLICE_TOOL_POLICY_NOT_RECOVERABLE,
    });

    expect(harness.createdOptions).toHaveLength(0);
    expect(harness.followupCalls).toHaveLength(0);
    expect(sessions.liveSessionCount).toBe(0);
    expect(await readFile(join(root, 'src/fs/a.ts'), 'utf8')).toBe('before');
  });

  it('FS-42 copied prepared-authority brand is not sufficient', () => {
    const root = fixture.root;
    const created = createSliceFsAuthority({
      repoRoot: root,
      sliceId: 'slice-auth',
      allowedReads: ['src/fs/**'],
      allowedWrites: [],
    });

    const forgery = Object.create(null) as Record<PropertyKey, unknown>;
    for (const key of Reflect.ownKeys(created)) {
      Object.defineProperty(forgery, key, Object.getOwnPropertyDescriptor(created, key)!);
    }

    expect(isPreparedSliceFsAuthority(forgery as never)).toBe(false);

    const sessions = createSliceFsSessionRegistry();
    const binding = sessions.bind('forged-session', 'attempt-1', forgery as never);
    expect(binding.authority).not.toBe(created);
    expect(binding.authority.allowedReads).toEqual(['src/fs/**']);
    expect(isPreparedSliceFsAuthority(binding.authority)).toBe(true);
  });

  it('FS-43 child-local registration does not pollute parent tool surface', async () => {
    const root = fixture.root;
    await putFile(root, 'src/fs/a.ts', 'before');
    const frozenSlice = makeFrozenSlice(
      'slice-local',
      ['src/fs/**'],
      [{ path: 'src/fs/a.ts', operation: 'update' }],
      ['slice_read', 'slice_write'],
    );
    const runtime = admitFrozenSlice(frozenSlice);
    const config = createTestConfig([...SLICE_FS_TOOL_NAMES]);
    const harness = createFakeDshHarness();
    const port = createDshWorkerPort(harness.context, config);
    const sessions = createSliceFsSessionRegistry();
    const coordinator = new WorkerLifecycleCoordinator(
      port,
      config,
      sessions,
      makeWorkerFsConfig(root, [frozenSlice]),
    );

    const resultPromise = coordinator.runAttempt({
      runtime,
      attemptId: 'a1',
      prompt: 'p1',
    });
    await waitFor(() => sessions.liveSessionCount === 1);

    expect(harness.childVisibleToolNames(0)).toEqual(
      expect.arrayContaining(['slice_read', 'slice_write']),
    );
    expect(harness.parentVisibleToolNames()).not.toContain('slice_read');
    expect(harness.parentVisibleToolNames()).not.toContain('slice_write');

    const parentOutcome = await harness.parent.ctx.tools!.execute({
      callId: CallId('parent-slice-read'),
      name: 'slice_read',
      arguments: { path: 'src/fs/a.ts' },
      agent: harness.parent as never,
      signal: new AbortController().signal,
    });
    expect(parentOutcome.isError).toBe(true);

    harness.resolveChild(0, COMPLETED_TERMINAL);
    const result = await resultPromise;

    expect(result.settled).toBe(true);
    expect(result.outcome).toBe('SUCCESS');
    expect(harness.disposeCounts[0]).toBe(1);
    expect(sessions.liveSessionCount).toBe(0);
  });

  it('FS-44 cross-Attempt worker tool-surface isolation', async () => {
    const root = fixture.root;
    await putFile(root, 'src/fs/a.ts', 'a-before');
    await putFile(root, 'src/fs/b.ts', 'b-before');

    const sliceA = makeFrozenSlice(
      'slice-a',
      ['src/fs/**'],
      [{ path: 'src/fs/a.ts', operation: 'update' }],
      ['slice_read', 'slice_write'],
    );
    const sliceB = makeFrozenSlice(
      'slice-b',
      ['src/fs/**'],
      [{ path: 'src/fs/b.ts', operation: 'update' }],
      ['slice_read'],
    );
    const sliceC = makeFrozenSlice(
      'slice-c',
      ['src/fs/**'],
      [],
      [],
    );

    const config = createTestConfig([...SLICE_FS_TOOL_NAMES]);
    const harness = createFakeDshHarness();
    const port = createDshWorkerPort(harness.context, config);
    const sessions = createSliceFsSessionRegistry();
    const coordinator = new WorkerLifecycleCoordinator(
      port,
      config,
      sessions,
      makeWorkerFsConfig(root, [sliceA, sliceB, sliceC]),
    );

    // Attempt A: authentic Slice A exposes slice_read + slice_write.
    const runtimeA = admitFrozenSlice(sliceA);
    const resultPromiseA = coordinator.runAttempt({
      runtime: runtimeA,
      attemptId: 'a1',
      prompt: 'p1',
    });
    await waitFor(() => sessions.liveSessionCount === 1);
    const childA = harness.children[0];
    expect(harness.childVisibleToolNames(0)).toEqual(
      expect.arrayContaining(['slice_read', 'slice_write']),
    );
    expect(sessions.getBinding(childA.id)?.attemptId).toBe('a1');

    harness.resolveChild(0, COMPLETED_TERMINAL);
    const resultA = await resultPromiseA;
    expect(resultA.settled).toBe(true);
    expect(resultA.outcome).toBe('SUCCESS');
    expect(sessions.liveSessionCount).toBe(0);
    expect(sessions.getBinding(childA.id)).toBeNull();

    // Attempt B: authentic Slice B exposes only slice_read; A must be gone.
    const runtimeB = admitFrozenSlice(sliceB);
    const resultPromiseB = coordinator.runAttempt({
      runtime: runtimeB,
      attemptId: 'b1',
      prompt: 'p1',
    });
    await waitFor(() => sessions.liveSessionCount === 1);
    const childB = harness.children[1];
    expect(harness.childVisibleToolNames(1)).toEqual(['slice_read']);
    expect(sessions.getBinding(childB.id)?.attemptId).toBe('b1');
    expect(sessions.getBinding(childA.id)).toBeNull();

    const readOutcome = await harness.executeChildTool(1, 'slice_read', {
      path: 'src/fs/b.ts',
    });
    expect(readOutcome.isError).toBe(false);
    if (!readOutcome.isError) {
      expect(readOutcome.value).toMatchObject({ path: 'src/fs/b.ts', content: 'b-before' });
    }

    const staleWriteBodyCalls = { count: 0 };
    harness.registerChildTool(1, bodyProbeTool('slice_write', staleWriteBodyCalls));
    const staleWriteOutcome = await harness.executeChildTool(1, 'slice_write', {
      path: 'src/fs/a.ts',
      content: 'mutated',
    });
    expect(staleWriteOutcome.isError).toBe(true);
    expect(staleWriteOutcome.error?.message).toContain('not allowed');
    expect(staleWriteBodyCalls.count).toBe(0);

    harness.resolveChild(1, COMPLETED_TERMINAL);
    const resultB = await resultPromiseB;
    expect(resultB.settled).toBe(true);
    expect(resultB.outcome).toBe('INVALIDATED');
    expect(resultB.error?.code).toBe(WORKER_ERROR_CODES.UNAUTHORIZED_TOOL);
    expect(sessions.liveSessionCount).toBe(0);
    expect(sessions.getBinding(childB.id)).toBeNull();

    // Attempt C: authentic Slice with empty effective tools remains deny-all.
    const runtimeC = admitFrozenSlice(sliceC);
    const resultPromiseC = coordinator.runAttempt({
      runtime: runtimeC,
      attemptId: 'c1',
      prompt: 'p1',
    });
    await waitFor(() => sessions.liveSessionCount === 1);
    const childC = harness.children[2];
    expect(harness.childVisibleToolNames(2)).toEqual([]);
    expect(sessions.getBinding(childC.id)?.attemptId).toBe('c1');
    expect(sessions.getBinding(childA.id)).toBeNull();
    expect(sessions.getBinding(childB.id)).toBeNull();

    const staleReadBodyCalls = { count: 0 };
    const staleWriteBodyCallsC = { count: 0 };
    harness.registerChildTool(2, bodyProbeTool('slice_read', staleReadBodyCalls));
    harness.registerChildTool(2, bodyProbeTool('slice_write', staleWriteBodyCallsC));

    const staleReadOutcome = await harness.executeChildTool(2, 'slice_read', {
      path: 'src/fs/a.ts',
    });
    const staleWriteOutcomeC = await harness.executeChildTool(2, 'slice_write', {
      path: 'src/fs/a.ts',
      content: 'mutated',
    });
    expect(staleReadOutcome.isError).toBe(true);
    expect(staleReadOutcome.error?.message).toContain('not allowed');
    expect(staleWriteOutcomeC.isError).toBe(true);
    expect(staleWriteOutcomeC.error?.message).toContain('not allowed');
    expect(staleReadBodyCalls.count).toBe(0);
    expect(staleWriteBodyCallsC.count).toBe(0);

    harness.resolveChild(2, COMPLETED_TERMINAL);
    const resultC = await resultPromiseC;
    expect(resultC.settled).toBe(true);
    expect(resultC.outcome).toBe('INVALIDATED');
    expect(resultC.error?.code).toBe(WORKER_ERROR_CODES.UNAUTHORIZED_TOOL);
    expect(sessions.liveSessionCount).toBe(0);
    expect(sessions.getBinding(childC.id)).toBeNull();
    expect(await readFile(join(root, 'src/fs/a.ts'), 'utf8')).toBe('a-before');
  });

  it('FS-45 production-like child scope does not inherit parent tool registration', async () => {
    const root = fixture.root;
    await putFile(root, 'src/fs/a.ts', 'before');
    const frozenSlice = makeFrozenSlice(
      'slice-parent-reg',
      ['src/fs/**'],
      [],
      ['slice_read'],
    );
    const runtime = admitFrozenSlice(frozenSlice);
    const config = createTestConfig([...SLICE_FS_TOOL_NAMES]);
    const harness = createFakeDshHarness();

    const parentBodyCalls = { count: 0 };
    const parentSliceRead = defineTool({
      name: 'slice_read',
      description: 'Parent-only slice_read registration used as a regression probe.',
      parameters: {},
      output: {
        schema: { type: 'string' },
        render: () => [{ type: 'text', text: 'parent-only' }],
      },
      async execute() {
        parentBodyCalls.count += 1;
        return 'parent-only';
      },
    });
    const disposeParentSliceRead = harness.parent.ctx.tools!.register(parentSliceRead);

    const port = createDshWorkerPort(harness.context, config);
    const sessions = createSliceFsSessionRegistry();
    const coordinator = new WorkerLifecycleCoordinator(
      port,
      config,
      sessions,
      makeWorkerFsConfig(root, [frozenSlice]),
    );

    const resultPromise = coordinator.runAttempt({
      runtime,
      attemptId: 'a1',
      prompt: 'p1',
    });
    await waitFor(() => sessions.liveSessionCount === 1);

    expect(harness.parentVisibleToolNames()).toContain('slice_read');
    expect(harness.childVisibleToolNames(0)).toContain('slice_read');

    const childOutcome = await harness.executeChildTool(0, 'slice_read', {
      path: 'src/fs/a.ts',
    });
    expect(childOutcome.isError).toBe(false);
    if (!childOutcome.isError) {
      expect(childOutcome.value).toMatchObject({ path: 'src/fs/a.ts', content: 'before' });
    }
    expect(parentBodyCalls.count).toBe(0);

    harness.resolveChild(0, COMPLETED_TERMINAL);
    const result = await resultPromise;

    expect(result.settled).toBe(true);
    expect(result.outcome).toBe('SUCCESS');
    expect(harness.disposeCounts[0]).toBe(1);
    expect(sessions.liveSessionCount).toBe(0);
    disposeParentSliceRead();
  });

  it('FS-46 non-empty S5 policy hides inherited/global tools while preserving authorized child-local visibility', async () => {
    const root = fixture.root;
    await putFile(root, 'src/fs/a.ts', 'before');
    const frozenSlice = makeFrozenSlice(
      'slice-visibility',
      ['src/fs/**'],
      [],
      ['slice_read'],
    );
    const runtime = admitFrozenSlice(frozenSlice);
    const config = createTestConfig(['slice_read']);
    const harness = createFakeDshHarness();

    const globalBodyCalls = { count: 0 };
    const disposeGlobalProbe = harness.registerGlobalTool(
      bodyProbeTool('global_probe', globalBodyCalls),
    );

    const port = createDshWorkerPort(harness.context, config);
    const sessions = createSliceFsSessionRegistry();
    const coordinator = new WorkerLifecycleCoordinator(
      port,
      config,
      sessions,
      makeWorkerFsConfig(root, [frozenSlice]),
    );

    const resultPromise = coordinator.runAttempt({
      runtime,
      attemptId: 'a1',
      prompt: 'p1',
    });
    await waitFor(() => sessions.liveSessionCount === 1);
    const child = harness.children[0];

    expect(harness.restrictCalls).toEqual([{ allow: [] }]);
    expect(harness.childVisibleToolNames(0)).toEqual(
      expect.arrayContaining(['slice_read']),
    );
    expect(harness.childVisibleToolNames(0)).not.toContain('global_probe');

    const sliceOutcome = await harness.executeChildTool(0, 'slice_read', {
      path: 'src/fs/a.ts',
    });
    expect(sliceOutcome.isError).toBe(false);
    if (!sliceOutcome.isError) {
      expect(sliceOutcome.value).toMatchObject({ path: 'src/fs/a.ts', content: 'before' });
    }

    // Remove the production guard only for this visibility probe. The failure
    // must come from rc.7's visibility filtering (UNKNOWN_TOOL), not from the
    // guard denial path, so the worker result can still complete as SUCCESS.
    const guardDisposer = (
      child.ctx.tools.guard as unknown as {
        mock: { results: Array<{ value: () => void }> };
      }
    ).mock.results[0].value;
    guardDisposer();

    const globalOutcome = await harness.executeChildTool(0, 'global_probe', {});
    expect(globalOutcome.isError).toBe(true);
    expect(globalOutcome.error?.message).toMatch(/unknown tool/i);
    expect(globalBodyCalls.count).toBe(0);

    harness.resolveChild(0, COMPLETED_TERMINAL);
    const result = await resultPromise;

    expect(result.settled).toBe(true);
    expect(result.outcome).toBe('SUCCESS');
    expect(harness.disposeCounts[0]).toBe(1);
    expect(sessions.liveSessionCount).toBe(0);
    expect(sessions.getBinding(child.id)).toBeNull();
    disposeGlobalProbe();
  });

});

describe('C4A fake DSH identity hardening', () => {
  it('fake parent and child identities obey Agent.id === Agent.session.id', () => {
    const harness = createFakeDshHarness();
    expect(harness.parent.id).toBe(harness.parent.session.id);
    expect(harness.context.agent.id).toBe(harness.context.agent.session.id);
  });
});
