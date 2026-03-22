/**
 * Implementation Derivation Document (IDD) generation and faithfulness checking.
 *
 * deriveIDD: Given a compiled method, produces a structured document
 * capturing what each step does, what role executes it, and what
 * pre/postconditions constrain it — structured for implementers.
 *
 * checkFaithfulness: Validates that a method has all the structural
 * elements needed for correct execution (roles defined, conditions
 * non-trivial, no orphan steps).
 *
 * Pure functions — no Effect dependency.
 */

import type { Method } from "../method/method.js";
import type { Step } from "../method/step.js";
import { topologicalOrder } from "../method/dag.js";

/** An Implementation Derivation Document (IDD). */
export type IDD = {
  readonly methodId: string;
  readonly methodName: string;
  readonly sections: readonly IDDSection[];
  readonly generatedAt: Date;
};

export type IDDSection = {
  readonly stepId: string;
  readonly stepName: string;
  readonly role: string;
  readonly precondition: string;
  readonly postcondition: string;
  readonly implementationNotes: string;
  readonly tools: readonly string[];
};

/** Result of a faithfulness check. */
export type FaithfulnessResult = {
  readonly faithful: boolean;
  readonly gaps: readonly FaithfulnessGap[];
};

export type FaithfulnessGap = {
  readonly stepId: string;
  readonly type: "missing_precondition" | "missing_postcondition" | "missing_guidance" | "missing_role" | "orphan_step";
  readonly description: string;
};

/**
 * Derive an Implementation Derivation Document from a compiled method.
 * The IDD captures what each step does, what role executes it, and
 * what pre/postconditions constrain it — structured for implementers.
 */
export function deriveIDD<S>(method: Method<S>): IDD {
  const orderedSteps = topologicalOrder(method.dag);

  const sections: IDDSection[] = orderedSteps.map((step) => ({
    stepId: step.id,
    stepName: step.name,
    role: step.role,
    precondition: step.precondition.tag === "check" ? step.precondition.label : step.precondition.tag,
    postcondition: step.postcondition.tag === "check" ? step.postcondition.label : step.postcondition.tag,
    implementationNotes:
      step.execution.tag === "agent"
        ? `Agent step: role=${step.role}, context-driven`
        : `Script step: deterministic TypeScript execution`,
    tools: step.tools ?? [],
  }));

  return {
    methodId: method.id,
    methodName: method.name,
    sections,
    generatedAt: new Date(),
  };
}

/**
 * Check faithfulness of a method: does it have all the structural
 * elements needed for correct execution?
 */
export function checkFaithfulness<S>(method: Method<S>): FaithfulnessResult {
  const gaps: FaithfulnessGap[] = [];
  const orderedSteps = topologicalOrder(method.dag);
  const roleIds = new Set(method.roles.map((r) => r.id));

  for (const step of orderedSteps) {
    // Check role exists
    if (!roleIds.has(step.role)) {
      gaps.push({
        stepId: step.id,
        type: "missing_role",
        description: `Step "${step.name}" references role "${step.role}" which is not defined`,
      });
    }

    // Check precondition is not trivially TRUE for non-initial steps
    if (step.id !== method.dag.initial && step.precondition.tag === "val" && step.precondition.value === true) {
      gaps.push({
        stepId: step.id,
        type: "missing_precondition",
        description: `Non-initial step "${step.name}" has trivial TRUE precondition`,
      });
    }

    // Check postcondition is not trivially TRUE for non-terminal steps
    if (step.id !== method.dag.terminal && step.postcondition.tag === "val" && step.postcondition.value === true) {
      gaps.push({
        stepId: step.id,
        type: "missing_postcondition",
        description: `Non-terminal step "${step.name}" has trivial TRUE postcondition`,
      });
    }
  }

  // Check for orphan steps (in DAG but not reachable)
  if (orderedSteps.length < method.dag.steps.length) {
    const reachable = new Set(orderedSteps.map((s) => s.id));
    for (const step of method.dag.steps) {
      if (!reachable.has(step.id)) {
        gaps.push({
          stepId: step.id,
          type: "orphan_step",
          description: `Step "${step.name}" is not reachable in the DAG`,
        });
      }
    }
  }

  return { faithful: gaps.length === 0, gaps };
}
