/**
 * Events multiplexer — pacta `AgentEvent` fan-out over an `onEvent` callback
 * AND/OR an async-iterable channel (PRD-058 §6.2, §6.4 D4).
 *
 * Core rules (load-bearing):
 *   - `onEvent` and `events()` are mutually exclusive (S1 Q2, G-EVENTS-MUTEX).
 *     If `onEvent` was supplied to `createMethodAgent`, calling `events()`
 *     MUST throw {@link IllegalStateError}.
 *   - `events()` returns a live AsyncIterable: it observes the current
 *     invocation's stream. Calling before first `invoke()` yields an iterable
 *     that attaches when the next invocation fires (S1 Q7).
 *   - Backpressure: 1000-event bounded queue (PRD-058 §12 Judgment Call 1),
 *     drop-oldest with a `ctx.log.warn` on overflow.
 *   - User `onEvent` callbacks are wrapped in try/catch so an exception does
 *     not crash the invoke pipeline (R6).
 *
 * The multiplexer is owned by the MethodAgent handle; each factory call
 * gets a fresh multiplexer. The `fanIn` handler is registered as pacta's
 * `onEvent` and delegates to all subscribers.
 */

import type { AgentEvent } from '@method/pacta';
import { IllegalStateError } from './errors.js';
import type { CortexLogger } from './cortex/ctx-types.js';

/** Default max queue depth before drop-oldest (S1 §4.2 judgment call). */
export const DEFAULT_QUEUE_CAPACITY = 1000;

export interface EventsMultiplexerOptions {
  /**
   * Tenant-supplied onEvent callback. When present, `events()` throws
   * IllegalStateError to preserve the mutual-exclusion invariant.
   */
  readonly onEvent?: (event: AgentEvent) => void;

  /**
   * When true, the `events()` async-iterable is the primary channel. If
   * `onEvent` is ALSO provided, a call to `events()` throws
   * IllegalStateError.
   */
  readonly asyncIterableEnabled: boolean;

  /** Optional logger for diagnostics (callback errors, overflow warnings). */
  readonly logger?: CortexLogger;

  /** Optional internal subscribers (audit, event connector). */
  readonly internalSubscribers?: ReadonlyArray<(event: AgentEvent) => void | Promise<void>>;

  /** Override queue capacity for tests / tuning. */
  readonly queueCapacity?: number;
}

interface QueuedEvent {
  value: AgentEvent;
}

interface WaitingConsumer {
  resolve: (value: IteratorResult<AgentEvent>) => void;
}

export class EventsMultiplexer {
  private readonly options: EventsMultiplexerOptions;
  private readonly logger: CortexLogger | undefined;
  private readonly capacity: number;

  private readonly queue: QueuedEvent[] = [];
  private readonly waiters: WaitingConsumer[] = [];
  private closed = false;
  private iterableClaimed = false;

  constructor(options: EventsMultiplexerOptions) {
    this.options = options;
    this.logger = options.logger;
    this.capacity = options.queueCapacity ?? DEFAULT_QUEUE_CAPACITY;
  }

  /**
   * pacta `onEvent` handler — the single function registered with
   * `createAgent({ onEvent: multiplexer.fanIn })`.
   */
  readonly fanIn = (event: AgentEvent): void => {
    // External callback (user-supplied). Wrapped for R6.
    if (this.options.onEvent) {
      try {
        this.options.onEvent(event);
      } catch (err) {
        this.logger?.warn?.('agent-runtime: user onEvent callback threw', {
          eventType: event.type,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Internal subscribers (audit, event connector, etc).
    for (const subscriber of this.options.internalSubscribers ?? []) {
      try {
        const maybePromise = subscriber(event);
        if (maybePromise && typeof (maybePromise as Promise<void>).then === 'function') {
          (maybePromise as Promise<void>).catch((err) =>
            this.logger?.warn?.('agent-runtime: internal subscriber rejected', {
              eventType: event.type,
              error: err instanceof Error ? err.message : String(err),
            }),
          );
        }
      } catch (err) {
        this.logger?.warn?.('agent-runtime: internal subscriber threw', {
          eventType: event.type,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Async-iterable path — only when explicitly enabled.
    if (this.options.asyncIterableEnabled) {
      this.pushToQueue(event);
    }
  };

  /**
   * Returns the async-iterable channel.
   *
   * Mutually exclusive with `onEvent`: if a user `onEvent` was supplied,
   * throws {@link IllegalStateError} (S1 Q2, G-EVENTS-MUTEX).
   */
  events(): AsyncIterable<AgentEvent> {
    if (this.options.onEvent !== undefined) {
      throw new IllegalStateError(
        'events() is mutually exclusive with onEvent — pick one channel (PRD-058 §6.2 / S1 Q2)',
      );
    }
    if (!this.options.asyncIterableEnabled) {
      throw new IllegalStateError(
        'events() is not enabled — set `eventsChannel: "async-iterable"` on createMethodAgent',
      );
    }
    if (this.iterableClaimed) {
      throw new IllegalStateError('events() can only be iterated once per handle');
    }
    this.iterableClaimed = true;

    const self = this;
    return {
      [Symbol.asyncIterator](): AsyncIterator<AgentEvent> {
        return {
          next: () => self.nextEvent(),
          return: async () => {
            self.close();
            return { value: undefined, done: true };
          },
        };
      },
    };
  }

  /** Close + release all waiters. Idempotent. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    while (this.waiters.length > 0) {
      const w = this.waiters.shift();
      w?.resolve({ value: undefined, done: true });
    }
  }

  // ── Internals ────────────────────────────────────────────────────

  private pushToQueue(event: AgentEvent): void {
    // A consumer is waiting — deliver synchronously.
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter.resolve({ value: event, done: false });
      return;
    }

    // Overflow — drop oldest + warn once per overflow edge.
    if (this.queue.length >= this.capacity) {
      this.queue.shift();
      this.logger?.warn?.('agent-runtime: events queue overflow, dropped oldest', {
        capacity: this.capacity,
      });
    }
    this.queue.push({ value: event });
  }

  private nextEvent(): Promise<IteratorResult<AgentEvent>> {
    if (this.queue.length > 0) {
      const q = this.queue.shift()!;
      return Promise.resolve({ value: q.value, done: false });
    }
    if (this.closed) {
      return Promise.resolve({ value: undefined, done: true });
    }
    return new Promise((resolve) => {
      this.waiters.push({ resolve });
    });
  }
}
