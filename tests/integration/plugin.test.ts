import { describe, expect, it } from 'vitest';
import { readFile, mkdir, mkdtemp, rm, symlink } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Context } from '@deepseek-ai/cordis';
import type { TurnEndReason } from '@deepseek-ai/dsh-session';
import {
  composeEntries,
  initProfile,
  loadProfile,
} from '@deepseek-ai/dsh-app-boot';
import plugin from '../../src/integration/plugin.js';
import { createFakeDshHarness } from '../worker/dsh-test-helpers.js';
import { createTestConfig } from '../worker/helpers.js';
import {
  admitFrozenSlice,
  createFsFixture,
  makeFrozenSlice,
  makeWorkerFsConfig,
  putFile,
} from '../fs/helpers.js';

const COMPLETED_TERMINAL: TurnEndReason = { kind: 'completed' };

/**
 * The S5.2 plugin declares `inject: ['agents']`: its activation is gated on
 * the sibling `agents` provider, exactly as in the real DSH loader tree.
 * Unit fixtures therefore represent that legitimate runtime dependency by
 * providing an `agents` service on the shared context before loading the
 * plugin. The fixtures that only exercise the service seam never call it.
 */
function provideStubAgents(ctx: Context): unknown {
  const stubAgents = {
    create: async () => {
      throw new Error('stub agents: unit fixture does not create agents');
    },
  };
  ctx.provide('agents', stubAgents);
  return stubAgents;
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (predicate()) {
      return;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('Timed out waiting for S5 session binding');
}

describe('S5.1 DSH plugin integration adapter', () => {
  it('INT-01 package exposes a valid loadable Cordis plugin entrypoint', async () => {
    const ctx = new Context();
    provideStubAgents(ctx);
    const fiber = await ctx.plugin(plugin, {});

    const service = ctx.get('contractSupervisor');
    expect(service).toBeDefined();
    expect(service.name).toBe('contractSupervisor');
    expect(typeof service.createDshWorkerPort).toBe('function');
    expect(typeof service.createWorkerLifecycleCoordinator).toBe('function');
    expect(typeof service.createSliceFsSessionRegistry).toBe('function');
    expect(typeof service.createSupervisorRuntimeState).toBe('function');

    await fiber.dispose();
    expect(ctx.get('contractSupervisor')).toBeUndefined();
  });

  it('INT-02 bundle patch resolves the plugin', () => {
    const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
    const pkg = JSON.parse(
      readFileSync(join(repoRoot, 'package.json'), 'utf8') as string,
    ) as {
      dsh?: { bundle?: { patch?: unknown } };
      main?: unknown;
      exports?: unknown;
    };

    expect(pkg.dsh?.bundle?.patch).toBe('./cordis.patch.yml');
    expect(pkg.main).toBe('./lib/integration/plugin.js');

    const patch = readFileSync(join(repoRoot, 'cordis.patch.yml'), 'utf8');
    expect(patch).toContain('id: contract-supervisor');
    expect(patch).toContain('name: dsh-contract-supervisor');
    expect(patch).toContain('config: {}');
    expect(existsSync(join(repoRoot, 'lib/integration/plugin.js'))).toBe(true);
  });

  it('INT-03 plugin activation does not spawn a worker', async () => {
    const ctx = new Context();
    const stubAgents = provideStubAgents(ctx);
    const fiber = await ctx.plugin(plugin, {});

    const service = ctx.get('contractSupervisor');
    expect(service).toBeDefined();
    // The plugin only provides the service seam. It must not create any Agent,
    // Slice, filesystem session, or worker by itself; the `agents` value on
    // the context is still exactly the fixture-provided dependency, not
    // something the plugin installed.
    expect(ctx.get('agents')).toBe(stubAgents);
    expect(service.createDshWorkerPort).toBeTypeOf('function');

    await fiber.dispose();
  });

  it('INT-04 real isolated DSH profile machinery discovers the bundle and applies the patch', async () => {
    const home = await mkdtemp(join(tmpdir(), 'dsh-s51-profile-'));
    const profileDir = join(home, 'profiles', 'smoke');
    const repoRoot = fileURLToPath(new URL('../../', import.meta.url));

    try {
      await mkdir(join(profileDir, 'node_modules'), { recursive: true });
      initProfile(profileDir, ['dsh-contract-supervisor']);
      await symlink(
        repoRoot,
        join(profileDir, 'node_modules', 'dsh-contract-supervisor'),
        process.platform === 'win32' ? 'junction' : 'dir',
      );

      const dshAnchor = join(
        repoRoot,
        'node_modules',
        '@deepseek-ai',
        'dsh',
        'package.json',
      );
      const profile = loadProfile('dsh', 'smoke', dshAnchor, home);
      const rows = composeEntries(profile.layers.map((layer) => layer.patches));

      expect(profile.layers).toHaveLength(1);
      expect(profile.layers[0].packageName).toBe('dsh-contract-supervisor');
      expect(rows).toContainEqual(
        expect.objectContaining({
          id: 'contract-supervisor',
          name: 'dsh-contract-supervisor',
        }),
      );
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  it('INT-05 real loaded integration performs authorized read/write', async () => {
    const fixture = await createFsFixture();
    try {
      await putFile(fixture.root, 'allowed/input.txt', 'before');
      const slice = makeFrozenSlice(
        'slice-smoke',
        ['allowed/**'],
        [{ path: 'allowed/output.txt', operation: 'create' }],
        ['slice_read', 'slice_write'],
      );
      const runtime = admitFrozenSlice(slice);
      const config = createTestConfig(['slice_read', 'slice_write']);

      const ctx = new Context();
      provideStubAgents(ctx);
      const fiber = await ctx.plugin(plugin, {});
      const service = ctx.get('contractSupervisor');
      const harness = createFakeDshHarness();
      const port = service.createDshWorkerPort(harness.context, config);
      const sessions = service.createSliceFsSessionRegistry();
      const coordinator = service.createWorkerLifecycleCoordinator(
        port,
        config,
        sessions,
        makeWorkerFsConfig(fixture.root, [slice]),
      );

      const resultPromise = coordinator.runAttempt({
        runtime,
        attemptId: 'a1',
        prompt: 'p1',
      });
      await waitFor(() => sessions.liveSessionCount === 1);

      const child = harness.children[0];
      expect(harness.childVisibleToolNames(0)).toEqual(
        expect.arrayContaining(['slice_read', 'slice_write']),
      );
      expect(harness.parentVisibleToolNames()).not.toContain('slice_read');
      expect(harness.parentVisibleToolNames()).not.toContain('slice_write');

      const readOutcome = await harness.executeChildTool(0, 'slice_read', {
        path: 'allowed/input.txt',
      });
      expect(readOutcome.isError).toBe(false);
      if (!readOutcome.isError) {
        expect(readOutcome.value).toMatchObject({
          path: 'allowed/input.txt',
          content: 'before',
        });
      }

      const writeOutcome = await harness.executeChildTool(0, 'slice_write', {
        path: 'allowed/output.txt',
        content: 'created-by-supervisor-smoke',
      });
      expect(writeOutcome.isError).toBe(false);
      expect(
        await readFile(join(fixture.root, 'allowed/output.txt'), 'utf8'),
      ).toBe('created-by-supervisor-smoke');

      harness.resolveChild(0, COMPLETED_TERMINAL);
      const result = await resultPromise;

      expect(result.settled).toBe(true);
      expect(result.outcome).toBe('SUCCESS');
      expect(sessions.liveSessionCount).toBe(0);
      expect(sessions.getBinding(child.session.id)).toBeNull();

      await fiber.dispose();
    } finally {
      await fixture.cleanup();
    }
  });

  it('INT-06 real loaded integration rejects unauthorized write and cleans session', async () => {
    const fixture = await createFsFixture();
    try {
      await putFile(fixture.root, 'allowed/input.txt', 'before');
      await putFile(fixture.root, 'forbidden/secret.txt', 'do-not-touch');
      const slice = makeFrozenSlice(
        'slice-smoke-blocked',
        ['allowed/**'],
        [{ path: 'allowed/output.txt', operation: 'create' }],
        ['slice_read', 'slice_write'],
      );
      const runtime = admitFrozenSlice(slice);
      const config = createTestConfig(['slice_read', 'slice_write']);

      const ctx = new Context();
      provideStubAgents(ctx);
      const fiber = await ctx.plugin(plugin, {});
      const service = ctx.get('contractSupervisor');
      const harness = createFakeDshHarness();
      const port = service.createDshWorkerPort(harness.context, config);
      const sessions = service.createSliceFsSessionRegistry();
      const coordinator = service.createWorkerLifecycleCoordinator(
        port,
        config,
        sessions,
        makeWorkerFsConfig(fixture.root, [slice]),
      );

      const resultPromise = coordinator.runAttempt({
        runtime,
        attemptId: 'a1',
        prompt: 'p1',
      });
      await waitFor(() => sessions.liveSessionCount === 1);
      const child = harness.children[0];

      const badWrite = await harness.executeChildTool(0, 'slice_write', {
        path: 'forbidden/secret.txt',
        content: 'mutated',
      });
      expect(badWrite.isError).toBe(true);
      expect(
        await readFile(join(fixture.root, 'forbidden/secret.txt'), 'utf8'),
      ).toBe('do-not-touch');
      expect(sessions.getViolation(child.session.id)?.code).toBe(
        'SLICE_WRITE_SCOPE_VIOLATION',
      );

      harness.resolveChild(0, COMPLETED_TERMINAL);
      const result = await resultPromise;

      expect(result.settled).toBe(true);
      expect(result.outcome).toBe('INVALIDATED');
      expect(result.error?.code).toBe('SLICE_WRITE_SCOPE_VIOLATION');
      expect(result.runtime.activeSlice?.phase).toBe('SCOPE_BLOCKED');
      expect(sessions.liveSessionCount).toBe(0);
      expect(sessions.getBinding(child.session.id)).toBeNull();

      await fiber.dispose();
    } finally {
      await fixture.cleanup();
    }
  });

  it('INT-07 second worker gets a fresh session and no prior authority leakage', async () => {
    const fixture = await createFsFixture();
    try {
      await putFile(fixture.root, 'allowed/input.txt', 'before');
      const sliceA = makeFrozenSlice(
        'slice-smoke-a',
        ['allowed/**'],
        [{ path: 'allowed/output.txt', operation: 'create' }],
        ['slice_read', 'slice_write'],
      );
      const sliceB = makeFrozenSlice(
        'slice-smoke-b',
        ['allowed/**'],
        [{ path: 'allowed/output-b.txt', operation: 'create' }],
        ['slice_read', 'slice_write'],
      );
      const config = createTestConfig(['slice_read', 'slice_write']);

      const ctx = new Context();
      provideStubAgents(ctx);
      const fiber = await ctx.plugin(plugin, {});
      const service = ctx.get('contractSupervisor');
      const harness = createFakeDshHarness();
      const port = service.createDshWorkerPort(harness.context, config);
      const sessions = service.createSliceFsSessionRegistry();
      const coordinator = service.createWorkerLifecycleCoordinator(
        port,
        config,
        sessions,
        makeWorkerFsConfig(fixture.root, [sliceA, sliceB]),
      );

      const firstRuntime = admitFrozenSlice(sliceA);
      const firstPromise = coordinator.runAttempt({
        runtime: firstRuntime,
        attemptId: 'a1',
        prompt: 'p1',
      });
      await waitFor(() => sessions.liveSessionCount === 1);
      const firstChild = harness.children[0];

      const firstRead = await harness.executeChildTool(0, 'slice_read', {
        path: 'allowed/input.txt',
      });
      expect(firstRead.isError).toBe(false);
      harness.resolveChild(0, COMPLETED_TERMINAL);
      const firstResult = await firstPromise;
      expect(firstResult.settled).toBe(true);
      expect(firstResult.outcome).toBe('SUCCESS');
      expect(sessions.liveSessionCount).toBe(0);
      expect(sessions.getBinding(firstChild.session.id)).toBeNull();

      const secondRuntime = admitFrozenSlice(sliceB);
      const secondPromise = coordinator.runAttempt({
        runtime: secondRuntime,
        attemptId: 'b1',
        prompt: 'p2',
      });
      await waitFor(() => sessions.liveSessionCount === 1);
      const secondChild = harness.children[1];

      expect(secondChild.session.id).not.toBe(firstChild.session.id);
      expect(sessions.getBinding(secondChild.session.id)?.attemptId).toBe('b1');
      expect(sessions.getBinding(firstChild.session.id)).toBeNull();
      expect(harness.childVisibleToolNames(1)).toEqual(
        expect.arrayContaining(['slice_read', 'slice_write']),
      );

      const secondRead = await harness.executeChildTool(1, 'slice_read', {
        path: 'allowed/input.txt',
      });
      expect(secondRead.isError).toBe(false);
      if (!secondRead.isError) {
        expect(secondRead.value).toMatchObject({ content: 'before' });
      }

      harness.resolveChild(1, COMPLETED_TERMINAL);
      const secondResult = await secondPromise;
      expect(secondResult.settled).toBe(true);
      expect(secondResult.outcome).toBe('SUCCESS');
      expect(sessions.liveSessionCount).toBe(0);
      expect(sessions.getBinding(secondChild.session.id)).toBeNull();

      await fiber.dispose();
    } finally {
      await fixture.cleanup();
    }
  });
});
