import type { AttemptOutcome, AttemptState } from './types.js';
export interface CreateAttemptInput {
    readonly attemptId: string;
    readonly attemptNo: number;
    readonly sliceHash: string;
}
export declare function assertAttemptState(attempt: AttemptState): void;
export declare function createAttemptState(input: CreateAttemptInput): AttemptState;
export declare function spawnAttempt(attempt: AttemptState): AttemptState;
export declare function failSpawnAttempt(attempt: AttemptState): AttemptState;
export declare function runAttempt(attempt: AttemptState): AttemptState;
export declare function settleAttempt(attempt: AttemptState, outcome: Exclude<AttemptOutcome, null>): AttemptState;
export declare function beginDisposeAttempt(attempt: AttemptState): AttemptState;
export declare function completeDisposeAttempt(attempt: AttemptState): AttemptState;
//# sourceMappingURL=attempt.d.ts.map