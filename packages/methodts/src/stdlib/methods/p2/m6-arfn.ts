// SPDX-License-Identifier: Apache-2.0
/**
 * M6_ARFN — Architecture Refinement Method (M6-ARFN v1.0).
 *
 * 4 steps in a linear DAG: Assess Impact → Analyze Options → Specify → Validate.
 *
 * Takes a PRD and existing codebase/architecture, and produces or updates an
 * ArchDoc — a set of focused architecture specification files following the
 * horizontal documentation pattern. Refinement scope: updates existing architecture
 * to accommodate new requirements.
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

type ArfnState = {
  readonly impacts: readonly { readonly requirementRef: string; readonly componentAffected: string; readonly nature: string }[];
  readonly existingArchitectureSummary: string;
  readonly decisions: readonly { readonly impactRef: string; readonly chosenOption: string; readonly rationale: string }[];
  readonly specFiles: readonly { readonly path: string; readonly action: "created" | "updated"; readonly topic: string }[];
  readonly readmeUpdated: boolean;
  readonly consistencyResult: "PASS" | "FAIL" | null;
  readonly coverageVerified: boolean;
};

// ── Domain Theory ──

const D_ARFN: DomainTheory<ArfnState> = {
  id: "D_ARFN",
  signature: {
    sorts: [
      { name: "PRDInput", description: "The PRD or PRDSection driving the architecture refinement", cardinality: "singleton" },
      { name: "ExistingArchitecture", description: "The current architecture: existing spec files, codebase structure", cardinality: "singleton" },
      { name: "ArchImpact", description: "An identified architectural consequence of a new requirement", cardinality: "finite" },
      { name: "DesignOption", description: "A candidate architectural approach for addressing an ArchImpact", cardinality: "unbounded" },
      { name: "ArchDecision", description: "A resolved design choice with rationale", cardinality: "finite" },
      { name: "ArchSpecFile", description: "A focused architecture specification file", cardinality: "finite" },
      { name: "ArchDoc", description: "The complete set of ArchSpecFiles produced or updated", cardinality: "singleton" },
      { name: "ConsistencyCheck", description: "Verification that updated architecture is internally consistent", cardinality: "finite" },
    ],
    functionSymbols: [],
    predicates: {
      impacts_identified: check<ArfnState>("impacts_identified", (s) => s.impacts.length > 0),
      all_impacts_resolved: check<ArfnState>("all_impacts_resolved", (s) => s.decisions.length >= s.impacts.length),
      specs_produced: check<ArfnState>("specs_produced", (s) => s.specFiles.length > 0),
      validated: check<ArfnState>("validated", (s) => s.consistencyResult !== null && s.coverageVerified),
    },
  },
  axioms: {},
};

// ── Roles ──

const architect: Role<ArfnState> = {
  id: "architect",
  description: "Reads PRD, existing architecture, and codebase. Produces architecture refinements. Does not implement.",
  observe: (s) => s,
  authorized: ["sigma_0", "sigma_1", "sigma_2", "sigma_3"],
  notAuthorized: [],
};

// ── Steps ──

const steps: Step<ArfnState>[] = [
  {
    id: "sigma_0",
    name: "Assess Impact",
    role: "architect",
    precondition: TRUE,
    postcondition: check("impacts_identified", (s: ArfnState) => s.impacts.length > 0),
    execution: { tag: "script", execute: (s) => Effect.succeed(s) },
  },
  {
    id: "sigma_1",
    name: "Analyze Options",
    role: "architect",
    precondition: check("impacts_identified", (s: ArfnState) => s.impacts.length > 0),
    postcondition: check("all_impacts_resolved", (s: ArfnState) => s.decisions.length >= s.impacts.length),
    execution: { tag: "script", execute: (s) => Effect.succeed(s) },
  },
  {
    id: "sigma_2",
    name: "Specify",
    role: "architect",
    precondition: check("all_impacts_resolved", (s: ArfnState) => s.decisions.length >= s.impacts.length),
    postcondition: check("specs_produced", (s: ArfnState) => s.specFiles.length > 0),
    execution: { tag: "script", execute: (s) => Effect.succeed(s) },
  },
  {
    id: "sigma_3",
    name: "Validate",
    role: "architect",
    precondition: check("specs_produced", (s: ArfnState) => s.specFiles.length > 0),
    postcondition: check("validated", (s: ArfnState) => s.consistencyResult !== null && s.coverageVerified),
    execution: { tag: "script", execute: (s) => Effect.succeed(s) },
  },
];

// ── DAG ──

const dag: StepDAG<ArfnState> = {
  steps,
  edges: [
    { from: "sigma_0", to: "sigma_1" },
    { from: "sigma_1", to: "sigma_2" },
    { from: "sigma_2", to: "sigma_3" },
  ],
  initial: "sigma_0",
  terminal: "sigma_3",
};

// ── Method ──

/** M6_ARFN — Architecture Refinement Method (v1.0). 4 steps, linear DAG. */
export const M6_ARFN: Method<ArfnState> = {
  id: "M6-ARFN",
  name: "Architecture Refinement Method",
  domain: D_ARFN,
  roles: [architect],
  dag,
  objective: check("refinement_complete", (s: ArfnState) =>
    s.impacts.length > 0 &&
    s.decisions.length >= s.impacts.length &&
    s.consistencyResult === "PASS" &&
    s.coverageVerified,
  ),
  measures: [
    {
      id: "mu_resolution",
      name: "Impact Resolution",
      compute: (s: ArfnState) =>
        s.impacts.length > 0 ? s.decisions.length / s.impacts.length : 0,
      range: [0, 1],
      terminal: 1,
    },
    {
      id: "mu_consistency",
      name: "Consistency",
      compute: (s: ArfnState) => (s.consistencyResult === "PASS" ? 1 : 0),
      range: [0, 1],
      terminal: 1,
    },
  ],
};
