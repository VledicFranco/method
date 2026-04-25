// SPDX-License-Identifier: Apache-2.0
/**
 * cognitive/slm — barrel export. PRD 057 SLM cascade infrastructure.
 *
 *   CascadeProvider — N-tier confidence-gated AgentProvider
 *   confidenceAbove — TierAcceptFn factory keyed on result.confidence
 *   SLMAsAgentProvider — adapts an SLMInferer into an AgentProvider
 *   HttpBridgeSLMRuntime — SLMInferer that calls a remote serve-slm.py
 *   RoutingProvider — pre-call dispatch via TierRouter (Wave 3)
 *   FeatureTierRouter — rule-based TierRouter (Wave 3)
 *   SpilloverSLMRuntime — primary + fallback SLM with health probing (Wave 4)
 *
 * @see docs/prds/057-slm-cascade-infrastructure.md
 */

export { CascadeProvider, confidenceAbove } from './cascade.js';
export type { CascadeTier, TierAcceptFn } from './cascade.js';

export { SLMAsAgentProvider } from './slm-as-agent-provider.js';
export type { SLMAsAgentProviderOptions } from './slm-as-agent-provider.js';

export { HttpBridgeSLMRuntime } from './http-bridge.js';
export type { HttpBridgeSLMRuntimeOptions } from './http-bridge.js';

export { RoutingProvider } from './routing-provider.js';
export type { RoutingProviderConfig } from './routing-provider.js';

export {
  FeatureTierRouter,
  keywordMatch,
  lengthAbove,
} from './feature-tier-router.js';
export type {
  FeatureRule,
  FeatureTierRouterConfig,
} from './feature-tier-router.js';

export { SpilloverSLMRuntime } from './spillover.js';
export type { SpilloverConfig } from './spillover.js';

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
