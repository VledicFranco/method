// SPDX-License-Identifier: Apache-2.0
/**
 * Unit tests for the default CheckpointSink impl.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { createCheckpointSink } from './checkpoint-sink-impl.js';
import { createInMemorySessionStore } from './in-memory-session-store.js';
import type { CheckpointCapture } from '../../ports/checkpoint-sink.js';
import type { RuntimeEvent } from '../../ports/event-bus.js';
import type { SessionSnapshot } from '../../ports/session-store-types.js';

function snap(id: string): SessionSnapshot {
  return {
    schemaVersion: 1,
    sessionId: id,
    scopeId: 'app_test',
    pactRef: { id: 'p', version: '1.0.0', fingerprint: 'sha256:x' },
    status: 'running',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    latestCheckpointSequence: null,
    depth: 0,
  };
}

function event(sessionId: string, type: string): RuntimeEvent {
  return {
    id: 'evt_' + Math.random().toString(36).slice(2),
    version: 1,
    timestamp: new Date().toISOString(),
    sequence: 1,
    domain: 'session',
    type,
    severity: 'info',
    sessionId,
    payload: {},
    source: 'test',
  };
}

const capture: CheckpointCapture = {
  sessionId: 'ses_1',
  eventCursor: { sequence: 1, id: 'evt_1' },
  agentState: { kind: 'inline', data: {} },
  pendingBudget: null,
  nextAction: { kind: 'await-prompt' },
};

describe('CheckpointSink — debounced per-turn writes', () => {
  it('writes one checkpoint per debounce window', async () => {
    const store = createInMemorySessionStore();
    await store.create(snap('ses_1'));
    const rc = await store.resume('ses_1', 'worker-a');

    const sink = createCheckpointSink({
      store,
      workerId: () => 'worker-a',
      fencingToken: () => rc.fencingToken,
      captureSnapshot: async () => capture,
      debounceMs: 5,
    });

    sink.onEvent(event('ses_1', 'session.spawned'));
    sink.onEvent(event('ses_1', 'session.state_changed'));
    sink.onEvent(event('ses_1', 'session.prompt.completed'));

    await new Promise(r => setTimeout(r, 30));
    await sink.flush();

    const latest = await store.loadLatestCheckpoint('ses_1');
    assert.ok(latest);
    assert.equal(latest?.sequence, 1); // all three events collapsed into one checkpoint
    sink.dispose();
  });

  it('ignores events without a fencing token (no active lease)', async () => {
    const store = createInMemorySessionStore();
    await store.create(snap('ses_2'));

    const sink = createCheckpointSink({
      store,
      workerId: () => 'worker-a',
      fencingToken: () => null,
      captureSnapshot: async () => ({ ...capture, sessionId: 'ses_2' }),
      debounceMs: 5,
    });
    sink.onEvent(event('ses_2', 'session.spawned'));
    await sink.flush();
    assert.equal(await store.loadLatestCheckpoint('ses_2'), null);
    sink.dispose();
  });

  it('skips non-lifecycle events by default', async () => {
    const store = createInMemorySessionStore();
    await store.create(snap('ses_3'));
    const rc = await store.resume('ses_3', 'worker-a');
    const sink = createCheckpointSink({
      store,
      workerId: () => 'worker-a',
      fencingToken: () => rc.fencingToken,
      captureSnapshot: async () => ({ ...capture, sessionId: 'ses_3' }),
      debounceMs: 5,
    });
    sink.onEvent(event('ses_3', 'strategy.node.started'));
    await new Promise(r => setTimeout(r, 15));
    await sink.flush();
    assert.equal(await store.loadLatestCheckpoint('ses_3'), null);
    sink.dispose();
  });

  it('checkpointOnEvent triggers immediate writes on match', async () => {
    const store = createInMemorySessionStore();
    await store.create(snap('ses_4'));
    const rc = await store.resume('ses_4', 'worker-a');
    let captured = 0;
    const sink = createCheckpointSink({
      store,
      workerId: () => 'worker-a',
      fencingToken: () => rc.fencingToken,
      captureSnapshot: async () => {
        captured += 1;
        return { ...capture, sessionId: 'ses_4' };
      },
      debounceMs: 500,
    });
    sink.checkpointOnEvent({ type: 'tool.*' });
    sink.onEvent(event('ses_4', 'tool.invoked'));
    // Give the microtask queue a chance to flush the immediate write.
    await new Promise(r => setImmediate(r));
    await sink.flush();
    assert.ok(captured >= 1);
    const latest = await store.loadLatestCheckpoint('ses_4');
    assert.ok(latest);
    sink.dispose();
  });

  it('dispose() clears pending timers', () => {
    const store = createInMemorySessionStore();
    const sink = createCheckpointSink({
      store,
      workerId: () => 'worker',
      fencingToken: () => 'ft',
      captureSnapshot: async () => null,
      debounceMs: 5_000,
    });
    sink.onEvent(event('ses_5', 'session.spawned'));
    assert.equal(sink.pendingCount, 1);
    sink.dispose();
    assert.equal(sink.pendingCount, 0);
  });
});
