// SPDX-License-Identifier: Apache-2.0
/**
 * M2_ORCH — Orchestrator Execution Method (M2-ORCH v1.0).
 *
 * 5 steps in a linear DAG: Orient -> Decompose -> Dispatch -> Integrate -> Verify.
 *
 * Single-pass orchestration execution. Given a challenge decomposable into
 * n independent sub-tasks, dispatches parallel sub-agents and integrates outputs.
 * Verification failure is terminal — caller handles re-dispatch.
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

/** Orchestrator execution state — what M2-ORCH operates on. */
export type OrchState = {
  readonly challengeSummary: string;
  readonly parallelDecomposable: boolean | null;
  readonly subTaskCount: number;
  readonly subTasksCompleted: number;
  readonly allResultsReceived: boolean;
  readonly integrationProduced: boolean;
  readonly verificationOutcome: "PASS" | "FAIL_INCOMPLETE" | "FAIL_INCONSISTENT" | null;
};

// ── Domain Theory ──

/** D_ORCH — orchestration structure domain theory. */
const D_ORCH: DomainTheory<OrchState> = {
  id: "D_ORCH",
  signature: {
    sorts: [
      { name: "Challenge", description: "The top-level task presented to the orchestrator", cardinality: "singleton" },
      { name: "SubTask", description: "A scoped unit of work decomposed from a Challenge", cardinality: "finite" },
      { name: "Scope", description: "The authorized context for a SubTask", cardinality: "finite" },
      { name: "SubAgent", description: "An agent assigned to execute one SubTask", cardinality: "finite" },
      { name: "Result", description: "Output produced by a SubAgent for its SubTask", cardinality: "finite" },
      { name: "Integration", description: "Combined output assembled from all Results", cardinality: "singleton" },
      { name: "VerificationOutcome", description: "Result of checking Integration", cardinality: "finite" },
    ],
    functionSymbols: [],
    predicates: {
      challenge_presented: check<OrchState>("challenge_presented", (s) => s.challengeSummary.length > 0),
      parallel_decomposable: check<OrchState>("parallel_decomposable", (s) => s.parallelDecomposable === true),
      decomposition_complete: check<OrchState>("decomposition_complete", (s) => s.subTaskCount >= 1),
      all_results_received: check<OrchState>("all_results_received", (s) => s.allResultsReceived),
      integration_produced: check<OrchState>("integration_produced", (s) => s.integrationProduced),
      verification_determined: check<OrchState>("verification_determined", (s) => s.verificationOutcome !== null),
    },
  },
  axioms: {},
};

// ── Roles ──

const orchestrator: Role<OrchState> = {
  id: "orchestrator",
  description: "Observes full Challenge, decomposition plan, all Results, and the Integration. Coordinates sub-agents.",
  observe: (s) => s,
  authorized: ["sigma_0", "sigma_1", "sigma_2", "sigma_3", "sigma_4"],
  notAuthorized: [],
};

const subAgent: Role<OrchState> = {
  id: "sub_agent",
  description: "Each sub-agent observes only its assigned SubTask scope. Produces a single bounded Result.",
  observe: (s) => s,
  authorized: [],
  notAuthorized: [],
};

// ── Steps ──

const steps: Step<OrchState>[] = [
  {
    id: "sigma_0",
    name: "Orient",
    role: "orchestrator",
    precondition: check("challenge_presented", (s: OrchState) => s.challengeSummary.length > 0),
    postcondition: check("decomposability_assessed", (s: OrchState) => s.parallelDecomposable !== null),
    execution: { tag: "script", execute: (s) => Effect.succeed(s) },
  },
  {
    id: "sigma_1",
    name: "Decompose",
    role: "orchestrator",
    precondition: check("parallel_decomposable", (s: OrchState) => s.parallelDecomposable === true),
    postcondition: check("decomposition_complete", (s: OrchState) => s.subTaskCount >= 1),
    execution: { tag: "script", execute: (s) => Effect.succeed(s) },
  },
  {
    id: "sigma_2",
    name: "Dispatch",
    role: "orchestrator",
    precondition: check("decomposition_complete", (s: OrchState) => s.subTaskCount >= 1),
    postcondition: check("all_results_received", (s: OrchState) => s.allResultsReceived),
    execution: { tag: "script", execute: (s) => Effect.succeed(s) },
  },
  {
    id: "sigma_3",
    name: "Integrate",
    role: "orchestrator",
    precondition: check("all_results_received", (s: OrchState) => s.allResultsReceived),
    postcondition: check("integration_produced", (s: OrchState) => s.integrationProduced),
    execution: { tag: "script", execute: (s) => Effect.succeed(s) },
  },
  {
    id: "sigma_4",
    name: "Verify",
    role: "orchestrator",
    precondition: check("integration_produced", (s: OrchState) => s.integrationProduced),
    postcondition: check("verification_determined", (s: OrchState) => s.verificationOutcome !== null),
    execution: { tag: "script", execute: (s) => Effect.succeed(s) },
  },
];

// ── DAG ──

const dag: StepDAG<OrchState> = {
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

// ── Progress measures ──

/** Task coverage: fraction of completed sub-tasks. */
function taskCoverage(s: OrchState): number {
  if (s.subTaskCount === 0) return 0;
  return s.subTasksCompleted / s.subTaskCount;
}

/** Integration coherence: 1 if consistent, 0 otherwise. */
function integrationCoherence(s: OrchState): number {
  if (s.verificationOutcome === "PASS") return 1;
  if (s.verificationOutcome === "FAIL_INCONSISTENT") return 0;
  return 0;
}

// ── Method ──

/** M2_ORCH — Orchestrator Execution Method (v1.0). 5 steps, linear DAG. */
export const M2_ORCH: Method<OrchState> = {
  id: "M2-ORCH",
  name: "Orchestrator Execution Method",
  domain: D_ORCH,
  roles: [orchestrator, subAgent],
  dag,
  objective: check("o_orch", (s: OrchState) =>
    s.allResultsReceived && s.integrationProduced && s.verificationOutcome === "PASS",
  ),
  measures: [
    {
      id: "mu_task_coverage",
      name: "Task Coverage",
      compute: taskCoverage,
      range: [0, 1],
      terminal: 1,
    },
    {
      id: "mu_integration_coherence",
      name: "Integration Coherence",
      compute: integrationCoherence,
      range: [0, 1],
      terminal: 1,
    },
  ],
};
