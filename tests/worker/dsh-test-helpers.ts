import { vi } from 'vitest';
import { Context } from '@deepseek-ai/cordis';
import type { CreateAgentOptions } from '@deepseek-ai/dsh-agent';
import { CallId } from '@deepseek-ai/dsh-llm';
import { createScope } from '@deepseek-ai/dsh-scope';
import {
  SESSION_FORMAT_VERSION,
  Session,
  SessionId,
} from '@deepseek-ai/dsh-session';
import type { TurnEndReason } from '@deepseek-ai/dsh-session';
import { SystemPrompt } from '@deepseek-ai/dsh-system-prompt';
import { ToolRuntime } from '@deepseek-ai/dsh-tools';
import type {
  ToolDefinition,
  ToolExecutionInput,
  ToolExecutionResult,
  ToolGuard,
  ToolPresentationMode,
  ToolRestriction,
} from '@deepseek-ai/dsh-tools';
import type { DshWorkerContext } from '../../src/worker/index.js';

export interface FakeDshToolRuntime {
  presentAs(mode: ToolPresentationMode): () => void;
  restrict(filter: ToolRestriction): () => void;
  guard(guard: ToolGuard): () => void;
  register(definition: ToolDefinition): () => void;
  execute(exec: ToolExecutionInput): Promise<ToolExecutionResult>;
}

export interface FakeDshChildAgent {
  readonly id: string;
  readonly options: Record<string, unknown>;
  readonly session: { readonly id: string };
}

export interface FakeDshChild {
  readonly id: string;
  /** The exact same object used as the actual rc.7 ToolRuntime scope key. */
  readonly agent: FakeDshChildAgent;
  readonly session: Session;
  readonly options: Record<string, unknown>;
  outputText: string;
  readonly followup: ReturnType<typeof vi.fn>;
  readonly ctx: {
    readonly agent: FakeDshChildAgent;
    readonly tools: FakeDshToolRuntime;
  };
  readonly whenIdle: () => Promise<void>;
}

export interface FakeDshParent {
  readonly id: string;
  readonly options: {
    readonly provider: string;
    readonly model: string;
  };
  readonly session: {
    readonly id: string;
    readonly header: { readonly delegationDepth: number };
  };
  readonly ctx: {
    readonly agents: { readonly create: ReturnType<typeof vi.fn> };
    readonly tools?: FakeDshToolRuntime;
  };
}

export interface FakeDshHarnessOptions {
  /** When set, every underlying AgentHandle.dispose rejects with this error. */
  readonly disposeError?: unknown;
}

export interface FakeDshHarness {
  readonly context: DshWorkerContext;
  readonly parent: FakeDshParent;
  readonly createdOptions: CreateAgentOptions[];
  readonly presentAsCalls: ToolPresentationMode[];
  readonly restrictCalls: ToolRestriction[];
  readonly guardCalls: ToolGuard[];
  readonly executionInputs: ToolExecutionInput[];
  readonly followupCalls: Array<{ childId: string; text: string }>;
  readonly disposeCounts: number[];
  readonly children: FakeDshChild[];
  readonly sequence: string[];
  /**
   * Resolve one child's `whenIdle()` boundary.
   *
   * @param index - child index.
   * @param terminal - exact installed rc.7 `turn/end` reason to append as the
   *   child's durable current-run terminal record. Omit/`undefined` appends
   *   the normal `completed` record; pass `null` to leave the session with NO
   *   terminal accounting.
   */
  resolveChild(index: number, terminal?: TurnEndReason | null): void;
  rejectChild(index: number, error?: unknown): void;
  setChildOutput(index: number, text: string): void;
  setChildTerminal(index: number, terminal: TurnEndReason): void;
    registerChildTool(index: number, definition: ToolDefinition): () => void;
  executeChildTool(
    index: number,
    name: string,
    args?: unknown,
  ): Promise<ToolExecutionResult>;
  /** Register a tool on the actual rc.7 root ToolRuntime global layer. */
  registerGlobalTool(definition: ToolDefinition): () => void;
  /** Actual rc.7 ToolRuntime visible names for the parent Agent scope. */
  parentVisibleToolNames(): string[];
  /** Actual rc.7 ToolRuntime visible names for one child Agent scope. */
  childVisibleToolNames(index: number): string[];
}

const COMPLETED: TurnEndReason = { kind: 'completed' };

function appendClosedTurn(
  session: Session,
  turn: number,
  reason?: TurnEndReason,
): void {
  session.append('turn/start', { turn });
  session.append('step/start', { turn, step: 1 });
  session.append('step/end', { turn, step: 1 });
  if (reason !== undefined) {
    session.append('turn/end', { turn, reason });
  }
}

export function createFakeDshHarness(
  harnessOptions: FakeDshHarnessOptions = {},
): FakeDshHarness {
  const createdOptions: CreateAgentOptions[] = [];
  const presentAsCalls: ToolPresentationMode[] = [];
  const restrictCalls: ToolRestriction[] = [];
  const guardCalls: ToolGuard[] = [];
  const executionInputs: ToolExecutionInput[] = [];
  const followupCalls: Array<{ childId: string; text: string }> = [];
  const disposeCounts: number[] = [];
  const children: FakeDshChild[] = [];
  const sequence: string[] = [];
  const whenIdleResolvers: Array<() => void> = [];
  const whenIdleRejecters: Array<(error?: unknown) => void> = [];

  // Minimal real Cordis world. ToolRuntime is the actual installed rc.7
  // public execution pipeline; each fake child is a real scoped Cordis
  // context, so production `childCtx.tools.*` calls and the guard-execution
  // proof run through the real registry guard/restrict pipeline.
  const root = new Context();
  new SystemPrompt(root, {});
  const toolRuntime = new ToolRuntime(root);

  const parent: FakeDshParent = {
    id: 'parent-1',
    options: { provider: 'deepseek-ai', model: 'Flash' },
    session: {
      id: 'parent-1',
      header: { delegationDepth: 0 },
    },
    ctx: {
      agents: {
        create: vi.fn(
          async (
            options: CreateAgentOptions,
          ): Promise<{
            agent: FakeDshChild;
            dispose(): Promise<void>;
          }> => {
            const index = children.length;
            sequence.push('agents.create');
            createdOptions.push(options);

            const sessionId = SessionId(`child-session-${index + 1}`);
            const session = Session.create(sessionId, [], {
              version: SESSION_FORMAT_VERSION,
              id: sessionId,
              createdAt: index + 1,
              delegationDepth:
                typeof options.meta?.delegationDepth === 'number'
                  ? options.meta.delegationDepth
                  : 1,
            });

            const childAgent: FakeDshChildAgent = {
              id: session.id,
              options: (options.agentOptions ?? {}) as Record<string, unknown>,
              session: { id: session.id },
            };

            // The exact scope key is the child agent object, matching
            // ReactLoopAgent's `createScope(loopCtx, this)` ownership seam.
            // rc.7 does NOT link the child Agent's tool scope to the parent
            // Agent's scoped registry: each Agent gets an independent scope
            // minted from the loop/root context.
            const scopedCtx = createScope(root, childAgent).ctx.extend({
              agent: childAgent,
            });
            const actualTools = scopedCtx.tools;

            const tools = {
              presentAs: vi.fn((mode: ToolPresentationMode) => {
                presentAsCalls.push(mode);
                sequence.push(`presentAs:${mode}`);
                return actualTools.presentAs(mode);
              }),
              restrict: vi.fn((filter: ToolRestriction) => {
                restrictCalls.push(filter);
                sequence.push(`restrict:${JSON.stringify(filter)}`);
                return actualTools.restrict(filter);
              }),
              guard: vi.fn((guard: ToolGuard) => {
                guardCalls.push(guard);
                sequence.push('guard');
                return actualTools.guard(guard);
              }),
              register: vi.fn((definition: ToolDefinition) => {
                sequence.push(`tools.register:${definition.name}`);
                return actualTools.register(definition);
              }),
              execute: vi.fn((exec: ToolExecutionInput) => {
                executionInputs.push(exec);
                sequence.push(`tools.execute:${exec.name}`);
                return actualTools.execute(exec);
              }),
            };

            // Production setup runs inside the unpublished creation window.
            const setupCtx = scopedCtx.extend({
              tools: tools as unknown as FakeDshToolRuntime,
            });

            let resolveWhenIdle!: () => void;
            let rejectWhenIdle!: (error?: unknown) => void;
            const whenIdle = new Promise<void>((resolve, reject) => {
              resolveWhenIdle = resolve;
              rejectWhenIdle = reject;
            });
            whenIdleResolvers.push(resolveWhenIdle);
            whenIdleRejecters.push(rejectWhenIdle);

            const child: FakeDshChild = {
              id: childAgent.id,
              agent: childAgent,
              session,
              options: (options.agentOptions ?? {}) as Record<string, unknown>,
              outputText: '',
              followup: vi.fn(
                (message: {
                  content?: Array<{ type?: string; text?: string }>;
                }) => {
                  const text =
                    message.content?.[0] && 'text' in message.content[0]
                      ? message.content[0].text ?? ''
                      : '';
                  followupCalls.push({ childId: child.id, text });
                  sequence.push(`followup:${child.id}`);
                },
              ),
              ctx: setupCtx as unknown as FakeDshChild['ctx'],
              whenIdle: () => whenIdle,
            };

            // Publish the fake child to test observers before awaiting any
            // asynchronous setup, mirroring the synchronous setup path used by
            // production while still supporting an async rc.7 AgentSetup.
            children.push(child);
            disposeCounts.push(0);

            const setupResult = options.setup?.(setupCtx as never);
            if (
              setupResult !== undefined &&
              typeof (setupResult as PromiseLike<unknown>).then === 'function'
            ) {
              await setupResult;
            } else if (
              setupResult !== undefined &&
              typeof setupResult === 'object'
            ) {
              (setupResult as { commit?(): void }).commit?.();
            }

            return {
              agent: child,
              dispose: vi.fn(async () => {
                disposeCounts[index] += 1;
                sequence.push(`dispose:${child.id}`);
                if (harnessOptions.disposeError !== undefined) {
                  throw harnessOptions.disposeError;
                }
              }),
            };
          },
        ),
      },
    },
  };

  // Real parent scope: the fake parent is also a live Cordis scope, but it is
  // deliberately NOT the parent of the child scope. This mirrors rc.7
  // AgentLoop, where each Agent's tool scope is independent.
  const parentScope = createScope(root, parent);
  const parentCtx = parentScope.ctx.extend({ agent: parent });
  const parentTools: FakeDshToolRuntime = {
    presentAs: vi.fn((mode: ToolPresentationMode) => {
      presentAsCalls.push(mode);
      sequence.push(`presentAs:${mode}`);
      return parentCtx.tools.presentAs(mode);
    }),
    register: vi.fn((definition: ToolDefinition) => {
      sequence.push(`tools.register:${definition.name}`);
      return parentCtx.tools.register(definition);
    }),
    restrict: vi.fn((filter: ToolRestriction) => {
      restrictCalls.push(filter);
      sequence.push(`restrict:${JSON.stringify(filter)}`);
      return parentCtx.tools.restrict(filter);
    }),
    guard: vi.fn((guard: ToolGuard) => {
      guardCalls.push(guard);
      sequence.push('guard');
      return parentCtx.tools.guard(guard);
    }),
    execute: vi.fn((exec: ToolExecutionInput) => {
      executionInputs.push(exec);
      sequence.push(`tools.execute:${exec.name}`);
      return parentCtx.tools.execute(exec);
    }),
  };
  (parent.ctx as { tools?: FakeDshToolRuntime }).tools = parentTools;

  const context: DshWorkerContext = {
    agent: parent as unknown as DshWorkerContext['agent'],
  };

  return {
    context,
    parent,
    createdOptions,
    presentAsCalls,
    restrictCalls,
    guardCalls,
    executionInputs,
    followupCalls,
    disposeCounts,
    children,
    sequence,
    resolveChild(index: number, terminal: TurnEndReason | null = COMPLETED) {
      if (terminal !== null) {
        appendClosedTurn(children[index].session, 1, terminal);
      }
      whenIdleResolvers[index]?.();
    },
    rejectChild(index: number, error?: unknown) {
      whenIdleRejecters[index]?.(error ?? new Error('fake child failure'));
    },
    setChildOutput(index: number, text: string) {
      if (children[index]) {
        children[index].outputText = text;
      }
    },
    setChildTerminal(index: number, terminal: TurnEndReason) {
      appendClosedTurn(children[index].session, 1, terminal);
    },
    registerChildTool(index: number, definition: ToolDefinition) {
      return children[index].ctx.tools.register(definition);
    },
    registerGlobalTool(definition: ToolDefinition) {
      // Installs on the actual rc.7 root ToolRuntime global layer, so the tool
      // is inherited by every child Agent scope (it is an inherited/global
      // tool, not a child-local one).
      return toolRuntime.register(definition);
    },
    executeChildTool(index: number, name: string, args: unknown = {}) {
      const child = children[index];
      const input: ToolExecutionInput = {
        callId: CallId(`fake-call-${index + 1}-${name}`),
        name,
        arguments: args,
        agent: child.agent as never,
        signal: new AbortController().signal,
      };
      return child.ctx.tools.execute(input);
    },
    parentVisibleToolNames() {
      return toolRuntime.schemas(parent).map((schema) => schema.name);
    },
    childVisibleToolNames(index: number) {
      return toolRuntime.schemas(children[index].agent).map((schema) => schema.name);
    },
  };
}
