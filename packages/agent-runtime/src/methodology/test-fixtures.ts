/**
 * Test fixtures: in-memory CortexStoragePort and CortexEventsPort.
 *
 * These are the harnesses the PRD-064 acceptance tests run against.
 * They are NOT exported from the package — tests import them directly
 * from the subpath.
 */

import type {
  CortexStoragePort,
  StorageCollection,
  StorageFilter,
  StorageUpdate,
  FindOptions,
  UpdateOutcome,
  DeleteOutcome,
  InsertOneOutcome,
  IndexSpec,
} from './cortex-storage-port.js';
import type {
  CortexEventsPort,
  EventEnvelope,
  MethodologyUpdatedPayload,
  EventUnsubscribe,
} from './cortex-events-port.js';

// ── Fixture storage ───────────────────────────────────────────────

interface Tracked {
  findOne: number;
  find: number;
  insertOne: number;
  updateOne: number;
  deleteOne: number;
  createIndex: number;
}

export class FixtureStoragePort implements CortexStoragePort {
  readonly data = new Map<string, Map<string, Readonly<Record<string, unknown>>>>();
  readonly indexes = new Map<string, IndexSpec[]>();
  readonly callCounts: Tracked = {
    findOne: 0,
    find: 0,
    insertOne: 0,
    updateOne: 0,
    deleteOne: 0,
    createIndex: 0,
  };

  collection<T extends Readonly<Record<string, unknown>> = Readonly<Record<string, unknown>>>(
    name: string,
  ): StorageCollection<T> {
    if (!this.data.has(name)) this.data.set(name, new Map());
    if (!this.indexes.has(name)) this.indexes.set(name, []);
    const bucket = this.data.get(name)!;
    const indexes = this.indexes.get(name)!;
    const track = this.callCounts;

    const matches = (doc: Record<string, unknown>, filter: StorageFilter): boolean => {
      for (const [k, v] of Object.entries(filter)) {
        if (doc[k] !== v) return false;
      }
      return true;
    };

    return {
      async findOne(filter: StorageFilter): Promise<T | null> {
        track.findOne += 1;
        for (const doc of bucket.values()) {
          if (matches(doc as Record<string, unknown>, filter)) return doc as T;
        }
        return null;
      },
      async find(filter: StorageFilter, options?: FindOptions): Promise<ReadonlyArray<T>> {
        track.find += 1;
        let results: T[] = [];
        for (const doc of bucket.values()) {
          if (matches(doc as Record<string, unknown>, filter)) results.push(doc as T);
        }
        if (options?.skip) results = results.slice(options.skip);
        if (options?.limit != null) results = results.slice(0, options.limit);
        return results;
      },
      async insertOne(doc: T): Promise<InsertOneOutcome> {
        track.insertOne += 1;
        const id = String(((doc as Record<string, unknown>)['_id'] as string) ?? crypto.randomUUID());
        bucket.set(id, { ...doc, _id: id });
        return { insertedId: id };
      },
      async updateOne(
        filter: StorageFilter,
        update: StorageUpdate,
        options?: { readonly upsert?: boolean },
      ): Promise<UpdateOutcome> {
        track.updateOne += 1;
        const setPayload = ((update as Record<string, unknown>)['$set'] ??
          update) as Record<string, unknown>;
        let matched = 0;
        let modified = 0;
        let upsertedId: string | undefined;
        for (const [key, doc] of bucket) {
          if (matches(doc as Record<string, unknown>, filter)) {
            matched += 1;
            bucket.set(key, { ...doc, ...setPayload });
            modified += 1;
          }
        }
        if (matched === 0 && options?.upsert) {
          const id = String(
            ((filter as Record<string, unknown>)['_id'] as string) ??
              (setPayload['_id'] as string) ??
              crypto.randomUUID(),
          );
          bucket.set(id, { ...setPayload, _id: id });
          upsertedId = id;
        }
        return upsertedId !== undefined
          ? { matched, modified, upsertedId }
          : { matched, modified };
      },
      async deleteOne(filter: StorageFilter): Promise<DeleteOutcome> {
        track.deleteOne += 1;
        for (const [key, doc] of bucket) {
          if (matches(doc as Record<string, unknown>, filter)) {
            bucket.delete(key);
            return { deletedCount: 1 };
          }
        }
        return { deletedCount: 0 };
      },
      async createIndex(spec: IndexSpec): Promise<{ readonly name: string }> {
        track.createIndex += 1;
        indexes.push(spec);
        return { name: spec.name ?? `idx_${indexes.length}` };
      },
    };
  }
}

// ── Fixture events ────────────────────────────────────────────────

/**
 * In-memory event bus that fans one emit() out to every subscribed
 * handler. Handy for wiring two `CortexMethodologySource` instances
 * (replicas) to the same bus in tests.
 */
export class FixtureEventBus {
  private readonly handlers = new Map<
    'methodology.updated',
    Set<(env: EventEnvelope<MethodologyUpdatedPayload>) => Promise<void> | void>
  >([['methodology.updated', new Set()]]);
  readonly emitted: Array<EventEnvelope<MethodologyUpdatedPayload>> = [];
  nextEventId = 1;

  port(emitterAppId: string, emitterActor = 'test'): CortexEventsPort {
    const bus = this;
    return {
      on(
        type: 'methodology.updated',
        handler: (env: EventEnvelope<MethodologyUpdatedPayload>) => Promise<void> | void,
      ): EventUnsubscribe {
        bus.handlers.get(type)!.add(handler);
        return () => {
          bus.handlers.get(type)!.delete(handler);
        };
      },
      async emit(
        type: 'methodology.updated',
        payload: MethodologyUpdatedPayload,
      ): Promise<void> {
        const envelope: EventEnvelope<MethodologyUpdatedPayload> = {
          eventId: `evt-${bus.nextEventId++}`,
          eventType: type,
          emitterAppId,
          emittedAt: new Date().toISOString(),
          emittedBy: emitterActor,
          payload,
          schemaVersion: 1,
        };
        bus.emitted.push(envelope);
        const handlers = [...bus.handlers.get(type)!];
        for (const h of handlers) {
          await h(envelope);
        }
      },
    };
  }
}

// ── Valid methodology YAML fixtures ──────────────────────────────

export const VALID_P_CUSTOM_YAML = `
methodology:
  id: P-CUSTOM
  name: Custom app methodology
  description: Per-app override of P2-SD
  version: "1.0.0"
domain_theory:
  id: custom-domain
  sorts:
    - name: Task
      cardinality: unbounded
  function_symbols: []
  predicates: []
  axioms: []
transition_function:
  arms:
    - priority: 1
      label: termination
      condition: "true"
      returns: "None"
      rationale: "Always terminate"
`;

/** YAML that fails to parse (malformed indentation). */
export const BROKEN_YAML = `
methodology:
  id: BROKEN
   name: : : :
  description
`;

/** YAML that parses but fails G3 (no arms). */
export const G3_FAIL_YAML = `
methodology:
  id: P-NOARMS
  name: No arms
  description: Fails G3
  version: "1.0.0"
transition_function:
  arms: []
`;
