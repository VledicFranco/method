// SPDX-License-Identifier: Apache-2.0
/**
 * M3_MEVO — Method Evolution from Execution Evidence (F1-FTH Definition 8.2).
 *
 * 6 steps in a linear DAG: Evidence Assessment -> Gap Crystallization ->
 * Domain Impact Analysis -> Change Design -> Refinement Claim -> Compilation Check.
 *
 * Takes a deployed method M.X vN with accumulated execution evidence and produces
 * M.X vN+1 with a change manifest and refinement claims per Definition 8.2.
 *
 * The YAML has a branch at sigma_2 (new-method -> M1-MDES), but within M3-MEVO
 * the DAG is linear. The branch exits the method entirely.
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
import type { EvolutionState } from "../types.js";

// ── Domain Theory ──

/** D_MEVO — Evolution domain theory. Full D_MEVO is formalized in the YAML. */
const D_MEVO: DomainTheory<EvolutionState> = {
  id: "D_MEVO",
  signature: {
    sorts: [
      { name: "Method", description: "A compiled method M.X vN", cardinality: "unbounded" },
      { name: "ExecutionEvidence", description: "Session logs, gate failures, delta trends", cardinality: "unbounded" },
      { name: "GapRecord", description: "Crystallized gap citing >= 3 sessions", cardinality: "unbounded" },
      { name: "ChangeManifest", description: "Gap-to-change-to-claim mapping", cardinality: "unbounded" },
      { name: "RefinementClaim", description: "Def 8.2 structured argument", cardinality: "unbounded" },
      { name: "CompilationResult", description: "PASS or FAIL", cardinality: "finite" },
    ],
    functionSymbols: [],
    predicates: {
      has_evidence: check<EvolutionState>("has_evidence", (s) => s.evidenceSummary.length > 0),
      has_gaps: check<EvolutionState>("has_gaps", (s) => s.gaps.length > 0),
      has_changes: check<EvolutionState>("has_changes", (s) => s.proposedChanges.length > 0),
      recompiled: check<EvolutionState>("recompiled", (s) => s.recompiled),
    },
  },
  axioms: {},
};

// ── Roles ──

const analyst: Role<EvolutionState> = {
  id: "analyst",
  description: "Reads execution evidence and crystallizes gap records (sigma_0, sigma_1)",
  observe: (s) => s,
  authorized: ["sigma_0", "sigma_1"],
  notAuthorized: [],
};

const evolver: Role<EvolutionState> = {
  id: "evolver",
  description: "Designs changes and builds refinement claims (sigma_2, sigma_3, sigma_4)",
  observe: (s) => s,
  authorized: ["sigma_2", "sigma_3", "sigma_4"],
  notAuthorized: [],
};

const compiler: Role<EvolutionState> = {
  id: "compiler",
  description: "Evaluates evolved candidate against G0-G6 (sigma_5)",
  observe: (s) => s,
  authorized: ["sigma_5"],
  notAuthorized: [],
};

// ── Steps ──

const steps: Step<EvolutionState>[] = [
  {
    id: "sigma_0",
    name: "Evidence Assessment",
    role: "analyst",
    precondition: check("has_target", (s: EvolutionState) => s.targetMethod.length > 0),
    postcondition: check("has_evidence", (s: EvolutionState) => s.evidenceSummary.length > 0),
    execution: {
      tag: "script",
      execute: (s) => Effect.succeed({ ...s, evidenceSummary: s.evidenceSummary || "assessed" }),
    },
  },
  {
    id: "sigma_1",
    name: "Gap Crystallization",
    role: "analyst",
    precondition: check("has_evidence", (s: EvolutionState) => s.evidenceSummary.length > 0),
    postcondition: check("has_gaps", (s: EvolutionState) => s.gaps.length > 0),
    execution: {
      tag: "script",
      execute: (s) => Effect.succeed(s),
    },
  },
  {
    id: "sigma_2",
    name: "Domain Impact Analysis",
    role: "evolver",
    precondition: check("has_gaps", (s: EvolutionState) => s.gaps.length > 0),
    postcondition: check("gaps_classified", (s: EvolutionState) => s.gaps.length > 0),
    execution: {
      tag: "script",
      execute: (s) => Effect.succeed(s),
    },
  },
  {
    id: "sigma_3",
    name: "Change Design",
    role: "evolver",
    precondition: check("gaps_classified", (s: EvolutionState) => s.gaps.length > 0),
    postcondition: check("has_changes", (s: EvolutionState) => s.proposedChanges.length > 0),
    execution: {
      tag: "script",
      execute: (s) =>
        Effect.succeed({
          ...s,
          proposedChanges: s.proposedChanges.length > 0 ? s.proposedChanges : ["change-placeholder"],
        }),
    },
  },
  {
    id: "sigma_4",
    name: "Refinement Claim",
    role: "evolver",
    precondition: check("has_changes", (s: EvolutionState) => s.proposedChanges.length > 0),
    postcondition: check("claims_complete", (s: EvolutionState) => s.proposedChanges.length > 0),
    execution: {
      tag: "script",
      execute: (s) => Effect.succeed(s),
    },
  },
  {
    id: "sigma_5",
    name: "Compilation Check",
    role: "compiler",
    precondition: check("claims_complete", (s: EvolutionState) => s.proposedChanges.length > 0),
    postcondition: check("recompiled", (s: EvolutionState) => s.recompiled),
    execution: {
      tag: "script",
      execute: (s) => Effect.succeed({ ...s, recompiled: true }),
    },
  },
];

// ── DAG ──

const dag: StepDAG<EvolutionState> = {
  steps,
  edges: [
    { from: "sigma_0", to: "sigma_1" },
    { from: "sigma_1", to: "sigma_2" },
    { from: "sigma_2", to: "sigma_3" },
    { from: "sigma_3", to: "sigma_4" },
    { from: "sigma_4", to: "sigma_5" },
  ],
  initial: "sigma_0",
  terminal: "sigma_5",
};

// ── Method ──

/** M3_MEVO — Method Evolution from Execution Evidence (F1-FTH Def 8.2). 6 steps, linear DAG. */
export const M3_MEVO: Method<EvolutionState> = {
  id: "M3-MEVO",
  name: "Method Evolution",
  domain: D_MEVO,
  roles: [analyst, evolver, compiler],
  dag,
  objective: check("recompiled", (s: EvolutionState) => s.recompiled),
  measures: [
    {
      id: "mu_gap_coverage",
      name: "Gap Coverage",
      compute: (s: EvolutionState) => (s.gaps.length > 0 ? 1.0 : 0.0),
      range: [0, 1],
      terminal: 1,
    },
    {
      id: "mu_refinement_completeness",
      name: "Refinement Completeness",
      compute: (s: EvolutionState) => (s.proposedChanges.length > 0 ? 1.0 : 0.0),
      range: [0, 1],
      terminal: 1,
    },
    {
      id: "mu_compilation_passage",
      name: "Compilation Passage",
      compute: (s: EvolutionState) => (s.recompiled ? 1.0 : 0.0),
      range: [0, 1],
      terminal: 1,
    },
  ],
};
