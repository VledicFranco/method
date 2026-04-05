/**
 * Cost Governor domain (PRD 051).
 *
 * Wires ObservationsStore, CostOracle, and SingleAccountRateGovernor
 * into a single domain exposing ports for strategy integration and
 * REST endpoints for admin access.
 */

import type { FastifyInstance } from 'fastify';
import type { EventBus } from '../../ports/event-bus.js';
import type { FileSystemProvider } from '../../ports/file-system.js';
import { createAppendToken } from '../../ports/historical-observations.js';
import type { AppendToken } from '../../ports/historical-observations.js';
import type { CostGovernorConfig } from './config.js';
import { CostGovernorConfigSchema } from './config.js';
import { ObservationsStore, type DiagnosticEvent } from './observations-store.js';
import { HistogramCostOracle } from './cost-oracle-impl.js';
import { SingleAccountRateGovernor } from './rate-governor-impl.js';
import { registerCostGovernorRoutes } from './routes.js';
import {
  emitObservationRecorded,
  emitIntegrityViolation,
  emitObservationsCorrupted,
  emitSlotLeaked,
} from './cost-events.js';
import type { AccountId, ProviderClass } from '@method/types';

// Re-exports
export { CostGovernorConfigSchema, loadCostGovernorConfig } from './config.js';
export type { CostGovernorConfig } from './config.js';
export { buildSignature, signatureKey, inputSizeBucket } from './signature-builder.js';
export { ObservationsStore } from './observations-store.js';
export { HistogramCostOracle } from './cost-oracle-impl.js';
export { SingleAccountRateGovernor } from './rate-governor-impl.js';
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

// ── Domain Factory ──────────────────────────────────────────────

export interface CreateCostGovernorDomainOptions {
  eventBus: EventBus;
  fileSystem: FileSystemProvider;
  config?: Partial<CostGovernorConfig>;
}

export interface CostGovernorDomain {
  registerRoutes: (app: FastifyInstance) => void;
  readonly oracle: HistogramCostOracle;
  readonly rateGovernor: SingleAccountRateGovernor;
  readonly observations: ObservationsStore;
  /** Capability token for appending observations (composition-root only). */
  readonly appendToken: AppendToken;
  /** Run one pass of the leak-detection watchdog. */
  sweepLeakedSlots(): number;
}

export function createCostGovernorDomain(
  options: CreateCostGovernorDomainOptions,
): CostGovernorDomain {
  const config = CostGovernorConfigSchema.parse(options.config ?? {});

  // Diagnostic callback → event bus
  const diagnostic = (event: DiagnosticEvent) => {
    if (event.type === 'cost.integrity_violation') {
      emitIntegrityViolation(options.eventBus, event.payload as { lineNumber: number; reason: string });
    } else if (event.type === 'cost.observations_corrupted') {
      emitObservationsCorrupted(options.eventBus, event.payload as {
        renamedTo: string;
        recordsLoaded: number;
        recordsSkipped: number;
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
      });
    },
  );

  const oracle = new HistogramCostOracle(observations);

  return {
    oracle,
    rateGovernor,
    observations,
    appendToken,
    registerRoutes(app: FastifyInstance) {
      registerCostGovernorRoutes(app, { oracle, rateGovernor, observations });
    },
    sweepLeakedSlots(): number {
      return rateGovernor.sweep((slot) => {
        emitSlotLeaked(options.eventBus, {
          slotId: String(slot.slotId),
          accountId: slot.accountId as AccountId,
          ageMs: Date.now() - slot.acquiredAt,
        });
      });
    },
  };
}

// Silence unused warnings for providerClass type
void null as unknown as ProviderClass;
