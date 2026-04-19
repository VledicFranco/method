// SPDX-License-Identifier: Apache-2.0
/** Strategy subpath — collected type re-exports.
 *
 * PRD-057 / S2 §3.2 / C2: moved from @methodts/bridge/domains/strategies/.
 * The legacy `StrategiesConfig` type now lives in @methodts/runtime/config (C6),
 * so it is no longer re-exported from this barrel.
 */

// Artifact Store types
export type { ArtifactVersion, ArtifactBundle, ArtifactStore } from './artifact-store.js';

// Gate types
export type { GateType, GateConfig, GateContext, GateResult } from './gates.js';

// Strategy Parser types
export type {
  StrategyYaml,
  MethodologyNodeConfig,
  ScriptNodeConfig,
  StrategyNode,
  OversightRule,
  StrategyGate,
  StrategyDAG,
  StrategyValidationResult,
} from './strategy-parser.js';

// Strategy Executor types
export type {
  NodeStatus,
  NodeResult,
  OversightEvent,
  ExecutionState,
  ExecutionStateSnapshot,
  StrategyExecutionResult,
  StrategyExecutorConfig,
} from './strategy-executor.js';

// Retro Generator types
export type { StrategyRetro } from './retro-generator.js';
