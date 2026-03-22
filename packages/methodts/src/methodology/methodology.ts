/**
 * Methodology<S> — Coalgebraic transition function.
 *
 * F1-FTH Definition 7.1: Φ = (D_Φ, δ_Φ, O_Φ)
 * A coalgebra for the functor F(X) = 1 + Method on Mod(D_Φ).
 *
 * @see theory-mapping.md — maps to Φ = (D_Φ, δ_Φ, O_Φ) coalgebra
 */

import type { DomainTheory } from "../domain/domain-theory.js";
import type { Predicate } from "../predicate/predicate.js";
import type { Method } from "../method/method.js";
import type { Measure } from "../method/measure.js";

/** Runtime execution bounds — pragmatic safety, NOT the termination certificate. */
export type SafetyBounds = {
  readonly maxLoops: number;
  readonly maxTokens: number;
  readonly maxCostUsd: number;
  readonly maxDurationMs: number;
  readonly maxDepth: number;
};

/** Well-founded measure with strict decrease argument. F1-FTH Definition 7.4. */
export type TerminationCertificate<S> = {
  readonly measure: (state: S) => number;
  readonly decreases: string;
};

/** An arm of the transition function (compiled priority-stack encoding of δ_Φ). */
export type Arm<S> = {
  readonly priority: number;
  readonly label: string;
  readonly condition: Predicate<S>;
  readonly selects: Method<S> | null;
  readonly rationale: string;
};

/** A methodology. F1-FTH Definition 7.1: Φ = (D_Φ, δ_Φ, O_Φ). */
export type Methodology<S> = {
  readonly id: string;
  readonly name: string;
  readonly domain: DomainTheory<S>;
  readonly arms: readonly Arm<S>[];
  readonly objective: Predicate<S>;
  readonly terminationCertificate: TerminationCertificate<S>;
  readonly safety: SafetyBounds;
};

/**
 * Wrap a single Method as a trivial one-arm Methodology.
 * Convenience for running a single method through the methodology runtime.
 */
export function asMethodology<S>(method: Method<S>): Methodology<S> {
  return {
    id: `auto-${method.id}`,
    name: method.name,
    domain: method.domain,
    arms: [
      {
        priority: 1,
        label: "terminate",
        condition: method.objective,
        selects: null,
        rationale: "Terminate when method objective is met.",
      },
      {
        priority: 2,
        label: "execute",
        condition: { tag: "val", value: true },
        selects: method,
        rationale: "Single-method methodology — always selects this method.",
      },
    ],
    objective: method.objective,
    terminationCertificate: { measure: (_) => 1, decreases: "Single method, terminates after one execution." },
    safety: { maxLoops: 2, maxTokens: 1_000_000, maxCostUsd: 50, maxDurationMs: 3_600_000, maxDepth: 3 },
  };
}
