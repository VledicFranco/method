// SPDX-License-Identifier: Apache-2.0
import { Effect } from "effect";
import { diff, type Diff } from "../state/world-state.js";

/** Result of reconciling parsed state against extracted (observed) state. */
export type ReconciliationResult<S> = {
  readonly status: "match" | "diverged" | "extraction_failed";
  readonly parsedState: S;
  readonly observedState: S | null;
  readonly diff: Diff<S> | null;
  readonly divergences: readonly ReconciliationDivergence[];
};

/** A specific field-level divergence between parsed and observed state. */
export type ReconciliationDivergence = {
  readonly field: string;
  readonly type: "added_by_agent" | "missing_from_agent" | "value_mismatch";
  readonly parsedValue: unknown;
  readonly observedValue: unknown;
};

/** Configuration for reconciliation behavior. */
export type ReconciliationConfig = {
  readonly mode: "warn" | "fail" | "ignore";
  readonly ignoredFields?: readonly string[];
  readonly toleranceMs?: number; // timing tolerance for Date comparisons
};

/**
 * Reconcile parsed agent output against re-extracted world state.
 *
 * After an agent claims it did X (parsed state), re-run extractors
 * to observe what actually happened. Diff the two and report divergences.
 */
export function reconcile<S extends Record<string, unknown>>(
  parsedState: S,
  observedState: S,
  config?: ReconciliationConfig,
): ReconciliationResult<S> {
  const ignoredFields = new Set(config?.ignoredFields ?? []);
  const stateDiff = diff(parsedState, observedState);

  const divergences: ReconciliationDivergence[] = [];

  // diff.added = keys in observed not in parsed → agent didn't report these
  for (const [field, value] of Object.entries(stateDiff.added)) {
    if (!ignoredFields.has(field)) {
      divergences.push({
        field,
        type: "missing_from_agent",
        parsedValue: undefined,
        observedValue: value,
      });
    }
  }

  // diff.removed = keys in parsed not in observed → agent claimed these but they don't exist
  for (const [field, value] of Object.entries(stateDiff.removed)) {
    if (!ignoredFields.has(field)) {
      divergences.push({
        field,
        type: "added_by_agent",
        parsedValue: value,
        observedValue: undefined,
      });
    }
  }

  // Fields with different values
  for (const [field, change] of Object.entries(stateDiff.changed)) {
    if (!ignoredFields.has(field)) {
      divergences.push({
        field,
        type: "value_mismatch",
        parsedValue: change.before, // parsed (before = first arg to diff)
        observedValue: change.after, // observed (after = second arg to diff)
      });
    }
  }

  return {
    status: divergences.length === 0 ? "match" : "diverged",
    parsedState,
    observedState,
    diff: divergences.length > 0 ? stateDiff : null,
    divergences,
  };
}

/**
 * Reconcile with an extractor Effect.
 * Runs the extractor, then diffs against parsed state.
 */
export function reconcileWithExtractor<S extends Record<string, unknown>, R>(
  parsedState: S,
  extractor: Effect.Effect<S, unknown, R>,
  config?: ReconciliationConfig,
): Effect.Effect<ReconciliationResult<S>, never, R> {
  return extractor.pipe(
    Effect.map((observed) => reconcile(parsedState, observed, config)),
    Effect.catchAll(() =>
      Effect.succeed<ReconciliationResult<S>>({
        status: "extraction_failed",
        parsedState,
        observedState: null,
        diff: null,
        divergences: [],
      }),
    ),
  );
}
