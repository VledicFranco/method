// SPDX-License-Identifier: Apache-2.0
/**
 * @methodts/methodts — Typed Methodology SDK
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

// Wave 3: Gate runners + Context + EventBus + Middleware
export * from "./gate/runners/test-runner.js";
export * from "./gate/runners/http-checker.js";
export * from "./gate/runners/checklist-gate.js";
export * from "./runtime/context.js";
export * from "./runtime/insight-store.js";
export * from "./runtime/domain-facts.js";
export * from "./runtime/event-bus.js";
export * from "./runtime/hooks.js";
export * from "./runtime/middleware.js";

// Wave 4: Runtime execution engine
export * from "./runtime/run-step.js";
export * from "./runtime/run-method.js";
export * from "./runtime/run-methodology.js";
export * from "./runtime/retro.js";

// Wave 5: Strategy + Meta + ClaudeHeadless
export * from "./strategy/controller.js";
export * from "./strategy/run-strategy.js";
export * from "./strategy/prebuilt.js";
export * from "./strategy/compat.js";
export * from "./meta/compile.js";
export * from "./meta/instantiate.js";
export * from "./meta/evolve.js";
export * from "./meta/project-card.js";
export * from "./provider/claude-headless.js";

// ── Phase 2: Integration (D-093, D-098, D-099, D-100) ──

// Wave 8: Infrastructure foundation
export * from "./adapter/yaml-adapter.js";
export * from "./adapter/yaml-types.js";
export * from "./adapter/predicate-parser.js";
export * from "./extractor/services/filesystem.js";
export * from "./extractor/services/http.js";
export * from "./method/tool.js";
export * from "./gate/runners/callback-gate.js";
export * from "./domain/morphism.js";
export * from "./predicate/quantifiers.js";

// Wave 9: Providers + Bridge integration
export * from "./provider/bridge-provider.js";
export * from "./provider/spawn-claude.js";
export * from "./provider/structured-provider.js";
export * from "./runtime/bridge-hook.js";
export * from "./runtime/reconciliation.js";

// Wave 11: Advanced meta operations
export * from "./meta/compose.js";
export * from "./meta/derive.js";
export * from "./meta/promotion.js";
export * from "./meta/refinement.js";
export * from "./meta/coherence.js";

// Wave 12: Strategy expansion
export * from "./strategy/agent-steered.js";

// Wave 13: Strategy DAG unification (WS-2)
// Selective re-exports to avoid name collisions with compat.ts StrategyDAG<S>
// and runtime/retro.ts generateRetro<S>.
export type {
  DagGateType,
  DagGateConfig,
  DagGateContext,
  DagGateResult,
  MethodologyNodeConfig as DagMethodologyNodeConfig,
  ScriptNodeConfig as DagScriptNodeConfig,
  StrategyNode as DagStrategyNode,
  OversightRule as DagOversightRule,
  StrategyGateDecl,
  StrategyDAG as PipelineDAG,
  StrategyYaml as PipelineStrategyYaml,
  StrategyValidationResult as PipelineValidationResult,
  ArtifactVersion,
  ArtifactBundle,
  ArtifactStore,
  NodeStatus as DagNodeStatus,
  NodeResult as DagNodeResult,
  OversightEvent as DagOversightEvent,
  StrategyExecutionResult as DagExecutionResult,
  ExecutionStateSnapshot as DagExecutionStateSnapshot,
  StrategyExecutorConfig as DagExecutorConfig,
  StrategyRetro as DagStrategyRetro,
} from "./strategy/dag-types.js";
export {
  parseStrategyYaml,
  parseStrategyObject,
  validateStrategyDAG as validatePipelineDAG,
  topologicalSort as dagTopologicalSort,
  getDefaultRetries as dagGetDefaultRetries,
  getDefaultTimeout as dagGetDefaultTimeout,
} from "./strategy/dag-parser.js";
export {
  evaluateGateExpression as dagEvaluateGateExpression,
  evaluateGate as dagEvaluateGate,
  buildRetryFeedback as dagBuildRetryFeedback,
} from "./strategy/dag-gates.js";
export {
  InMemoryArtifactStore,
  createArtifactStore,
} from "./strategy/dag-artifact-store.js";
export {
  DagStrategyExecutor,
  type DagNodeExecutor,
} from "./strategy/dag-executor.js";
export {
  generateRetro as generateDagRetro,
  computeCriticalPath as dagComputeCriticalPath,
  retroToYaml as dagRetroToYaml,
} from "./strategy/dag-retro.js";
export type { StrategySource, StrategyInfo } from "./strategy/strategy-source.js";
export { StdlibStrategySource } from "./strategy/stdlib-strategy-source.js";

// Wave 14: TLA+ compiler
export * from "./tla/ast.js";
export * from "./tla/compile.js";

// ── SPL: Semantic Programming Language (incubating — not yet public API) ──
// Uncomment when SPL stabilizes after experiment validation.
// export * from "./semantic/index.js";
