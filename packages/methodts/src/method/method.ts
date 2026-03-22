/**
 * Method<S> — The 5-tuple from F1-FTH Definition 6.1.
 *
 * M = (D, Roles, Γ, O, μ⃗)
 */

import type { DomainTheory } from "../domain/domain-theory.js";
import type { Role } from "../domain/role.js";
import type { Predicate } from "../predicate/predicate.js";
import type { StepDAG } from "./dag.js";
import type { Measure } from "./measure.js";

/** A compiled method. F1-FTH Definition 6.1. */
export type Method<S> = {
  readonly id: string;
  readonly name: string;
  readonly domain: DomainTheory<S>;
  readonly roles: readonly Role<S, any>[];
  readonly dag: StepDAG<S>;
  readonly objective: Predicate<S>;
  readonly measures: readonly Measure<S>[];
};
