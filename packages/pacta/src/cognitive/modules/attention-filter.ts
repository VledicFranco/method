/**
 * Attention Filter — multi-sense event filtering for cognitive agents (PRD 032, P8).
 *
 * Filters CognitiveStimulus events by priority and relevance to the current task.
 * HIGH priority stimuli always pass, MEDIUM pass if relevant to current task keywords,
 * LOW are rejected unless "mind wandering" mode is active via control directive.
 *
 * Accepted stimuli are formatted as workspace entries: "[STIMULUS: {type}] {content summary}"
 *
 * All computation is deterministic and rule-based (zero LLM calls).
 *
 * Grounded in: Broadbent's filter model, Treisman's attenuation model.
 */

import type {
  CognitiveModule,
  MonitoringSignal,
  ControlDirective,
  StepResult,
} from '../algebra/index.js';
import { moduleId } from '../algebra/index.js';
import type { CognitiveStimulus } from '../../ports/attention-port.js';

// ── Types ──────────────────────────────────────────────────────────

/** Input: batch of stimuli plus current task context for relevance filtering. */
export interface AttentionFilterInput {
  /** Stimuli to evaluate this step. */
  stimuli: CognitiveStimulus[];
  /** Keywords from the current task — used for relevance matching of MEDIUM priority stimuli. */
  currentTaskKeywords: string[];
}

/** Output: stimuli partitioned into accepted, queued, and rejected. */
export interface AttentionFilterOutput {
  /** Passed filter — will be injected into the workspace. */
  accepted: CognitiveStimulus[];
  /** Medium priority, not relevant now — queued for later evaluation. */
  queued: CognitiveStimulus[];
  /** Filtered out — will not enter the workspace. */
  rejected: CognitiveStimulus[];
  /** Workspace-ready formatted strings for accepted stimuli. */
  workspaceEntries: string[];
}

/** State: medium-priority queue and processing statistics. */
export interface AttentionFilterState {
  /** Medium-priority stimuli waiting for relevance match. */
  queue: CognitiveStimulus[];
  /** Total stimuli processed across all steps. */
  processedCount: number;
}

/** Control directive extension — adds mind wandering mode toggle. */
export interface AttentionFilterControl extends ControlDirective {
  /** When true, LOW priority stimuli are also accepted instead of rejected. */
  mindWanderingMode: boolean;
}

/** Configuration for the Attention Filter module. */
export interface AttentionFilterConfig {
  /** Module ID override. Default: 'attention-filter'. */
  id?: string;
  /** Maximum queue size for medium-priority stimuli. Default: 50. */
  maxQueueSize?: number;
}

/** Monitoring signal for the attention filter module. */
export interface AttentionFilterMonitoring extends MonitoringSignal {
  type: 'attention-filter';
  /** Number of stimuli accepted this step. */
  acceptedCount: number;
  /** Number of stimuli queued this step. */
  queuedCount: number;
  /** Number of stimuli rejected this step. */
  rejectedCount: number;
  /** Total queue depth after this step. */
  queueDepth: number;
  /** Whether mind wandering mode was active. */
  mindWanderingMode: boolean;
}

// ── Pure Computation ───────────────────────────────────────────────

/**
 * Classify a single stimulus by priority and relevance.
 * Returns 'accept', 'queue', or 'reject'.
 */
export function classifyStimulus(
  stimulus: CognitiveStimulus,
  keywords: string[],
  mindWanderingMode: boolean,
): 'accept' | 'queue' | 'reject' {
  switch (stimulus.priority) {
    case 'high':
      // HIGH priority always passes — test failures, user messages
      return 'accept';

    case 'medium':
      // MEDIUM priority — accept if content matches task keywords, else queue
      return isRelevantToTask(stimulus, keywords) ? 'accept' : 'queue';

    case 'low':
      // LOW priority — reject unless mind wandering mode is active
      return mindWanderingMode ? 'accept' : 'reject';
  }
}

/**
 * Check if a stimulus is relevant to the current task by keyword matching.
 *
 * Matches against stimulus content (stringified), source, and type.
 * Case-insensitive. A stimulus is relevant if ANY keyword matches.
 */
export function isRelevantToTask(
  stimulus: CognitiveStimulus,
  keywords: string[],
): boolean {
  if (keywords.length === 0) return false;

  const searchableText = buildSearchableText(stimulus);
  const lowerText = searchableText.toLowerCase();

  return keywords.some(keyword => lowerText.includes(keyword.toLowerCase()));
}

/**
 * Build a searchable text representation from a stimulus.
 * Concatenates type, source, and stringified content.
 */
function buildSearchableText(stimulus: CognitiveStimulus): string {
  const parts: string[] = [stimulus.type, stimulus.source];

  if (stimulus.content !== undefined && stimulus.content !== null) {
    if (typeof stimulus.content === 'string') {
      parts.push(stimulus.content);
    } else {
      try {
        parts.push(JSON.stringify(stimulus.content));
      } catch {
        parts.push(String(stimulus.content));
      }
    }
  }

  return parts.join(' ');
}

/**
 * Format an accepted stimulus as a workspace entry string.
 *
 * Format: "[STIMULUS: {type}] {content summary}"
 */
export function formatStimulusForWorkspace(stimulus: CognitiveStimulus): string {
  const summary = summarizeContent(stimulus.content);
  return `[STIMULUS: ${stimulus.type}] ${summary}`;
}

/**
 * Summarize stimulus content to a concise string.
 * Truncates at 200 characters to prevent workspace pollution.
 */
function summarizeContent(content: unknown): string {
  if (content === undefined || content === null) return '(no content)';
  if (typeof content === 'string') return truncate(content, 200);

  try {
    const json = JSON.stringify(content);
    return truncate(json, 200);
  } catch {
    return truncate(String(content), 200);
  }
}

/** Truncate a string to maxLen, appending ellipsis if truncated. */
function truncate(s: string, maxLen: number): string {
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen - 3) + '...';
}

/**
 * Re-evaluate queued stimuli against updated keywords.
 * Returns stimuli that now match and those that remain queued.
 */
function reevaluateQueue(
  queue: CognitiveStimulus[],
  keywords: string[],
): { promoted: CognitiveStimulus[]; remaining: CognitiveStimulus[] } {
  const promoted: CognitiveStimulus[] = [];
  const remaining: CognitiveStimulus[] = [];

  for (const stimulus of queue) {
    if (isRelevantToTask(stimulus, keywords)) {
      promoted.push(stimulus);
    } else {
      remaining.push(stimulus);
    }
  }

  return { promoted, remaining };
}

// ── Factory ────────────────────────────────────────────────────────

/**
 * Create an Attention Filter cognitive module.
 *
 * The Attention Filter receives CognitiveStimulus events and partitions them
 * into accepted (enter workspace), queued (medium priority, await relevance),
 * and rejected (filtered out). Filtering rules follow Broadbent's early
 * selection model with Treisman's attenuation for medium-priority stimuli.
 */
export function createAttentionFilter(
  config?: AttentionFilterConfig,
): CognitiveModule<
  AttentionFilterInput,
  AttentionFilterOutput,
  AttentionFilterState,
  AttentionFilterMonitoring,
  AttentionFilterControl
> {
  const id = moduleId(config?.id ?? 'attention-filter');
  const maxQueueSize = config?.maxQueueSize ?? 50;

  return {
    id,

    async step(
      input: AttentionFilterInput,
      state: AttentionFilterState,
      control: AttentionFilterControl,
    ): Promise<StepResult<AttentionFilterOutput, AttentionFilterState, AttentionFilterMonitoring>> {
      const { stimuli, currentTaskKeywords } = input;
      const mindWandering = control.mindWanderingMode;

      const accepted: CognitiveStimulus[] = [];
      const queued: CognitiveStimulus[] = [];
      const rejected: CognitiveStimulus[] = [];

      // ── Classify incoming stimuli ──────────────────────────────
      for (const stimulus of stimuli) {
        const classification = classifyStimulus(stimulus, currentTaskKeywords, mindWandering);
        switch (classification) {
          case 'accept':
            accepted.push(stimulus);
            break;
          case 'queue':
            queued.push(stimulus);
            break;
          case 'reject':
            rejected.push(stimulus);
            break;
        }
      }

      // ── Re-evaluate existing queue against current keywords ────
      const { promoted, remaining } = reevaluateQueue(state.queue, currentTaskKeywords);
      accepted.push(...promoted);

      // ── Merge new queued stimuli with remaining queue ──────────
      const updatedQueue = [...remaining, ...queued];

      // Enforce max queue size — drop oldest if over capacity
      while (updatedQueue.length > maxQueueSize) {
        const evicted = updatedQueue.shift()!;
        rejected.push(evicted);
      }

      // ── Format accepted stimuli as workspace entries ───────────
      const workspaceEntries = accepted.map(formatStimulusForWorkspace);

      // ── Update state ──────────────────────────────────────────
      const newState: AttentionFilterState = {
        queue: updatedQueue,
        processedCount: state.processedCount + stimuli.length,
      };

      const monitoring: AttentionFilterMonitoring = {
        type: 'attention-filter',
        source: id,
        timestamp: Date.now(),
        acceptedCount: accepted.length,
        queuedCount: updatedQueue.length - remaining.length + queued.length,
        rejectedCount: rejected.length,
        queueDepth: updatedQueue.length,
        mindWanderingMode: mindWandering,
      };

      return {
        output: { accepted, queued, rejected, workspaceEntries },
        state: newState,
        monitoring,
      };
    },

    initialState(): AttentionFilterState {
      return {
        queue: [],
        processedCount: 0,
      };
    },

    stateInvariant(state: AttentionFilterState): boolean {
      return (
        Array.isArray(state.queue) &&
        state.queue.length <= maxQueueSize &&
        typeof state.processedCount === 'number' &&
        state.processedCount >= 0 &&
        state.queue.every(
          s =>
            typeof s.type === 'string' &&
            typeof s.priority === 'string' &&
            typeof s.source === 'string' &&
            typeof s.timestamp === 'number',
        )
      );
    },
  };
}
