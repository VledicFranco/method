// SPDX-License-Identifier: Apache-2.0
/**
 * cognitive/slm — barrel export. PRD 057 SLM cascade infrastructure.
 *
 *   CascadeProvider — N-tier confidence-gated AgentProvider
 *   confidenceAbove — TierAcceptFn factory keyed on result.confidence
 *   SLMAsAgentProvider — adapts an SLMInferer into an AgentProvider
 *   HttpBridgeSLMRuntime — SLMInferer that calls a remote serve-slm.py
 *
 * Spillover (deferred to Wave 4) and routing (deferred to Wave 3) ship
 * in subsequent commits.
 *
 * @see docs/prds/057-slm-cascade-infrastructure.md
 */

export { CascadeProvider, confidenceAbove } from './cascade.js';
export type { CascadeTier, TierAcceptFn } from './cascade.js';

export { SLMAsAgentProvider } from './slm-as-agent-provider.js';
export type { SLMAsAgentProviderOptions } from './slm-as-agent-provider.js';

export { HttpBridgeSLMRuntime } from './http-bridge.js';
export type { HttpBridgeSLMRuntimeOptions } from './http-bridge.js';

export type {
  SLMInferenceResult,
  SLMInferOptions,
  SLMMetrics,
  CascadeMetrics,
  CascadeTierMetrics,
  HealthState,
  HealthProbe,
  RoutingMetrics,
  SpilloverMetrics,
} from './types.js';

export {
  SLMError,
  SLMNotAvailable,
  SLMLoadError,
  SLMInferenceError,
} from './errors.js';
