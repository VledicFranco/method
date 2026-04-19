// SPDX-License-Identifier: Apache-2.0
/**
 * ReasonerActorV2 — impasse detection + auto-subgoaling.
 *
 * Extends v1 ReasonerActor with SOAR-style impasse detection (Laird, Newell,
 * Rosenbloom 1987). Detects four impasse types — tie, no-change, rejection,
 * stall — and generates targeted subgoals to resolve each one. Auto-subgoals
 * are injected into the workspace as high-salience entries.
 *
 * Implements CognitiveModule<I, O, S, Mu, Kappa> — drop-in replacement for v1.
 *
 * Grounded in: SOAR impasse taxonomy (Laird, Newell, Rosenbloom 1987),
 * OpenReview 2025 LRM metacognitive failure analysis.
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
import type {
  ImpasseSignal,
  ImpasseType,
  ReasonerActorV2Monitoring,
  ReasonerActorV2Config,
} from '../algebra/enriched-signals.js';
import type { ReasonerActorMonitoring } from '../algebra/module.js';

// ── Re-export types for consumers ───────────────────────────────

export type {
  ReasonerActorV2Monitoring,
  ReasonerActorV2Config,
  ImpasseSignal,
  ImpasseType,
};

// ── Types ────────────────────────────────────────────────────────

/** Input to the reasoner-actor: a workspace snapshot to reason and act on. */
export interface ReasonerActorV2Input {
  snapshot: ReadonlyWorkspaceSnapshot;
}

/** Output of the reasoner-actor: plan, reasoning, and action result. */
export interface ReasonerActorV2Output {
  plan: string;
  reasoning: string;
  actionName: string;
  toolResult: ToolResult | null;
  tokensUsed: number;
}

/** ReasonerActorV2 internal state — extends v1 state with impasse tracking fields. */
export interface ReasonerActorV2State {
  cycleCount: number;
  totalTokensUsed: number;
  lastActionName: string | null;
  lastToolInput: string | null;  // serialized input for no-change detection
  successRate: number;
  recentActions: string[];  // sliding window of last 6 action names for entropy computation
}

/** Control directive for the reasoner-actor (same as v1). */
export interface ReasonerActorV2Control extends ControlDirective {
  strategy: 'cot' | 'think' | 'plan';
  effort: 'low' | 'medium' | 'high';
  restrictedActions?: string[];
  forceReplan?: boolean;
}

// ── Strategy Prompts (same as v1) ───────────────────────────────

const STRATEGY_PROMPTS: Record<ReasonerActorV2Control['strategy'], string> = {
  cot: 'Think step by step. Show your reasoning chain before reaching a conclusion.',
  think: 'Consider the problem deeply. Weigh alternatives and identify the strongest path.',
  plan: 'Produce a structured plan with numbered steps. Identify dependencies and risks.',
};

const EFFORT_PREFIXES: Record<ReasonerActorV2Control['effort'], string> = {
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

// ── Hedging Detection ────────────────────────────────────────────

/**
 * Hedging patterns that indicate the LLM is undecided between alternatives.
 * Presence of 2+ of these in the response indicates a tie impasse.
 */
const HEDGING_PATTERNS = [
  /\bon the other hand\b/i,
  /\balternatively\b/i,
  /\bcould (also|either)\b/i,
  /\beither\s+[\w]+\s+or\b/i,
  /\bwe could (go with|try|use)\b.*?\bor\b/i,
  /\boption\s*[A-Za-z0-9]\b/i,
  /\bapproach\s*[A-Za-z0-9]\b/i,
  /\bnot sure (whether|if)\b/i,
  /\bit('s| is) (unclear|hard to decide|difficult to choose)\b/i,
  /\bboth .+ and .+ (seem|look|appear|are)\b/i,
];

/**
 * Extract candidate approaches from hedging text.
 * Looks for "X or Y" patterns and "Option A / Option B" patterns.
 */
function extractCandidates(text: string): string[] {
  const candidates: string[] = [];

  // Pattern: "either X or Y"
  const eitherOrMatch = text.match(/either\s+(.+?)\s+or\s+(.+?)[\.\,\;]/i);
  if (eitherOrMatch) {
    candidates.push(eitherOrMatch[1].trim(), eitherOrMatch[2].trim());
  }

  // Pattern: "Option A" / "Option B" or "Approach 1" / "Approach 2"
  const optionMatches = text.match(/(?:option|approach)\s+([A-Za-z0-9]+)/gi);
  if (optionMatches && optionMatches.length >= 2) {
    for (const m of optionMatches) {
      candidates.push(m.trim());
    }
  }

  // Pattern: "X or Y" (simple)
  if (candidates.length === 0) {
    const simpleOrMatch = text.match(/(?:could|should|might)\s+(?:try|use|go with)\s+(.+?)\s+or\s+(.+?)[\.\,\;]/i);
    if (simpleOrMatch) {
      candidates.push(simpleOrMatch[1].trim(), simpleOrMatch[2].trim());
    }
  }

  return candidates.length > 0 ? candidates : ['approach A', 'approach B'];
}

/**
 * Detect hedging language in LLM response.
 * Returns true if 2+ hedging patterns match.
 */
function detectHedging(responseText: string): boolean {
  let matchCount = 0;
  for (const pattern of HEDGING_PATTERNS) {
    if (pattern.test(responseText)) {
      matchCount++;
      if (matchCount >= 2) return true;
    }
  }
  return false;
}

/**
 * Check if the <action> block contains multiple tool specifications
 * (e.g., two JSON objects or an array of actions).
 */
function detectMultipleActions(actionText: string): string[] | null {
  // Check for JSON array of actions
  try {
    const parsed = JSON.parse(actionText);
    if (Array.isArray(parsed) && parsed.length >= 2) {
      return parsed.map((a: { tool?: string }) => a.tool ?? 'unknown');
    }
  } catch {
    // Not valid JSON array — check for multiple JSON objects
  }

  // Check for multiple separate { "tool": ... } blocks
  const toolMatches = actionText.match(/"tool"\s*:\s*"([^"]+)"/g);
  if (toolMatches && toolMatches.length >= 2) {
    return toolMatches.map(m => {
      const nameMatch = m.match(/"tool"\s*:\s*"([^"]+)"/);
      return nameMatch?.[1] ?? 'unknown';
    });
  }

  return null;
}

// ── Impasse Detection ────────────────────────────────────────────

interface ImpasseContext {
  responseText: string;
  actionText: string;
  toolName: string;
  toolInput: unknown;
  toolResult: ToolResult | null;
  success: boolean;
  state: ReasonerActorV2State;
  recentActions: string[];
  stallEntropyThreshold: number;
  noChangeThreshold: number;
}

/**
 * Detect impasse from the current step's context.
 *
 * Checks impasses in priority order: tie > rejection > no-change > stall.
 * Returns the first detected impasse, or null if no impasse is found.
 */
function detectImpasse(ctx: ImpasseContext): ImpasseSignal | null {
  // 1. Tie: hedging language or multiple action candidates
  const multipleActions = detectMultipleActions(ctx.actionText);
  if (multipleActions) {
    return {
      type: 'tie',
      candidates: multipleActions,
      autoSubgoal: `Compare approaches ${multipleActions.join(' and ')} explicitly. Which is more likely to succeed given the current state?`,
    };
  }

  if (detectHedging(ctx.responseText)) {
    const candidates = extractCandidates(ctx.responseText);
    return {
      type: 'tie',
      candidates,
      autoSubgoal: `Compare approaches ${candidates.join(' and ')} explicitly. Which is more likely to succeed given the current state?`,
    };
  }

  // 2. Rejection: tool execution failed AND no alternative action proposed
  if (ctx.toolResult && ctx.toolResult.isError && !ctx.success) {
    // Check if the response proposes an alternative
    const proposesAlternative = /\balternative\b/i.test(ctx.responseText)
      || /\binstead\b/i.test(ctx.responseText)
      || /\bfallback\b/i.test(ctx.responseText)
      || /\btry\s+(a\s+)?different\b/i.test(ctx.responseText);

    if (!proposesAlternative) {
      const errorMsg = typeof ctx.toolResult.output === 'string'
        ? ctx.toolResult.output.slice(0, 200)
        : JSON.stringify(ctx.toolResult.output).slice(0, 200);
      return {
        type: 'rejection',
        failedTool: ctx.toolName,
        autoSubgoal: `Tool ${ctx.toolName} failed with: ${errorMsg}. What other tools or approaches could achieve the same goal?`,
      };
    }
  }

  // 3. No-change: same action + same input as previous cycle
  if (ctx.state.lastActionName !== null) {
    const currentInputStr = serializeInput(ctx.toolInput);
    if (
      ctx.toolName === ctx.state.lastActionName &&
      currentInputStr === ctx.state.lastToolInput
    ) {
      return {
        type: 'no-change',
        autoSubgoal: "Previous approach didn't make progress. List 3 alternative approaches and select the most promising.",
      };
    }
  }

  // 4. Stall: action entropy below threshold across recent actions
  const entropy = actionEntropy(ctx.recentActions);
  if (ctx.recentActions.length >= 3 && entropy < ctx.stallEntropyThreshold) {
    return {
      type: 'stall',
      stuckCycles: ctx.recentActions.length,
      autoSubgoal: 'Step back. Restate the problem from scratch. What assumptions am I making that might be wrong?',
    };
  }

  return null;
}

/** Serialize tool input for no-change comparison. */
function serializeInput(input: unknown): string {
  if (input === null || input === undefined) return '';
  if (typeof input === 'string') return input;
  try {
    return JSON.stringify(input);
  } catch {
    return String(input);
  }
}

// ── Factory ──────────────────────────────────────────────────────

/**
 * Create a ReasonerActorV2 cognitive module.
 *
 * Extends v1 ReasonerActor with SOAR-style impasse detection. Each step:
 * 1. Executes the standard ReasonerActor behavior (LLM invocation, action parsing, tool execution)
 * 2. Checks for impasse conditions (tie, no-change, rejection, stall)
 * 3. If impasse detected: generates subgoal, injects into workspace, includes ImpasseSignal in monitoring
 * 4. Produces ReasonerActorV2Monitoring (extends ReasonerActorMonitoring with optional impasse field)
 *
 * @param adapter   - The ProviderAdapter for LLM invocation.
 * @param tools     - The ToolProvider for listing and executing tools.
 * @param writePort - Workspace write port for emitting results and subgoals.
 * @param config    - Optional ReasonerActorV2Config.
 */
export function createReasonerActorV2(
  adapter: ProviderAdapter,
  tools: ToolProvider,
  writePort: WorkspaceWritePort,
  config?: ReasonerActorV2Config,
): CognitiveModule<ReasonerActorV2Input, ReasonerActorV2Output, ReasonerActorV2State, ReasonerActorV2Monitoring, ReasonerActorV2Control> {
  const id = moduleId(config?.id ?? 'reasoner-actor');
  const pactTemplate = config?.pactTemplate ?? {};
  const stallEntropyThreshold = config?.stallEntropyThreshold ?? 0.3;
  const noChangeThreshold = config?.noChangeThreshold ?? 2;
  const injectSubgoals = config?.injectSubgoals ?? true;
  const subgoalSalience = config?.subgoalSalience ?? 0.9;

  // noChangeThreshold is specified but the PRD's detection rule for no-change
  // is "same action + same input as previous cycle" — a single repetition suffices.
  // We use the threshold to allow configuration but default behavior matches PRD.
  void noChangeThreshold;

  return {
    id,

    initialState(): ReasonerActorV2State {
      return {
        cycleCount: 0,
        totalTokensUsed: 0,
        lastActionName: null,
        lastToolInput: null,
        successRate: 1,
        recentActions: [],
      };
    },

    async step(
      input: ReasonerActorV2Input,
      state: ReasonerActorV2State,
      control: ReasonerActorV2Control,
    ): Promise<StepResult<ReasonerActorV2Output, ReasonerActorV2State, ReasonerActorV2Monitoring>> {
      try {
        // 1. Build tool list from ToolProvider, filtering out restrictedActions
        let availableTools = tools.list();
        if (control.restrictedActions && control.restrictedActions.length > 0) {
          const restricted = new Set(control.restrictedActions.map(a => a.toLowerCase()));
          availableTools = availableTools.filter(
            (t: ToolDefinition) => !restricted.has(t.name.toLowerCase()),
          );
        }

        // 2. Build system prompt with strategy + effort + format instructions
        const strategyPrompt = STRATEGY_PROMPTS[control.strategy];
        const effortPrefix = EFFORT_PREFIXES[control.effort];

        let systemPrompt = '';
        if (control.forceReplan) {
          systemPrompt += FORCE_REPLAN_PREFIX;
        }
        systemPrompt += `${effortPrefix}${strategyPrompt}${FORMAT_INSTRUCTION}`;

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

        // 4. Parse <plan>, <reasoning>, <action> sections
        const plan = parseSection(responseText, 'plan');
        const reasoning = parseSection(responseText, 'reasoning');
        const actionRaw = parseSection(responseText, 'action');
        const parsedAction = parseActionBlock(responseText);

        // Determine tool name and input
        let toolName: string;
        let toolInput: unknown;
        let usedFallback = false;

        if (parsedAction) {
          toolName = parsedAction.tool;
          toolInput = parsedAction.input;
        } else {
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

        // 5. If action tool is "done", return completion (no impasse detection on done)
        if (toolName.toLowerCase() === 'done') {
          const updatedRecentActions = [...state.recentActions, 'done'].slice(-6);
          const confidence = actionEntropy(updatedRecentActions);
          const declaredPlanAction = extractDeclaredPlanAction(plan);

          const newState: ReasonerActorV2State = {
            cycleCount: state.cycleCount + 1,
            totalTokensUsed: state.totalTokensUsed + realTokens,
            lastActionName: 'done',
            lastToolInput: null,
            successRate: state.successRate,
            recentActions: updatedRecentActions,
          };

          const monitoring: ReasonerActorV2Monitoring = {
            type: 'reasoner-actor',
            source: id,
            timestamp: Date.now(),
            actionTaken: 'done',
            success: true,
            unexpectedResult: false,
            tokensThisStep: realTokens,
            confidence,
            declaredPlanAction,
          };

          return { output: { plan, reasoning, actionName: 'done', toolResult: null, tokensUsed: realTokens }, state: newState, monitoring };
        }

        // Validate the requested tool exists and is available
        if (!usedFallback) {
          const matchedTool = availableTools.find(
            (t: ToolDefinition) => t.name.toLowerCase() === toolName.toLowerCase(),
          );
          if (!matchedTool) {
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

          const newState: ReasonerActorV2State = {
            cycleCount: state.cycleCount + 1,
            totalTokensUsed: state.totalTokensUsed + realTokens,
            lastActionName: 'none',
            lastToolInput: null,
            successRate: state.successRate,
            recentActions: updatedRecentActions,
          };

          const monitoring: ReasonerActorV2Monitoring = {
            type: 'reasoner-actor',
            source: id,
            timestamp: Date.now(),
            actionTaken: 'none',
            success: false,
            unexpectedResult: true,
            tokensThisStep: realTokens,
            confidence,
            declaredPlanAction,
          };

          return { output: { plan, reasoning, actionName: 'none', toolResult: null, tokensUsed: realTokens }, state: newState, monitoring };
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
          toolResult = {
            output: execErr instanceof Error ? execErr.message : String(execErr),
            isError: true,
          };
          success = false;
          unexpectedResult = true;
        }

        // 7. Write tool result to workspace
        const outputText = typeof toolResult.output === 'string'
          ? toolResult.output.slice(0, 3000)
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

        // 9. Extract declaredPlanAction
        const declaredPlanAction = extractDeclaredPlanAction(plan);

        // 10. Impasse detection (SOAR — Laird, Newell, Rosenbloom 1987)
        const impasse = detectImpasse({
          responseText,
          actionText: actionRaw,
          toolName,
          toolInput,
          toolResult,
          success,
          state,
          recentActions: updatedRecentActions,
          stallEntropyThreshold,
          noChangeThreshold,
        });

        // 11. If impasse detected and injectSubgoals enabled, write subgoal to workspace
        if (impasse && injectSubgoals) {
          const subgoalEntry: WorkspaceEntry = {
            source: id,
            content: `[SUBGOAL] ${impasse.autoSubgoal}`,
            salience: subgoalSalience,
            timestamp: Date.now(),
          };
          writePort.write(subgoalEntry);
        }

        // 12. Update state
        const newCycleCount = state.cycleCount + 1;
        const newSuccessRate =
          (state.successRate * state.cycleCount + (success ? 1 : 0)) / newCycleCount;

        const newState: ReasonerActorV2State = {
          cycleCount: newCycleCount,
          totalTokensUsed: state.totalTokensUsed + realTokens,
          lastActionName: toolName,
          lastToolInput: serializeInput(toolInput),
          successRate: newSuccessRate,
          recentActions: updatedRecentActions,
        };

        // 13. Build monitoring signal
        const monitoring: ReasonerActorV2Monitoring = {
          type: 'reasoner-actor',
          source: id,
          timestamp: Date.now(),
          actionTaken: toolName,
          success,
          unexpectedResult,
          tokensThisStep: realTokens,
          confidence,
          declaredPlanAction,
          ...(impasse ? { impasse } : {}),
        };

        return {
          output: { plan, reasoning, actionName: toolName, toolResult, tokensUsed: realTokens },
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

        const monitoring: ReasonerActorV2Monitoring = {
          type: 'reasoner-actor',
          source: id,
          timestamp: Date.now(),
          actionTaken: state.lastActionName ?? 'unknown',
          success: false,
          unexpectedResult: true,
          tokensThisStep: 0,
          confidence: 0,
          declaredPlanAction: 'unknown',
        };

        return {
          output: { plan: '', reasoning: '', actionName: 'error', toolResult: null, tokensUsed: 0 },
          state,
          monitoring,
          error,
        };
      }
    },
  };
}
