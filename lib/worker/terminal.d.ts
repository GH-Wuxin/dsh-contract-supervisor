import type { SessionEvent, TurnEndReason } from '@deepseek-ai/dsh-session';
import type { WorkerExecutionOutcome } from './types.js';
/**
 * Authoritative terminal classification for one in-process one-shot child
 * turn.
 *
 * This mirrors the stock rc.7 in-process one-shot driver
 * (`@deepseek-ai/dsh-subagent-in-process-driver`): after `whenIdle()` the
 * driver slices the child's own events from its activation boundary and folds
 * them with the public `foldConsumedWork` helper. The latest accounting
 * `turn/end.reason` is the ONLY normal terminal authority. `whenIdle()` alone,
 * model text, or absence of a thrown exception are deliberately insufficient.
 */
export interface DshTerminalClassification {
    readonly outcome: Extract<WorkerExecutionOutcome, 'SUCCESS' | 'FAILED'>;
    readonly message: string;
    /** Turn number of the authoritative consumed-work terminal, when one exists. */
    readonly turn: number | null;
    /** Exact installed DSH `turn/end` reason, when one exists. */
    readonly reason: TurnEndReason | null;
}
/**
 * Classify the authoritative terminal outcome of a current child's one-shot
 * run from its own durable session events.
 *
 * Only `turn/end.reason.kind === 'completed'` is normal success. Every exact
 * installed non-success terminal reason (`error`, `blocked`, `aborted`,
 * `interrupted`, `max-tokens`) fails closed, as do missing and unknown
 * terminal accounting.
 */
export declare function classifyDshOneShotTerminal(events: readonly SessionEvent[], sessionId: string): DshTerminalClassification;
//# sourceMappingURL=terminal.d.ts.map