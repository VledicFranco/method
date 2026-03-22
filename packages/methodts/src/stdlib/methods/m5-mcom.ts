/**
 * M5_MCOM — Method Composition method (F1-FTH Definition 6.1).
 *
 * Composes two compiled methods M and M' sequentially into a composite
 * method M'' = M ; M'. 7 steps in a linear DAG: Orientation ->
 * Interface Declaration -> Domain Composition -> DAG Composition ->
 * Role Merge -> Objective Composition -> Compilation Check.
 *
 * Phase 1b: all steps are script execution. Agent prompts are deferred
 * to Phase 2 when the provider system is wired in.
 *
 * @see registry/P0-META/M5-MCOM/M5-MCOM.yaml
 */

import { Effect } from "effect";
import type { Method } from "../../method/method.js";
import type { Step } from "../../method/step.js";
import type { StepDAG } from "../../method/dag.js";
import type { DomainTheory } from "../../domain/domain-theory.js";
import type { Role } from "../../domain/role.js";
import { check, TRUE } from "../../predicate/predicate.js";
import type { CompositionState } from "../types.js";

// ── Domain Theory ──

const D_MCOM: DomainTheory<CompositionState> = {
  id: "D_MCOM",
  signature: {
    sorts: [
      { name: "LeftMethod", description: "M: compiled method that executes first", cardinality: "unbounded" },
      { name: "RightMethod", description: "M': compiled method that executes second", cardinality: "unbounded" },
      { name: "InterfaceSignature", description: "Sigma_I: shared sub-signature at the composition point", cardinality: "unbounded" },
      { name: "CompositionEdge", description: "Formal connection between sigma_term(M) and sigma_init(M')", cardinality: "unbounded" },
      { name: "CompositeMethod", description: "M'' = M ; M': the output 5-tuple", cardinality: "unbounded" },
      { name: "CompositeDomain", description: "D'' = (Sigma'', Ax''): domain of M''", cardinality: "unbounded" },
      { name: "CompilationResult", description: "PASS or FAIL at sigma_6", cardinality: "finite" },
    ],
    functionSymbols: [
      { name: "terminal_step", inputSorts: ["LeftMethod"], outputSort: "LeftMethod", totality: "total", description: "sigma_term(M)" },
      { name: "initial_step", inputSorts: ["RightMethod"], outputSort: "RightMethod", totality: "total", description: "sigma_init(M')" },
    ],
    predicates: {
      has_left: check<CompositionState>("has_left", (s) => s.methodA.length > 0),
      has_right: check<CompositionState>("has_right", (s) => s.methodB.length > 0),
      merged_domain: check<CompositionState>("merged_domain", (s) => s.mergedDomain),
      composed_dag: check<CompositionState>("composed_dag", (s) => s.composedDAG),
      unified_roles: check<CompositionState>("unified_roles", (s) => s.unifiedRoles),
      compiled: check<CompositionState>("compiled", (s) => s.compiled),
    },
  },
  axioms: {
    both_methods_required: check<CompositionState>("both_methods_required", (s) =>
      s.compiled ? s.methodA.length > 0 && s.methodB.length > 0 : true,
    ),
    domain_before_compile: check<CompositionState>("domain_before_compile", (s) =>
      s.compiled ? s.mergedDomain : true,
    ),
  },
};

// ── Roles ──

const composer: Role<CompositionState> = {
  id: "composer",
  description: "Executes sigma_0 through sigma_5. Has dual-method knowledge: both M and M' domain theories, step DAGs, role definitions, objectives, and compilation reports.",
  observe: (s) => s,
  authorized: ["sigma_0", "sigma_1", "sigma_2", "sigma_3", "sigma_4", "sigma_5"],
  notAuthorized: [],
};

const compiler: Role<CompositionState> = {
  id: "compiler",
  description: "Executes sigma_6. Evaluates M'' against G0-G6 independently.",
  observe: (s) => s,
  authorized: ["sigma_6"],
  notAuthorized: [],
};

// ── Steps ──

const steps: Step<CompositionState>[] = [
  {
    id: "sigma_0",
    name: "Orientation",
    role: "composer",
    precondition: TRUE,
    postcondition: check("has_both_methods", (s: CompositionState) =>
      s.methodA.length > 0 && s.methodB.length > 0,
    ),
    execution: { tag: "script", execute: (s) => Effect.succeed(s) },
  },
  {
    id: "sigma_1",
    name: "Interface Declaration",
    role: "composer",
    precondition: check("has_both_methods", (s: CompositionState) =>
      s.methodA.length > 0 && s.methodB.length > 0,
    ),
    postcondition: check("has_both_methods", (s: CompositionState) =>
      s.methodA.length > 0 && s.methodB.length > 0,
    ),
    execution: { tag: "script", execute: (s) => Effect.succeed(s) },
  },
  {
    id: "sigma_2",
    name: "Domain Composition",
    role: "composer",
    precondition: check("has_both_methods", (s: CompositionState) =>
      s.methodA.length > 0 && s.methodB.length > 0,
    ),
    postcondition: check("merged_domain", (s: CompositionState) => s.mergedDomain),
    execution: {
      tag: "script",
      execute: (s) => Effect.succeed({ ...s, mergedDomain: true }),
    },
  },
  {
    id: "sigma_3",
    name: "DAG Composition",
    role: "composer",
    precondition: check("merged_domain", (s: CompositionState) => s.mergedDomain),
    postcondition: check("composed_dag", (s: CompositionState) => s.composedDAG),
    execution: {
      tag: "script",
      execute: (s) => Effect.succeed({ ...s, composedDAG: true }),
    },
  },
  {
    id: "sigma_4",
    name: "Role Merge",
    role: "composer",
    precondition: check("composed_dag", (s: CompositionState) => s.composedDAG),
    postcondition: check("unified_roles", (s: CompositionState) => s.unifiedRoles),
    execution: {
      tag: "script",
      execute: (s) => Effect.succeed({ ...s, unifiedRoles: true }),
    },
  },
  {
    id: "sigma_5",
    name: "Objective Composition",
    role: "composer",
    precondition: check("unified_roles", (s: CompositionState) => s.unifiedRoles),
    postcondition: check("unified_roles", (s: CompositionState) => s.unifiedRoles),
    execution: { tag: "script", execute: (s) => Effect.succeed(s) },
  },
  {
    id: "sigma_6",
    name: "Compilation Check",
    role: "compiler",
    precondition: check("unified_roles", (s: CompositionState) => s.unifiedRoles),
    postcondition: check("compiled", (s: CompositionState) => s.compiled),
    execution: {
      tag: "script",
      execute: (s) => Effect.succeed({ ...s, compiled: true }),
    },
  },
];

// ── DAG ──

const dag: StepDAG<CompositionState> = {
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

/** M5_MCOM — Method Composition (F1-FTH Def 6.1). 7 steps, linear DAG. */
export const M5_MCOM: Method<CompositionState> = {
  id: "M5-MCOM",
  name: "Method Composition",
  domain: D_MCOM,
  roles: [composer, compiler],
  dag,
  objective: check("compiled", (s: CompositionState) => s.compiled),
  measures: [
    {
      id: "mu_interface_completeness",
      name: "Interface Declaration Completeness",
      compute: (s: CompositionState) =>
        (s.methodA.length > 0 ? 0.5 : 0) + (s.methodB.length > 0 ? 0.5 : 0),
      range: [0, 1],
      terminal: 1,
    },
    {
      id: "mu_structural_assembly",
      name: "Structural Assembly Completeness",
      compute: (s: CompositionState) => {
        let count = 0;
        if (s.mergedDomain) count++;
        if (s.composedDAG) count++;
        if (s.unifiedRoles) count++;
        return count / 3;
      },
      range: [0, 1],
      terminal: 1,
    },
    {
      id: "mu_compilation_gate_passage",
      name: "Compilation Gate Passage",
      compute: (s: CompositionState) => s.compiled ? 1 : 0,
      range: [0, 1],
      terminal: 1,
    },
  ],
};
