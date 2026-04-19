// SPDX-License-Identifier: Apache-2.0
/**
 * EventBusHumanApprovalResolver — Unit tests (F-L-1).
 *
 * Validates the EventBus-backed approval resolution logic:
 *   - Matching response resolves approved
 *   - Rejection with feedback
 *   - Timeout fires when no response arrives
 *   - Mismatched execution_id is ignored (falls through to timeout)
 *   - Emit failure does not abort the subscription wait
 *
 * PRD-057 / S2 §3.2 / C2: moved from @methodts/bridge/domains/strategies/.
 * The test uses a tiny inline EventBus so it stays runnable without
 * depending on @methodts/runtime/event-bus (which lands in C3).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { EventBusHumanApprovalResolver } from './human-approval-resolver.js';
import type { HumanApprovalContext } from '@methodts/methodts/strategy/dag-types.js';
import type {
  EventBus,
  EventFilter,
  EventSink,
  EventSubscription,
  RuntimeEvent,
  RuntimeEventInput,
} from '../ports/event-bus.js';

// ── Tiny in-memory EventBus for runtime-local tests ─────────────

class TinyEventBus implements EventBus {
  private subs: Array<{ filter: EventFilter; handler: (event: RuntimeEvent) => void }> = [];
  private sinks: EventSink[] = [];
  private seq = 0;

  emit(input: RuntimeEventInput): RuntimeEvent {
    const event: RuntimeEvent = {
      ...input,
      id: randomUUID(),
      version: 1,
      timestamp: new Date().toISOString(),
      sequence: ++this.seq,
    };
    for (const sink of this.sinks) {
      try { void sink.onEvent(event); } catch { /* swallow */ }
    }
    for (const sub of this.subs) {
      if (this.matches(event, sub.filter)) {
        try { sub.handler(event); } catch { /* swallow */ }
      }
    }
    return event;
  }

  importEvent(event: RuntimeEvent): void {
    if (event.sequence > this.seq) this.seq = event.sequence;
    for (const sink of this.sinks) { try { void sink.onEvent(event); } catch { /* swallow */ } }
    for (const sub of this.subs) {
      if (this.matches(event, sub.filter)) {
        try { sub.handler(event); } catch { /* swallow */ }
      }
    }
  }

  subscribe(filter: EventFilter, handler: (event: RuntimeEvent) => void): EventSubscription {
    const entry = { filter, handler };
    this.subs.push(entry);
    return {
      unsubscribe: () => {
        const idx = this.subs.indexOf(entry);
        if (idx !== -1) this.subs.splice(idx, 1);
      },
    };
  }

  query(): RuntimeEvent[] { return []; }
  registerSink(sink: EventSink): void { this.sinks.push(sink); }

  private matches(event: RuntimeEvent, filter: EventFilter): boolean {
    if (filter.domain !== undefined) {
      const ds = Array.isArray(filter.domain) ? filter.domain : [filter.domain];
      if (!ds.includes(event.domain)) return false;
    }
    if (filter.type !== undefined) {
      const ts = Array.isArray(filter.type) ? filter.type : [filter.type];
      if (!ts.includes(event.type)) return false;
    }
    return true;
  }
}

// ── Helpers ──────────────────────────────────────────────────────

function makeCtx(overrides: Partial<HumanApprovalContext> = {}): HumanApprovalContext {
  return {
    strategy_id: 'test-strategy',
    execution_id: 'exec-001',
    gate_id: 'gate-001',
    node_id: 'node-001',
    timeout_ms: 5000,
    ...overrides,
  };
}

function makeApprovalResponse(
  executionId: string,
  gateId: string,
  decision: string,
  feedback?: string,
): RuntimeEventInput {
  return {
    version: 1 as const,
    domain: 'strategy' as const,
    type: 'gate.approval_response',
    severity: 'info' as const,
    payload: {
      execution_id: executionId,
      gate_id: gateId,
      decision,
      ...(feedback ? { feedback } : {}),
    } as Record<string, unknown>,
    source: 'test',
  };
}

// ── Helpers for timeout-based tests ──────────────────────────────
// The resolver calls .unref() on its internal timer so it won't keep
// a production server alive. In tests we need the event loop to stay
// alive until the timeout fires, so we create a short ref'd keepalive.

function withKeepAlive<T>(ms: number, fn: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const keepAlive = setTimeout(() => {}, ms + 500);
    fn().then(
      (v) => { clearTimeout(keepAlive); resolve(v); },
      (e) => { clearTimeout(keepAlive); reject(e); },
    );
  });
}

// ── Tests ────────────────────────────────────────────────────────

describe('EventBusHumanApprovalResolver', () => {
  it('matching response resolves approved', async () => {
    const bus = new TinyEventBus();
    const resolver = new EventBusHumanApprovalResolver(bus);
    const ctx = makeCtx();

    const promise = resolver.requestApproval(ctx);

    // Emit a matching approval response
    bus.emit(makeApprovalResponse('exec-001', 'gate-001', 'approved'));

    const result = await promise;
    assert.deepStrictEqual(result, { approved: true });
  });

  it('rejection with feedback', async () => {
    const bus = new TinyEventBus();
    const resolver = new EventBusHumanApprovalResolver(bus);
    const ctx = makeCtx();

    const promise = resolver.requestApproval(ctx);

    bus.emit(makeApprovalResponse('exec-001', 'gate-001', 'rejected', 'needs work'));

    const result = await promise;
    assert.deepStrictEqual(result, { approved: false, feedback: 'needs work' });
  });

  it('timeout fires when no response arrives', async () => {
    const result = await withKeepAlive(200, async () => {
      const bus = new TinyEventBus();
      const resolver = new EventBusHumanApprovalResolver(bus);
      const ctx = makeCtx({ timeout_ms: 50 });
      return resolver.requestApproval(ctx);
    });
    assert.deepStrictEqual(result, { approved: false, feedback: 'Human approval timed out' });
  });

  it('mismatched execution_id is ignored — falls through to timeout', async () => {
    const result = await withKeepAlive(300, async () => {
      const bus = new TinyEventBus();
      const resolver = new EventBusHumanApprovalResolver(bus);
      const ctx = makeCtx({ timeout_ms: 100 });

      const promise = resolver.requestApproval(ctx);

      // Emit a response with wrong execution_id — should be ignored
      bus.emit(makeApprovalResponse('wrong-exec-id', 'gate-001', 'approved'));

      return promise;
    });
    assert.deepStrictEqual(result, { approved: false, feedback: 'Human approval timed out' });
  });

  it('emit failure does not abort the subscription wait', async () => {
    const result = await withKeepAlive(500, async () => {
      const bus = new TinyEventBus();
      const resolver = new EventBusHumanApprovalResolver(bus);

      // Sabotage emit by making it throw after the subscription is set up.
      // The resolver subscribes BEFORE emitting, so we override emit to throw
      // only on the awaiting_approval event (the one the resolver emits).
      const originalEmit = bus.emit.bind(bus);
      let emitCallCount = 0;
      bus.emit = (input: RuntimeEventInput) => {
        emitCallCount++;
        if (input.type === 'gate.awaiting_approval') {
          throw new Error('Simulated emit failure');
        }
        return originalEmit(input);
      };

      const ctx = makeCtx({ timeout_ms: 200 });
      const promise = resolver.requestApproval(ctx);

      assert.equal(emitCallCount, 1, 'emit should have been called once (and thrown)');

      // Restore emit so we can deliver the response
      bus.emit = originalEmit;

      // The subscription was set up before emit, so it should still work
      bus.emit(makeApprovalResponse('exec-001', 'gate-001', 'approved'));

      return promise;
    });
    assert.deepStrictEqual(result, { approved: true });
  });
});
