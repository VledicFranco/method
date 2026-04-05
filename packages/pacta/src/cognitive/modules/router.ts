/**
 * Router — meta-cognitive module for task-aware architecture selection.
 *
 * Runs once at cycle -1 (pre-execution) to decide whether this task benefits
 * from the full cognitive architecture (unified-memory with Planner, Verifier,
 * etc.) or should run with the flat baseline.
 *
 * ## Cognitive Science Grounding
 *
 * **Primary analog: dorsolateral Prefrontal Cortex (dlPFC) strategy selection.**
 *
 * - **Shenhav et al. (2013) — Expected Value of Control (EVC):** The dlPFC
 *   allocates cognitive effort based on expected benefit vs cost. Deliberate
 *   (System 2) processing is engaged only when expected benefit exceeds cost.
 *   Our Router implements EVC at the architecture level: engage cognitive
 *   modules only when their expected benefit exceeds their overhead.
 *
 * - **Botvinick & Cohen (2014) — Cognitive control as cost-benefit optimization:**
 *   Control allocation is a decision problem, not a fixed policy. The same agent
 *   uses different amounts of cognitive control for different tasks based on
 *   their structural demands.
 *
 * **Empirical basis (R-28/R-29 N=5):**
 * - Structural/multi-file tasks (T01, T03): cognitive +20pp over flat
 * - Direct single-file tasks (T02, T04): cognitive -80pp (hurts)
 * - Running cognitive unconditionally pays overhead where it's counter-productive
 *
 * **What this module captures:**
 * - Rule-based feature extraction from task description (zero LLM cost)
 * - Optional LLM refinement of difficulty estimate
 * - Decision rules grounded in empirical per-task architecture performance
 * - Graceful fallback to flat on LLM error (cheaper, safer default)
 *
 * **References:**
 * - Shenhav, A., Botvinick, M. M., & Cohen, J. D. (2013). The expected value of
 *   control. Neuron, 79(2), 217-240.
 * - Botvinick, M., & Cohen, J. D. (2014). The computational and neural basis of
 *   cognitive control. Cognitive Science, 38(6), 1249-1285.
 *
 * @see docs/prds/050-meta-cognitive-router.md
 */

import type {
  CognitiveModule,
  RouterMonitoring,
  ControlDirective,
  StepResult,
  ModuleId,
  ProviderAdapter,
  AdapterConfig,
  GoalRepresentation,
  TaskFeatures,
  RoutingDecision,
  ArchitectureKind,
} from '../algebra/index.js';
import { moduleId } from '../algebra/index.js';

// ── Types ──────────────────────────────────────────────────────────

export interface RouterInput {
  /** Goal representation from task. */
  goal: GoalRepresentation;
  /** Raw task description for feature extraction. */
  taskDescription: string;
}

export interface RouterOutput {
  decision: RoutingDecision;
}

export interface RouterState {
  /** Cached decision — router is called once per task typically. */
  lastDecision: RoutingDecision | null;
}

export interface RouterControl extends ControlDirective {
  /** When set, forces re-evaluation even if cached. */
  forceReroute?: boolean;
}

export interface RouterConfig {
  /** Module ID override. Default: 'router'. */
  id?: string;
  /** Provider for LLM-based difficulty refinement (optional). */
  provider?: ProviderAdapter;
  /** When true, skip LLM refinement and use rule-based only. Default: false. */
  ruleBasedOnly?: boolean;
}

// ── Feature Extraction (rule-based, zero LLM cost) ────────────

/**
 * Extract TaskFeatures from goal + description using heuristic rules.
 */
export function extractFeatures(
  goal: GoalRepresentation,
  taskDescription: string,
): TaskFeatures {
  const text = `${goal.objective}\n${taskDescription}`.toLowerCase();

  // File count: match paths like src/foo.ts, src/bar.js, tests/baz.ts
  const filePaths = text.match(/[\w-]+\/[\w/.-]+\.(ts|js|tsx|jsx|json|yaml|yml)/g) ?? [];
  const uniquePaths = new Set(filePaths);
  const isMultiFile = uniquePaths.size >= 3;

  // Structural keywords: imports, dependencies, classes, extract, refactor
  const structuralKeywords = [
    'circular', 'dependency', 'import', 'extract', 'refactor', 'restructure',
    'module', 'class hierarchy', 'inheritance', 'decouple', 'barrel',
  ];
  const isStructural = structuralKeywords.some(kw => text.includes(kw));

  // Implicit constraint signals
  const constraintKeywords = [
    'preserve', 'must not', 'do not', 'never', 'avoid', 'cannot', "don't",
    'no side effect', 'without breaking', 'keep', 'maintain',
  ];
  const hasImplicitConstraints = constraintKeywords.some(kw => text.includes(kw));

  // Single-file edit signals: "fix the bug", "update the function", specific file mention
  const editKeywords = ['fix the bug', 'fix the', 'update the', 'change the', 'modify the'];
  const hasEditKeyword = editKeywords.some(kw => text.includes(kw));
  const isSingleFileEdit = hasEditKeyword && uniquePaths.size <= 2 && !isMultiFile;

  // Goal count: count sentences starting with verbs or numbered items
  const goalSentences = text.split(/[.!?\n]/).filter(s => s.trim().length > 10);
  const actionVerbs = /\b(fix|update|create|add|remove|ensure|make|write|implement|extract|refactor)\b/i;
  const goalCount = goalSentences.filter(s => actionVerbs.test(s)).length;

  // Estimated difficulty (rule-based initial estimate)
  let estimatedDifficulty: TaskFeatures['estimatedDifficulty'] = 'moderate';
  if (uniquePaths.size >= 5 || (isStructural && isMultiFile)) {
    estimatedDifficulty = 'complex';
  } else if (isSingleFileEdit && !isStructural) {
    estimatedDifficulty = 'simple';
  } else if (goalCount <= 1 && uniquePaths.size <= 1) {
    estimatedDifficulty = 'trivial';
  }

  return {
    isMultiFile,
    isStructural,
    hasImplicitConstraints,
    isSingleFileEdit,
    goalCount,
    estimatedDifficulty,
  };
}

// ── Decision Logic (pure function over features) ──────────────

/**
 * Apply routing rules to features. Returns selected architecture + confidence.
 *
 * Rules (empirical from R-28/R-29):
 *   - Multi-file AND structural → unified-memory (T01, T06 pattern)
 *   - Implicit constraints AND complex → unified-memory (T03 pattern)
 *   - Single-file edit → flat (T02 pattern)
 *   - Trivial → flat (T05 pattern)
 *   - Default → flat (cheaper, don't engage cognitive unless confident)
 */
export function decide(features: TaskFeatures): { architecture: ArchitectureKind; confidence: number; rationale: string } {
  // Strongest signal: multi-file structural work
  if (features.isMultiFile && features.isStructural) {
    return {
      architecture: 'unified-memory',
      confidence: 0.9,
      rationale: 'multi-file structural task — cognitive stack provides decomposition and verification',
    };
  }

  // Complex constraints benefit from phase-aware evaluation
  if (features.hasImplicitConstraints && features.estimatedDifficulty === 'complex') {
    return {
      architecture: 'unified-memory',
      confidence: 0.8,
      rationale: 'complex task with implicit constraints — cognitive helps track requirements',
    };
  }

  // Multi-file non-structural may benefit (T03 config migration)
  if (features.isMultiFile && features.hasImplicitConstraints) {
    return {
      architecture: 'unified-memory',
      confidence: 0.7,
      rationale: 'multi-file task with constraints — cognitive coordination likely helps',
    };
  }

  // Clear single-file edits: flat is better (T02, T04 pattern)
  if (features.isSingleFileEdit) {
    return {
      architecture: 'flat',
      confidence: 0.85,
      rationale: 'single-file edit — direct execution beats cognitive overhead',
    };
  }

  // Trivial tasks: flat is sufficient
  if (features.estimatedDifficulty === 'trivial') {
    return {
      architecture: 'flat',
      confidence: 0.9,
      rationale: 'trivial task — no cognitive support needed',
    };
  }

  // Default: flat (cheaper, don't engage cognitive without strong signal)
  return {
    architecture: 'flat',
    confidence: 0.6,
    rationale: 'no strong structural signal — defaulting to flat',
  };
}

// ── LLM Refinement (optional) ─────────────────────────────────

const REFINEMENT_SYSTEM_PROMPT =
  `You are a task classifier for a coding agent. Given a task, estimate its difficulty.
Respond ONLY with a <difficulty> tag containing one of: trivial, simple, moderate, complex.`;

function buildRefinementPrompt(goal: GoalRepresentation, features: TaskFeatures): string {
  return `TASK: ${goal.objective}

Rule-based features:
- Multi-file: ${features.isMultiFile}
- Structural: ${features.isStructural}
- Has constraints: ${features.hasImplicitConstraints}
- Goal count: ${features.goalCount}
- Rule-based estimate: ${features.estimatedDifficulty}

Based on the task, respond with:
<difficulty>trivial|simple|moderate|complex</difficulty>`;
}

function parseDifficulty(text: string): TaskFeatures['estimatedDifficulty'] | null {
  const match = text.match(/<difficulty>\s*(trivial|simple|moderate|complex)\s*<\/difficulty>/);
  return match ? (match[1] as TaskFeatures['estimatedDifficulty']) : null;
}

async function refineWithLLM(
  provider: ProviderAdapter,
  goal: GoalRepresentation,
  features: TaskFeatures,
  plannerId: ModuleId,
): Promise<{ difficulty: TaskFeatures['estimatedDifficulty']; tokensUsed: number } | null> {
  try {
    const prompt = buildRefinementPrompt(goal, features);
    const promptSnapshot = [{
      source: plannerId,
      content: prompt,
      salience: 1.0,
      timestamp: Date.now(),
    }];
    const adapterConfig: AdapterConfig = {
      pactTemplate: { mode: { type: 'oneshot' }, budget: { maxOutputTokens: 64 } },
      systemPrompt: REFINEMENT_SYSTEM_PROMPT,
      timeoutMs: 10_000,
    };
    const result = await provider.invoke(promptSnapshot, adapterConfig);
    const difficulty = parseDifficulty(result.output);
    if (!difficulty) return null;
    return { difficulty, tokensUsed: result.usage.totalTokens };
  } catch {
    return null;
  }
}

// ── Factory ────────────────────────────────────────────────────

export function createRouter(
  config?: RouterConfig,
): CognitiveModule<RouterInput, RouterOutput, RouterState, RouterMonitoring, RouterControl> {
  const id = moduleId(config?.id ?? 'router');
  const provider = config?.provider;
  const ruleBasedOnly = config?.ruleBasedOnly ?? false;

  return {
    id,

    initialState(): RouterState {
      return { lastDecision: null };
    },

    async step(
      input: RouterInput,
      state: RouterState,
      control: RouterControl,
    ): Promise<StepResult<RouterOutput, RouterState, RouterMonitoring>> {
      // Return cached decision unless forced
      if (state.lastDecision && !control.forceReroute) {
        return {
          output: { decision: state.lastDecision },
          state,
          monitoring: {
            type: 'router',
            source: id,
            timestamp: Date.now(),
            architectureSelected: state.lastDecision.architecture,
            confidence: state.lastDecision.confidence,
          },
        };
      }

      // 1. Extract features (rule-based, always runs)
      let features = extractFeatures(input.goal, input.taskDescription);
      let tokensUsed = 0;

      // 2. Optional LLM refinement of difficulty estimate
      if (!ruleBasedOnly && provider) {
        const refined = await refineWithLLM(provider, input.goal, features, id);
        if (refined) {
          features = { ...features, estimatedDifficulty: refined.difficulty };
          tokensUsed += refined.tokensUsed;
        }
      }

      // 3. Apply decision rules
      const { architecture, confidence, rationale } = decide(features);

      const decision: RoutingDecision = {
        architecture,
        features,
        confidence,
        rationale,
        tokensUsed,
      };

      return {
        output: { decision },
        state: { lastDecision: decision },
        monitoring: {
          type: 'router',
          source: id,
          timestamp: Date.now(),
          architectureSelected: architecture,
          confidence,
        },
      };
    },

    stateInvariant(_state: RouterState): boolean {
      return true;
    },
  };
}
