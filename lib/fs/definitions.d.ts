import type { ToolDefinition, ToolExecution } from '@deepseek-ai/dsh-tools';
import type { SliceFsToolName } from './toolNames.js';
import type { SliceFsRuntime } from './runtime.js';
/**
 * Trusted session-identity resolver for the DSH exposure seam.
 *
 * The model supplies only the tool schema fields. The session id used for
 * authorization comes from the DSH execution's live agent identity (agent.id
 * is the shared agent/session id), never from tool arguments.
 */
export type SliceFsSessionResolver = (execution: ToolExecution) => string | null | undefined;
export declare function resolveSliceFsSessionFromExecution(execution: ToolExecution): string | null;
/**
 * Registry-ready DSH definitions for slice_read/search/write/edit.
 *
 * C4A permits the exact four audited filesystem tools. The definitions are
 * complete, parameter-validated, and resolve authority strictly from the
 * trusted execution agent -> Supervisor-owned session binding. Production DSH
 * setup registers only the subset admitted by the authentic active Slice.
 */
export declare function createSliceFsToolDefinitions(runtime: SliceFsRuntime, resolveSessionId?: SliceFsSessionResolver): Readonly<Record<SliceFsToolName, ToolDefinition>>;
//# sourceMappingURL=definitions.d.ts.map