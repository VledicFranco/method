// PRD-057 / S2 §3.2 / C2: strategy engine moved to @method/runtime/strategy.
// This barrel now re-exports the runtime surface for any in-tree consumer that
// still imports from the bridge strategies domain. Bridge-only items (HTTP
// routes, env-driven config loader) stay local.

// ── Re-exports from @method/runtime/strategy ────────────────────
export {
  // Artifact store
  InMemoryArtifactStore,
  createArtifactStore,
  // Gates
  evaluateGateExpression,
  evaluateGate,
  buildRetryFeedback,
  getDefaultRetries,
  getDefaultTimeout,
  // Parser
  parseStrategyYaml,
  parseStrategyObject,
  validateStrategyDAG,
  topologicalSort,
  // Executor
  StrategyExecutor,
  // Retro
  generateRetro,
  computeCriticalPath,
  retroToYaml,
  saveRetro,
} from '@method/runtime/strategy';

export type {
  ArtifactVersion,
  ArtifactBundle,
  ArtifactStore,
  GateType,
  GateConfig,
  GateContext,
  GateResult,
  StrategyYaml,
  MethodologyNodeConfig,
  ScriptNodeConfig,
  StrategyNode,
  OversightRule,
  StrategyGate,
  StrategyDAG,
  StrategyValidationResult,
  StrategyValidationResult as ValidationResult,
  NodeStatus,
  NodeResult,
  OversightEvent,
  ExecutionState,
  ExecutionStateSnapshot,
  StrategyExecutionResult,
  StrategyExecutorConfig,
  StrategyRetro,
} from '@method/runtime/strategy';

// loadExecutorConfig lives in bridge (DR-03: env access in bridge only)
export { loadExecutorConfig } from './strategy-routes.js';

// Bridge-only exports (transport — HTTP routes)
export { registerStrategyRoutes, evictStaleExecutions, setStrategyRoutesEventBus } from './strategy-routes.js';
