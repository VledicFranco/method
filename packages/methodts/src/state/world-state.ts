/**
 * WorldState<S> — First-class state tracking.
 *
 * The Σ-structure (value: S) enriched with axiom validation status.
 * Operational metadata lives in Snapshot<S>, not here.
 *
 * @see F1-FTH Def 1.2/1.3 — WorldState.value is A ∈ Mod(D)
 */

import type { EvalTrace } from "../predicate/evaluate.js";
import type { Predicate } from "../predicate/predicate.js";

/** The instantiated domain state at a point in time. */
export type WorldState<S> = {
  readonly value: S;
  readonly axiomStatus: { readonly valid: boolean; readonly violations: readonly string[] };
};

/** A frozen state with execution metadata. */
export type Snapshot<S> = {
  readonly state: WorldState<S>;
  readonly sequence: number;
  readonly timestamp: Date;
  readonly delta: Diff<S> | null;
  readonly witnesses: readonly Witness<any>[];
  readonly metadata: {
    readonly producedBy?: string;
    readonly stepId?: string;
    readonly methodId?: string;
  };
};

/** Structural diff between two states. */
export type Diff<S> = {
  readonly added: Readonly<Record<string, unknown>>;
  readonly removed: Readonly<Record<string, unknown>>;
  readonly changed: Readonly<Record<string, { readonly before: unknown; readonly after: unknown }>>;
};

/** Evidence that a predicate held at evaluation time. */
export type Witness<S> = {
  readonly predicate: Predicate<S>;
  readonly evaluatedAt: Date;
  readonly trace: EvalTrace;
};

/** Full execution trace — ordered sequence of snapshots. */
export type StateTrace<S> = {
  readonly snapshots: readonly Snapshot<S>[];
  readonly initial: WorldState<S>;
  readonly current: WorldState<S>;
};

/** Compute a structural diff between two state values. */
export function diff<S extends Record<string, unknown>>(before: S, after: S): Diff<S> {
  const added: Record<string, unknown> = {};
  const removed: Record<string, unknown> = {};
  const changed: Record<string, { before: unknown; after: unknown }> = {};

  const allKeys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const key of allKeys) {
    const inBefore = key in before;
    const inAfter = key in after;
    if (!inBefore && inAfter) {
      added[key] = after[key];
    } else if (inBefore && !inAfter) {
      removed[key] = before[key];
    } else if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
      changed[key] = { before: before[key], after: after[key] };
    }
  }

  return { added, removed, changed };
}
