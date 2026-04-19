// SPDX-License-Identifier: Apache-2.0
/**
 * PRD 017: Strategy Pipelines — Gate Framework
 *
 * Re-export from @methodts/methodts canonical gate evaluator. All gate evaluation,
 * expression sandboxing, and retry feedback logic lives in methodts. This file
 * preserves the runtime's import surface.
 *
 * PRD-057 / S2 §3.2 / C2: moved from @methodts/bridge/domains/strategies/.
 */

export type {
  DagGateType as GateType,
  DagGateConfig as GateConfig,
  DagGateContext as GateContext,
  DagGateResult as GateResult,
} from '@methodts/methodts/strategy/dag-types.js';

export {
  evaluateGateExpression,
  evaluateGate,
  buildRetryFeedback,
} from '@methodts/methodts/strategy/dag-gates.js';

export {
  getDefaultRetries,
  getDefaultTimeout,
} from '@methodts/methodts/strategy/dag-parser.js';
