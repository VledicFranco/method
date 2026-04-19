// SPDX-License-Identifier: Apache-2.0
/**
 * M7_PRDS — PRD Sectioning Method (M7-PRDS v1.0).
 *
 * 3 steps in a linear DAG: Analyze → Decompose → Order.
 *
 * Takes a full PRD and decomposes it into plannable PRDSections — scoped, ordered
 * units that M5-PLAN can consume individually. Identifies dependencies between
 * sections, proposes a delivery ordering, and produces a SectionMap.
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

type PrdsState = {
  readonly featureClusters: readonly { readonly name: string; readonly requirements: readonly string[] }[];
  readonly architectureContext: readonly string[];
  readonly sections: readonly { readonly id: string; readonly name: string; readonly scopeBoundary: string; readonly acceptanceCriteria: readonly string[] }[];
  readonly coverageVerified: boolean;
  readonly dependencies: readonly { readonly from: string; readonly to: string; readonly reason: string }[];
  readonly deliveryOrder: readonly string[];
  readonly sectionMapComplete: boolean;
};

// ── Domain Theory ──

const D_PRDS: DomainTheory<PrdsState> = {
  id: "D_PRDS",
  signature: {
    sorts: [
      { name: "PRD", description: "The full product requirements document", cardinality: "singleton" },
      { name: "FeatureCluster", description: "A group of related requirements forming a coherent delivery unit", cardinality: "finite" },
      { name: "PRDSection", description: "A scoped, self-contained unit that M5-PLAN can consume", cardinality: "finite" },
      { name: "Dependency", description: "A directed edge: PRDSection A must be delivered before PRDSection B", cardinality: "finite" },
      { name: "SectionMap", description: "Ordered list of PRDSections with dependency graph and delivery sequence", cardinality: "singleton" },
      { name: "ArchDoc", description: "Architecture documents informing how the PRD maps to system structure", cardinality: "finite" },
    ],
    functionSymbols: [],
    predicates: {
      clusters_identified: check<PrdsState>("clusters_identified", (s) => s.featureClusters.length > 0),
      sections_produced: check<PrdsState>("sections_produced", (s) => s.sections.length > 0 && s.coverageVerified),
      section_map_complete: check<PrdsState>("section_map_complete", (s) => s.sectionMapComplete && s.deliveryOrder.length > 0),
    },
  },
  axioms: {},
};

// ── Roles ──

const sectioner: Role<PrdsState> = {
  id: "sectioner",
  description: "Reads the full PRD and architecture docs. Produces the decomposition. Does not plan or implement.",
  observe: (s) => s,
  authorized: ["sigma_0", "sigma_1", "sigma_2"],
  notAuthorized: [],
};

// ── Steps ──

const steps: Step<PrdsState>[] = [
  {
    id: "sigma_0",
    name: "Analyze",
    role: "sectioner",
    precondition: TRUE,
    postcondition: check("clusters_identified", (s: PrdsState) => s.featureClusters.length > 0),
    execution: { tag: "script", execute: (s) => Effect.succeed(s) },
  },
  {
    id: "sigma_1",
    name: "Decompose",
    role: "sectioner",
    precondition: check("clusters_identified", (s: PrdsState) => s.featureClusters.length > 0),
    postcondition: check("sections_produced", (s: PrdsState) => s.sections.length > 0 && s.coverageVerified),
    execution: { tag: "script", execute: (s) => Effect.succeed(s) },
  },
  {
    id: "sigma_2",
    name: "Order",
    role: "sectioner",
    precondition: check("sections_produced", (s: PrdsState) => s.sections.length > 0 && s.coverageVerified),
    postcondition: check("section_map_complete", (s: PrdsState) => s.sectionMapComplete && s.deliveryOrder.length > 0),
    execution: { tag: "script", execute: (s) => Effect.succeed(s) },
  },
];

// ── DAG ──

const dag: StepDAG<PrdsState> = {
  steps,
  edges: [
    { from: "sigma_0", to: "sigma_1" },
    { from: "sigma_1", to: "sigma_2" },
  ],
  initial: "sigma_0",
  terminal: "sigma_2",
};

// ── Method ──

/** M7_PRDS — PRD Sectioning Method (v1.0). 3 steps, linear DAG. */
export const M7_PRDS: Method<PrdsState> = {
  id: "M7-PRDS",
  name: "PRD Sectioning Method",
  domain: D_PRDS,
  roles: [sectioner],
  dag,
  objective: check("sectioning_complete", (s: PrdsState) =>
    s.sections.length > 0 && s.coverageVerified && s.sectionMapComplete && s.deliveryOrder.length > 0,
  ),
  measures: [
    {
      id: "mu_coverage",
      name: "PRD Coverage",
      compute: (s: PrdsState) => (s.coverageVerified ? 1 : 0),
      range: [0, 1],
      terminal: 1,
    },
    {
      id: "mu_scoping",
      name: "Section Scoping Completeness",
      compute: (s: PrdsState) => {
        if (s.sections.length === 0) return 0;
        const scoped = s.sections.filter((sec) => sec.scopeBoundary.length > 0 && sec.acceptanceCriteria.length > 0);
        return scoped.length / s.sections.length;
      },
      range: [0, 1],
      terminal: 1,
    },
    {
      id: "mu_dag_validity",
      name: "Dependency DAG Validity",
      compute: (s: PrdsState) => (s.sectionMapComplete ? 1 : 0),
      range: [0, 1],
      terminal: 1,
    },
  ],
};
