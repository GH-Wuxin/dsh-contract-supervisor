import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  FrozenSlice,
} from '../../src/domain/index.js';
import type { WriteAuthorityRule } from '../../src/domain/index.js';
import {
  admitSlice,
  createSupervisorRuntimeState,
} from '../../src/state/index.js';
import type { SupervisorRuntimeState } from '../../src/state/index.js';
import type { WorkerFsConfig } from '../../src/worker/index.js';
import { createSliceFsAuthority } from '../../src/fs/index.js';
import type { SliceFsAuthority } from '../../src/fs/index.js';

export interface FsFixture {
  readonly root: string;
  cleanup(): Promise<void>;
}

export async function createFsFixture(): Promise<FsFixture> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-s5-fs-'));
  return {
    root,
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}

export async function ensureDir(root: string, relativePath: string): Promise<string> {
  const absolute = join(root, relativePath);
  await mkdir(absolute, { recursive: true });
  return absolute;
}

export async function putFile(
  root: string,
  relativePath: string,
  content: string,
): Promise<string> {
  const absolute = join(root, relativePath);
  await mkdir(join(absolute, '..'), { recursive: true });
  await writeFile(absolute, content, 'utf8');
  return absolute;
}

export function makeAuthority(
  root: string,
  allowedReads: readonly string[],
  allowedWrites: SliceFsAuthority['allowedWrites'],
  sliceId = 'slice-s5',
): ReturnType<typeof createSliceFsAuthority> {
  return createSliceFsAuthority({
    repoRoot: root,
    sliceId,
    allowedReads,
    allowedWrites,
  });
}


const FROZEN_SLICE_CONTRACT_HASH = 'contract-s5-fs';

export function makeFrozenSlice(
  sliceId: string,
  allowedReads: readonly string[],
  allowedWrites: readonly WriteAuthorityRule[],
  workerToolAllowlist: readonly string[] = [],
): FrozenSlice {
  return FrozenSlice.create({
    sliceId,
    contractHash: FROZEN_SLICE_CONTRACT_HASH,
    parentCheckpointHash: 'bad647e492169cf1185f4334b92be61fa84b18b2',
    objective: 'S5 filesystem authority regression',
    postcondition: 'Audited filesystem behavior matches the frozen Slice',
    allowedReads: [...allowedReads],
    allowedWrites: allowedWrites.map((rule) => ({ ...rule })),
    frozenApiRefs: [],
    invariantRefs: [],
    prohibitionRefs: [],
    verifierRefs: [],
    regressionVerifierRefs: [],
    workerToolAllowlist: [...workerToolAllowlist],
    maxAttempts: 3,
    wallTimeout: 60_000,
    turnBudget: null,
  });
}

export function admitFrozenSlice(slice: FrozenSlice): SupervisorRuntimeState {
  return admitSlice(
    createSupervisorRuntimeState(),
    {
      contractHash: slice.contractHash,
      readAuthority: [...slice.allowedReads],
      writeAuthority: slice.allowedWrites.map((rule) => ({ ...rule })),
      verifierCatalog: [],
      workerToolAllowlist: [...slice.workerToolAllowlist],
    },
    {
      contractHash: slice.contractHash,
      sliceHash: slice.sliceHash,
      maxAttempts: slice.maxAttempts,
      allowedReads: [...slice.allowedReads],
      allowedWrites: slice.allowedWrites.map((rule) => ({ ...rule })),
      verifierRefs: [],
      regressionVerifierRefs: [],
      workerToolAllowlist: [...slice.workerToolAllowlist],
    },
  );
}

export function makeWorkerFsConfig(
  repoRoot: string,
  slices: readonly FrozenSlice[],
): WorkerFsConfig {
  return { repoRoot, slices: [...slices] };
}
