/**
 * M1_COUNCIL — Synthetic Agents Method (M1-COUNCIL v1.3).
 *
 * 4 steps in a linear DAG: Setup -> Cast Design -> Debate & Resolve -> Output.
 *
 * Structured multi-character debate where a cast of synthetic expert agents
 * argue a challenge and produce a decision or artifact, with the user as
 * final authority. Forces genuine position-holding through character
 * construction: each character has a named conviction and blind spot.
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

/** Council execution state — what M1-COUNCIL operates on. */
export type CouncilState = {
  readonly challengeStatement: string;
  readonly scopeConfirmed: boolean;
  readonly castApproved: boolean;
  readonly contrariansCount: number;
  readonly questionsDecided: number;
  readonly totalQuestions: number;
  readonly positionsUpdated: number;
  readonly allQuestionsResolved: boolean;
  readonly artifactProduced: boolean;
};

// ── Domain Theory ──

/** D_COUNCIL — debate structure domain theory. */
const D_COUNCIL: DomainTheory<CouncilState> = {
  id: "D_COUNCIL",
  signature: {
    sorts: [
      { name: "Challenge", description: "The problem or decision posed by the Product Owner", cardinality: "singleton" },
      { name: "Question", description: "A sub-question or decision point derived from the Challenge", cardinality: "finite" },
      { name: "CharacterCard", description: "A specification constituting a Character", cardinality: "finite" },
      { name: "Character", description: "A synthetic expert agent instantiated from a CharacterCard", cardinality: "finite" },
      { name: "Council", description: "The active ensemble: Leader + Contrarians", cardinality: "singleton" },
      { name: "Position", description: "A character's stance on a Question", cardinality: "unbounded" },
      { name: "Turn", description: "A single character's contribution in the debate", cardinality: "unbounded" },
      { name: "Escalation", description: "A Leader-to-PO query requiring external authority", cardinality: "unbounded" },
      { name: "Decision", description: "A resolved Question", cardinality: "unbounded" },
      { name: "Artifact", description: "Terminal output: consolidated decisions with rationale", cardinality: "singleton" },
    ],
    functionSymbols: [],
    predicates: {
      scope_confirmed: check<CouncilState>("scope_confirmed", (s) => s.scopeConfirmed),
      cast_approved: check<CouncilState>("cast_approved", (s) => s.castApproved),
      has_contrarians: check<CouncilState>("has_contrarians", (s) => s.contrariansCount >= 2),
      all_questions_resolved: check<CouncilState>("all_questions_resolved", (s) => s.allQuestionsResolved),
      has_position_updates: check<CouncilState>("has_position_updates", (s) => s.positionsUpdated >= 1),
      artifact_produced: check<CouncilState>("artifact_produced", (s) => s.artifactProduced),
    },
  },
  axioms: {},
};

// ── Roles ──

const leader: Role<CouncilState> = {
  id: "rho_leader",
  description: "Neutral mediator. Synthesizes debate state, identifies impasse, issues Escalations to PO.",
  observe: (s) => s,
  authorized: ["sigma_0", "sigma_1", "sigma_3"],
  notAuthorized: [],
};

const contrarian: Role<CouncilState> = {
  id: "rho_contrarian",
  description: "Expert with bounded knowledge base defined by CharacterCard. Holds and defends positions.",
  observe: (s) => s,
  authorized: ["sigma_2"],
  notAuthorized: [],
};

const productOwner: Role<CouncilState> = {
  id: "rho_product_owner",
  description: "The human user. Final decision authority.",
  observe: (s) => s,
  authorized: ["sigma_2"],
  notAuthorized: [],
};

// ── Steps ──

const steps: Step<CouncilState>[] = [
  {
    id: "sigma_0",
    name: "Setup",
    role: "rho_leader",
    precondition: check("challenge_exists", (s: CouncilState) => s.challengeStatement.length > 0),
    postcondition: check("scope_confirmed", (s: CouncilState) => s.scopeConfirmed),
    execution: { tag: "script", execute: (s) => Effect.succeed(s) },
  },
  {
    id: "sigma_1",
    name: "Cast Design",
    role: "rho_leader",
    precondition: check("scope_confirmed", (s: CouncilState) => s.scopeConfirmed),
    postcondition: check("cast_approved", (s: CouncilState) => s.castApproved && s.contrariansCount >= 2),
    execution: { tag: "script", execute: (s) => Effect.succeed(s) },
  },
  {
    id: "sigma_2",
    name: "Debate & Resolve",
    role: "rho_leader",
    precondition: check("cast_approved", (s: CouncilState) => s.castApproved && s.contrariansCount >= 2),
    postcondition: check("all_questions_resolved", (s: CouncilState) => s.allQuestionsResolved),
    execution: { tag: "script", execute: (s) => Effect.succeed(s) },
  },
  {
    id: "sigma_3",
    name: "Output",
    role: "rho_leader",
    precondition: check("all_questions_resolved", (s: CouncilState) => s.allQuestionsResolved),
    postcondition: check("artifact_produced", (s: CouncilState) => s.artifactProduced && s.positionsUpdated >= 1),
    execution: { tag: "script", execute: (s) => Effect.succeed(s) },
  },
];

// ── DAG ──

const dag: StepDAG<CouncilState> = {
  steps,
  edges: [
    { from: "sigma_0", to: "sigma_1" },
    { from: "sigma_1", to: "sigma_2" },
    { from: "sigma_2", to: "sigma_3" },
  ],
  initial: "sigma_0",
  terminal: "sigma_3",
};

// ── Progress measure ──

/** Maps question resolution progress to [0, 1]. */
function questionResolution(s: CouncilState): number {
  if (s.totalQuestions === 0) return 0;
  return s.questionsDecided / s.totalQuestions;
}

// ── Method ──

/** M1_COUNCIL — Synthetic Agents Method (v1.3). 4 steps, linear DAG. */
export const M1_COUNCIL: Method<CouncilState> = {
  id: "M1-COUNCIL",
  name: "Synthetic Agents Method",
  domain: D_COUNCIL,
  roles: [leader, contrarian, productOwner],
  dag,
  objective: check("o_council", (s: CouncilState) =>
    s.allQuestionsResolved && s.positionsUpdated >= 1 && s.artifactProduced,
  ),
  measures: [
    {
      id: "mu_question_resolution",
      name: "Question Resolution",
      compute: questionResolution,
      range: [0, 1],
      terminal: 1,
    },
    {
      id: "mu_adversarial_integrity",
      name: "Adversarial Integrity",
      compute: (_s: CouncilState) => 0,
      range: [0, 1],
      terminal: 1,
    },
    {
      id: "mu_escalation_precision",
      name: "Escalation Precision",
      compute: (_s: CouncilState) => 0,
      range: [0, 1],
      terminal: 1,
    },
  ],
};
