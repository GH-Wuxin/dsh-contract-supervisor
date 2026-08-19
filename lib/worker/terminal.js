import { foldConsumedWork } from '@deepseek-ai/dsh-agent';
function missingTerminal(sessionId) {
    return {
        outcome: 'FAILED',
        message: `Worker one-shot turn has no authoritative consumed-work terminal record in child session '${sessionId}'`,
        turn: null,
        reason: null,
    };
}
function terminalFailure(sessionId, turn, reason, detail) {
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
export function classifyDshOneShotTerminal(events, sessionId) {
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
            return terminalFailure(sessionId, turn, reason, ` (code: ${reason.error.code})`);
        case 'blocked':
            return terminalFailure(sessionId, turn, reason, '');
        case 'aborted':
            return terminalFailure(sessionId, turn, reason, ` (cause: ${reason.reason.kind})`);
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
//# sourceMappingURL=terminal.js.map