/**
 * PRD 017: Strategy Pipelines — Gate Framework
 *
 * Re-export from @method/methodts canonical gate evaluator. All gate evaluation,
 * expression sandboxing, and retry feedback logic lives in methodts. This file
 * preserves the runtime's import surface.
 *
 * PRD-057 / S2 §3.2 / C2: moved from @method/bridge/domains/strategies/.
 */

export type {
  DagGateType as GateType,
  DagGateConfig as GateConfig,
  DagGateContext as GateContext,
  DagGateResult as GateResult,
} from '@method/methodts/strategy/dag-types.js';

export {
  evaluateGateExpression,
  evaluateGate,
  buildRetryFeedback,
} from '@method/methodts/strategy/dag-gates.js';

export {
  getDefaultRetries,
  getDefaultTimeout,
} from '@method/methodts/strategy/dag-parser.js';
