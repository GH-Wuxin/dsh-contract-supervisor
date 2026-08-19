import type { AgentHandle, CreateAgentOptions } from '@deepseek-ai/dsh-agent';
import type { ContractSupervisorService } from '../integration/plugin.js';
/**
 * Minimal structural view of the cmdline-providing context. The launcher
 * supplies `cmdlineArgs` and `appExit` via provideCmdline() in its prepare
 * hook, before the tree mounts. This interface also satisfies the driver's
 * {@link DriverContext} structurally (it carries the contractSupervisor
 * service and the genuine AgentRegistry), so it can be passed straight to the
 * driver.
 */
export interface CmdlineContext {
    get(name: 'contractSupervisor'): ContractSupervisorService;
    get(name: 'cmdlineArgs'): {
        get(): readonly string[];
    } | undefined;
    get(name: 'appExit'): ((code: number) => void) | undefined;
    readonly agents: {
        create(options: CreateAgentOptions): Promise<AgentHandle>;
    };
}
/**
 * Inspect the booted context for a `contract-supervisor-run` invocation and, if
 * present, parse it through the genuine cmdline mechanism and run the driver.
 *
 * Returns true iff the cmdline was intended for this seam (the launcher
 * provided cmdlineArgs AND the first internal arg names our subcommand). In
 * that case parseCmdline has already dispatched the action; the caller should
 * not treat the boot as an ordinary long-lived surface.
 *
 * Returns false when cmdlineArgs is absent (no-arg boot / smoke) or the first
 * internal arg is not our subcommand; the plugin then simply provides its
 * service unchanged.
 */
export declare function maybeRunContractSupervisorCmdline(ctx: CmdlineContext): boolean;
//# sourceMappingURL=cmdline.d.ts.map