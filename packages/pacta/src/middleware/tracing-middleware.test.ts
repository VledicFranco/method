// SPDX-License-Identifier: Apache-2.0
/**
 * Unit tests for tracingMiddleware — PRD 058 C-3.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { tracingMiddleware } from './tracing-middleware.js';
import type { Pact, AgentRequest, AgentResult } from '../pact.js';
import type { TraceEvent, TraceSink, TraceRecord } from '../cognitive/algebra/index.js';

class CapturingSink implements TraceSink {
  events: TraceEvent[] = [];
  onTrace(_record: TraceRecord): void {
    /* noop for these tests */
  }
  onEvent(event: TraceEvent): void {
    this.events.push(event);
  }
}

const pact = {} as Pact<unknown>;
const request: AgentRequest = { prompt: 'hi' };

function mkResult(overrides?: Partial<AgentResult<unknown>>): AgentResult<unknown> {
  return {
    output: 'ok',
    sessionId: 's-1',
    completed: true,
    stopReason: 'complete',
    usage: {
      inputTokens: 10,
      outputTokens: 20,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 30,
    },
    cost: { totalUsd: 0.001, perModel: { 'sonnet-4.6': { tokens: { inputTokens: 10, outputTokens: 20, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 30 }, costUsd: 0.001 } } },
    durationMs: 0,
    turns: 1,
    ...overrides,
  };
}

describe('tracingMiddleware', () => {
  it('AC-5: emits exactly one OPERATION event per invocation', async () => {
    const sink = new CapturingSink();
    const inner = async () => mkResult();
    const wrapped = tracingMiddleware(inner, { sink: sink as TraceSink & { onEvent: NonNullable<TraceSink['onEvent']> } });

    await wrapped(pact, request);
    assert.equal(sink.events.length, 1);
    const ev = sink.events[0]!;
    assert.equal(ev.kind, 'operation');
    assert.equal(ev.name, 'agent-invoke');
  });

  it('AC-5 metadata: emitted event carries token usage, model, durationMs', async () => {
    const sink = new CapturingSink();
    const inner = async () => mkResult();
    const wrapped = tracingMiddleware(inner, {
      sink: sink as TraceSink & { onEvent: NonNullable<TraceSink['onEvent']> },
      operation: 'llm-complete',
    });

    await wrapped(pact, request);
    const ev = sink.events[0]!;
    assert.equal(ev.name, 'llm-complete');
    assert.equal((ev.data as any).inputTokens, 10);
    assert.equal((ev.data as any).outputTokens, 20);
    assert.equal((ev.data as any).cacheReadTokens, 0);
    assert.equal((ev.data as any).totalTokens, 30);
    assert.equal((ev.data as any).model, 'sonnet-4.6');
    assert.equal((ev.data as any).stopReason, 'complete');
    assert.equal(typeof ev.durationMs, 'number');
    assert.ok(ev.durationMs! >= 0);
  });

  it('uses provided cycleId and phase', async () => {
    const sink = new CapturingSink();
    const inner = async () => mkResult();
    const wrapped = tracingMiddleware(inner, {
      sink: sink as TraceSink & { onEvent: NonNullable<TraceSink['onEvent']> },
      cycleId: () => 'my-cycle',
      phase: 'reason',
    });

    await wrapped(pact, request);
    const ev = sink.events[0]!;
    assert.equal(ev.cycleId, 'my-cycle');
    assert.equal(ev.phase, 'reason');
  });

  it('emits OPERATION event when inner throws (error path captured)', async () => {
    const sink = new CapturingSink();
    const inner = async () => {
      throw new Error('inner boom');
    };
    const wrapped = tracingMiddleware(inner, { sink: sink as TraceSink & { onEvent: NonNullable<TraceSink['onEvent']> } });

    await assert.rejects(() => wrapped(pact, request), /inner boom/);
    assert.equal(sink.events.length, 1);
    assert.equal((sink.events[0]!.data as any).error, 'inner boom');
  });

  it('does not block on slow async sink', async () => {
    let sinkResolved = false;
    const sink: TraceSink & { onEvent: NonNullable<TraceSink['onEvent']> } = {
      onTrace: () => {},
      onEvent: () =>
        new Promise<void>((resolve) => {
          setTimeout(() => {
            sinkResolved = true;
            resolve();
          }, 50);
        }),
    };
    const inner = async () => mkResult();
    const wrapped = tracingMiddleware(inner, { sink });

    const start = Date.now();
    await wrapped(pact, request);
    const elapsed = Date.now() - start;

    // Wrapped invocation must NOT wait for the slow sink.
    assert.ok(elapsed < 50, `wrapped call should not wait for slow sink (took ${elapsed}ms)`);
    assert.equal(sinkResolved, false);
  });

  it('swallows sink errors without affecting result', async () => {
    const sink: TraceSink & { onEvent: NonNullable<TraceSink['onEvent']> } = {
      onTrace: () => {},
      onEvent: () => {
        throw new Error('sink died');
      },
    };
    const inner = async () => mkResult();
    const wrapped = tracingMiddleware(inner, { sink });

    const result = await wrapped(pact, request);
    assert.equal(result.output, 'ok');
  });

  it('result is returned unchanged (observability-only middleware)', async () => {
    const sink = new CapturingSink();
    const expected = mkResult({ sessionId: 's-distinct', turns: 7 });
    const inner = async () => expected;
    const wrapped = tracingMiddleware(inner, { sink: sink as TraceSink & { onEvent: NonNullable<TraceSink['onEvent']> } });

    const got = await wrapped(pact, request);
    assert.strictEqual(got, expected);
  });
});
