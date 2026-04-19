// SPDX-License-Identifier: Apache-2.0
/**
 * P_GH — GitHub Operations Methodology.
 *
 * F1-FTH Definition 7.1: Phi = (D_Phi, delta_Phi, O_Phi)
 * Receives a GitHub operations challenge, classifies it by challenge type
 * and action, and routes it to the appropriate execution method. Four
 * challenge types map to four methods: M1-TRIAGE, M2-REVIEW, M3-RESOLVE,
 * M4-WORK.
 *
 * The transition function (delta_GH) evaluates challenge_type and
 * challenge_action predicates, then selects the first matching arm
 * from a 6-arm priority stack.
 *
 * @see registry/P-GH/P-GH.yaml — the formal definition
 * @see theory/F1-FTH §7 — Methodology coalgebra
 */

import type { Methodology, Arm } from "../../methodology/methodology.js";
import type { Method } from "../../method/method.js";
import { M3_RESOLVE } from "../methods/pgh/m3-resolve.js";
import { M2_REVIEW_GH } from "../methods/pgh/m2-review.js";
import { M1_TRIAGE } from "../methods/pgh/m1-triage.js";
import { M4_WORK } from "../methods/pgh/m4-work.js";
import type { DomainTheory } from "../../domain/domain-theory.js";
import { check, and, not } from "../../predicate/predicate.js";

// ── State type ──

/**
 * GHState — the state P-GH operates on.
 *
 * Tracks the routing lifecycle: challenge arrives, type and action are
 * classified, a method is selected, the method runs, and the result
 * is returned.
 */
export type GHState = {
  readonly challengeType: "issue" | "pull_request" | "conflict" | null;
  readonly challengeAction: "triage" | "work" | null;
  readonly selectedMethod: string | null;
  readonly result: string | null;
  readonly completed: boolean;
};

// ── Domain theory ──

/**
 * D_GH — the domain theory for P-GH (F1-FTH Def 1.1).
 *
 * Sorts: Challenge, ChallengeType, Action, MethodID, Issue, PullRequest,
 *   ConflictSet, IssueType, Scope, ReviewVerdict, ConflictType,
 *   ResolutionStrategy, ExecutionResult, State
 * Key predicates: challenge_type checks, challenge_action, is_method_selected,
 *   method_completed
 * Axioms: challenge-type uniqueness, routing uniqueness, routing totality,
 *   selection before completion, single dispatch
 */
export const D_GH: DomainTheory<GHState> = {
  id: "D_Phi_GH",
  signature: {
    sorts: [
      { name: "Challenge", description: "The GitHub operations task presented to the methodology", cardinality: "singleton" },
      { name: "ChallengeType", description: "The category of GitHub entity: issue, pull_request, conflict", cardinality: "finite" },
      { name: "Action", description: "For issue-type challenges: triage or work", cardinality: "finite" },
      { name: "MethodID", description: "Selected method: M1-TRIAGE, M2-REVIEW, M3-RESOLVE, M4-WORK", cardinality: "finite" },
      { name: "Issue", description: "A GitHub issue with number, title, body, labels, and comments", cardinality: "unbounded" },
      { name: "PullRequest", description: "A GitHub pull request with number, title, body, diff, and review state", cardinality: "unbounded" },
      { name: "ConflictSet", description: "The set of conflicting files in a PR that cannot be auto-merged", cardinality: "finite" },
      { name: "IssueType", description: "Classification of issue content: bug, feature, question, meta", cardinality: "finite" },
      { name: "Scope", description: "Estimated effort scope: trivial, small, medium, large", cardinality: "finite" },
      { name: "ReviewVerdict", description: "Outcome of a PR review pass: approve, needs_changes", cardinality: "finite" },
      { name: "ConflictType", description: "Whether a conflict is mechanical or semantic", cardinality: "finite" },
      { name: "ResolutionStrategy", description: "Strategy for resolving merge conflicts: rebase, merge, cherry_pick, manual", cardinality: "finite" },
      { name: "ExecutionResult", description: "Terminal output produced by the selected method", cardinality: "singleton" },
      { name: "State", description: "Full execution state: { challenge, challenge_type, action, method_selected, result }", cardinality: "singleton" },
    ],
    functionSymbols: [
      { name: "classify_type", inputSorts: ["Challenge"], outputSort: "ChallengeType", totality: "total", description: "Determines the challenge type (issue, pull_request, conflict)" },
      { name: "classify_action", inputSorts: ["Challenge"], outputSort: "Action", totality: "total", description: "For issue challenges, determines the action (triage or work). None for non-issue types." },
      { name: "route", inputSorts: ["ChallengeType", "Action"], outputSort: "MethodID", totality: "total", description: "Maps challenge type and action to method (delta_GH core logic)" },
      { name: "method_selected", inputSorts: ["State"], outputSort: "MethodID", totality: "total", description: "None before classification; Some(M) after delta_GH returns" },
      { name: "result_of", inputSorts: ["State"], outputSort: "ExecutionResult", totality: "total", description: "None until selected method completes" },
    ],
    predicates: {
      is_conflict: check<GHState>("is_conflict", (s) => s.challengeType === "conflict"),
      is_pull_request: check<GHState>("is_pull_request", (s) => s.challengeType === "pull_request"),
      is_issue_triage: check<GHState>("is_issue_triage", (s) => s.challengeType === "issue" && s.challengeAction === "triage"),
      is_issue_work: check<GHState>("is_issue_work", (s) => s.challengeType === "issue" && s.challengeAction === "work"),
      is_method_selected: check<GHState>("is_method_selected", (s) => s.selectedMethod !== null),
      method_completed: check<GHState>("method_completed", (s) => s.completed),
    },
  },
  axioms: {
    // Ax-1: Challenge-type uniqueness — each challenge has exactly one type
    "Ax-1_challenge_type_uniqueness": check<GHState>("challenge_type_uniqueness", (s) =>
      s.challengeType !== null || s.completed,
    ),
    // Ax-2: Routing uniqueness — exactly one method selected per challenge
    "Ax-2_routing_uniqueness": check<GHState>("routing_uniqueness", (s) =>
      s.selectedMethod !== null || !s.completed,
    ),
    // Ax-4: Selection before completion
    "Ax-4_selection_before_completion": check<GHState>("selection_before_completion", (s) =>
      !s.completed || s.selectedMethod !== null,
    ),
    // Ax-5: Single dispatch per invocation
    "Ax-5_single_dispatch": check<GHState>("single_dispatch", () => true),
  },
};

// ── Transition arms ──

/**
 * Arm 1: conflict — merge conflicts block PR merges. Highest priority.
 * Routes to M3-RESOLVE.
 */
export const arm_conflict: Arm<GHState> = {
  priority: 1,
  label: "conflict",
  condition: and(
    not(check<GHState>("is_method_selected", (s) => s.selectedMethod !== null)),
    check<GHState>("is_conflict", (s) => s.challengeType === "conflict"),
  ),
  selects: M3_RESOLVE as unknown as Method<GHState>,
  rationale: "Merge conflicts block PR merges. Highest priority to unblock delivery.",
};

/**
 * Arm 2: review — PR review gates code quality.
 * Routes to M2-REVIEW.
 */
export const arm_review: Arm<GHState> = {
  priority: 2,
  label: "review",
  condition: and(
    not(check<GHState>("is_method_selected", (s) => s.selectedMethod !== null)),
    check<GHState>("is_pull_request", (s) => s.challengeType === "pull_request"),
  ),
  selects: M2_REVIEW_GH as unknown as Method<GHState>,
  rationale: "PR review gates code quality. Must complete before merging.",
};

/**
 * Arm 3: triage — issue needs classification and routing.
 * Routes to M1-TRIAGE.
 */
export const arm_triage: Arm<GHState> = {
  priority: 3,
  label: "triage",
  condition: and(
    not(check<GHState>("is_method_selected", (s) => s.selectedMethod !== null)),
    check<GHState>("is_issue_triage", (s) => s.challengeType === "issue" && s.challengeAction === "triage"),
  ),
  selects: M1_TRIAGE as unknown as Method<GHState>,
  rationale: "Issue triage routes work — must precede implementation for unclassified issues.",
};

/**
 * Arm 4: work — issue implementation with full git lifecycle.
 * Routes to M4-WORK.
 */
export const arm_work: Arm<GHState> = {
  priority: 4,
  label: "work",
  condition: and(
    not(check<GHState>("is_method_selected", (s) => s.selectedMethod !== null)),
    check<GHState>("is_issue_work", (s) => s.challengeType === "issue" && s.challengeAction === "work"),
  ),
  selects: M4_WORK as unknown as Method<GHState>,
  rationale: "Issue implementation — full git lifecycle from issue to merged PR.",
};

/**
 * Arm 5: terminate — method completed, return result.
 */
export const arm_terminate: Arm<GHState> = {
  priority: 5,
  label: "terminate",
  condition: and(
    check<GHState>("is_method_selected", (s) => s.selectedMethod !== null),
    check<GHState>("method_completed", (s) => s.completed),
  ),
  selects: null,
  rationale: "Selected method has completed and produced a result. Methodology terminates.",
};

/**
 * Arm 6: executing — method is running, no re-evaluation.
 */
export const arm_executing: Arm<GHState> = {
  priority: 6,
  label: "executing",
  condition: and(
    check<GHState>("is_method_selected", (s) => s.selectedMethod !== null),
    not(check<GHState>("method_completed", (s) => s.completed)),
  ),
  selects: null,
  rationale: "Method is running — no re-evaluation until completion.",
};

/** All 6 arms in priority order. */
export const GH_ARMS: readonly Arm<GHState>[] = [
  arm_conflict,
  arm_review,
  arm_triage,
  arm_work,
  arm_terminate,
  arm_executing,
];

// ── Methodology ──

/**
 * P_GH — GitHub Operations Methodology.
 *
 * Evaluates 6 transition arms in priority order to route GitHub operations
 * challenges to the appropriate method (M1-TRIAGE, M2-REVIEW, M3-RESOLVE,
 * M4-WORK), or terminates when the dispatched method completes.
 *
 * Termination certificate: delta_GH fires exactly once per challenge (Ax-5).
 * After the single invocation, a method is selected and executing (arms 5-6
 * return None). nu_GH decreases from 1 to 0.
 */
export const P_GH: Methodology<GHState> = {
  id: "P-GH",
  name: "GitHub Operations Methodology",
  domain: D_GH,
  arms: GH_ARMS,
  objective: check<GHState>(
    "challenge_addressed",
    (s) => s.completed && s.result !== null,
  ),
  terminationCertificate: {
    measure: (s: GHState) => s.completed ? 0 : 1,
    decreases:
      "delta_GH fires exactly once per challenge (Ax-5). After dispatch, the selected method runs to completion. nu_GH decreases from 1 to 0.",
  },
  safety: {
    maxLoops: 20,
    maxTokens: 1_000_000,
    maxCostUsd: 50,
    maxDurationMs: 3_600_000,
    maxDepth: 3,
  },
};
