// SPDX-License-Identifier: Apache-2.0
/**
 * M2_DIMPL — Distributed Implementation Method (M2-DIMPL v1.0).
 *
 * 5 steps in a linear DAG: Decompose → Dispatch → Gate A (Quality Review) →
 * Gate B (Security & Architecture) → Integrate.
 *
 * Re-entrant orchestration method for software implementation. Decomposes a
 * multi-task phase into parallel sub-tasks, dispatches impl-sub-agents, evaluates
 * results through Gate A (quality) and Gate B (security/architecture), patches
 * failures, and iterates until all gates pass or budget exhausted.
 *
 * Phase 1b: all steps are script execution. Agent prompts are deferred
 * to Phase 2 when the provider system is wired in.
 */

import { Effect } from "effect";
import type { Method } from "../../../method/method.js";
import type { Step } from "../../../method/step.js";
import type { StepDAG } from "../../../method/dag.js";
import type { DomainTheory } from "../../../domain/domain-theory.js";
import type { Role } from "../../../domain/role.js";
import { check, TRUE } from "../../../predicate/predicate.js";

// ── State ──

type DimplState = {
  readonly tasks: readonly { readonly id: string; readonly description: string; readonly fileScope: readonly string[] }[];
  readonly coverageVerified: boolean;
  readonly independenceVerified: boolean;
  readonly allResultsReceived: boolean;
  readonly gateAResults: readonly { readonly taskId: string; readonly verdict: "PASS" | "FAIL"; readonly patchCount: number }[];
  readonly allGateAPass: boolean;
  readonly terminalFailures: readonly string[];
  readonly gateBVerdict: "PASS" | "FAIL" | "GAP_DOCUMENTED" | null;
  readonly gateBFindings: readonly string[];
  readonly sessionLogAssembled: boolean;
  readonly compileExit: 0 | number;
  readonly regressionCount: number;
  readonly outcome: "PASS" | "FAIL" | null;
};

// ── Domain Theory ──

const D_DIMPL: DomainTheory<DimplState> = {
  id: "D_DIMPL",
  signature: {
    sorts: [
      { name: "PhaseDoc", description: "The phase plan produced by M5-PLAN", cardinality: "singleton" },
      { name: "Task", description: "A scoped unit of implementation work from the PhaseDoc", cardinality: "finite" },
      { name: "FileScope", description: "The authorized set of source/test files a sub-agent may read and write", cardinality: "finite" },
      { name: "SubAgent", description: "An impl-sub-agent assigned to execute one Task", cardinality: "finite" },
      { name: "TaskResult", description: "Output: files changed, divergences, test results, status", cardinality: "finite" },
      { name: "GateAVerdict", description: "Per-task quality review verdict: PASS or FAIL", cardinality: "finite" },
      { name: "GateBVerdict", description: "Session-level security/architecture verdict", cardinality: "finite" },
      { name: "PatchResult", description: "Output of a patch sub-agent dispatched after Gate A FAIL", cardinality: "finite" },
      { name: "SessionLog", description: "Integrated record of all task results, gate verdicts, patches", cardinality: "singleton" },
    ],
    functionSymbols: [],
    predicates: {
      tasks_decomposed: check<DimplState>("tasks_decomposed", (s) => s.tasks.length > 0 && s.coverageVerified && s.independenceVerified),
      all_dispatched: check<DimplState>("all_dispatched", (s) => s.allResultsReceived),
      gate_a_complete: check<DimplState>("gate_a_complete", (s) => s.gateAResults.length >= s.tasks.length),
      gate_b_complete: check<DimplState>("gate_b_complete", (s) => s.gateBVerdict !== null),
      integrated: check<DimplState>("integrated", (s) => s.sessionLogAssembled && s.outcome !== null),
    },
  },
  axioms: {},
};

// ── Roles ──

const orchestrator: Role<DimplState> = {
  id: "orchestrator",
  description: "Holds architectural context across the full phase. Decomposes, dispatches, evaluates gates, assembles SessionLog.",
  observe: (s) => s,
  authorized: ["sigma_0", "sigma_1", "sigma_2", "sigma_3", "sigma_4"],
  notAuthorized: [],
};

const implSubAgent: Role<DimplState> = {
  id: "impl_sub_agent",
  description: "Executes one Task within its FileScope. Returns TaskResult.",
  observe: (s) => s,
  authorized: [],
  notAuthorized: [],
};

const qaSubAgent: Role<DimplState> = {
  id: "qa_sub_agent",
  description: "Gate A quality reviewer. Checks compilation, test regression, scope discipline.",
  observe: (s) => s,
  authorized: [],
  notAuthorized: [],
};

const secArchSubAgent: Role<DimplState> = {
  id: "sec_arch_sub_agent",
  description: "Gate B security and architecture verifier.",
  observe: (s) => s,
  authorized: [],
  notAuthorized: [],
};

// ── Steps ──

const steps: Step<DimplState>[] = [
  {
    id: "sigma_0",
    name: "Decompose",
    role: "orchestrator",
    precondition: TRUE,
    postcondition: check("tasks_decomposed", (s: DimplState) => s.tasks.length > 0 && s.coverageVerified && s.independenceVerified),
    execution: { tag: "script", execute: (s) => Effect.succeed(s) },
  },
  {
    id: "sigma_1",
    name: "Dispatch",
    role: "orchestrator",
    precondition: check("tasks_decomposed", (s: DimplState) => s.tasks.length > 0 && s.coverageVerified && s.independenceVerified),
    postcondition: check("all_dispatched", (s: DimplState) => s.allResultsReceived),
    execution: { tag: "script", execute: (s) => Effect.succeed(s) },
  },
  {
    id: "sigma_2",
    name: "Gate A — Quality Review",
    role: "orchestrator",
    precondition: check("all_dispatched", (s: DimplState) => s.allResultsReceived),
    postcondition: check("gate_a_complete", (s: DimplState) => s.gateAResults.length >= s.tasks.length),
    execution: { tag: "script", execute: (s) => Effect.succeed(s) },
  },
  {
    id: "sigma_3",
    name: "Gate B — Security & Architecture",
    role: "orchestrator",
    precondition: check("gate_a_complete", (s: DimplState) => s.gateAResults.length >= s.tasks.length),
    postcondition: check("gate_b_complete", (s: DimplState) => s.gateBVerdict !== null),
    execution: { tag: "script", execute: (s) => Effect.succeed(s) },
  },
  {
    id: "sigma_4",
    name: "Integrate",
    role: "orchestrator",
    precondition: check("gate_b_complete", (s: DimplState) => s.gateBVerdict !== null),
    postcondition: check("integrated", (s: DimplState) => s.sessionLogAssembled && s.outcome !== null),
    execution: { tag: "script", execute: (s) => Effect.succeed(s) },
  },
];

// ── DAG ──

const dag: StepDAG<DimplState> = {
  steps,
  edges: [
    { from: "sigma_0", to: "sigma_1" },
    { from: "sigma_1", to: "sigma_2" },
    { from: "sigma_2", to: "sigma_3" },
    { from: "sigma_3", to: "sigma_4" },
  ],
  initial: "sigma_0",
  terminal: "sigma_4",
};

// ── Progress measure ──

function dimplProgress(s: DimplState): number {
  let stage = 0;
  if (s.tasks.length > 0 && s.coverageVerified && s.independenceVerified) stage = 1;
  if (s.allResultsReceived) stage = 2;
  if (s.gateAResults.length >= s.tasks.length && s.tasks.length > 0) stage = 3;
  if (s.gateBVerdict !== null) stage = 4;
  if (s.sessionLogAssembled && s.outcome !== null) stage = 5;
  return stage / 5;
}

// ── Method ──

/** M2_DIMPL — Distributed Implementation Method (v1.0). 5 steps, linear DAG. */
export const M2_DIMPL: Method<DimplState> = {
  id: "M2-DIMPL",
  name: "Distributed Implementation Method",
  domain: D_DIMPL,
  roles: [orchestrator, implSubAgent, qaSubAgent, secArchSubAgent],
  dag,
  objective: check("dimpl_complete", (s: DimplState) =>
    s.sessionLogAssembled && s.outcome !== null,
  ),
  measures: [
    {
      id: "mu_gate_a_pass_rate",
      name: "Gate A Pass Rate",
      compute: (s: DimplState) => {
        if (s.tasks.length === 0) return 0;
        const passed = s.gateAResults.filter((r) => r.verdict === "PASS").length;
        return passed / s.tasks.length;
      },
      range: [0, 1],
      terminal: 1,
    },
    {
      id: "mu_dimpl_progress",
      name: "DIMPL Progress",
      compute: dimplProgress,
      range: [0, 1],
      terminal: 1,
    },
  ],
};
