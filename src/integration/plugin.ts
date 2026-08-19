// Minimal DSH/Cordis integration adapter for the sealed C5 Supervisor.
//
// This module compiles to plain ESM under lib/ so the real DSH profile loader
// can import it directly with Node. It does not import Cordis at runtime; it
// only uses the `ctx` object Cordis passes to plugins, so the installed Cordis
// version is a peer/dev concern rather than a runtime dependency of this
// package.
//
// The plugin establishes one service seam (`contractSupervisor`) and delegates
// every operation to the existing C5 public APIs. It creates no Supervisor
// runtime, Slice, worker, filesystem session, or tool-policy source merely by
// loading.
import {
  createWorkerLifecycleCoordinator,
  createDshWorkerPort,
} from '../worker/index.js';
import type {
  DshWorkerContext,
  FrozenWorkerConfig,
  WorkerFsConfig,
  WorkerLifecycleCoordinator,
  WorkerPort,
} from '../worker/index.js';
import {
  createSupervisorRuntimeState,
  admitSlice,
} from '../state/index.js';
import type {
  AdmissibleContract,
  AdmissibleSlice,
  SupervisorRuntimeState,
} from '../state/index.js';
import { createSliceFsSessionRegistry } from '../fs/index.js';
import type { SliceFsSessionRegistry } from '../fs/index.js';
import { FrozenContract, FrozenSlice } from '../domain/index.js';
import type { ContractInput, SliceInput } from '../domain/index.js';

export interface ContractSupervisorService {
  readonly name: 'contractSupervisor';
  createSupervisorRuntimeState(): SupervisorRuntimeState;
  admitSlice(
    runtime: SupervisorRuntimeState,
    contract: AdmissibleContract,
    slice: AdmissibleSlice,
  ): SupervisorRuntimeState;
  createFrozenContract(input: ContractInput): FrozenContract;
  createFrozenSlice(input: SliceInput): FrozenSlice;
  createDshWorkerPort(
    context: DshWorkerContext,
    config: FrozenWorkerConfig,
  ): WorkerPort;
  createWorkerLifecycleCoordinator(
    port: WorkerPort,
    config: FrozenWorkerConfig,
    sliceFsSessions?: SliceFsSessionRegistry,
    workerFsConfig?: WorkerFsConfig,
  ): WorkerLifecycleCoordinator;
  createSliceFsSessionRegistry(): SliceFsSessionRegistry;
}

export const name = 'contract-supervisor';
export const inject: readonly string[] = [];
export const Config = undefined;

export function apply(ctx: any, _config?: {}): () => void {
  if (typeof ctx?.provide !== 'function') {
    throw new TypeError(
      'dsh-contract-supervisor: expected a Cordis context with ctx.provide()',
    );
  }

  const service: ContractSupervisorService = Object.freeze({
    name: 'contractSupervisor',

    // State/domain construction helpers. Callers can use these later to supply
    // authentic Contract/Slice/Attempt inputs through the existing C5 APIs.
    createSupervisorRuntimeState,
    admitSlice,
    createFrozenContract: (input: ContractInput) => FrozenContract.create(input),
    createFrozenSlice: (input: SliceInput) => FrozenSlice.create(input),

    // Existing C5 worker/fs seams. These are factories only; no worker is
    // spawned by this plugin activation.
    createDshWorkerPort,
    createWorkerLifecycleCoordinator,
    createSliceFsSessionRegistry,
  });

  return ctx.provide('contractSupervisor', service);
}

const plugin = Object.freeze({
  name,
  inject,
  Config,
  apply,
});

export default plugin;
