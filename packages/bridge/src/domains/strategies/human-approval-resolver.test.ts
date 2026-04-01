/**
 * BridgeHumanApprovalResolver — Unit tests (F-L-1).
 *
 * Validates the EventBus-backed approval resolution logic:
 *   - Matching response resolves approved
 *   - Rejection with feedback
 *   - Timeout fires when no response arrives
 *   - Mismatched execution_id is ignored (falls through to timeout)
 *   - Emit failure does not abort the subscription wait
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { InMemoryEventBus } from '../../shared/event-bus/in-memory-event-bus.js';
import { BridgeHumanApprovalResolver } from './human-approval-resolver.js';
import type { HumanApprovalContext } from '@method/methodts/strategy/dag-types.js';
import type { BridgeEventInput } from '../../ports/event-bus.js';

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
): BridgeEventInput {
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

describe('BridgeHumanApprovalResolver', () => {
  it('matching response resolves approved', async () => {
    const bus = new InMemoryEventBus();
    const resolver = new BridgeHumanApprovalResolver(bus);
    const ctx = makeCtx();

    const promise = resolver.requestApproval(ctx);

    // Emit a matching approval response
    bus.emit(makeApprovalResponse('exec-001', 'gate-001', 'approved'));

    const result = await promise;
    assert.deepStrictEqual(result, { approved: true });
  });

  it('rejection with feedback', async () => {
    const bus = new InMemoryEventBus();
    const resolver = new BridgeHumanApprovalResolver(bus);
    const ctx = makeCtx();

    const promise = resolver.requestApproval(ctx);

    bus.emit(makeApprovalResponse('exec-001', 'gate-001', 'rejected', 'needs work'));

    const result = await promise;
    assert.deepStrictEqual(result, { approved: false, feedback: 'needs work' });
  });

  it('timeout fires when no response arrives', async () => {
    const result = await withKeepAlive(200, async () => {
      const bus = new InMemoryEventBus();
      const resolver = new BridgeHumanApprovalResolver(bus);
      const ctx = makeCtx({ timeout_ms: 50 });
      return resolver.requestApproval(ctx);
    });
    assert.deepStrictEqual(result, { approved: false, feedback: 'Human approval timed out' });
  });

  it('mismatched execution_id is ignored — falls through to timeout', async () => {
    const result = await withKeepAlive(300, async () => {
      const bus = new InMemoryEventBus();
      const resolver = new BridgeHumanApprovalResolver(bus);
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
      const bus = new InMemoryEventBus();
      const resolver = new BridgeHumanApprovalResolver(bus);

      // Sabotage emit by making it throw after the subscription is set up.
      // The resolver subscribes BEFORE emitting, so we override emit to throw
      // only on the awaiting_approval event (the one the resolver emits).
      const originalEmit = bus.emit.bind(bus);
      let emitCallCount = 0;
      bus.emit = (input: BridgeEventInput) => {
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
