// SPDX-License-Identifier: Apache-2.0
/**
 * Unit tests for cortexAuditMiddleware (PRD-059 §5.1).
 *
 * Covers:
 *   - SC-04 / G-AUDIT-EXHAUSTIVE: every pacta AgentEvent.type has a
 *     mapping entry.
 *   - Compose-time validation (missing ctx.audit, invalid appId).
 *   - Default suppress list: `['text', 'thinking']`.
 *   - Fire-and-forget: ctx.audit throw does NOT fail invoke.
 *   - wrap() emits audit event per pacta event via shadowed onEvent.
 *   - Token-exchange synthetic variant (`method.agent.token_exchange`)
 *     maps and emits cleanly.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Pact, AgentRequest, AgentResult, AgentEvent } from '@methodts/pacta';
import {
  cortexAuditMiddleware,
  AUDIT_EVENT_MAP,
} from './audit-middleware.js';
import { CortexAdapterComposeError } from './adapter.js';
import type { AuditEvent, CortexAuditCtx } from './ctx-types.js';

// ── Helpers ──────────────────────────────────────────────────────

function makeAudit(overrides?: { throwOnEvent?: boolean }): {
  ctx: CortexAuditCtx;
  events: AuditEvent[];
} {
  const events: AuditEvent[] = [];
  const ctx: CortexAuditCtx = {
    async event(ev: AuditEvent): Promise<void> {
      if (overrides?.throwOnEvent) throw new Error('audit down');
      events.push(ev);
    },
  };
  return { ctx, events };
}

function oneshotPact(): Pact<unknown> {
  return { mode: { type: 'oneshot' } };
}

// ── G-AUDIT-EXHAUSTIVE — the authoritative gate ──────────────────

describe('cortexAuditMiddleware — G-AUDIT-EXHAUSTIVE (SC-04)', () => {
  // Build the set of all pacta AgentEvent discriminants. Keep in sync with
  // `packages/pacta/src/events.ts` + `cognitive/algebra/events.ts`. If a
  // new variant is added to pacta without an AUDIT_EVENT_MAP entry, this
  // test fails — exactly the behavior PRD-059 §6.6 / Gate requires.
  const PACTA_EVENT_TYPES = [
    // Base AgentEvent (packages/pacta/src/events.ts)
    'started',
    'text',
    'thinking',
    'tool_use',
    'tool_result',
    'turn_complete',
    'context_compacted',
    'reflection',
    'budget_warning',
    'budget_exhausted',
    'error',
    'completed',
    // CognitiveEvent (packages/pacta/src/cognitive/algebra/events.ts)
    'cognitive:module_step',
    'cognitive:monitoring_signal',
    'cognitive:control_directive',
    'cognitive:control_policy_violation',
    'cognitive:workspace_write',
    'cognitive:workspace_eviction',
    'cognitive:cycle_phase',
    'cognitive:learn_failed',
    'cognitive:cycle_aborted',
    'cognitive:constraint_pinned',
    'cognitive:constraint_violation',
    'cognitive:monitor_directive_applied',
  ] as const;

  it('every pacta AgentEvent variant has an AUDIT_EVENT_MAP entry', () => {
    const missing = PACTA_EVENT_TYPES.filter(t => !(t in AUDIT_EVENT_MAP));
    assert.deepEqual(
      missing,
      [],
      `AUDIT_EVENT_MAP missing entries for: ${JSON.stringify(missing)}`,
    );
  });

  it('token-exchange synthetic event is present', () => {
    assert.ok('method.agent.token_exchange' in AUDIT_EVENT_MAP);
  });

  it('each mapping entry has eventType + extract function', () => {
    for (const [key, entry] of Object.entries(AUDIT_EVENT_MAP)) {
      assert.equal(typeof entry.eventType, 'string', `${key} eventType`);
      assert.equal(typeof entry.extract, 'function', `${key} extract`);
    }
  });
});

// ── Compose gates ────────────────────────────────────────────────

describe('cortexAuditMiddleware — compose gates', () => {
  it('throws on missing ctx.audit', () => {
    const adapter = cortexAuditMiddleware({ appId: 'my-app' });
    assert.throws(
      () => adapter.compose({ ctx: {} as any, pact: oneshotPact() }),
      (err: unknown) =>
        err instanceof CortexAdapterComposeError &&
        err.reason === 'missing_ctx_service',
    );
  });

  it('throws on empty appId', () => {
    const { ctx } = makeAudit();
    const adapter = cortexAuditMiddleware({ appId: '' });
    assert.throws(
      () => adapter.compose({ ctx: { audit: ctx }, pact: oneshotPact() }),
      (err: unknown) =>
        err instanceof CortexAdapterComposeError &&
        err.reason === 'invalid_config' &&
        err.details.field === 'appId',
    );
  });

  it('successful compose returns name "cortex-audit" + requires [audit]', () => {
    const { ctx } = makeAudit();
    const composed = cortexAuditMiddleware({ appId: 'my-app' }).compose({
      ctx: { audit: ctx },
      pact: oneshotPact(),
    });
    assert.equal(composed.name, 'cortex-audit');
    assert.deepEqual([...composed.requires], ['audit']);
  });
});

// ── Wrap / emit behavior ─────────────────────────────────────────

describe('cortexAuditMiddleware — wrap + emit', () => {
  it('wrap() shadow-emits onEvent calls to ctx.audit', async () => {
    const { ctx, events } = makeAudit();
    const composed = cortexAuditMiddleware({ appId: 'my-app' }).compose({
      ctx: { audit: ctx },
      pact: oneshotPact(),
    });

    const inner = async (
      _p: Pact<unknown>,
      req: AgentRequest,
    ): Promise<AgentResult<unknown>> => {
      // Simulate the provider emitting a variety of events.
      const onEvent = req.metadata?.onEvent as
        | ((e: AgentEvent) => void)
        | undefined;
      onEvent?.({ type: 'started', sessionId: 'sess-1', timestamp: 'now' });
      onEvent?.({ type: 'tool_use', tool: 'read', toolUseId: 'u1', input: { path: '/a' } });
      onEvent?.({
        type: 'turn_complete',
        turnNumber: 1,
        usage: {
          inputTokens: 10,
          outputTokens: 5,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          totalTokens: 15,
        },
      });
      return {
        output: 'ok',
        sessionId: 'sess-1',
        completed: true,
        stopReason: 'complete',
        usage: {
          inputTokens: 10,
          outputTokens: 5,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          totalTokens: 15,
        },
        cost: { totalUsd: 0.001, perModel: {} },
        durationMs: 1,
        turns: 1,
      };
    };

    const wrapped = composed.wrap(inner);
    const result = await wrapped(oneshotPact(), { prompt: 'x' });
    assert.equal(result.completed, true);

    // Wait a tick so fire-and-forget promises settle.
    await new Promise(r => setImmediate(r));

    const types = events.map(e => e.eventType);
    assert.ok(types.includes('method.agent.started'));
    assert.ok(types.includes('method.agent.tool_use'));
    assert.ok(types.includes('method.agent.turn_complete'));
  });

  it('default suppress list elides text + thinking events', async () => {
    const { ctx, events } = makeAudit();
    const composed = cortexAuditMiddleware({ appId: 'my-app' }).compose({
      ctx: { audit: ctx },
      pact: oneshotPact(),
    });
    await composed.emit({ type: 'text', content: 'chunk' }, { prompt: '' });
    await composed.emit({ type: 'thinking', content: 'inner' }, { prompt: '' });
    await composed.emit(
      { type: 'started', sessionId: 's', timestamp: 't' },
      { prompt: '' },
    );
    const types = events.map(e => e.eventType);
    assert.ok(!types.includes('method.agent.text'));
    assert.ok(!types.includes('method.agent.thinking'));
    assert.ok(types.includes('method.agent.started'));
  });

  it('suppressEventTypes: [] emits text + thinking', async () => {
    const { ctx, events } = makeAudit();
    const composed = cortexAuditMiddleware({
      appId: 'my-app',
      suppressEventTypes: [],
    }).compose({ ctx: { audit: ctx }, pact: oneshotPact() });
    await composed.emit({ type: 'text', content: 'chunk' }, { prompt: '' });
    const types = events.map(e => e.eventType);
    assert.ok(types.includes('method.agent.text'));
  });

  it('ctx.audit failure does NOT break wrap()', async () => {
    const { ctx } = makeAudit({ throwOnEvent: true });
    const composed = cortexAuditMiddleware({ appId: 'my-app' }).compose({
      ctx: { audit: ctx },
      pact: oneshotPact(),
    });
    const inner = async (
      _p: Pact<unknown>,
      req: AgentRequest,
    ): Promise<AgentResult<unknown>> => {
      const onEvent = req.metadata?.onEvent as
        | ((e: AgentEvent) => void)
        | undefined;
      onEvent?.({ type: 'started', sessionId: 's', timestamp: 't' });
      return {
        output: 'ok',
        sessionId: 's',
        completed: true,
        stopReason: 'complete',
        usage: {
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          totalTokens: 0,
        },
        cost: { totalUsd: 0, perModel: {} },
        durationMs: 0,
        turns: 0,
      };
    };
    const wrapped = composed.wrap(inner);
    const result = await wrapped(oneshotPact(), { prompt: 'x' });
    // The inner completed successfully despite audit throwing.
    assert.equal(result.completed, true);
  });

  it('tool_result extract redacts output body (size only)', async () => {
    const { ctx, events } = makeAudit();
    const composed = cortexAuditMiddleware({ appId: 'my-app' }).compose({
      ctx: { audit: ctx },
      pact: oneshotPact(),
    });
    await composed.emit(
      {
        type: 'tool_result',
        tool: 'search',
        toolUseId: 'u1',
        output: { bigBlob: 'x'.repeat(1000) },
        durationMs: 42,
      },
      { prompt: '' },
    );
    const ev = events.find(e => e.eventType === 'method.agent.tool_result');
    assert.ok(ev);
    assert.ok(!('output' in (ev?.payload ?? {})));
    assert.ok(typeof ev?.payload.outputSizeBytes === 'number');
    assert.ok((ev?.payload.outputSizeBytes as number) > 100);
  });
});
