// SPDX-License-Identifier: Apache-2.0
/**
 * M3_RESOLVE — Merge Conflict Resolution Method (P-GH/M3-RESOLVE v1.0).
 *
 * 5 steps in a linear DAG: Detect -> Analyze -> Strategy -> Execute -> Verify.
 *
 * Resolves merge conflicts in a GitHub pull request. Detects conflicting files,
 * classifies each conflict as mechanical (textual overlap) or semantic (logic
 * divergence), selects a resolution strategy, executes the resolution on the
 * actual branch, and verifies that build + tests pass with no unintended changes.
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
import type { ResolveState } from "../../types.js";

// ── Domain Theory ──

/** D_RESOLVE — merge conflict resolution domain theory. */
const D_RESOLVE: DomainTheory<ResolveState> = {
  id: "D_RESOLVE",
  signature: {
    sorts: [
      { name: "PullRequest", description: "The unmergeable PR with conflict markers", cardinality: "singleton" },
      { name: "ConflictSet", description: "The set of files with merge conflicts", cardinality: "singleton" },
      { name: "ConflictFile", description: "A single file with conflict markers", cardinality: "finite" },
      { name: "ConflictType", description: "mechanical (textual overlap) or semantic (logic divergence)", cardinality: "finite" },
      { name: "ResolutionStrategy", description: "The strategy for resolving conflicts (rebase/merge/cherry_pick/manual)", cardinality: "finite" },
      { name: "BranchState", description: "The state of the PR branch before and after resolution", cardinality: "finite" },
      { name: "ResolutionRecord", description: "The assembled record of what was resolved and how", cardinality: "singleton" },
    ],
    functionSymbols: [],
    predicates: {
      has_conflicts: check<ResolveState>("has_conflicts", (s) => s.conflictFiles.length > 0),
      conflicts_analyzed: check<ResolveState>("conflicts_analyzed", (s) => s.conflictTypes.length > 0),
      strategy_selected: check<ResolveState>("strategy_selected", (s) => s.resolutionStrategy !== null),
      all_resolved: check<ResolveState>("all_resolved", (s) => s.resolved),
      builds_clean: check<ResolveState>("builds_clean", (s) => s.buildPassing),
      record_complete: check<ResolveState>("record_complete", (s) => s.resolutionRecord !== null),
    },
  },
  axioms: {},
};

// ── Roles ──

const resolver: Role<ResolveState> = {
  id: "resolver",
  description: "Reads both branches, identifies conflicts, classifies them, selects a strategy, executes the resolution, and verifies correctness.",
  observe: (s) => s,
  authorized: ["sigma_0", "sigma_1", "sigma_2", "sigma_3", "sigma_4"],
  notAuthorized: [],
};

// ── Steps ──

const steps: Step<ResolveState>[] = [
  {
    id: "sigma_0",
    name: "Detect",
    role: "resolver",
    precondition: TRUE,
    postcondition: check("has_conflicts", (s: ResolveState) => s.conflictFiles.length > 0),
    execution: { tag: "script", execute: (s) => Effect.succeed(s) },
  },
  {
    id: "sigma_1",
    name: "Analyze",
    role: "resolver",
    precondition: check("has_conflicts", (s: ResolveState) => s.conflictFiles.length > 0),
    postcondition: check("conflicts_analyzed", (s: ResolveState) => s.conflictTypes.length > 0),
    execution: { tag: "script", execute: (s) => Effect.succeed(s) },
  },
  {
    id: "sigma_2",
    name: "Strategy",
    role: "resolver",
    precondition: check("conflicts_analyzed", (s: ResolveState) => s.conflictTypes.length > 0),
    postcondition: check("strategy_selected", (s: ResolveState) => s.resolutionStrategy !== null),
    execution: { tag: "script", execute: (s) => Effect.succeed(s) },
  },
  {
    id: "sigma_3",
    name: "Execute",
    role: "resolver",
    precondition: check("strategy_selected", (s: ResolveState) => s.resolutionStrategy !== null),
    postcondition: check("all_resolved", (s: ResolveState) => s.resolved),
    execution: { tag: "script", execute: (s) => Effect.succeed(s) },
  },
  {
    id: "sigma_4",
    name: "Verify",
    role: "resolver",
    precondition: check("all_resolved", (s: ResolveState) => s.resolved),
    postcondition: check("record_complete", (s: ResolveState) => s.buildPassing && s.resolutionRecord !== null),
    execution: { tag: "script", execute: (s) => Effect.succeed(s) },
  },
];

// ── DAG ──

const dag: StepDAG<ResolveState> = {
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

// ── Method ──

/** M3_RESOLVE — Merge Conflict Resolution Method (P-GH v1.0). 5 steps, linear DAG. */
export const M3_RESOLVE: Method<ResolveState> = {
  id: "M3-RESOLVE",
  name: "Merge Conflict Resolution Method",
  domain: D_RESOLVE,
  roles: [resolver],
  dag,
  objective: check("o_resolve", (s: ResolveState) =>
    s.resolved && s.buildPassing && s.resolutionRecord !== null,
  ),
  measures: [
    {
      id: "mu_resolution",
      name: "Conflict Resolution Coverage",
      compute: (s: ResolveState) => (s.resolved ? 1 : 0),
      range: [0, 1],
      terminal: 1,
    },
    {
      id: "mu_integrity",
      name: "Build and Test Integrity",
      compute: (s: ResolveState) => (s.buildPassing && s.resolutionRecord !== null ? 1 : 0),
      range: [0, 1],
      terminal: 1,
    },
  ],
};
