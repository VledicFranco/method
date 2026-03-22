/**
 * M1_MDES — Method Design method (F1-FTH Definition 6.1).
 *
 * 7 steps in a linear DAG: Orientation → Domain Theory Crystallization →
 * Objective + Measure → Role Design → Step DAG Construction →
 * Guidance Audit → Compilation Check.
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
import type { DesignState } from "../types.js";

// ── Domain Theory ──

/** Simplified design domain theory. Full D_META is a later work unit. */
const D_DESIGN: DomainTheory<DesignState> = {
  id: "D_DESIGN",
  signature: {
    sorts: [
      { name: "Component", description: "A method component", cardinality: "finite" },
      { name: "Gate", description: "A compilation gate", cardinality: "finite" },
    ],
    functionSymbols: [],
    predicates: {
      has_domain: check<DesignState>("has_domain", (s) => s.candidateComponents.includes("DomainTheory")),
      has_objective: check<DesignState>("has_objective", (s) => s.candidateComponents.includes("Objective")),
      compiled: check<DesignState>("compiled", (s) => s.compiled),
    },
  },
  axioms: {},
};

// ── Roles ──

const designer: Role<DesignState> = {
  id: "designer",
  description: "Designs the method by crystallizing domain knowledge",
  observe: (s) => s,
  authorized: ["sigma_0", "sigma_1", "sigma_2", "sigma_3", "sigma_4", "sigma_5"],
  notAuthorized: [],
};

const compiler: Role<DesignState> = {
  id: "compiler",
  description: "Runs compilation gates on the candidate method",
  observe: (s) => s,
  authorized: ["sigma_6"],
  notAuthorized: [],
};

// ── Steps ──

const steps: Step<DesignState>[] = [
  {
    id: "sigma_0",
    name: "Orientation",
    role: "designer",
    precondition: TRUE,
    postcondition: check("has_knowledge", (s: DesignState) => s.domainKnowledge.length > 0),
    execution: { tag: "script", execute: (s) => Effect.succeed(s) },
  },
  {
    id: "sigma_1",
    name: "Domain Theory Crystallization",
    role: "designer",
    precondition: check("has_knowledge", (s: DesignState) => s.domainKnowledge.length > 0),
    postcondition: check("has_domain", (s: DesignState) => s.candidateComponents.includes("DomainTheory")),
    execution: {
      tag: "script",
      execute: (s) => Effect.succeed({ ...s, candidateComponents: [...s.candidateComponents, "DomainTheory"] }),
    },
  },
  {
    id: "sigma_2",
    name: "Objective + Measure",
    role: "designer",
    precondition: check("has_domain", (s: DesignState) => s.candidateComponents.includes("DomainTheory")),
    postcondition: check("has_objective", (s: DesignState) => s.candidateComponents.includes("Objective")),
    execution: {
      tag: "script",
      execute: (s) => Effect.succeed({ ...s, candidateComponents: [...s.candidateComponents, "Objective", "Measure"] }),
    },
  },
  {
    id: "sigma_3",
    name: "Role Design",
    role: "designer",
    precondition: check("has_objective", (s: DesignState) => s.candidateComponents.includes("Objective")),
    postcondition: check("has_roles", (s: DesignState) => s.candidateComponents.includes("Roles")),
    execution: {
      tag: "script",
      execute: (s) => Effect.succeed({ ...s, candidateComponents: [...s.candidateComponents, "Roles"] }),
    },
  },
  {
    id: "sigma_4",
    name: "Step DAG Construction",
    role: "designer",
    precondition: check("has_roles", (s: DesignState) => s.candidateComponents.includes("Roles")),
    postcondition: check("has_dag", (s: DesignState) => s.candidateComponents.includes("StepDAG")),
    execution: {
      tag: "script",
      execute: (s) => Effect.succeed({ ...s, candidateComponents: [...s.candidateComponents, "StepDAG"] }),
    },
  },
  {
    id: "sigma_5",
    name: "Guidance Audit",
    role: "designer",
    precondition: check("has_dag", (s: DesignState) => s.candidateComponents.includes("StepDAG")),
    postcondition: check("guidance_done", (s: DesignState) => s.guidanceFinalized),
    execution: {
      tag: "script",
      execute: (s) => Effect.succeed({ ...s, guidanceFinalized: true }),
    },
  },
  {
    id: "sigma_6",
    name: "Compilation Check",
    role: "compiler",
    precondition: check("guidance_done", (s: DesignState) => s.guidanceFinalized),
    postcondition: check("compiled", (s: DesignState) => s.compiled),
    execution: {
      tag: "script",
      execute: (s) => Effect.succeed({ ...s, compiled: true }),
    },
  },
];

// ── DAG ──

const dag: StepDAG<DesignState> = {
  steps,
  edges: [
    { from: "sigma_0", to: "sigma_1" },
    { from: "sigma_1", to: "sigma_2" },
    { from: "sigma_2", to: "sigma_3" },
    { from: "sigma_3", to: "sigma_4" },
    { from: "sigma_4", to: "sigma_5" },
    { from: "sigma_5", to: "sigma_6" },
  ],
  initial: "sigma_0",
  terminal: "sigma_6",
};

// ── Method ──

/** M1_MDES — Method Design method (F1-FTH Def 6.1). 7 steps, linear DAG. */
export const M1_MDES: Method<DesignState> = {
  id: "M1-MDES",
  name: "Method Design",
  domain: D_DESIGN,
  roles: [designer, compiler],
  dag,
  objective: check("compiled", (s: DesignState) => s.compiled),
  measures: [
    {
      id: "mu_design_progress",
      name: "Design Progress",
      compute: (s: DesignState) => s.candidateComponents.length / 5,
      range: [0, 1],
      terminal: 1,
    },
  ],
};
