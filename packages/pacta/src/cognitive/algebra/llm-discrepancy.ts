/**
 * LLM Discrepancy Function — frontier-model goal-state comparison.
 *
 * Uses a ProviderAdapter to ask an LLM to assess goal-state discrepancy.
 * The LLM reads the goal, workspace state, and cycle context, then returns
 * a structured assessment (discrepancy, confidence, satisfied, reasoning).
 *
 * This is the frontier validation step before SLM compilation (RFC 002 pattern):
 * prove the capability with a full model, then distill to a small one.
 *
 * Falls back to rule-based heuristic (discrepancy-function.ts) on parse error.
 *
 * @see docs/rfcs/004-goal-state-monitoring.md — §Discrepancy Computation
 * @see docs/prds/045-goal-state-monitoring.md — Wave 3+
 */

import type { ReadonlyWorkspaceSnapshot } from './workspace-types.js';
import type { GoalRepresentation, GoalDiscrepancy } from './goal-types.js';
import type { ModuleId } from './module.js';
import type { ProviderAdapter, AdapterConfig } from './provider-adapter.js';

// ── Prompt Construction ───────────────────────────────────────

function buildDiscrepancyPrompt(
  goal: GoalRepresentation,
  workspace: ReadonlyWorkspaceSnapshot,
  cycleNumber: number,
  maxCycles: number,
  previousDiscrepancy?: number,
): string {
  const constraintBlock = goal.constraints.length > 0
    ? `\nCONSTRAINTS:\n${goal.constraints.map((c, i) => `  ${i + 1}. ${c}`).join('\n')}`
    : '';

  const subgoalBlock = goal.subgoals.length > 0
    ? `\nSUBGOALS:\n${goal.subgoals.map((s, i) => `  ${i + 1}. [${s.satisfied ? 'DONE' : 'PENDING'}] ${s.description}${s.evidence ? ` — ${s.evidence}` : ''}`).join('\n')}`
    : '';

  // Summarize workspace: last N entries, focus on actions and results
  const wsEntries = workspace.slice(-20).map(e => {
    const content = typeof e.content === 'string' ? e.content : JSON.stringify(e.content);
    return content.slice(0, 300);
  });
  const workspaceBlock = wsEntries.length > 0
    ? wsEntries.join('\n---\n')
    : '(empty — no actions taken yet)';

  const prevBlock = previousDiscrepancy !== undefined
    ? `\nPrevious discrepancy: ${previousDiscrepancy.toFixed(3)}`
    : '';

  return `You are a goal-state evaluator for a coding agent. Assess how close the agent is to completing its task.

GOAL: ${goal.objective}${constraintBlock}${subgoalBlock}

CYCLE: ${cycleNumber} of ${maxCycles}${prevBlock}

WORKSPACE STATE (recent actions and results):
${workspaceBlock}

Assess the agent's progress. Consider:
- Has the agent created or modified the required files?
- Does the work match what the goal asks for?
- Are constraints satisfied or violated?
- Is the agent making progress or stuck in a loop?

Respond in EXACTLY this format (no other text):
<assessment>
<discrepancy>0.XX</discrepancy>
<confidence>0.XX</confidence>
<satisfied>true or false</satisfied>
<summary>One sentence: what's done and what's missing</summary>
</assessment>

Where:
- discrepancy: 0.0 = goal fully satisfied, 1.0 = no progress at all
- confidence: 0.0 = uncertain, 1.0 = very sure about this assessment
- satisfied: true if the goal appears to be met`;
}

// ── Response Parsing ──────────────────────────────────────────

interface LLMDiscrepancyResult {
  discrepancy: number;
  confidence: number;
  satisfied: boolean;
  summary: string;
}

function parseDiscrepancyResponse(text: string): LLMDiscrepancyResult | null {
  const assessmentMatch = text.match(/<assessment>([\s\S]*?)<\/assessment>/);
  if (!assessmentMatch) return null;

  const block = assessmentMatch[1];

  const discrepancyMatch = block.match(/<discrepancy>\s*(-?[\d.]+)\s*<\/discrepancy>/);
  const confidenceMatch = block.match(/<confidence>\s*(-?[\d.]+)\s*<\/confidence>/);
  const satisfiedMatch = block.match(/<satisfied>\s*(true|false)\s*<\/satisfied>/);
  const summaryMatch = block.match(/<summary>\s*([\s\S]*?)\s*<\/summary>/);

  if (!discrepancyMatch || !confidenceMatch || !satisfiedMatch) return null;

  const discrepancy = parseFloat(discrepancyMatch[1]);
  const confidence = parseFloat(confidenceMatch[1]);

  if (isNaN(discrepancy) || isNaN(confidence)) return null;

  return {
    discrepancy: Math.max(0, Math.min(1, discrepancy)),
    confidence: Math.max(0, Math.min(1, confidence)),
    satisfied: satisfiedMatch[1] === 'true',
    summary: summaryMatch?.[1]?.trim() ?? '',
  };
}

// ── Main Function ─────────────────────────────────────────────

/**
 * Build a GoalDiscrepancy using LLM assessment.
 *
 * Sends the goal, workspace state, and cycle context to the LLM via
 * ProviderAdapter. Returns a GoalDiscrepancy with LLM-derived scores.
 *
 * @returns GoalDiscrepancy on success, null on parse failure (caller should fallback)
 */
export async function buildLLMGoalDiscrepancy(
  provider: ProviderAdapter,
  workspace: ReadonlyWorkspaceSnapshot,
  goal: GoalRepresentation,
  cycleNumber: number,
  maxCycles: number,
  previousDiscrepancy: number | undefined,
  source: ModuleId,
): Promise<{ discrepancy: GoalDiscrepancy; tokensUsed: number } | null> {
  const prompt = buildDiscrepancyPrompt(goal, workspace, cycleNumber, maxCycles, previousDiscrepancy);

  // Wrap prompt as a single-entry workspace snapshot for the adapter
  const promptSnapshot: ReadonlyWorkspaceSnapshot = [{
    source,
    content: prompt,
    salience: 1.0,
    timestamp: Date.now(),
  }];

  const adapterConfig: AdapterConfig = {
    pactTemplate: {
      mode: { type: 'oneshot' },
      budget: { maxOutputTokens: 256 },
    },
    systemPrompt: 'You are a precise goal-state evaluator. Respond only with the requested XML format.',
    timeoutMs: 15_000,
  };

  try {
    const result = await provider.invoke(promptSnapshot, adapterConfig);
    const parsed = parseDiscrepancyResponse(result.output);

    if (!parsed) return null;

    const rate = previousDiscrepancy !== undefined
      ? previousDiscrepancy - parsed.discrepancy  // positive = improving
      : 0;

    const discrepancy: GoalDiscrepancy = {
      type: 'goal-discrepancy',
      source,
      timestamp: Date.now(),
      discrepancy: parsed.discrepancy,
      rate,
      confidence: parsed.confidence,
      satisfied: parsed.satisfied,
      basis: `llm-assessment: ${parsed.summary}`,
    };

    return { discrepancy, tokensUsed: result.usage.totalTokens };
  } catch {
    return null;
  }
}

// Exported for testing
export { buildDiscrepancyPrompt as _buildDiscrepancyPrompt };
export { parseDiscrepancyResponse as _parseDiscrepancyResponse };
