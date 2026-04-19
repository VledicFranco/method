// SPDX-License-Identifier: Apache-2.0
/**
 * `FsSessionStore` — PRD-061 §5 In-Scope filesystem adapter for the
 * `@methodts/runtime` SessionStore port.
 *
 * Layout (per S4 §9.2):
 *
 *   <baseDir>/.method/sessions/<sessionId>/
 *     snapshot.json           atomic write via .tmp + rename
 *     checkpoints.jsonl       append-only; one Checkpoint JSON per line
 *     lease.json              { workerId, fencingToken, acquiredAt, expiresAt }
 *
 * Atomicity primitives are provided via `FileSystemProvider`:
 *   - snapshot write uses `writeFileSync(tmp) + renameSync(tmp → final)`
 *   - checkpoints.jsonl is rewritten atomically on each append (small ring,
 *     default 10 — simpler than appending in place and handles schema
 *     evolution and pruning uniformly). For high-throughput workloads the
 *     adapter can be upgraded to true append; v1 correctness > throughput.
 *   - lease CAS is logical: snapshot.json carries `_lease` and is rewritten
 *     atomically to acquire / renew / release. Concurrent losers observe the
 *     live lease on re-read. Documented single-host limitation (S4 §7).
 *
 * This adapter coexists with the legacy `SessionPersistenceStore` that backs
 * the sessions-dashboard index. The legacy store is fed through an optional
 * `projectLegacy` callback so the dashboard behavior stays unchanged during
 * PRD-061 migration (cleanup tracked in the PRD-061+1 follow-up).
 */

import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

import type { FileSystemProvider } from '../../ports/file-system.js';
import type { SessionStore } from '@methodts/runtime/ports';
import { SessionStoreError } from '@methodts/runtime/ports';
// The PRD-061 SessionStatus (initializing|running|idle|paused|...) lives on
// session-store-types.ts. The `@methodts/runtime/sessions` barrel re-exports a
// *different* `SessionStatus` from print-session; we import the types we need
// via the `ports` barrel, aliasing `SessionSnapshot` to avoid a name clash
// with `session-pool.SessionSnapshot`.
import type {
  Checkpoint,
  CheckpointMeta,
  NextAction,
  BudgetReservation as _BudgetReservation,
  PersistedSessionSnapshot as SessionSnapshot,
  ResumeContext,
  ResumeOptions,
} from '@methodts/runtime/ports';

/** Mirrors the PRD-061 SessionStatus union verbatim. */
type SessionStatus =
  | 'initializing'
  | 'running'
  | 'idle'
  | 'paused'
  | 'suspended'
  | 'completed'
  | 'failed'
  | 'dead';

// Silence unused-import warning — kept for clarity of port dependencies.
export type _PrdRuntimeTypes = NextAction | _BudgetReservation;

interface LeaseState {
  workerId: string;
  pid: number | null;
  fencingToken: string;
  acquiredAt: string;
  expiresAt: string;
}

interface SnapshotEnvelope {
  readonly snapshot: SessionSnapshot;
  readonly _lease: LeaseState | null;
}

export interface FsSessionStoreOptions {
  /** Absolute base directory (project root). Sessions land under `<base>/.method/sessions/`. */
  readonly baseDir: string;
  readonly fs: FileSystemProvider;
  /** Default lease TTL in ms. Default 30_000. */
  readonly defaultLeaseTtlMs?: number;
  /** Checkpoint ring size. Default 10. */
  readonly checkpointRingSize?: number;
  /** Clock override for tests. */
  readonly now?: () => number;
  /** Process id for lease reclaim. Default `process.pid`. */
  readonly currentPid?: number;
  /**
   * Optional callback invoked on every snapshot mutation so the legacy
   * `SessionPersistenceStore` index stays fresh during PRD-061 migration.
   * Safe to omit — callers that do not need dashboard compat skip it.
   */
  readonly projectLegacy?: (snapshot: SessionSnapshot) => void;
}

const DEFAULT_TTL_MS = 30_000;
const DEFAULT_RING = 10;
const SAFE_SESSION_ID_RE = /^[a-zA-Z0-9_-]+$/;

function assertSafeSessionId(sessionId: string): void {
  if (!SAFE_SESSION_ID_RE.test(sessionId)) {
    throw new SessionStoreError('INTERNAL', `Unsafe sessionId: ${sessionId}`, {
      sessionId,
      retryable: false,
    });
  }
}

function newFencingToken(): string {
  return `ft_${Date.now().toString(36)}_${randomBytes(6).toString('hex')}`;
}

function isoFrom(ms: number): string {
  return new Date(ms).toISOString();
}

export function createFsSessionStore(opts: FsSessionStoreOptions): SessionStore {
  const fs = opts.fs;
  const rootDir = join(opts.baseDir, '.method', 'sessions');
  const ringSize = opts.checkpointRingSize ?? DEFAULT_RING;
  const defaultTtl = opts.defaultLeaseTtlMs ?? DEFAULT_TTL_MS;
  const now = opts.now ?? ((): number => Date.now());
  const currentPid = opts.currentPid ?? (typeof process !== 'undefined' ? process.pid : null);

  function sessionDir(sessionId: string): string {
    assertSafeSessionId(sessionId);
    return join(rootDir, sessionId);
  }

  function ensureDir(path: string): void {
    if (!fs.existsSync(path)) fs.mkdirSync(path, { recursive: true });
  }

  function snapshotPath(sessionId: string): string {
    return join(sessionDir(sessionId), 'snapshot.json');
  }

  function checkpointsPath(sessionId: string): string {
    return join(sessionDir(sessionId), 'checkpoints.jsonl');
  }

  function readEnvelope(sessionId: string): SnapshotEnvelope | null {
    const p = snapshotPath(sessionId);
    if (!fs.existsSync(p)) return null;
    try {
      const raw = fs.readFileSync(p, 'utf-8');
      const parsed = JSON.parse(raw) as SnapshotEnvelope;
      if (!parsed.snapshot) return null;
      if (parsed.snapshot.schemaVersion !== 1) {
        throw new SessionStoreError(
          'SCHEMA_INCOMPATIBLE',
          `Snapshot schemaVersion=${String(parsed.snapshot.schemaVersion)} unknown to adapter v1`,
          { sessionId, retryable: false },
        );
      }
      return parsed;
    } catch (err) {
      if (err instanceof SessionStoreError) throw err;
      throw new SessionStoreError(
        'CORRUPT_SNAPSHOT',
        `Cannot parse snapshot.json: ${(err as Error).message}`,
        { sessionId, retryable: false, cause: err },
      );
    }
  }

  function writeEnvelope(sessionId: string, envelope: SnapshotEnvelope): void {
    ensureDir(sessionDir(sessionId));
    const p = snapshotPath(sessionId);
    const tmp = `${p}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(envelope, null, 2), { encoding: 'utf-8' });
    fs.renameSync(tmp, p);
    if (opts.projectLegacy) {
      try {
        opts.projectLegacy(envelope.snapshot);
      } catch {
        /* swallow — projection is best-effort */
      }
    }
  }

  function readCheckpoints(sessionId: string): Checkpoint[] {
    const p = checkpointsPath(sessionId);
    if (!fs.existsSync(p)) return [];
    const raw = fs.readFileSync(p, 'utf-8');
    const lines = raw.split('\n').filter(l => l.trim().length > 0);
    const out: Checkpoint[] = [];
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line) as Checkpoint;
        if (parsed.schemaVersion !== 1) {
          throw new SessionStoreError(
            'SCHEMA_INCOMPATIBLE',
            `Checkpoint schemaVersion=${String(parsed.schemaVersion)} unknown`,
            { sessionId, retryable: false },
          );
        }
        out.push(parsed);
      } catch (err) {
        if (err instanceof SessionStoreError) throw err;
        // skip malformed lines — do not fail the whole read on one corrupt line
      }
    }
    return out;
  }

  function writeCheckpoints(sessionId: string, checkpoints: Checkpoint[]): void {
    ensureDir(sessionDir(sessionId));
    const p = checkpointsPath(sessionId);
    const tmp = `${p}.tmp`;
    const content = checkpoints.map(c => JSON.stringify(c)).join('\n') + (checkpoints.length ? '\n' : '');
    fs.writeFileSync(tmp, content, { encoding: 'utf-8' });
    fs.renameSync(tmp, p);
  }

  function leaseExpired(lease: LeaseState, at: number): boolean {
    return new Date(lease.expiresAt).getTime() <= at;
  }

  function pidAlive(pid: number | null): boolean {
    if (pid === null || typeof process === 'undefined') return true;
    try {
      // signal 0 probe — throws if the process does not exist
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
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
      const existing = readEnvelope(snapshot.sessionId);
      if (existing) {
        throw new SessionStoreError('DUPLICATE', `Session already exists: ${snapshot.sessionId}`, {
          sessionId: snapshot.sessionId,
        });
      }
      writeEnvelope(snapshot.sessionId, { snapshot, _lease: null });
      writeCheckpoints(snapshot.sessionId, []);
    },

    async load(sessionId) {
      const env = readEnvelope(sessionId);
      return env ? env.snapshot : null;
    },

    async resume(sessionId, workerId, opts?: ResumeOptions): Promise<ResumeContext> {
      const env = readEnvelope(sessionId);
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
      const checkpoints = readCheckpoints(sessionId);
      const latest = checkpoints[checkpoints.length - 1] ?? null;

      if (env._lease) {
        const stale = leaseExpired(env._lease, nowMs) || !pidAlive(env._lease.pid);
        if (!stale && env._lease.workerId !== workerId) {
          throw new SessionStoreError('FENCED', `Lease held by ${env._lease.workerId}`, {
            sessionId,
          });
        }
        if (!stale && env._lease.workerId === workerId) {
          // Idempotent re-fetch.
          return {
            snapshot: env.snapshot,
            checkpoint: latest,
            fencingToken: env._lease.fencingToken,
            leaseExpiresAt: env._lease.expiresAt,
          };
        }
        // else: stale — reclaim below.
      }

      const newLease: LeaseState = {
        workerId,
        pid: currentPid,
        fencingToken: newFencingToken(),
        acquiredAt: isoFrom(nowMs),
        expiresAt: isoFrom(nowMs + ttl),
      };
      writeEnvelope(sessionId, { snapshot: env.snapshot, _lease: newLease });

      return {
        snapshot: env.snapshot,
        checkpoint: latest,
        fencingToken: newLease.fencingToken,
        leaseExpiresAt: newLease.expiresAt,
      };
    },

    async releaseLease(sessionId, fencingToken) {
      const env = readEnvelope(sessionId);
      if (!env || !env._lease) return;
      if (env._lease.fencingToken !== fencingToken) return;
      writeEnvelope(sessionId, { snapshot: env.snapshot, _lease: null });
    },

    async renewLease(sessionId, fencingToken, ttlMs?: number): Promise<string> {
      const env = readEnvelope(sessionId);
      if (!env || !env._lease || env._lease.fencingToken !== fencingToken) {
        throw new SessionStoreError('FENCED', `Lease not held for ${sessionId}`, { sessionId });
      }
      const nowMs = now();
      if (leaseExpired(env._lease, nowMs)) {
        writeEnvelope(sessionId, { snapshot: env.snapshot, _lease: null });
        throw new SessionStoreError('LEASE_EXPIRED', `Lease expired for ${sessionId}`, {
          sessionId,
        });
      }
      const expiresAt = isoFrom(nowMs + (ttlMs ?? defaultTtl));
      writeEnvelope(sessionId, {
        snapshot: env.snapshot,
        _lease: { ...env._lease, expiresAt },
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
      const env = readEnvelope(sessionId);
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
        writeEnvelope(sessionId, { snapshot: env.snapshot, _lease: null });
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
      const checkpoints = readCheckpoints(sessionId);
      checkpoints.push(checkpoint);
      // Ring retention.
      const trimmed = checkpoints.length > ringSize
        ? checkpoints.slice(checkpoints.length - ringSize)
        : checkpoints;
      writeCheckpoints(sessionId, trimmed);

      const nextSnapshot: SessionSnapshot = {
        ...env.snapshot,
        latestCheckpointSequence: checkpoint.sequence,
        updatedAt: isoFrom(nowMs),
      };
      writeEnvelope(sessionId, { snapshot: nextSnapshot, _lease: env._lease });
    },

    async loadCheckpoint(sessionId, sequence) {
      const checkpoints = readCheckpoints(sessionId);
      return checkpoints.find(c => c.sequence === sequence) ?? null;
    },

    async loadLatestCheckpoint(sessionId) {
      const checkpoints = readCheckpoints(sessionId);
      return checkpoints.length ? checkpoints[checkpoints.length - 1] ?? null : null;
    },

    async listCheckpoints(sessionId, limit = 10): Promise<CheckpointMeta[]> {
      const checkpoints = readCheckpoints(sessionId);
      const slice = checkpoints.slice(-limit).reverse();
      return slice.map(c => ({
        sequence: c.sequence,
        createdAt: c.createdAt,
        note: c.note,
        nextAction: c.nextAction,
      }));
    },

    async finalize(sessionId, status: SessionStatus, reason?: string) {
      const env = readEnvelope(sessionId);
      if (!env) {
        throw new SessionStoreError('NOT_FOUND', `No session ${sessionId}`, { sessionId });
      }
      const nextSnapshot: SessionSnapshot = {
        ...env.snapshot,
        status,
        updatedAt: isoFrom(now()),
        metadata: { ...env.snapshot.metadata, finalReason: reason },
      };
      writeEnvelope(sessionId, { snapshot: nextSnapshot, _lease: null });
    },

    async destroy(sessionId) {
      assertSafeSessionId(sessionId);
      const dir = sessionDir(sessionId);
      if (!fs.existsSync(dir)) return;
      // Best-effort: unlink the files we wrote. The FS provider doesn't have
      // `rmdir -rf`; we unlink known files and leave the empty directory.
      for (const name of ['snapshot.json', 'snapshot.json.tmp', 'checkpoints.jsonl', 'checkpoints.jsonl.tmp']) {
        const p = join(dir, name);
        if (fs.existsSync(p)) {
          try {
            fs.unlinkSync(p);
          } catch {
            /* ignore */
          }
        }
      }
    },
  };
}
