/**
 * Condition A: No Monitor
 *
 * MONITOR/CONTROL phases never fire. Establishes baseline token cost
 * and task success rate without any meta-level overhead.
 */

import type { CycleConfig, ThresholdPolicy } from '../../../packages/pacta/src/cognitive/engine/cycle.js';

/** Threshold policy that never triggers intervention. */
export const NO_MONITOR_THRESHOLD: ThresholdPolicy = {
  type: 'predicate',
  shouldIntervene: () => false,
};

export const NO_MONITOR_CYCLE_CONFIG: Omit<CycleConfig, 'controlPolicy'> = {
  thresholds: NO_MONITOR_THRESHOLD,
  errorPolicy: {
    default: 'skip',
    maxRetries: 1,
  },
  cycleBudget: {
    maxTokensPerCycle: 50_000,
  },
  maxConsecutiveInterventions: 0,
};

export const CONDITION_LABEL = 'no-monitor' as const;
