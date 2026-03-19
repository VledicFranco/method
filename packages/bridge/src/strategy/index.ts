// Strategy module re-exports for backward compatibility.
// Pure logic is in @method/core; bridge-only items (transport, I/O) are local.

// Re-export everything from core's strategy barrel
export type {
  LlmRequest, LlmUsage, LlmResponse, LlmStreamEvent, LlmProvider,
  ArtifactVersion, ArtifactBundle, ArtifactStore,
  GateType, GateConfig, GateContext, GateResult,
  StrategyYaml, MethodologyNodeConfig, ScriptNodeConfig, StrategyNode, OversightRule, StrategyGate, StrategyDAG, StrategyValidationResult,
  NodeStatus, NodeResult, OversightEvent, ExecutionState, ExecutionStateSnapshot, StrategyExecutionResult, StrategyExecutorConfig,
  StrategyRetro,
} from '@method/core';

export {
  InMemoryArtifactStore, createArtifactStore,
  getDefaultRetries, getDefaultTimeout, evaluateGateExpression, evaluateGate, buildRetryFeedback,
  parseStrategyYaml, parseStrategyObject, validateStrategyDAG, topologicalSort,
  StrategyExecutor,
  generateRetro, computeCriticalPath, retroToYaml,
} from '@method/core';

// loadExecutorConfig lives in bridge (DR-03: env access in bridge only)
export { loadExecutorConfig } from './strategy-routes.js';

// Backward-compatible alias (bridge's strategy-parser.ts used this name)
export type { StrategyValidationResult as ValidationResult } from '@method/core';

// Bridge-only exports (transport and I/O)
export { ClaudeCodeProvider } from './claude-code-provider.js';
export { saveRetro } from './retro-writer.js';
export { registerStrategyRoutes, evictStaleExecutions } from './strategy-routes.js';
