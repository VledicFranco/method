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

// Wave 2: Foundation types + leaf modules
export * from "./gate/gate.js";
export * from "./gate/runners/script-gate.js";
export { type Extractor } from "./extractor/extractor.js";
export { type ExtractionError as ExtractorError } from "./extractor/extractor.js";
export * from "./extractor/services/command.js";
export * from "./extractor/services/git.js";
export * from "./commission/commission.js";
export * from "./commission/templates.js";
export * from "./provider/agent-provider.js";
export * from "./provider/mock-provider.js";
export * from "./runtime/errors.js";
export * from "./runtime/events.js";
export * from "./runtime/suspension.js";
export * from "./runtime/accumulator.js";
export * from "./runtime/config.js";

// Wave 3+: Uncomment as components are implemented:
// export * from "./strategy/controller.js";
// export * from "./runtime/run-methodology.js";
// export * from "./meta/compile.js";
// export * from "./meta/instantiate.js";
