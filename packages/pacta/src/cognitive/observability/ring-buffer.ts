// SPDX-License-Identifier: Apache-2.0
/**
 * TraceRingBuffer — bounded buffer + fan-out subscriptions for live streaming.
 *
 * Wave 0 skeleton — implementation lands in Wave 1 (commission C-1).
 * See `docs/prds/058-hierarchical-trace-observability.md` (Surface 3 +
 * Wave 1 plan).
 */

import type { TraceEvent } from '../algebra/trace-events.js';
import type { TraceSink, TraceRecord } from '../algebra/trace.js';
import type { TraceStream } from '../algebra/trace-stream.js';

export interface TraceRingBufferOptions {
  /** Max events retained. Oldest evicted on overflow. Default 1024. */
  readonly maxSize?: number;
  /** Per-subscriber queue cap. Subscribers exceeding this are dropped. Default 100. */
  readonly subscriberQueueLimit?: number;
}

/**
 * Bounded ring buffer that implements both `TraceSink` (writes) and
 * `TraceStream` (live subscriptions). Slow subscribers are dropped.
 */
export class TraceRingBuffer implements TraceSink, TraceStream {
  constructor(_options?: TraceRingBufferOptions) {
    // implementation in Wave 1
  }

  /** Current number of events buffered. */
  get bufferSize(): number {
    throw new Error('TraceRingBuffer: not implemented (PRD-058 Wave 1, commission C-1)');
  }

  /** Active subscriber count. */
  get subscriberCount(): number {
    throw new Error('TraceRingBuffer: not implemented (PRD-058 Wave 1, commission C-1)');
  }

  onTrace(_record: TraceRecord): void {
    throw new Error('TraceRingBuffer: not implemented (PRD-058 Wave 1, commission C-1)');
  }

  onEvent(_event: TraceEvent): void {
    throw new Error('TraceRingBuffer: not implemented (PRD-058 Wave 1, commission C-1)');
  }

  subscribe(): AsyncIterable<TraceEvent> {
    throw new Error('TraceRingBuffer: not implemented (PRD-058 Wave 1, commission C-1)');
  }

  /** Recent N events, newest last. */
  recent(_n?: number): readonly TraceEvent[] {
    throw new Error('TraceRingBuffer: not implemented (PRD-058 Wave 1, commission C-1)');
  }
}
