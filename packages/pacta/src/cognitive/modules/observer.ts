// SPDX-License-Identifier: Apache-2.0
/**
 * Observer Module — processes raw inputs into structured observations.
 *
 * The observer is the sensory front-end of the cognitive architecture.
 * It receives raw inputs (prompts, tool results, environment data),
 * computes a novelty score, and writes processed observations to the
 * workspace via WorkspaceWritePort.
 *
 * ## Cognitive Science Grounding
 *
 * **Primary analog: Sensory cortex — feature extraction and gating.**
 *
 * The Observer implements the input processing stage found in every major
 * cognitive architecture:
 *
 * - **ACT-R (Anderson, 2007):** The visual and aural modules that encode
 *   external stimuli into chunk representations for the buffers. Our Observer
 *   mirrors this: raw text → structured WorkspaceEntry with computed salience.
 *   ACT-R's perceptual modules are modality-specific; ours is modality-agnostic
 *   (all input is text), which is a simplification.
 *
 * - **Global Workspace Theory (Baars, 1988):** Sensory processors that compete
 *   to place content into the global workspace. Our Observer writes to the
 *   workspace with a novelty-based salience score, implementing the first stage
 *   of GWT's competitive access mechanism. Novel inputs get higher salience and
 *   are more likely to persist in the workspace.
 *
 * - **LIDA (Franklin et al., 2016):** The Sensory Memory → Perceptual Associative
 *   Memory pathway. Raw input is matched against learned patterns to produce
 *   structured percepts. Our novelty computation is a simplified version of
 *   LIDA's feature detection — character-level differencing rather than learned
 *   pattern matching.
 *
 * **What this module captures:**
 * - Input gating: not all inputs reach the workspace (filtered flag)
 * - Novelty detection: repeated inputs get lower salience
 * - Content classification: inputs tagged as constraint/goal/operational
 *
 * **What this module does NOT capture (known gaps):**
 * - Perceptual binding (Treisman, 1998): combining features into objects
 * - Attention-modulated perception: top-down goals don't bias what gets observed
 * - Multi-modal integration: all input is flat text, no structural parsing
 * - Goal-relevant filtering: the Observer classifies by keyword pattern, not
 *   by relevance to the current goal (see RFC 004, §Adaptive Context Selection)
 *
 * **References:**
 * - Anderson, J. R. (2007). How Can the Human Mind Occur in the Physical Universe? Oxford UP.
 * - Baars, B. J. (1988). A Cognitive Theory of Consciousness. Cambridge UP.
 * - Franklin, S., et al. (2016). LIDA: A Systems-level Architecture for Cognition, Emotion,
 *   and Learning. IEEE Trans. Autonomous Mental Development, 6(1), 19-41.
 *
 * @see docs/rfcs/001-cognitive-composition.md — Part IV, Phase 1 (OBSERVE)
 */

import type {
  CognitiveModule,
  ObserverMonitoring,
  ControlDirective,
  StepResult,
  StepError,
  WorkspaceWritePort,
  WorkspaceEntry,
} from '../algebra/index.js';
import { moduleId } from '../algebra/index.js';
import { classifyEntry } from './constraint-classifier.js';

// ── Types ────────────────────────────────────────────────────────

/** Raw input to the observer: prompt text, tool results, or environment data. */
export interface ObserverInput {
  /** The raw input content. */
  content: string;
  /** Optional source tag for the input. */
  source?: string;
}

/** Processed observation written to workspace. */
export interface ObserverOutput {
  /** The processed observation content. */
  observation: string;
  /** Computed novelty score (0-1). */
  noveltyScore: number;
  /** Whether the input was filtered out by focus control. */
  filtered: boolean;
}

/** Observer internal state. */
export interface ObserverState {
  /** Total observations processed. */
  observationCount: number;
  /** Novelty score of the last processed input. */
  lastNoveltyScore: number;
  /** Content of the previous observation (for novelty comparison). */
  previousContent: string | null;
}

/** Control directive for the observer. */
export interface ObserverControl extends ControlDirective {
  /** If set, only process inputs whose content contains at least one filter keyword. */
  focusFilter?: string[];
}

/** Configuration for the observer factory. */
export interface ObserverConfig {
  /** Custom module ID. Defaults to 'observer'. */
  id?: string;
  /** Base novelty score for empty comparison. Defaults to 0.5. */
  baseNovelty?: number;
  contextBinding?: import('../algebra/partition-types.js').ModuleContextBinding;
}

// ── Novelty Heuristic ────────────────────────────────────────────

/**
 * Simple novelty heuristic: compares current input to previous observation.
 * Longer inputs score higher as a baseline; character-level difference
 * with previous content raises novelty further.
 */
function computeNovelty(
  current: string,
  previous: string | null,
  baseNovelty: number,
): number {
  // Baseline: length-based score (clamped 0.1-0.9)
  const lengthScore = Math.min(0.9, Math.max(0.1, current.length / 500));

  if (previous === null) {
    return Math.max(baseNovelty, lengthScore);
  }

  // Character-level difference ratio
  const maxLen = Math.max(current.length, previous.length);
  if (maxLen === 0) return 0;

  let diffCount = 0;
  for (let i = 0; i < maxLen; i++) {
    if (current[i] !== previous[i]) diffCount++;
  }
  const diffRatio = diffCount / maxLen;

  // Blend length score and difference ratio
  return Math.min(1, (lengthScore + diffRatio) / 2);
}

// ── Factory ──────────────────────────────────────────────────────

/**
 * Create an Observer cognitive module.
 *
 * @param writePort - Workspace write port for emitting observations.
 * @param config - Optional configuration.
 */
export function createObserver(
  writePort: WorkspaceWritePort,
  config?: ObserverConfig,
): CognitiveModule<ObserverInput, ObserverOutput, ObserverState, ObserverMonitoring, ObserverControl> {
  const id = moduleId(config?.id ?? 'observer');
  const baseNovelty = config?.baseNovelty ?? 0.5;

  return {
    id,
    contextBinding: config?.contextBinding ?? { types: ['goal'], budget: 1024, strategy: 'all' as const },

    initialState(): ObserverState {
      return {
        observationCount: 0,
        lastNoveltyScore: 0,
        previousContent: null,
      };
    },

    async step(
      input: ObserverInput,
      state: ObserverState,
      control: ObserverControl,
    ): Promise<StepResult<ObserverOutput, ObserverState, ObserverMonitoring>> {
      try {
        // Apply focus filter if set
        if (control.focusFilter && control.focusFilter.length > 0) {
          const contentLower = input.content.toLowerCase();
          const matches = control.focusFilter.some(
            (keyword) => contentLower.includes(keyword.toLowerCase()),
          );

          if (!matches) {
            // Input filtered out
            const monitoring: ObserverMonitoring = {
              type: 'observer',
              source: id,
              timestamp: Date.now(),
              inputProcessed: false,
              noveltyScore: 0,
            };

            return {
              output: { observation: '', noveltyScore: 0, filtered: true },
              state,
              monitoring,
            };
          }
        }

        // Compute novelty
        const noveltyScore = computeNovelty(input.content, state.previousContent, baseNovelty);

        // Classify task input for constraint/goal/operational content
        const classification = classifyEntry(input.content);

        // Write observation to workspace
        const entry: WorkspaceEntry & { contentType?: string } = {
          source: id,
          content: input.content,
          salience: noveltyScore,
          timestamp: Date.now(),
          pinned: classification.pinned || undefined,
          contentType: classification.contentType,
        };
        writePort.write(entry);

        // Update state
        const newState: ObserverState = {
          observationCount: state.observationCount + 1,
          lastNoveltyScore: noveltyScore,
          previousContent: input.content,
        };

        const monitoring: ObserverMonitoring = {
          type: 'observer',
          source: id,
          timestamp: Date.now(),
          inputProcessed: true,
          noveltyScore,
        };

        return {
          output: { observation: input.content, noveltyScore, filtered: false },
          state: newState,
          monitoring,
        };
      } catch (err: unknown) {
        const error: StepError = {
          message: err instanceof Error ? err.message : String(err),
          recoverable: true,
          moduleId: id,
          phase: 'observe',
        };

        const monitoring: ObserverMonitoring = {
          type: 'observer',
          source: id,
          timestamp: Date.now(),
          inputProcessed: false,
          noveltyScore: 0,
        };

        return {
          output: { observation: '', noveltyScore: 0, filtered: false },
          state,
          monitoring,
          error,
        };
      }
    },
  };
}
