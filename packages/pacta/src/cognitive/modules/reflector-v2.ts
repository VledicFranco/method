/**
 * Reflector v2 — LLM-based structured post-task reflection module.
 *
 * Unlike the v1 reflector (which runs each cycle and uses template-based extraction),
 * reflector-v2 runs ONCE after a task completes. It takes the task description, action
 * history, and outcome, makes a single cheap LLM call (Haiku-level), and produces
 * 1-3 HEURISTIC FactCards with concise, transferable strategic lessons.
 *
 * Design: fire-and-forget semantics. If the LLM call fails or JSON parsing fails,
 * returns empty lessons — never corrupts state, never throws.
 *
 * Grounded in: Schön's reflective practice, Kolb's experiential learning cycle.
 * PRD 032, Pattern P6, Commission C-1.
 */

import type {
  CognitiveModule,
  ReflectorMonitoring,
  ControlDirective,
  StepResult,
  StepError,
} from '../algebra/index.js';
import { moduleId } from '../algebra/index.js';
import type { ProviderAdapter } from '../algebra/provider-adapter.js';
import type { MemoryPortV2, FactCard } from '../../ports/memory-port.js';

// ── Types ──────────────────────────────────────────────────────────

/** Input: completed task summary for post-task reflection. */
export interface ReflectorV2Input {
  taskDescription: string;
  actionHistory: string[];
  outcome: { success: boolean; reason: string };
}

/** Output: 1-3 HEURISTIC FactCards with strategic lessons. */
export interface ReflectorV2Output {
  lessons: FactCard[];
}

/** State: reflection and lesson counters. */
export interface ReflectorV2State {
  reflectionCount: number;
  totalLessonsProduced: number;
}

/** Configuration for the Reflector v2 module. */
export interface ReflectorV2Config {
  /** Module ID override. Default: 'reflector-v2'. */
  id?: string;
  /** Maximum lessons per reflection. Default: 3. */
  maxLessons?: number;
}

// ── Internal Types ─────────────────────────────────────────────────

/** Shape of a single lesson parsed from LLM JSON output. */
interface ParsedLesson {
  lesson: string;
  tags: string[];
}

// ── Prompt ─────────────────────────────────────────────────────────

function buildReflectionPrompt(input: ReflectorV2Input): string {
  const outcomeLabel = input.outcome.success ? 'SUCCESS' : 'FAILURE';
  const actions = input.actionHistory.join('\n');

  return `You just completed a coding task. Reflect on what happened and extract transferable lessons.

Task: ${input.taskDescription}
Actions taken:
${actions}
Outcome: ${outcomeLabel}: ${input.outcome.reason}

Produce 1-3 concise lessons in this JSON format:
[
  {"lesson": "one sentence transferable insight", "tags": ["relevant", "tags"]}
]

Each lesson should be:
- Transferable to OTHER tasks (not specific to this one)
- One sentence, actionable
- About STRATEGY (what approach works), not MECHANICS (what buttons to press)`;
}

// ── JSON Parsing ───────────────────────────────────────────────────

/**
 * Parse the LLM output into an array of lessons.
 * Attempts to extract a JSON array from the response, handling cases where
 * the LLM wraps the JSON in markdown code fences or extra text.
 */
function parseLessons(raw: string, maxLessons: number): ParsedLesson[] {
  // Try to find a JSON array in the output
  const arrayMatch = raw.match(/\[[\s\S]*\]/);
  if (!arrayMatch) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(arrayMatch[0]);
  } catch {
    return [];
  }

  if (!Array.isArray(parsed)) return [];

  const lessons: ParsedLesson[] = [];
  for (const item of parsed) {
    if (lessons.length >= maxLessons) break;
    if (
      typeof item === 'object' &&
      item !== null &&
      typeof (item as Record<string, unknown>).lesson === 'string' &&
      Array.isArray((item as Record<string, unknown>).tags)
    ) {
      const tags = ((item as Record<string, unknown>).tags as unknown[])
        .filter((t): t is string => typeof t === 'string');
      lessons.push({
        lesson: (item as Record<string, unknown>).lesson as string,
        tags,
      });
    }
  }

  return lessons;
}

// ── FactCard Construction ──────────────────────────────────────────

function lessonToFactCard(
  lesson: ParsedLesson,
  success: boolean,
  index: number,
  reflectionCount: number,
): FactCard {
  const now = Date.now();
  return {
    id: `reflector-v2-${reflectionCount}-${index}`,
    content: lesson.lesson,
    type: 'HEURISTIC',
    source: { module: 'reflector-v2' },
    tags: [...lesson.tags, 'reflection', 'strategy'],
    created: now,
    updated: now,
    confidence: success ? 0.8 : 0.6,
    links: [],
  };
}

// ── Factory ────────────────────────────────────────────────────────

/**
 * Create a Reflector v2 cognitive module.
 *
 * Post-task reflection: a single cheap LLM call produces 1-3 HEURISTIC FactCards
 * with transferable strategic lessons. Cards are stored via the memory port.
 *
 * Fire-and-forget: on any error (LLM failure, parse failure), returns empty
 * lessons and unchanged state. Never throws.
 */
export function createReflectorV2(
  memory: MemoryPortV2,
  llm: ProviderAdapter,
  config?: ReflectorV2Config,
): CognitiveModule<ReflectorV2Input, ReflectorV2Output, ReflectorV2State, ReflectorMonitoring, ControlDirective> {
  const id = moduleId(config?.id ?? 'reflector-v2');
  const maxLessons = config?.maxLessons ?? 3;

  return {
    id,

    async step(
      input: ReflectorV2Input,
      state: ReflectorV2State,
      _control: ControlDirective,
    ): Promise<StepResult<ReflectorV2Output, ReflectorV2State, ReflectorMonitoring>> {
      try {
        // 1. Build the reflection prompt
        const prompt = buildReflectionPrompt(input);

        // 2. Call the LLM via ProviderAdapter (cheap pact — oneshot, no tools)
        const result = await llm.invoke(
          [{ source: id, content: prompt, salience: 1, timestamp: Date.now() }],
          {
            pactTemplate: { mode: { type: 'oneshot' } },
            systemPrompt: 'You are a concise reflection assistant. Output only valid JSON.',
          },
        );

        // 3. Parse lessons from LLM response
        const parsed = parseLessons(result.output, maxLessons);

        // 4. Convert to HEURISTIC FactCards
        const cards: FactCard[] = parsed.map((lesson, i) =>
          lessonToFactCard(lesson, input.outcome.success, i, state.reflectionCount),
        );

        // 5. Store each card via memory port
        for (const card of cards) {
          await memory.storeCard(card);
        }

        // 6. Update state and return
        const newState: ReflectorV2State = {
          reflectionCount: state.reflectionCount + 1,
          totalLessonsProduced: state.totalLessonsProduced + cards.length,
        };

        const monitoring: ReflectorMonitoring = {
          type: 'reflector',
          source: id,
          timestamp: Date.now(),
          lessonsExtracted: cards.length,
        };

        return {
          output: { lessons: cards },
          state: newState,
          monitoring,
        };
      } catch (err: unknown) {
        // Fire-and-forget: on any error, return empty output, unchanged state
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
          state,
          monitoring,
          error,
        };
      }
    },

    initialState(): ReflectorV2State {
      return {
        reflectionCount: 0,
        totalLessonsProduced: 0,
      };
    },

    stateInvariant(state: ReflectorV2State): boolean {
      return state.reflectionCount >= 0 && state.totalLessonsProduced >= 0;
    },
  };
}
