/**
 * P0_META — Genesis Methodology for the Meta-Method Family.
 *
 * F1-FTH Definition 7.1: Phi = (D_Phi, delta_Phi, O_Phi)
 * This is the top-level methodology that orchestrates all meta-methods:
 * M1-MDES, M2-MDIS, M3-MEVO, M4-MINS, M5-MCOM, M6-MAUD, M7-DTID.
 *
 * The transition function (delta_META) routes to the correct sub-method
 * based on the current MetaState via 8 priority-ordered arms.
 *
 * @see registry/delta_META — the formal transition function
 * @see theory/F1-FTH §7 — Methodology coalgebra
 */

import type { Methodology } from "../../methodology/methodology.js";
import type { DomainTheory } from "../../domain/domain-theory.js";
import { check } from "../../predicate/predicate.js";
import type { MetaState } from "../types.js";
import { META_ARMS } from "./arms.js";

/**
 * Simplified D_META domain theory for P0_META.
 *
 * The full D_META with complete signature and axioms will be provided
 * by WU-6.1 (d-meta.ts). This simplified version captures only the
 * structural validity axiom needed for P0_META routing.
 */
const D_META_SIMPLIFIED: DomainTheory<MetaState> = {
  id: "D_META",
  signature: {
    sorts: [
      { name: "Method", description: "A formal method", cardinality: "unbounded" },
      { name: "Status", description: "Compilation status", cardinality: "finite" },
    ],
    functionSymbols: [],
    predicates: {},
  },
  axioms: {
    "Ax-1": check<MetaState>("target_nonempty", (s) => s.targetRegistry.length > 0),
  },
};

/**
 * P0_META — Genesis Methodology for the Meta-Method Family.
 *
 * Evaluates the 8 transition arms in priority order to determine which
 * sub-method (M1-M7) to invoke, or terminates if all work is complete.
 *
 * Termination certificate: the measure counts remaining uncompiled methods
 * plus high-gap methods. Each arm reduces this count by compiling methods,
 * resolving gaps, instantiating, or composing.
 */
export const P0_META: Methodology<MetaState> = {
  id: "P0-META",
  name: "Genesis Methodology for the Meta-Method Family",
  domain: D_META_SIMPLIFIED,
  arms: META_ARMS,
  objective: check<MetaState>(
    "all_compiled",
    (s) =>
      s.targetRegistry.every((m) => s.compiledMethods.includes(m)) &&
      s.highGapMethods.length === 0,
  ),
  terminationCertificate: {
    measure: (s: MetaState) =>
      s.targetRegistry.length - s.compiledMethods.length + s.highGapMethods.length,
    decreases:
      "Each arm reduces pending work: compiles methods, resolves gaps, instantiates, or composes.",
  },
  safety: {
    maxLoops: 50,
    maxTokens: 2_000_000,
    maxCostUsd: 100,
    maxDurationMs: 7_200_000,
    maxDepth: 5,
  },
};
