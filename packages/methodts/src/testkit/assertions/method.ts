/**
 * Method assertions — compilation, DAG validity, role coverage.
 */

import {
  type Method,
  compileMethod,
  type CompilationReport,
  topologicalOrder,
  checkComposability,
} from "../../index.js";
import { formatCompilationReport } from "../diagnostics/report-printer.js";

/**
 * Assert that a method passes compilation (G1–G6).
 * Fails with a formatted per-gate report showing which gates failed.
 *
 * @example
 * ```ts
 * assertCompiles(M_TRIAGE, allStates);
 * ```
 */
export function assertCompiles<S>(method: Method<S>, testStates: S[]): CompilationReport {
  const report = compileMethod(method, testStates);
  if (report.overall === "failed") {
    throw new Error(
      `Compilation failed for ${method.id}:\n\n${formatCompilationReport(report)}`,
    );
  }
  return report;
}

/**
 * Assert that a method's step DAG is acyclic.
 * Fails with the step IDs if a cycle is detected.
 */
export function assertDAGAcyclic<S>(method: Method<S>): void {
  const order = topologicalOrder(method.dag);
  if (order.length !== method.dag.steps.length) {
    const inOrder = new Set(order.map((s) => s.id));
    const cyclic = method.dag.steps
      .filter((s) => !inOrder.has(s.id))
      .map((s) => s.id);
    throw new Error(
      `DAG for method "${method.id}" has a cycle involving steps: [${cyclic.join(", ")}]`,
    );
  }
}

/**
 * Assert that all edges in a method's step DAG are composable.
 * Composability: post(A) ⊆ pre(B) over the test states.
 */
export function assertDAGComposable<S>(method: Method<S>, testStates: S[]): void {
  if (testStates.length === 0) return;

  for (const edge of method.dag.edges) {
    const stepA = method.dag.steps.find((s) => s.id === edge.from);
    const stepB = method.dag.steps.find((s) => s.id === edge.to);
    if (!stepA || !stepB) {
      throw new Error(
        `DAG for method "${method.id}" references unknown step in edge ${edge.from} -> ${edge.to}`,
      );
    }
    const result = checkComposability(stepA, stepB, testStates);
    if (!result.composable) {
      throw new Error(
        `Edge ${edge.from} -> ${edge.to} in method "${method.id}" is not composable. ` +
        `Counterexample found.`,
      );
    }
  }
}

/**
 * Assert that all step roles are covered by the method's role definitions.
 */
export function assertRolesCovered<S>(method: Method<S>): void {
  const stepRoles = new Set(method.dag.steps.map((s) => s.role));
  const definedRoles = new Set(method.roles.map((r) => r.id));
  const uncovered = [...stepRoles].filter((r) => !definedRoles.has(r));
  if (uncovered.length > 0) {
    throw new Error(
      `Method "${method.id}" has uncovered roles: [${uncovered.join(", ")}]. ` +
      `Defined roles: [${[...definedRoles].join(", ")}]`,
    );
  }
}
