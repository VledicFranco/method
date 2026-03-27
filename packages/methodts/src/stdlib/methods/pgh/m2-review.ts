/**
 * M2_REVIEW_GH — PR Review with Self-Fix Method (P-GH/M2-REVIEW v1.1).
 *
 * 6 steps in a DAG with conditional self-fix loop:
 * Load PR -> Read + Check -> Verdict -> Fix (conditional) ->
 * Self-Review (loop to sigma_1, max 3) -> Report + Merge.
 *
 * Reviews a GitHub pull request by loading the PR diff, reading each changed
 * file, checking delivery rules, and producing a verdict (approve or
 * needs_changes) with file:line citations. When needs_changes, enters a
 * self-fix loop bounded at 3 iterations.
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
import type { PRReviewState } from "../../types.js";

// ── Domain Theory ──

/** D_REVIEW — PR review domain theory. */
const D_REVIEW: DomainTheory<PRReviewState> = {
  id: "D_REVIEW",
  signature: {
    sorts: [
      { name: "PullRequest", description: "The GitHub PR being reviewed", cardinality: "singleton" },
      { name: "ChangedFile", description: "A file modified in the PR", cardinality: "finite" },
      { name: "DeliveryRule", description: "A delivery rule from the project card", cardinality: "finite" },
      { name: "Finding", description: "A review observation with file:line citation", cardinality: "unbounded" },
      { name: "Severity", description: "Finding severity (CRITICAL/HIGH/MEDIUM/LOW)", cardinality: "finite" },
      { name: "ReviewVerdict", description: "Overall review outcome (approve/needs_changes)", cardinality: "finite" },
      { name: "ReviewReport", description: "Assembled findings with verdict", cardinality: "singleton" },
      { name: "FixAttempt", description: "A self-fix iteration", cardinality: "finite" },
      { name: "IterationCounter", description: "Counts self-fix iterations. Max 3.", cardinality: "finite" },
    ],
    functionSymbols: [],
    predicates: {
      pr_loaded: check<PRReviewState>("pr_loaded", (s) => s.pullRequest.length > 0),
      has_changed_files: check<PRReviewState>("has_changed_files", (s) => s.changedFiles.length > 0),
      verdict_determined: check<PRReviewState>("verdict_determined", (s) => s.verdict !== null),
      report_posted: check<PRReviewState>("report_posted", (s) => s.reviewReport !== null),
      within_fix_bound: check<PRReviewState>("within_fix_bound", (s) => s.fixAttempts <= s.maxFixAttempts),
    },
  },
  axioms: {},
};

// ── Roles ──

const reviewer: Role<PRReviewState> = {
  id: "reviewer",
  description: "Reads the PR diff and full file context. Checks delivery rules. Produces findings with file:line citations. Determines verdict.",
  observe: (s) => s,
  authorized: ["sigma_0", "sigma_1", "sigma_2", "sigma_4", "sigma_5"],
  notAuthorized: [],
};

const fixer: Role<PRReviewState> = {
  id: "fixer",
  description: "Applies corrections identified by the reviewer. Creates a worktree, makes targeted edits, commits, and pushes.",
  observe: (s) => s,
  authorized: ["sigma_3"],
  notAuthorized: [],
};

// ── Steps ──

const steps: Step<PRReviewState>[] = [
  {
    id: "sigma_0",
    name: "Load PR",
    role: "reviewer",
    precondition: TRUE,
    postcondition: check("pr_loaded", (s: PRReviewState) => s.pullRequest.length > 0 && s.changedFiles.length > 0),
    execution: { tag: "script", execute: (s) => Effect.succeed(s) },
  },
  {
    id: "sigma_1",
    name: "Read + Check",
    role: "reviewer",
    precondition: check("pr_loaded", (s: PRReviewState) => s.pullRequest.length > 0 && s.changedFiles.length > 0),
    postcondition: check("files_reviewed", (s: PRReviewState) => s.deliveryRules.length >= 0 && s.changedFiles.length > 0),
    execution: { tag: "script", execute: (s) => Effect.succeed(s) },
  },
  {
    id: "sigma_2",
    name: "Verdict",
    role: "reviewer",
    precondition: check("files_reviewed", (s: PRReviewState) => s.changedFiles.length > 0),
    postcondition: check("verdict_determined", (s: PRReviewState) => s.verdict !== null),
    execution: { tag: "script", execute: (s) => Effect.succeed(s) },
  },
  {
    id: "sigma_3",
    name: "Fix",
    role: "fixer",
    precondition: check("needs_fix", (s: PRReviewState) => s.verdict === "needs_changes" && s.fixAttempts < s.maxFixAttempts),
    postcondition: check("fix_applied", (s: PRReviewState) => s.fixAttempts >= 1),
    execution: { tag: "script", execute: (s) => Effect.succeed(s) },
  },
  {
    id: "sigma_4",
    name: "Self-Review",
    role: "reviewer",
    precondition: check("fix_applied", (s: PRReviewState) => s.fixAttempts >= 1),
    postcondition: check("re_review_done", (s: PRReviewState) => s.verdict !== null),
    execution: { tag: "script", execute: (s) => Effect.succeed(s) },
  },
  {
    id: "sigma_5",
    name: "Report + Merge",
    role: "reviewer",
    precondition: check("ready_for_report", (s: PRReviewState) => s.verdict !== null),
    postcondition: check("report_posted", (s: PRReviewState) => s.reviewReport !== null),
    execution: { tag: "script", execute: (s) => Effect.succeed(s) },
  },
];

// ── DAG ──

// StepDAG is acyclic by definition (F1-FTH §4). The back edge sigma_4 → sigma_1
// ("Self-Review" looping back to "Read + Check") was removed. The fix-and-re-review
// loop is encoded in the step precondition (fixAttempts < maxFixAttempts) and the
// methodology level handles subsequent iterations if needed.
const dag: StepDAG<PRReviewState> = {
  steps,
  edges: [
    { from: "sigma_0", to: "sigma_1" },
    { from: "sigma_1", to: "sigma_2" },
    { from: "sigma_2", to: "sigma_3" },
    { from: "sigma_2", to: "sigma_5" },
    { from: "sigma_3", to: "sigma_4" },
    { from: "sigma_4", to: "sigma_5" },
  ],
  initial: "sigma_0",
  terminal: "sigma_5",
};

// ── Method ──

/** M2_REVIEW_GH — PR Review with Self-Fix Method (P-GH v1.1). 6 steps, DAG with conditional fix loop. */
export const M2_REVIEW_GH: Method<PRReviewState> = {
  id: "M2-REVIEW",
  name: "PR Review with Self-Fix Method",
  domain: D_REVIEW,
  roles: [reviewer, fixer],
  dag,
  objective: check("o_review", (s: PRReviewState) =>
    s.reviewReport !== null && s.verdict !== null,
  ),
  measures: [
    {
      id: "mu_coverage",
      name: "File Review Coverage",
      compute: (s: PRReviewState) => (s.changedFiles.length > 0 ? 1 : 0),
      range: [0, 1],
      terminal: 1,
    },
    {
      id: "mu_posted",
      name: "Report Posted",
      compute: (s: PRReviewState) => (s.reviewReport !== null ? 1 : 0),
      range: [0, 1],
      terminal: 1,
    },
  ],
};
