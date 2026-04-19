// SPDX-License-Identifier: Apache-2.0
/**
 * Structural shim for the subset of PRD-064 `ctx.storage` that
 * `CortexMethodologySource` uses.
 *
 * This shim exists so `@methodts/agent-runtime` does NOT import from
 * `@t1/cortex-sdk` — the SDK is adapted into this structural type at
 * the agent-runtime composition root (see PRD-064 §6.5).
 *
 * Gate `G-CORTEX-NO-SDK-LEAK` (architecture test) verifies that
 * `packages/runtime/src/` never imports SDK-owned symbols; this port
 * lives under `packages/agent-runtime/src/` specifically so that the
 * shared port (`MethodologySource`) stays Cortex-agnostic.
 */

/** Generic Mongo-like filter value. Accepts the minimal subset we need. */
export type StorageFilter = Readonly<Record<string, unknown>>;

/** Mongo-like update payload (e.g. `{ $set: { ... } }`). */
export type StorageUpdate = Readonly<Record<string, unknown>>;

/** Subset of PRD-064 FindOptions (§13 type view). */
export interface FindOptions {
  readonly limit?: number;
  readonly skip?: number;
  readonly sort?: Readonly<Record<string, 1 | -1>>;
  readonly projection?: StorageFilter;
}

/** Index direction enum — narrowed copy of PRD-064 SortDirection. */
export type IndexDirection = 'Asc' | 'Desc';

/** IndexSpec subset used here. */
export interface IndexSpec {
  readonly name?: string;
  readonly fields: ReadonlyArray<{ readonly name: string; readonly direction: IndexDirection }>;
  readonly unique?: boolean;
}

/** Result of `updateOne` / `updateMany`. */
export interface UpdateOutcome {
  readonly matched: number;
  readonly modified: number;
  readonly upsertedId?: string;
}

/** Result of `deleteOne` / `deleteMany`. */
export interface DeleteOutcome {
  readonly deletedCount: number;
}

/** Result of `insertOne`. */
export interface InsertOneOutcome {
  readonly insertedId: string;
}

/**
 * Mongo-like collection handle. The Cortex SDK's `CollectionProxy`
 * satisfies this structurally.
 */
export interface StorageCollection<T extends Readonly<Record<string, unknown>> = Readonly<Record<string, unknown>>> {
  findOne(filter: StorageFilter): Promise<T | null>;
  find(filter: StorageFilter, options?: FindOptions): Promise<ReadonlyArray<T>>;
  insertOne(doc: T): Promise<InsertOneOutcome>;
  updateOne(
    filter: StorageFilter,
    update: StorageUpdate,
    options?: { readonly upsert?: boolean },
  ): Promise<UpdateOutcome>;
  deleteOne(filter: StorageFilter): Promise<DeleteOutcome>;
  createIndex(spec: IndexSpec): Promise<{ readonly name: string }>;
}

/** Structural subset of PRD-064 `ctx.storage` consumed by this module. */
export interface CortexStoragePort {
  collection<T extends Readonly<Record<string, unknown>> = Readonly<Record<string, unknown>>>(
    name: string,
  ): StorageCollection<T>;
}
