/**
 * Composable strategy configurations for cognitive agent experiments.
 *
 * Each dimension (workspace, monitor, prompt) can be independently varied
 * to test different permutations. Pre-defined CognitiveConfig bundles combine
 * one strategy from each dimension into a named experiment variant.
 *
 * Design rationale:
 *   - Workspace strategies control how much context the agent retains and what
 *     happens when entries are evicted (discard, summarize, fold into tiers).
 *   - Monitor strategies control stagnation detection behavior and the intervention
 *     schedule (constrain, reframe, expand, or multi-phase escalation).
 *   - Prompt strategies control the output format the LLM is asked to produce,
 *     including section ordering, required elements, and anchoring aids.
 *
 * See run.ts (Condition C) for how these configs wire into the cognitive cycle.
 */

// ── Workspace Strategy ──────────────────────────────────────────

export interface WorkspaceStrategy {
  name: string;
  capacity: number;
  /** Called when an entry would be evicted. Returns a summary string or null to discard. */
  onEvict?: (entry: { content: string | unknown; source: string }) => string | null;
}

/**
 * Workspace strategy variants.
 *
 * - 'evict':     Current behavior. Capacity 8, lowest-salience eviction, no summary.
 * - 'summary':   Capacity 8, evicted entries produce a 1-line summary that can be
 *                re-injected as a condensed workspace entry.
 * - 'two-tier':  Capacity 5 active slots. Evicted entries are folded into summaries
 *                that render in context but don't count against active capacity.
 * - 'chunked-4': Capacity 4, aggressive summarization on eviction. Tests whether a
 *                very tight workspace forces better prioritization.
 */
export const WORKSPACE_STRATEGIES: Record<string, WorkspaceStrategy> = {
  'evict': {
    name: 'evict',
    capacity: 8,
    // No onEvict — entries are silently discarded (current behavior).
  },

  'summary': {
    name: 'summary',
    capacity: 8,
    onEvict: (entry) => {
      const text = typeof entry.content === 'string'
        ? entry.content
        : JSON.stringify(entry.content);
      // Produce a 1-line summary: source tag + first 120 chars, trimmed to sentence boundary.
      const trimmed = text.slice(0, 120).replace(/\s+/g, ' ').trim();
      const sentenceEnd = trimmed.lastIndexOf('.');
      const summary = sentenceEnd > 40 ? trimmed.slice(0, sentenceEnd + 1) : trimmed;
      return `[evicted:${entry.source}] ${summary}`;
    },
  },

  'two-tier': {
    name: 'two-tier',
    capacity: 5,
    onEvict: (entry) => {
      const text = typeof entry.content === 'string'
        ? entry.content
        : JSON.stringify(entry.content);
      // Fold into a condensed summary for the passive tier.
      const trimmed = text.slice(0, 80).replace(/\s+/g, ' ').trim();
      return `[folded:${entry.source}] ${trimmed}`;
    },
  },

  'chunked-4': {
    name: 'chunked-4',
    capacity: 4,
    onEvict: (entry) => {
      const text = typeof entry.content === 'string'
        ? entry.content
        : JSON.stringify(entry.content);
      // Aggressive: keep only the first 60 chars as a breadcrumb.
      const breadcrumb = text.slice(0, 60).replace(/\s+/g, ' ').trim();
      return `[chunk:${entry.source}] ${breadcrumb}`;
    },
  },
};

// ── Monitor Strategy ────────────────────────────────────────────

export interface MonitorStrategy {
  name: string;
  stagnationThreshold: number;
  /** What to do when stagnation is detected */
  onStagnation: 'constrain' | 'reframe' | 'expand' | 'nudge-reframe-reset';
  /** Max interventions before monitor goes silent */
  interventionBudget: number;
  /** Whether to track action utility scores */
  trackUtility: boolean;
}

/**
 * Monitor strategy variants.
 *
 * - 'constrain-force': Current behavior. Constrain stagnating action at 2 consecutive
 *                      read-only cycles, force replan at 3. Unlimited interventions.
 * - 'reframe':         Inject a reframe prompt at stagnation instead of restricting
 *                      actions. No action blocking. Unlimited budget. Tests whether
 *                      reframing alone is enough to break loops.
 * - 'expand':          Suggest search-space expansion at stagnation (e.g. "consider
 *                      files outside the current directory"). No action restrictions.
 *                      Unlimited budget. Tests divergent exploration.
 * - 'budgeted-reframe': Reframe strategy with a hard budget of 3 interventions. After
 *                        the budget is exhausted, the monitor goes silent. Tests whether
 *                        limited reframes prevent intervention fatigue.
 * - 'full':            Reframe + utility tracking + budget of 3. The most instrumented
 *                      variant — tracks per-action utility scores and caps interventions.
 */
export const MONITOR_STRATEGIES: Record<string, MonitorStrategy> = {
  'constrain-force': {
    name: 'constrain-force',
    stagnationThreshold: 2,
    onStagnation: 'constrain',
    interventionBudget: Infinity,
    trackUtility: false,
  },

  'reframe': {
    name: 'reframe',
    stagnationThreshold: 3,
    onStagnation: 'reframe',
    interventionBudget: Infinity,
    trackUtility: false,
  },

  'expand': {
    name: 'expand',
    stagnationThreshold: 3,
    onStagnation: 'expand',
    interventionBudget: Infinity,
    trackUtility: false,
  },

  'budgeted-reframe': {
    name: 'budgeted-reframe',
    stagnationThreshold: 3,
    onStagnation: 'reframe',
    interventionBudget: 3,
    trackUtility: false,
  },

  'full': {
    name: 'full',
    stagnationThreshold: 3,
    onStagnation: 'nudge-reframe-reset',
    interventionBudget: 3,
    trackUtility: true,
  },

  'hybrid': {
    name: 'hybrid',
    stagnationThreshold: 2,
    onStagnation: 'constrain',  // start with constrain-force
    interventionBudget: 5,      // after 3 constrain interventions, switch to reframe
    trackUtility: true,
  },

  // R-15 threshold ablation variants — same constrain-force strategy, different thresholds
  'constrain-force-t3': {
    name: 'constrain-force-t3',
    stagnationThreshold: 3,
    onStagnation: 'constrain',
    interventionBudget: Infinity,
    trackUtility: false,
  },

  'constrain-force-t4': {
    name: 'constrain-force-t4',
    stagnationThreshold: 4,
    onStagnation: 'constrain',
    interventionBudget: Infinity,
    trackUtility: false,
  },
};

// ── Prompt Strategy ─────────────────────────────────────────────

export interface PromptStrategy {
  name: string;
  /** Output section ordering */
  sectionOrder: string[];
  /** Whether plan section is required every cycle */
  planRequired: boolean;
  /** Whether to include a <critique> section */
  includeCritique: boolean;
  /** Whether to include a pre-delete verification requirement */
  preDeleteChecklist: boolean;
  /** Whether to pin task description at top of workspace each cycle */
  taskAnchor: boolean;
  /** Whether to show cycle budget (e.g. [Cycle 7/15]) */
  showCycleBudget: boolean;
  /** Whether to include completion checklist */
  completionChecklist: boolean;
  /** Problem state declaration required */
  problemStateRequired: boolean;
}

/**
 * Prompt strategy variants.
 *
 * - 'baseline':      Current format. plan/reasoning/action ordering. Plan required.
 *                    No extras. Matches the FORMAT_INSTRUCTION in reasoner-actor.ts.
 * - 'action-first':  Inverted ordering: action/rationale. Plan is optional. No critique.
 *                    Tests whether leading with the action reduces overthinking.
 * - 'anchored':      Baseline + task anchor + cycle budget + completion checklist +
 *                    pre-delete checklist. Adds structural scaffolding to reduce drift.
 * - 'full':          Action-first base + critique section + task anchor + cycle budget +
 *                    completion checklist + pre-delete checklist + problem state.
 *                    Maximum structure — tests whether heavy scaffolding helps or hurts.
 */
export const PROMPT_STRATEGIES: Record<string, PromptStrategy> = {
  'baseline': {
    name: 'baseline',
    sectionOrder: ['plan', 'reasoning', 'action'],
    planRequired: true,
    includeCritique: false,
    preDeleteChecklist: false,
    taskAnchor: false,
    showCycleBudget: false,
    completionChecklist: false,
    problemStateRequired: false,
  },

  'action-first': {
    name: 'action-first',
    sectionOrder: ['action', 'rationale'],
    planRequired: false,
    includeCritique: false,
    preDeleteChecklist: false,
    taskAnchor: false,
    showCycleBudget: false,
    completionChecklist: false,
    problemStateRequired: false,
  },

  'anchored': {
    name: 'anchored',
    sectionOrder: ['plan', 'reasoning', 'action'],
    planRequired: true,
    includeCritique: false,
    preDeleteChecklist: true,
    taskAnchor: true,
    showCycleBudget: true,
    completionChecklist: true,
    problemStateRequired: false,
  },

  'full': {
    name: 'full',
    sectionOrder: ['action', 'rationale', 'critique'],
    planRequired: false,
    includeCritique: true,
    preDeleteChecklist: true,
    taskAnchor: true,
    showCycleBudget: true,
    completionChecklist: true,
    problemStateRequired: true,
  },
};

// ── Experiment Configuration ────────────────────────────────────

export interface CognitiveConfig {
  name: string;
  workspace: WorkspaceStrategy;
  monitor: MonitorStrategy;
  prompt: PromptStrategy;
}

/**
 * Pre-defined experiment configurations.
 *
 * - 'baseline':    Current architecture. Evict workspace + constrain-force monitor +
 *                  baseline prompt. The control condition — matches run.ts Condition C.
 *
 * - 'v2-minimal':  Summary workspace + reframe monitor + anchored prompt. Wave 1 changes
 *                  only: better eviction handling, softer stagnation response, structural
 *                  prompt aids. Minimal divergence from baseline.
 *
 * - 'v2-full':     Two-tier workspace + budgeted-reframe monitor + full prompt. All
 *                  improvements active. Tests whether maximum structure helps complex tasks.
 *
 * - 'v2-vex':      Summary workspace + constrain-force monitor + action-first prompt.
 *                  Pragmatic: keeps hard enforcement but leads with action to reduce latency.
 *                  Named for a "get it done" disposition — act first, explain later.
 *
 * - 'v2-thane':    Chunked-4 workspace + full monitor (budgeted reframe + utility tracking)
 *                  + anchored prompt. Tight workspace forces aggressive prioritization;
 *                  utility tracking provides data on which actions actually move the needle.
 *                  Named for a "measure everything" disposition.
 */
export const CONFIGS: Record<string, CognitiveConfig> = {
  'baseline': {
    name: 'baseline',
    workspace: WORKSPACE_STRATEGIES['evict'],
    monitor: MONITOR_STRATEGIES['constrain-force'],
    prompt: PROMPT_STRATEGIES['baseline'],
  },

  'v2-minimal': {
    name: 'v2-minimal',
    workspace: WORKSPACE_STRATEGIES['summary'],
    monitor: MONITOR_STRATEGIES['reframe'],
    prompt: PROMPT_STRATEGIES['anchored'],
  },

  'v2-full': {
    name: 'v2-full',
    workspace: WORKSPACE_STRATEGIES['two-tier'],
    monitor: MONITOR_STRATEGIES['budgeted-reframe'],
    prompt: PROMPT_STRATEGIES['full'],
  },

  'v2-vex': {
    name: 'v2-vex',
    workspace: WORKSPACE_STRATEGIES['summary'],
    monitor: MONITOR_STRATEGIES['constrain-force'],
    prompt: PROMPT_STRATEGIES['action-first'],
  },

  'v2-thane': {
    name: 'v2-thane',
    workspace: WORKSPACE_STRATEGIES['chunked-4'],
    monitor: MONITOR_STRATEGIES['full'],
    prompt: PROMPT_STRATEGIES['anchored'],
  },

  'v3-hybrid': {
    name: 'v3-hybrid',
    workspace: WORKSPACE_STRATEGIES['summary'],
    monitor: MONITOR_STRATEGIES['hybrid'],
    prompt: PROMPT_STRATEGIES['anchored'],
  },

  // R-15: true threshold ablation configs (same workspace+prompt as baseline, threshold varies)
  'baseline-t3': {
    name: 'baseline-t3',
    workspace: WORKSPACE_STRATEGIES['evict'],
    monitor: MONITOR_STRATEGIES['constrain-force-t3'],
    prompt: PROMPT_STRATEGIES['baseline'],
  },

  'baseline-t4': {
    name: 'baseline-t4',
    workspace: WORKSPACE_STRATEGIES['evict'],
    monitor: MONITOR_STRATEGIES['constrain-force-t4'],
    prompt: PROMPT_STRATEGIES['baseline'],
  },
};

// ── Helpers ─────────────────────────────────────────────────────

/**
 * Returns a one-line description of a cognitive config.
 *
 * Example: "summary + reframe + anchored"
 */
export function describeConfig(config: CognitiveConfig): string {
  return `${config.workspace.name} + ${config.monitor.name} + ${config.prompt.name}`;
}
