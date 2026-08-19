import type { SessionEvent } from '@deepseek-ai/dsh-session';
import type { FrozenContract, FrozenSlice } from '../domain/index.js';
export interface CommanderTerminal {
    readonly turn: number | null;
    readonly reasonKind: string | null;
    readonly completed: boolean;
}
/**
 * Classify the authoritative terminal of a fresh one-turn commander session
 * from its own durable session events (sliced from the activation boundary so
 * no seed history is mistaken for current-commander work).
 */
export declare function classifyCommanderTerminal(events: readonly SessionEvent[]): CommanderTerminal;
/**
 * Extract and validate the commander instruction from a fresh one-turn
 * commander session.
 *
 * Sequence (Section 7-8):
 *   1. completed authoritative terminal required (else COMMANDER_TERMINAL_NOT_COMPLETED)
 *   2. final assistant/message for THAT completed turn required (else COMMANDER_OUTPUT_MISSING)
 *   3. at least one text block required (else COMMANDER_OUTPUT_EMPTY)
 *   4. concatenate text blocks in order
 *   5. trim outer whitespace
 *   6. non-empty (else COMMANDER_OUTPUT_EMPTY)
 *   7. UTF-8 byteLength <= 16384 (else COMMANDER_OUTPUT_OVERSIZED)
 *
 * Does NOT use partial stream deltas, console output, arbitrary last strings,
 * previous-turn text, tool-call arguments, or incomplete turn content.
 */
export declare function extractCommanderInstruction(events: readonly SessionEvent[], sessionId: string): {
    instruction: string;
    bytes: number;
    turn: number;
};
/**
 * Build the commander prompt DETERMINISTICALLY from authentic frozen facts.
 *
 * The prompt carries trusted frozen context (objective, postcondition,
 * allowedReads, allowedWrites, effective worker tool names, relevant frozen
 * invariant/prohibition references) and explicit authority immutability
 * statements. It asks for WORKER INSTRUCTION ONLY and never asks the commander
 * to output identity, authority, FS, or model-configuration fields.
 *
 * Output is deterministic for the same frozen inputs.
 */
export declare function buildCommanderPrompt(contract: FrozenContract, slice: FrozenSlice, effectiveWorkerToolNames: readonly string[]): string;
/**
 * Build the Flash worker prompt with an explicit two-level trust boundary.
 *
 *   [TRUSTED FROZEN SLICE]        — immutable, authoritative
 *   [COMMANDER GUIDANCE — ADVISORY] — validated Pro instruction, non-authoritative
 *   [AUTHORITY NOTICE]            — commander guidance cannot expand/replace authority
 *
 * Output is deterministic for the same frozen Slice + commander instruction.
 */
export declare function buildFlashPrompt(slice: FrozenSlice, commanderInstruction: string): string;
//# sourceMappingURL=commander.d.ts.map