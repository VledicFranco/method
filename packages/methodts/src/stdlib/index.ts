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

// Placeholder — populated during later work units
// export { P0_META } from "./meta/p0-meta.js";
// export { M1_MDES } from "./methods/m1-mdes.js";
// export * from "./prompts.js";
// export * from "./gates.js";
