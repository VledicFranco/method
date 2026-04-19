// SPDX-License-Identifier: Apache-2.0
/**
 * M3_TMP — Traditional Meta-Prompting Method (M3-TMP v1.0).
 *
 * 3 steps in a linear DAG: Orient -> Execute -> Verify.
 *
 * Single-agent, sequential, structured reasoning. The agent orients against the
 * challenge, executes through explicit decomposition, and verifies its own output.
 * No constructed characters, no parallel sub-agents, no adversarial pressure.
 * Value over raw prompting: explicit decomposition (sigma_0) and explicit
 * verification (sigma_2).
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

/** Traditional meta-prompting state — what M3-TMP operates on. */
export type TmpState = {
  readonly challenge: string;
  readonly subQuestions: readonly string[];
  readonly answersCount: number;
  readonly responseComplete: boolean;
  readonly responseConsistent: boolean;
  readonly finalResponse: string;
};

// ── Domain Theory ──

/** D_TMP — decomposition and verification structure domain theory. */
const D_TMP: DomainTheory<TmpState> = {
  id: "D_TMP",
  signature: {
    sorts: [
      { name: "Challenge", description: "The user's input: a question, task, or request", cardinality: "singleton" },
      { name: "SubQuestion", description: "An atomic component of Challenge, identified in sigma_0", cardinality: "finite" },
      { name: "Answer", description: "A response to a SubQuestion", cardinality: "finite" },
      { name: "Response", description: "The composed output: a sequence of Answers", cardinality: "singleton" },
      { name: "VerifyCheck", description: "A verification record: (SubQuestion, Answer, satisfied)", cardinality: "finite" },
    ],
    functionSymbols: [],
    predicates: {
      challenge_received: check<TmpState>("challenge_received", (s) => s.challenge.length > 0),
      decomposition_exists: check<TmpState>("decomposition_exists", (s) => s.subQuestions.length >= 1),
      all_addressed: check<TmpState>("all_addressed", (s) => s.subQuestions.length >= 1 && s.answersCount >= s.subQuestions.length),
      response_complete: check<TmpState>("response_complete", (s) => s.responseComplete),
      response_consistent: check<TmpState>("response_consistent", (s) => s.responseConsistent),
    },
  },
  axioms: {},
};

// ── Roles ──

const analyst: Role<TmpState> = {
  id: "analyst",
  description: "The single role. The executing agent occupies analyst throughout all three steps. Identity observation projection — full domain visibility.",
  observe: (s) => s,
  authorized: ["sigma_0", "sigma_1", "sigma_2"],
  notAuthorized: [],
};

// ── Steps ──

const steps: Step<TmpState>[] = [
  {
    id: "sigma_0",
    name: "Orient",
    role: "analyst",
    precondition: check("challenge_received", (s: TmpState) => s.challenge.length > 0),
    postcondition: check("decomposition_exists", (s: TmpState) => s.subQuestions.length >= 1),
    execution: { tag: "script", execute: (s) => Effect.succeed(s) },
  },
  {
    id: "sigma_1",
    name: "Execute",
    role: "analyst",
    precondition: check("decomposition_exists", (s: TmpState) => s.subQuestions.length >= 1),
    postcondition: check("all_addressed", (s: TmpState) => s.answersCount >= s.subQuestions.length),
    execution: { tag: "script", execute: (s) => Effect.succeed(s) },
  },
  {
    id: "sigma_2",
    name: "Verify",
    role: "analyst",
    precondition: check("all_addressed", (s: TmpState) => s.answersCount >= s.subQuestions.length),
    postcondition: check("o_tmp", (s: TmpState) => s.responseComplete && s.responseConsistent),
    execution: { tag: "script", execute: (s) => Effect.succeed(s) },
  },
];

// ── DAG ──

const dag: StepDAG<TmpState> = {
  steps,
  edges: [
    { from: "sigma_0", to: "sigma_1" },
    { from: "sigma_1", to: "sigma_2" },
  ],
  initial: "sigma_0",
  terminal: "sigma_2",
};

// ── Progress measures ──

/** Sub-question coverage: fraction of addressed sub-questions. */
function subQuestionCoverage(s: TmpState): number {
  if (s.subQuestions.length === 0) return 0;
  return Math.min(s.answersCount / s.subQuestions.length, 1);
}

/** Internal consistency: 1 if consistent, 0 otherwise. */
function internalConsistency(s: TmpState): number {
  return s.responseConsistent ? 1 : 0;
}

// ── Method ──

/** M3_TMP — Traditional Meta-Prompting Method (v1.0). 3 steps, linear DAG. */
export const M3_TMP: Method<TmpState> = {
  id: "M3-TMP",
  name: "Traditional Meta-Prompting Method",
  domain: D_TMP,
  roles: [analyst],
  dag,
  objective: check("o_tmp", (s: TmpState) => s.responseComplete && s.responseConsistent),
  measures: [
    {
      id: "mu_sub_question_coverage",
      name: "Sub-Question Coverage",
      compute: subQuestionCoverage,
      range: [0, 1],
      terminal: 1,
    },
    {
      id: "mu_internal_consistency",
      name: "Internal Consistency",
      compute: internalConsistency,
      range: [0, 1],
      terminal: 1,
    },
  ],
};
