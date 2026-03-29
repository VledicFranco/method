/**
 * Condition C: Default-Interventionist Monitor (EVC policy, default config)
 *
 * Uses EVC threshold policy with default parameters. The EVC equation
 * balances expected payoff (prediction error magnitude) against expected
 * cost (budget consumption), intervening only when the expected value
 * of control is positive.
 *
 * This is the architecture's designed operating mode (RFC 001 Section IV),
 * now formalized through the Shenhav, Botvinick & Cohen (2013) EVC framework.
 *
 * Migrated from: manual confidence/unexpectedResult/conflict predicate
 * Migrated to:   evcThresholdPolicy with defaults (payoffWeight=1, costWeight=1,
 *                minPredictionError=0.1, bias=0)
 */

import type { CycleConfig } from '../../../packages/pacta/src/cognitive/engine/cycle.js';
import { evcThresholdPolicy } from '../../../packages/pacta/src/cognitive/engine/evc-policy.js';

/**
 * EVC threshold policy — the designed operating mode.
 *
 * Default config balances payoff vs cost:
 * - payoffWeight=1.0: prediction error fully weighted
 * - costWeight=1.0: budget consumption fully weighted
 * - minPredictionError=0.1: below this, never intervene (routine cycle)
 * - bias=0.0: neutral — no inherent preference for or against intervention
 */
export const INTERVENTIONIST_THRESHOLD = evcThresholdPolicy();

export const INTERVENTIONIST_CYCLE_CONFIG: Omit<CycleConfig, 'controlPolicy'> = {
  thresholds: INTERVENTIONIST_THRESHOLD,
  errorPolicy: {
    default: 'skip',
    maxRetries: 1,
  },
  cycleBudget: {
    maxTokensPerCycle: 50_000,
  },
  maxConsecutiveInterventions: 3,
};

export const CONDITION_LABEL = 'interventionist' as const;
