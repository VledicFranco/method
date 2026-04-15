/**
 * CortexEventConnector — S6 implementation (PRD-063).
 *
 * Translates `@method/runtime` RuntimeEvent emissions into Cortex
 * `ctx.events` envelopes with manifest-declared topics, clearance
 * metadata, bounded buffer, token-bucket rate limit, back-pressure
 * signalling, and audit dual-write on permanent failures.
 *
 * Contract invariants (enforced by gates):
 *   G-CONNECTOR-RUNTIME-IMPORTS-ONLY — this file imports only from
 *     `@method/runtime/ports` and the local cortex subtree. No
 *     `@method/bridge`, no runtime event-bus internals.
 *   G-CONNECTOR-TOPIC-ALLOWLIST — only topics in METHOD_TOPIC_REGISTRY
 *     ever reach `ctx.events.emit`.
 *   G-EVENTS-FIRE-AND-FORGET — `ctx.events.emit` rejections never
 *     propagate to the producing agent.
 *   G-AUDIT-SUPERSET — every events-path RuntimeEvent type has an
 *     entry in METHOD_RUNTIME_EVENT_AUDIT_MAP.
 *
 * Fire-and-forget throughout: publish errors NEVER propagate.
 *
 * ── Why no direct @method/runtime/event-bus import? ──
 * The connector is an `EventConnector` — a sink registered at the
 * composition root. We consume only the public port interface from
 * `@method/runtime/ports` so this package stays a pure library usable
 * by any composition (bridge, agent-runtime wrapper, tenant-app boot).
 */

import type {
  EventConnector,
  ConnectorHealth,
  RuntimeEvent,
  EventFilter,
  EventDomain,
  EventSeverity,
} from '@method/runtime/ports';

import type {
  CortexAuditFacade,
  CortexEventsCtx,
  CortexEventsFacade,
  CortexLogger,
} from './ctx-types.js';
import {
  mapRuntimeEventToEnvelope,
  type CortexEnvelope,
  type EnvelopeMapperConfig,
} from './event-envelope-mapper.js';
import {
  METHOD_TOPIC_REGISTRY,
  RUNTIME_EVENT_TYPE_TO_TOPIC,
} from './event-topic-registry.js';
import {
  createBoundedBuffer,
  type BoundedBuffer,
} from './internal/buffer.js';
import {
  createRateLimiter,
  type RateLimiter,
} from './internal/rate-limiter.js';
import {
  publishWithRetry,
  DEFAULT_MAX_RETRIES,
  DEFAULT_RETRY_BASE_MS,
  type PublishResult,
} from './internal/publish-retry.js';
import { dualWriteAuditOnFailure } from './internal/audit-dual-write.js';

// ── Public config ────────────────────────────────────────────────

export interface CortexEventConnectorConfig {
  /** The Cortex app id — for source attribution + audit symmetry. */
  readonly appId: string;

  /**
   * Events this connector is allowed to translate. Must be a subset of
   * the topics declared in the tenant app's manifest
   * `requires.events.emit[]`. Undeclared RuntimeEvent types are dropped
   * with a single throttled `connector.topic_undeclared` event.
   */
  readonly allowedTopics: ReadonlySet<string>;

  /** Optional local filter (mirrors WebhookConnector). */
  readonly filter?: EventFilter;

  /** Bounded in-memory buffer size. Default 500. */
  readonly bufferSize?: number;

  /** Max publish attempts per event. Default 3. */
  readonly maxRetries?: number;

  /** Base delay for retry backoff (ms). Default 1000. */
  readonly retryBaseMs?: number;

  /** Per-second publish cap. Default 12 (PRD-069 headroom). */
  readonly maxEventsPerSecond?: number;

  /** Enable audit dual-write on permanent failures. Default true. */
  readonly auditPublishFailures?: boolean;

  /**
   * O8: truncation threshold for artifact_markdown / prompt / output.
   * Default 32 KB — well below PRD-072 256 KB SNS ceiling.
   */
  readonly truncationThresholdBytes?: number;

  /** Hard ceiling for disconnect drain (ms). Default 5000. */
  readonly disconnectDrainMs?: number;

  /** Drain loop tick interval (ms) while buffer non-empty. Default 50. */
  readonly drainIntervalMs?: number;

  /** Override `emittedBy` principal. */
  readonly emittedBy?: string;
}

// ── Deps (injected for testability) ──────────────────────────────

export interface CortexEventConnectorDeps {
  /** Used for audit dual-write on permanent failures. Optional. */
  readonly audit?: CortexAuditFacade;
  /** Structured logger; falls back to no-op. */
  readonly logger?: CortexLogger;
  /**
   * Sink for `connector.*` diagnostic events. When provided, the
   * connector publishes its own `degraded` / `recovered` /
   * `topic_undeclared` / `schema_rejected` / `publish_failed` events
   * back onto the runtime bus. When absent, diagnostics are swallowed
   * (bus-less composition is valid for tests).
   */
  readonly localEmit?: (ev: {
    readonly type: string;
    readonly severity: EventSeverity;
    readonly payload: Readonly<Record<string, unknown>>;
  }) => void;
  /** Injected delay (ms → Promise) for deterministic tests. */
  readonly delay?: (ms: number) => Promise<void>;
  /** Injected clock. */
  readonly now?: () => number;
}

// ── Defaults ─────────────────────────────────────────────────────

const DEFAULT_BUFFER_SIZE = 500;
const DEFAULT_MAX_EVENTS_PER_SECOND = 12;
const DEFAULT_DISCONNECT_DRAIN_MS = 5_000;
const DEFAULT_DRAIN_INTERVAL_MS = 50;

// ── Filter matching (mirrored from WebhookConnector) ─────────────

function globToRegex(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`);
}

function matchesFilter(event: RuntimeEvent, filter: EventFilter): boolean {
  if (filter.domain !== undefined) {
    const list = Array.isArray(filter.domain) ? filter.domain : [filter.domain];
    if (!list.includes(event.domain as EventDomain)) return false;
  }
  if (filter.type !== undefined) {
    const list = Array.isArray(filter.type) ? filter.type : [filter.type];
    const matched = list.some((pat) =>
      pat.includes('*') ? globToRegex(pat).test(event.type) : pat === event.type,
    );
    if (!matched) return false;
  }
  if (filter.severity !== undefined) {
    const list = Array.isArray(filter.severity) ? filter.severity : [filter.severity];
    if (!list.includes(event.severity as EventSeverity)) return false;
  }
  if (filter.projectId !== undefined && event.projectId !== filter.projectId) return false;
  if (filter.sessionId !== undefined && event.sessionId !== filter.sessionId) return false;
  return true;
}

// ── Pending envelope (buffered) ──────────────────────────────────

interface Pending {
  readonly topic: string;
  readonly envelope: CortexEnvelope;
  readonly runtimeEvent: RuntimeEvent;
}

// ── Connector ────────────────────────────────────────────────────

export class CortexEventConnector implements EventConnector {
  readonly name: string;

  private readonly config: Required<CortexEventConnectorConfig>;
  private readonly events: CortexEventsCtx;
  private readonly deps: CortexEventConnectorDeps;
  private readonly mapperConfig: EnvelopeMapperConfig;

  private readonly buffer: BoundedBuffer<Pending>;
  private readonly rateLimiter: RateLimiter;

  private _connected = false;
  private _lastEventAt: string | null = null;
  private _errorCount = 0;
  private _drainTimer: NodeJS.Timeout | null = null;
  private _disposed = false;

  // Throttle: emit `connector.topic_undeclared` at most once per topic.
  private readonly _topicUndeclaredThrottle = new Set<string>();
  // Throttle: emit `connector.schema_rejected` at most once per topic
  // per run (avoids log flood when one topic is systematically broken).
  private readonly _schemaRejectedThrottle = new Set<string>();

  constructor(
    config: CortexEventConnectorConfig,
    eventsCtx: CortexEventsCtx,
    deps: CortexEventConnectorDeps = {},
  ) {
    this.config = {
      appId: config.appId,
      allowedTopics: config.allowedTopics,
      filter: config.filter ?? {},
      bufferSize: config.bufferSize ?? DEFAULT_BUFFER_SIZE,
      maxRetries: config.maxRetries ?? DEFAULT_MAX_RETRIES,
      retryBaseMs: config.retryBaseMs ?? DEFAULT_RETRY_BASE_MS,
      maxEventsPerSecond: config.maxEventsPerSecond ?? DEFAULT_MAX_EVENTS_PER_SECOND,
      auditPublishFailures: config.auditPublishFailures ?? true,
      truncationThresholdBytes: config.truncationThresholdBytes ?? 32 * 1024,
      disconnectDrainMs: config.disconnectDrainMs ?? DEFAULT_DISCONNECT_DRAIN_MS,
      drainIntervalMs: config.drainIntervalMs ?? DEFAULT_DRAIN_INTERVAL_MS,
      emittedBy: config.emittedBy ?? `service:${config.appId}`,
    };
    this.name = `cortex-events:${config.appId}`;
    this.events = eventsCtx;
    this.deps = deps;

    this.mapperConfig = {
      appId: this.config.appId,
      emittedBy: this.config.emittedBy,
      truncationThresholdBytes: this.config.truncationThresholdBytes,
    };

    // Verify allowedTopics is a subset of the registry (construction-time
    // misconfiguration surfaces early — not at first emit).
    const registryTopics = new Set(METHOD_TOPIC_REGISTRY.map((d) => d.topic));
    const unknown: string[] = [];
    for (const t of config.allowedTopics) {
      if (!registryTopics.has(t)) unknown.push(t);
    }
    if (unknown.length > 0) {
      throw new Error(
        `CortexEventConnector: allowedTopics contains ${unknown.length} topic(s) ` +
          `not in METHOD_TOPIC_REGISTRY: [${unknown.join(', ')}]. ` +
          `Update the registry or drop the topic from allowedTopics.`,
      );
    }

    this.buffer = createBoundedBuffer<Pending>(this.config.bufferSize);
    this.rateLimiter = createRateLimiter({
      maxPerSecond: this.config.maxEventsPerSecond,
      now: deps.now,
    });

    // Wire threshold notifications → local bus.
    this.buffer.onThresholdCrossed((ev) => {
      this.emitConnectorEvent(
        ev === 'recovered-10' ? 'connector.recovered' : 'connector.degraded',
        ev === 'recovered-10' ? 'info' : 'warning',
        {
          threshold: ev,
          bufferDepth: this.buffer.depth(),
          bufferCapacity: this.buffer.capacity(),
        },
      );
    });
  }

  // ── EventConnector lifecycle ──────────────────────────────────

  async connect(): Promise<void> {
    this._connected = true;
    // No external handshake — ctx.events is an in-process facade.
    this.deps.logger?.info?.('cortex-event-connector: connected', {
      appId: this.config.appId,
      allowedTopics: Array.from(this.config.allowedTopics).sort(),
      bufferSize: this.config.bufferSize,
      maxEventsPerSecond: this.config.maxEventsPerSecond,
    });
  }

  async disconnect(): Promise<void> {
    this._disposed = true;
    this._connected = false;
    if (this._drainTimer !== null) {
      clearTimeout(this._drainTimer);
      this._drainTimer = null;
    }
    // Best-effort drain — bounded by disconnectDrainMs.
    const deadline = this.nowMs() + this.config.disconnectDrainMs;
    while (this.buffer.depth() > 0 && this.nowMs() < deadline) {
      const pending = this.buffer.shift();
      if (!pending) break;
      try {
        await publishWithRetry(this.events, pending.topic, pending.envelope, {
          maxRetries: 0, // No retry during drain.
          retryBaseMs: this.config.retryBaseMs,
          delay: this.deps.delay,
        });
      } catch {
        // Swallow — drain is best-effort.
      }
    }
    const remaining = this.buffer.depth();
    if (remaining > 0) {
      this.deps.logger?.warn?.(
        'cortex-event-connector: disconnect drain timed out; remaining events dropped',
        { remaining },
      );
    }
  }

  health(): ConnectorHealth {
    return {
      connected: this._connected,
      lastEventAt: this._lastEventAt,
      errorCount: this._errorCount,
    };
  }

  // ── EventSink interface ──────────────────────────────────────

  onEvent(event: RuntimeEvent): void {
    if (this._disposed) return;

    // 1. Filter
    if (!matchesFilter(event, this.config.filter)) return;

    // 2. Topic lookup + audit-only short circuit
    const outcome = mapRuntimeEventToEnvelope(event, this.mapperConfig);
    if (outcome.kind === 'audit-only') return;

    if (outcome.kind === 'unknown') {
      const t = event.type;
      if (!this._topicUndeclaredThrottle.has(t)) {
        this._topicUndeclaredThrottle.add(t);
        this.emitConnectorEvent('connector.topic_undeclared', 'warning', {
          runtimeEventType: t,
          reason: 'no_registry_entry',
        });
      }
      return;
    }

    const { topic, envelope } = outcome.result;

    // 3. Allowlist enforcement — G-CONNECTOR-TOPIC-ALLOWLIST
    if (!this.config.allowedTopics.has(topic)) {
      if (!this._topicUndeclaredThrottle.has(topic)) {
        this._topicUndeclaredThrottle.add(topic);
        this.emitConnectorEvent('connector.topic_undeclared', 'warning', {
          topic,
          runtimeEventType: event.type,
          reason: 'not_in_allowedTopics',
        });
      }
      return;
    }

    // 4. Rate limit → buffer-or-publish
    if (this.rateLimiter.tryAcquire()) {
      this.fireAndForgetPublish({ topic, envelope, runtimeEvent: event });
    } else {
      const { dropped } = this.buffer.push({ topic, envelope, runtimeEvent: event });
      if (dropped !== undefined) {
        // Oldest evicted on overflow — count as an error and schedule a
        // drain tick, but do NOT emit per-event publish_failed
        // (noise amp).
        this._errorCount += 1;
      }
      this.scheduleDrain();
    }
  }

  onError(error: Error, event: RuntimeEvent): void {
    this._errorCount += 1;
    this.deps.logger?.error?.('cortex-event-connector: sink error', {
      type: event.type,
      message: error.message,
    });
  }

  // ── Diagnostics ──────────────────────────────────────────────

  bufferDepth(): number {
    return this.buffer.depth();
  }

  // ── Internal: publish pathway ────────────────────────────────

  private fireAndForgetPublish(pending: Pending): void {
    // Intentionally swallow. The promise chain never re-enters the
    // event bus path; errors are categorised inside publishWithRetry
    // and either buffered (transient-exhausted) or audit-dual-written
    // (permanent).
    void this.publishAndHandle(pending).catch((err) => {
      this._errorCount += 1;
      this.deps.logger?.warn?.(
        'cortex-event-connector: publishAndHandle unexpected throw',
        { message: err instanceof Error ? err.message : String(err) },
      );
    });
  }

  private async publishAndHandle(pending: Pending): Promise<void> {
    const result: PublishResult = await publishWithRetry(
      this.events,
      pending.topic,
      pending.envelope,
      {
        maxRetries: this.config.maxRetries,
        retryBaseMs: this.config.retryBaseMs,
        delay: this.deps.delay,
      },
    );

    if (result.kind === 'success') {
      this._lastEventAt = new Date(this.nowMs()).toISOString();
      return;
    }

    // Failure handling
    if (result.category === 'permanent') {
      this._errorCount += 1;
      const localType =
        result.reason === 'schema_rejected' || result.reason === 'validation_failed'
          ? 'connector.schema_rejected'
          : result.reason === 'topic_unknown'
            ? 'connector.topic_undeclared'
            : 'connector.publish_failed';

      // Throttle schema_rejected per-topic.
      const throttleKey = `${localType}:${pending.topic}`;
      if (!this._schemaRejectedThrottle.has(throttleKey)) {
        this._schemaRejectedThrottle.add(throttleKey);
        this.emitConnectorEvent(localType, 'error', {
          topic: pending.topic,
          reason: result.reason,
          statusCode: result.statusCode ?? null,
          runtimeEventId: pending.runtimeEvent.id,
          runtimeEventType: pending.runtimeEvent.type,
        });
      }

      // Dual-write to audit.
      await dualWriteAuditOnFailure(
        {
          audit: this.deps.audit,
          logger: this.deps.logger,
          appId: this.config.appId,
          enabled: this.config.auditPublishFailures,
        },
        {
          topic: pending.topic,
          reason: result.reason,
          runtimeEventId: pending.runtimeEvent.id,
          runtimeEventType: pending.runtimeEvent.type,
          retryCount: result.attempts,
          statusCode: result.statusCode,
          detail:
            result.lastError instanceof Error
              ? result.lastError.message
              : typeof result.lastError === 'string'
                ? result.lastError
                : undefined,
        },
      );
      return;
    }

    // Transient exhausted → buffer (drain loop will retry).
    this._errorCount += 1;
    const { dropped } = this.buffer.push(pending);
    if (dropped !== undefined) {
      // Oldest evicted on overflow.
    }
    this.scheduleDrain();
    this.emitConnectorEvent('connector.publish_failed', 'error', {
      topic: pending.topic,
      reason: result.reason,
      statusCode: result.statusCode ?? null,
      runtimeEventId: pending.runtimeEvent.id,
      runtimeEventType: pending.runtimeEvent.type,
      attempts: result.attempts,
      bufferedForRetry: true,
    });
  }

  // ── Internal: drain loop ─────────────────────────────────────

  private scheduleDrain(): void {
    if (this._drainTimer !== null || this._disposed) return;
    if (this.buffer.depth() === 0) return;
    this._drainTimer = setTimeout(() => {
      this._drainTimer = null;
      this.drainTick();
    }, this.config.drainIntervalMs);
    // Don't keep the event loop alive solely for the drain tick.
    if (typeof (this._drainTimer as { unref?: () => unknown }).unref === 'function') {
      (this._drainTimer as { unref: () => void }).unref();
    }
  }

  private drainTick(): void {
    if (this._disposed) return;
    while (this.buffer.depth() > 0 && this.rateLimiter.tryAcquire()) {
      const next = this.buffer.shift();
      if (!next) break;
      this.fireAndForgetPublish(next);
    }
    if (this.buffer.depth() > 0) {
      this.scheduleDrain();
    }
  }

  // ── Internal: local-bus emission ─────────────────────────────

  private emitConnectorEvent(
    type: string,
    severity: EventSeverity,
    payload: Readonly<Record<string, unknown>>,
  ): void {
    try {
      this.deps.localEmit?.({ type, severity, payload });
    } catch (err) {
      this.deps.logger?.warn?.(
        'cortex-event-connector: local emit threw (swallowed)',
        { type, error: err instanceof Error ? err.message : String(err) },
      );
    }
  }

  private nowMs(): number {
    return this.deps.now ? this.deps.now() : Date.now();
  }
}

// ── Adapter: wrap a CortexEventsFacade (publish) as CortexEventsCtx ─

/**
 * Convenience adapter — if the tenant app only exposes the
 * `CortexEventsFacade.publish(topic, payload)` shape (as in
 * agent-runtime's `CortexCtx.events`), wrap it to satisfy the richer
 * `CortexEventsCtx.emit(topic, payload) → { eventId, subscriberCount }`
 * shape. Fallback result uses the envelope's own id; subscriberCount is
 * reported as -1 (unknown).
 */
export function wrapPublishAsEmit(facade: CortexEventsFacade): CortexEventsCtx {
  return {
    async emit(topic: string, payload: Readonly<Record<string, unknown>>) {
      const maybe = facade.publish(topic, payload);
      if (maybe && typeof (maybe as Promise<void>).then === 'function') {
        await (maybe as Promise<void>);
      }
      const id =
        (payload as { readonly eventId?: unknown }).eventId;
      return {
        eventId: typeof id === 'string' ? id : `adapted-${Date.now()}`,
        subscriberCount: -1,
      };
    },
  };
}

// ── Re-exports for consumers ─────────────────────────────────────

export { METHOD_TOPIC_REGISTRY, RUNTIME_EVENT_TYPE_TO_TOPIC };
