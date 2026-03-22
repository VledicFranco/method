/**
 * Method refinement verification — F1-FTH Definition 8.2.
 *
 * Verifies that a refined method preserves the structural and behavioral
 * properties of the original method it refines.
 *
 * Pure function — no Effect dependency, no side effects.
 *
 * @see F1-FTH Def 8.2 — Refinement preserves domain, steps, objective, roles
 */

import type { Method } from "../method/method.js";
import { evaluate } from "../predicate/evaluate.js";

/** Refinement verification result (method-level, F1-FTH Def 8.2). */
export type RefinementResult = {
  readonly valid: boolean;
  readonly checks: readonly RefinementCheck[];
};

/** A single refinement check with pass/fail and human-readable detail. */
export type RefinementCheck = {
  readonly name: string;
  readonly passed: boolean;
  readonly detail: string;
};

/**
 * Verify that method B is a valid refinement of method A.
 *
 * F1-FTH Def 8.2: A refinement preserves:
 * 1. Domain sort preservation (B's sorts include all of A's)
 * 2. Step preservation (A's step IDs exist in B, possibly refined)
 * 3. Objective compatibility (B's objective is at least as strong as A's over test states)
 * 4. Role preservation (B's roles include all of A's)
 *
 * @param original - The original method being refined
 * @param refined  - The proposed refinement
 * @param testStates - Concrete states for property-based objective compatibility checking
 * @returns RefinementResult with validity and per-check breakdown
 */
export function verifyRefinement<S>(
  original: Method<S>,
  refined: Method<S>,
  testStates: S[],
): RefinementResult {
  const checks: RefinementCheck[] = [];

  // Check 1: Domain sort preservation
  const origSorts = new Set(original.domain.signature.sorts.map((s) => s.name));
  const refSorts = new Set(refined.domain.signature.sorts.map((s) => s.name));
  const missingSorts = [...origSorts].filter((s) => !refSorts.has(s));
  checks.push({
    name: "sort_preservation",
    passed: missingSorts.length === 0,
    detail:
      missingSorts.length === 0
        ? "All original sorts preserved"
        : `Missing sorts: ${missingSorts.join(", ")}`,
  });

  // Check 2: Step preservation
  const origStepIds = new Set(original.dag.steps.map((s) => s.id));
  const refStepIds = new Set(refined.dag.steps.map((s) => s.id));
  const missingSteps = [...origStepIds].filter((id) => !refStepIds.has(id));
  checks.push({
    name: "step_preservation",
    passed: missingSteps.length === 0,
    detail:
      missingSteps.length === 0
        ? "All original steps preserved"
        : `Missing steps: ${missingSteps.join(", ")}`,
  });

  // Check 3: Objective compatibility (refined objective must be at least as strong)
  // If original says "done" for a state, refined must also say "done" for that state.
  let objectiveCompatible = true;
  for (const state of testStates) {
    if (evaluate(original.objective, state) && !evaluate(refined.objective, state)) {
      // Original says done but refined doesn't — refined is weaker, NOT a valid refinement
      objectiveCompatible = false;
      break;
    }
  }
  checks.push({
    name: "objective_compatibility",
    passed: objectiveCompatible,
    detail: objectiveCompatible
      ? "Refined objective is at least as strong"
      : "Refined objective is weaker than original",
  });

  // Check 4: Role preservation
  const origRoles = new Set(original.roles.map((r) => r.id));
  const refRoles = new Set(refined.roles.map((r) => r.id));
  const missingRoles = [...origRoles].filter((id) => !refRoles.has(id));
  checks.push({
    name: "role_preservation",
    passed: missingRoles.length === 0,
    detail:
      missingRoles.length === 0
        ? "All original roles preserved"
        : `Missing roles: ${missingRoles.join(", ")}`,
  });

  return { valid: checks.every((c) => c.passed), checks };
}
