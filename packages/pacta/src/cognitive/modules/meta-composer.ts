/**
 * Meta-Composer — adaptive cognitive load selection (PRD 032, P2).
 *
 * Sits ABOVE the cognitive cycle and selects which strategy config to use based
 * on task signals. Classifies the task into a cognitive profile using rule-based
 * heuristics (no LLM call), then returns the appropriate CognitiveConfig name.
 *
 * Classification hierarchy (evaluated top-to-bottom, first match wins):
 *   1. muscle-memory — known procedure, high confidence, no prior failures
 *   2. creative — stuck (>= 2 failures) with no matching procedure
 *   3. conflicted — contradictory heuristic cards in memory
 *   4. deliberate — novel task or has prior failures
 *   5. routine — familiar task, low failure count, no contradictions
 *
 * Profile → config mapping:
 *   muscle-memory → 'baseline'  (minimal overhead, follow the procedure)
 *   routine       → 'baseline'
 *   deliberate    → 'v2-full'   (all monitoring active)
 *   conflicted    → 'v2-full'   (needs careful deliberation)
 *   creative      → 'v2-thane'  (tight workspace forces divergent thinking)
 *
 * Grounded in: Kahneman's dual-process theory (System 1 → muscle-memory/routine,
 * System 2 → deliberate/conflicted), Amabile's componential creativity theory
 * (creative profile activates tight-workspace divergent mode).
 */

import type { MemoryPortV2, FactCard } from '../../ports/memory-port.js';

// ── Types ────────────────────────────────────────────────────────

/**
 * Cognitive profile — the meta-composer's classification of task complexity.
 *
 * Ordered by increasing cognitive load:
 *   muscle-memory < routine < deliberate < conflicted < creative
 */
export type CognitiveProfile =
  | 'muscle-memory'
  | 'routine'
  | 'deliberate'
  | 'conflicted'
  | 'creative';

/**
 * Observable signals extracted from memory and task context.
 * These drive the rule-based classification — no LLM introspection needed.
 */
export interface TaskSignals {
  /** The task description being classified. */
  taskDescription: string;
  /** How many FactCards match this task (semantic relevance). */
  memoryHits: number;
  /** Whether a matching PROCEDURE-type FactCard was found. */
  procedureMatch: boolean;
  /** Confidence of the best matching PROCEDURE card (0-1). */
  procedureConfidence: number;
  /** How many times this task type has failed before. */
  priorFailures: number;
  /** Whether contradictory HEURISTIC cards were found. */
  contradictoryHeuristics: boolean;
}

/**
 * Result of meta-composer classification.
 * Carries the profile, the config name to select, and the reasoning trace.
 */
export interface MetaComposerResult {
  /** The classified cognitive profile. */
  profile: CognitiveProfile;
  /** Key into CONFIGS from strategies.ts. */
  configName: string;
  /** Human-readable explanation of why this profile was selected. */
  reason: string;
}

// ── Profile → Config Mapping ─────────────────────────────────────

const PROFILE_CONFIG_MAP: Record<CognitiveProfile, string> = {
  'muscle-memory': 'baseline',
  'routine': 'baseline',
  'deliberate': 'v2-full',
  'conflicted': 'v2-full',
  'creative': 'v2-thane',
};

// ── Classification ───────────────────────────────────────────────

/**
 * Classify a task into a cognitive profile based on observable signals.
 *
 * Rule evaluation order matters: rules are checked from most specific (muscle-memory)
 * to most general (routine). The first matching rule wins.
 *
 * Rules:
 *   1. muscle-memory: procedureMatch AND procedureConfidence >= 0.8 AND priorFailures === 0
 *   2. creative: priorFailures >= 2 AND !procedureMatch (stuck, need divergent approach)
 *   3. conflicted: contradictoryHeuristics === true
 *   4. deliberate: priorFailures >= 1 OR memoryHits === 0 (novel or has failed)
 *   5. routine: fallback — memoryHits > 0, low failures, no contradictions
 */
export function classifyTask(signals: TaskSignals): MetaComposerResult {
  // Rule 1: muscle-memory — high-confidence known procedure, zero failures, AND enough memory
  // Requires memoryHits >= 5 to prevent generic PROCEDURE patterns from triggering muscle-memory
  // on tasks the agent hasn't actually solved before
  if (
    signals.procedureMatch &&
    signals.procedureConfidence >= 0.8 &&
    signals.priorFailures === 0 &&
    signals.memoryHits >= 5
  ) {
    return {
      profile: 'muscle-memory',
      configName: PROFILE_CONFIG_MAP['muscle-memory'],
      reason:
        `PROCEDURE match with confidence ${signals.procedureConfidence.toFixed(2)} ` +
        `and zero prior failures — executing known procedure with minimal overhead`,
    };
  }

  // Rule 2: creative — stuck with repeated failures, no procedure to follow
  if (signals.priorFailures >= 2 && !signals.procedureMatch) {
    return {
      profile: 'creative',
      configName: PROFILE_CONFIG_MAP['creative'],
      reason:
        `${signals.priorFailures} prior failures with no matching PROCEDURE — ` +
        `switching to tight-workspace divergent mode to force new approach`,
    };
  }

  // Rule 3: conflicted — contradictory heuristics need careful deliberation
  if (signals.contradictoryHeuristics) {
    return {
      profile: 'conflicted',
      configName: PROFILE_CONFIG_MAP['conflicted'],
      reason:
        `Contradictory HEURISTIC cards detected — ` +
        `engaging full monitoring to resolve conflicting guidance`,
    };
  }

  // Rule 4: deliberate — novel task (no memory) or has experienced failure
  if (signals.priorFailures >= 1 || signals.memoryHits === 0) {
    const novelty = signals.memoryHits === 0 ? 'novel task (zero memory hits)' : '';
    const failures = signals.priorFailures >= 1
      ? `${signals.priorFailures} prior failure(s)`
      : '';
    const parts = [novelty, failures].filter(Boolean).join(' and ');
    return {
      profile: 'deliberate',
      configName: PROFILE_CONFIG_MAP['deliberate'],
      reason: `${parts} — engaging full monitoring for careful deliberation`,
    };
  }

  // Rule 5: routine — familiar territory, low risk
  return {
    profile: 'routine',
    configName: PROFILE_CONFIG_MAP['routine'],
    reason:
      `${signals.memoryHits} memory hit(s), ${signals.priorFailures} failures, ` +
      `no contradictions — proceeding with baseline config`,
  };
}

// ── Signal Gathering ─────────────────────────────────────────────

/**
 * Detect contradictory HEURISTIC cards.
 *
 * Two heuristics are considered contradictory when one contains a negation
 * or opposition pattern relative to the other. This is a conservative
 * text-heuristic check — it catches common patterns like:
 *   - "always X" vs "never X"
 *   - "avoid X" vs "prefer X"
 *   - "do not X" vs content suggesting X
 *
 * Returns true if at least one contradictory pair is found.
 */
function detectContradictions(heuristics: FactCard[]): boolean {
  if (heuristics.length < 2) return false;

  const OPPOSITION_PAIRS: Array<[RegExp, RegExp]> = [
    [/\balways\b/i, /\bnever\b/i],
    [/\bavoid\b/i, /\bprefer\b/i],
    [/\bdo not\b/i, /\bshould\b/i],
    [/\bdon't\b/i, /\bshould\b/i],
    [/\bincrease\b/i, /\bdecrease\b/i],
    [/\bsimplif/i, /\bextend\b/i],
  ];

  for (let i = 0; i < heuristics.length; i++) {
    for (let j = i + 1; j < heuristics.length; j++) {
      const a = heuristics[i].content;
      const b = heuristics[j].content;

      for (const [patternA, patternB] of OPPOSITION_PAIRS) {
        if (
          (patternA.test(a) && patternB.test(b)) ||
          (patternB.test(a) && patternA.test(b))
        ) {
          return true;
        }
      }
    }
  }

  return false;
}

/**
 * Gather task signals by querying memory for relevant facts.
 *
 * Performs three memory queries:
 *   1. General search — all card types matching the task description
 *   2. PROCEDURE search — filtered to PROCEDURE cards only
 *   3. HEURISTIC search — filtered to HEURISTIC cards for contradiction detection
 *
 * The `priorFailures` field is not populated by this function (it requires
 * external failure tracking). Callers should override it from their own state.
 *
 * @param memory - MemoryPortV2 to query for FactCards.
 * @param taskDescription - The task being classified.
 * @returns TaskSignals with memory-derived fields populated, priorFailures defaulting to 0.
 */
export async function gatherTaskSignals(
  memory: MemoryPortV2,
  taskDescription: string,
): Promise<TaskSignals> {
  // Query 1: General search for all relevant cards
  const allHits = await memory.searchCards(taskDescription, { limit: 20 });

  // Query 2: PROCEDURE cards — check for matching procedures
  const procedureCards = await memory.searchCards(taskDescription, {
    type: 'PROCEDURE',
    limit: 5,
  });

  // Query 3: HEURISTIC cards — check for contradictions
  const heuristicCards = await memory.searchCards(taskDescription, {
    type: 'HEURISTIC',
    limit: 10,
  });

  // Find best procedure match confidence
  const bestProcedureConfidence = procedureCards.length > 0
    ? Math.max(...procedureCards.map((c) => c.confidence))
    : 0;

  return {
    taskDescription,
    memoryHits: allHits.length,
    procedureMatch: procedureCards.length > 0,
    procedureConfidence: bestProcedureConfidence,
    priorFailures: 0, // caller must override from external failure tracking
    contradictoryHeuristics: detectContradictions(heuristicCards),
  };
}
