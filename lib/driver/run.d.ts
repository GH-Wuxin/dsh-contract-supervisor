import type { AgentHandle, CreateAgentOptions } from '@deepseek-ai/dsh-agent';
import type { ContractSupervisorService } from '../integration/plugin.js';
import { type DriverResult } from './types.js';
/**
 * Minimal structural view of a booted DSH context the driver consumes. The
 * caller (CLI seam or test) supplies the genuine booted context; the driver
 * only reaches the existing contractSupervisor service and the genuine
 * AgentRegistry. It never invents a parallel context.
 */
export interface DriverContext {
    get(name: 'contractSupervisor'): ContractSupervisorService;
    readonly agents: {
        create(options: CreateAgentOptions): Promise<AgentHandle>;
    };
}
/**
 * Optional host-side observability trace populated by the driver as it
 * progresses. Intended for developer/Tier-2 verification of the same-boot
 * commander/worker lifecycle; the driver never reads it. All fields are
 * optional and set only as the corresponding stage is reached.
 */
export interface DriverTrace {
    proId?: string;
    proSessionId?: string;
    proDisposed?: boolean;
    flashWorkerId?: string;
    flashSessionId?: string;
    sessionsLiveAfter?: number;
}
/**
 * Run the S5.2 Pro Commander Host Driver against a parsed RunSpec document.
 *
 * `ctx` is the genuine booted DSH context (same-boot). `rawRunSpec` is the
 * parsed JSON RunSpec v1 document. Returns a structured {@link DriverResult};
 * never throws driver-internal exceptions (they are captured into the result).
 */
export declare function runContractSupervisorDriver(ctx: DriverContext, rawRunSpec: unknown, trace?: DriverTrace): Promise<DriverResult>;
//# sourceMappingURL=run.d.ts.map