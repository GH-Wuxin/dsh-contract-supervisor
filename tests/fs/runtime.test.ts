import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { link, lstat, mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import {
  createSliceFsRuntime,
  createSliceFsSessionRegistry,
  FS_ERROR_CODES,
  FsError,
} from '../../src/fs/index.js';
import {
  createFsFixture,
  ensureDir,
  makeAuthority,
  putFile,
} from './helpers.js';
import type { FsFixture } from './helpers.js';

let fixture: FsFixture;

beforeEach(async () => {
  fixture = await createFsFixture();
});

afterEach(async () => {
  await fixture.cleanup();
});

function registry(): ReturnType<typeof createSliceFsSessionRegistry> {
  return createSliceFsSessionRegistry();
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

describe('S5 audited filesystem authority (FS-01..FS-16)', () => {
  it('FS-01 exact authorized read succeeds', async () => {
    const root = fixture.root;
    await putFile(root, 'src/domain/example.ts', 'export const x = 1;\n');
    const authority = makeAuthority(root, ['src/domain/**'], []);
    const sessions = registry();
    sessions.bind('s1', 'attempt-1', authority);
    const runtime = createSliceFsRuntime(sessions);

    const result = await runtime.read('s1', { path: 'src/domain/example.ts' });

    expect(result.path).toBe('src/domain/example.ts');
    expect(result.content).toBe('export const x = 1;\n');
    expect(sessions.getViolation('s1')).toBeNull();
  });

  it('FS-02 unauthorized read yields SLICE_READ_SCOPE_VIOLATION and returns no content', async () => {
    const root = fixture.root;
    await putFile(root, 'src/domain/ok.ts', 'ok');
    await putFile(root, 'src/secret/secret.ts', 'secret');
    const authority = makeAuthority(root, ['src/domain/**'], []);
    const sessions = registry();
    sessions.bind('s1', 'attempt-1', authority);
    const runtime = createSliceFsRuntime(sessions);

    const error = await expectFsError(
      runtime.read('s1', { path: 'src/secret/secret.ts' }),
      FS_ERROR_CODES.SLICE_READ_SCOPE_VIOLATION,
    );

    expect(error.message).not.toContain('secret content');
    expect(await readFile(join(root, 'src/secret/secret.ts'), 'utf8')).toBe('secret');
    expect(sessions.getViolation('s1')?.code).toBe(
      FS_ERROR_CODES.SLICE_READ_SCOPE_VIOLATION,
    );
  });

  it('FS-03 exact authorized write succeeds', async () => {
    const root = fixture.root;
    await putFile(root, 'src/fs/a.ts', 'before');
    const authority = makeAuthority(
      root,
      [],
      [{ path: 'src/fs/a.ts', operation: 'update' }],
    );
    const sessions = registry();
    sessions.bind('s1', 'attempt-1', authority);
    const runtime = createSliceFsRuntime(sessions);

    const result = await runtime.write('s1', {
      path: 'src/fs/a.ts',
      content: 'after',
    });

    expect(result).toMatchObject({
      path: 'src/fs/a.ts',
      written: true,
      created: false,
    });
    expect(await readFile(join(root, 'src/fs/a.ts'), 'utf8')).toBe('after');
    expect(sessions.getViolation('s1')).toBeNull();
  });

  it('FS-04 unauthorized write yields SLICE_WRITE_SCOPE_VIOLATION and does not mutate or create', async () => {
    const root = fixture.root;
    await putFile(root, 'src/fs/a.ts', 'unchanged');
    const authority = makeAuthority(
      root,
      [],
      [{ path: 'src/fs/a.ts', operation: 'update' }],
    );
    const sessions = registry();
    sessions.bind('s1', 'attempt-1', authority);
    const runtime = createSliceFsRuntime(sessions);

    await expectFsError(
      runtime.write('s1', { path: 'src/fs/b.ts', content: 'nope' }),
      FS_ERROR_CODES.SLICE_WRITE_SCOPE_VIOLATION,
    );

    expect(await readFile(join(root, 'src/fs/a.ts'), 'utf8')).toBe('unchanged');
    expect(existsSync(join(root, 'src/fs/b.ts'))).toBe(false);
    expect(sessions.getViolation('s1')?.code).toBe(
      FS_ERROR_CODES.SLICE_WRITE_SCOPE_VIOLATION,
    );
  });

  it('FS-05 ../ traversal cannot escape the frozen repository root', async () => {
    const root = fixture.root;
    await putFile(root, 'src/fs/a.ts', 'inside');
    const outsideName = `s5-escape-${randomUUID()}.txt`;
    const outsidePath = join(root, '..', outsideName);
    const authority = makeAuthority(
      root,
      ['src/fs/**'],
      [{ path: 'src/fs/a.ts', operation: 'update' }],
    );
    const sessions = registry();
    sessions.bind('s1', 'attempt-1', authority);
    const runtime = createSliceFsRuntime(sessions);

    await expectFsError(
      runtime.write('s1', {
        path: `../${outsideName}`,
        content: 'escaped',
      }),
      FS_ERROR_CODES.SLICE_WRITE_SCOPE_VIOLATION,
    );
    expect(existsSync(outsidePath)).toBe(false);

    await expectFsError(
      runtime.read('s1', { path: `../${outsideName}` }),
      FS_ERROR_CODES.SLICE_READ_SCOPE_VIOLATION,
    );
    expect(await readFile(join(root, 'src/fs/a.ts'), 'utf8')).toBe('inside');
  });

  it('FS-06 an absolute alias cannot widen authority', async () => {
    const root = fixture.root;
    await putFile(root, 'src/fs/a.ts', 'unchanged');
    await putFile(root, 'src/other/other.ts', 'other');
    const authority = makeAuthority(
      root,
      ['src/fs/**'],
      [{ path: 'src/fs/a.ts', operation: 'update' }],
    );
    const sessions = registry();
    sessions.bind('s1', 'attempt-1', authority);
    const runtime = createSliceFsRuntime(sessions);

    const absoluteOther = join(root, 'src/other/other.ts');
    await expectFsError(
      runtime.read('s1', { path: absoluteOther }),
      FS_ERROR_CODES.SLICE_READ_SCOPE_VIOLATION,
    );
    await expectFsError(
      runtime.write('s1', { path: absoluteOther, content: 'nope' }),
      FS_ERROR_CODES.SLICE_WRITE_SCOPE_VIOLATION,
    );
    expect(await readFile(join(root, 'src/other/other.ts'), 'utf8')).toBe('other');

    // A safe absolute alias of an already authorized target is canonicalized
    // back to the exact repo-relative path and remains authorized.
    await expect(
      runtime.read('s1', { path: join(root, 'src/fs/a.ts') }),
    ).resolves.toMatchObject({ path: 'src/fs/a.ts', content: 'unchanged' });
  });

  it('FS-07 worker/model-supplied sliceId/attemptId/authority fields are rejected and cannot widen access', async () => {
    const root = fixture.root;
    await putFile(root, 'src/fs/a.ts', 'unchanged');
    await putFile(root, 'src/secret/secret.ts', 'secret');
    const authority = makeAuthority(
      root,
      ['src/fs/**'],
      [{ path: 'src/fs/a.ts', operation: 'update' }],
    );
    const sessions = registry();
    sessions.bind('real-session', 'real-attempt', authority);
    const runtime = createSliceFsRuntime(sessions);

    await expectFsError(
      runtime.read('real-session', {
        path: 'src/secret/secret.ts',
        sliceId: 'fake-slice',
        sessionId: 'fake-session',
        allowedReads: ['src/secret/**'],
      }),
      FS_ERROR_CODES.FS_INVALID_ARGUMENT,
    );

    await expectFsError(
      runtime.write('real-session', {
        path: 'src/fs/a.ts',
        content: 'nope',
        attemptId: 'fake-attempt',
        allowedWrites: ['src/secret/secret.ts'],
        root: '/',
        authority: {},
      }),
      FS_ERROR_CODES.FS_INVALID_ARGUMENT,
    );

    await expectFsError(
      runtime.search('real-session', {
        path: 'src/secret',
        pattern: 'secret',
        allowedReads: ['src/secret/**'],
      }),
      FS_ERROR_CODES.FS_INVALID_ARGUMENT,
    );

    expect(await readFile(join(root, 'src/fs/a.ts'), 'utf8')).toBe('unchanged');
    expect(await readFile(join(root, 'src/secret/secret.ts'), 'utf8')).toBe('secret');
    expect(sessions.getViolation('real-session')).toBeNull();
  });
});

async function tryCreateFileSymlink(target: string, linkPath: string): Promise<boolean> {
  try {
    await symlink(target, linkPath, 'file');
    return true;
  } catch {
    return false;
  }
}

describe('S5 symlink and hardlink identity policy (FS-08..FS-11)', () => {
  it('FS-08 final symlink/junction write is blocked with SYMLINK_POLICY_BLOCK and real target is unchanged', async () => {
    const root = fixture.root;
    await ensureDir(root, 'src/fs');
    await putFile(root, 'src/fs/real.txt', 'real-before');

    let finalLinkPath: string;
    if (process.platform !== 'win32') {
      finalLinkPath = 'src/fs/link.txt';
      const created = await tryCreateFileSymlink(
        join(root, 'src/fs/real.txt'),
        join(root, finalLinkPath),
      );
      expect(created).toBe(true);
    } else {
      // File symlinks require a privilege this Windows session may not have;
      // a junction is still a final reparse-point alias and must fail the
      // exact same policy before any identity/write step.
      finalLinkPath = 'src/fs/junction';
      await mkdir(join(root, 'src/fs/real-dir'), { recursive: true });
      await writeFile(join(root, 'src/fs/real-dir/real.txt'), 'real-before', 'utf8');
      await symlink(join(root, 'src/fs/real-dir'), join(root, finalLinkPath), 'junction');
    }

    const authority = makeAuthority(
      root,
      ['src/fs/**'],
      [{ path: finalLinkPath, operation: 'update' }],
    );
    const sessions = registry();
    sessions.bind('s1', 'attempt-1', authority);
    const runtime = createSliceFsRuntime(sessions);

    await expectFsError(
      runtime.write('s1', { path: finalLinkPath, content: 'mutated' }),
      FS_ERROR_CODES.SYMLINK_POLICY_BLOCK,
    );

    expect(await readFile(join(root, 'src/fs/real.txt'), 'utf8')).toBe('real-before');
    expect(sessions.getViolation('s1')?.code).toBe(FS_ERROR_CODES.SYMLINK_POLICY_BLOCK);
  });

  it('FS-09 parent symlink/junction traversal is blocked and cannot reach an outside target', async () => {
    const root = fixture.root;
    await ensureDir(root, 'src/fs');
    await putFile(root, 'src/fs/inside.txt', 'inside');

    if (process.platform === 'win32') {
      await mkdir(join(root, 'outside-dir'), { recursive: true });
      await writeFile(join(root, 'outside-dir/target.txt'), 'outside-before', 'utf8');
      await symlink(join(root, 'outside-dir'), join(root, 'src/fs/linked'), 'junction');
    } else {
      await mkdir(join(root, 'outside-dir'), { recursive: true });
      await writeFile(join(root, 'outside-dir/target.txt'), 'outside-before', 'utf8');
      await symlink(join(root, 'outside-dir'), join(root, 'src/fs/linked'), 'dir');
    }

    const authority = makeAuthority(
      root,
      ['src/fs/**'],
      [
        { path: 'src/fs/inside.txt', operation: 'update' },
        { path: 'src/fs/linked/target.txt', operation: 'update' },
      ],
    );
    const sessions = registry();
    sessions.bind('s1', 'attempt-1', authority);
    const runtime = createSliceFsRuntime(sessions);

    await expectFsError(
      runtime.write('s1', {
        path: 'src/fs/linked/target.txt',
        content: 'mutated-through-link',
      }),
      FS_ERROR_CODES.SYMLINK_POLICY_BLOCK,
    );
    await expectFsError(
      runtime.read('s1', { path: 'src/fs/linked/target.txt' }),
      FS_ERROR_CODES.SYMLINK_POLICY_BLOCK,
    );

    expect(await readFile(join(root, 'outside-dir/target.txt'), 'utf8')).toBe('outside-before');
    expect(await readFile(join(root, 'src/fs/inside.txt'), 'utf8')).toBe('inside');
  });
});

describe('S5 hardlink and identity failure policy', () => {
  it('FS-10 existing target with nlink > 1 is TARGET_IDENTITY_UNSAFE and neither linked path mutates', async () => {
    const root = fixture.root;
    await putFile(root, 'src/fs/a.txt', 'before');
    await link(join(root, 'src/fs/a.txt'), join(root, 'src/fs/b.txt'));

    const linkedStats = await lstat(join(root, 'src/fs/a.txt'));
    expect(linkedStats.nlink).toBeGreaterThan(1);

    const authority = makeAuthority(
      root,
      ['src/fs/**'],
      [{ path: 'src/fs/a.txt', operation: 'update' }],
    );
    const sessions = registry();
    sessions.bind('s1', 'attempt-1', authority);
    const runtime = createSliceFsRuntime(sessions);

    await expectFsError(
      runtime.write('s1', { path: 'src/fs/a.txt', content: 'mutated' }),
      FS_ERROR_CODES.TARGET_IDENTITY_UNSAFE,
    );
    await expectFsError(
      runtime.edit('s1', {
        path: 'src/fs/a.txt',
        oldText: 'before',
        newText: 'after',
      }),
      FS_ERROR_CODES.TARGET_IDENTITY_UNSAFE,
    );

    expect(await readFile(join(root, 'src/fs/a.txt'), 'utf8')).toBe('before');
    expect(await readFile(join(root, 'src/fs/b.txt'), 'utf8')).toBe('before');
    expect(sessions.getViolation('s1')?.code).toBe(FS_ERROR_CODES.TARGET_IDENTITY_UNSAFE);
  });

  it('FS-11 non-regular-file target rejection is TARGET_IDENTITY_UNSAFE and no mutation occurs', async () => {
    const root = fixture.root;
    await ensureDir(root, 'src/fs/not-a-file');
    const authority = makeAuthority(
      root,
      [],
      [{ path: 'src/fs/not-a-file', operation: 'update' }],
    );
    const sessions = registry();
    sessions.bind('s1', 'attempt-1', authority);
    const runtime = createSliceFsRuntime(sessions);

    await expectFsError(
      runtime.write('s1', {
        path: 'src/fs/not-a-file',
        content: 'mutated',
      }),
      FS_ERROR_CODES.TARGET_IDENTITY_UNSAFE,
    );

    const stats = await lstat(join(root, 'src/fs/not-a-file'));
    expect(stats.isDirectory()).toBe(true);
    expect(sessions.getViolation('s1')?.code).toBe(FS_ERROR_CODES.TARGET_IDENTITY_UNSAFE);
  });
});

describe('S5 edit and search contracts (FS-12..FS-16)', () => {
  it('FS-12 authorized exact edit replaces exactly one occurrence', async () => {
    const root = fixture.root;
    await putFile(root, 'src/fs/edit.ts', 'const a = old;\n');
    const authority = makeAuthority(
      root,
      ['src/fs/**'],
      [{ path: 'src/fs/edit.ts', operation: 'update' }],
    );
    const sessions = registry();
    sessions.bind('s1', 'attempt-1', authority);
    const runtime = createSliceFsRuntime(sessions);

    const result = await runtime.edit('s1', {
      path: 'src/fs/edit.ts',
      oldText: 'old',
      newText: 'new',
    });

    expect(result).toMatchObject({ path: 'src/fs/edit.ts', replaced: true, occurrences: 1 });
    expect(await readFile(join(root, 'src/fs/edit.ts'), 'utf8')).toBe('const a = new;\n');
    expect(sessions.getViolation('s1')).toBeNull();
  });

  it('FS-13 edit target outside allowedWrites is blocked and unchanged', async () => {
    const root = fixture.root;
    await putFile(root, 'src/fs/edit.ts', 'const a = old;\n');
    await putFile(root, 'src/fs/other.ts', 'other old value\n');
    const authority = makeAuthority(
      root,
      ['src/fs/**'],
      [{ path: 'src/fs/edit.ts', operation: 'update' }],
    );
    const sessions = registry();
    sessions.bind('s1', 'attempt-1', authority);
    const runtime = createSliceFsRuntime(sessions);

    await expectFsError(
      runtime.edit('s1', {
        path: 'src/fs/other.ts',
        oldText: 'old',
        newText: 'new',
      }),
      FS_ERROR_CODES.SLICE_WRITE_SCOPE_VIOLATION,
    );

    expect(await readFile(join(root, 'src/fs/other.ts'), 'utf8')).toBe('other old value\n');
    expect(sessions.getViolation('s1')?.code).toBe(FS_ERROR_CODES.SLICE_WRITE_SCOPE_VIOLATION);
  });

  it('FS-14 ambiguous oldText fails with SLICE_EDIT_MISMATCH and does not mutate', async () => {
    const root = fixture.root;
    await putFile(root, 'src/fs/edit.ts', 'old and old again\n');
    const authority = makeAuthority(
      root,
      ['src/fs/**'],
      [{ path: 'src/fs/edit.ts', operation: 'update' }],
    );
    const sessions = registry();
    sessions.bind('s1', 'attempt-1', authority);
    const runtime = createSliceFsRuntime(sessions);

    await expectFsError(
      runtime.edit('s1', {
        path: 'src/fs/edit.ts',
        oldText: 'old',
        newText: 'new',
      }),
      FS_ERROR_CODES.SLICE_EDIT_MISMATCH,
    );

    expect(await readFile(join(root, 'src/fs/edit.ts'), 'utf8')).toBe('old and old again\n');
    expect(sessions.getViolation('s1')).toBeNull();
  });

  it('FS-15 search returns matches only from allowedReads', async () => {
    const root = fixture.root;
    await putFile(root, 'src/domain/a.ts', 'needle in domain\n');
    await putFile(root, 'src/domain/nested/b.ts', 'domain nested needle\n');
    await putFile(root, 'src/state/c.ts', 'needle in state\n');
    await putFile(root, 'src/secret/d.ts', 'needle in secret\n');

    const authority = makeAuthority(root, ['src/domain/**', 'src/state/**'], []);
    const sessions = registry();
    sessions.bind('s1', 'attempt-1', authority);
    const runtime = createSliceFsRuntime(sessions);

    const result = await runtime.search('s1', { pattern: 'needle' });

    expect(result.matches.map((match) => match.path).sort()).toEqual([
      'src/domain/a.ts',
      'src/domain/nested/b.ts',
      'src/state/c.ts',
    ]);
    expect(result.matches.some((match) => match.path.includes('secret'))).toBe(false);
    expect(sessions.getViolation('s1')).toBeNull();
  });

  it('FS-16 search cannot widen to an unauthorized sibling, file, or root', async () => {
    const root = fixture.root;
    await putFile(root, 'src/domain/a.ts', 'needle\n');
    await putFile(root, 'src/domain/sub/b.ts', 'needle\n');
    await putFile(root, 'src/secret/c.ts', 'needle\n');

    const authority = makeAuthority(
      root,
      ['src/domain/**'],
      [],
    );
    const sessions = registry();
    sessions.bind('s1', 'attempt-1', authority);
    const runtime = createSliceFsRuntime(sessions);

    for (const badPath of ['src/secret', 'src/secret/c.ts', '../src/secret/c.ts']) {
      await expectFsError(
        runtime.search('s1', { path: badPath, pattern: 'needle' }),
        FS_ERROR_CODES.SLICE_READ_SCOPE_VIOLATION,
      );
    }

    // Explicit root inside authority still only returns authorized files.
    const result = await runtime.search('s1', { path: 'src/domain/sub', pattern: 'needle' });
    expect(result.matches.map((match) => match.path)).toEqual(['src/domain/sub/b.ts']);
  });
});

describe('S5 session binding (FS-17..FS-20)', () => {
  it('FS-17 unknown worker session fails closed with no filesystem operation', async () => {
    const root = fixture.root;
    await putFile(root, 'src/fs/a.ts', 'before');
    const authority = makeAuthority(
      root,
      ['src/fs/**'],
      [{ path: 'src/fs/a.ts', operation: 'update' }],
    );
    const sessions = registry();
    const runtime = createSliceFsRuntime(sessions);

    await expectFsError(
      runtime.write('unknown-session', { path: 'src/fs/a.ts', content: 'mutated' }),
      FS_ERROR_CODES.FS_SESSION_UNKNOWN,
    );
    await expectFsError(
      runtime.read('unknown-session', { path: 'src/fs/a.ts' }),
      FS_ERROR_CODES.FS_SESSION_UNKNOWN,
    );

    expect(await readFile(join(root, 'src/fs/a.ts'), 'utf8')).toBe('before');
    expect(sessions.liveSessionCount).toBe(0);
  });

  it('FS-18 session A authority cannot be used by session B', async () => {
    const root = fixture.root;
    await putFile(root, 'src/a/a.ts', 'a-before');
    await putFile(root, 'src/b/b.ts', 'b-before');

    const authorityA = makeAuthority(
      root,
      ['src/a/**'],
      [{ path: 'src/a/a.ts', operation: 'update' }],
      'slice-a',
    );
    const authorityB = makeAuthority(
      root,
      ['src/b/**'],
      [{ path: 'src/b/b.ts', operation: 'update' }],
      'slice-b',
    );
    const sessions = registry();
    sessions.bind('session-a', 'attempt-a', authorityA);
    sessions.bind('session-b', 'attempt-b', authorityB);
    const runtime = createSliceFsRuntime(sessions);

    await expectFsError(
      runtime.read('session-a', { path: 'src/b/b.ts' }),
      FS_ERROR_CODES.SLICE_READ_SCOPE_VIOLATION,
    );
    await expectFsError(
      runtime.write('session-a', { path: 'src/b/b.ts', content: 'mutated' }),
      FS_ERROR_CODES.SLICE_WRITE_SCOPE_VIOLATION,
    );
    await expect(
      runtime.read('session-b', { path: 'src/b/b.ts' }),
    ).resolves.toMatchObject({ content: 'b-before' });

    expect(await readFile(join(root, 'src/b/b.ts'), 'utf8')).toBe('b-before');
    expect(sessions.getViolation('session-a')?.code).toBe(
      FS_ERROR_CODES.SLICE_READ_SCOPE_VIOLATION,
    );
    expect(sessions.getViolation('session-b')).toBeNull();
  });

  it('FS-19 released session loses authority and cannot mutate', async () => {
    const root = fixture.root;
    await putFile(root, 'src/fs/a.ts', 'before');
    const authority = makeAuthority(
      root,
      ['src/fs/**'],
      [{ path: 'src/fs/a.ts', operation: 'update' }],
    );
    const sessions = registry();
    sessions.bind('session-a', 'attempt-a', authority);
    const runtime = createSliceFsRuntime(sessions);

    expect(sessions.getBinding('session-a')).not.toBeNull();
    sessions.release('session-a');
    expect(sessions.getBinding('session-a')).toBeNull();
    expect(sessions.liveSessionCount).toBe(0);

    await expectFsError(
      runtime.write('session-a', { path: 'src/fs/a.ts', content: 'mutated' }),
      FS_ERROR_CODES.FS_SESSION_UNKNOWN,
    );
    expect(await readFile(join(root, 'src/fs/a.ts'), 'utf8')).toBe('before');
  });

  it('FS-20 fresh session receives only its own bound Slice authority', async () => {
    const root = fixture.root;
    await putFile(root, 'src/old/old.ts', 'old');
    await putFile(root, 'src/new/new.ts', 'new');

    const oldAuthority = makeAuthority(
      root,
      ['src/old/**'],
      [{ path: 'src/old/old.ts', operation: 'update' }],
      'slice-old',
    );
    const newAuthority = makeAuthority(
      root,
      ['src/new/**'],
      [{ path: 'src/new/new.ts', operation: 'update' }],
      'slice-new',
    );
    const sessions = registry();
    const oldBinding = sessions.bind('old-session', 'old-attempt', oldAuthority);
    sessions.release('old-session');
    expect(oldBinding).toBeDefined();

    sessions.bind('fresh-session', 'fresh-attempt', newAuthority);
    const runtime = createSliceFsRuntime(sessions);

    await expect(
      runtime.read('fresh-session', { path: 'src/new/new.ts' }),
    ).resolves.toMatchObject({ content: 'new' });
    await expectFsError(
      runtime.read('fresh-session', { path: 'src/old/old.ts' }),
      FS_ERROR_CODES.SLICE_READ_SCOPE_VIOLATION,
    );
    await expectFsError(
      runtime.write('fresh-session', { path: 'src/old/old.ts', content: 'mutated' }),
      FS_ERROR_CODES.SLICE_WRITE_SCOPE_VIOLATION,
    );

    expect(await readFile(join(root, 'src/old/old.ts'), 'utf8')).toBe('old');
    expect(sessions.getViolation('fresh-session')?.code).toBe(
      FS_ERROR_CODES.SLICE_READ_SCOPE_VIOLATION,
    );
    expect(sessions.getViolation('old-session')).toBeNull();
  });
});

describe('S5 exact write/new-file semantics', () => {
  it('exact allowedWrites does not grant siblings, suffix aliases, or nested paths', async () => {
    const root = fixture.root;
    await putFile(root, 'src/fs/a.ts', 'a');
    await putFile(root, 'src/fs/a.ts.bak', 'bak');
    await putFile(root, 'src/fs/b.ts', 'b');
    await ensureDir(root, 'src/fs/a.ts.dir');
    const authority = makeAuthority(
      root,
      ['src/fs/**'],
      [{ path: 'src/fs/a.ts', operation: 'update' }],
    );
    const sessions = registry();
    sessions.bind('s1', 'attempt-1', authority);
    const runtime = createSliceFsRuntime(sessions);

    for (const bad of ['src/fs/b.ts', 'src/fs/a.ts.bak', 'src/fs/a.ts.dir/child.ts']) {
      await expectFsError(
        runtime.write('s1', { path: bad, content: 'mutated' }),
        FS_ERROR_CODES.SLICE_WRITE_SCOPE_VIOLATION,
      );
    }

    expect(await readFile(join(root, 'src/fs/a.ts'), 'utf8')).toBe('a');
    expect(await readFile(join(root, 'src/fs/a.ts.bak'), 'utf8')).toBe('bak');
    expect(await readFile(join(root, 'src/fs/b.ts'), 'utf8')).toBe('b');
  });

  it('create authority can create only the exact target when its parent already exists', async () => {
    const root = fixture.root;
    await ensureDir(root, 'src/fs');
    const authority = makeAuthority(
      root,
      [],
      [{ path: 'src/fs/new.ts', operation: 'create' }],
    );
    const sessions = registry();
    sessions.bind('s1', 'attempt-1', authority);
    const runtime = createSliceFsRuntime(sessions);

    const result = await runtime.write('s1', {
      path: 'src/fs/new.ts',
      content: 'created',
    });
    expect(result.created).toBe(true);
    expect(await readFile(join(root, 'src/fs/new.ts'), 'utf8')).toBe('created');
  });

  it('missing parent directories are never created and create/update operation mismatch is a scope violation', async () => {
    const root = fixture.root;
    await putFile(root, 'src/fs/existing.ts', 'existing');
    const authority = makeAuthority(
      root,
      [],
      [
        { path: 'src/fs/existing.ts', operation: 'create' },
        { path: 'src/fs/missing/new.ts', operation: 'update' },
      ],
    );
    const sessions = registry();
    sessions.bind('s1', 'attempt-1', authority);
    const runtime = createSliceFsRuntime(sessions);

    await expectFsError(
      runtime.write('s1', { path: 'src/fs/existing.ts', content: 'mutated' }),
      FS_ERROR_CODES.SLICE_WRITE_SCOPE_VIOLATION,
    );
    await expectFsError(
      runtime.write('s1', { path: 'src/fs/missing/new.ts', content: 'mutated' }),
      FS_ERROR_CODES.FILESYSTEM_OPERATION_FAILED,
    );

    expect(await readFile(join(root, 'src/fs/existing.ts'), 'utf8')).toBe('existing');
    expect(existsSync(join(root, 'src/fs/missing'))).toBe(false);
  });

  it('the first trusted violation is monotonic and later successful audited calls cannot clear it', async () => {
    const root = fixture.root;
    await putFile(root, 'src/fs/a.ts', 'before');
    await putFile(root, 'src/secret/secret.ts', 'secret');
    const authority = makeAuthority(
      root,
      ['src/fs/**'],
      [{ path: 'src/fs/a.ts', operation: 'update' }],
    );
    const sessions = registry();
    sessions.bind('s1', 'attempt-1', authority);
    const runtime = createSliceFsRuntime(sessions);

    await expectFsError(
      runtime.read('s1', { path: 'src/secret/secret.ts' }),
      FS_ERROR_CODES.SLICE_READ_SCOPE_VIOLATION,
    );
    await expect(
      runtime.read('s1', { path: 'src/fs/a.ts' }),
    ).resolves.toMatchObject({ content: 'before' });
    await runtime.write('s1', { path: 'src/fs/a.ts', content: 'after' });
    await expectFsError(
      runtime.write('s1', { path: 'src/fs/b.ts', content: 'nope' }),
      FS_ERROR_CODES.SLICE_WRITE_SCOPE_VIOLATION,
    );

    expect(sessions.getViolation('s1')?.code).toBe(
      FS_ERROR_CODES.SLICE_READ_SCOPE_VIOLATION,
    );
  });
});
