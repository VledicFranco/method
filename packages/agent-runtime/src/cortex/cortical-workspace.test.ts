// SPDX-License-Identifier: Apache-2.0
/**
 * Tests for cortical-workspace helpers — PRD-068 §5 (S10 + S11).
 *
 * Gate A coverage:
 *   - G-S10-REGISTRY: every workspace topic present in METHOD_TOPIC_REGISTRY.
 *   - G-MANIFEST-GEN: generateCortexCognitiveEmitSection(['monitor']) produces
 *     the exact emit+on block the monitor sample ships.
 *   - G-S11-HANDSHAKE-DEFINED: join/heartbeat/leave emit the right topics.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  CORTICAL_WORKSPACE_TOPICS,
  CORTICAL_WORKSPACE_HEARTBEAT_INTERVAL_MS,
  CORTICAL_WORKSPACE_IMPLICIT_OFFLINE_MS,
  WAVE_1_MODULE_ROLES,
  cognitiveEmitTopics,
  cognitiveSubscribeTopics,
  createWorkspaceEventEmitter,
  generateCortexCognitiveEmitSection,
  withCorticalWorkspaceMembership,
} from './cortical-workspace.js';
import { makeMockCtx } from '../test-support/mock-ctx.js';

describe('G-S10-REGISTRY: cortical-workspace topic family', () => {
  it('registers 13 distinct method.cortex.workspace.* topics', () => {
    assert.equal(CORTICAL_WORKSPACE_TOPICS.length, 13);
    const set = new Set(CORTICAL_WORKSPACE_TOPICS.map((d) => d.topic));
    assert.equal(set.size, 13);
  });

  it('covers session + state + handshake + anomaly + plan + memory + degraded', () => {
    const expected = [
      'method.cortex.workspace.session_opened',
      'method.cortex.workspace.session_closed',
      'method.cortex.workspace.state',
      'method.cortex.workspace.anomaly',
      'method.cortex.workspace.confidence',
      'method.cortex.workspace.plan_updated',
      'method.cortex.workspace.goal',
      'method.cortex.workspace.memory_query',
      'method.cortex.workspace.memory_recalled',
      'method.cortex.workspace.memory_consolidated',
      'method.cortex.workspace.module_online',
      'method.cortex.workspace.module_offline',
      'method.cortex.workspace.degraded',
    ];
    const have = new Set(CORTICAL_WORKSPACE_TOPICS.map((d) => d.topic));
    for (const t of expected) assert.ok(have.has(t), `missing ${t}`);
  });
});

describe('G-MANIFEST-GEN: role-based emit + on sections', () => {
  it('monitor role emits anomaly/confidence/handshake/degraded', () => {
    const emits = cognitiveEmitTopics(['monitor']);
    assert.ok(emits.has('method.cortex.workspace.anomaly'));
    assert.ok(emits.has('method.cortex.workspace.confidence'));
    assert.ok(emits.has('method.cortex.workspace.module_online'));
    assert.ok(emits.has('method.cortex.workspace.module_offline'));
    assert.ok(emits.has('method.cortex.workspace.degraded'));
    // Monitor does NOT emit plan_updated or memory_*.
    assert.ok(!emits.has('method.cortex.workspace.plan_updated'));
    assert.ok(!emits.has('method.cortex.workspace.memory_recalled'));
  });

  it('monitor role subscribes to state/plan_updated/handshake/session', () => {
    const on = cognitiveSubscribeTopics(['monitor']);
    assert.ok(on.has('method.cortex.workspace.state'));
    assert.ok(on.has('method.cortex.workspace.plan_updated'));
    assert.ok(on.has('method.cortex.workspace.session_opened'));
    assert.ok(on.has('method.cortex.workspace.session_closed'));
    assert.ok(on.has('method.cortex.workspace.module_online'));
  });

  it('planner role emits plan_updated + goal + memory_query + handshake', () => {
    const emits = cognitiveEmitTopics(['planner']);
    assert.ok(emits.has('method.cortex.workspace.plan_updated'));
    assert.ok(emits.has('method.cortex.workspace.goal'));
    assert.ok(emits.has('method.cortex.workspace.memory_query'));
    assert.ok(emits.has('method.cortex.workspace.module_online'));
  });

  it('memory role emits memory_recalled + memory_consolidated', () => {
    const emits = cognitiveEmitTopics(['memory']);
    assert.ok(emits.has('method.cortex.workspace.memory_recalled'));
    assert.ok(emits.has('method.cortex.workspace.memory_consolidated'));
    assert.ok(!emits.has('method.cortex.workspace.plan_updated'));
  });

  it('generateCortexCognitiveEmitSection(["monitor"]) produces a stable shape', () => {
    const { emit, on } = generateCortexCognitiveEmitSection(['monitor']);
    const emitTypes = emit.map((e) => e.type).sort();
    assert.deepEqual(emitTypes, [
      'method.cortex.workspace.anomaly',
      'method.cortex.workspace.confidence',
      'method.cortex.workspace.degraded',
      'method.cortex.workspace.module_offline',
      'method.cortex.workspace.module_online',
    ]);
    const onTypes = on.map((e) => e.type).sort();
    assert.deepEqual(onTypes, [
      'method.cortex.workspace.module_offline',
      'method.cortex.workspace.module_online',
      'method.cortex.workspace.plan_updated',
      'method.cortex.workspace.session_closed',
      'method.cortex.workspace.session_opened',
      'method.cortex.workspace.state',
    ]);
    // emit entries carry schema paths + schemaVersion.
    for (const e of emit) {
      assert.equal(e.schemaVersion, 1);
      assert.ok(e.schema.length > 0);
    }
  });

  it('unions correctly across multiple roles', () => {
    const { emit, on } = generateCortexCognitiveEmitSection([
      'monitor',
      'planner',
    ]);
    const emitTypes = new Set(emit.map((e) => e.type));
    // Monitor-only
    assert.ok(emitTypes.has('method.cortex.workspace.anomaly'));
    // Planner-only
    assert.ok(emitTypes.has('method.cortex.workspace.plan_updated'));
    // Shared handshake
    assert.ok(emitTypes.has('method.cortex.workspace.module_online'));

    const onTypes = new Set(on.map((e) => e.type));
    assert.ok(onTypes.has('method.cortex.workspace.anomaly'));
    assert.ok(onTypes.has('method.cortex.workspace.confidence'));
  });

  it('empty role list produces empty emit+on', () => {
    const { emit, on } = generateCortexCognitiveEmitSection([]);
    assert.equal(emit.length, 0);
    assert.equal(on.length, 0);
  });
});

describe('G-S11-HANDSHAKE-DEFINED: join/heartbeat/leave via ctx.events', () => {
  it('join() emits module_online exactly once until leave()', async () => {
    const { ctx, spies } = makeMockCtx({ includeEvents: true, appId: 'monitor-1' });
    const h = withCorticalWorkspaceMembership({
      ctx,
      moduleRole: 'monitor',
      version: '0.0.1',
      capabilities: ['anomaly-detection'],
    });
    await h.join();
    await h.join(); // idempotent
    assert.equal(spies.eventsPublish.callCount(), 1);
    const [topic, payload] = spies.eventsPublish.calls[0];
    assert.equal(topic, 'method.cortex.workspace.module_online');
    const p = payload as Record<string, unknown>;
    assert.equal(p.moduleRole, 'monitor');
    assert.equal(p.appId, 'monitor-1');
    assert.equal(p.version, '0.0.1');
    assert.deepEqual(p.capabilities, ['anomaly-detection']);
    assert.equal(typeof p.at, 'number');
  });

  it('tickHeartbeat() re-emits module_online each call', async () => {
    const { ctx, spies } = makeMockCtx({ includeEvents: true });
    const h = withCorticalWorkspaceMembership({
      ctx,
      moduleRole: 'planner',
      version: '0.1',
    });
    await h.join();
    await h.tickHeartbeat();
    await h.tickHeartbeat();
    assert.equal(spies.eventsPublish.callCount(), 3);
    for (const [topic] of spies.eventsPublish.calls) {
      assert.equal(topic, 'method.cortex.workspace.module_online');
    }
  });

  it('leave() emits module_offline with reason=graceful and suppresses future heartbeats', async () => {
    const { ctx, spies } = makeMockCtx({ includeEvents: true });
    const h = withCorticalWorkspaceMembership({
      ctx,
      moduleRole: 'memory',
      version: '0.1',
    });
    await h.join();
    await h.leave();
    await h.leave(); // idempotent
    await h.tickHeartbeat(); // no-op post-leave
    assert.equal(h.isLeft, true);
    assert.equal(spies.eventsPublish.callCount(), 2);
    const [lastTopic, lastPayload] = spies.eventsPublish.calls[1];
    assert.equal(lastTopic, 'method.cortex.workspace.module_offline');
    assert.equal((lastPayload as Record<string, unknown>).reason, 'graceful');
  });

  it('missing ctx.events does not throw — handshake is best-effort', async () => {
    const { ctx } = makeMockCtx({ includeEvents: false });
    const h = withCorticalWorkspaceMembership({
      ctx,
      moduleRole: 'monitor',
      version: '0.1',
    });
    await h.join();
    await h.tickHeartbeat();
    await h.leave();
    // No crash; membership handle reports left=true regardless.
    assert.equal(h.isLeft, true);
  });

  it('30s heartbeat constant matches 3x implicit-offline window', () => {
    assert.equal(CORTICAL_WORKSPACE_HEARTBEAT_INTERVAL_MS, 30_000);
    assert.equal(CORTICAL_WORKSPACE_IMPLICIT_OFFLINE_MS, 90_000);
    assert.equal(
      CORTICAL_WORKSPACE_IMPLICIT_OFFLINE_MS,
      3 * CORTICAL_WORKSPACE_HEARTBEAT_INTERVAL_MS,
    );
  });
});

describe('createWorkspaceEventEmitter — trace-scoped publish', () => {
  it('injects traceId and rejects non-workspace topics', async () => {
    const { ctx, spies } = makeMockCtx({ includeEvents: true });
    const emitter = createWorkspaceEventEmitter(ctx);
    await emitter.emit('method.cortex.workspace.state', 'trace-a', {
      stateSnapshot: { step: 1 },
    });
    assert.equal(spies.eventsPublish.callCount(), 1);
    const [topic, payload] = spies.eventsPublish.calls[0];
    assert.equal(topic, 'method.cortex.workspace.state');
    assert.equal((payload as Record<string, unknown>).traceId, 'trace-a');

    await assert.rejects(
      () => emitter.emit('method.agent.completed', 'x', {}),
      /refusing to publish non-workspace topic/,
    );
  });

  it('drops emit silently when ctx.events absent', async () => {
    const { ctx, spies } = makeMockCtx({ includeEvents: false });
    const emitter = createWorkspaceEventEmitter(ctx);
    await emitter.emit('method.cortex.workspace.anomaly', 't1', { severity: 1 });
    assert.equal(spies.eventsPublish.callCount(), 0);
  });
});

describe('WAVE_1_MODULE_ROLES constant', () => {
  it('lists monitor, planner, memory in that order', () => {
    assert.deepEqual([...WAVE_1_MODULE_ROLES], ['monitor', 'planner', 'memory']);
  });
});
