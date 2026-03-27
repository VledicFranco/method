/**
 * Reflector — meta-level cognitive module for lesson extraction and memory consolidation.
 *
 * Reads completed cycle traces, extracts lessons (what happened, what worked,
 * what didn't), and writes distilled memories to the MemoryPort.
 *
 * Designed for fire-and-forget semantics: state is only updated on success,
 * never on error. An error path emits monitoring with lessonsExtracted: 0
 * and returns the pre-step state unchanged.
 *
 * Grounded in: SOAR chunking, ACT-R declarative memory consolidation.
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
import type { MemoryPort } from '../../ports/memory-port.js';

// ── Types ──────────────────────────────────────────────────────────

/** Configuration for the Reflector module. */
export interface ReflectorConfig {
  /** Module ID override. Default: 'reflector'. */
  id?: string;
}

/** Input: completed cycle traces. */
export interface ReflectorInput {
  traces: TraceRecord[];
}

/** A lesson extracted from cycle traces. */
export interface Lesson {
  summary: string;
  depth: 'shallow' | 'deep';
}

/** Output: memory updates (lessons extracted). */
export interface ReflectorOutput {
  lessons: Lesson[];
}

/** State: lesson count and reflection depth tracking. */
export interface ReflectorState {
  lessonCount: number;
  reflectionDepth: 'shallow' | 'deep';
  cycleCount: number;
}

/** Control directive: reflection depth. */
export interface ReflectorControl extends ControlDirective {
  reflectionDepth: 'shallow' | 'deep';
}

// ── Factory ────────────────────────────────────────────────────────

/**
 * Create a Reflector cognitive module.
 *
 * Reads cycle traces, extracts lessons, and writes them to MemoryPort.
 * On error: emits monitoring with lessonsExtracted: 0, does NOT corrupt state.
 */
export function createReflector(
  memory: MemoryPort,
  config?: ReflectorConfig,
): CognitiveModule<ReflectorInput, ReflectorOutput, ReflectorState, ReflectorMonitoring, ReflectorControl> {
  const id = moduleId(config?.id ?? 'reflector');

  return {
    id,

    async step(
      input: ReflectorInput,
      state: ReflectorState,
      control: ReflectorControl,
    ): Promise<StepResult<ReflectorOutput, ReflectorState, ReflectorMonitoring>> {
      const depth = control.reflectionDepth;

      try {
        const lessons = extractLessons(input.traces, depth);

        // Write lessons to memory
        for (const lesson of lessons) {
          await memory.store(
            `lesson-${state.cycleCount}-${lessons.indexOf(lesson)}`,
            lesson.summary,
            { depth: lesson.depth, cycle: state.cycleCount },
          );
        }

        // State updated only on success
        const newState: ReflectorState = {
          lessonCount: state.lessonCount + lessons.length,
          reflectionDepth: depth,
          cycleCount: state.cycleCount + 1,
        };

        const monitoring: ReflectorMonitoring = {
          type: 'reflector',
          source: id,
          timestamp: Date.now(),
          lessonsExtracted: lessons.length,
        };

        return {
          output: { lessons },
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

        return {
          output: { lessons: [] },
          state, // Return pre-step state unchanged
          monitoring,
          error,
        };
      }
    },

    initialState(): ReflectorState {
      return {
        lessonCount: 0,
        reflectionDepth: 'shallow',
        cycleCount: 0,
      };
    },

    stateInvariant(state: ReflectorState): boolean {
      return state.lessonCount >= 0 && state.cycleCount >= 0;
    },
  };
}

// ── Internals ──────────────────────────────────────────────────────

/**
 * Extract lessons from trace records.
 *
 * Shallow: summarize key facts from each trace.
 * Deep: analyze patterns across traces and extract relationship insights.
 */
function extractLessons(traces: TraceRecord[], depth: 'shallow' | 'deep'): Lesson[] {
  if (traces.length === 0) return [];

  const lessons: Lesson[] = [];

  if (depth === 'shallow') {
    // Shallow: one lesson per trace, summarizing what happened
    for (const trace of traces) {
      lessons.push({
        summary: `Module ${trace.moduleId} in phase ${trace.phase}: ${trace.outputSummary} (${trace.durationMs}ms)`,
        depth: 'shallow',
      });
    }
  } else {
    // Deep: analyze patterns across all traces
    // First, include per-trace summaries
    for (const trace of traces) {
      lessons.push({
        summary: `Module ${trace.moduleId} in phase ${trace.phase}: ${trace.outputSummary} (${trace.durationMs}ms)`,
        depth: 'deep',
      });
    }

    // Then, extract cross-trace patterns
    const totalDuration = traces.reduce((sum, t) => sum + t.durationMs, 0);
    const avgDuration = totalDuration / traces.length;
    const slowModules = traces
      .filter(t => t.durationMs > avgDuration * 1.5)
      .map(t => t.moduleId);

    if (slowModules.length > 0) {
      lessons.push({
        summary: `Performance pattern: modules [${slowModules.join(', ')}] took significantly longer than average (avg: ${Math.round(avgDuration)}ms)`,
        depth: 'deep',
      });
    }

    // Detect modules with errors
    const phases = new Set(traces.map(t => t.phase));
    if (phases.size > 1) {
      lessons.push({
        summary: `Cycle covered ${phases.size} phases: ${[...phases].join(', ')}`,
        depth: 'deep',
      });
    }
  }

  return lessons;
}
