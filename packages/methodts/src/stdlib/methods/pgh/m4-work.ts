/**
 * M4_WORK — Issue Work Execution Method (P-GH/M4-WORK v1.0).
 *
 * 9 steps in a DAG with two conditional loops:
 * Load Issue -> Setup -> Plan -> Implement -> Commit + Push ->
 * Create PR -> Self-Review -> Fix Loop (conditional, max 3) -> Report.
 *
 * Executes a GitHub issue with full git lifecycle management: reads the issue,
 * sets up a worktree and branch, plans the approach, implements with a bounded
 * build/test loop, commits and pushes, creates a PR linked to the issue, runs
 * M2-REVIEW inline as self-review, applies fixes if needed, and reports
 * completion.
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
import type { WorkState } from "../../types.js";

// ── Domain Theory ──

/** D_WORK — issue work execution domain theory. */
const D_WORK: DomainTheory<WorkState> = {
  id: "D_WORK",
  signature: {
    sorts: [
      { name: "Issue", description: "The GitHub issue being worked on", cardinality: "singleton" },
      { name: "Worktree", description: "The git worktree for isolated development", cardinality: "singleton" },
      { name: "Branch", description: "The feature/fix branch created for this work", cardinality: "singleton" },
      { name: "Plan", description: "The implementation plan: files to change, approach, scope", cardinality: "singleton" },
      { name: "SourceFile", description: "A source file in the worktree being modified", cardinality: "finite" },
      { name: "PullRequest", description: "The PR created to merge the work", cardinality: "singleton" },
      { name: "ReviewResult", description: "The result of M2-REVIEW self-review", cardinality: "finite" },
      { name: "WorkRecord", description: "The complete record of work execution", cardinality: "singleton" },
      { name: "IterationCounter", description: "Counts self-review fix iterations. Max 3.", cardinality: "finite" },
    ],
    functionSymbols: [],
    predicates: {
      issue_loaded: check<WorkState>("issue_loaded", (s) => s.issue.length > 0),
      worktree_active: check<WorkState>("worktree_active", (s) => s.worktree !== null),
      branch_exists: check<WorkState>("branch_exists", (s) => s.branch !== null),
      plan_ready: check<WorkState>("plan_ready", (s) => s.plan !== null),
      implemented: check<WorkState>("implemented", (s) => s.implemented),
      pr_created: check<WorkState>("pr_created", (s) => s.pullRequest !== null),
      self_reviewed: check<WorkState>("self_reviewed", (s) => s.reviewResult !== null),
      within_fix_bound: check<WorkState>("within_fix_bound", (s) => s.iterationCount <= 3),
      work_complete: check<WorkState>("work_complete", (s) => s.workRecord !== null),
    },
  },
  axioms: {},
};

// ── Roles ──

const planner: Role<WorkState> = {
  id: "planner",
  description: "Reads the issue and codebase context. Creates the implementation plan. Read-only on codebase.",
  observe: (s) => s,
  authorized: ["sigma_0", "sigma_2"],
  notAuthorized: [],
};

const implementor: Role<WorkState> = {
  id: "implementor",
  description: "Sets up worktree and branch. Writes code. Runs build/test loops. Commits and pushes.",
  observe: (s) => s,
  authorized: ["sigma_1", "sigma_3", "sigma_4", "sigma_7"],
  notAuthorized: [],
};

const reporter: Role<WorkState> = {
  id: "reporter",
  description: "Creates the PR, invokes self-review, posts comments, and reports completion.",
  observe: (s) => s,
  authorized: ["sigma_5", "sigma_6", "sigma_8"],
  notAuthorized: [],
};

// ── Steps ──

const steps: Step<WorkState>[] = [
  {
    id: "sigma_0",
    name: "Load Issue",
    role: "planner",
    precondition: TRUE,
    postcondition: check("issue_loaded", (s: WorkState) => s.issue.length > 0),
    execution: { tag: "script", execute: (s) => Effect.succeed(s) },
  },
  {
    id: "sigma_1",
    name: "Setup",
    role: "implementor",
    precondition: check("issue_loaded", (s: WorkState) => s.issue.length > 0),
    postcondition: check("setup_done", (s: WorkState) => s.worktree !== null && s.branch !== null),
    execution: { tag: "script", execute: (s) => Effect.succeed(s) },
  },
  {
    id: "sigma_2",
    name: "Plan",
    role: "planner",
    precondition: check("setup_done", (s: WorkState) => s.worktree !== null && s.branch !== null),
    postcondition: check("plan_ready", (s: WorkState) => s.plan !== null),
    execution: { tag: "script", execute: (s) => Effect.succeed(s) },
  },
  {
    id: "sigma_3",
    name: "Implement",
    role: "implementor",
    precondition: check("plan_ready", (s: WorkState) => s.plan !== null),
    postcondition: check("implemented", (s: WorkState) => s.implemented),
    execution: { tag: "script", execute: (s) => Effect.succeed(s) },
  },
  {
    id: "sigma_4",
    name: "Commit + Push",
    role: "implementor",
    precondition: check("implemented", (s: WorkState) => s.implemented),
    postcondition: check("pushed", (s: WorkState) => s.implemented && s.branch !== null),
    execution: { tag: "script", execute: (s) => Effect.succeed(s) },
  },
  {
    id: "sigma_5",
    name: "Create PR",
    role: "reporter",
    precondition: check("pushed", (s: WorkState) => s.implemented && s.branch !== null),
    postcondition: check("pr_created", (s: WorkState) => s.pullRequest !== null),
    execution: { tag: "script", execute: (s) => Effect.succeed(s) },
  },
  {
    id: "sigma_6",
    name: "Self-Review",
    role: "reporter",
    precondition: check("pr_created", (s: WorkState) => s.pullRequest !== null),
    postcondition: check("self_reviewed", (s: WorkState) => s.reviewResult !== null),
    execution: { tag: "script", execute: (s) => Effect.succeed(s) },
  },
  {
    id: "sigma_7",
    name: "Fix Loop",
    role: "implementor",
    precondition: check("needs_fix", (s: WorkState) => s.reviewResult !== null && s.iterationCount < 3),
    postcondition: check("fix_applied", (s: WorkState) => s.iterationCount >= 1),
    execution: { tag: "script", execute: (s) => Effect.succeed(s) },
  },
  {
    id: "sigma_8",
    name: "Report",
    role: "reporter",
    precondition: check("ready_to_report", (s: WorkState) => s.reviewResult !== null),
    postcondition: check("work_complete", (s: WorkState) => s.workRecord !== null),
    execution: { tag: "script", execute: (s) => Effect.succeed(s) },
  },
];

// ── DAG ──

const dag: StepDAG<WorkState> = {
  steps,
  edges: [
    { from: "sigma_0", to: "sigma_1" },
    { from: "sigma_1", to: "sigma_2" },
    { from: "sigma_2", to: "sigma_3" },
    { from: "sigma_3", to: "sigma_4" },
    { from: "sigma_4", to: "sigma_5" },
    { from: "sigma_5", to: "sigma_6" },
    { from: "sigma_6", to: "sigma_7" },
    { from: "sigma_6", to: "sigma_8" },
    { from: "sigma_7", to: "sigma_3" },
    { from: "sigma_7", to: "sigma_8" },
  ],
  initial: "sigma_0",
  terminal: "sigma_8",
};

// ── Method ──

/** M4_WORK — Issue Work Execution Method (P-GH v1.0). 9 steps, DAG with two conditional loops. */
export const M4_WORK: Method<WorkState> = {
  id: "M4-WORK",
  name: "Issue Work Execution Method",
  domain: D_WORK,
  roles: [planner, implementor, reporter],
  dag,
  objective: check("o_work", (s: WorkState) =>
    s.pullRequest !== null &&
    s.reviewResult !== null &&
    s.implemented &&
    s.workRecord !== null,
  ),
  measures: [
    {
      id: "mu_lifecycle",
      name: "Git Lifecycle Completeness",
      compute: (s: WorkState) =>
        s.branch !== null && s.implemented && s.pullRequest !== null ? 1 : 0,
      range: [0, 1],
      terminal: 1,
    },
    {
      id: "mu_quality",
      name: "Quality Gate",
      compute: (s: WorkState) =>
        s.implemented && s.reviewResult !== null ? 1 : 0,
      range: [0, 1],
      terminal: 1,
    },
    {
      id: "mu_visibility",
      name: "Completion Visibility",
      compute: (s: WorkState) => (s.workRecord !== null ? 1 : 0),
      range: [0, 1],
      terminal: 1,
    },
  ],
};
