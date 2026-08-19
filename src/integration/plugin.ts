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
import { maybeRunContractSupervisorCmdline } from '../cli/cmdline.js';

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
// The plugin runs in its OWN loader/plugin fiber, while AgentRegistry is
// provided by a SIBLING loader entry (dsh-base's `agent` row). `inject`
// makes `ctx.agents` visible in this plugin fiber (Cordis resolves injected
// services from the shared service store once the provider fiber is ACTIVE)
// and gates this fiber's activation until the provider is available.
export const inject: readonly string[] = ['agents'];
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

  const provideDisposer = ctx.provide('contractSupervisor', service);

  // S5.2 developer-only host cmdline seam. Inert when the launcher did not
  // provide cmdlineArgs (no-arg boot / profile load smoke) or the first
  // internal arg is not `contract-supervisor-run`. Uses the genuine rc.6
  // provideCmdline/parseCmdline mechanism; host-side, not model-visible; no
  // second Cordis loader/plugin row. When it does handle the cmdline, the
  // subcommand action runs the host driver and requests exit via appExit.
  maybeRunContractSupervisorCmdline(ctx as never);

  return provideDisposer;
}

const plugin = Object.freeze({
  name,
  inject,
  Config,
  apply,
});

export default plugin;
