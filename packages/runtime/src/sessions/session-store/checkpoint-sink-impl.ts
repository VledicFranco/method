// SPDX-License-Identifier: Apache-2.0
/**
 * Default `CheckpointSink` implementation — PRD-061 §5 "Default sink".
 *
 * Observes session-scoped `RuntimeEvent`s, debounces per-session writes, and
 * calls `SessionStore.appendCheckpoint` with a fencing token supplied by the
 * caller. Mirrors the legacy `SessionCheckpointSink` behavior (debounced per-
 * turn writes) but talks to the new `SessionStore` port.
 *
 * The sink NEVER blocks bus emit — handler failures are logged via the
 * `onError` callback (if supplied) and otherwise swallowed.
 */

import type { EventFilter, RuntimeEvent } from '../../ports/event-bus.js';
import type {
  CheckpointSink,
  CheckpointSinkOptions,
} from '../../ports/checkpoint-sink.js';
import type { SessionStore } from '../../ports/session-store.js';
import type { Checkpoint } from '../../ports/session-store-types.js';
import { isSessionStoreError } from '../../ports/session-store-errors.js';

const DEFAULT_DEBOUNCE_MS = 200;

/** Default set of session-lifecycle event types that drive per-turn checkpoints. */
export const SESSION_LIFECYCLE_TYPES: readonly string[] = [
  'session.spawned',
  'session.prompt.completed',
  'session.killed',
  'session.dead',
  'session.state_changed',
];

interface CompiledFilter {
  readonly domains: ReadonlySet<string> | null;
  readonly typePatterns: readonly RegExp[] | null;
  readonly sessionId: string | null;
  readonly projectId: string | null;
  readonly severities: ReadonlySet<string> | null;
}

function compileFilter(filter: EventFilter): CompiledFilter {
  const domains = filter.domain
    ? new Set(Array.isArray(filter.domain) ? filter.domain : [filter.domain])
    : null;
  const types = filter.type
    ? (Array.isArray(filter.type) ? filter.type : [filter.type]).map(globToRegExp)
    : null;
  const severities = filter.severity
    ? new Set(Array.isArray(filter.severity) ? filter.severity : [filter.severity])
    : null;
  return {
    domains,
    typePatterns: types,
    sessionId: filter.sessionId ?? null,
    projectId: filter.projectId ?? null,
    severities,
  };
}

function globToRegExp(pattern: string): RegExp {
  // Convert simple glob (`*`) to regex. Escape everything else.
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`);
}

function matches(filter: CompiledFilter, event: RuntimeEvent): boolean {
  if (filter.domains && !filter.domains.has(event.domain)) return false;
  if (filter.typePatterns && !filter.typePatterns.some(rx => rx.test(event.type))) return false;
  if (filter.sessionId && event.sessionId !== filter.sessionId) return false;
  if (filter.projectId && event.projectId !== filter.projectId) return false;
  if (filter.severities && !filter.severities.has(event.severity)) return false;
  return true;
}

class CheckpointSinkImpl implements CheckpointSink {
  readonly name = 'session-checkpoint' as const;

  private readonly store: SessionStore;
  // Retained for debug / future-use — see S4 §4.2. The sink itself derives
  // fencing tokens from the caller's per-session lookup; the workerId is
  // informational.
  private readonly _workerId: () => string;
  private readonly fencingToken: (sessionId: string) => string | null;
  private readonly capture: CheckpointSinkOptions['captureSnapshot'];
  private readonly debounceMs: number;
  private readonly defaultTypes: ReadonlySet<string>;
  private readonly errorHook?: (err: Error, sessionId: string) => void;

  private readonly extraFilters: CompiledFilter[] = [];
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly inflight = new Map<string, Promise<void>>();
  private disposed = false;

  constructor(opts: CheckpointSinkOptions) {
    this.store = opts.store;
    this._workerId = opts.workerId;
    this.fencingToken = opts.fencingToken;
    this.capture = opts.captureSnapshot;
    this.debounceMs = opts.debounceMs ?? DEFAULT_DEBOUNCE_MS;
    this.defaultTypes = new Set(opts.defaultEventTypes ?? SESSION_LIFECYCLE_TYPES);
    this.errorHook = opts.onError;
  }

  onEvent(event: RuntimeEvent): void {
    if (this.disposed) return;

    const sessionId = event.sessionId ?? (event.payload?.sessionId as string | undefined);
    if (!sessionId) return;

    const immediate = this.extraFilters.some(f => matches(f, event));
    const lifecycle = this.defaultTypes.has(event.type);
    if (!immediate && !lifecycle) return;

    if (immediate) {
      // Per-event opt-in: bypass the debouncer, flush any pending timer first.
      const pending = this.timers.get(sessionId);
      if (pending) {
        clearTimeout(pending);
        this.timers.delete(sessionId);
      }
      void this.writeCheckpoint(sessionId);
      return;
    }

    const existing = this.timers.get(sessionId);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      this.timers.delete(sessionId);
      void this.writeCheckpoint(sessionId);
    }, this.debounceMs);
    this.timers.set(sessionId, timer);
  }

  onError(err: Error, event: RuntimeEvent): void {
    if (!this.errorHook) return;
    const sessionId = event.sessionId ?? '';
    this.errorHook(err, sessionId);
  }

  checkpointOnEvent(filter: EventFilter): void {
    this.extraFilters.push(compileFilter(filter));
  }

  async flush(): Promise<void> {
    const pending: Promise<void>[] = [];
    for (const [sessionId, timer] of this.timers) {
      clearTimeout(timer);
      pending.push(this.writeCheckpoint(sessionId));
    }
    this.timers.clear();
    // Also await any writes already in flight.
    for (const p of this.inflight.values()) {
      pending.push(p);
    }
    await Promise.allSettled(pending);
  }

  get pendingCount(): number {
    return this.timers.size + this.inflight.size;
  }

  dispose(): void {
    this.disposed = true;
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
  }

  // ── internals ───────────────────────────────────────────────────

  private async writeCheckpoint(sessionId: string): Promise<void> {
    const token = this.fencingToken(sessionId);
    if (!token) return; // no active lease — runtime has not resumed this session

    const write = (async (): Promise<void> => {
      try {
        const capture = await this.capture(sessionId);
        if (!capture) return;

        const latest = await this.store.loadLatestCheckpoint(sessionId);
        const sequence = (latest?.sequence ?? 0) + 1;

        const checkpoint: Checkpoint = {
          schemaVersion: 1,
          sequence,
          sessionId,
          createdAt: new Date().toISOString(),
          eventCursor: capture.eventCursor,
          agentState: capture.agentState,
          pendingBudget: capture.pendingBudget,
          nextAction: capture.nextAction,
          note: capture.note,
        };

        await this.store.appendCheckpoint(sessionId, checkpoint, token);
      } catch (err) {
        const e = err instanceof Error ? err : new Error(String(err));
        if (this.errorHook) this.errorHook(e, sessionId);
        else if (!isSessionStoreError(err)) {
          // eslint-disable-next-line no-console
          console.error(`[checkpoint-sink] checkpoint failed for ${sessionId}:`, e.message);
        }
      }
    })();

    this.inflight.set(sessionId, write);
    try {
      await write;
    } finally {
      this.inflight.delete(sessionId);
    }
  }
}

export function createCheckpointSink(opts: CheckpointSinkOptions): CheckpointSink {
  return new CheckpointSinkImpl(opts);
}
