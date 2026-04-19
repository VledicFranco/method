// SPDX-License-Identifier: Apache-2.0
/**
 * PRD 026 Phase 2: MCP Adapter Layer Tests
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { toChannelMessage, toAllEventsWrapper } from './adapters.js';
import type { RuntimeEvent } from '../ports/event-bus.js';

function makeRuntimeEvent(overrides?: Partial<RuntimeEvent>): RuntimeEvent {
  return {
    id: 'evt-001',
    version: 1,
    timestamp: '2026-03-24T15:00:00.000Z',
    sequence: 42,
    domain: 'strategy',
    type: 'strategy.completed',
    severity: 'info',
    payload: { execution_id: 'exec-1', status: 'completed', cost_usd: 0.05 },
    source: 'bridge/strategies/routes',
    ...overrides,
  };
}

describe('toChannelMessage', () => {
  it('maps RuntimeEvent fields to legacy channel shape', () => {
    const event = makeRuntimeEvent();
    const result = toChannelMessage(event);

    assert.equal(result.sequence, 42);
    assert.equal(result.timestamp, '2026-03-24T15:00:00.000Z');
    assert.equal(result.sender, 'bridge/strategies/routes');
    assert.equal(result.type, 'strategy.completed');
    assert.deepEqual(result.content, {
      execution_id: 'exec-1',
      status: 'completed',
      cost_usd: 0.05,
    });
  });

  it('preserves sessionId and projectId in payload if present', () => {
    const event = makeRuntimeEvent({
      sessionId: 'ses-1',
      projectId: 'proj-1',
      payload: { key: 'value' },
    });
    const result = toChannelMessage(event);
    assert.deepEqual(result.content, { key: 'value' });
    assert.equal(result.sender, 'bridge/strategies/routes');
  });
});

describe('toAllEventsWrapper', () => {
  it('wraps events in legacy all-events shape', () => {
    const events = [
      makeRuntimeEvent({ sequence: 1 }),
      makeRuntimeEvent({ sequence: 2, type: 'strategy.failed' }),
    ];
    const result = toAllEventsWrapper(events);

    assert.equal(result.messages.length, 2);
    assert.equal(result.last_sequence, 2);
    assert.equal(result.has_more, false);
    assert.equal(result.messages[0].type, 'strategy.completed');
    assert.equal(result.messages[1].type, 'strategy.failed');
  });

  it('returns zero last_sequence for empty events', () => {
    const result = toAllEventsWrapper([]);
    assert.equal(result.messages.length, 0);
    assert.equal(result.last_sequence, 0);
    assert.equal(result.has_more, false);
  });

  it('respects hasMore flag', () => {
    const events = [makeRuntimeEvent({ sequence: 10 })];
    const result = toAllEventsWrapper(events, true);
    assert.equal(result.has_more, true);
    assert.equal(result.last_sequence, 10);
  });
});
