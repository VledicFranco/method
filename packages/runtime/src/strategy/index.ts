/**
 * @method/runtime/strategy — strategy executor + adapters (PRD-057 / S2 §3.2).
 *
 * Public surface frozen by S2 §3.2. Both consumers (@method/bridge and the
 * forthcoming @method/agent-runtime) depend on this subpath.
 */

// ── StrategyExecutor + types ────────────────────────────────────
export { StrategyExecutor } from './strategy-executor.js';
export type {
  NodeStatus,
  NodeResult,
  OversightEvent,
  ExecutionStateSnapshot,
  ExecutionState,
  StrategyExecutionResult,
  StrategyExecutorConfig,
  SubStrategySource,
  HumanApprovalResolver,
  ContextLoadExecutor,
  SemanticNodeExecutor,
} from './strategy-executor.js';

// ── Reusable adapter implementations (opt-in — consumers may roll their own) ──
export { FsSubStrategySource } from './sub-strategy-source.js';
export { EventBusHumanApprovalResolver } from './human-approval-resolver.js';
export { ContextLoadExecutorImpl } from './context-load-executor.js';

// ── Retro machinery ─────────────────────────────────────────────
export { saveRetro, setRetroWriterFs } from './retro-writer.js';
export {
  generateRetro,
  computeCriticalPath,
  retroToYaml,
  setRetroGeneratorYaml,
} from './retro-generator.js';
export type { StrategyRetro } from './retro-generator.js';

// ── Strategy DAG parser (pass-through; actual parser lives in methodts) ──────
export {
  parseStrategyYaml,
  parseStrategyObject,
  validateStrategyDAG,
  topologicalSort,
  setStrategyParserYaml,
} from './strategy-parser.js';
export type {
  StrategyYaml,
  MethodologyNodeConfig,
  ScriptNodeConfig,
  StrategyNode,
  OversightRule,
  StrategyGate,
  StrategyDAG,
  StrategyValidationResult,
  StrategyNodeConfig,
  SubStrategyResult,
  HumanApprovalContext,
  HumanApprovalDecision,
} from './strategy-parser.js';

// ── Gates ───────────────────────────────────────────────────────
export {
  evaluateGateExpression,
  evaluateGate,
  buildRetryFeedback,
  getDefaultRetries,
  getDefaultTimeout,
} from './gates.js';
export type { GateType, GateConfig, GateContext, GateResult } from './gates.js';

// ── Artifact Store ──────────────────────────────────────────────
export { InMemoryArtifactStore, createArtifactStore } from './artifact-store.js';
export type { ArtifactVersion, ArtifactBundle, ArtifactStore } from './artifact-store.js';

// ── Pacta strategy helpers ──────────────────────────────────────
export {
  buildPactFromStrategyConfig,
  resolveStepPact,
  validatePactPipeline,
} from './pacta-strategy.js';
export type { PactStrategyConfig, PactStrategyPipeline } from './pacta-strategy.js';
