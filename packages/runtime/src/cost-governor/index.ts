/**
 * @method/runtime/cost-governor — transport-free cost governor factory.
 *
 * PRD-057 / S2 §3.5, §8 / C4: moved from @method/bridge/domains/cost-governor.
 *
 * Key differences from the prior bridge factory:
 *
 *  1. **No Fastify coupling** (S2 Q5). `createCostGovernor` returns
 *     primitives only — `oracle`, `rateGovernor`, `observations`,
 *     `appendToken`, `sweepLeakedSlots`. Bridge keeps a thin
 *     `domains/cost-governor/routes.ts` that imports these primitives and
 *     wires Fastify.
 *  2. **Optional per-`appId` scoping** (S2 §8). When `options.appId` is
 *     supplied (agent-runtime / Cortex case), rate-governor slots and
 *     emitted events are scoped by `{accountId, appId}`. When absent
 *     (bridge case), behavior is bit-identical to pre-PRD-057
 *     `createCostGovernorDomain`.
 *  3. **Renamed factory**. `createCostGovernorDomain` → `createCostGovernor`.
 *     Old name is NOT aliased here — bridge callers migrate through the
 *     composition root (server-entry.ts) + the bridge-side routes module.
 */

import type { EventBus } from '../ports/event-bus.js';
import type { FileSystemProvider } from '../ports/file-system.js';
import { createAppendToken } from '../ports/historical-observations.js';
import type { AppendToken } from '../ports/historical-observations.js';
import type { CostGovernorConfig } from '../config/cost-governor-config.js';
import { CostGovernorConfigSchema } from '../config/cost-governor-config.js';
import { ObservationsStore, type DiagnosticEvent } from './observations-store.js';
import { HistogramCostOracle } from './cost-oracle-impl.js';
import { SingleAccountRateGovernor, type AppId } from './rate-governor-impl.js';
import {
  emitObservationRecorded,
  emitIntegrityViolation,
  emitObservationsCorrupted,
  emitSlotLeaked,
} from './cost-events.js';
import type { AccountId, ProviderClass } from '@method/types';

// ── Re-exports (S2 §3.5) ────────────────────────────────────────

export { CostGovernorConfigSchema, loadCostGovernorConfig } from '../config/cost-governor-config.js';
export type { CostGovernorConfig } from '../config/cost-governor-config.js';
export { buildSignature, signatureKey, inputSizeBucket } from './signature-builder.js';
export { ObservationsStore } from './observations-store.js';
export { HistogramCostOracle } from './cost-oracle-impl.js';
export { SingleAccountRateGovernor } from './rate-governor-impl.js';
export type { AppId } from './rate-governor-impl.js';
export { TokenBucket } from './token-bucket.js';
export { BackpressureQueue } from './backpressure-queue.js';
export { estimateStrategy, heuristicEstimate } from './estimator.js';
export {
  emitObservationRecorded,
  emitRateLimited,
  emitEstimateEmitted,
  emitSlotLeaked,
  emitAccountSaturated,
  emitIntegrityViolation,
  emitObservationsCorrupted,
} from './cost-events.js';
export type { CostEventType } from './cost-events.js';

// ── Re-export ports for convenience (S2 §3.5) ───────────────────

export type { CostOracle } from '../ports/cost-oracle.js';
export type { RuntimeRateGovernor } from '../ports/rate-governor.js';
export type { HistoricalObservations } from '../ports/historical-observations.js';

// ── Factory ─────────────────────────────────────────────────────

export interface CreateCostGovernorOptions {
  eventBus: EventBus;
  fileSystem: FileSystemProvider;
  config?: Partial<CostGovernorConfig>;
  /**
   * Optional per-tenant application identifier (PRD-057 / S2 §8).
   *
   * - Absent → bridge's legacy behavior, slots keyed by `accountId`.
   * - Present → agent-runtime / Cortex path: slots keyed by
   *   `${accountId}:${appId}`, emitted events carry `payload.appId`.
   */
  appId?: AppId;
}

/**
 * Primitives returned by `createCostGovernor`. Unlike the prior bridge
 * factory, this record does NOT contain `registerRoutes` — routes are a
 * transport concern that stays in `@method/bridge` per S2 §5.1. Bridge
 * imports these primitives and mounts them via its own Fastify wrapper.
 */
export interface CostGovernor {
  readonly oracle: HistogramCostOracle;
  readonly rateGovernor: SingleAccountRateGovernor;
  readonly observations: ObservationsStore;
  /** Capability token for appending observations (composition-root only). */
  readonly appendToken: AppendToken;
  /** Run one pass of the leak-detection watchdog. */
  sweepLeakedSlots(): number;
  /** Expose the scoped `appId` (undefined = no scoping). */
  readonly appId: AppId | undefined;
}

export function createCostGovernor(
  options: CreateCostGovernorOptions,
): CostGovernor {
  const config = CostGovernorConfigSchema.parse(options.config ?? {});
  const { appId } = options;

  // Diagnostic callback → event bus
  const diagnostic = (event: DiagnosticEvent) => {
    if (event.type === 'cost.integrity_violation') {
      emitIntegrityViolation(options.eventBus, {
        ...(event.payload as { lineNumber: number; reason: string }),
        ...(appId !== undefined ? { appId } : {}),
      });
    } else if (event.type === 'cost.observations_corrupted') {
      emitObservationsCorrupted(options.eventBus, {
        ...(event.payload as {
          renamedTo: string;
          recordsLoaded: number;
          recordsSkipped: number;
        }),
        ...(appId !== undefined ? { appId } : {}),
      });
    }
  };

  const observations = new ObservationsStore(
    {
      dataDir: config.dataDir,
      hmacSecret: config.hmacSecret,
      maxPerSignature: config.maxObservationsPerSignature,
    },
    options.fileSystem,
    diagnostic,
  );

  // Load history from disk
  observations.recover();

  const appendToken = createAppendToken();

  // Rate governor + observation callback
  const rateGovernor = new SingleAccountRateGovernor(
    {
      burstCapacity: config.burstCapacity,
      weeklyCap: config.weeklyCap,
      concurrentCap: config.concurrentCap,
      queueWaitTimeoutMs: config.slotTimeoutMs,
    },
    (outcome, record) => {
      // Only persist successful observations (others would skew estimates)
      if (outcome.outcome !== 'success') return;
      if (!record.signature) return;

      const accountId = record.slot.accountId;
      const providerClass = record.slot.providerClass;

      observations.append(
        {
          signature: record.signature,
          costUsd: outcome.actualCostUsd,
          durationMs: outcome.actualDurationMs,
          tokensIn: 0,
          tokensOut: 0,
          tokensCacheRead: 0,
          tokensCacheWrite: 0,
          recordedAt: Date.now(),
          accountId,
          providerClass,
        },
        appendToken,
      );

      emitObservationRecorded(options.eventBus, {
        signature: record.signature,
        costUsd: outcome.actualCostUsd,
        durationMs: outcome.actualDurationMs,
        accountId,
        ...(appId !== undefined ? { appId } : {}),
      });
    },
    { appId },
  );

  const oracle = new HistogramCostOracle(observations);

  return {
    oracle,
    rateGovernor,
    observations,
    appendToken,
    appId,
    sweepLeakedSlots(): number {
      return rateGovernor.sweep((slot) => {
        emitSlotLeaked(options.eventBus, {
          slotId: String(slot.slotId),
          accountId: slot.accountId as AccountId,
          ageMs: Date.now() - slot.acquiredAt,
          ...(appId !== undefined ? { appId } : {}),
        });
      });
    },
  };
}

// Silence unused-import warning for ProviderClass — retained for future use.
void null as unknown as ProviderClass;
