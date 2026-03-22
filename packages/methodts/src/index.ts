/**
 * @method/methodts — Typed Methodology SDK
 *
 * Makes the formal theory (F1-FTH) executable in TypeScript.
 * See docs/prds/021-methodts.md for the full specification.
 */

// ── Phase 1a: Foundation (pure TypeScript + minimal Effect) ──

export * from "./prompt/prompt.js";
export * from "./predicate/predicate.js";
export * from "./predicate/evaluate.js";
export * from "./domain/domain-theory.js";
export * from "./domain/role.js";
export * from "./state/world-state.js";
export * from "./method/step.js";
export * from "./method/dag.js";
export * from "./method/method.js";
export * from "./method/measure.js";
export * from "./methodology/methodology.js";
export * from "./methodology/transition.js";
export * from "./methodology/safety.js";
export * from "./methodology/retraction.js";

// ── Phase 1b: Integration (Effect services + runtime) ──
// Uncomment as components are implemented:

// export * from "./gate/gate.js";
// export * from "./extractor/extractor.js";
// export * from "./commission/commission.js";
// export * from "./strategy/controller.js";
// export * from "./runtime/run-methodology.js";
// export * from "./provider/agent-provider.js";
// export * from "./meta/compile.js";
// export * from "./meta/instantiate.js";
