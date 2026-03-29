/**
 * Condition C: Default-Interventionist Monitor
 *
 * MONITOR/CONTROL phases fire only when monitoring signals cross thresholds.
 * This is the architecture's designed operating mode (RFC 001 Section IV).
 *
 * Trigger conditions (matching production cycle.ts shouldIntervene logic):
 * - Reasoner confidence < 0.3
 * - Actor reports unexpected result
 * - Conflict detected in reasoning
 */

import type { CycleConfig, ThresholdPolicy } from '../../../packages/pacta/src/cognitive/engine/cycle.js';
import type { AggregatedSignals, MonitoringSignal } from '../../../packages/pacta/src/cognitive/algebra/index.js';

/** Production threshold policy — fires on anomaly signals. */
export const INTERVENTIONIST_THRESHOLD: ThresholdPolicy = {
  type: 'predicate',
  shouldIntervene: (signals: AggregatedSignals): boolean => {
    for (const [, signal] of signals) {
      // Check reasoner signals
      if (isReasonerLike(signal)) {
        if (signal.confidence < 0.3) return true;
        if ('conflictDetected' in signal && signal.conflictDetected) return true;
      }
      // Check actor signals
      if (isActorLike(signal)) {
        if (signal.unexpectedResult) return true;
      }
    }
    return false;
  },
};

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

// ── Type Guards ────────────────────────────────────────────────────

interface ReasonerLike {
  confidence: number;
  conflictDetected?: boolean;
}

interface ActorLike {
  unexpectedResult: boolean;
}

function isReasonerLike(signal: MonitoringSignal): signal is MonitoringSignal & ReasonerLike {
  return 'confidence' in signal && typeof (signal as Record<string, unknown>).confidence === 'number';
}

function isActorLike(signal: MonitoringSignal): signal is MonitoringSignal & ActorLike {
  return 'unexpectedResult' in signal && typeof (signal as Record<string, unknown>).unexpectedResult === 'boolean';
}
