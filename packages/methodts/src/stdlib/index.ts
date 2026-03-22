/**
 * @method/methodts/stdlib — Standard Library
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

// ── Phase 2: Delivery methodologies (Wave 12) ──
export { P1_EXEC } from "./methodologies/p1-exec.js";
export { P2_SD } from "./methodologies/p2-sd.js";
