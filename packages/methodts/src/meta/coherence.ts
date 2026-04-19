// SPDX-License-Identifier: Apache-2.0
/**
 * Inter-method coherence checking.
 *
 * F1-FTH Definition 7.3: Methods within a methodology must be coherent:
 * 1. No dead arms — every arm's condition should be satisfiable
 * 2. Terminate arm exists — at least one arm selects null (termination)
 * 3. Terminate reachable — the terminate arm fires for at least one test state
 * 4. Unique priorities — no duplicate arm priorities (unambiguous routing)
 * 5. Domain satisfiable — methodology's domain axioms hold for at least one test state
 */

import type { Methodology } from "../methodology/methodology.js";
import { evaluate } from "../predicate/evaluate.js";
import { validateAxioms } from "../domain/domain-theory.js";

/** Result of inter-method coherence checking. */
export type CoherenceResult = {
  readonly coherent: boolean;
  readonly checks: readonly CoherenceCheck[];
};

export type CoherenceCheck = {
  readonly name: string;
  readonly passed: boolean;
  readonly detail: string;
};

/**
 * Check inter-method coherence within a methodology.
 *
 * Evaluates five coherence properties over a set of representative test states.
 * All checks must pass for the methodology to be considered coherent.
 *
 * @param methodology  The methodology to check
 * @param testStates   Representative states from Mod(D) for empirical checking
 * @returns CoherenceResult with per-check details
 */
export function checkCoherence<S>(
  methodology: Methodology<S>,
  testStates: S[],
): CoherenceResult {
  const checks: CoherenceCheck[] = [];

  // Check 1: No dead arms — every arm fires for at least one test state
  const armFires = new Map<string, boolean>();
  for (const arm of methodology.arms) {
    const fires = testStates.some((s) => evaluate(arm.condition, s));
    armFires.set(arm.label, fires);
  }
  const deadArms = [...armFires.entries()]
    .filter(([, fires]) => !fires)
    .map(([label]) => label);
  checks.push({
    name: "no_dead_arms",
    passed: deadArms.length === 0,
    detail:
      deadArms.length === 0
        ? "All arms fire for at least one test state"
        : `Dead arms: ${deadArms.join(", ")}`,
  });

  // Check 2: Terminate arm exists (selects: null)
  const hasTerminate = methodology.arms.some((a) => a.selects === null);
  checks.push({
    name: "terminate_arm_exists",
    passed: hasTerminate,
    detail: hasTerminate
      ? "Terminate arm found"
      : "No terminate arm (selects: null) found",
  });

  // Check 3: Terminate arm is reachable from at least one test state
  const terminateArm = methodology.arms.find((a) => a.selects === null);
  const terminateReachable = terminateArm
    ? testStates.some((s) => evaluate(terminateArm.condition, s))
    : false;
  checks.push({
    name: "terminate_reachable",
    passed: terminateReachable,
    detail: terminateReachable
      ? "Terminate arm fires for at least one test state"
      : "Terminate arm never fires over test states",
  });

  // Check 4: Unique priorities — no duplicate arm priorities
  const priorities = methodology.arms.map((a) => a.priority);
  const uniquePriorities = new Set(priorities);
  checks.push({
    name: "unique_priorities",
    passed: priorities.length === uniquePriorities.size,
    detail:
      priorities.length === uniquePriorities.size
        ? "All arm priorities are unique"
        : "Duplicate priorities detected",
  });

  // Check 5: Domain satisfiable — at least one test state satisfies all axioms
  const domainValid = testStates.some(
    (s) => validateAxioms(methodology.domain, s).valid,
  );
  checks.push({
    name: "domain_satisfiable",
    passed: domainValid,
    detail: domainValid
      ? "Domain axioms satisfiable by test states"
      : "No test state satisfies all domain axioms",
  });

  return { coherent: checks.every((c) => c.passed), checks };
}
