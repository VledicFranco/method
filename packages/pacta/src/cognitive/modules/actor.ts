/**
 * Actor Module — selects and executes actions via the ToolProvider.
 *
 * The actor reads the workspace to understand the current context,
 * selects an appropriate tool from the ToolProvider, executes it,
 * and writes the result back to the workspace.
 *
 * Grounded in: ACT-R motor module, SOAR operator application,
 * GWT action selection through workspace broadcasting.
 */

import type {
  CognitiveModule,
  ModuleId,
  ActorMonitoring,
  ControlDirective,
  StepResult,
  StepError,
  WorkspaceWritePort,
  WorkspaceEntry,
  ReadonlyWorkspaceSnapshot,
} from '../algebra/index.js';
import { moduleId } from '../algebra/index.js';
import type { ToolProvider, ToolDefinition, ToolResult } from '../../ports/tool-provider.js';

// ── Types ────────────────────────────────────────────────────────

/** Input to the actor: workspace snapshot for context-aware action selection. */
export interface ActorInput {
  /** Workspace snapshot for determining what action to take. */
  snapshot: ReadonlyWorkspaceSnapshot;
}

/** Output of the actor: action execution result. */
export interface ActorOutput {
  /** Name of the action taken (tool name or 'escalate' or 'none'). */
  actionName: string;
  /** The tool result, if execution occurred. */
  result: ToolResult | null;
  /** Whether execution was escalated instead of performed. */
  escalated: boolean;
}

/** Actor internal state. */
export interface ActorState {
  /** Total actions executed. */
  actionCount: number;
  /** Name of the last action taken. */
  lastActionName: string | null;
  /** Running success rate (0-1). */
  successRate: number;
}

/** Control directive for the actor. */
export interface ActorControl extends ControlDirective {
  /** If set, only these tool names are allowed. Others are filtered out. */
  allowedActions?: string[];
  /** If true, skip execution and return an escalation output. */
  escalate?: boolean;
}

/** Configuration for the actor factory. */
export interface ActorConfig {
  /** Custom module ID. Defaults to 'actor'. */
  id?: string;
}

// ── Action Instruction Detection ────────────────────────────────

/** Shape of a structured action instruction written by the Reasoner. */
interface ActionInstructionEntry {
  type: 'action_instruction';
  tool: string;
  input: unknown;
  rationale: string;
}

function isActionInstruction(content: unknown): content is ActionInstructionEntry {
  return (
    typeof content === 'object' &&
    content !== null &&
    (content as Record<string, unknown>).type === 'action_instruction' &&
    typeof (content as Record<string, unknown>).tool === 'string'
  );
}

/**
 * Find the most recent action instruction from the Reasoner in the workspace.
 * Returns the instruction if found, undefined otherwise.
 */
function findActionInstruction(
  snapshot: ReadonlyWorkspaceSnapshot,
): ActionInstructionEntry | undefined {
  const sorted = [...snapshot].sort((a, b) => b.timestamp - a.timestamp);
  for (const entry of sorted) {
    if (isActionInstruction(entry.content)) {
      return entry.content;
    }
  }
  return undefined;
}

// ── Fallback Tool Selection (backward compat) ───────────────────

function selectToolFallback(
  tools: ToolDefinition[],
  snapshot: ReadonlyWorkspaceSnapshot,
): ToolDefinition | null {
  if (tools.length === 0) return null;

  const workspaceText = snapshot
    .map((e: WorkspaceEntry) => typeof e.content === 'string' ? e.content : JSON.stringify(e.content))
    .join(' ')
    .toLowerCase();

  let bestTool: ToolDefinition = tools[0];
  let bestScore = 0;

  for (const tool of tools) {
    let score = 0;
    const nameWords = tool.name.toLowerCase().split(/[_\-\s]+/);
    for (const word of nameWords) {
      if (word.length > 2 && workspaceText.includes(word)) score += 1;
    }
    if (tool.description) {
      const descWords = tool.description.toLowerCase().split(/\s+/);
      for (const word of descWords) {
        if (word.length > 3 && workspaceText.includes(word)) score += 0.5;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestTool = tool;
    }
  }

  return bestTool;
}

function buildFallbackInput(snapshot: ReadonlyWorkspaceSnapshot): unknown {
  if (snapshot.length === 0) return {};
  let best = snapshot[0];
  for (const entry of snapshot) {
    if (entry.salience > best.salience) best = entry;
  }
  return typeof best.content === 'string' ? { input: best.content } : best.content;
}

// ── Factory ──────────────────────────────────────────────────────

/**
 * Create an Actor cognitive module.
 *
 * @param tools - The ToolProvider for listing and executing tools.
 * @param writePort - Workspace write port for emitting action results.
 * @param config - Optional configuration.
 */
export function createActor(
  tools: ToolProvider,
  writePort: WorkspaceWritePort,
  config?: ActorConfig,
): CognitiveModule<ActorInput, ActorOutput, ActorState, ActorMonitoring, ActorControl> {
  const id = moduleId(config?.id ?? 'actor');

  return {
    id,

    initialState(): ActorState {
      return {
        actionCount: 0,
        lastActionName: null,
        successRate: 1,
      };
    },

    async step(
      input: ActorInput,
      state: ActorState,
      control: ActorControl,
    ): Promise<StepResult<ActorOutput, ActorState, ActorMonitoring>> {
      try {
        // Handle escalation
        if (control.escalate) {
          const monitoring: ActorMonitoring = {
            type: 'actor',
            source: id,
            timestamp: Date.now(),
            actionTaken: 'escalate',
            success: true,
            unexpectedResult: false,
          };

          return {
            output: { actionName: 'escalate', result: null, escalated: true },
            state,
            monitoring,
          };
        }

        // List and filter available tools
        let availableTools = tools.list();
        if (control.allowedActions) {
          availableTools = availableTools.filter(
            (t: ToolDefinition) => control.allowedActions!.includes(t.name),
          );
        }

        // Try to find a structured action instruction from the Reasoner
        const actionInstruction = findActionInstruction(input.snapshot);

        let toolName: string;
        let toolInput: unknown;

        if (actionInstruction) {
          // Structured path: Reasoner told us exactly what to do
          if (actionInstruction.tool === 'done') {
            // Task complete signal
            const monitoring: ActorMonitoring = {
              type: 'actor',
              source: id,
              timestamp: Date.now(),
              actionTaken: 'done',
              success: true,
              unexpectedResult: false,
            };
            return {
              output: { actionName: 'done', result: null, escalated: false },
              state,
              monitoring,
            };
          }

          // Validate the requested tool exists and is allowed
          const matchedTool = availableTools.find(
            (t: ToolDefinition) => t.name.toLowerCase() === actionInstruction.tool.toLowerCase(),
          );

          if (matchedTool) {
            toolName = matchedTool.name;
            toolInput = actionInstruction.input;
          } else {
            // Requested tool not available — fall back to keyword matching
            const fallback = selectToolFallback(availableTools, input.snapshot);
            if (!fallback) {
              const monitoring: ActorMonitoring = {
                type: 'actor',
                source: id,
                timestamp: Date.now(),
                actionTaken: 'none',
                success: false,
                unexpectedResult: true,
              };
              return {
                output: { actionName: 'none', result: null, escalated: false },
                state,
                monitoring,
              };
            }
            toolName = fallback.name;
            toolInput = buildFallbackInput(input.snapshot);
          }
        } else {
          // Fallback path: no action instruction, use keyword matching
          const fallback = selectToolFallback(availableTools, input.snapshot);
          if (!fallback) {
            const monitoring: ActorMonitoring = {
              type: 'actor',
              source: id,
              timestamp: Date.now(),
              actionTaken: 'none',
              success: false,
              unexpectedResult: true,
            };
            return {
              output: { actionName: 'none', result: null, escalated: false },
              state,
              monitoring,
            };
          }
          toolName = fallback.name;
          toolInput = buildFallbackInput(input.snapshot);
        }

        // Execute the tool
        const result = await tools.execute(toolName, toolInput);

        // Determine success and unexpected result
        const success = !result.isError;
        const unexpectedResult = !!result.isError || result.output === null || result.output === undefined || result.output === '';

        // Write action result to workspace
        const entry: WorkspaceEntry = {
          source: id,
          content: result.output ?? '',
          salience: success ? 0.7 : 0.3,
          timestamp: Date.now(),
        };
        writePort.write(entry);

        // Update state with running success rate
        const newActionCount = state.actionCount + 1;
        const newSuccessRate =
          (state.successRate * state.actionCount + (success ? 1 : 0)) / newActionCount;

        const newState: ActorState = {
          actionCount: newActionCount,
          lastActionName: toolName,
          successRate: newSuccessRate,
        };

        const monitoring: ActorMonitoring = {
          type: 'actor',
          source: id,
          timestamp: Date.now(),
          actionTaken: toolName,
          success,
          unexpectedResult,
        };

        return {
          output: { actionName: toolName, result, escalated: false },
          state: newState,
          monitoring,
        };
      } catch (err: unknown) {
        const error: StepError = {
          message: err instanceof Error ? err.message : String(err),
          recoverable: true,
          moduleId: id,
          phase: 'act',
        };

        const monitoring: ActorMonitoring = {
          type: 'actor',
          source: id,
          timestamp: Date.now(),
          actionTaken: state.lastActionName ?? 'unknown',
          success: false,
          unexpectedResult: true,
        };

        return {
          output: { actionName: 'error', result: null, escalated: false },
          state,
          monitoring,
          error,
        };
      }
    },
  };
}
