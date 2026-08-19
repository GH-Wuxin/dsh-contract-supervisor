import { type Agent } from '@deepseek-ai/dsh-agent';
import type { ToolDefinition, ToolGuard, ToolPresentationMode, ToolRestriction } from '@deepseek-ai/dsh-tools';
import { type FrozenWorkerConfig, type WorkerPort } from './types.js';
/**
 * The narrow production DSH tool-runtime seam used by child setup.
 *
 * It is the actual public rc.7 `ctx.tools` shape consumed by the adapter.
 * Tests may use a faithful stub or the installed ToolRuntime itself; the
 * adapter never invents a supervisor-only security interface.
 */
export interface DshToolRuntime {
    presentAs(mode: ToolPresentationMode): () => void;
    register(definition: ToolDefinition): () => void;
    restrict(filter: ToolRestriction): () => void;
    guard(guard: ToolGuard): () => void;
}
/**
 * Production authority root for worker child creation.
 *
 * The context carries exactly one live authority root: the parent Agent.
 * Child creation MUST go through `parent.ctx.agents`, so a caller cannot
 * structurally supply parent Agent A together with an unrelated registry B.
 * Lineage metadata (`parentSession`, `delegationDepth`) remains metadata and
 * does not replace the live ownership seam.
 */
export interface DshWorkerContext {
    readonly agent: Agent;
}
export declare function createDshWorkerPort(context: DshWorkerContext, config: FrozenWorkerConfig): WorkerPort;
//# sourceMappingURL=dsh.d.ts.map