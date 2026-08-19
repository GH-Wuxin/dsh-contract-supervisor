import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  createSliceFsRuntime,
  createSliceFsSessionRegistry,
  createSliceFsToolDefinitions,
  FS_ERROR_CODES,
  FsError,
} from '../../src/fs/index.js';
import { createFsFixture, makeAuthority, putFile } from './helpers.js';
import type { FsFixture } from './helpers.js';
import { createDshWorkerPort } from '../../src/worker/index.js';
import { createFakeDshHarness } from '../worker/dsh-test-helpers.js';
import { createTestConfig } from '../worker/helpers.js';

let fixture: FsFixture;

beforeEach(async () => {
  fixture = await createFsFixture();
});

afterEach(async () => {
  await fixture.cleanup();
});

function fakeExecution(sessionId: string): never {
  // The real DSH pipeline supplies ToolRunContext. The definition body only
  // consumes `exec.agent.id` for trusted session identity, never tool args.
  return {
    agent: { id: sessionId },
  } as never;
}

describe('C4A DSH tool definitions are the audited exposure surface', () => {
  it('definitions expose exactly slice_read/search/write/edit and enforce authority through the trusted execution identity', async () => {
    const root = fixture.root;
    await putFile(root, 'src/fs/a.ts', 'before');
    const authority = makeAuthority(
      root,
      ['src/fs/**'],
      [{ path: 'src/fs/a.ts', operation: 'update' }],
    );
    const sessions = createSliceFsSessionRegistry();
    sessions.bind('trusted-session', 'attempt-1', authority);
    const runtime = createSliceFsRuntime(sessions);
    const definitions = createSliceFsToolDefinitions(runtime);

    expect(Object.keys(definitions).sort()).toEqual([
      'slice_edit',
      'slice_read',
      'slice_search',
      'slice_write',
    ]);

    await expect(
      definitions.slice_read.execute(
        { path: 'src/fs/a.ts' },
        fakeExecution('trusted-session'),
      ),
    ).resolves.toMatchObject({ path: 'src/fs/a.ts', content: 'before' });

    await definitions.slice_write.execute(
      { path: 'src/fs/a.ts', content: 'after' },
      fakeExecution('trusted-session'),
    );
    expect(await readFile(join(root, 'src/fs/a.ts'), 'utf8')).toBe('after');

    await expect(
      definitions.slice_search.execute(
        { path: 'src/fs', pattern: 'after' },
        fakeExecution('trusted-session'),
      ),
    ).resolves.toMatchObject({ filesSearched: 1 });

    await expect(
      definitions.slice_edit.execute(
        { path: 'src/fs/a.ts', oldText: 'after', newText: 'edited' },
        fakeExecution('trusted-session'),
      ),
    ).resolves.toMatchObject({ replaced: true, occurrences: 1 });
    expect(await readFile(join(root, 'src/fs/a.ts'), 'utf8')).toBe('edited');
  });

  it('definition execution without a trusted agent identity fails closed', async () => {
    const root = fixture.root;
    await putFile(root, 'src/fs/a.ts', 'before');
    const authority = makeAuthority(root, ['src/fs/**'], []);
    const sessions = createSliceFsSessionRegistry();
    sessions.bind('trusted-session', 'attempt-1', authority);
    const definitions = createSliceFsToolDefinitions(createSliceFsRuntime(sessions));

    try {
      await definitions.slice_read.execute(
        { path: 'src/fs/a.ts' },
        { agent: undefined } as never,
      );
      throw new Error('expected failure');
    } catch (error) {
      expect(error).toBeInstanceOf(FsError);
      expect((error as FsError).code).toBe(FS_ERROR_CODES.FS_SESSION_UNKNOWN);
    }
  });
});


describe('FS-32 fake DSH harness identity bridge', () => {
  it('binds by child.session.id and resolves execution.agent.id to the same live binding', async () => {
    const root = fixture.root;
    await putFile(root, 'src/fs/a.ts', 'before');
    const authority = makeAuthority(
      root,
      ['src/fs/**'],
      [{ path: 'src/fs/a.ts', operation: 'update' }],
    );

    const harness = createFakeDshHarness();
    const config = createTestConfig();
    const port = createDshWorkerPort(harness.context, config);
    const run = await port.spawn({
      attemptId: 'a1',
      prompt: 'p1',
      config,
    });

    const child = harness.children[0];
    expect(child.id).toBe(child.session.id);
    expect(child.agent.id).toBe(child.session.id);

    const sessions = createSliceFsSessionRegistry();
    sessions.bind(child.session.id, 'attempt-1', authority);
    const runtime = createSliceFsRuntime(sessions);
    const definitions = createSliceFsToolDefinitions(runtime);

    await expect(
      definitions.slice_read.execute(
        { path: 'src/fs/a.ts' },
        { agent: child.agent } as never,
      ),
    ).resolves.toMatchObject({ path: 'src/fs/a.ts', content: 'before' });

    await expect(
      definitions.slice_write.execute(
        { path: 'src/fs/a.ts', content: 'after' },
        { agent: child.agent } as never,
      ),
    ).resolves.toMatchObject({ path: 'src/fs/a.ts', written: true });
    expect(await readFile(join(root, 'src/fs/a.ts'), 'utf8')).toBe('after');

    harness.resolveChild(0, { kind: 'completed' });
    await run.result;
    await run.dispose();
  });
});
