// SPDX-License-Identifier: Apache-2.0
/**
 * Cost telemetry event types + emit helpers.
 *
 * All cost events carry domain='cost' on the Universal Event Bus.
 * The accountId field is included for forward-compatibility with
 * multi-account routing — currently always 'default'.
 *
 * PRD-057 / S2 §8: Each emitter accepts an optional `appId` field. When
 * present (agent-runtime / Cortex case), the emitted RuntimeEvent carries
 * `payload.appId`. When absent (bridge case), behavior is bit-identical
 * to pre-PRD-057.
 */

import type { EventBus, RuntimeEventInput } from '../ports/event-bus.js';
import type { InvocationSignature, AccountId, ProviderClass } from '@methodts/types';
import type { AppId } from './rate-governor-impl.js';

const SOURCE = 'runtime/cost-governor';

export type CostEventType =
  | 'cost.observation_recorded'
  | 'cost.rate_limited'
  | 'cost.estimate_emitted'
  | 'cost.prediction_diverged'
  | 'cost.slot_leaked'
  | 'cost.integrity_violation'
  | 'cost.observations_corrupted'
  | 'cost.clock_discontinuity'
  | 'cost.account_saturated'
  | 'cost.observation_parse_error';

export function emitObservationRecorded(
  bus: EventBus,
  payload: {
    signature: InvocationSignature;
    costUsd: number;
    durationMs: number;
    accountId: AccountId;
    appId?: AppId;
    correlationId?: string;
  },
): void {
  emit(bus, 'cost.observation_recorded', 'info', payload as Record<string, unknown>, payload.correlationId);
}

export function emitRateLimited(
  bus: EventBus,
  payload: {
    accountId: AccountId;
    providerClass: ProviderClass;
    appId?: AppId;
    retryAfterMs?: number;
    correlationId?: string;
  },
): void {
  emit(bus, 'cost.rate_limited', 'warning', payload as Record<string, unknown>, payload.correlationId);
}

export function emitEstimateEmitted(
  bus: EventBus,
  payload: {
    strategyId: string;
    totalCostP50Usd: number;
    totalCostP90Usd: number;
    durationMsP50: number;
    confidence: 'low' | 'medium' | 'high';
    appId?: AppId;
    correlationId?: string;
  },
): void {
  emit(bus, 'cost.estimate_emitted', 'info', payload as Record<string, unknown>, payload.correlationId);
}

export function emitSlotLeaked(
  bus: EventBus,
  payload: { slotId: string; accountId: AccountId; ageMs: number; appId?: AppId },
): void {
  emit(bus, 'cost.slot_leaked', 'error', payload as Record<string, unknown>);
}

export function emitAccountSaturated(
  bus: EventBus,
  payload: {
    accountId: AccountId;
    providerClass: ProviderClass;
    window: 'burst' | 'weekly';
    usedPct: number;
    appId?: AppId;
  },
): void {
  emit(bus, 'cost.account_saturated', 'warning', payload as Record<string, unknown>);
}

export function emitIntegrityViolation(
  bus: EventBus,
  payload: { lineNumber: number; reason: string; appId?: AppId },
): void {
  emit(bus, 'cost.integrity_violation', 'error', payload as Record<string, unknown>);
}

export function emitObservationsCorrupted(
  bus: EventBus,
  payload: {
    renamedTo: string;
    recordsLoaded: number;
    recordsSkipped: number;
    appId?: AppId;
  },
): void {
  emit(bus, 'cost.observations_corrupted', 'error', payload as Record<string, unknown>);
}

// ── Internal emit helper ────────────────────────────────────────

function emit(
  bus: EventBus,
  type: CostEventType,
  severity: RuntimeEventInput['severity'],
  payload: Record<string, unknown>,
  correlationId?: string,
): void {
  bus.emit({
    version: 1,
    domain: 'cost',
    type,
    severity,
    payload,
    source: SOURCE,
    correlationId,
  });
}
