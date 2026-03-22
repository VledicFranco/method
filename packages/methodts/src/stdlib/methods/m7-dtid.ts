/**
 * M7_DTID — Domain Theory to Implementation Derivation (M7-DTID v1.1).
 *
 * 5 steps in a diamond DAG: Theory Intake → {Derivation Pass ∥ Gap Pass} →
 * Faithfulness Check → IDD Assembly.
 *
 * Takes a compiled domain theory D = (Σ, Ax) and produces an Implementation
 * Decision Document (IDD) mapping every Σ-element and axiom to a forced
 * implementation choice (via the derivation taxonomy) or a documented free
 * choice. Addresses open problem P6 (theory-implementation faithfulness).
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
import { check, and } from "../../predicate/predicate.js";
import type { DerivationState } from "../types.js";

// ── Domain Theory ──

/** Simplified derivation domain theory. Maps to D_DTID from the YAML. */
const D_DTID: DomainTheory<DerivationState> = {
  id: "D_DTID",
  signature: {
    sorts: [
      { name: "DomainTheory", description: "The source domain theory D = (Σ, Ax) being analyzed", cardinality: "unbounded" },
      { name: "ΣElement", description: "A sort, function symbol, or predicate symbol in Σ", cardinality: "unbounded" },
      { name: "Axiom", description: "A closed sentence in Ax", cardinality: "unbounded" },
      { name: "DerivationRule", description: "One of the 10+1 taxonomy rules", cardinality: "finite" },
      { name: "ForcedChoice", description: "An implementation decision fully determined by D", cardinality: "unbounded" },
      { name: "FreeChoice", description: "An implementation decision under-determined by D", cardinality: "unbounded" },
      { name: "IDD", description: "The Implementation Decision Document output artifact", cardinality: "unbounded" },
      { name: "nat", description: "Natural numbers for coverage counts", cardinality: "unbounded" },
    ],
    functionSymbols: [
      { name: "idd_of", inputSorts: ["DomainTheory"], outputSort: "IDD", totality: "total", description: "Maps D to its IDD artifact" },
      { name: "source", inputSorts: ["ForcedChoice"], outputSort: "ΣElement", totality: "total", description: "The source element of a forced choice" },
      { name: "rule_applied", inputSorts: ["ForcedChoice"], outputSort: "DerivationRule", totality: "total", description: "The taxonomy rule applied" },
      { name: "forced_table", inputSorts: ["IDD"], outputSort: "ForcedChoice", totality: "total", description: "All forced choices in the IDD" },
      { name: "free_table", inputSorts: ["IDD"], outputSort: "FreeChoice", totality: "total", description: "All free choices in the IDD" },
    ],
    predicates: {
      has_source: check<DerivationState>("has_source", (s) => s.sourceMethodId.length > 0),
      domain_analyzed: check<DerivationState>("domain_analyzed", (s) => s.domainAnalysis.length > 0),
      has_plan: check<DerivationState>("has_plan", (s) => s.implementationPlan.length > 0),
      has_artifacts: check<DerivationState>("has_artifacts", (s) => s.derivedArtifacts.length > 0),
      faithful: check<DerivationState>("faithful", (s) => s.faithfulnessChecked),
      idd_produced: check<DerivationState>("idd_produced", (s) => s.idd.length > 0),
    },
  },
  axioms: {},
};

// ── Roles ──

/** ρ_DR — Domain Reader: enumerates Σ-elements and axioms. */
const domainReader: Role<DerivationState> = {
  id: "domain_reader",
  description: "Reads the domain theory document, enumerates all Σ-elements and axioms, and sets annotation flags",
  observe: (s) => s,
  authorized: ["sigma_A1"],
  notAuthorized: [],
};

/** ρ_DA — Derivation Analyst: applies derivation taxonomy to produce forced choices. */
const derivationAnalyst: Role<DerivationState> = {
  id: "derivation_analyst",
  description: "Applies the derivation taxonomy to each Σ-element and axiom, producing forced choices",
  observe: (s) => s,
  authorized: ["sigma_A2"],
  notAuthorized: [],
};

/** ρ_GA — Gap Analyst: addresses under-determined points, producing free choices. */
const gapAnalyst: Role<DerivationState> = {
  id: "gap_analyst",
  description: "Addresses all under-determined points, producing free choices with documented rationale",
  observe: (s) => s,
  authorized: ["sigma_A3"],
  notAuthorized: [],
};

/** ρ_IC — IDD Compiler: verifies faithfulness and assembles the final IDD. */
const iddCompiler: Role<DerivationState> = {
  id: "idd_compiler",
  description: "Verifies faithfulness (all axioms covered) then assembles the final IDD document",
  observe: (s) => s,
  authorized: ["sigma_A4", "sigma_A5"],
  notAuthorized: [],
};

// ── Steps ──

const steps: Step<DerivationState>[] = [
  {
    id: "sigma_A1",
    name: "Theory Intake",
    role: "domain_reader",
    precondition: check("has_source", (s: DerivationState) => s.sourceMethodId.length > 0),
    postcondition: check("domain_analyzed", (s: DerivationState) => s.domainAnalysis.length > 0),
    execution: { tag: "script", execute: (s) => Effect.succeed(s) },
  },
  {
    id: "sigma_A2",
    name: "Derivation Pass",
    role: "derivation_analyst",
    precondition: check("domain_analyzed", (s: DerivationState) => s.domainAnalysis.length > 0),
    postcondition: check("has_plan", (s: DerivationState) => s.implementationPlan.length > 0),
    execution: { tag: "script", execute: (s) => Effect.succeed(s) },
  },
  {
    id: "sigma_A3",
    name: "Gap Pass",
    role: "gap_analyst",
    precondition: check("domain_analyzed", (s: DerivationState) => s.domainAnalysis.length > 0),
    postcondition: check("has_artifacts", (s: DerivationState) => s.derivedArtifacts.length > 0),
    execution: { tag: "script", execute: (s) => Effect.succeed(s) },
  },
  {
    id: "sigma_A4",
    name: "Faithfulness Check",
    role: "idd_compiler",
    precondition: and(
      check("has_plan", (s: DerivationState) => s.implementationPlan.length > 0),
      check("has_artifacts", (s: DerivationState) => s.derivedArtifacts.length > 0),
    ),
    postcondition: check("faithful", (s: DerivationState) => s.faithfulnessChecked),
    execution: { tag: "script", execute: (s) => Effect.succeed(s) },
  },
  {
    id: "sigma_A5",
    name: "IDD Assembly",
    role: "idd_compiler",
    precondition: check("faithful", (s: DerivationState) => s.faithfulnessChecked),
    postcondition: check("idd_produced", (s: DerivationState) => s.idd.length > 0),
    execution: { tag: "script", execute: (s) => Effect.succeed(s) },
  },
];

// ── DAG (diamond with parallel branches) ──

const dag: StepDAG<DerivationState> = {
  steps,
  edges: [
    { from: "sigma_A1", to: "sigma_A2" },
    { from: "sigma_A1", to: "sigma_A3" },
    { from: "sigma_A2", to: "sigma_A4" },
    { from: "sigma_A3", to: "sigma_A4" },
    { from: "sigma_A4", to: "sigma_A5" },
  ],
  initial: "sigma_A1",
  terminal: "sigma_A5",
};

// ── Progress measures ──

/** μ₁ — axiom coverage: fraction of plan items completed. */
function axiomCoverage(s: DerivationState): number {
  if (s.implementationPlan.length === 0 && s.derivedArtifacts.length === 0) return 0;
  // Simplified: progress through the derivation pipeline
  let progress = 0;
  if (s.domainAnalysis.length > 0) progress += 1;
  if (s.implementationPlan.length > 0) progress += 1;
  if (s.derivedArtifacts.length > 0) progress += 1;
  if (s.faithfulnessChecked) progress += 1;
  if (s.idd.length > 0) progress += 1;
  return progress / 5;
}

/** μ₂ — free choice documentation: 1.0 if all gaps addressed, 0 otherwise. */
function freeChoiceDocumentation(s: DerivationState): number {
  // In terminal state: derivedArtifacts populated and faithfulness checked
  if (s.derivedArtifacts.length > 0 && s.faithfulnessChecked) return 1;
  if (s.derivedArtifacts.length > 0) return 0.5;
  return 0;
}

// ── Method ──

/** M7_DTID — Domain Theory to Implementation Derivation (v1.1). 5 steps, diamond DAG. */
export const M7_DTID: Method<DerivationState> = {
  id: "M7-DTID",
  name: "Domain Theory to Implementation Derivation",
  domain: D_DTID,
  roles: [domainReader, derivationAnalyst, gapAnalyst, iddCompiler],
  dag,
  objective: and(
    check("faithful", (s: DerivationState) => s.faithfulnessChecked),
    check("idd_produced", (s: DerivationState) => s.idd.length > 0),
  ),
  measures: [
    {
      id: "mu_axiom_coverage",
      name: "Axiom Coverage",
      compute: axiomCoverage,
      range: [0, 1],
      terminal: 1,
    },
    {
      id: "mu_free_choice_documentation",
      name: "Free Choice Documentation",
      compute: freeChoiceDocumentation,
      range: [0, 1],
      terminal: 1,
    },
  ],
};
