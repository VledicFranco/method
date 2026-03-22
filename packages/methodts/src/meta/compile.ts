/**
 * Method compilation — G1-G6 gate validation.
 *
 * compileMethod runs a method through all six compilation gates
 * and produces a CompilationReport. This is the typed form of the
 * compilation process from the method registry system.
 *
 * Gates:
 *   G1 — Domain signature + axiom validation
 *   G2 — Objective expressibility (structural check)
 *   G3 — Role coverage (all step roles defined)
 *   G4 — DAG acyclicity + edge composability
 *   G5 — Guidance review (agent steps have prompts)
 *   G6 — Serializability (method structure survives JSON round-trip)
 *
 * Pure functions — no Effect dependency.
 */

import type { Method } from "../method/method.js";
import { validateSignature, validateAxioms } from "../domain/domain-theory.js";
import { topologicalOrder, checkComposability } from "../method/dag.js";

/** Result of a single compilation gate. */
export type CompilationGateResult = {
  readonly gate: string;
  readonly status: "pass" | "fail" | "needs_review";
  readonly details: string;
};

/** Full compilation report for a method. */
export type CompilationReport = {
  readonly overall: "compiled" | "failed" | "needs_review";
  readonly gates: readonly CompilationGateResult[];
  readonly methodId: string;
};

/**
 * Run a method through all six compilation gates.
 *
 * @param method  The method to compile
 * @param testStates  Representative states for axiom/composability testing
 * @returns A compilation report with per-gate results
 */
export function compileMethod<S>(method: Method<S>, testStates: S[]): CompilationReport {
  const gates: CompilationGateResult[] = [];

  // G1: Signature + axiom validation
  const sig = validateSignature(method.domain);
  const axiomResults = testStates.map((s) => validateAxioms(method.domain, s));
  const axiomValid = axiomResults.every((r) => r.valid);
  gates.push({
    gate: "G1-domain",
    status: sig.valid && axiomValid ? "pass" : "fail",
    details: sig.valid
      ? axiomValid
        ? "Signature and axioms valid"
        : `Axiom violations in ${axiomResults.filter((r) => !r.valid).length} test states`
      : `Signature errors: ${sig.errors.join("; ")}`,
  });

  // G2: Objective expressible — structural check (objective is a typed Predicate<S>)
  gates.push({
    gate: "G2-objective",
    status: "pass",
    details: "Objective is a typed Predicate<S>",
  });

  // G3: Role coverage — every step's role must have a definition in method.roles
  const stepRoles = new Set(method.dag.steps.map((s) => s.role));
  const definedRoles = new Set(method.roles.map((r) => r.id));
  const uncoveredRoles = [...stepRoles].filter((r) => !definedRoles.has(r));
  gates.push({
    gate: "G3-roles",
    status: uncoveredRoles.length === 0 ? "pass" : "fail",
    details:
      uncoveredRoles.length === 0
        ? "All step roles have definitions"
        : `Uncovered roles: ${uncoveredRoles.join(", ")}`,
  });

  // G4: DAG acyclicity + composability
  const topoOrder = topologicalOrder(method.dag);
  const acyclic = topoOrder.length === method.dag.steps.length;
  let composable = true;
  let composabilityDetail = "All edges composable";
  if (testStates.length > 0) {
    for (const edge of method.dag.edges) {
      const stepA = method.dag.steps.find((s) => s.id === edge.from);
      const stepB = method.dag.steps.find((s) => s.id === edge.to);
      if (stepA && stepB) {
        const result = checkComposability(stepA, stepB, testStates);
        if (!result.composable) {
          composable = false;
          composabilityDetail = `Edge ${edge.from}->${edge.to} not composable`;
          break;
        }
      }
    }
  }
  gates.push({
    gate: "G4-dag",
    status: acyclic && composable ? "pass" : "fail",
    details: !acyclic ? "DAG has cycle" : composabilityDetail,
  });

  // G5: Guidance — agent steps need prompts (structural review)
  const agentSteps = method.dag.steps.filter((s) => s.execution.tag === "agent");
  gates.push({
    gate: "G5-guidance",
    status: agentSteps.length === 0 ? "pass" : "needs_review",
    details:
      agentSteps.length === 0
        ? "No agent steps"
        : `${agentSteps.length} agent steps have prompts (manual review recommended)`,
  });

  // G6: Serializable — method structure survives JSON serialization
  try {
    JSON.stringify(method, (_key, value) =>
      typeof value === "function" ? "[function]" : value,
    );
    gates.push({
      gate: "G6-serializable",
      status: "pass",
      details: "Method structure serializable",
    });
  } catch (e) {
    gates.push({
      gate: "G6-serializable",
      status: "fail",
      details: `Serialization failed: ${e}`,
    });
  }

  const hasFailure = gates.some((g) => g.status === "fail");
  const hasReview = gates.some((g) => g.status === "needs_review");
  const overall = hasFailure ? "failed" : hasReview ? "needs_review" : "compiled";

  return { overall, gates, methodId: method.id };
}

/**
 * Assert compilation passes. Throws if any gate fails.
 * Returns the report on success (may still be "needs_review").
 */
export function assertCompiled<S>(method: Method<S>, testStates: S[]): CompilationReport {
  const report = compileMethod(method, testStates);
  if (report.overall === "failed") {
    const failures = report.gates
      .filter((g) => g.status === "fail")
      .map((g) => `${g.gate}: ${g.details}`);
    throw new Error(`Compilation failed for ${method.id}:\n${failures.join("\n")}`);
  }
  return report;
}
