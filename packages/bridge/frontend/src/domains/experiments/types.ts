/**
 * Experiments domain — frontend type definitions (PRD 041).
 *
 * Mirrors packages/bridge/src/domains/experiments/types.ts without Zod.
 * Pure TypeScript interfaces for HTTP consumer use.
 */

// ── Status enums ─────────────────────────────────────────────────

/** Lifecycle status of an experiment (aggregate entity). */
export type ExperimentStatus = 'drafting' | 'running' | 'analyzing' | 'concluded';

/** Lifecycle status of a single run (condition × task execution). */
export type RunStatus = 'running' | 'completed' | 'failed';

// ── Condition ────────────────────────────────────────────────────

/**
 * A condition is a named cognitive agent configuration.
 * Conditions are defined at experiment creation and referenced by name when
 * creating runs.
 */
export interface Condition {
  /** Human-readable name for this condition (e.g., "v2-enriched-ollama"). */
  name: string;
  /** Optional preset name to use as a base configuration. */
  preset?: string;
  /** Module-level override parameters applied on top of the preset. */
  overrides?: Record<string, unknown>;
  /** Provider configuration (type, model, baseUrl). */
  provider?: {
    type: string;
    model?: string;
    baseUrl?: string;
  };
  /** Workspace configuration overrides. */
  workspace?: {
    capacity?: number;
  };
  /** Cycle control overrides. */
  cycle?: {
    maxCycles?: number;
    maxToolsPerCycle?: number;
  };
}

// ── Experiment ───────────────────────────────────────────────────

/**
 * An experiment is a hypothesis with one or more conditions and tasks.
 * Runs are created by executing a specific condition × task combination.
 */
export interface Experiment {
  /** Unique ID (UUID). */
  id: string;
  /** Human-readable name. */
  name: string;
  /** The research hypothesis being tested. */
  hypothesis: string;
  /** Named configurations under comparison. */
  conditions: Condition[];
  /** Task prompts to run under each condition. */
  tasks: string[];
  /** Current lifecycle status. */
  status: ExperimentStatus;
  /** ISO 8601 creation timestamp. */
  createdAt: string;
  /** ISO 8601 last-update timestamp. */
  updatedAt: string;
}

// ── Run ──────────────────────────────────────────────────────────

/**
 * A run represents one execution of a condition × task pair within an
 * experiment.
 */
export interface Run {
  /** Unique ID (UUID). */
  id: string;
  /** Parent experiment ID. */
  experimentId: string;
  /** Which condition was used for this run (references Condition.name). */
  conditionName: string;
  /** The task prompt that was executed. */
  task: string;
  /** Current lifecycle status. */
  status: RunStatus;
  /** ISO 8601 timestamp when the run started. */
  startedAt: string;
  /** ISO 8601 timestamp when the run completed or failed (absent if still running). */
  completedAt?: string;
  /** Computed metrics (absent until run completes). */
  metrics?: RunMetrics;
  /** Captured run configuration (present after captureRunConfig is called). */
  config?: Record<string, unknown>;
}

// ── Metrics ──────────────────────────────────────────────────────

/**
 * Computed summary metrics for a completed run.
 * Written to metrics.json on run completion.
 */
export interface RunMetrics {
  /** Total cognitive cycles executed. */
  cycles: number;
  /** Total tokens consumed across all cycles. */
  totalTokens: number;
  /** Number of monitor interventions (control directives issued). */
  interventions: number;
  /** Number of workspace evictions performed. */
  evictions: number;
  /** Estimated cost in USD (if computable from token usage). */
  cost?: number;
  /** Human or LLM verdict on run quality ("pass" | "fail" | "partial" | freeform). */
  verdict?: string;
}

// ── TraceRecord ──────────────────────────────────────────────────

/**
 * A trace record is an event emitted during a cognitive cycle.
 * Persisted to events.jsonl. The `type` field is 'cognitive.*'.
 */
export interface TraceRecord {
  /** BridgeEvent ID. */
  id: string;
  /** ISO 8601 timestamp. */
  timestamp: string;
  /** BridgeEvent type (e.g., 'cognitive.module_step'). */
  type: string;
  /** Experiment ID from payload. */
  experimentId: string;
  /** Run ID from payload. */
  runId: string;
  /** Cycle number from payload. */
  cycleNumber?: number;
  /** Module ID from payload (for module_step events). */
  moduleId?: string;
  /** Execution phase from payload (e.g., 'monitor', 'reason', 'act'). */
  phase?: string;
  /** Full domain-specific payload. */
  payload: Record<string, unknown>;
}

// ── Trace filter ─────────────────────────────────────────────────

/**
 * Optional filter for useRunTraces().
 * All fields are optional — omitting a field means no filter on that dimension.
 */
export interface TraceFilter {
  /** Return only events from this cycle number. */
  cycleNumber?: number;
  /** Return only events from this module ID. */
  moduleId?: string;
  /** Return only events from this phase. */
  phase?: string;
}

// ── API response shapes ──────────────────────────────────────────

/** Response shape for GET /lab/:id */
export interface ExperimentDetailResponse {
  experiment: Experiment;
  runs: Run[];
}
