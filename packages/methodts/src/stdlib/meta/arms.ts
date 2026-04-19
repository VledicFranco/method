// SPDX-License-Identifier: Apache-2.0
/**
 * P0-META transition arms — the 8 priority-ordered conditions of delta_META.
 *
 * Each arm maps a MetaState condition to a sub-methodology selection.
 * Arms are ordered by priority (1 = highest). The transition function
 * evaluates arms in priority order and selects the first match.
 *
 * @see registry/delta_META — formal definition
 * @see F1-FTH Definition 7.1 — delta_Phi priority-stack encoding
 */

import { check } from "../../predicate/predicate.js";
import type { Arm } from "../../methodology/methodology.js";
import type { Method } from "../../method/method.js";
import type { MetaState } from "../types.js";
import { M1_MDES } from "../methods/m1-mdes.js";
import { M2_MDIS } from "../methods/m2-mdis.js";
import { M3_MEVO } from "../methods/m3-mevo.js";
import { M4_MINS } from "../methods/m4-mins.js";
import { M5_MCOM } from "../methods/m5-mcom.js";
import { M7_DTID } from "../methods/m7-dtid.js";

/** Arm 1: Gap with HIGH/CRITICAL severity -> M3-MEVO (evolution). */
export const arm_gap_severity: Arm<MetaState> = {
  priority: 1,
  label: "gap_severity_first",
  condition: check<MetaState>("has_high_gap", (s) => s.highGapMethods.length > 0),
  selects: M3_MEVO as unknown as Method<MetaState>,
  rationale: "HIGH/CRITICAL gaps in compiled methods must be addressed first via evolution.",
};

/** Arm 2: Method in design lifecycle -> M1-MDES. */
export const arm_lifecycle_design: Arm<MetaState> = {
  priority: 2,
  label: "lifecycle_design",
  condition: check<MetaState>("has_informal", (s) => s.informalPractices.length > 0),
  selects: M1_MDES as unknown as Method<MetaState>,
  rationale: "Informal practices need to be designed into formal methods.",
};

/** Arm 3: Method needs instantiation -> M4-MINS. */
export const arm_lifecycle_instantiation: Arm<MetaState> = {
  priority: 3,
  label: "lifecycle_instantiation",
  condition: check<MetaState>("needs_instantiation", (s) => s.needsInstantiation.length > 0),
  selects: M4_MINS as unknown as Method<MetaState>,
  rationale: "Compiled methods need project-specific instances.",
};

/** Arm 4: Composable pair found -> M5-MCOM. */
export const arm_structural_composition: Arm<MetaState> = {
  priority: 4,
  label: "structural_composition",
  condition: check<MetaState>("has_composable", (s) => s.composablePairs.length > 0),
  selects: M5_MCOM as unknown as Method<MetaState>,
  rationale: "Composable method pairs should be composed.",
};

/** Arm 5: Methods needing audit -> M6-MAUD. */
export const arm_structural_audit: Arm<MetaState> = {
  priority: 5,
  label: "structural_audit",
  condition: check<MetaState>("not_self_consistent", (s) =>
    s.compiledMethods.some((m) => !s.selfConsistentMethods.includes(m)),
  ),
  selects: null, // M6_MAUD — not in registry (deferred)
  rationale: "Compiled methods lacking self-consistency need structural audit.",
};

/** Arm 6: Implementation derivation -> M7-DTID. */
export const arm_implementation_derivation: Arm<MetaState> = {
  priority: 6,
  label: "implementation_derivation",
  condition: check<MetaState>("compiled_exists", (s) => s.compiledMethods.length > 0),
  selects: M7_DTID as unknown as Method<MetaState>,
  rationale: "Compiled methods need implementation derivation documents.",
};

/** Arm 7: Discovery needed -> M2-MDIS. */
export const arm_discovery: Arm<MetaState> = {
  priority: 7,
  label: "discovery",
  condition: check<MetaState>("target_has_uncompiled", (s) =>
    s.targetRegistry.some((m) => !s.compiledMethods.includes(m)),
  ),
  selects: M2_MDIS as unknown as Method<MetaState>,
  rationale: "Target registry has methods not yet compiled — discover and design.",
};

/** Arm 8: All clean -> terminate. */
export const arm_terminate: Arm<MetaState> = {
  priority: 8,
  label: "terminate",
  condition: check<MetaState>("all_clean", (s) =>
    s.highGapMethods.length === 0 &&
    s.informalPractices.length === 0 &&
    s.needsInstantiation.length === 0 &&
    s.composablePairs.length === 0 &&
    s.targetRegistry.every((m) => s.compiledMethods.includes(m)),
  ),
  selects: null, // Terminate — no method selected
  rationale: "All methods compiled, no gaps, no pending work — methodology complete.",
};

/** All 8 arms in priority order. */
export const META_ARMS: readonly Arm<MetaState>[] = [
  arm_gap_severity,
  arm_lifecycle_design,
  arm_lifecycle_instantiation,
  arm_structural_composition,
  arm_structural_audit,
  arm_implementation_derivation,
  arm_discovery,
  arm_terminate,
];
