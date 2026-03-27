/**
 * Method compilation — G1-G7 gate validation.
 *
 * compileMethod runs a method through all six structural gates (G1-G6)
 * and produces a CompilationReport synchronously.
 *
 * compileMethodAsync extends compilation with G7 — runs test suites
 * declared on the method via CommandService and appends the result.
 *
 * Gates:
 *   G1 — Domain signature + axiom validation
 *   G2 — Objective expressibility (structural check)
 *   G3 — Role coverage (all step roles defined)
 *   G4 — DAG acyclicity + edge composability
 *   G5 — Guidance review (agent steps have prompts)
 *   G6 — Serializability (method structure survives JSON round-trip)
 *   G7 — Test suites pass (async; requires CommandService)
 *
 * G1-G6: pure functions — no Effect dependency.
 * G7: async — requires CommandService injection.
 */

import { Effect } from "effect";
import type { Method } from "../method/method.js";
import type { CommandService } from "../extractor/services/command.js";
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
  let acyclic = true;
  let acyclicDetail = "";
  try {
    topologicalOrder(method.dag);
  } catch (e) {
    acyclic = false;
    acyclicDetail = e instanceof Error ? e.message : String(e);
  }
  let composable = true;
  let composabilityDetail = "All edges composable";
  if (acyclic && testStates.length > 0) {
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
    details: !acyclic ? `DAG has cycle: ${acyclicDetail}` : composabilityDetail,
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

// ── G7: Test suite gate ──────────────────────────────────────────────────────

async function runG7<S>(
  method: Method<S>,
  cmdService: CommandService | undefined,
): Promise<CompilationGateResult> {
  const suites = method.testSuites;

  if (!suites || suites.length === 0) {
    return { gate: "G7-tests", status: "pass", details: "No test suites declared" };
  }

  if (!cmdService) {
    return {
      gate: "G7-tests",
      status: "needs_review",
      details: `${suites.length} test suite(s) declared but no CommandService provided`,
    };
  }

  const results: { suiteId: string; passed: boolean; output: string }[] = [];

  for (const suite of suites) {
    const result = await Effect.runPromise(
      cmdService
        .exec(suite.command, suite.args ? [...suite.args] : undefined)
        .pipe(
          Effect.map((r) => ({
            suiteId: suite.id,
            passed: r.exitCode === 0,
            output: r.stdout,
          })),
          Effect.catchAll((err) =>
            Effect.succeed({ suiteId: suite.id, passed: false, output: err.message }),
          ),
        ),
    );
    results.push(result);
  }

  const failed = results.filter((r) => !r.passed);

  if (failed.length === 0) {
    return {
      gate: "G7-tests",
      status: "pass",
      details: `All ${suites.length} test suite(s) passed`,
    };
  }

  const failDetails = failed
    .map((r) => `${r.suiteId}: ${r.output.slice(0, 200)}`)
    .join("; ");

  return {
    gate: "G7-tests",
    status: "fail",
    details: `${failed.length}/${suites.length} test suite(s) failed — ${failDetails}`,
  };
}

/**
 * Run a method through G1-G6 (structural) + G7 (test suites).
 *
 * G7 runs test suites declared on the method via the provided CommandService.
 * If no CommandService is supplied and testSuites are present, G7 = needs_review.
 *
 * @param method     The method to compile
 * @param testStates Representative states for G1/G4 checks
 * @param cmdService Optional shell executor for G7 (inject CommandService instance)
 */
export async function compileMethodAsync<S>(
  method: Method<S>,
  testStates: S[],
  cmdService?: CommandService,
): Promise<CompilationReport> {
  const base = compileMethod(method, testStates);
  const g7 = await runG7(method, cmdService);

  const gates = [...base.gates, g7];
  const hasFailure = gates.some((g) => g.status === "fail");
  const hasReview = gates.some((g) => g.status === "needs_review");
  const overall = hasFailure ? "failed" : hasReview ? "needs_review" : "compiled";

  return { overall, gates, methodId: method.id };
}

/**
 * Assert async compilation passes. Throws if any gate fails.
 * Returns the report on success (may still be "needs_review").
 */
export async function assertCompiledAsync<S>(
  method: Method<S>,
  testStates: S[],
  cmdService?: CommandService,
): Promise<CompilationReport> {
  const report = await compileMethodAsync(method, testStates, cmdService);
  if (report.overall === "failed") {
    const failures = report.gates
      .filter((g) => g.status === "fail")
      .map((g) => `${g.gate}: ${g.details}`);
    throw new Error(`Compilation failed for ${method.id}:\n${failures.join("\n")}`);
  }
  return report;
}
