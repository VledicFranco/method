// Strategy module barrel exports (PRD 017)
// Pure logic lives locally (formerly in @method/core); bridge-only items (transport, I/O) are also here.

// Artifact Store
export type { ArtifactVersion, ArtifactBundle, ArtifactStore } from './artifact-store.js';
export { InMemoryArtifactStore, createArtifactStore } from './artifact-store.js';

// Gates
export type { GateType, GateConfig, GateContext, GateResult } from './gates.js';
export { getDefaultRetries, getDefaultTimeout, evaluateGateExpression, evaluateGate, buildRetryFeedback } from './gates.js';

// Strategy Parser
export type { StrategyYaml, MethodologyNodeConfig, ScriptNodeConfig, StrategyNode, OversightRule, StrategyGate, StrategyDAG, StrategyValidationResult } from './strategy-parser.js';
export { parseStrategyYaml, parseStrategyObject, validateStrategyDAG, topologicalSort } from './strategy-parser.js';

// Backward-compatible alias
export type { StrategyValidationResult as ValidationResult } from './strategy-parser.js';

// Strategy Executor
export type { NodeStatus, NodeResult, OversightEvent, ExecutionState, ExecutionStateSnapshot, StrategyExecutionResult, StrategyExecutorConfig } from './strategy-executor.js';
export { StrategyExecutor } from './strategy-executor.js';

// Retro Generator (pure logic)
export type { StrategyRetro } from './retro-generator.js';
export { generateRetro, computeCriticalPath, retroToYaml } from './retro-generator.js';

// loadExecutorConfig lives in bridge (DR-03: env access in bridge only)
export { loadExecutorConfig } from './strategy-routes.js';

// Bridge-only exports (transport and I/O)
export { saveRetro } from './retro-writer.js';
export { registerStrategyRoutes, evictStaleExecutions, setStrategyRoutesEventBus } from './strategy-routes.js';
