/**
 * Structural shim for the subset of PRD-072 `ctx.events` used by
 * `CortexMethodologySource`.
 *
 * Scope is deliberately narrow: only the single declared event type
 * `methodology.updated` is handled here — per PRD-072 §2, runtime
 * wildcard subscriptions are forbidden. The app's manifest must
 * declare both `emit` and `on` for this type (§C-3 in PRD-064).
 *
 * The full `ctx.events` shape is NOT redeclared; Cortex's concrete
 * `EventBus` satisfies this structurally.
 */

/** Narrow envelope matching PRD-072 §13 `EventEnvelope` for the fields we read. */
export interface EventEnvelope<P> {
  readonly eventId: string;
  readonly eventType: 'methodology.updated';
  readonly emitterAppId: string;
  readonly emittedAt: string; // ISO-8601
  readonly emittedBy: string;
  readonly payload: P;
  /** Optional — present on replay / DLQ reads. */
  readonly schemaVersion?: number;
}

/** Payload for the `methodology.updated` event. */
export interface MethodologyUpdatedPayload {
  /** Scopes the event to an app — subscribers MUST filter on this. */
  readonly appId: string;
  readonly methodologyId: string;
  readonly version: string;
  /**
   * Why the emit fired.
   *   'upsert'   : admin write path
   *   'remove'   : admin removed the per-app doc
   *   'policy'   : policy change caused a bulk reload
   *   'async-g7' : G7 test job finished; compilationReport refreshed
   */
  readonly kind: 'upsert' | 'remove' | 'policy' | 'async-g7';
}

/** Unsubscribe callback returned by `on()`. */
export type EventUnsubscribe = () => void | Promise<void>;

/**
 * Structural subset of `ctx.events`. `on()` is manifest-declared (one
 * type), `emit()` writes to the bus. Cortex returns an unsubscribe
 * function; we keep that pattern.
 */
export interface CortexEventsPort {
  on(
    type: 'methodology.updated',
    handler: (envelope: EventEnvelope<MethodologyUpdatedPayload>) => Promise<void> | void,
  ): EventUnsubscribe | void;
  emit(
    type: 'methodology.updated',
    payload: MethodologyUpdatedPayload,
  ): Promise<void>;
}
