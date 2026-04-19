// SPDX-License-Identifier: Apache-2.0
/**
 * `@methodts/agent-runtime/methodology` — CortexMethodologySource public surface
 * (PRD-064 / S7).
 */

export {
  CortexMethodologySource,
  CortexMethodologyError,
  METHODOLOGIES_COLLECTION,
  METHODOLOGY_POLICY_COLLECTION,
  POLICY_SINGLETON_ID,
  METHODOLOGY_SIZE_CAP_BYTES,
} from './cortex-methodology-source.js';
export type {
  CortexMethodologySourceDeps,
  CacheEntry,
} from './cortex-methodology-source.js';

export type {
  MethodologyDocument,
  MethodologyDocumentInput,
  MethodologyDocumentSummary,
  MethodologyPolicy,
  MethodologyInheritance,
  MethodologyMetadata,
  CompilationReport,
  CompilationGateResult,
  CortexMethodologyErrorCode,
} from './types.js';

export type {
  CortexStoragePort,
  StorageCollection,
  StorageFilter,
  StorageUpdate,
  FindOptions,
  IndexSpec,
  IndexDirection,
  UpdateOutcome,
  DeleteOutcome,
  InsertOneOutcome,
} from './cortex-storage-port.js';

export type {
  CortexEventsPort,
  EventEnvelope,
  MethodologyUpdatedPayload,
  EventUnsubscribe,
} from './cortex-events-port.js';
