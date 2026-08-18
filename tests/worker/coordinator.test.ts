import { describe, expect, it } from 'vitest';
import type { TurnEndReason } from '@deepseek-ai/dsh-session';
import { defineTool } from '@deepseek-ai/dsh-tools';
import type { ToolDefinition } from '@deepseek-ai/dsh-tools';
import { retryActiveSlice } from '../../src/state/index.js';
import {
  createDshWorkerPort,
  FakeWorkerPort,
  WorkerLifecycleCoordinator,
  WORKER_ERROR_CODES,
} from '../../src/worker/index.js';
import type { WorkerResult } from '../../src/worker/index.js';
import { createFakeDshHarness } from './dsh-test-helpers.js';
import { createTestConfig, createTestRuntime } from './helpers.js';

const COMPLETED_TERMINAL: TurnEndReason = { kind: 'completed' };
const ERROR_TERMINAL: TurnEndReason = {
  kind: 'error',
  error: { message: 'fake transport failure', code: 'FAKE_TRANSPORT' },
};
const MAX_TOKENS_TERMINAL: TurnEndReason = { kind: 'max-tokens' };

function workerBodyProbeTool(bodyCalls: { count: number }): ToolDefinition {
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

describe('WorkerLifecycleCoordinator', () => {
  it('WORKER-01 happy lifecycle settles SUCCESS, disposes once, and stops the Slice', async () => {
    const port = new FakeWorkerPort();
    const coordinator = new WorkerLifecycleCoordinator(port, createTestConfig());

    const result = await coordinator.runAttempt({
      runtime: createTestRuntime(),
      attemptId: 'a1',
      prompt: 'p1',
    });

    expect(result.settled).toBe(true);
    expect(result.outcome).toBe('SUCCESS');
    expect(result.error).toBeNull();
    expect(result.attempt.phase).toBe('DISPOSED');
    expect(result.attempt.outcome).toBe('SUCCESS');
    expect(result.runtime.activeSlice?.phase).toBe('WORKER_STOPPED');
    expect(port.spawnCount).toBe(1);
    expect(port.runs).toHaveLength(1);
    expect(port.runs[0].disposeCount).toBe(1);
  });

  it('WORKER-02 execution failure still disposes exactly once and marks ATTEMPT_FAILED', async () => {
    const port = new FakeWorkerPort();
    port.rejectResult = true;
    const coordinator = new WorkerLifecycleCoordinator(port, createTestConfig());

    const result = await coordinator.runAttempt({
      runtime: createTestRuntime(),
      attemptId: 'a1',
      prompt: 'p1',
    });

    expect(result.settled).toBe(true);
    expect(result.outcome).toBe('FAILED');
    expect(result.error?.code).toBe(WORKER_ERROR_CODES.WORKER_EXECUTION_FAILED);
    expect(result.attempt.phase).toBe('DISPOSED');
    expect(result.attempt.outcome).toBe('FAILED');
    expect(result.runtime.activeSlice?.phase).toBe('ATTEMPT_FAILED');
    expect(port.runs[0].disposeCount).toBe(1);
  });

  it('WORKER-05 fresh retry uses a new worker, new session, and new attempt', async () => {
    const port = new FakeWorkerPort();
    port.rejectResult = true;
    const coordinator = new WorkerLifecycleCoordinator(port, createTestConfig());

    const first = await coordinator.runAttempt({
      runtime: createTestRuntime(),
      attemptId: 'a1',
      prompt: 'p1',
    });
    expect(first.runtime.activeSlice?.phase).toBe('ATTEMPT_FAILED');

    const retriedRuntime = retryActiveSlice(first.runtime);
    expect(retriedRuntime.activeSlice?.phase).toBe('ADMITTED');

    port.rejectResult = false;
    const second = await coordinator.runAttempt({
      runtime: retriedRuntime,
      attemptId: 'a2',
      prompt: 'p2',
    });

    expect(second.settled).toBe(true);
    expect(second.outcome).toBe('SUCCESS');
    expect(second.attempt.attemptId).toBe('a2');
    expect(second.attempt.attemptNo).toBe(2);
    expect(port.spawnCount).toBe(2);
    expect(port.runs).toHaveLength(2);
    expect(port.runs[1].workerId).not.toBe(port.runs[0].workerId);
    expect(port.runs[1].sessionId).not.toBe(port.runs[0].sessionId);
    expect(port.runs[0].disposeCount).toBe(1);
    expect(port.runs[1].disposeCount).toBe(1);
  });

  it('WORKER-06 does not allow a second spawn before the first dispose completes', async () => {
    const port = new FakeWorkerPort();
    port.deferredDispose = true;
    const coordinator = new WorkerLifecycleCoordinator(port, createTestConfig());

    const firstPromise = coordinator.runAttempt({
      runtime: createTestRuntime(),
      attemptId: 'a1',
      prompt: 'p1',
    });

    await port.runs[0].disposeStarted;

    await expect(
      coordinator.runAttempt({
        runtime: createTestRuntime(),
        attemptId: 'a2',
        prompt: 'p2',
      }),
    ).rejects.toMatchObject({ code: WORKER_ERROR_CODES.WORKER_ALREADY_ACTIVE });

    expect(port.spawnCount).toBe(1);
    expect(coordinator.isActive).toBe(true);

    port.runs[0].resolveDispose();
    const first = await firstPromise;
    expect(first.settled).toBe(true);
    expect(coordinator.isActive).toBe(false);

    port.deferredDispose = false;
    const second = await coordinator.runAttempt({
      runtime: createTestRuntime(),
      attemptId: 'a2',
      prompt: 'p2',
    });
    expect(port.spawnCount).toBe(2);
    expect(second.settled).toBe(true);
  });

  it('WORKER-07 dispose failure fails closed and does not finalize', async () => {
    const port = new FakeWorkerPort();
    port.rejectDispose = true;
    const coordinator = new WorkerLifecycleCoordinator(port, createTestConfig());

    const result = await coordinator.runAttempt({
      runtime: createTestRuntime(),
      attemptId: 'a1',
      prompt: 'p1',
    });

    expect(result.settled).toBe(false);
    expect(result.outcome).toBe('SUCCESS');
    expect(result.error?.code).toBe(WORKER_ERROR_CODES.WORKER_DISPOSE_FAILED);
    expect(result.attempt.phase).toBe('DISPOSING');
    expect(result.attempt.phase).not.toBe('DISPOSED');
    expect(result.runtime.activeSlice?.phase).toBe('RUNNING');
    expect(result.runtime.activeSlice?.phase).not.toBe('WORKER_STOPPED');
    expect(port.runs[0].disposeCount).toBe(1);
    expect(coordinator.isActive).toBe(true);
  });

  it('WORKER-08 spawn failure returns WORKER_SPAWN_FAILED without faking a run or dispose', async () => {
    const port = new FakeWorkerPort();
    port.failSpawn = true;
    const coordinator = new WorkerLifecycleCoordinator(port, createTestConfig());

    const result = await coordinator.runAttempt({
      runtime: createTestRuntime(),
      attemptId: 'a1',
      prompt: 'p1',
    });

    expect(result.settled).toBe(true);
    expect(result.outcome).toBe('FAILED');
    expect(result.error?.code).toBe(WORKER_ERROR_CODES.WORKER_SPAWN_FAILED);
    expect(result.attempt.phase).toBe('SPAWN_FAILED');
    expect(result.attempt.outcome).toBe('FAILED');
    expect(result.runtime.activeSlice?.phase).toBe('ATTEMPT_FAILED');
    expect(port.spawnCount).toBe(1);
    expect(port.runs).toHaveLength(0);
    expect(coordinator.isActive).toBe(false);
  });

  it('WORKER-13 spawn failure releases coordinator occupancy and permits a fresh retry', async () => {
    const port = new FakeWorkerPort();
    port.failSpawn = true;
    const coordinator = new WorkerLifecycleCoordinator(port, createTestConfig());

    const first = await coordinator.runAttempt({
      runtime: createTestRuntime(),
      attemptId: 'a1',
      prompt: 'p1',
    });

    expect(first.attempt.phase).toBe('SPAWN_FAILED');
    expect(first.attempt.outcome).toBe('FAILED');
    expect(first.runtime.activeSlice?.phase).toBe('ATTEMPT_FAILED');
    expect(coordinator.isActive).toBe(false);

    const retriedRuntime = retryActiveSlice(first.runtime);
    expect(retriedRuntime.activeSlice?.phase).toBe('ADMITTED');

    port.failSpawn = false;
    const second = await coordinator.runAttempt({
      runtime: retriedRuntime,
      attemptId: 'a2',
      prompt: 'p2',
    });

    expect(second.settled).toBe(true);
    expect(second.outcome).toBe('SUCCESS');
    expect(second.attempt.attemptId).toBe('a2');
    expect(second.attempt.attemptNo).toBe(2);
    expect(port.spawnCount).toBe(2);
    expect(port.runs).toHaveLength(1);
    expect(port.runs[0].workerId).toBe('fake-worker-1');
    expect(port.runs[0].disposeCount).toBe(1);
    expect(coordinator.isActive).toBe(false);
  });

  it('WORKER-14 spawn-pending counts as active and failure releases occupancy', async () => {
    const port = new FakeWorkerPort();
    port.deferredSpawn = true;
    const coordinator = new WorkerLifecycleCoordinator(port, createTestConfig());

    const firstPromise = coordinator.runAttempt({
      runtime: createTestRuntime(),
      attemptId: 'a1',
      prompt: 'p1',
    });

    await port.spawnStarted;
    expect(coordinator.isActive).toBe(true);
    expect(port.spawnCount).toBe(1);
    expect(port.runs).toHaveLength(0);

    await expect(
      coordinator.runAttempt({
        runtime: createTestRuntime(),
        attemptId: 'a2',
        prompt: 'p2',
      }),
    ).rejects.toMatchObject({ code: WORKER_ERROR_CODES.WORKER_ALREADY_ACTIVE });

    expect(port.spawnCount).toBe(1);
    expect(port.runs).toHaveLength(0);

    port.rejectSpawn();
    const first = await firstPromise;

    expect(first.settled).toBe(true);
    expect(first.outcome).toBe('FAILED');
    expect(first.error?.code).toBe(WORKER_ERROR_CODES.WORKER_SPAWN_FAILED);
    expect(first.attempt.phase).toBe('SPAWN_FAILED');
    expect(first.attempt.outcome).toBe('FAILED');
    expect(first.runtime.activeSlice?.phase).toBe('ATTEMPT_FAILED');
    expect(port.runs).toHaveLength(0);
    expect(coordinator.isActive).toBe(false);

    port.deferredSpawn = false;
    const retriedRuntime = retryActiveSlice(first.runtime);
    const second = await coordinator.runAttempt({
      runtime: retriedRuntime,
      attemptId: 'a2',
      prompt: 'p2',
    });

    expect(second.settled).toBe(true);
    expect(second.outcome).toBe('SUCCESS');
    expect(port.spawnCount).toBe(2);
    expect(port.runs).toHaveLength(1);
    expect(port.runs[0].disposeCount).toBe(1);
  });

  it('WORKER-15 no fake disposal on spawn failure', async () => {
    const port = new FakeWorkerPort();
    port.failSpawn = true;
    const coordinator = new WorkerLifecycleCoordinator(port, createTestConfig());

    const result = await coordinator.runAttempt({
      runtime: createTestRuntime(),
      attemptId: 'a1',
      prompt: 'p1',
    });

    expect(port.spawnCount).toBe(1);
    expect(port.runs).toHaveLength(0);
    expect(result.attempt.phase).toBe('SPAWN_FAILED');
    expect(result.attempt.outcome).toBe('FAILED');
    expect(result.runtime.activeSlice?.phase).toBe('ATTEMPT_FAILED');
    expect(result.runtime.activeSlice?.phase).not.toBe('DISPOSED');
    expect(coordinator.isActive).toBe(false);
  });

  it('WORKER-09 each WorkerRun executes exactly once', async () => {
    const port = new FakeWorkerPort();
    port.rejectResult = true;
    const coordinator = new WorkerLifecycleCoordinator(port, createTestConfig());

    const first = await coordinator.runAttempt({
      runtime: createTestRuntime(),
      attemptId: 'a1',
      prompt: 'p1',
    });
    const retriedRuntime = retryActiveSlice(first.runtime);
    port.rejectResult = false;

    await coordinator.runAttempt({
      runtime: retriedRuntime,
      attemptId: 'a2',
      prompt: 'p2',
    });

    expect(port.runs).toHaveLength(2);
    expect(port.runs[0].executionCount).toBe(1);
    expect(port.runs[1].executionCount).toBe(1);
  });

  it('WORKER-10 worker self-reported PASS only reaches WORKER_STOPPED', async () => {
    const port = new FakeWorkerPort();
    port.defaultResult = { outcome: 'SUCCESS', message: 'STATUS: PASS' };
    const coordinator = new WorkerLifecycleCoordinator(port, createTestConfig());

    const result = await coordinator.runAttempt({
      runtime: createTestRuntime(),
      attemptId: 'a1',
      prompt: 'p1',
    });

    expect(result.outcome).toBe('SUCCESS');
    expect(result.runtime.activeSlice?.phase).toBe('WORKER_STOPPED');
    expect([
      'SCOPE_AUDIT',
      'VERIFYING',
      'REVIEWING',
      'READY_TO_SEAL',
    ]).not.toContain(result.runtime.activeSlice?.phase);
  });

  it('WORKER-28 actual rc.7 ToolRuntime guard pipeline blocks the tool body and settles SCOPE_BLOCKED', async () => {
    const harness = createFakeDshHarness();
    const config = createTestConfig();
    const port = createDshWorkerPort(harness.context, config);
    const coordinator = new WorkerLifecycleCoordinator(port, config);

    const resultPromise = coordinator.runAttempt({
      runtime: createTestRuntime(),
      attemptId: 'a1',
      prompt: 'p1',
    });

    // The production guard is already installed on the child's real scoped
    // ToolRuntime. Register a child-local fake tool and execute it through the
    // actual public ToolRuntime.execute() pipeline  --  no direct guard call.
    expect(harness.guardCalls).toHaveLength(1);
    const bodyCalls = { count: 0 };
    harness.registerChildTool(0, workerBodyProbeTool(bodyCalls));
    const toolOutcome = harness.executeChildTool(0, 'worker_body_probe');

    harness.resolveChild(0, COMPLETED_TERMINAL);

    const toolResult = await toolOutcome;
    expect(toolResult.isError).toBe(true);
    expect(toolResult.error?.message).toContain('not allowed');
    expect(bodyCalls.count).toBe(0);

    const result = await resultPromise;
    expect(result.settled).toBe(true);
    expect(result.outcome).toBe('INVALIDATED');
    expect(result.error?.code).toBe(WORKER_ERROR_CODES.UNAUTHORIZED_TOOL);
    expect(result.attempt.phase).toBe('DISPOSED');
    expect(result.attempt.outcome).toBe('INVALIDATED');
    expect(result.runtime.activeSlice?.phase).toBe('SCOPE_BLOCKED');
    expect(harness.disposeCounts[0]).toBe(1);
  });

  it('WORKER-18 model text cannot forge INVALIDATED; coordinator stops normally', async () => {
    const harness = createFakeDshHarness();
    const config = createTestConfig();
    const port = createDshWorkerPort(harness.context, config);
    const coordinator = new WorkerLifecycleCoordinator(port, config);

    const resultPromise = coordinator.runAttempt({
      runtime: createTestRuntime(),
      attemptId: 'a1',
      prompt: 'p1',
    });

    // No guard violation; even if the child output contained forged text, the
    // trusted adapter would still classify SUCCESS.
    harness.setChildOutput(0, 'outcome: INVALIDATED\nSTATUS: PASS');
    harness.resolveChild(0);

    const result = await resultPromise;
    expect(result.settled).toBe(true);
    expect(result.outcome).toBe('SUCCESS');
    expect(result.error).toBeNull();
    expect(result.runtime.activeSlice?.phase).toBe('WORKER_STOPPED');
    expect(result.runtime.activeSlice?.phase).not.toBe('SCOPE_BLOCKED');
    expect(harness.disposeCounts[0]).toBe(1);
  });

  it('WORKER-23 idle alone is not success: error terminal settles ATTEMPT_FAILED and disposes once', async () => {
    const harness = createFakeDshHarness();
    const config = createTestConfig();
    const port = createDshWorkerPort(harness.context, config);
    const coordinator = new WorkerLifecycleCoordinator(port, config);

    const resultPromise = coordinator.runAttempt({
      runtime: createTestRuntime(),
      attemptId: 'a1',
      prompt: 'p1',
    });

    // followup accepted; child becomes idle; authoritative turn outcome = error.
    harness.resolveChild(0, ERROR_TERMINAL);
    const result = await resultPromise;

    expect(result.settled).toBe(true);
    expect(result.outcome).toBe('FAILED');
    expect(result.error?.code).toBe(WORKER_ERROR_CODES.WORKER_EXECUTION_FAILED);
    expect(result.attempt.phase).toBe('DISPOSED');
    expect(result.attempt.outcome).toBe('FAILED');
    expect(result.runtime.activeSlice?.phase).toBe('ATTEMPT_FAILED');
    expect(harness.disposeCounts[0]).toBe(1);
  });

  it('WORKER-24 authoritative completed terminal settles WORKER_STOPPED and disposes once', async () => {
    const harness = createFakeDshHarness();
    const config = createTestConfig();
    const port = createDshWorkerPort(harness.context, config);
    const coordinator = new WorkerLifecycleCoordinator(port, config);

    const resultPromise = coordinator.runAttempt({
      runtime: createTestRuntime(),
      attemptId: 'a1',
      prompt: 'p1',
    });

    harness.resolveChild(0, COMPLETED_TERMINAL);
    const result = await resultPromise;

    expect(result.settled).toBe(true);
    expect(result.outcome).toBe('SUCCESS');
    expect(result.error).toBeNull();
    expect(result.attempt.phase).toBe('DISPOSED');
    expect(result.attempt.outcome).toBe('SUCCESS');
    expect(result.runtime.activeSlice?.phase).toBe('WORKER_STOPPED');
    expect(harness.disposeCounts[0]).toBe(1);
  });

  it('WORKER-25 max-tokens terminal settles ATTEMPT_FAILED and disposes once', async () => {
    const harness = createFakeDshHarness();
    const config = createTestConfig();
    const port = createDshWorkerPort(harness.context, config);
    const coordinator = new WorkerLifecycleCoordinator(port, config);

    const resultPromise = coordinator.runAttempt({
      runtime: createTestRuntime(),
      attemptId: 'a1',
      prompt: 'p1',
    });

    harness.resolveChild(0, MAX_TOKENS_TERMINAL);
    const result = await resultPromise;

    expect(result.settled).toBe(true);
    expect(result.outcome).toBe('FAILED');
    expect(result.error?.code).toBe(WORKER_ERROR_CODES.WORKER_EXECUTION_FAILED);
    expect(result.runtime.activeSlice?.phase).toBe('ATTEMPT_FAILED');
    expect(result.runtime.activeSlice?.phase).not.toBe('WORKER_STOPPED');
    expect(harness.disposeCounts[0]).toBe(1);
  });

  it('WORKER-26 missing authoritative terminal accounting settles ATTEMPT_FAILED and disposes once', async () => {
    const harness = createFakeDshHarness();
    const config = createTestConfig();
    const port = createDshWorkerPort(harness.context, config);
    const coordinator = new WorkerLifecycleCoordinator(port, config);

    const resultPromise = coordinator.runAttempt({
      runtime: createTestRuntime(),
      attemptId: 'a1',
      prompt: 'p1',
    });

    // Idle, but no valid current-run turn/end evidence exists.
    harness.resolveChild(0, null);
    const result = await resultPromise;

    expect(result.settled).toBe(true);
    expect(result.outcome).toBe('FAILED');
    expect(result.error?.code).toBe(WORKER_ERROR_CODES.WORKER_EXECUTION_FAILED);
    expect(result.runtime.activeSlice?.phase).toBe('ATTEMPT_FAILED');
    expect(result.runtime.activeSlice?.phase).not.toBe('WORKER_STOPPED');
    expect(harness.disposeCounts[0]).toBe(1);
  });

  it('WORKER-20 malformed post-spawn result still disposes exactly once and is truthful FAILED', async () => {
    const port = new FakeWorkerPort();
    port.defaultResult = { outcome: 'BOGUS' } as unknown as WorkerResult;
    const coordinator = new WorkerLifecycleCoordinator(port, createTestConfig());

    const result = await coordinator.runAttempt({
      runtime: createTestRuntime(),
      attemptId: 'a1',
      prompt: 'p1',
    });

    expect(result.settled).toBe(true);
    expect(result.outcome).toBe('FAILED');
    expect(result.error?.code).toBe(WORKER_ERROR_CODES.WORKER_EXECUTION_FAILED);
    expect(result.attempt.phase).toBe('DISPOSED');
    expect(result.attempt.outcome).toBe('FAILED');
    expect(result.runtime.activeSlice?.phase).toBe('ATTEMPT_FAILED');
    expect(result.runtime.activeSlice?.phase).not.toBe('WORKER_STOPPED');
    expect(port.runs[0].disposeCount).toBe(1);
  });

  it('WORKER-20 malformed result with dispose failure stays in DISPOSING and does not fake DISPOSED', async () => {
    const port = new FakeWorkerPort();
    port.defaultResult = { outcome: 'BOGUS' } as unknown as WorkerResult;
    port.rejectDispose = true;
    const coordinator = new WorkerLifecycleCoordinator(port, createTestConfig());

    const result = await coordinator.runAttempt({
      runtime: createTestRuntime(),
      attemptId: 'a1',
      prompt: 'p1',
    });

    expect(result.settled).toBe(false);
    expect(result.outcome).toBe('FAILED');
    expect(result.error?.code).toBe(WORKER_ERROR_CODES.WORKER_DISPOSE_FAILED);
    expect(result.attempt.phase).toBe('DISPOSING');
    expect(result.attempt.phase).not.toBe('DISPOSED');
    expect(port.runs[0].disposeCount).toBe(1);
    expect(coordinator.isActive).toBe(true);
  });

  it('WORKER-21 violation state is isolated between fresh workers', async () => {
    const harness = createFakeDshHarness();
    const config = createTestConfig();
    const port = createDshWorkerPort(harness.context, config);
    const coordinator = new WorkerLifecycleCoordinator(port, config);

    // Attempt 1: unauthorized child-local tool through the actual runtime
    // pipeline -> trusted INVALIDATED on exactly this worker.
    const firstPromise = coordinator.runAttempt({
      runtime: createTestRuntime(),
      attemptId: 'a1',
      prompt: 'p1',
    });
    const firstBodyCalls = { count: 0 };
    harness.registerChildTool(0, workerBodyProbeTool(firstBodyCalls));
    await harness.executeChildTool(0, 'worker_body_probe');
    expect(firstBodyCalls.count).toBe(0);
    harness.resolveChild(0);
    const first = await firstPromise;
    expect(first.outcome).toBe('INVALIDATED');
    expect(first.runtime.activeSlice?.phase).toBe('SCOPE_BLOCKED');

    // Attempt 2 uses a fresh runtime and a fresh worker; no violation on it.
    // (SCOPE_BLOCKED is intentionally not retryable, so this is a fresh slice.)
    const secondPromise = coordinator.runAttempt({
      runtime: createTestRuntime(),
      attemptId: 'a2',
      prompt: 'p2',
    });
    expect(harness.guardCalls).toHaveLength(2);
    harness.resolveChild(1);
    const second = await secondPromise;

    expect(second.settled).toBe(true);
    expect(second.outcome).toBe('SUCCESS');
    expect(second.error).toBeNull();
    expect(second.attempt.attemptId).toBe('a2');
    expect(second.runtime.activeSlice?.phase).toBe('WORKER_STOPPED');
    expect(harness.disposeCounts[0]).toBe(1);
    expect(harness.disposeCounts[1]).toBe(1);
  });
});
