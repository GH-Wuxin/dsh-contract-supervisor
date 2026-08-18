import { foldConsumedWork } from '@deepseek-ai/dsh-agent';
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

function missingTerminal(sessionId: string): DshTerminalClassification {
  return {
    outcome: 'FAILED',
    message: `Worker one-shot turn has no authoritative consumed-work terminal record in child session '${sessionId}'`,
    turn: null,
    reason: null,
  };
}

function terminalFailure(
  sessionId: string,
  turn: number,
  reason: TurnEndReason,
  detail: string,
): DshTerminalClassification {
  return {
    outcome: 'FAILED',
    message: `Worker one-shot turn ${turn} ended with authoritative terminal reason '${String(reason.kind)}' in child session '${sessionId}'${detail}`,
    turn,
    reason,
  };
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
export function classifyDshOneShotTerminal(
  events: readonly SessionEvent[],
  sessionId: string,
): DshTerminalClassification {
  const consumed = foldConsumedWork(events);
  const end = consumed.end;

  if (end === undefined) {
    return missingTerminal(sessionId);
  }

  const { turn, reason } = end.data;

  switch (reason.kind) {
    case 'completed':
      return {
        outcome: 'SUCCESS',
        message: `Worker one-shot turn ${turn} completed with authoritative terminal reason 'completed' in child session '${sessionId}'`,
        turn,
        reason,
      };
    case 'error':
      return terminalFailure(
        sessionId,
        turn,
        reason,
        ` (code: ${reason.error.code})`,
      );
    case 'blocked':
      return terminalFailure(sessionId, turn, reason, '');
    case 'aborted':
      return terminalFailure(
        sessionId,
        turn,
        reason,
        ` (cause: ${reason.reason.kind})`,
      );
    case 'interrupted':
      return terminalFailure(sessionId, turn, reason, '');
    case 'max-tokens':
      return terminalFailure(sessionId, turn, reason, '');
    /* v8 ignore next 3 -- merge-extensible TurnEndReasonMap: an unknown
     * installed/plugin terminal must never read as success. */
    default:
      return terminalFailure(sessionId, turn, reason, ' (unknown terminal kind)');
  }
}
