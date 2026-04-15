/**
 * Thin session store adapter — PRD-058 §6.4 D6.
 *
 * Default: in-memory adapter. The canonical Cortex-backed adapter (via
 * `ctx.storage`) lands in PRD-061; until then, in-memory is sufficient for
 * the factory wiring and the sample app's round-trip test.
 *
 * Tenant apps may pass `options.resumption.storeAdapter` (once PRD-061 ships)
 * to swap implementations. The adapter key is the outer `Resumption.sessionId`
 * (not the opaque payload) — simpler correlation and the opaque payload is
 * self-describing on recovery.
 */

import type { CortexCtx } from './cortex/ctx-types.js';
import type { ResumptionPayload } from './resumption.js';

export interface SessionStoreAdapter {
  /** Persist payload under sessionId. Fire-and-forget semantics. */
  put(sessionId: string, payload: ResumptionPayload): Promise<void>;
  /** Recover payload by sessionId. Returns null when absent. */
  get(sessionId: string): Promise<ResumptionPayload | null>;
  /** Delete the session entry. Idempotent. */
  delete(sessionId: string): Promise<void>;
}

/**
 * In-memory adapter. Default when `ctx.storage` is absent and no override
 * is passed. Lives for the lifetime of the MethodAgent handle; not durable
 * across process restarts.
 */
export class InMemorySessionStore implements SessionStoreAdapter {
  private readonly data = new Map<string, ResumptionPayload>();

  async put(sessionId: string, payload: ResumptionPayload): Promise<void> {
    this.data.set(sessionId, payload);
  }

  async get(sessionId: string): Promise<ResumptionPayload | null> {
    return this.data.get(sessionId) ?? null;
  }

  async delete(sessionId: string): Promise<void> {
    this.data.delete(sessionId);
  }
}

/**
 * Storage-backed adapter (PRD-064 ctx.storage). Uses the session id + a
 * namespace prefix as the key. This is the *port-level* wiring; the
 * Cortex-backed implementation of `ctx.storage` ships in PRD-061 production.
 */
export class CtxStorageSessionStore implements SessionStoreAdapter {
  private readonly storage: NonNullable<CortexCtx['storage']>;
  private readonly namespace: string;

  constructor(storage: NonNullable<CortexCtx['storage']>, namespace: string) {
    this.storage = storage;
    this.namespace = namespace;
  }

  private key(sessionId: string): string {
    return `${this.namespace}/${sessionId}`;
  }

  async put(sessionId: string, payload: ResumptionPayload): Promise<void> {
    await this.storage.put(this.key(sessionId), { payload: payload as unknown as Record<string, unknown> });
  }

  async get(sessionId: string): Promise<ResumptionPayload | null> {
    const value = await this.storage.get(this.key(sessionId));
    if (!value) return null;
    const inner = (value as { payload?: unknown }).payload;
    if (!inner || typeof inner !== 'object') return null;
    return inner as ResumptionPayload;
  }

  async delete(sessionId: string): Promise<void> {
    await this.storage.delete(this.key(sessionId));
  }
}

/**
 * Factory — pick adapter based on ctx availability + options.
 */
export function selectSessionStore(
  ctx: CortexCtx,
  override: SessionStoreAdapter | undefined,
  namespace: string,
): SessionStoreAdapter {
  if (override) return override;
  if (ctx.storage) return new CtxStorageSessionStore(ctx.storage, namespace);
  return new InMemorySessionStore();
}
