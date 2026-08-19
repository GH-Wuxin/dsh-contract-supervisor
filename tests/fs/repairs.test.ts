import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { TurnEndReason } from '@deepseek-ai/dsh-session';
import { existsSync } from 'node:fs';
import { lstat, readFile, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import {
  createSliceFsRuntime,
  createSliceFsSessionRegistry,
  FS_ERROR_CODES,
  FsError,
  SliceFsSessionRegistry,
  sliceRead,
} from '../../src/fs/index.js';
import type { SliceFsAuthority } from '../../src/fs/index.js';
import {
  createDshWorkerPort,
  FakeWorkerPort,
  WorkerLifecycleCoordinator,
  WORKER_ERROR_CODES,
} from '../../src/worker/index.js';
import type { WorkerAttemptInput, WorkerSpawnRequest } from '../../src/worker/index.js';
import { createFakeDshHarness } from '../worker/dsh-test-helpers.js';
import { createTestConfig } from '../worker/helpers.js';
import { retryActiveSlice } from '../../src/state/index.js';
import {
  admitFrozenSlice,
  createFsFixture,
  ensureDir,
  makeAuthority,
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

describe('FS-24 authority provenance single-root', () => {
  it('authority is selected by the authentic active Slice hash; runtime Slice A can never receive Slice B filesystem authority', async () => {
    const root = fixture.root;
    await putFile(root, 'src/a/a.ts', 'a-allowed');
    await putFile(root, 'src/b/b.ts', 'b-forbidden');

    const sliceA = makeFrozenSlice(
      'slice-a',
      ['src/a/**'],
      [{ path: 'src/a/a.ts', operation: 'update' }],
    );
    const sliceB = makeFrozenSlice(
      'slice-b',
      ['src/b/**'],
      [{ path: 'src/b/b.ts', operation: 'update' }],
    );
    const runtimeA = admitFrozenSlice(sliceA);

    const harness = createFakeDshHarness();
    const config = createTestConfig();
    const port = createDshWorkerPort(harness.context, config);
    const sessions = createSliceFsSessionRegistry();
    const coordinator = new WorkerLifecycleCoordinator(
      port,
      config,
      sessions,
      makeWorkerFsConfig(root, [sliceA, sliceB]),
    );

    // The removed per-attempt seam is smuggled back as excess runtime data.
    // The new architecture must ignore it and select exclusively by the
    // authentic active Slice hash; the old architecture would bind Slice B.
    const smuggledSliceBAuthority = makeAuthority(
      root,
      ['src/b/**'],
      [{ path: 'src/b/b.ts', operation: 'update' }],
      sliceB.sliceId,
    );
    const resultPromise = coordinator.runAttempt({
      runtime: runtimeA,
      attemptId: 'a1',
      prompt: 'p1',
      fsAuthority: smuggledSliceBAuthority,
    } as unknown as WorkerAttemptInput);

    await waitFor(() => sessions.liveSessionCount === 1);
    const sessionId = harness.children[0].session.id;
    const sliceRuntime = createSliceFsRuntime(sessions);
    const binding = sessions.getBinding(sessionId)!;
    expect(binding.authority.sliceId).toBe(sliceA.sliceHash);
    expect(binding.authority.allowedReads).toEqual(['src/a/**']);

    await expect(
      sliceRead(sessions, sessionId, { path: 'src/a/a.ts' }),
    ).resolves.toMatchObject({ content: 'a-allowed' });
    // Slice B content is outside this authentic Slice A binding.
    await expectFsError(
      sliceRuntime.read(sessionId, { path: 'src/b/b.ts' }),
      FS_ERROR_CODES.SLICE_READ_SCOPE_VIOLATION,
    );

    harness.resolveChild(0, COMPLETED_TERMINAL);
    const result = await resultPromise;
    expect(result.settled).toBe(true);
    expect(result.outcome).toBe('INVALIDATED');
    expect(result.error?.code).toBe(FS_ERROR_CODES.SLICE_READ_SCOPE_VIOLATION);
    expect(result.runtime.activeSlice?.phase).toBe('SCOPE_BLOCKED');
    expect(await readFile(join(root, 'src/b/b.ts'), 'utf8')).toBe('b-forbidden');
    expect(sessions.liveSessionCount).toBe(0);

    // A coordinator configured with only Slice B's frozen data must fail
    // closed for runtime Slice A before any child is created. This is the
    // mismatch the removed per-attempt fsAuthority seam used to permit.
    const mismatchPort = new FakeWorkerPort();
    const mismatchSessions = createSliceFsSessionRegistry();
    const mismatchCoordinator = new WorkerLifecycleCoordinator(
      mismatchPort,
      config,
      mismatchSessions,
      makeWorkerFsConfig(root, [sliceB]),
    );

    await expect(
      mismatchCoordinator.runAttempt({
        runtime: admitFrozenSlice(sliceA),
        attemptId: 'a2',
        prompt: 'p2',
      }),
    ).rejects.toMatchObject({
      code: WORKER_ERROR_CODES.ACTIVE_SLICE_AUTHORITY_NOT_RECOVERABLE,
    });
    expect(mismatchPort.spawnCount).toBe(0);
    expect(mismatchSessions.liveSessionCount).toBe(0);
    expect(mismatchSessions.retainedRecordCount).toBe(0);
  });
});


describe('FS-33 lower-layer authority injection impossible', () => {
  it('exported WorkerPort.spawn cannot accept an arbitrary Slice B authority and bind a child to it', async () => {
    const root = fixture.root;
    await putFile(root, 'src/b/b.ts', 'b-forbidden');
    const sliceB = makeAuthority(
      root,
      ['src/b/**'],
      [{ path: 'src/b/b.ts', operation: 'update' }],
      'slice-b',
    );

    const harness = createFakeDshHarness();
    const config = createTestConfig();
    const port = createDshWorkerPort(harness.context, config);
    const sessions = createSliceFsSessionRegistry();

    // The public WorkerSpawnRequest type no longer contains fsAuthority or
    // fsSessions. These compile-time assertions prove the exported API rejects
    // each old lower-layer injection field independently.
    const authoritySmuggled: WorkerSpawnRequest = {
      attemptId: 'a1',
      prompt: 'p1',
      config,
      // @ts-expect-error -- fsAuthority was removed from the public WorkerPort seam
      fsAuthority: sliceB,
    };
    const sessionsSmuggled: WorkerSpawnRequest = {
      attemptId: 'a1',
      prompt: 'p1',
      config,
      // @ts-expect-error -- fsSessions was removed from the public WorkerPort seam
      fsSessions: sessions,
    };
    void authoritySmuggled;
    void sessionsSmuggled;

    // At runtime, even a hostile cast that smuggles the old fields through the
    // public seam must not bind the child to Slice B.
    const run = await port.spawn({
      attemptId: 'a1',
      prompt: 'p1',
      config,
      fsAuthority: sliceB,
      fsSessions: sessions,
    } as never);

    const child = harness.children[0];
    expect(sessions.liveSessionCount).toBe(0);
    expect(sessions.getBinding(child.session.id)).toBeNull();
    expect(sessions.retainedRecordCount).toBe(0);

    // The smuggled Slice B authority did not create any usable binding.
    const sliceRuntime = createSliceFsRuntime(sessions);
    await expectFsError(
      sliceRuntime.read(child.session.id, { path: 'src/b/b.ts' }),
      FS_ERROR_CODES.FS_SESSION_UNKNOWN,
    );

    harness.resolveChild(0, COMPLETED_TERMINAL);
    await run.result;
    await run.dispose();
    expect(sessions.liveSessionCount).toBe(0);
  });
});

describe('FS-34 prepared read authority cannot be widened at runtime', () => {
  it('caller-side mutation attempts on every exposed read surface leave unauthorized reads denied', async () => {
    const root = fixture.root;
    await putFile(root, 'src/fs/a.ts', 'allowed');
    await putFile(root, 'src/secret/secret.ts', 'secret');
    const authority = makeAuthority(root, ['src/fs/**'], []);
    const sessions = createSliceFsSessionRegistry();
    sessions.bind('s1', 'attempt-1', authority);
    const runtime = createSliceFsRuntime(sessions);

    // Previously exposed mutable/read-affecting containers are no longer on
    // the prepared authority object.
    expect((authority as { exactReadPaths?: unknown }).exactReadPaths).toBeUndefined();
    expect(Object.isFrozen(authority.allowedReads)).toBe(true);
    expect(Object.isFrozen(authority.readRules)).toBe(true);
    expect(Object.isFrozen(authority.recursiveReadPrefixes)).toBe(true);
    if (authority.readRules.length > 0) {
      expect(Object.isFrozen(authority.readRules[0])).toBe(true);
    }

    // Attempt every caller-side mutation that could previously have affected
    // read authorization. None of these may widen the effective authority.
    expect(() => (authority.allowedReads as string[]).push('src/secret/**')).toThrow();
    expect(() => (authority.readRules as unknown[]).push({})).toThrow();
    expect(() => (authority.recursiveReadPrefixes as string[]).push('src/secret')).toThrow();
    (authority as unknown as { exactReadPaths?: Set<string> }).exactReadPaths?.add?.('src/secret/secret.ts');
    expect(() => {
      (authority as unknown as { readRules: Array<{ absoluteRoot: string }> }).readRules[0].absoluteRoot = '/etc';
    }).toThrow();

    await expectFsError(
      runtime.read('s1', { path: 'src/secret/secret.ts' }),
      FS_ERROR_CODES.SLICE_READ_SCOPE_VIOLATION,
    );
    await expectFsError(
      runtime.search('s1', { path: 'src/secret', pattern: 'secret' }),
      FS_ERROR_CODES.SLICE_READ_SCOPE_VIOLATION,
    );
    expect(await readFile(join(root, 'src/secret/secret.ts'), 'utf8')).toBe('secret');
  });
});

describe('FS-35 prepared write authority cannot be widened at runtime', () => {
  it('caller-side mutation attempts on every exposed write surface leave unauthorized writes denied', async () => {
    const root = fixture.root;
    await putFile(root, 'src/fs/a.ts', 'before');
    const authority = makeAuthority(
      root,
      [],
      [{ path: 'src/fs/a.ts', operation: 'update' }],
    );
    const sessions = createSliceFsSessionRegistry();
    sessions.bind('s1', 'attempt-1', authority);
    const runtime = createSliceFsRuntime(sessions);

    // Previously exposed mutable write-affecting container is no longer on
    // the prepared authority object.
    expect((authority as { writeOperations?: unknown }).writeOperations).toBeUndefined();
    expect(Object.isFrozen(authority.allowedWrites)).toBe(true);
    expect(Object.isFrozen(authority.writeRules)).toBe(true);
    if (authority.allowedWrites.length > 0) {
      expect(Object.isFrozen(authority.allowedWrites[0])).toBe(true);
    }
    if (authority.writeRules.length > 0) {
      expect(Object.isFrozen(authority.writeRules[0])).toBe(true);
    }

    // Attempt every caller-side mutation that could previously have affected
    // write authorization.
    expect(() => (authority.allowedWrites as unknown[]).push({ path: 'src/secret/secret.ts', operation: 'update' })).toThrow();
    expect(() => (authority.writeRules as unknown[]).push({})).toThrow();
    (authority as unknown as { writeOperations?: Map<string, Set<string>> }).writeOperations?.set?.('src/secret/secret.ts', new Set(['update']));
    (authority as unknown as { writeOperations?: Map<string, Set<string>> }).writeOperations?.get?.('src/fs/a.ts')?.add?.('create');
    if (authority.allowedWrites.length > 0) {
      expect(() => {
        (authority.allowedWrites as unknown as Array<{ path: string }>)[0].path = 'src/secret/secret.ts';
      }).toThrow();
    }
    if (authority.writeRules.length > 0) {
      expect(() => {
        (authority.writeRules as unknown as Array<{ rawPath: string }>)[0].rawPath = 'src/secret/secret.ts';
      }).toThrow();
    }

    await expectFsError(
      runtime.write('s1', { path: 'src/secret/secret.ts', content: 'nope' }),
      FS_ERROR_CODES.SLICE_WRITE_SCOPE_VIOLATION,
    );
    await expectFsError(
      runtime.edit('s1', {
        path: 'src/secret/secret.ts',
        oldText: 'nope',
        newText: 'worse',
      }),
      FS_ERROR_CODES.SLICE_WRITE_SCOPE_VIOLATION,
    );
    expect(existsSync(join(root, 'src/secret/secret.ts'))).toBe(false);
    expect(await readFile(join(root, 'src/fs/a.ts'), 'utf8')).toBe('before');
  });
});

describe('FS-25/FS-26 implicit search honors the symlink policy', () => {

  async function createParentSymlink(root: string): Promise<void> {
    await ensureDir(root, 'src');
    await ensureDir(root, 'outside-dir');
    await putFile(root, 'outside-dir/target.txt', 'outside-needle-content');
    const outsideAbsolute = join(root, 'outside-dir');
    const linkAbsolute = join(root, 'src/linked');
    await symlink(
      outsideAbsolute,
      linkAbsolute,
      process.platform === 'win32' ? 'junction' : 'dir',
    );
  }

  it('FS-25 implicit search over an exact allowedRead with a symlink parent is blocked and returns no target content', async () => {
    const root = fixture.root;
    await createParentSymlink(root);
    const authority = makeAuthority(root, ['src/linked/target.txt'], []);
    const sessions = createSliceFsSessionRegistry();
    sessions.bind('s1', 'attempt-1', authority);
    const runtime = createSliceFsRuntime(sessions);

    const error = await expectFsError(
      runtime.search('s1', { pattern: 'outside-needle-content' }),
      FS_ERROR_CODES.SYMLINK_POLICY_BLOCK,
    );

    expect(error.message).not.toContain('outside-needle-content');
    expect(await readFile(join(root, 'outside-dir/target.txt'), 'utf8')).toBe(
      'outside-needle-content',
    );
    expect(sessions.getViolation('s1')?.code).toBe(
      FS_ERROR_CODES.SYMLINK_POLICY_BLOCK,
    );
  });

  it('FS-26 implicit search over a recursive allowedRead whose root is a symlink/junction is blocked and returns no target content', async () => {
    const root = fixture.root;
    await createParentSymlink(root);
    const authority = makeAuthority(root, ['src/linked/**'], []);
    const sessions = createSliceFsSessionRegistry();
    sessions.bind('s1', 'attempt-1', authority);
    const runtime = createSliceFsRuntime(sessions);

    const error = await expectFsError(
      runtime.search('s1', { pattern: 'outside-needle-content' }),
      FS_ERROR_CODES.SYMLINK_POLICY_BLOCK,
    );

    expect(error.message).not.toContain('outside-needle-content');
    expect(await readFile(join(root, 'outside-dir/target.txt'), 'utf8')).toBe(
      'outside-needle-content',
    );
    expect(sessions.getViolation('s1')?.code).toBe(
      FS_ERROR_CODES.SYMLINK_POLICY_BLOCK,
    );
  });
});

describe('FS-27 released-session retention', () => {
  it('many unique bind/release cycles leave no live binding and no retained authorization record', async () => {
    const root = fixture.root;
    const authority = makeAuthority(root, ['src/fs/**'], []);
    const sessions = createSliceFsSessionRegistry();
    const runtime = createSliceFsRuntime(sessions);
    const ids: string[] = [];

    for (let index = 0; index < 250; index += 1) {
      const sessionId = `release-session-${index}`;
      ids.push(sessionId);
      sessions.bind(sessionId, `attempt-${index}`, authority);
      sessions.release(sessionId);
    }

    expect(sessions.liveSessionCount).toBe(0);
    expect(sessions.retainedRecordCount).toBe(0);
    for (const sessionId of ids) {
      expect(sessions.getBinding(sessionId)).toBeNull();
      expect(sessions.getViolation(sessionId)).toBeNull();
      await expectFsError(
        runtime.read(sessionId, { path: 'src/fs/a.ts' }),
        FS_ERROR_CODES.FS_SESSION_UNKNOWN,
      );
    }

    // Previously-released and never-known IDs are intentionally
    // indistinguishable after release; re-binding is a fresh live binding.
    const rebound = sessions.bind(ids[0], 'fresh-attempt', authority);
    expect(rebound.sessionId).toBe(ids[0]);
    expect(sessions.liveSessionCount).toBe(1);
    expect(sessions.retainedRecordCount).toBe(1);
    sessions.release(ids[0]);
    expect(sessions.retainedRecordCount).toBe(0);
  });
});

describe('FS-28 post-handle binding cleanup failure is fail-stop', () => {
  class BindingFailureRegistry extends SliceFsSessionRegistry {
    failNextBind = true;

    override bind(
      sessionIdValue: unknown,
      attemptIdValue: unknown,
      authority: SliceFsAuthority,
    ): ReturnType<SliceFsSessionRegistry['bind']> {
      if (this.failNextBind) {
        this.failNextBind = false;
        throw new FsError(
          FS_ERROR_CODES.FS_SESSION_ALREADY_BOUND,
          'injected binding failure before any authorization record exists',
        );
      }
      return super.bind(sessionIdValue, attemptIdValue, authority);
    }
  }

  it('binding failure after AgentHandle creation plus handle.dispose failure is observable, keeps coordinator occupied, and leaves no authority', async () => {
    const root = fixture.root;
    await putFile(root, 'src/fs/allowed.ts', 'before');
    const frozenSlice = makeFrozenSlice(
      'slice-s5',
      ['src/fs/**'],
      [{ path: 'src/fs/allowed.ts', operation: 'update' }],
    );
    const runtime = admitFrozenSlice(frozenSlice);

    const harness = createFakeDshHarness({
      disposeError: new Error('injected handle dispose failure'),
    });
    const config = createTestConfig();
    const port = createDshWorkerPort(harness.context, config);
    const sessions = new BindingFailureRegistry();
    const coordinator = new WorkerLifecycleCoordinator(
      port,
      config,
      sessions,
      makeWorkerFsConfig(root, [frozenSlice]),
    );

    const result = await coordinator.runAttempt({
      runtime,
      attemptId: 'a1',
      prompt: 'p1',
    });

    expect(result.settled).toBe(false);
    expect(result.outcome).toBe('FAILED');
    expect(result.error?.code).toBe(WORKER_ERROR_CODES.WORKER_DISPOSE_FAILED);
    expect(result.error?.code).not.toBe(WORKER_ERROR_CODES.WORKER_SPAWN_FAILED);
    expect(result.error?.message).toContain('injected binding failure');
    expect(result.error?.message).toContain('injected handle dispose failure');
    expect(result.attempt.phase).toBe('SPAWNING');
    expect(result.runtime.activeSlice?.phase).toBe('RUNNING');
    expect(coordinator.isActive).toBe(true);
    expect(harness.createdOptions).toHaveLength(1);
    expect(harness.disposeCounts[0]).toBe(1);
    expect(sessions.liveSessionCount).toBe(0);
    expect(sessions.retainedRecordCount).toBe(0);
    expect(sessions.getBinding('child-session-1')).toBeNull();

    // No next worker may spawn while cleanup is unresolved.
    await expect(
      coordinator.runAttempt({
        runtime: admitFrozenSlice(frozenSlice),
        attemptId: 'a2',
        prompt: 'p2',
      }),
    ).rejects.toMatchObject({ code: WORKER_ERROR_CODES.WORKER_ALREADY_ACTIVE });
    expect(harness.createdOptions).toHaveLength(1);

    // No filesystem authority remains usable for the would-be child session.
    const sliceRuntime = createSliceFsRuntime(sessions);
    await expectFsError(
      sliceRuntime.write('child-session-1', {
        path: 'src/fs/allowed.ts',
        content: 'must-not-write',
      }),
      FS_ERROR_CODES.FS_SESSION_UNKNOWN,
    );
    expect(await readFile(join(root, 'src/fs/allowed.ts'), 'utf8')).toBe('before');
  });

  it('binding failure after AgentHandle creation with successful dispose is an ordinary recoverable SPAWN_FAILED and retry is allowed', async () => {
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
    const sessions = new BindingFailureRegistry();
    const coordinator = new WorkerLifecycleCoordinator(
      port,
      config,
      sessions,
      makeWorkerFsConfig(root, [frozenSlice]),
    );

    const first = await coordinator.runAttempt({
      runtime,
      attemptId: 'a1',
      prompt: 'p1',
    });

    expect(first.settled).toBe(true);
    expect(first.outcome).toBe('FAILED');
    expect(first.error?.code).toBe(WORKER_ERROR_CODES.WORKER_SPAWN_FAILED);
    expect(first.attempt.phase).toBe('SPAWN_FAILED');
    expect(harness.disposeCounts[0]).toBe(1);
    expect(sessions.liveSessionCount).toBe(0);
    expect(sessions.retainedRecordCount).toBe(0);
    expect(coordinator.isActive).toBe(false);

    const retriedRuntime = retryActiveSlice(first.runtime);
    const secondPromise = coordinator.runAttempt({
      runtime: retriedRuntime,
      attemptId: 'a2',
      prompt: 'p2',
    });
    await waitFor(() => harness.children.length === 2);
    harness.resolveChild(1, COMPLETED_TERMINAL);
    const second = await secondPromise;

    expect(second.settled).toBe(true);
    expect(second.outcome).toBe('SUCCESS');
    expect(harness.createdOptions).toHaveLength(2);
    expect(harness.disposeCounts[0]).toBe(1);
    expect(harness.disposeCounts[1]).toBe(1);
    expect(sessions.liveSessionCount).toBe(0);
  });

  it('spawn failure before a handle exists still disposes zero runs and permits a normal retry', async () => {
    const root = fixture.root;
    await putFile(root, 'src/fs/allowed.ts', 'before');
    const frozenSlice = makeFrozenSlice(
      'slice-s5',
      ['src/fs/**'],
      [{ path: 'src/fs/allowed.ts', operation: 'update' }],
    );

    const port = new FakeWorkerPort();
    port.failSpawn = true;
    const sessions = createSliceFsSessionRegistry();
    const coordinator = new WorkerLifecycleCoordinator(
      port,
      createTestConfig(),
      sessions,
      makeWorkerFsConfig(root, [frozenSlice]),
    );

    const first = await coordinator.runAttempt({
      runtime: admitFrozenSlice(frozenSlice),
      attemptId: 'a1',
      prompt: 'p1',
    });

    expect(first.settled).toBe(true);
    expect(first.outcome).toBe('FAILED');
    expect(first.attempt.phase).toBe('SPAWN_FAILED');
    expect(port.runs).toHaveLength(0);
    expect(sessions.liveSessionCount).toBe(0);
    expect(coordinator.isActive).toBe(false);

    port.failSpawn = false;
    const retriedRuntime = retryActiveSlice(first.runtime);
    const second = await coordinator.runAttempt({
      runtime: retriedRuntime,
      attemptId: 'a2',
      prompt: 'p2',
    });

    expect(second.settled).toBe(true);
    expect(second.outcome).toBe('SUCCESS');
    expect(port.runs).toHaveLength(1);
    expect(port.runs[0].disposeCount).toBe(1);
    expect(sessions.liveSessionCount).toBe(0);
    expect(coordinator.isActive).toBe(false);
  });
});

describe('FS-29 real identity metadata acquisition failure', () => {
  it('an injected lstat failure for the target is TARGET_IDENTITY_UNSAFE, mutates nothing, and records a trusted violation', async () => {
    const root = fixture.root;
    await putFile(root, 'src/fs/target.ts', 'before');
    const authority = makeAuthority(
      root,
      [],
      [{ path: 'src/fs/target.ts', operation: 'update' }],
    );
    const sessions = createSliceFsSessionRegistry();
    sessions.bind('s1', 'attempt-1', authority);

    const targetAbsolute = join(root, 'src/fs/target.ts');
    let identityFailures = 0;
    const runtime = createSliceFsRuntime(sessions, {
      lstat: async (path) => {
        if (path === targetAbsolute) {
          identityFailures += 1;
          throw new Error('injected identity metadata acquisition failure');
        }
        return lstat(path);
      },
    });

    const error = await expectFsError(
      runtime.write('s1', {
        path: 'src/fs/target.ts',
        content: 'mutated',
      }),
      FS_ERROR_CODES.TARGET_IDENTITY_UNSAFE,
    );

    expect(identityFailures).toBeGreaterThan(0);
    expect(error.message).toContain('injected identity metadata acquisition failure');
    expect(await readFile(targetAbsolute, 'utf8')).toBe('before');
    expect(sessions.getViolation('s1')?.code).toBe(
      FS_ERROR_CODES.TARGET_IDENTITY_UNSAFE,
    );
  });
});
