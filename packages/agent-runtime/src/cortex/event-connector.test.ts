// SPDX-License-Identifier: Apache-2.0
/**
 * Integration tests for CortexEventConnector — PRD-063 §Tests.
 *
 * Success criteria mapped:
 *   S3 — allowedTopics enforcement + topic_undeclared emission
 *   S4 — fire-and-forget: ctx.events rejection never throws to caller
 *   N1 — back-pressure: 2000-event burst triggers degraded + recovered
 *   N3 — disconnect drain: up to 5s, remaining logged + dropped
 *   G-EVENTS-FIRE-AND-FORGET — no propagation to parent on publish failure
 *   Audit dual-write — permanent failures written to ctx.audit
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import type { RuntimeEvent } from '@methodts/runtime/ports';

import {
  CortexEventConnector,
  wrapPublishAsEmit,
} from './event-connector.js';
import type { CortexEventsCtx, CortexAuditFacade } from './ctx-types.js';

function ev(type: string, payload: Record<string, unknown> = {}): RuntimeEvent {
  return {
    id: `evt-${Math.random().toString(36).slice(2, 10)}`,
    version: 1,
    timestamp: new Date().toISOString(),
    sequence: 1,
    domain: 'session',
    type,
    severity: 'info',
    payload,
    source: 'test',
  };
}

function makeEventsCtx(
  impl?: (topic: string, payload: Readonly<Record<string, unknown>>) => unknown,
): { ctx: CortexEventsCtx; calls: Array<{ topic: string; payload: unknown }> } {
  const calls: Array<{ topic: string; payload: unknown }> = [];
  const ctx: CortexEventsCtx = {
    async emit(topic, payload) {
      calls.push({ topic, payload });
      if (impl) {
        const res = impl(topic, payload);
        if (res && typeof (res as Promise<unknown>).then === 'function') {
          const awaited = await (res as Promise<unknown>);
          if (awaited && typeof awaited === 'object' && 'eventId' in awaited) {
            return awaited as { eventId: string; subscriberCount: number };
          }
        } else if (res && typeof res === 'object' && 'eventId' in (res as object)) {
          return res as { eventId: string; subscriberCount: number };
        }
      }
      return { eventId: 'srv-id', subscriberCount: 1 };
    },
  };
  return { ctx, calls };
}

function makeAudit(): { audit: CortexAuditFacade; records: unknown[] } {
  const records: unknown[] = [];
  return {
    audit: { event: (e) => { records.push(e); } },
    records,
  };
}

const immediateDelay = (): Promise<void> => Promise.resolve();

describe('CortexEventConnector — construction', () => {
  it('rejects allowedTopics not in METHOD_TOPIC_REGISTRY', () => {
    const { ctx } = makeEventsCtx();
    assert.throws(
      () =>
        new CortexEventConnector(
          {
            appId: 'app',
            allowedTopics: new Set(['method.bogus.topic']),
          },
          ctx,
        ),
      /allowedTopics contains 1 topic/,
    );
  });

  it('connect + disconnect lifecycle', async () => {
    const { ctx } = makeEventsCtx();
    const c = new CortexEventConnector(
      { appId: 'app', allowedTopics: new Set(['method.session.started']) },
      ctx,
      { delay: immediateDelay },
    );
    assert.equal(c.health().connected, false);
    await c.connect();
    assert.equal(c.health().connected, true);
    await c.disconnect();
    assert.equal(c.health().connected, false);
  });
});

describe('CortexEventConnector — S3 allowedTopics enforcement', () => {
  it('drops unknown runtime-event types + emits connector.topic_undeclared once', async () => {
    const { ctx, calls } = makeEventsCtx();
    const localEmissions: string[] = [];
    const c = new CortexEventConnector(
      { appId: 'app', allowedTopics: new Set(['method.session.started']) },
      ctx,
      {
        delay: immediateDelay,
        localEmit: (e) => localEmissions.push(e.type),
      },
    );
    await c.connect();
    c.onEvent(ev('bogus.unknown'));
    c.onEvent(ev('bogus.unknown')); // second one shouldn't re-fire local
    assert.equal(calls.length, 0);
    assert.deepEqual(localEmissions, ['connector.topic_undeclared']);
    await c.disconnect();
  });

  it('drops mapped RuntimeEvent whose topic is not in allowedTopics', async () => {
    const { ctx, calls } = makeEventsCtx();
    const localEmissions: Array<{ type: string; payload: unknown }> = [];
    const c = new CortexEventConnector(
      { appId: 'app', allowedTopics: new Set(['method.session.started']) },
      ctx,
      {
        delay: immediateDelay,
        localEmit: (e) => localEmissions.push({ type: e.type, payload: e.payload }),
      },
    );
    await c.connect();
    c.onEvent(ev('strategy.started')); // mapped but NOT allowed
    assert.equal(calls.length, 0);
    assert.equal(localEmissions.length, 1);
    assert.equal(localEmissions[0].type, 'connector.topic_undeclared');
    await c.disconnect();
  });

  it('skips audit-only types entirely (no emit, no local event)', async () => {
    const { ctx, calls } = makeEventsCtx();
    const localEmissions: string[] = [];
    const c = new CortexEventConnector(
      { appId: 'app', allowedTopics: new Set(['method.session.started']) },
      ctx,
      { delay: immediateDelay, localEmit: (e) => localEmissions.push(e.type) },
    );
    await c.connect();
    c.onEvent(ev('agent.text'));
    assert.equal(calls.length, 0);
    assert.equal(localEmissions.length, 0);
    await c.disconnect();
  });
});

describe('CortexEventConnector — S4 fire-and-forget (G-EVENTS-FIRE-AND-FORGET)', () => {
  it('publish rejection never throws to caller', async () => {
    const { ctx } = makeEventsCtx(() => {
      throw Object.assign(new Error('boom'), { statusCode: 500 });
    });
    const c = new CortexEventConnector(
      {
        appId: 'app',
        allowedTopics: new Set(['method.session.started']),
        maxRetries: 0,
        retryBaseMs: 1,
      },
      ctx,
      { delay: immediateDelay },
    );
    await c.connect();
    // Should not throw, even though publish throws
    c.onEvent(ev('session.spawned'));
    // Give the microtask queue a chance to settle
    await new Promise((r) => setTimeout(r, 10));
    await c.disconnect();
  });
});

describe('CortexEventConnector — audit dual-write on permanent failure', () => {
  it('writes method.infrastructure.events_publish_failed on 4xx schema-rejected', async () => {
    const { ctx } = makeEventsCtx(() => {
      throw Object.assign(new Error('schema'), {
        statusCode: 400,
        reason: 'schema_rejected',
      });
    });
    const { audit, records } = makeAudit();
    const localEmissions: Array<{ type: string; payload: unknown }> = [];
    const c = new CortexEventConnector(
      {
        appId: 'app',
        allowedTopics: new Set(['method.session.started']),
        maxRetries: 0,
        retryBaseMs: 1,
      },
      ctx,
      { audit, delay: immediateDelay, localEmit: (e) => localEmissions.push(e) },
    );
    await c.connect();
    c.onEvent(ev('session.spawned'));
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(records.length, 1);
    const rec = records[0] as { eventType: string; payload: Record<string, unknown> };
    assert.equal(rec.eventType, 'method.infrastructure.events_publish_failed');
    assert.equal(rec.payload.reason, 'schema_rejected');
    assert.equal(rec.payload.statusCode, 400);

    // Local bus also sees connector.schema_rejected
    const localSchemas = localEmissions.filter((e) => e.type === 'connector.schema_rejected');
    assert.equal(localSchemas.length, 1);
    await c.disconnect();
  });

  it('does NOT write to audit when auditPublishFailures=false', async () => {
    const { ctx } = makeEventsCtx(() => {
      throw Object.assign(new Error('schema'), { statusCode: 400, reason: 'schema_rejected' });
    });
    const { audit, records } = makeAudit();
    const c = new CortexEventConnector(
      {
        appId: 'app',
        allowedTopics: new Set(['method.session.started']),
        maxRetries: 0,
        auditPublishFailures: false,
      },
      ctx,
      { audit, delay: immediateDelay },
    );
    await c.connect();
    c.onEvent(ev('session.spawned'));
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(records.length, 0);
    await c.disconnect();
  });
});

describe('CortexEventConnector — N1 back-pressure burst', () => {
  it('burst beyond buffer capacity triggers degraded emissions', async () => {
    // Use a frozen clock so the rate limiter stays stuck at 1/s; every
    // publish after the first goes to the buffer.
    const now = (): number => 1_000_000;
    // Each emit resolves immediately so no promise is left dangling.
    const { ctx, calls } = makeEventsCtx(() => ({ eventId: 'id', subscriberCount: 1 }));
    const local: Array<{ type: string; payload: unknown }> = [];
    const c = new CortexEventConnector(
      {
        appId: 'app',
        allowedTopics: new Set(['method.session.started']),
        bufferSize: 100,
        maxEventsPerSecond: 1,
        drainIntervalMs: 10,
      },
      ctx,
      { delay: immediateDelay, now, localEmit: (e) => local.push(e) },
    );
    await c.connect();
    // Rapid fire 150 events — at frozen clock, rate limiter permits
    // exactly one; the remaining 149 race through the buffer: 99 fit,
    // then overflow-evictions start. Buffer depth should cross 50% and
    // 90% on the way up.
    for (let i = 0; i < 150; i++) c.onEvent(ev('session.spawned'));
    // Allow a microtask flush.
    await new Promise((r) => setTimeout(r, 20));
    const degraded = local.filter((e) => e.type === 'connector.degraded');
    assert.ok(degraded.length >= 1, `expected degraded emissions, got ${degraded.length}`);
    assert.ok(calls.length >= 1);
    await c.disconnect();
  });

  it('drain under advancing clock publishes buffered events', async () => {
    // Clock advances → rate limiter yields tokens → drain loop
    // flushes buffer.
    let t = 1_000_000;
    const { ctx, calls } = makeEventsCtx(() => ({ eventId: 'id', subscriberCount: 1 }));
    const c = new CortexEventConnector(
      {
        appId: 'app',
        allowedTopics: new Set(['method.session.started']),
        bufferSize: 50,
        maxEventsPerSecond: 1000, // Generous cap so drain runs fast.
        drainIntervalMs: 5,
      },
      ctx,
      { delay: immediateDelay, now: () => t },
    );
    await c.connect();
    for (let i = 0; i < 30; i++) c.onEvent(ev('session.spawned'));
    // Advance clock and allow drain ticks.
    for (let step = 0; step < 5; step++) {
      t += 100;
      await new Promise((r) => setTimeout(r, 20));
    }
    await c.disconnect();
    assert.ok(calls.length >= 30, `expected ≥30 publishes, got ${calls.length}`);
  });
});

describe('CortexEventConnector — N3 disconnect drain', () => {
  it('disconnect drains buffered events within bounded time', async () => {
    const { ctx, calls } = makeEventsCtx();
    const c = new CortexEventConnector(
      {
        appId: 'app',
        allowedTopics: new Set(['method.session.started']),
        bufferSize: 10,
        maxEventsPerSecond: 1000,
        drainIntervalMs: 5,
        disconnectDrainMs: 500,
      },
      ctx,
      { delay: immediateDelay },
    );
    await c.connect();
    for (let i = 0; i < 5; i++) c.onEvent(ev('session.spawned'));
    await c.disconnect();
    // All 5 should have been published (rate limit 1000/s, no backpressure).
    assert.ok(calls.length >= 5, `expected ≥5 publishes, got ${calls.length}`);
  });
});

describe('wrapPublishAsEmit', () => {
  it('wraps a publish-only facade', async () => {
    const published: Array<{ topic: string; payload: unknown }> = [];
    const emit = wrapPublishAsEmit({
      publish(topic, payload) {
        published.push({ topic, payload });
      },
    });
    const res = await emit.emit('t', { a: 1 });
    assert.equal(published.length, 1);
    assert.equal(res.subscriberCount, -1);
  });
});
