// SPDX-License-Identifier: Apache-2.0
/**
 * TraceStream Port — Surface 3a of PRD 058.
 *
 * Live subscription interface for trace events. Consumers (frontend
 * WebSocket, CLI tail, downstream sinks) subscribe via async iteration.
 *
 * Implementations are expected to fan out to multiple concurrent subscribers
 * and gracefully handle slow consumers (the canonical implementation,
 * TraceRingBuffer, drops subscribers whose internal queue saturates).
 *
 * Pure port — zero implementation imports.
 *
 * @see docs/prds/058-hierarchical-trace-observability.md (Surface 3)
 */

import type { TraceEvent } from './trace-events.js';

/**
 * Live subscription to trace events. Returns an async iterator that yields
 * events as they arrive. Unsubscribing happens by exiting the iterator
 * (`break` from `for await` or calling `.return()`).
 *
 * Slow subscribers whose internal queue fills are typically disconnected
 * by the implementation — this is a streaming port, not a guaranteed-
 * delivery queue. Use TraceStore for replay and history.
 */
export interface TraceStream {
  subscribe(): AsyncIterable<TraceEvent>;
}
