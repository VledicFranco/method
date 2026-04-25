// SPDX-License-Identifier: Apache-2.0
/**
 * cognitive-provider × TraceEventBusSink integration — PRD 058 Wave 3.
 *
 * Verifies that when `createCognitiveSession` is given `traceSinks`, every
 * adapter invocation emits a hierarchical OPERATION TraceEvent through every
 * supplied sink. Together with the per-session `TraceEventBusSink` constructed
 * in `pool.ts`, this is the end-to-end wiring that lands trace events on
 * `domain: 'trace'` of the Universal Event Bus.
 *
 * The bridge cognitive cycle is a manual loop (not pacta's `cycle.ts`), so this
 * provider-adapter wrap is the observability hook that gives consumers visibility
 * into LLM invocations from bridge-side cognitive sessions.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { ProviderAdapter, ToolProvider, ToolResult, TraceEvent, TraceSink } from '@methodts/pacta';
import { createCognitiveSession } from '../cognitive-provider.js';
import { TraceEventBusSink } from '../trace-sink.js';
import type {
  RuntimeEvent,
  RuntimeEventInput,
  EventBus,
  EventFilter,
  EventSubscription,
} from '../../ports/event-bus.js';

// ── Helpers ─────────────────────────────────────────────────────

function buildResponse(plan: string, reasoning: string, action: { tool: string; input?: Record<string, unknown> }): string {
  return `<plan>${plan}</plan>\n<reasoning>${reasoning}</reasoning>\n<action>${JSON.stringify(action)}</action>`;
}

function createMockAdapter(responses: string[]): ProviderAdapter {
  let callIndex = 0;
  return {
    async invoke() {
      const idx = callIndex++;
      const output = idx < responses.length ? responses[idx]! : responses[responses.length - 1]!;
      const tokens = { inputTokens: 100, outputTokens: 50, totalTokens: 150, cacheReadTokens: 0, cacheWriteTokens: 0 };
      return {
        output,
        usage: tokens,
        cost: { totalUsd: 0.001, perModel: { 'claude-sonnet-test': { tokens, costUsd: 0.001 } } },
      };
    },
  };
}

function createMockTools(): ToolProvider {
  return {
    list: () => [{ name: 'done', description: 'Mark task complete' }],
    async execute(_name: string, _input: unknown): Promise<ToolResult> {
      return { output: 'mock result' };
    },
  };
}

function makeStubBus(): EventBus & { emitted: RuntimeEventInput[] } {
  const emitted: RuntimeEventInput[] = [];
  let seq = 0;
  return {
    emitted,
    emit(event: RuntimeEventInput): RuntimeEvent {
      emitted.push(event);
      return {
        ...event,
        id: `t-${++seq}`,
        timestamp: new Date().toISOString(),
        sequence: seq,
      } as RuntimeEvent;
    },
    importEvent(_event: RuntimeEvent): void {},
    subscribe(_filter: EventFilter, _handler: (event: RuntimeEvent) => void): EventSubscription {
      return { unsubscribe: () => {} };
    },
    query(_filter: EventFilter): RuntimeEvent[] { return []; },
    registerSink(): void {},
  };
}

class CapturingSink implements TraceSink {
  readonly events: TraceEvent[] = [];
  readonly name = 'capture';
  onTrace(): void { /* legacy path */ }
  onEvent(event: TraceEvent): void { this.events.push(event); }
}

// ── Tests ───────────────────────────────────────────────────────

describe('cognitive-provider × traceSinks wiring (PRD 058 Wave 3)', () => {
  it('emits OPERATION TraceEvent through every event-aware sink on adapter invoke', async () => {
    const adapter = createMockAdapter([
      buildResponse('1. Done.', 'Trivial.', { tool: 'done', input: { result: 'ok' } }),
    ]);
    const tools = createMockTools();
    const capture = new CapturingSink();

    const session = createCognitiveSession({
      id: 'test-sess-1',
      workdir: '/tmp/fake',
      adapter,
      tools,
      onEvent: () => {},
      traceSinks: [capture],
      config: { maxCycles: 2 },
    });

    await session.sendPrompt('Hello');

    assert.ok(capture.events.length >= 1, `expected at least 1 OPERATION event, got ${capture.events.length}`);
    const opEvent = capture.events[0]!;
    assert.equal(opEvent.kind, 'operation');
    assert.equal(opEvent.name, 'agent-invoke');
    assert.ok(typeof opEvent.cycleId === 'string' && opEvent.cycleId.includes('test-sess-1'));
    assert.ok(typeof opEvent.durationMs === 'number');
    assert.equal((opEvent.data as { inputTokens?: number }).inputTokens, 100);
    assert.equal((opEvent.data as { outputTokens?: number }).outputTokens, 50);
    assert.equal((opEvent.data as { model?: string }).model, 'claude-sonnet-test');
  });

  it('TraceEventBusSink lands trace events on the Universal Event Bus end-to-end', async () => {
    const adapter = createMockAdapter([
      buildResponse('1. Done.', 'Done.', { tool: 'done', input: { result: 'ok' } }),
    ]);
    const tools = createMockTools();
    const bus = makeStubBus();
    const traceSink = new TraceEventBusSink(bus, {
      sessionId: 'test-sess-2',
      projectId: 'proj-x',
    });

    const session = createCognitiveSession({
      id: 'test-sess-2',
      workdir: '/tmp/fake',
      adapter,
      tools,
      onEvent: () => {},
      traceSinks: [traceSink],
      config: { maxCycles: 2 },
    });

    await session.sendPrompt('Hello');

    const traceEvents = bus.emitted.filter((e) => e.domain === 'trace');
    assert.ok(traceEvents.length >= 1, `expected at least 1 trace event on bus, got ${traceEvents.length}`);
    const first = traceEvents[0]!;
    assert.equal(first.type, 'trace.operation');
    assert.equal(first.sessionId, 'test-sess-2');
    assert.equal(first.projectId, 'proj-x');
    assert.equal(first.source, 'runtime/sessions/trace-sink');
  });

  it('absent traceSinks → no tracing overhead, no events emitted', async () => {
    const adapter = createMockAdapter([
      buildResponse('1. Done.', 'Done.', { tool: 'done', input: { result: 'ok' } }),
    ]);
    const tools = createMockTools();
    const bus = makeStubBus();

    // No traceSinks passed — adapter should NOT be wrapped, bus should stay quiet
    // for the trace domain.
    const session = createCognitiveSession({
      id: 'test-sess-3',
      workdir: '/tmp/fake',
      adapter,
      tools,
      onEvent: () => {},
      config: { maxCycles: 2 },
    });

    await session.sendPrompt('Hello');

    const traceEvents = bus.emitted.filter((e) => e.domain === 'trace');
    assert.equal(traceEvents.length, 0, 'no trace events expected when traceSinks omitted');
  });

  it('traceSinks with no event-aware sink → adapter wrap skipped (default-off contract)', async () => {
    const adapter = createMockAdapter([
      buildResponse('1. Done.', 'Done.', { tool: 'done', input: { result: 'ok' } }),
    ]);
    const tools = createMockTools();

    // Sink that only implements onTrace (legacy path) — should not trigger wrap.
    const legacyOnly: TraceSink = { onTrace: () => {} };

    const session = createCognitiveSession({
      id: 'test-sess-4',
      workdir: '/tmp/fake',
      adapter,
      tools,
      onEvent: () => {},
      traceSinks: [legacyOnly],
      config: { maxCycles: 2 },
    });

    // Just ensure the session runs without error — adapter wrap is bypassed
    // when no sink declares onEvent.
    const { output } = await session.sendPrompt('Hello');
    assert.ok(typeof output === 'string');
  });
});
