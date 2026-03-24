/**
 * PRD 017: Strategy Pipelines — Gate Framework (Phase 1b)
 *
 * WS-2: Now a thin re-export from @method/methodts canonical gate evaluator.
 * All gate evaluation, expression sandboxing, and retry feedback logic lives
 * in methodts. This file preserves the bridge's import surface for backward
 * compatibility.
 */

// Re-export types from methodts (preserving bridge's type surface)
export type {
  DagGateType as GateType,
  DagGateConfig as GateConfig,
  DagGateContext as GateContext,
  DagGateResult as GateResult,
} from '@method/methodts/strategy/dag-types.js';

// Re-export functions from methodts
export {
  evaluateGateExpression,
  evaluateGate,
  buildRetryFeedback,
} from '@method/methodts/strategy/dag-gates.js';

export {
  getDefaultRetries,
  getDefaultTimeout,
} from '@method/methodts/strategy/dag-parser.js';
