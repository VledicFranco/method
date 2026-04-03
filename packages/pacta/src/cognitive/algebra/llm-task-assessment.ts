/**
 * LLM Task Assessment — pre-task difficulty estimation and phase planning.
 *
 * RFC 005: Anticipatory Monitoring. Runs at cycle 0 to produce a TaskAssessment
 * that parameterizes the Evaluator's metamonitor. Implements Koriat's
 * Ease-of-Learning judgment: estimate difficulty, decompose into phases,
 * set solvability prior and KPIs.
 *
 * @see docs/rfcs/005-anticipatory-monitoring.md
 */

import type { GoalRepresentation, TaskAssessment, TaskPhase } from './goal-types.js';
import type { ModuleId } from './module.js';
import type { ProviderAdapter, AdapterConfig } from './provider-adapter.js';

// ── Prompt ────────────────────────────────────────────────────

function buildAssessmentPrompt(goal: GoalRepresentation, maxCycles: number): string {
  const constraintBlock = goal.constraints.length > 0
    ? `\nCONSTRAINTS:\n${goal.constraints.map((c, i) => `  ${i + 1}. ${c}`).join('\n')}`
    : '';

  return `You are a task difficulty estimator for a coding agent. The agent will work in cycles (read files, write code, etc). Assess this task before execution begins.

TASK: ${goal.objective}${constraintBlock}

BUDGET: ${maxCycles} cycles available

Assess the task. Consider:
- How many files need to be read to understand the problem?
- How many files need to be created or modified?
- Is the task straightforward or does it require careful reasoning?
- What phases will the agent go through (explore, plan, execute, verify)?

Respond in EXACTLY this format:
<assessment>
<difficulty>low, medium, or high</difficulty>
<estimated_cycles>N</estimated_cycles>
<solvability>0.XX</solvability>
<phases>
<phase name="explore" start="1" end="N">reading files to understand the problem</phase>
<phase name="plan" start="N" end="N">deciding on approach</phase>
<phase name="execute" start="N" end="N">creating and modifying files</phase>
<phase name="verify" start="N" end="N">checking work</phase>
</phases>
<kpis>
<kpi>specific observable indicator 1</kpi>
<kpi>specific observable indicator 2</kpi>
</kpis>
</assessment>

Where:
- difficulty: low (1-3 files, simple changes), medium (3-5 files, some reasoning), high (5+ files, complex reasoning)
- estimated_cycles: realistic estimate of cycles needed (within the budget)
- solvability: 0.0-1.0, how likely the agent can solve this within the budget
- phases: expected execution phases with cycle ranges (cycles start at 1)
- kpis: 2-4 specific things to check for progress (e.g., "config.ts file created")`;
}

// ── Parsing ───────────────────────────────────────────────────

function parseAssessmentResponse(text: string, maxCycles: number): TaskAssessment | null {
  const match = text.match(/<assessment>([\s\S]*?)<\/assessment>/);
  if (!match) return null;

  const block = match[1];

  const difficultyMatch = block.match(/<difficulty>\s*(low|medium|high)\s*<\/difficulty>/);
  const cyclesMatch = block.match(/<estimated_cycles>\s*(\d+)\s*<\/estimated_cycles>/);
  const solvabilityMatch = block.match(/<solvability>\s*([\d.]+)\s*<\/solvability>/);

  if (!difficultyMatch || !cyclesMatch || !solvabilityMatch) return null;

  const difficulty = difficultyMatch[1] as 'low' | 'medium' | 'high';
  const estimatedCycles = Math.min(parseInt(cyclesMatch[1], 10), maxCycles);
  const solvabilityPrior = Math.max(0, Math.min(1, parseFloat(solvabilityMatch[1])));

  if (isNaN(estimatedCycles) || isNaN(solvabilityPrior)) return null;

  // Parse phases
  const phases: TaskPhase[] = [];
  const phaseRegex = /<phase\s+name="([^"]+)"\s+start="(\d+)"\s+end="(\d+)">(.*?)<\/phase>/g;
  let phaseMatch: RegExpExecArray | null;
  while ((phaseMatch = phaseRegex.exec(block)) !== null) {
    phases.push({
      name: phaseMatch[1],
      expectedCycles: [parseInt(phaseMatch[2], 10), parseInt(phaseMatch[3], 10)],
      progressIndicator: phaseMatch[4].trim(),
    });
  }

  // Parse KPIs
  const kpis: string[] = [];
  const kpiRegex = /<kpi>(.*?)<\/kpi>/g;
  let kpiMatch: RegExpExecArray | null;
  while ((kpiMatch = kpiRegex.exec(block)) !== null) {
    kpis.push(kpiMatch[1].trim());
  }

  // Fallback phases if none parsed
  if (phases.length === 0) {
    const mid = Math.ceil(estimatedCycles * 0.4);
    const execEnd = Math.ceil(estimatedCycles * 0.85);
    phases.push(
      { name: 'explore', expectedCycles: [1, mid], progressIndicator: 'reading and understanding code' },
      { name: 'execute', expectedCycles: [mid + 1, execEnd], progressIndicator: 'creating and modifying files' },
      { name: 'verify', expectedCycles: [execEnd + 1, estimatedCycles], progressIndicator: 'checking results' },
    );
  }

  return { difficulty, phases, solvabilityPrior, kpis, estimatedCycles };
}

// ── Main Function ─────────────────────────────────────────────

/**
 * Produce a TaskAssessment via LLM at cycle 0.
 *
 * @returns TaskAssessment on success, default assessment on failure.
 */
export async function assessTaskWithLLM(
  provider: ProviderAdapter,
  goal: GoalRepresentation,
  maxCycles: number,
  source: ModuleId,
): Promise<{ assessment: TaskAssessment; tokensUsed: number }> {
  const prompt = buildAssessmentPrompt(goal, maxCycles);

  const promptSnapshot = [{
    source,
    content: prompt,
    salience: 1.0,
    timestamp: Date.now(),
  }];

  const adapterConfig: AdapterConfig = {
    pactTemplate: {
      mode: { type: 'oneshot' },
      budget: { maxOutputTokens: 512 },
    },
    systemPrompt: 'You are a precise task assessor. Respond only with the requested XML format.',
    timeoutMs: 20_000,
  };

  try {
    const result = await provider.invoke(promptSnapshot, adapterConfig);
    const parsed = parseAssessmentResponse(result.output, maxCycles);

    if (parsed) {
      return { assessment: parsed, tokensUsed: result.usage.totalTokens };
    }
  } catch {
    // Fall through to default
  }

  // Default assessment when LLM fails
  return {
    assessment: defaultAssessment(maxCycles),
    tokensUsed: 0,
  };
}

/** Conservative default when LLM assessment fails. */
export function defaultAssessment(maxCycles: number): TaskAssessment {
  const mid = Math.ceil(maxCycles * 0.4);
  const execEnd = Math.ceil(maxCycles * 0.85);
  return {
    difficulty: 'medium',
    phases: [
      { name: 'explore', expectedCycles: [1, mid], progressIndicator: 'reading files' },
      { name: 'execute', expectedCycles: [mid + 1, execEnd], progressIndicator: 'writing code' },
      { name: 'verify', expectedCycles: [execEnd + 1, maxCycles], progressIndicator: 'checking work' },
    ],
    solvabilityPrior: 0.70,
    kpis: [],
    estimatedCycles: maxCycles,
  };
}

// Exported for testing
export { buildAssessmentPrompt as _buildAssessmentPrompt };
export { parseAssessmentResponse as _parseAssessmentResponse };
