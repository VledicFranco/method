// SPDX-License-Identifier: Apache-2.0
/**
 * Methodology builder — construct Methodology<S> with fluent API.
 */

import {
  type Methodology,
  type Arm,
  type DomainTheory,
  type Method,
  type Predicate,
  type SafetyBounds,
  type TerminationCertificate,
  TRUE,
} from "../../index.js";

type MethodologyBuilderState<S> = {
  id: string;
  name: string;
  domain: DomainTheory<S> | null;
  arms: Arm<S>[];
  objective: Predicate<S>;
  terminationCertificate: TerminationCertificate<S>;
  safety: SafetyBounds;
};

export type MethodologyBuilder<S> = {
  /** Set methodology name. */
  name(name: string): MethodologyBuilder<S>;
  /** Set domain theory. */
  domain(domain: DomainTheory<S>): MethodologyBuilder<S>;
  /** Add a routing arm. Pass null for selects to create a termination arm. */
  arm(priority: number, label: string, condition: Predicate<S>, selects: Method<S> | null, rationale?: string): MethodologyBuilder<S>;
  /** Set the methodology objective predicate. */
  objective(pred: Predicate<S>): MethodologyBuilder<S>;
  /** Set the termination certificate. */
  terminationMeasure(measure: (s: S) => number, decreases: string): MethodologyBuilder<S>;
  /** Set safety bounds. */
  safety(bounds: Partial<SafetyBounds>): MethodologyBuilder<S>;
  /** Build the Methodology. */
  build(): Methodology<S>;
};

const DEFAULT_SAFETY: SafetyBounds = {
  maxLoops: 20,
  maxTokens: 1_000_000,
  maxCostUsd: 50,
  maxDurationMs: 120_000,
  maxDepth: 5,
};

/**
 * Create a fluent methodology builder.
 *
 * @example
 * ```ts
 * const methodology = methodologyBuilder<MyState>("PHI_TASKS")
 *   .name("Task Management")
 *   .domain(D_TASKS)
 *   .arm(1, "pick", hasOpen, pickMethod)
 *   .arm(2, "complete", hasCurrent, completeMethod)
 *   .arm(3, "terminate", allDone, null)
 *   .objective(allDone)
 *   .terminationMeasure(s => s.remaining, "Remaining decreases each cycle.")
 *   .build();
 * ```
 */
export function methodologyBuilder<S>(id: string): MethodologyBuilder<S> {
  const state: MethodologyBuilderState<S> = {
    id,
    name: id,
    domain: null,
    arms: [],
    objective: TRUE as Predicate<S>,
    terminationCertificate: {
      measure: () => 1,
      decreases: "No termination argument provided.",
    },
    safety: DEFAULT_SAFETY,
  };

  const builder: MethodologyBuilder<S> = {
    name(name) {
      state.name = name;
      return builder;
    },
    domain(domain) {
      state.domain = domain;
      return builder;
    },
    arm(priority, label, condition, selects, rationale) {
      state.arms.push({
        priority,
        label,
        condition,
        selects,
        rationale: rationale ?? label,
      });
      return builder;
    },
    objective(pred) {
      state.objective = pred;
      return builder;
    },
    terminationMeasure(measure, decreases) {
      state.terminationCertificate = { measure, decreases };
      return builder;
    },
    safety(bounds) {
      state.safety = { ...state.safety, ...bounds };
      return builder;
    },
    build(): Methodology<S> {
      const domain = state.domain ?? emptyDomain<S>(state.id);

      return {
        id: state.id,
        name: state.name,
        domain,
        arms: state.arms,
        objective: state.objective,
        terminationCertificate: state.terminationCertificate,
        safety: state.safety,
      };
    },
  };

  return builder;
}

function emptyDomain<S>(methodologyId: string): DomainTheory<S> {
  return {
    id: `D_${methodologyId}`,
    signature: { sorts: [], functionSymbols: [], predicates: {} },
    axioms: {},
  };
}
