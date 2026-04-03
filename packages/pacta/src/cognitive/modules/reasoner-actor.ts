/**
 * Reasoner-Actor Module — merged reasoning and action execution in a single LLM call.
 *
 * Combines the Reasoner's prompt construction and structured output parsing with
 * the Actor's tool execution and workspace writing. Each step produces a plan,
 * reasoning trace, and action instruction, then immediately executes the action
 * and writes the result back to the workspace.
 *
 * ## Cognitive Science Grounding
 *
 * **Primary analog: Prefrontal Cortex (PFC) executive function + Basal Ganglia
 * action selection — deliberate reasoning fused with motor execution.**
 *
 * This module merges two conceptually distinct cognitive functions (reasoning
 * and acting) into a single LLM invocation for practical efficiency. The
 * theoretical separation remains valid; the merge is an implementation choice.
 *
 * - **ACT-R (Anderson, 2007) — Procedural + Motor Unification:** In ACT-R,
 *   the procedural module fires a production rule which may simultaneously
 *   direct the motor module to act. Our ReasonerActor mirrors this: a single
 *   LLM call produces both a reasoning trace (procedural) and an action
 *   instruction (motor). The merge avoids the latency of two sequential LLM
 *   calls while preserving the plan→reason→act structure in the output format.
 *
 * - **SOAR (Laird, 2012) — Propose-Apply Decision Cycle:** SOAR's decision
 *   cycle has an elaborate phase (propose operators) followed by an apply
 *   phase (execute the selected operator). Our ReasonerActor combines both:
 *   the <plan> + <reasoning> sections are the elaboration/proposal, and the
 *   <action> section is the apply. Impasse detection (SOAR's subgoaling
 *   trigger) is handled by ReasonerActorV2 via action entropy monitoring.
 *
 * - **CLARION (Sun, 2002) — Dual-Process Integration:** CLARION maintains
 *   both explicit (rule-based) and implicit (subsymbolic) processing levels,
 *   integrated at the action level. Our ReasonerActor's structured output
 *   format (<plan> = explicit strategy, <reasoning> = deliberate chain-of-thought,
 *   <action> = integrated decision) mirrors this dual-level integration.
 *
 * - **Dual-Process Theory (Kahneman, 2011):** The ReasonerActor operates as
 *   System 2 — slow, deliberate, effortful reasoning. The confidence signal
 *   (computed from action entropy) provides a rough proxy for System 1/2
 *   transition: high entropy = uncertain = System 2 engagement, low entropy =
 *   habitual = potential System 1 compilation target (see RFC 001 Part V).
 *
 * **What this module captures:**
 * - Deliberate reasoning with structured output (plan → reasoning → action)
 * - Tool execution and workspace writing in a single step
 * - Confidence estimation via action entropy (Shannon entropy over recent actions)
 * - Strategy control via κ (restricted actions, force replan, strategy override)
 * - The "done" action: object-level self-termination signal
 *
 * **What this module does NOT capture (known gaps):**
 * - The "done" action is an unvalidated LLM guess. No metacognitive verification
 *   confirms that the goal is actually satisfied. See RFC 004 (Goal-State Monitoring).
 * - No goal-state awareness: the reasoner doesn't know what "done" looks like beyond
 *   what's in the workspace prompt. It can't compare its output to the goal.
 * - Working memory limits: ACT-R enforces one-chunk-per-buffer. Our workspace capacity
 *   is coarser — the reasoner sees the full workspace snapshot, not a constrained view.
 *   Partitioned workspace (RFC 003) partially addresses this with per-module selectors.
 *
 * **References:**
 * - Anderson, J. R. (2007). How Can the Human Mind Occur in the Physical Universe? Oxford UP.
 * - Laird, J. E. (2012). The Soar Cognitive Architecture. MIT Press.
 * - Sun, R. (2002). Duality of the Mind: A Bottom-Up Approach Toward Cognition. Lawrence Erlbaum.
 * - Kahneman, D. (2011). Thinking, Fast and Slow. Farrar, Straus and Giroux.
 *
 * @see docs/rfcs/001-cognitive-composition.md — Part IV, Phases 4+7 (REASON, ACT)
 * @see docs/rfcs/001-cognitive-composition.md — Part V (System 1/2 Transition)
 */

import type {
  CognitiveModule,
  MonitoringSignal,
  ControlDirective,
  StepResult,
  StepError,
  WorkspaceWritePort,
  WorkspaceEntry,
  ReadonlyWorkspaceSnapshot,
  ProviderAdapter,
  AdapterConfig,
} from '../algebra/index.js';
import { moduleId } from '../algebra/index.js';
import type { ToolProvider, ToolDefinition, ToolResult } from '../../ports/tool-provider.js';

// ── Types ────────────────────────────────────────────────────────

/** Input to the reasoner-actor: a workspace snapshot to reason and act on. */
export interface ReasonerActorInput {
  snapshot: ReadonlyWorkspaceSnapshot;
}

/** Output of the reasoner-actor: plan, reasoning, and action result. */
export interface ReasonerActorOutput {
  plan: string;
  reasoning: string;
  actionName: string;
  toolResult: ToolResult | null;
  tokensUsed: number;
}

/** Reasoner-actor internal state. */
export interface ReasonerActorState {
  cycleCount: number;
  totalTokensUsed: number;
  lastActionName: string | null;
  successRate: number;
  recentActions: string[];  // sliding window of last 6 action names for entropy computation
}

/** Control directive for the reasoner-actor. */
export interface ReasonerActorControl extends ControlDirective {
  strategy: 'cot' | 'think' | 'plan';
  effort: 'low' | 'medium' | 'high';
  restrictedActions?: string[];  // action types the monitor has blocked
  forceReplan?: boolean;  // monitor demands a plan revision before acting
}

/** Configuration for the reasoner-actor factory. */
export interface ReasonerActorConfig {
  id?: string;
  pactTemplate?: AdapterConfig['pactTemplate'];
  /** PRD 045: type-driven context binding. Declares what entry types this module needs. */
  contextBinding?: import('../algebra/partition-types.js').ModuleContextBinding;
}

// ── Monitoring Signal ────────────────────────────────────────────

/** Reasoner-actor monitoring: merged reasoning + action outcome tracking. */
export interface ReasonerActorMonitoring extends MonitoringSignal {
  type: 'reasoner-actor';
  actionTaken: string;
  success: boolean;
  unexpectedResult: boolean;
  tokensThisStep: number;
  confidence: number;  // behavioral: computed from action entropy
  declaredPlanAction: string;  // what <plan> said to do next
}

// ── Strategy Prompts ─────────────────────────────────────────────

const STRATEGY_PROMPTS: Record<ReasonerActorControl['strategy'], string> = {
  cot: 'Think step by step. Show your reasoning chain before reaching a conclusion.',
  think: 'Consider the problem deeply. Weigh alternatives and identify the strongest path.',
  plan: 'Produce a structured plan with numbered steps. Identify dependencies and risks.',
};

const EFFORT_PREFIXES: Record<ReasonerActorControl['effort'], string> = {
  low: 'Briefly: ',
  medium: '',
  high: 'Thoroughly and comprehensively: ',
};

const FORMAT_INSTRUCTION = `

Produce your response in exactly three sections using the following format:

<plan>
Brief 2-3 step plan for what you'll do next. State your immediate next action clearly.
</plan>

<reasoning>
Your analysis of the current state and why you chose this action.
</reasoning>

<action>
{"tool": "ToolName", "input": {"param": "value"}}
</action>

Available tool input schemas:
- Read: {"file_path": "path/to/file"}
- Write: {"file_path": "path/to/file", "content": "file content"}
- Edit: {"file_path": "path/to/file", "old_string": "text to find", "new_string": "replacement"}
- Glob: {"pattern": "**/*.ts"}
- Grep: {"pattern": "searchRegex", "path": "directory"}

If the task is complete and no further action is needed, output:
<action>
{"tool": "done", "input": {}}
</action>
`;

const FORCE_REPLAN_PREFIX =
  'IMPORTANT: Your previous approach is not working. You MUST try a fundamentally different strategy. Do NOT repeat the same action types you\'ve been using.\n\n';

// ── Parsing ──────────────────────────────────────────────────────

/** Parse a tagged section from LLM output. */
function parseSection(text: string, tag: string): string {
  const regex = new RegExp(`<${tag}>\\s*([\\s\\S]*?)\\s*</${tag}>`);
  const match = regex.exec(text);
  return match?.[1]?.trim() ?? '';
}

/** Action instruction shape parsed from the <action> block. */
interface ParsedAction {
  tool: string;
  input: unknown;
}

const ACTION_BLOCK_REGEX = /<action>\s*([\s\S]*?)\s*<\/action>/;

/** Parse a structured action from the LLM response. */
function parseActionBlock(text: string): ParsedAction | undefined {
  const match = ACTION_BLOCK_REGEX.exec(text);
  if (!match) return undefined;

  try {
    const parsed = JSON.parse(match[1]);
    if (typeof parsed.tool === 'string' && parsed.input !== undefined) {
      return {
        tool: parsed.tool,
        input: parsed.input,
      };
    }
  } catch {
    // JSON parse failed — malformed action block
  }
  return undefined;
}

// ── Action Entropy ───────────────────────────────────────────────

/**
 * Compute Shannon entropy over recent action names, normalized to [0, 1].
 * Higher entropy = more diverse actions = higher behavioral confidence.
 */
function actionEntropy(recentActions: string[]): number {
  if (recentActions.length === 0) return 1;
  const counts = new Map<string, number>();
  for (const a of recentActions) counts.set(a, (counts.get(a) ?? 0) + 1);
  const total = recentActions.length;
  let entropy = 0;
  for (const count of counts.values()) {
    const p = count / total;
    if (p > 0) entropy -= p * Math.log2(p);
  }
  // Normalize to [0, 1] based on max possible entropy
  const maxEntropy = Math.log2(Math.min(total, 6)); // max 6 distinct actions
  return maxEntropy > 0 ? entropy / maxEntropy : 1;
}

// ── Declared Plan Action Extraction ──────────────────────────────

/** Action verbs to look for in the plan section. */
const PLAN_ACTION_VERBS = ['read', 'write', 'edit', 'glob', 'grep', 'done'];

/** Extract the first declared action verb from the plan text. */
function extractDeclaredPlanAction(planText: string): string {
  const lower = planText.toLowerCase();
  for (const verb of PLAN_ACTION_VERBS) {
    if (lower.includes(verb)) return verb;
  }
  return 'unknown';
}

// ── Fallback Tool Selection ──────────────────────────────────────

/**
 * Keyword-based tool selection fallback when LLM output is not parseable.
 * Same heuristic as the Actor module.
 */
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
 * Create a Reasoner-Actor cognitive module.
 *
 * Merges reasoning and action execution into a single LLM call per step.
 * The LLM produces a plan, reasoning trace, and action instruction; the module
 * then executes the action via the ToolProvider and writes the result to the workspace.
 *
 * @param adapter - The ProviderAdapter for LLM invocation.
 * @param tools - The ToolProvider for listing and executing tools.
 * @param writePort - Workspace write port for emitting results.
 * @param config - Optional configuration.
 */
export function createReasonerActor(
  adapter: ProviderAdapter,
  tools: ToolProvider,
  writePort: WorkspaceWritePort,
  config?: ReasonerActorConfig,
): CognitiveModule<ReasonerActorInput, ReasonerActorOutput, ReasonerActorState, ReasonerActorMonitoring, ReasonerActorControl> {
  const id = moduleId(config?.id ?? 'reasoner-actor');
  const pactTemplate = config?.pactTemplate ?? {};

  return {
    id,
    contextBinding: config?.contextBinding ?? { types: ['goal', 'constraint', 'operational'], budget: 8192, strategy: 'salience' as const },

    initialState(): ReasonerActorState {
      return {
        cycleCount: 0,
        totalTokensUsed: 0,
        lastActionName: null,
        successRate: 1,
        recentActions: [],
      };
    },

    async step(
      input: ReasonerActorInput,
      state: ReasonerActorState,
      control: ReasonerActorControl,
    ): Promise<StepResult<ReasonerActorOutput, ReasonerActorState, ReasonerActorMonitoring>> {
      try {
        // 1. Build tool list from ToolProvider, filtering out restrictedActions
        let availableTools = tools.list();
        if (control.restrictedActions && control.restrictedActions.length > 0) {
          const restricted = new Set(control.restrictedActions.map(a => a.toLowerCase()));
          availableTools = availableTools.filter(
            (t: ToolDefinition) => !restricted.has(t.name.toLowerCase()),
          );
        }

        // 2. Build system prompt with strategy + effort + format instructions + restrictions
        const strategyPrompt = STRATEGY_PROMPTS[control.strategy];
        const effortPrefix = EFFORT_PREFIXES[control.effort];

        let systemPrompt = '';

        // Prepend force-replan instruction if requested
        if (control.forceReplan) {
          systemPrompt += FORCE_REPLAN_PREFIX;
        }

        systemPrompt += `${effortPrefix}${strategyPrompt}${FORMAT_INSTRUCTION}`;

        // Include restricted actions warning if applicable
        if (control.restrictedActions && control.restrictedActions.length > 0) {
          systemPrompt += `\nThe following action types are BLOCKED and cannot be used: ${control.restrictedActions.join(', ')}. Choose a different action.\n`;
        }

        // 3. Invoke ProviderAdapter with workspace snapshot
        const adapterConfig: AdapterConfig = {
          pactTemplate,
          systemPrompt,
        };

        const result = await adapter.invoke(input.snapshot, adapterConfig);
        const responseText = result.output;
        const realTokens = result.usage.totalTokens;

        // 4. Parse <plan>, <reasoning>, <action> sections from response
        const plan = parseSection(responseText, 'plan');
        const reasoning = parseSection(responseText, 'reasoning');
        const parsedAction = parseActionBlock(responseText);

        // Determine tool name and input
        let toolName: string;
        let toolInput: unknown;
        let usedFallback = false;

        if (parsedAction) {
          toolName = parsedAction.tool;
          toolInput = parsedAction.input;
        } else {
          // Fallback: keyword-based tool selection
          const fallback = selectToolFallback(availableTools, input.snapshot);
          if (fallback) {
            toolName = fallback.name;
            toolInput = buildFallbackInput(input.snapshot);
            usedFallback = true;
          } else {
            toolName = 'none';
            toolInput = {};
            usedFallback = true;
          }
        }

        // 5. If action tool is "done", return completion output (no tool execution)
        if (toolName.toLowerCase() === 'done') {
          const updatedRecentActions = [...state.recentActions, 'done'].slice(-6);
          const confidence = actionEntropy(updatedRecentActions);
          const declaredPlanAction = extractDeclaredPlanAction(plan);

          const newState: ReasonerActorState = {
            cycleCount: state.cycleCount + 1,
            totalTokensUsed: state.totalTokensUsed + realTokens,
            lastActionName: 'done',
            successRate: state.successRate,
            recentActions: updatedRecentActions,
          };

          const monitoring: ReasonerActorMonitoring = {
            type: 'reasoner-actor',
            source: id,
            timestamp: Date.now(),
            actionTaken: 'done',
            success: true,
            unexpectedResult: false,
            tokensThisStep: realTokens,
            confidence,
            declaredPlanAction,
          } as ReasonerActorMonitoring;

          return {
            output: {
              plan,
              reasoning,
              actionName: 'done',
              toolResult: null,
              tokensUsed: realTokens,
            },
            state: newState,
            monitoring,
          };
        }

        // Validate the requested tool exists and is available
        if (!usedFallback) {
          const matchedTool = availableTools.find(
            (t: ToolDefinition) => t.name.toLowerCase() === toolName.toLowerCase(),
          );

          if (!matchedTool) {
            // Requested tool not available — fall back to keyword matching
            const fallback = selectToolFallback(availableTools, input.snapshot);
            if (fallback) {
              toolName = fallback.name;
              toolInput = buildFallbackInput(input.snapshot);
            } else {
              toolName = 'none';
              toolInput = {};
            }
          } else {
            toolName = matchedTool.name;
          }
        }

        // Handle case where no tool could be determined
        if (toolName === 'none') {
          const updatedRecentActions = [...state.recentActions, 'none'].slice(-6);
          const confidence = actionEntropy(updatedRecentActions);
          const declaredPlanAction = extractDeclaredPlanAction(plan);

          const newState: ReasonerActorState = {
            cycleCount: state.cycleCount + 1,
            totalTokensUsed: state.totalTokensUsed + realTokens,
            lastActionName: 'none',
            successRate: state.successRate,
            recentActions: updatedRecentActions,
          };

          const monitoring: ReasonerActorMonitoring = {
            type: 'reasoner-actor',
            source: id,
            timestamp: Date.now(),
            actionTaken: 'none',
            success: false,
            unexpectedResult: true,
            tokensThisStep: realTokens,
            confidence,
            declaredPlanAction,
          } as ReasonerActorMonitoring;

          return {
            output: {
              plan,
              reasoning,
              actionName: 'none',
              toolResult: null,
              tokensUsed: realTokens,
            },
            state: newState,
            monitoring,
          };
        }

        // 6. Execute the tool via ToolProvider
        let toolResult: ToolResult;
        let success: boolean;
        let unexpectedResult: boolean;

        try {
          toolResult = await tools.execute(toolName, toolInput);
          success = !toolResult.isError;
          unexpectedResult = !!toolResult.isError || toolResult.output === null || toolResult.output === undefined || toolResult.output === '';
        } catch (execErr: unknown) {
          // Tool execution threw — create error result
          toolResult = {
            output: execErr instanceof Error ? execErr.message : String(execErr),
            isError: true,
          };
          success = false;
          unexpectedResult = true;
        }

        // 7. Write formatted tool result to workspace (same format as actor)
        const outputText = typeof toolResult.output === 'string'
          ? toolResult.output.slice(0, 3000)  // cap very long outputs
          : JSON.stringify(toolResult.output);
        const toolResultContent = [
          `=== Tool Result: ${toolName} ===`,
          `Input: ${JSON.stringify(toolInput)}`,
          `Status: ${success ? 'SUCCESS' : 'ERROR'}`,
          `Output:\n${outputText}`,
        ].join('\n');

        const entry: WorkspaceEntry = {
          source: id,
          content: toolResultContent,
          salience: success ? 0.5 : 0.3,
          timestamp: Date.now(),
        };
        writePort.write(entry);

        // 8. Compute behavioral confidence from action entropy
        const updatedRecentActions = [...state.recentActions, toolName].slice(-6);
        const confidence = actionEntropy(updatedRecentActions);

        // 9. Extract declaredPlanAction from the plan section
        const declaredPlanAction = extractDeclaredPlanAction(plan);

        // Update state with running success rate
        const newCycleCount = state.cycleCount + 1;
        const newSuccessRate =
          (state.successRate * state.cycleCount + (success ? 1 : 0)) / newCycleCount;

        const newState: ReasonerActorState = {
          cycleCount: newCycleCount,
          totalTokensUsed: state.totalTokensUsed + realTokens,
          lastActionName: toolName,
          successRate: newSuccessRate,
          recentActions: updatedRecentActions,
        };

        // 10. Return StepResult with output, updated state, monitoring signal
        const monitoring: ReasonerActorMonitoring = {
          type: 'reasoner-actor',
          source: id,
          timestamp: Date.now(),
          actionTaken: toolName,
          success,
          unexpectedResult,
          tokensThisStep: realTokens,
          confidence,
          declaredPlanAction,
        } as ReasonerActorMonitoring;

        return {
          output: {
            plan,
            reasoning,
            actionName: toolName,
            toolResult,
            tokensUsed: realTokens,
          },
          state: newState,
          monitoring,
        };
      } catch (err: unknown) {
        const error: StepError = {
          message: err instanceof Error ? err.message : String(err),
          recoverable: true,
          moduleId: id,
          phase: 'reason-act',
        };

        const monitoring: ReasonerActorMonitoring = {
          type: 'reasoner-actor',
          source: id,
          timestamp: Date.now(),
          actionTaken: state.lastActionName ?? 'unknown',
          success: false,
          unexpectedResult: true,
          tokensThisStep: 0,
          confidence: 0,
          declaredPlanAction: 'unknown',
        } as ReasonerActorMonitoring;

        return {
          output: {
            plan: '',
            reasoning: '',
            actionName: 'error',
            toolResult: null,
            tokensUsed: 0,
          },
          state,
          monitoring,
          error,
        };
      }
    },
  };
}
