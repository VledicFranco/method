/**
 * Condition B: Always-On Monitor (EVC policy, costWeight=0)
 *
 * Uses EVC threshold policy with costWeight=0 and minPredictionError=0,
 * which means the cost term is always zero and any non-zero prediction error
 * triggers intervention. This effectively fires MONITOR/CONTROL every cycle,
 * establishing maximum monitoring cost and error detection ceiling.
 *
 * Migrated from: manual `shouldIntervene: () => true` predicate
 * Migrated to:   evcThresholdPolicy with zero cost barrier
 */

import type { CycleConfig } from '../../../packages/pacta/src/cognitive/engine/cycle.js';
import { evcThresholdPolicy } from '../../../packages/pacta/src/cognitive/engine/evc-policy.js';

/**
 * EVC threshold policy that always triggers intervention.
 *
 * costWeight=0 means the cost term is always 0.
 * minPredictionError=0 means any non-zero PE triggers.
 * bias=1.0 ensures intervention even when PE is exactly 0
 * (covers the edge case where no signals carry PE data).
 */
export const ALWAYS_ON_THRESHOLD = evcThresholdPolicy({
  costWeight: 0,
  minPredictionError: 0,
  bias: 1.0,
});

export const ALWAYS_ON_CYCLE_CONFIG: Omit<CycleConfig, 'controlPolicy'> = {
  thresholds: ALWAYS_ON_THRESHOLD,
  errorPolicy: {
    default: 'skip',
    maxRetries: 1,
  },
  cycleBudget: {
    maxTokensPerCycle: 50_000,
  },
  // Allow more consecutive interventions since every cycle intervenes
  maxConsecutiveInterventions: 15,
};

export const CONDITION_LABEL = 'always-on' as const;
