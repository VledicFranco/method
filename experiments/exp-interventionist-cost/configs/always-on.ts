/**
 * Condition B: Always-On Monitor
 *
 * MONITOR/CONTROL phases fire every cycle unconditionally.
 * Establishes maximum monitoring cost and error detection ceiling.
 */

import type { CycleConfig, ThresholdPolicy } from '../../../packages/pacta/src/cognitive/engine/cycle.js';

/** Threshold policy that always triggers intervention. */
export const ALWAYS_ON_THRESHOLD: ThresholdPolicy = {
  type: 'predicate',
  shouldIntervene: () => true,
};

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
