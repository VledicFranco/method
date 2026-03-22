/**
 * D_META — the domain theory for P0-META (F1-FTH Def 1.1).
 *
 * The meta-methodology's domain theory defines the sorts, function symbols,
 * predicates, and axioms that govern how methodologies themselves are
 * discovered, designed, compiled, evolved, and instantiated.
 *
 * @see F1-FTH Def 1.1 — D = (Σ, Ax)
 * @see theory/F1-FTH.md §1 — Domain theory foundations
 */

import type { DomainTheory } from "../../domain/domain-theory.js";
import { check } from "../../predicate/predicate.js";
import type { MetaState } from "../types.js";

/** D_META — the domain theory for P0-META (F1-FTH Def 1.1). */
export const D_META: DomainTheory<MetaState> = {
  id: "D_META",
  signature: {
    sorts: [
      { name: "Method", description: "A formal method M = (D, Roles, Gamma, O, mu_vec)", cardinality: "unbounded" },
      { name: "Methodology", description: "A formal methodology Phi = (D_Phi, delta_Phi, O_Phi)", cardinality: "unbounded" },
      { name: "MethodID", description: "Opaque string identifier", cardinality: "unbounded" },
      { name: "Status", description: "Compilation status: proposed, compiled, deprecated", cardinality: "finite" },
      { name: "Gap", description: "A named execution gap with evidence", cardinality: "unbounded" },
      { name: "Severity", description: "Severity rating: LOW, MEDIUM, HIGH, CRITICAL", cardinality: "finite" },
      { name: "ProjectContext", description: "Project deployment context", cardinality: "unbounded" },
      { name: "TargetRegistry", description: "Finite declared set of MethodIDs", cardinality: "unbounded" },
      { name: "LifecyclePosition", description: "Lifecycle stage: discovery, design, evolution, etc.", cardinality: "finite" },
      { name: "Domain", description: "A many-sorted signature + axioms pair", cardinality: "unbounded" },
      { name: "nat", description: "Natural numbers", cardinality: "unbounded" },
    ],
    functionSymbols: [
      { name: "status", inputSorts: ["Method"], outputSort: "Status", totality: "total" },
      { name: "lifecycle_pos", inputSorts: ["Method"], outputSort: "LifecyclePosition", totality: "total" },
      { name: "severity", inputSorts: ["Gap"], outputSort: "Severity", totality: "total" },
      { name: "target_size", inputSorts: ["TargetRegistry"], outputSort: "nat", totality: "total" },
      { name: "domain", inputSorts: ["Method"], outputSort: "Domain", totality: "total" },
    ],
    predicates: {
      compiled: check<MetaState>("compiled", s => s.compiledMethods.length > 0),
      has_gap: check<MetaState>("has_gap", s => s.highGapMethods.length > 0),
      needs_instantiation: check<MetaState>("needs_instantiation", s => s.needsInstantiation.length > 0),
      composable: check<MetaState>("composable", s => s.composablePairs.length > 0),
      self_consistent: check<MetaState>("self_consistent", s => s.selfConsistentMethods.length > 0),
      has_informal: check<MetaState>("has_informal", s => s.informalPractices.length > 0),
    },
  },
  axioms: {
    "Ax-1": check<MetaState>("target_nonempty", s => s.targetRegistry.length > 0),
    "Ax-2": check<MetaState>("compiled_in_target", s =>
      s.compiledMethods.every(m => s.targetRegistry.includes(m))),
    "Ax-3": check<MetaState>("gap_methods_compiled", s =>
      s.highGapMethods.every(m => s.compiledMethods.includes(m))),
    "Ax-4": check<MetaState>("instantiation_needs_compiled", s =>
      s.needsInstantiation.every(m => s.compiledMethods.includes(m))),
  },
};
