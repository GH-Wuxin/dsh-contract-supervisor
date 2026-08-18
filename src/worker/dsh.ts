import { randomUUID } from 'node:crypto';
import {
  type Agent,
  type AgentHandle,
  type CreateAgentOptions,
} from '@deepseek-ai/dsh-agent';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import type { ContentBlock } from '@deepseek-ai/dsh-llm';
import { SessionId } from '@deepseek-ai/dsh-session';
import { resolveChildDepth } from '@deepseek-ai/dsh-subagent';
import type {
  ToolGuard,
  ToolPresentationMode,
  ToolRestriction,
} from '@deepseek-ai/dsh-tools';
import { assertValidWorkerConfig, freezeWorkerConfig } from './config.js';
import { WorkerError, WORKER_ERROR_CODES } from './errors.js';
import {
  classifyDshOneShotTerminal,
  type DshTerminalClassification,
} from './terminal.js';
import type {
  FrozenWorkerConfig,
  WorkerPort,
  WorkerResult,
  WorkerRun,
  WorkerSpawnRequest,
} from './types.js';

/**
 * The narrow production DSH tool-runtime seam used by child setup.
 *
 * It is the actual public rc.7 `ctx.tools` shape consumed by the adapter.
 * Tests may use a faithful stub or the installed ToolRuntime itself; the
 * adapter never invents a supervisor-only security interface.
 */
export interface DshToolRuntime {
  presentAs(mode: ToolPresentationMode): () => void;
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

function assertConfigMatches(
  expected: FrozenWorkerConfig,
  actual: FrozenWorkerConfig,
): void {
  const same =
    actual.role === expected.role &&
    actual.provider === expected.provider &&
    actual.model === expected.model &&
    actual.presentation === expected.presentation &&
    actual.oneShot === expected.oneShot &&
    actual.maxDepth === expected.maxDepth &&
    actual.toolAllowlist.length === expected.toolAllowlist.length &&
    expected.toolAllowlist.every((tool) => actual.toolAllowlist.includes(tool));

  if (!same) {
    throw new WorkerError(
      WORKER_ERROR_CODES.WORKER_CONFIGURATION_INVALID,
      'Caller attempted to override the frozen worker configuration',
    );
  }
}

function promptBlocks(prompt: string): ContentBlock[] {
  return [{ type: 'text', text: prompt }];
}

function invalidatedResult(violation: WorkerError): WorkerResult {
  return {
    outcome: 'INVALIDATED',
    message: violation.message,
    error: violation,
  };
}

function failedResult(message: string, cause?: unknown): WorkerResult {
  const error = new WorkerError(
    WORKER_ERROR_CODES.WORKER_EXECUTION_FAILED,
    message,
  );
  if (cause !== undefined) {
    (error as Error & { cause?: unknown }).cause = cause;
  }
  return {
    outcome: 'FAILED',
    message,
    error,
  };
}

function terminalWorkerResult(
  terminal: DshTerminalClassification,
): WorkerResult {
  if (terminal.outcome === 'SUCCESS') {
    return {
      outcome: 'SUCCESS',
      message: terminal.message,
    };
  }
  return failedResult(terminal.message);
}

export function createDshWorkerPort(
  context: DshWorkerContext,
  config: FrozenWorkerConfig,
): WorkerPort {
  assertValidWorkerConfig(config);
  const frozenConfig = freezeWorkerConfig(config);
  const parent = context.agent;

  return {
    async spawn(request: WorkerSpawnRequest): Promise<WorkerRun> {
      assertConfigMatches(frozenConfig, request.config);

      // Each spawn gets a fresh violation marker. It is deliberately not shared
      // between attempts or runs.
      const authorityViolation: { current: WorkerError | null } = { current: null };
      const allowlist = new Set(frozenConfig.toolAllowlist);

      // The stock DSH depth resolver enforces the exact one-child-level policy
      // before a child is constructed.
      const childDepth = resolveChildDepth(parent, frozenConfig.maxDepth);

      const signal = new AbortController().signal;

      const setup: CreateAgentOptions['setup'] = (childCtx) => {
        // Presentation and tool policy are installed on the child's scoped
        // context during the unpublished creation window, before any prompt is
        // delivered to that child.
        childCtx.tools.presentAs('native');
        childCtx.tools.restrict({ allow: [] });
        childCtx.tools.guard((execution) => {
          if (!allowlist.has(execution.name)) {
            authorityViolation.current = new WorkerError(
              WORKER_ERROR_CODES.UNAUTHORIZED_TOOL,
              `Tool '${execution.name}' is not in the worker tool allowlist`,
            );
            return `Worker tool '${execution.name}' is not allowed`;
          }
          return undefined;
        });
      };

      // Exact live runtime ownership: the child registry comes from the parent
      // Agent's own scoped context. There is no separately injectable
      // `context.agents` authority root.
      const handle: AgentHandle = await parent.ctx.agents.create({
        sessionId: SessionId(randomUUID()),
        meta: {
          parentSession: parent.session.id,
          origin: 'subagent',
          delegationDepth: childDepth,
        },
        agentOptions: {
          provider: frozenConfig.provider,
          model: frozenConfig.model,
          subagentDepth: childDepth,
        },
        signal,
        setup,
      });

      const child = handle.agent;
      let disposeCount = 0;

      const result = (async (): Promise<WorkerResult> => {
        let executionError: unknown;
        let terminal: DshTerminalClassification | null = null;

        try {
          // Exactly one followup per WorkerRun; the child is already fresh and
          // fully configured by the creation setup above.
          child.followup(
            createUserMessage({
              content: promptBlocks(request.prompt),
              source: { kind: 'user' },
            }),
          );
          await child.whenIdle();

          // `whenIdle()` is only the quiescence boundary. The authoritative
          // terminal outcome comes from THIS child's durable session record,
          // sliced from its activation boundary so no seed/parent history can
          // be mistaken for current-child work.
          const activationBoundary = child.session.header.seedLength ?? 0;
          terminal = classifyDshOneShotTerminal(
            child.session.events.slice(activationBoundary),
            child.session.id,
          );
        } catch (error) {
          executionError = error;
        }

        // Trusted per-run guard violation has the highest priority, above both
        // raw transport results and authoritative terminal accounting.
        if (authorityViolation.current !== null) {
          return invalidatedResult(authorityViolation.current);
        }

        if (executionError !== undefined) {
          const message = `Worker execution failed: ${
            executionError instanceof Error
              ? executionError.message
              : String(executionError)
          }`;
          return failedResult(message, executionError);
        }

        if (terminal === null) {
          // Classification itself can only return a value; this is a
          // fail-closed backstop for an impossible internal path.
          return failedResult(
            `Worker one-shot terminal classification failed for child session '${child.session.id}'`,
          );
        }

        return terminalWorkerResult(terminal);
      })();

      return {
        workerId: child.id,
        sessionId: child.session.id,
        result,
        async dispose() {
          if (disposeCount > 0) {
            return;
          }
          disposeCount += 1;
          await handle.dispose();
        },
      };
    },
  };
}
