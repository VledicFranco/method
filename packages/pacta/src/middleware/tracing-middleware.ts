// SPDX-License-Identifier: Apache-2.0
/**
 * Tracing Middleware — emits hierarchical OPERATION TraceEvents around
 * AgentProvider invocations.
 *
 * Each wrapped `invoke()` call produces one `operation` TraceEvent containing
 * latency, token usage, model id, and stop reason. Fits beneath
 * budgetEnforcer / outputValidator / throttler in the middleware stack —
 * this layer is observability-only and never changes the result.
 *
 * Composition (suggested ordering):
 *   tracingMiddleware → budgetEnforcer → outputValidator → throttler → provider
 *
 * Tracing is the outermost layer so the OPERATION event spans the full
 * cost of the call (including budget/validator overhead).
 *
 * @see docs/prds/058-hierarchical-trace-observability.md (C-3)
 */

import type { Pact, AgentRequest, AgentResult } from '../pact.js';
import type { TraceEvent, TraceSink } from '../cognitive/algebra/index.js';

type InvokeFn<T> = (pact: Pact<T>, request: AgentRequest) => Promise<AgentResult<T>>;

/** Sink shape required by the tracing middleware (TraceSink with onEvent). */
export type TracingSink = TraceSink & {
  onEvent: NonNullable<TraceSink['onEvent']>;
};

export interface TracingMiddlewareOptions {
  /** Sink that receives the emitted OPERATION events. Required. */
  readonly sink: TracingSink;

  /**
   * Producer for the cycle ID. Typically reads from the surrounding
   * cognitive cycle. When omitted, a random per-call ID is generated;
   * useful for tests and ad-hoc tracing outside a cycle.
   */
  readonly cycleId?: () => string;

  /**
   * Phase tag attached to each emitted event. When the surrounding cycle
   * already emits PHASE_START/END, set this to the active phase name so
   * the OPERATION event nests under the right phase in the assembled
   * CycleTrace.
   */
  readonly phase?: string;

  /**
   * Operation name on the emitted TraceEvent. Default: `'agent-invoke'`.
   * Set to `'llm-complete'` (or similar) when wrapping a single-shot
   * LLM provider so consumers can discriminate.
   */
  readonly operation?: string;
}

let invocationSeq = 0;

function generateCycleId(): string {
  return `tracing-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function nextEventId(cycleId: string): string {
  return `${cycleId}-op-${++invocationSeq}`;
}

/**
 * Wraps an inner invoke with OPERATION TraceEvent emission.
 *
 * The middleware fires-and-forgets the sink — async sinks must not block
 * the LLM hot path. Sink errors are caught and ignored.
 */
export function tracingMiddleware<T>(
  inner: InvokeFn<T>,
  options: TracingMiddlewareOptions,
): InvokeFn<T> {
  const operation = options.operation ?? 'agent-invoke';
  const cycleIdFn = options.cycleId ?? generateCycleId;

  return async (pact: Pact<T>, request: AgentRequest): Promise<AgentResult<T>> => {
    const cycleId = cycleIdFn();
    const startedAt = Date.now();
    const startTimestamp = startedAt;

    let result: AgentResult<T> | undefined;
    let error: unknown;
    try {
      result = await inner(pact, request);
      return result;
    } catch (e) {
      error = e;
      throw e;
    } finally {
      const endedAt = Date.now();
      const durationMs = endedAt - startedAt;

      const data: Record<string, unknown> = {
        operation,
        startedAt: startTimestamp,
        durationMs,
      };
      if (result) {
        data.inputTokens = result.usage.inputTokens;
        data.outputTokens = result.usage.outputTokens;
        data.cacheReadTokens = result.usage.cacheReadTokens;
        data.cacheWriteTokens = result.usage.cacheWriteTokens;
        data.totalTokens = result.usage.totalTokens;
        data.costUsd = result.cost.totalUsd;
        data.stopReason = result.stopReason;
        data.completed = result.completed;
        // Capture first model from cost report (provider-reported).
        const models = Object.keys(result.cost.perModel);
        if (models.length > 0) data.model = models[0];
      }
      if (error !== undefined) {
        data.error = error instanceof Error ? error.message : String(error);
      }

      const event: TraceEvent = {
        eventId: nextEventId(cycleId),
        cycleId,
        kind: 'operation',
        name: operation,
        timestamp: endedAt,
        durationMs,
        phase: options.phase,
        data,
      };

      try {
        const r = options.sink.onEvent(event);
        if (r instanceof Promise) {
          r.catch(() => {
            /* fire-and-forget — never block the LLM hot path */
          });
        }
      } catch {
        /* swallow sink errors */
      }
    }
  };
}
