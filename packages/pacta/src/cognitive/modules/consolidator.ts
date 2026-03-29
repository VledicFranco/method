/**
 * Consolidator — online LEARN-phase cognitive module for episode storage
 * and shallow lesson extraction.
 *
 * Operates in the LEARN phase of the cognitive loop:
 *   1. Stores the current episode verbatim in the episodic store
 *   2. Extracts 1-2 shallow lessons from cycle traces
 *   3. Emits ReflectorMonitoring signal (backward compat with Reflector)
 *   4. Returns immediately — no consolidation, no replay
 *
 * Invariants:
 *   - Online mode NEVER writes to the semantic store
 *   - Online mode NEVER performs consolidation/replay
 *   - Fire-and-forget: errors do not corrupt state
 *
 * The offline consolidation engine (consolidateOffline) handles the heavy
 * lifting: interleaved replay, schema consistency, compression, pruning.
 * That runs between sessions, not inside the cognitive loop.
 *
 * Grounded in: Complementary Learning Systems (CLS) theory — fast episodic
 * encoding during online learning, slow semantic consolidation offline.
 * See PRD 036, C-4.
 */

import type {
  CognitiveModule,
  ReflectorMonitoring,
  ControlDirective,
  StepResult,
  StepError,
  TraceRecord,
} from '../algebra/index.js';
import { moduleId } from '../algebra/index.js';
import type {
  MemoryPortV3,
  EpisodicEntry,
  ConsolidationConfig,
} from '../../ports/memory-port.js';

// ── Types ────────────────────────────────────────────────────────

/** Input to the consolidator: cycle traces and workspace snapshot summary. */
export interface ConsolidatorInput {
  /** Completed cycle traces for lesson extraction. */
  traces: TraceRecord[];
  /** Serialized workspace snapshot — stored verbatim as episode content. */
  workspaceSnapshot: string;
  /** Action outcome summary from the current cycle. */
  actionOutcome: string;
}

/** Output of the consolidator: episode stored + lessons extracted. */
export interface ConsolidatorOutput {
  /** The episode that was stored in the episodic store. */
  storedEpisode: EpisodicEntry;
  /** Shallow lessons extracted from the traces. */
  lessons: Array<{ summary: string; depth: 'shallow' }>;
}

/** Internal state of the consolidator module. */
export interface ConsolidatorState {
  /** Total episodes stored across all steps. */
  episodeCount: number;
  /** Total lessons extracted across all steps. */
  lessonCount: number;
  /** Current cycle count. */
  cycleCount: number;
}

/** Control directive for the consolidator (basic — no special signals). */
export interface ConsolidatorControl extends ControlDirective {
  // No special control fields needed for the online mode.
}

// ── Lesson Extraction ────────────────────────────────────────────

/**
 * Extract 1-2 shallow lessons from cycle traces.
 *
 * Follows the same pattern as the Reflector's shallow mode: summarize
 * what happened in each trace. Limited to at most 2 lessons to keep
 * the online phase fast.
 */
function extractShallowLessons(
  traces: TraceRecord[],
): Array<{ summary: string; depth: 'shallow' }> {
  if (traces.length === 0) return [];

  const lessons: Array<{ summary: string; depth: 'shallow' }> = [];

  // Take at most 2 traces for shallow extraction
  const selected = traces.slice(0, 2);

  for (const trace of selected) {
    lessons.push({
      summary: `Module ${trace.moduleId} in phase ${trace.phase}: ${trace.outputSummary} (${trace.durationMs}ms)`,
      depth: 'shallow',
    });
  }

  return lessons;
}

/**
 * Derive context tags from traces and action outcome for the episodic entry.
 */
function deriveContextTags(traces: TraceRecord[], actionOutcome: string): string[] {
  const tags = new Set<string>();

  // Module IDs and phases as context
  for (const trace of traces) {
    tags.add(String(trace.moduleId));
    tags.add(trace.phase);
  }

  // Extract significant words from the action outcome
  const words = actionOutcome
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 4);
  for (const word of words.slice(0, 5)) {
    tags.add(word);
  }

  return [...tags];
}

// ── Factory ──────────────────────────────────────────────────────

/**
 * Create a Consolidator cognitive module (online LEARN phase).
 *
 * Stores episodes verbatim in the episodic store and extracts shallow lessons.
 * Emits ReflectorMonitoring for backward compatibility with existing signal consumers.
 *
 * @param store - MemoryPortV3 implementation (episodic store target).
 * @param config - Consolidation configuration (only `id` and `onlineDepth` used online).
 * @returns A CognitiveModule for the LEARN phase.
 */
export function createConsolidator(
  store: MemoryPortV3,
  config?: Partial<ConsolidationConfig>,
): CognitiveModule<ConsolidatorInput, ConsolidatorOutput, ConsolidatorState, ReflectorMonitoring, ConsolidatorControl> {
  const id = moduleId(config?.id ?? 'consolidator');

  return {
    id,

    initialState(): ConsolidatorState {
      return {
        episodeCount: 0,
        lessonCount: 0,
        cycleCount: 0,
      };
    },

    stateInvariant(state: ConsolidatorState): boolean {
      return state.episodeCount >= 0 && state.lessonCount >= 0 && state.cycleCount >= 0;
    },

    async step(
      input: ConsolidatorInput,
      state: ConsolidatorState,
      _control: ConsolidatorControl,
    ): Promise<StepResult<ConsolidatorOutput, ConsolidatorState, ReflectorMonitoring>> {
      try {
        // 1. Store the current episode verbatim in the episodic store
        const now = Date.now();
        const episodeContent = `${input.workspaceSnapshot}\n---\nOutcome: ${input.actionOutcome}`;
        const contextTags = deriveContextTags(input.traces, input.actionOutcome);

        const episode: EpisodicEntry = {
          id: `ep-${now}-${state.cycleCount}`,
          content: episodeContent,
          context: contextTags,
          timestamp: now,
          accessCount: 0,
          lastAccessed: now,
        };

        await store.storeEpisodic(episode);

        // 2. Extract 1-2 shallow lessons from the cycle traces
        const lessons = extractShallowLessons(input.traces);

        // 3. Emit ReflectorMonitoring signal (backward compat)
        const monitoring: ReflectorMonitoring = {
          type: 'reflector',
          source: id,
          timestamp: now,
          lessonsExtracted: lessons.length,
        };

        // 4. Update state on success
        const newState: ConsolidatorState = {
          episodeCount: state.episodeCount + 1,
          lessonCount: state.lessonCount + lessons.length,
          cycleCount: state.cycleCount + 1,
        };

        return {
          output: { storedEpisode: episode, lessons },
          state: newState,
          monitoring,
        };
      } catch (err: unknown) {
        // Fire-and-forget: on error, do NOT corrupt state
        const error: StepError = {
          message: err instanceof Error ? err.message : String(err),
          recoverable: true,
          moduleId: id,
          phase: 'LEARN',
        };

        const monitoring: ReflectorMonitoring = {
          type: 'reflector',
          source: id,
          timestamp: Date.now(),
          lessonsExtracted: 0,
        };

        const emptyEpisode: EpisodicEntry = {
          id: 'ep-error',
          content: '',
          context: [],
          timestamp: Date.now(),
          accessCount: 0,
          lastAccessed: Date.now(),
        };

        return {
          output: { storedEpisode: emptyEpisode, lessons: [] },
          state, // Return pre-step state unchanged
          monitoring,
          error,
        };
      }
    },
  };
}
