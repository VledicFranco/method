// SPDX-License-Identifier: Apache-2.0
/**
 * TraceRingBuffer — bounded buffer + fan-out subscriptions for live streaming.
 *
 * Implements both `TraceSink` (writes) and `TraceStream` (live subscriptions).
 * Bounded by `maxSize`; oldest events evicted on overflow. Multiple concurrent
 * subscribers each get their own internal queue; subscribers whose queue
 * saturates (`subscriberQueueLimit`) are dropped to prevent backpressure.
 *
 * @see docs/prds/058-hierarchical-trace-observability.md (Wave 1, C-1)
 */

import type { TraceEvent } from '../algebra/trace-events.js';
import type { TraceSink, TraceRecord } from '../algebra/trace.js';
import type { TraceStream } from '../algebra/trace-stream.js';

const DEFAULT_MAX_SIZE = 1024;
const DEFAULT_SUBSCRIBER_QUEUE_LIMIT = 100;

export interface TraceRingBufferOptions {
  /** Max events retained. Oldest evicted on overflow. Default 1024. */
  readonly maxSize?: number;
  /** Per-subscriber queue cap. Subscribers exceeding this are dropped. Default 100. */
  readonly subscriberQueueLimit?: number;
}

/** Internal subscriber state. */
interface Subscriber {
  /** FIFO queue of pending events. */
  readonly queue: TraceEvent[];
  /** Set when subscribe()'s iterator is awaiting the next event. */
  resolver: ((value: IteratorResult<TraceEvent>) => void) | null;
  /** True after the iterator's return() has been called. */
  closed: boolean;
}

export class TraceRingBuffer implements TraceSink, TraceStream {
  private readonly maxSize: number;
  private readonly subscriberQueueLimit: number;
  private readonly buffer: TraceEvent[] = [];
  private readonly subscribers = new Set<Subscriber>();

  constructor(options?: TraceRingBufferOptions) {
    this.maxSize = options?.maxSize ?? DEFAULT_MAX_SIZE;
    this.subscriberQueueLimit = options?.subscriberQueueLimit ?? DEFAULT_SUBSCRIBER_QUEUE_LIMIT;
  }

  get bufferSize(): number {
    return this.buffer.length;
  }

  get subscriberCount(): number {
    return this.subscribers.size;
  }

  /** Legacy flat path — accepted but not stored. Use onEvent for hierarchical events. */
  onTrace(_record: TraceRecord): void {
    // Intentional no-op. The ring buffer specializes in TraceEvents per PRD 058.
  }

  /** Append an event and fan out to all live subscribers. */
  onEvent(event: TraceEvent): void {
    // Append, evict oldest if over capacity.
    this.buffer.push(event);
    while (this.buffer.length > this.maxSize) this.buffer.shift();

    // Fan out.
    const dead: Subscriber[] = [];
    for (const sub of this.subscribers) {
      if (sub.closed) {
        dead.push(sub);
        continue;
      }
      // If iterator is awaiting, resolve it directly without queueing.
      if (sub.resolver) {
        const r = sub.resolver;
        sub.resolver = null;
        r({ value: event, done: false });
        continue;
      }
      // Otherwise enqueue. Drop subscriber if over the limit.
      if (sub.queue.length >= this.subscriberQueueLimit) {
        dead.push(sub);
        continue;
      }
      sub.queue.push(event);
    }
    for (const d of dead) this.subscribers.delete(d);
  }

  /**
   * Subscribe to live trace events. Returns an async iterator. Exiting the
   * iterator (e.g., `break` in `for await`) cleans up the subscription.
   *
   * Slow subscribers (queue saturates `subscriberQueueLimit`) are dropped.
   * The dropped subscriber's iterator yields one more `done: true` and ends.
   */
  subscribe(): AsyncIterable<TraceEvent> {
    const subscriber: Subscriber = {
      queue: [],
      resolver: null,
      closed: false,
    };
    this.subscribers.add(subscriber);
    const subscribers = this.subscribers;

    return {
      [Symbol.asyncIterator](): AsyncIterator<TraceEvent> {
        return {
          next(): Promise<IteratorResult<TraceEvent>> {
            if (subscriber.closed) {
              return Promise.resolve({ value: undefined, done: true });
            }
            const queued = subscriber.queue.shift();
            if (queued !== undefined) {
              return Promise.resolve({ value: queued, done: false });
            }
            // No event ready — install resolver.
            return new Promise<IteratorResult<TraceEvent>>((resolve) => {
              subscriber.resolver = resolve;
            });
          },
          return(): Promise<IteratorResult<TraceEvent>> {
            subscriber.closed = true;
            // Wake any pending awaiter.
            if (subscriber.resolver) {
              const r = subscriber.resolver;
              subscriber.resolver = null;
              r({ value: undefined, done: true });
            }
            subscribers.delete(subscriber);
            return Promise.resolve({ value: undefined, done: true });
          },
          throw(err?: unknown): Promise<IteratorResult<TraceEvent>> {
            subscriber.closed = true;
            if (subscriber.resolver) {
              const r = subscriber.resolver;
              subscriber.resolver = null;
              r({ value: undefined, done: true });
            }
            subscribers.delete(subscriber);
            return Promise.reject(err);
          },
        };
      },
    };
  }

  /** Recent N events from the buffer (newest last). If `n` is undefined, returns all buffered. */
  recent(n?: number): readonly TraceEvent[] {
    if (n === undefined) return [...this.buffer];
    if (n <= 0) return [];
    return this.buffer.slice(-n);
  }
}
