/**
 * Observer DSL types — typed representations for Observer module input/output.
 *
 * The Observer module processes novelty signals from input processing and
 * produces an attention priority report (PRIORITY, FOCUS, NOVELTY, NOTE).
 *
 * Training format defined in phase-2-dsl/scripts/generate-observer-corpus.py.
 */

// ── Input Signal ───────────────────────────────────────────────

/** Content type of an observer signal. */
export type ObserverContentType = 'text' | 'code' | 'error' | 'tool-output';

/** Valid observer IDs used in the training corpus. */
export type ObserverId = 'main' | 'secondary' | 'tertiary' | 'aux' | 'ctx';

/** A single observer input signal. */
export interface ObserverSignalInput {
  id: string;
  novelty: number;
  processed: boolean;
  content: ObserverContentType;
}

// ── Output Report ──────────────────────────────────────────────

/** Priority level emitted by the Observer. */
export type ObserverPriority = 'high' | 'medium' | 'low';

/** Structured report parsed from Observer DSL output. */
export interface ObserverReport {
  priority: ObserverPriority;
  focus: string[];
  novelty: number;
  note: string | null;
}
