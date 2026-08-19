import type { DshWorkerContext, FrozenWorkerConfig, WorkerFsConfig, WorkerLifecycleCoordinator, WorkerPort } from '../worker/index.js';
import type { AdmissibleContract, AdmissibleSlice, SupervisorRuntimeState } from '../state/index.js';
import type { SliceFsSessionRegistry } from '../fs/index.js';
import { FrozenContract, FrozenSlice } from '../domain/index.js';
import type { ContractInput, SliceInput } from '../domain/index.js';
export interface ContractSupervisorService {
    readonly name: 'contractSupervisor';
    createSupervisorRuntimeState(): SupervisorRuntimeState;
    admitSlice(runtime: SupervisorRuntimeState, contract: AdmissibleContract, slice: AdmissibleSlice): SupervisorRuntimeState;
    createFrozenContract(input: ContractInput): FrozenContract;
    createFrozenSlice(input: SliceInput): FrozenSlice;
    createDshWorkerPort(context: DshWorkerContext, config: FrozenWorkerConfig): WorkerPort;
    createWorkerLifecycleCoordinator(port: WorkerPort, config: FrozenWorkerConfig, sliceFsSessions?: SliceFsSessionRegistry, workerFsConfig?: WorkerFsConfig): WorkerLifecycleCoordinator;
    createSliceFsSessionRegistry(): SliceFsSessionRegistry;
}
export declare const name = "contract-supervisor";
export declare const inject: readonly string[];
export declare const Config: undefined;
export declare function apply(ctx: any, _config?: {}): () => void;
declare const plugin: Readonly<{
    name: "contract-supervisor";
    inject: readonly string[];
    Config: undefined;
    apply: typeof apply;
}>;
export default plugin;
//# sourceMappingURL=plugin.d.ts.map