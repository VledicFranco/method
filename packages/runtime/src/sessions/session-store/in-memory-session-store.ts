// SPDX-License-Identifier: Apache-2.0
/**
 * In-memory reference `SessionStore` — PRD-061 test support.
 *
 * Lives inside `@methodts/runtime` so both the conformance testkit and
 * adapter unit tests can use it without pulling a full FS or Mongo
 * dependency. Implements the full S4 surface including lease semantics.
 *
 * NOT intended for production. Durable adapters live in `@methodts/bridge`
 * (FS) and `@methodts/agent-runtime` (Cortex ctx.storage).
 */

import type { SessionStore } from '../../ports/session-store.js';
import type {
  Checkpoint,
  CheckpointMeta,
  ResumeContext,
  ResumeOptions,
  SessionSnapshot,
  SessionStatus,
} from '../../ports/session-store-types.js';
import { SessionStoreError } from '../../ports/session-store-errors.js';

interface LeaseState {
  workerId: string;
  fencingToken: string;
  acquiredAt: string;
  expiresAt: string;
}

interface Entry {
  snapshot: SessionSnapshot;
  checkpoints: Checkpoint[];
  lease: LeaseState | null;
}

export interface InMemorySessionStoreOptions {
  readonly defaultLeaseTtlMs?: number;
  readonly checkpointRingSize?: number;
  /**
   * Clock override for deterministic tests. Returns current time in ms.
   */
  readonly now?: () => number;
  /** Fencing-token generator (tests inject a deterministic one). */
  readonly newFencingToken?: () => string;
}

const DEFAULT_TTL_MS = 30_000;
const DEFAULT_RING = 10;

function isoFrom(ms: number): string {
  return new Date(ms).toISOString();
}

let _counter = 0;
function defaultFencingToken(): string {
  _counter += 1;
  return `ft_${Date.now().toString(36)}_${_counter.toString(36)}`;
}

export function createInMemorySessionStore(
  opts: InMemorySessionStoreOptions = {},
): SessionStore {
  const entries = new Map<string, Entry>();
  const now = opts.now ?? ((): number => Date.now());
  const ring = opts.checkpointRingSize ?? DEFAULT_RING;
  const defaultTtl = opts.defaultLeaseTtlMs ?? DEFAULT_TTL_MS;
  const newToken = opts.newFencingToken ?? defaultFencingToken;

  function requireEntry(sessionId: string): Entry {
    const entry = entries.get(sessionId);
    if (!entry) {
      throw new SessionStoreError('NOT_FOUND', `No session ${sessionId}`, { sessionId });
    }
    return entry;
  }

  function assertSchema(snapshot: SessionSnapshot): void {
    if (snapshot.schemaVersion !== 1) {
      throw new SessionStoreError(
        'SCHEMA_INCOMPATIBLE',
        `Snapshot schemaVersion=${String(snapshot.schemaVersion)} unknown to adapter v1`,
        { sessionId: snapshot.sessionId, retryable: false },
      );
    }
  }

  function leaseExpired(lease: LeaseState, at: number): boolean {
    return new Date(lease.expiresAt).getTime() <= at;
  }

  return {
    async create(snapshot) {
      assertSchema(snapshot);
      if (entries.has(snapshot.sessionId)) {
        throw new SessionStoreError('DUPLICATE', `Session already exists: ${snapshot.sessionId}`, {
          sessionId: snapshot.sessionId,
        });
      }
      entries.set(snapshot.sessionId, { snapshot, checkpoints: [], lease: null });
    },

    async load(sessionId) {
      const entry = entries.get(sessionId);
      if (!entry) return null;
      assertSchema(entry.snapshot);
      return entry.snapshot;
    },

    async resume(sessionId, workerId, opts?: ResumeOptions): Promise<ResumeContext> {
      const entry = requireEntry(sessionId);
      assertSchema(entry.snapshot);

      if (opts?.requireFingerprint !== false && opts?.expectedFingerprint !== undefined) {
        if (entry.snapshot.pactRef.fingerprint !== opts.expectedFingerprint) {
          throw new SessionStoreError(
            'FINGERPRINT_MISMATCH',
            `Pact fingerprint drift for ${sessionId}`,
            { sessionId, retryable: false },
          );
        }
      }

      const nowMs = now();
      const ttl = opts?.leaseTtlMs ?? defaultTtl;

      if (entry.lease) {
        const stillLive = !leaseExpired(entry.lease, nowMs);
        if (stillLive && entry.lease.workerId !== workerId) {
          throw new SessionStoreError('FENCED', `Lease held by ${entry.lease.workerId}`, {
            sessionId,
          });
        }
        if (stillLive && entry.lease.workerId === workerId) {
          // Idempotent re-fetch within TTL — G-RESUME-IDEMPOTENT.
          const latest = entry.checkpoints[entry.checkpoints.length - 1] ?? null;
          return {
            snapshot: entry.snapshot,
            checkpoint: latest,
            fencingToken: entry.lease.fencingToken,
            leaseExpiresAt: entry.lease.expiresAt,
          };
        }
        // Else: stale lease — reclaim below.
      }

      const fencingToken = newToken();
      const acquiredAt = isoFrom(nowMs);
      const expiresAt = isoFrom(nowMs + ttl);
      entry.lease = { workerId, fencingToken, acquiredAt, expiresAt };

      const latest = entry.checkpoints[entry.checkpoints.length - 1] ?? null;
      return {
        snapshot: entry.snapshot,
        checkpoint: latest,
        fencingToken,
        leaseExpiresAt: expiresAt,
      };
    },

    async releaseLease(sessionId, fencingToken) {
      const entry = entries.get(sessionId);
      if (!entry || !entry.lease) return;
      if (entry.lease.fencingToken === fencingToken) {
        entry.lease = null;
      }
    },

    async renewLease(sessionId, fencingToken, ttlMs?: number): Promise<string> {
      const entry = requireEntry(sessionId);
      if (!entry.lease || entry.lease.fencingToken !== fencingToken) {
        throw new SessionStoreError('FENCED', `Lease not held for ${sessionId}`, { sessionId });
      }
      const nowMs = now();
      if (leaseExpired(entry.lease, nowMs)) {
        entry.lease = null;
        throw new SessionStoreError('LEASE_EXPIRED', `Lease expired for ${sessionId}`, {
          sessionId,
        });
      }
      const ttl = ttlMs ?? defaultTtl;
      entry.lease.expiresAt = isoFrom(nowMs + ttl);
      return entry.lease.expiresAt;
    },

    async appendCheckpoint(sessionId, checkpoint, fencingToken) {
      const entry = requireEntry(sessionId);
      if (checkpoint.schemaVersion !== 1) {
        throw new SessionStoreError(
          'SCHEMA_INCOMPATIBLE',
          `Checkpoint schemaVersion=${String(checkpoint.schemaVersion)} unknown`,
          { sessionId, retryable: false },
        );
      }
      if (!entry.lease || entry.lease.fencingToken !== fencingToken) {
        throw new SessionStoreError('FENCED', `Stale fencing token for ${sessionId}`, {
          sessionId,
        });
      }
      const nowMs = now();
      if (leaseExpired(entry.lease, nowMs)) {
        entry.lease = null;
        throw new SessionStoreError('LEASE_EXPIRED', `Lease expired for ${sessionId}`, {
          sessionId,
        });
      }
      const expectedSeq = (entry.snapshot.latestCheckpointSequence ?? 0) + 1;
      if (checkpoint.sequence !== expectedSeq) {
        throw new SessionStoreError(
          'INTERNAL',
          `Non-monotonic sequence: got ${checkpoint.sequence}, expected ${expectedSeq}`,
          { sessionId },
        );
      }
      entry.checkpoints.push(checkpoint);
      // Ring retention.
      if (entry.checkpoints.length > ring) {
        entry.checkpoints.splice(0, entry.checkpoints.length - ring);
      }
      entry.snapshot = {
        ...entry.snapshot,
        latestCheckpointSequence: checkpoint.sequence,
        updatedAt: isoFrom(nowMs),
      };
    },

    async loadCheckpoint(sessionId, sequence) {
      const entry = entries.get(sessionId);
      if (!entry) return null;
      return entry.checkpoints.find(c => c.sequence === sequence) ?? null;
    },

    async loadLatestCheckpoint(sessionId) {
      const entry = entries.get(sessionId);
      if (!entry || entry.checkpoints.length === 0) return null;
      return entry.checkpoints[entry.checkpoints.length - 1] ?? null;
    },

    async listCheckpoints(sessionId, limit = 10): Promise<CheckpointMeta[]> {
      const entry = entries.get(sessionId);
      if (!entry) return [];
      const all = entry.checkpoints.slice(-limit).reverse();
      return all.map(c => ({
        sequence: c.sequence,
        createdAt: c.createdAt,
        note: c.note,
        nextAction: c.nextAction,
      }));
    },

    async finalize(sessionId, status: SessionStatus, reason?: string) {
      const entry = requireEntry(sessionId);
      entry.snapshot = {
        ...entry.snapshot,
        status,
        updatedAt: isoFrom(now()),
        metadata: { ...entry.snapshot.metadata, finalReason: reason },
      };
      entry.lease = null;
    },

    async destroy(sessionId) {
      entries.delete(sessionId);
    },
  };
}
