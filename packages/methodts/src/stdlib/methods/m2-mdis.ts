// SPDX-License-Identifier: Apache-2.0
/**
 * M2_MDIS — Method Discovery from Informal Practice (M2-MDIS v1.0).
 *
 * 5 steps in a linear DAG: Recognize → Draft → Trial → Evaluate → Promote.
 *
 * Takes an observed informal practice and structures it through the protocol
 * lifecycle. Produces either a compiled method (via M1-MDES), a promoted
 * axiom, or an archived learning.
 *
 * Phase 1b: all steps are script execution. Agent prompts are deferred
 * to Phase 2 when the provider system is wired in.
 */

import { Effect } from "effect";
import type { Method } from "../../method/method.js";
import type { Step } from "../../method/step.js";
import type { StepDAG } from "../../method/dag.js";
import type { DomainTheory } from "../../domain/domain-theory.js";
import type { Role } from "../../domain/role.js";
import { check, TRUE } from "../../predicate/predicate.js";
import type { DiscoveryState } from "../types.js";

// ── Domain Theory ──

/** Simplified discovery domain theory. Maps to D_MDIS from the YAML. */
const D_DISCOVERY: DomainTheory<DiscoveryState> = {
  id: "D_MDIS",
  signature: {
    sorts: [
      { name: "InformalPractice", description: "An observed recurring pattern from execution evidence", cardinality: "singleton" },
      { name: "Protocol", description: "A structured practice with schema, enforcement, and trial criteria", cardinality: "singleton" },
      { name: "TrialEvidence", description: "Data collected during trial", cardinality: "unbounded" },
      { name: "PromotionCriteria", description: "Measurable conditions for graduation", cardinality: "finite" },
      { name: "PromotionDecision", description: "The outcome of evaluating trial evidence", cardinality: "finite" },
      { name: "Artifact", description: "The terminal output: compiled method, promoted axiom, or archived finding", cardinality: "singleton" },
    ],
    functionSymbols: [],
    predicates: {
      practice_observed: check<DiscoveryState>("practice_observed", (s) => s.informalPractice.length > 0),
      practice_sufficient: check<DiscoveryState>("practice_sufficient", (s) => s.recognition.length > 0),
      protocol_drafted: check<DiscoveryState>("protocol_drafted", (s) => s.draft.length > 0),
      trial_complete: check<DiscoveryState>("trial_complete", (s) => s.trialResult !== null && s.trialResult !== "pending"),
      promotion_decided: check<DiscoveryState>("promotion_decided", (s) => s.evaluationResult !== null),
      artifact_produced: check<DiscoveryState>("artifact_produced", (s) => s.outcome !== null),
    },
  },
  axioms: {},
};

// ── Roles ──

const discoverer: Role<DiscoveryState> = {
  id: "discoverer",
  description: "The agent or human who has observed a recurring informal practice and structures it through the protocol lifecycle",
  observe: (s) => s,
  authorized: ["sigma_0", "sigma_1", "sigma_2", "sigma_3", "sigma_4"],
  notAuthorized: [],
};

// ── Steps ──

const steps: Step<DiscoveryState>[] = [
  {
    id: "sigma_0",
    name: "Recognize",
    role: "discoverer",
    precondition: check("practice_observed", (s: DiscoveryState) => s.informalPractice.length > 0),
    postcondition: check("practice_sufficient", (s: DiscoveryState) => s.recognition.length > 0),
    execution: { tag: "script", execute: (s) => Effect.succeed(s) },
  },
  {
    id: "sigma_1",
    name: "Draft",
    role: "discoverer",
    precondition: check("practice_sufficient", (s: DiscoveryState) => s.recognition.length > 0),
    postcondition: check("protocol_drafted", (s: DiscoveryState) => s.draft.length > 0),
    execution: { tag: "script", execute: (s) => Effect.succeed(s) },
  },
  {
    id: "sigma_2",
    name: "Trial",
    role: "discoverer",
    precondition: check("protocol_drafted", (s: DiscoveryState) => s.draft.length > 0),
    postcondition: check("trial_running", (s: DiscoveryState) => s.trialResult !== null),
    execution: { tag: "script", execute: (s) => Effect.succeed(s) },
  },
  {
    id: "sigma_3",
    name: "Evaluate",
    role: "discoverer",
    precondition: check("trial_complete", (s: DiscoveryState) => s.trialResult !== null && s.trialResult !== "pending"),
    postcondition: check("promotion_decided", (s: DiscoveryState) => s.evaluationResult !== null),
    execution: { tag: "script", execute: (s) => Effect.succeed(s) },
  },
  {
    id: "sigma_4",
    name: "Promote",
    role: "discoverer",
    precondition: check("promotion_decided", (s: DiscoveryState) => s.evaluationResult !== null),
    postcondition: check("artifact_produced", (s: DiscoveryState) => s.outcome !== null),
    execution: { tag: "script", execute: (s) => Effect.succeed(s) },
  },
];

// ── DAG ──

const dag: StepDAG<DiscoveryState> = {
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

/** Maps lifecycle stage to a numeric progress value [0, 1]. */
function lifecycleProgress(s: DiscoveryState): number {
  let stage = 0;
  if (s.recognition.length > 0) stage = 1;
  if (s.draft.length > 0) stage = 2;
  if (s.trialResult !== null) stage = 3;
  if (s.evaluationResult !== null) stage = 4;
  if (s.outcome !== null) stage = 5;
  return stage / 5;
}

// ── Method ──

/** M2_MDIS — Method Discovery from Informal Practice (v1.0). 5 steps, linear DAG. */
export const M2_MDIS: Method<DiscoveryState> = {
  id: "M2-MDIS",
  name: "Method Discovery from Informal Practice",
  domain: D_DISCOVERY,
  roles: [discoverer],
  dag,
  objective: check("outcome_reached", (s: DiscoveryState) => s.outcome !== null),
  measures: [
    {
      id: "mu_lifecycle_progress",
      name: "Lifecycle Progress",
      compute: lifecycleProgress,
      range: [0, 1],
      terminal: 1,
    },
  ],
};
