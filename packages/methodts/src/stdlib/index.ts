// SPDX-License-Identifier: Apache-2.0
/**
 * @methodts/methodts/stdlib — Standard Library
 *
 * Ships P0-META (the genesis methodology) as typed MethodTS values.
 * Self-hosting: methodology designers use the stdlib's own meta-methods
 * to design, compile, evolve, and instantiate new methodologies.
 *
 * Phase 1b: P0-META + M1-MDES
 * Phase 2: P1-EXEC + P2-SD + remaining meta-methods
 * Phase 3: P-GH + P3-GOV + P3-DISPATCH
 */

// ── WU-6.1: Types, D_META, Predicates ──
export * from "./types.js";
export { D_META } from "./meta/d-meta.js";
export { predicates } from "./predicates.js";

// ── WU-6.2: M1_MDES + Compilation Gates ──
export { M1_MDES } from "./methods/m1-mdes.js";
export { G1_domain, G2_objective, G3_roles, G4_dag, G5_guidance, G6_serializable, compilationGates } from "./gates.js";

// ── WU-6.3: P0_META + Arms + Prompts ──
export { P0_META } from "./meta/p0-meta.js";
export { arm_gap_severity, arm_lifecycle_design, arm_lifecycle_instantiation, arm_structural_composition, arm_structural_audit, arm_implementation_derivation, arm_discovery, arm_terminate } from "./meta/arms.js";
export { prompts } from "./prompts.js";

// ── Phase 2: Meta-methods (Wave 10) ──
export { M2_MDIS } from "./methods/m2-mdis.js";
export { M3_MEVO } from "./methods/m3-mevo.js";
export { M4_MINS } from "./methods/m4-mins.js";
export { M5_MCOM } from "./methods/m5-mcom.js";
export { M7_DTID } from "./methods/m7-dtid.js";

// ── Phase 2: P1-EXEC methods ──
export { M1_COUNCIL } from "./methods/p1/m1-council.js";
export { M2_ORCH } from "./methods/p1/m2-orch.js";
export { M3_TMP } from "./methods/p1/m3-tmp.js";
export { M4_ADVREV } from "./methods/p1/m4-advrev.js";

// ── Phase 2: P2-SD methods ──
export { M1_IMPL } from "./methods/p2/m1-impl.js";
export { M2_DIMPL } from "./methods/p2/m2-dimpl.js";
export { M3_PHRV } from "./methods/p2/m3-phrv.js";
export { M4_DDAG } from "./methods/p2/m4-ddag.js";
export { M5_PLAN } from "./methods/p2/m5-plan.js";
export { M6_ARFN } from "./methods/p2/m6-arfn.js";
export { M7_PRDS } from "./methods/p2/m7-prds.js";

// ── Phase 2: Delivery methodologies (Wave 12) ──
export { P1_EXEC } from "./methodologies/p1-exec.js";
export { P2_SD } from "./methodologies/p2-sd.js";

// ── Phase 3: P-GH methods ──
export { M1_TRIAGE } from "./methods/pgh/m1-triage.js";
export { M2_REVIEW_GH } from "./methods/pgh/m2-review.js";
export { M3_RESOLVE } from "./methods/pgh/m3-resolve.js";
export { M4_WORK } from "./methods/pgh/m4-work.js";

// ── Phase 3: P3-GOV methods ──
export { M1_DRAFT } from "./methods/p3gov/m1-draft.js";
export { M2_REVIEW_GOV } from "./methods/p3gov/m2-review.js";
export { M3_APPROVE } from "./methods/p3gov/m3-approve.js";
export { M4_HANDOFF } from "./methods/p3gov/m4-handoff.js";

// ── Phase 3: P3-DISPATCH methods ──
export { M1_INTERACTIVE } from "./methods/p3disp/m1-interactive.js";
export { M2_SEMIAUTO } from "./methods/p3disp/m2-semiauto.js";
export { M3_FULLAUTO } from "./methods/p3disp/m3-fullauto.js";

// ── Phase 3: Additional methodologies ──
export { P_GH } from "./methodologies/p-gh.js";
export { P3_GOV } from "./methodologies/p3-gov.js";
export { P3_DISPATCH } from "./methodologies/p3-dispatch.js";

// ── Registry catalog ──
export { getStdlibCatalog, getMethod, getMethodology } from "./catalog.js";
export type { CatalogMethodEntry, CatalogMethodologyEntry } from "./catalog.js";
