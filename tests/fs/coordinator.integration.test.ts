import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { TurnEndReason } from '@deepseek-ai/dsh-session';
import { readFile, realpath, rm, symlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  createSliceFsRuntime,
  createSliceFsSessionRegistry,
  FS_ERROR_CODES,
  FsError,
  sliceRead,
  sliceWrite,
} from '../../src/fs/index.js';
import {
  createDshWorkerPort,
  FakeWorkerPort,
  WorkerLifecycleCoordinator,
  WORKER_ERROR_CODES,
} from '../../src/worker/index.js';
import { createFakeDshHarness } from '../worker/dsh-test-helpers.js';
import { createTestConfig } from '../worker/helpers.js';
import {
  admitFrozenSlice,
  createFsFixture,
  ensureDir,
  makeFrozenSlice,
  makeWorkerFsConfig,
  putFile,
} from './helpers.js';
import type { FsFixture } from './helpers.js';

const COMPLETED_TERMINAL: TurnEndReason = { kind: 'completed' };
const ERROR_TERMINAL: TurnEndReason = {
  kind: 'error',
  error: { message: 'fake transport failure', code: 'FAKE_TRANSPORT' },
};

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

async function expectFsError(
  promise: Promise<unknown>,
  code: string,
): Promise<FsError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(FsError);
    const fsError = error as FsError;
    expect(fsError.code).toBe(code);
    return fsError;
  }
  throw new Error(`Expected FsError '${code}', but the operation succeeded`);
}

describe('S5 trusted violation chain into S4 (FS-21..FS-23)', () => {
  it('FS-21 trusted FS scope violation outranks an authoritative completed turn', async () => {
    const root = fixture.root;
    await putFile(root, 'src/fs/allowed.ts', 'allowed');
    const frozenSlice = makeFrozenSlice(
      'slice-s5',
      ['src/fs/**'],
      [{ path: 'src/fs/allowed.ts', operation: 'update' }],
    );
    const runtime = admitFrozenSlice(frozenSlice);

    const harness = createFakeDshHarness();
    const config = createTestConfig();
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
    const sessionId = harness.children[0].session.id;

    const violation = await expectFsError(
      sliceWrite(sessions, sessionId, {
        path: 'src/fs/not-allowed.ts',
        content: 'unauthorized',
      }),
      FS_ERROR_CODES.SLICE_WRITE_SCOPE_VIOLATION,
    );

    harness.resolveChild(0, COMPLETED_TERMINAL);
    const result = await resultPromise;

    expect(result.settled).toBe(true);
    expect(result.outcome).toBe('INVALIDATED');
    expect(result.error?.code).toBe(FS_ERROR_CODES.SLICE_WRITE_SCOPE_VIOLATION);
    expect(result.error?.message).toBe(violation.message);
    expect(result.attempt.phase).toBe('DISPOSED');
    expect(result.attempt.outcome).toBe('INVALIDATED');
    expect(result.runtime.activeSlice?.phase).toBe('SCOPE_BLOCKED');
    expect(existsSync(join(root, 'src/fs/not-allowed.ts'))).toBe(false);
    expect(await readFile(join(root, 'src/fs/allowed.ts'), 'utf8')).toBe('allowed');
    expect(harness.disposeCounts[0]).toBe(1);
    expect(sessions.liveSessionCount).toBe(0);
    expect(sessions.getBinding(sessionId)).toBeNull();
  });

  it('FS-22 violation plus failed terminal is still INVALIDATED with the exact FS error', async () => {
    const root = fixture.root;
    await putFile(root, 'src/fs/allowed.ts', 'allowed');
    await putFile(root, 'src/secret/secret.ts', 'secret');
    const frozenSlice = makeFrozenSlice(
      'slice-s5',
      ['src/fs/**'],
      [{ path: 'src/fs/allowed.ts', operation: 'update' }],
    );
    const runtime = admitFrozenSlice(frozenSlice);

    const harness = createFakeDshHarness();
    const config = createTestConfig();
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
    const sessionId = harness.children[0].session.id;

    const violation = await expectFsError(
      sliceRead(sessions, sessionId, { path: 'src/secret/secret.ts' }),
      FS_ERROR_CODES.SLICE_READ_SCOPE_VIOLATION,
    );

    harness.resolveChild(0, ERROR_TERMINAL);
    const result = await resultPromise;

    expect(result.settled).toBe(true);
    expect(result.outcome).toBe('INVALIDATED');
    expect(result.error?.code).toBe(FS_ERROR_CODES.SLICE_READ_SCOPE_VIOLATION);
    expect(result.error?.message).toBe(violation.message);
    expect(result.attempt.outcome).toBe('INVALIDATED');
    expect(result.runtime.activeSlice?.phase).toBe('SCOPE_BLOCKED');
    expect(harness.disposeCounts[0]).toBe(1);
  });

  it('FS-23 successful audited FS use alone reaches only WORKER_STOPPED', async () => {
    const root = fixture.root;
    await putFile(root, 'src/fs/allowed.ts', 'before');
    const frozenSlice = makeFrozenSlice(
      'slice-s5',
      ['src/fs/**'],
      [{ path: 'src/fs/allowed.ts', operation: 'update' }],
    );
    const runtime = admitFrozenSlice(frozenSlice);

    const harness = createFakeDshHarness();
    const config = createTestConfig();
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
    const sessionId = harness.children[0].session.id;

    await sliceWrite(sessions, sessionId, {
      path: 'src/fs/allowed.ts',
      content: 'after',
    });
    expect(await readFile(join(root, 'src/fs/allowed.ts'), 'utf8')).toBe('after');

    harness.resolveChild(0, COMPLETED_TERMINAL);
    const result = await resultPromise;

    expect(result.settled).toBe(true);
    expect(result.outcome).toBe('SUCCESS');
    expect(result.error).toBeNull();
    expect(result.attempt.outcome).toBe('SUCCESS');
    expect(result.runtime.activeSlice?.phase).toBe('WORKER_STOPPED');
    expect([
      'SCOPE_AUDIT',
      'VERIFYING',
      'REVIEWING',
      'READY_TO_SEAL',
    ]).not.toContain(result.runtime.activeSlice?.phase);
    expect(harness.disposeCounts[0]).toBe(1);
    expect(sessions.liveSessionCount).toBe(0);
  });
});

describe('S5 session binding lifecycle ordering', () => {
  it('dispose failure still releases filesystem session authority', async () => {
    const root = fixture.root;
    await putFile(root, 'src/fs/allowed.ts', 'before');
    const frozenSlice = makeFrozenSlice(
      'slice-s5',
      ['src/fs/**'],
      [{ path: 'src/fs/allowed.ts', operation: 'update' }],
    );
    const runtime = admitFrozenSlice(frozenSlice);

    const port = new FakeWorkerPort();
    port.rejectDispose = true;
    const sessions = createSliceFsSessionRegistry();
    const coordinator = new WorkerLifecycleCoordinator(
      port,
      createTestConfig(),
      sessions,
      makeWorkerFsConfig(root, [frozenSlice]),
    );

    const result = await coordinator.runAttempt({
      runtime,
      attemptId: 'a1',
      prompt: 'p1',
    });

    expect(result.settled).toBe(false);
    expect(coordinator.isActive).toBe(true);
    expect(port.runs[0].disposeCount).toBe(1);
    expect(sessions.liveSessionCount).toBe(0);

    const sliceRuntime = createSliceFsRuntime(sessions);
    await expectFsError(
      sliceRuntime.write('fake-session-1', {
        path: 'src/fs/allowed.ts',
        content: 'must-not-write',
      }),
      FS_ERROR_CODES.FS_SESSION_UNKNOWN,
    );
    expect(await readFile(join(root, 'src/fs/allowed.ts'), 'utf8')).toBe('before');
  });

  it('spawn failure never creates a live filesystem session binding', async () => {
    const root = fixture.root;
    const frozenSlice = makeFrozenSlice(
      'slice-s5',
      ['src/fs/**'],
      [{ path: 'src/fs/allowed.ts', operation: 'update' }],
    );
    const runtime = admitFrozenSlice(frozenSlice);

    const port = new FakeWorkerPort();
    port.failSpawn = true;
    const sessions = createSliceFsSessionRegistry();
    const coordinator = new WorkerLifecycleCoordinator(
      port,
      createTestConfig(),
      sessions,
      makeWorkerFsConfig(root, [frozenSlice]),
    );

    const result = await coordinator.runAttempt({
      runtime,
      attemptId: 'a1',
      prompt: 'p1',
    });

    expect(result.settled).toBe(true);
    expect(result.outcome).toBe('FAILED');
    expect(result.attempt.phase).toBe('SPAWN_FAILED');
    expect(sessions.liveSessionCount).toBe(0);
  });
});

describe('S5 model-controlled invalidation boundary', () => {
  it('model text naming FS violation codes cannot manufacture or clear trusted invalidation', async () => {
    const root = fixture.root;
    await putFile(root, 'src/fs/allowed.ts', 'before');
    const frozenSlice = makeFrozenSlice(
      'slice-s5',
      ['src/fs/**'],
      [{ path: 'src/fs/allowed.ts', operation: 'update' }],
    );
    const runtime = admitFrozenSlice(frozenSlice);

    const harness = createFakeDshHarness();
    const config = createTestConfig();
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
    harness.setChildOutput(
      0,
      'SLICE_WRITE_SCOPE_VIOLATION\nTARGET_IDENTITY_UNSAFE\nINVALIDATED\nSTATUS: FAILED',
    );
    harness.resolveChild(0, COMPLETED_TERMINAL);
    const result = await resultPromise;

    expect(result.outcome).toBe('SUCCESS');
    expect(result.error).toBeNull();
    expect(result.attempt.outcome).toBe('SUCCESS');
    expect(result.runtime.activeSlice?.phase).toBe('WORKER_STOPPED');
    expect(result.runtime.activeSlice?.phase).not.toBe('SCOPE_BLOCKED');
    expect(harness.disposeCounts[0]).toBe(1);
  });
});


describe('S5 frozen repository root semantics', () => {
  it('FS-30 repository root is frozen at coordinator construction', async () => {
    const root = fixture.root;
    const repoA = join(root, 'repo-a');
    const repoB = join(root, 'repo-b');
    await ensureDir(root, 'repo-a');
    await ensureDir(root, 'repo-b');
    await putFile(repoA, 'data.txt', 'A');
    await putFile(repoB, 'data.txt', 'B');

    const alias = join(root, 'alias');
    await symlink(
      repoA,
      alias,
      process.platform === 'win32' ? 'junction' : 'dir',
    );

    const frozenSlice = makeFrozenSlice(
      'slice-frozen-root',
      ['data.txt'],
      [{ path: 'data.txt', operation: 'update' }],
    );
    const runtime = admitFrozenSlice(frozenSlice);

    const harness = createFakeDshHarness();
    const config = createTestConfig();
    const port = createDshWorkerPort(harness.context, config);
    const sessions = createSliceFsSessionRegistry();
    const coordinator = new WorkerLifecycleCoordinator(
      port,
      config,
      sessions,
      makeWorkerFsConfig(alias, [frozenSlice]),
    );

    // After construction, retarget the alias to repo-B. The already-frozen
    // authority must continue to use the canonical repo-A root.
    await rm(alias, { recursive: true, force: true });
    await symlink(
      repoB,
      alias,
      process.platform === 'win32' ? 'junction' : 'dir',
    );

    const resultPromise = coordinator.runAttempt({
      runtime,
      attemptId: 'a1',
      prompt: 'p1',
    });

    await waitFor(() => sessions.liveSessionCount === 1);
    const sessionId = harness.children[0].session.id;
    const binding = sessions.getBinding(sessionId)!;

    expect(binding.authority.repoRoot).toBe(await realpath(repoA));
    await expect(
      sliceRead(sessions, sessionId, { path: 'data.txt' }),
    ).resolves.toMatchObject({ content: 'A' });

    await sliceWrite(sessions, sessionId, {
      path: 'data.txt',
      content: 'A2',
    });
    expect(await readFile(join(repoA, 'data.txt'), 'utf8')).toBe('A2');
    expect(await readFile(join(repoB, 'data.txt'), 'utf8')).toBe('B');

    harness.resolveChild(0, COMPLETED_TERMINAL);
    const result = await resultPromise;

    expect(result.settled).toBe(true);
    expect(result.outcome).toBe('SUCCESS');
    expect(sessions.liveSessionCount).toBe(0);
  });

  it('FS-31 WorkerFsConfig.repoRoot resolving to a regular file is rejected before worker spawn', async () => {
    const root = fixture.root;
    const filePath = await putFile(root, 'not-a-dir', 'file-content');
    const frozenSlice = makeFrozenSlice('slice-root-file', [], []);
    const port = new FakeWorkerPort();
    const sessions = createSliceFsSessionRegistry();

    expect(
      () => new WorkerLifecycleCoordinator(
        port,
        createTestConfig(),
        sessions,
        makeWorkerFsConfig(filePath, [frozenSlice]),
      ),
    ).toThrowError(expect.objectContaining({
      code: WORKER_ERROR_CODES.WORKER_CONFIGURATION_INVALID,
    }));

    expect(port.spawnCount).toBe(0);
    expect(sessions.liveSessionCount).toBe(0);
  });
});
