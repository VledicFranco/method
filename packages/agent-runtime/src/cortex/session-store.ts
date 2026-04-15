/**
 * `CortexSessionStore` — PRD-061 §5 Cortex/ctx.storage-backed adapter for the
 * `@method/runtime` SessionStore port.
 *
 * Backend notes — S4 §9.1 specifies a Mongo-collection-shaped surface
 * (`collection('method_session_snapshots').findOneAndUpdate(...)`). The
 * frozen `CortexStorageFacade` structural type in this package (see
 * `cortex/ctx-types.ts`) exposes only a key-value API (`get` / `put` /
 * `delete`). To respect the existing ctx seam (S1 §3.3 — no drift without
 * a co-ordinated bump) this adapter uses that KV surface:
 *
 *   method/session/{sessionId}                 → SnapshotEnvelope (snapshot + _lease)
 *   method/checkpoint/{sessionId}/{sequence}   → Checkpoint
 *
 * Lease CAS is implemented via read-modify-write on the snapshot envelope,
 * with last-writer-wins semantics at the KV layer. Because Cortex's
 * `AppStorage` `put` is atomic at the document level (per PRD-064 §8) and
 * the fencing-token check reads-then-writes under the assumption that a
 * losing concurrent writer will observe the fresh lease on its next read,
 * contention is detected but not eliminated — identical in kind to the
 * FsSessionStore approach.
 *
 * When Cortex's storage service graduates to `findOneAndUpdate` (PRD-064
 * Phase 2, tracked as O-1 in PRD-061 §11) the adapter can be tightened
 * without breaking the port.
 */

import type { CortexCtx, CortexStorageFacade } from './ctx-types.js';
import type { SessionStore } from '@method/runtime/ports';
import { SessionStoreError } from '@method/runtime/ports';
import type {
  Checkpoint,
  CheckpointMeta,
  PersistedSessionSnapshot as SessionSnapshot,
  ResumeContext,
  ResumeOptions,
} from '@method/runtime/ports';

/** Locally-redeclared to avoid depending on the runtime `SessionStatus`
 * which collides with print-session's SessionStatus in the barrel. */
type SessionStatus =
  | 'initializing'
  | 'running'
  | 'idle'
  | 'paused'
  | 'suspended'
  | 'completed'
  | 'failed'
  | 'dead';

interface LeaseState {
  workerId: string;
  fencingToken: string;
  acquiredAt: string;
  expiresAt: string;
}

interface SnapshotEnvelope {
  readonly snapshot: SessionSnapshot;
  readonly _lease: LeaseState | null;
  /** Directory-style list so `listCheckpoints` can iterate without a scan. */
  readonly checkpointSequences: readonly number[];
}

export interface CortexSessionStoreOptions {
  /** Structural ctx — we only touch ctx.storage. */
  readonly ctx: { readonly storage: CortexStorageFacade };
  /** Key prefix — default `method`. Tenants with multiple agents use distinct namespaces. */
  readonly keyPrefix?: string;
  /** Default lease TTL. Default 30_000. */
  readonly defaultLeaseTtlMs?: number;
  /** Checkpoint ring size. Default 10. */
  readonly checkpointRingSize?: number;
  readonly now?: () => number;
  readonly newFencingToken?: () => string;
}

const DEFAULT_TTL_MS = 30_000;
const DEFAULT_RING = 10;

let _counter = 0;
function defaultFencingToken(): string {
  _counter += 1;
  return `ft_${Date.now().toString(36)}_${_counter.toString(36)}`;
}

function isoFrom(ms: number): string {
  return new Date(ms).toISOString();
}

export function createCortexSessionStore(opts: CortexSessionStoreOptions): SessionStore {
  const storage = opts.ctx.storage;
  const prefix = opts.keyPrefix ?? 'method';
  const ringSize = opts.checkpointRingSize ?? DEFAULT_RING;
  const defaultTtl = opts.defaultLeaseTtlMs ?? DEFAULT_TTL_MS;
  const now = opts.now ?? ((): number => Date.now());
  const newToken = opts.newFencingToken ?? defaultFencingToken;

  const snapshotKey = (sessionId: string): string => `${prefix}/session/${sessionId}`;
  const checkpointKey = (sessionId: string, sequence: number): string =>
    `${prefix}/checkpoint/${sessionId}/${sequence}`;

  async function readEnvelope(sessionId: string): Promise<SnapshotEnvelope | null> {
    const raw = await storage.get(snapshotKey(sessionId));
    if (!raw) return null;
    const envelope = raw as unknown as SnapshotEnvelope;
    if (!envelope.snapshot) return null;
    if (envelope.snapshot.schemaVersion !== 1) {
      throw new SessionStoreError(
        'SCHEMA_INCOMPATIBLE',
        `Snapshot schemaVersion=${String(envelope.snapshot.schemaVersion)} unknown`,
        { sessionId, retryable: false },
      );
    }
    return envelope;
  }

  async function writeEnvelope(sessionId: string, envelope: SnapshotEnvelope): Promise<void> {
    await storage.put(
      snapshotKey(sessionId),
      envelope as unknown as Readonly<Record<string, unknown>>,
    );
  }

  async function readCheckpoint(sessionId: string, sequence: number): Promise<Checkpoint | null> {
    const raw = await storage.get(checkpointKey(sessionId, sequence));
    if (!raw) return null;
    const c = raw as unknown as Checkpoint;
    if (c.schemaVersion !== 1) {
      throw new SessionStoreError(
        'SCHEMA_INCOMPATIBLE',
        `Checkpoint schemaVersion=${String(c.schemaVersion)} unknown`,
        { sessionId, retryable: false },
      );
    }
    return c;
  }

  function leaseExpired(lease: LeaseState, at: number): boolean {
    return new Date(lease.expiresAt).getTime() <= at;
  }

  return {
    async create(snapshot) {
      if (snapshot.schemaVersion !== 1) {
        throw new SessionStoreError(
          'SCHEMA_INCOMPATIBLE',
          `Snapshot schemaVersion=${String(snapshot.schemaVersion)} unknown`,
          { sessionId: snapshot.sessionId, retryable: false },
        );
      }
      const existing = await readEnvelope(snapshot.sessionId);
      if (existing) {
        throw new SessionStoreError('DUPLICATE', `Session already exists: ${snapshot.sessionId}`, {
          sessionId: snapshot.sessionId,
        });
      }
      await writeEnvelope(snapshot.sessionId, {
        snapshot,
        _lease: null,
        checkpointSequences: [],
      });
    },

    async load(sessionId) {
      const env = await readEnvelope(sessionId);
      return env ? env.snapshot : null;
    },

    async resume(sessionId, workerId, opts?: ResumeOptions): Promise<ResumeContext> {
      const env = await readEnvelope(sessionId);
      if (!env) {
        throw new SessionStoreError('NOT_FOUND', `No session ${sessionId}`, { sessionId });
      }
      if (opts?.requireFingerprint !== false && opts?.expectedFingerprint !== undefined) {
        if (env.snapshot.pactRef.fingerprint !== opts.expectedFingerprint) {
          throw new SessionStoreError(
            'FINGERPRINT_MISMATCH',
            `Pact fingerprint drift for ${sessionId}`,
            { sessionId, retryable: false },
          );
        }
      }

      const nowMs = now();
      const ttl = opts?.leaseTtlMs ?? defaultTtl;
      const latest = env.checkpointSequences.length
        ? await readCheckpoint(sessionId, env.checkpointSequences[env.checkpointSequences.length - 1]!)
        : null;

      if (env._lease) {
        const stale = leaseExpired(env._lease, nowMs);
        if (!stale && env._lease.workerId !== workerId) {
          throw new SessionStoreError('FENCED', `Lease held by ${env._lease.workerId}`, {
            sessionId,
          });
        }
        if (!stale && env._lease.workerId === workerId) {
          return {
            snapshot: env.snapshot,
            checkpoint: latest,
            fencingToken: env._lease.fencingToken,
            leaseExpiresAt: env._lease.expiresAt,
          };
        }
      }

      const lease: LeaseState = {
        workerId,
        fencingToken: newToken(),
        acquiredAt: isoFrom(nowMs),
        expiresAt: isoFrom(nowMs + ttl),
      };
      await writeEnvelope(sessionId, {
        snapshot: env.snapshot,
        _lease: lease,
        checkpointSequences: env.checkpointSequences,
      });
      return {
        snapshot: env.snapshot,
        checkpoint: latest,
        fencingToken: lease.fencingToken,
        leaseExpiresAt: lease.expiresAt,
      };
    },

    async releaseLease(sessionId, fencingToken) {
      const env = await readEnvelope(sessionId);
      if (!env || !env._lease || env._lease.fencingToken !== fencingToken) return;
      await writeEnvelope(sessionId, {
        snapshot: env.snapshot,
        _lease: null,
        checkpointSequences: env.checkpointSequences,
      });
    },

    async renewLease(sessionId, fencingToken, ttlMs?: number): Promise<string> {
      const env = await readEnvelope(sessionId);
      if (!env || !env._lease || env._lease.fencingToken !== fencingToken) {
        throw new SessionStoreError('FENCED', `Lease not held for ${sessionId}`, { sessionId });
      }
      const nowMs = now();
      if (leaseExpired(env._lease, nowMs)) {
        await writeEnvelope(sessionId, {
          snapshot: env.snapshot,
          _lease: null,
          checkpointSequences: env.checkpointSequences,
        });
        throw new SessionStoreError('LEASE_EXPIRED', `Lease expired for ${sessionId}`, {
          sessionId,
        });
      }
      const expiresAt = isoFrom(nowMs + (ttlMs ?? defaultTtl));
      await writeEnvelope(sessionId, {
        snapshot: env.snapshot,
        _lease: { ...env._lease, expiresAt },
        checkpointSequences: env.checkpointSequences,
      });
      return expiresAt;
    },

    async appendCheckpoint(sessionId, checkpoint, fencingToken) {
      if (checkpoint.schemaVersion !== 1) {
        throw new SessionStoreError(
          'SCHEMA_INCOMPATIBLE',
          `Checkpoint schemaVersion=${String(checkpoint.schemaVersion)} unknown`,
          { sessionId, retryable: false },
        );
      }
      const env = await readEnvelope(sessionId);
      if (!env) {
        throw new SessionStoreError('NOT_FOUND', `No session ${sessionId}`, { sessionId });
      }
      if (!env._lease || env._lease.fencingToken !== fencingToken) {
        throw new SessionStoreError('FENCED', `Stale fencing token for ${sessionId}`, {
          sessionId,
        });
      }
      const nowMs = now();
      if (leaseExpired(env._lease, nowMs)) {
        throw new SessionStoreError('LEASE_EXPIRED', `Lease expired for ${sessionId}`, {
          sessionId,
        });
      }
      const expectedSeq = (env.snapshot.latestCheckpointSequence ?? 0) + 1;
      if (checkpoint.sequence !== expectedSeq) {
        throw new SessionStoreError(
          'INTERNAL',
          `Non-monotonic sequence: got ${checkpoint.sequence}, expected ${expectedSeq}`,
          { sessionId },
        );
      }

      await storage.put(
        checkpointKey(sessionId, checkpoint.sequence),
        checkpoint as unknown as Readonly<Record<string, unknown>>,
      );

      const nextSequences = [...env.checkpointSequences, checkpoint.sequence];
      // Ring retention: evict the oldest slot if we exceed the ring.
      if (nextSequences.length > ringSize) {
        const evict = nextSequences.shift();
        if (evict !== undefined) {
          await storage.delete(checkpointKey(sessionId, evict));
        }
      }

      const nextSnapshot: SessionSnapshot = {
        ...env.snapshot,
        latestCheckpointSequence: checkpoint.sequence,
        updatedAt: isoFrom(nowMs),
      };
      await writeEnvelope(sessionId, {
        snapshot: nextSnapshot,
        _lease: env._lease,
        checkpointSequences: nextSequences,
      });
    },

    async loadCheckpoint(sessionId, sequence) {
      return readCheckpoint(sessionId, sequence);
    },

    async loadLatestCheckpoint(sessionId) {
      const env = await readEnvelope(sessionId);
      if (!env || env.checkpointSequences.length === 0) return null;
      const seq = env.checkpointSequences[env.checkpointSequences.length - 1]!;
      return readCheckpoint(sessionId, seq);
    },

    async listCheckpoints(sessionId, limit = 10): Promise<CheckpointMeta[]> {
      const env = await readEnvelope(sessionId);
      if (!env) return [];
      const sequences = env.checkpointSequences.slice(-limit).reverse();
      const out: CheckpointMeta[] = [];
      for (const seq of sequences) {
        const c = await readCheckpoint(sessionId, seq);
        if (c) {
          out.push({
            sequence: c.sequence,
            createdAt: c.createdAt,
            note: c.note,
            nextAction: c.nextAction,
          });
        }
      }
      return out;
    },

    async finalize(sessionId, status: SessionStatus, reason?: string) {
      const env = await readEnvelope(sessionId);
      if (!env) {
        throw new SessionStoreError('NOT_FOUND', `No session ${sessionId}`, { sessionId });
      }
      const nextSnapshot: SessionSnapshot = {
        ...env.snapshot,
        status,
        updatedAt: isoFrom(now()),
        metadata: { ...env.snapshot.metadata, finalReason: reason },
      };
      await writeEnvelope(sessionId, {
        snapshot: nextSnapshot,
        _lease: null,
        checkpointSequences: env.checkpointSequences,
      });
    },

    async destroy(sessionId) {
      const env = await readEnvelope(sessionId);
      if (!env) return;
      for (const seq of env.checkpointSequences) {
        try {
          await storage.delete(checkpointKey(sessionId, seq));
        } catch {
          /* ignore */
        }
      }
      await storage.delete(snapshotKey(sessionId));
    },
  };
}

/**
 * Helper — select an implementation given a structural `ctx`. Returns the
 * Cortex adapter when `ctx.storage` is present, otherwise `null` (caller
 * falls back to the in-memory reference store).
 */
export function selectCortexSessionStore(
  ctx: CortexCtx,
  opts?: Omit<CortexSessionStoreOptions, 'ctx'>,
): SessionStore | null {
  if (!ctx.storage) return null;
  return createCortexSessionStore({ ctx: { storage: ctx.storage }, ...(opts ?? {}) });
}
