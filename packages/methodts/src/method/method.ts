// SPDX-License-Identifier: Apache-2.0
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

/**
 * A test suite associated with a method.
 *
 * Declared on the method so the method is self-describing.
 * Executed by G7 during compileMethodAsync to verify that
 * the method's test suites pass before marking it compiled.
 */
export type MethodTestSuite = {
  readonly id: string;
  readonly name: string;
  readonly command: string;
  readonly args?: readonly string[];
};

/** A compiled method. F1-FTH Definition 6.1. */
export type Method<S> = {
  readonly id: string;
  readonly name: string;
  readonly domain: DomainTheory<S>;
  readonly roles: readonly Role<S, unknown>[];
  readonly dag: StepDAG<S>;
  readonly objective: Predicate<S>;
  readonly measures: readonly Measure<S>[];
  /** Optional test suites validated by G7 during compileMethodAsync. */
  readonly testSuites?: readonly MethodTestSuite[];
};
