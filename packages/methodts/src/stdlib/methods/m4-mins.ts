// SPDX-License-Identifier: Apache-2.0
/**
 * M4_MINS — Method Instantiation method (F1-FTH Definition 6.1).
 *
 * Instantiates a general compiled method M.X into a project instance P.X.Y.
 * 7 steps in a linear DAG: Orientation -> Domain Extension -> Domain Morphism
 * Declaration -> Step Specialization -> Role File Production ->
 * Version Coupling Declaration -> Compilation Check.
 *
 * Phase 1b: all steps are script execution. Agent prompts are deferred
 * to Phase 2 when the provider system is wired in.
 *
 * @see registry/P0-META/M4-MINS/M4-MINS.yaml
 */

import { Effect } from "effect";
import type { Method } from "../../method/method.js";
import type { Step } from "../../method/step.js";
import type { StepDAG } from "../../method/dag.js";
import type { DomainTheory } from "../../domain/domain-theory.js";
import type { Role } from "../../domain/role.js";
import { check, TRUE } from "../../predicate/predicate.js";
import type { InstantiationState } from "../types.js";

// ── Domain Theory ──

const D_MINS: DomainTheory<InstantiationState> = {
  id: "D_MINS",
  signature: {
    sorts: [
      { name: "Method", description: "The general method M.X being instantiated", cardinality: "unbounded" },
      { name: "ProjectContext", description: "Project context: tech stack, arch docs, team roles, constraints", cardinality: "unbounded" },
      { name: "DomainMorphism", description: "Retraction pair (embed, project) with retraction on touched subspace", cardinality: "unbounded" },
      { name: "SpecializedStep", description: "A project-specialized version of a step in M.X", cardinality: "unbounded" },
      { name: "RoleFile", description: "Self-contained role document with projections and step guidance", cardinality: "unbounded" },
      { name: "ProjectInstance", description: "P.X.Y — the output: morphism + specialized steps + role files + version coupling", cardinality: "unbounded" },
      { name: "CompilationResult", description: "PASS or FAIL at sigma_6", cardinality: "finite" },
    ],
    functionSymbols: [
      { name: "general_domain", inputSorts: ["Method"], outputSort: "Method", totality: "total", description: "Domain theory D of the general method M.X" },
      { name: "step_count", inputSorts: ["Method"], outputSort: "Method", totality: "total", description: "Number of steps in M.X's DAG" },
    ],
    predicates: {
      has_method: check<InstantiationState>("has_method", (s) => s.methodId.length > 0),
      has_context: check<InstantiationState>("has_context", (s) => s.projectContext.length > 0),
      has_morphism: check<InstantiationState>("has_morphism", (s) => s.domainMorphism.length > 0),
      has_bound_steps: check<InstantiationState>("has_bound_steps", (s) => s.boundSteps.length > 0),
      has_role_files: check<InstantiationState>("has_role_files", (s) => s.roleFiles.length > 0),
      validated: check<InstantiationState>("validated", (s) => s.validated),
    },
  },
  axioms: {
    method_required: check<InstantiationState>("method_required", (s) =>
      s.validated ? s.methodId.length > 0 : true,
    ),
    context_required: check<InstantiationState>("context_required", (s) =>
      s.validated ? s.projectContext.length > 0 : true,
    ),
  },
};

// ── Roles ──

const instantiator: Role<InstantiationState> = {
  id: "instantiator",
  description: "Executes sigma_0 through sigma_5. Has dual knowledge: the general method M.X and the target project context.",
  observe: (s) => s,
  authorized: ["sigma_0", "sigma_1", "sigma_2", "sigma_3", "sigma_4", "sigma_5"],
  notAuthorized: [],
};

const compiler: Role<InstantiationState> = {
  id: "compiler",
  description: "Executes sigma_6. Evaluates P.X.Y against acceptance gates G0-G6 independently.",
  observe: (s) => s,
  authorized: ["sigma_6"],
  notAuthorized: [],
};

// ── Steps ──

const steps: Step<InstantiationState>[] = [
  {
    id: "sigma_0",
    name: "Orientation",
    role: "instantiator",
    precondition: TRUE,
    postcondition: check("has_method_and_context", (s: InstantiationState) =>
      s.methodId.length > 0 && s.projectContext.length > 0,
    ),
    execution: { tag: "script", execute: (s) => Effect.succeed(s) },
  },
  {
    id: "sigma_1",
    name: "Domain Extension",
    role: "instantiator",
    precondition: check("has_method_and_context", (s: InstantiationState) =>
      s.methodId.length > 0 && s.projectContext.length > 0,
    ),
    postcondition: check("has_method_and_context", (s: InstantiationState) =>
      s.methodId.length > 0 && s.projectContext.length > 0,
    ),
    execution: { tag: "script", execute: (s) => Effect.succeed(s) },
  },
  {
    id: "sigma_2",
    name: "Domain Morphism Declaration",
    role: "instantiator",
    precondition: check("has_method_and_context", (s: InstantiationState) =>
      s.methodId.length > 0 && s.projectContext.length > 0,
    ),
    postcondition: check("has_morphism", (s: InstantiationState) =>
      s.domainMorphism.length > 0,
    ),
    execution: {
      tag: "script",
      execute: (s) => Effect.succeed({ ...s, domainMorphism: "embed-project-retraction" }),
    },
  },
  {
    id: "sigma_3",
    name: "Step Specialization",
    role: "instantiator",
    precondition: check("has_morphism", (s: InstantiationState) =>
      s.domainMorphism.length > 0,
    ),
    postcondition: check("has_bound_steps", (s: InstantiationState) =>
      s.boundSteps.length > 0,
    ),
    execution: {
      tag: "script",
      execute: (s) => Effect.succeed({ ...s, boundSteps: [...s.boundSteps, "specialized"] }),
    },
  },
  {
    id: "sigma_4",
    name: "Role File Production",
    role: "instantiator",
    precondition: check("has_bound_steps", (s: InstantiationState) =>
      s.boundSteps.length > 0,
    ),
    postcondition: check("has_role_files", (s: InstantiationState) =>
      s.roleFiles.length > 0,
    ),
    execution: {
      tag: "script",
      execute: (s) => Effect.succeed({ ...s, roleFiles: [...s.roleFiles, "role-file"] }),
    },
  },
  {
    id: "sigma_5",
    name: "Version Coupling Declaration",
    role: "instantiator",
    precondition: check("has_role_files", (s: InstantiationState) =>
      s.roleFiles.length > 0,
    ),
    postcondition: check("has_role_files", (s: InstantiationState) =>
      s.roleFiles.length > 0,
    ),
    execution: { tag: "script", execute: (s) => Effect.succeed(s) },
  },
  {
    id: "sigma_6",
    name: "Compilation Check",
    role: "compiler",
    precondition: check("has_role_files", (s: InstantiationState) =>
      s.roleFiles.length > 0,
    ),
    postcondition: check("validated", (s: InstantiationState) => s.validated),
    execution: {
      tag: "script",
      execute: (s) => Effect.succeed({ ...s, validated: true }),
    },
  },
];

// ── DAG ──

const dag: StepDAG<InstantiationState> = {
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

/** M4_MINS — Method Instantiation (F1-FTH Def 6.1). 7 steps, linear DAG. */
export const M4_MINS: Method<InstantiationState> = {
  id: "M4-MINS",
  name: "Method Instantiation",
  domain: D_MINS,
  roles: [instantiator, compiler],
  dag,
  objective: check("validated", (s: InstantiationState) => s.validated),
  measures: [
    {
      id: "mu_morphism_completeness",
      name: "Morphism Declaration Completeness",
      compute: (s: InstantiationState) => s.domainMorphism.length > 0 ? 1 : 0,
      range: [0, 1],
      terminal: 1,
    },
    {
      id: "mu_specialization_coverage",
      name: "Specialization Coverage",
      compute: (s: InstantiationState) =>
        (s.boundSteps.length + s.roleFiles.length) / 2,
      range: [0, 1],
      terminal: 1,
    },
    {
      id: "mu_compilation_gate_passage",
      name: "Compilation Gate Passage Rate",
      compute: (s: InstantiationState) => s.validated ? 1 : 0,
      range: [0, 1],
      terminal: 1,
    },
  ],
};
