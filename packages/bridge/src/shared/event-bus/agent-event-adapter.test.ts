/**
 * Unit tests for AgentEvent-to-BridgeEvent adapter (PRD 029 Phase C-2).
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createAgentEventAdapter } from './agent-event-adapter.js';
import type { AgentEvent } from '@method/pacta';
import type { BridgeEvent, BridgeEventInput, EventBus, EventFilter, EventSink, EventSubscription } from '../../ports/event-bus.js';

// ── Mock EventBus ─────────────────────────────────────────────────

function createMockBus(): EventBus & { emitted: BridgeEvent[] } {
  let seq = 0;
  const emitted: BridgeEvent[] = [];

  return {
    emitted,
    emit(input: BridgeEventInput): BridgeEvent {
      seq++;
      const event: BridgeEvent = {
        ...input,
        id: `evt-${seq}`,
        timestamp: new Date().toISOString(),
        sequence: seq,
      };
      emitted.push(event);
      return event;
    },
    importEvent(_event: BridgeEvent): void {},
    subscribe(_filter: EventFilter, _handler: (event: BridgeEvent) => void): EventSubscription {
      return { unsubscribe: () => {} };
    },
    query(_filter: EventFilter): BridgeEvent[] { return []; },
    registerSink(_sink: EventSink): void {},
  };
}

// ── Tests ──────────────────────────────────────────────────────

describe('createAgentEventAdapter', () => {
  let bus: ReturnType<typeof createMockBus>;
  let onEvent: (event: AgentEvent) => void;

  const SESSION_ID = 'sess-abc';
  const PROJECT_ID = 'proj-123';

  beforeEach(() => {
    bus = createMockBus();
    onEvent = createAgentEventAdapter(bus, SESSION_ID, PROJECT_ID);
  });

  describe('type mapping', () => {
    it('maps started to agent.started', () => {
      onEvent({ type: 'started', sessionId: 'pacta-sess', timestamp: new Date().toISOString() });

      assert.equal(bus.emitted.length, 1);
      assert.equal(bus.emitted[0].type, 'agent.started');
    });

    it('maps text to agent.text', () => {
      onEvent({ type: 'text', content: 'hello' });

      assert.equal(bus.emitted[0].type, 'agent.text');
    });

    it('maps thinking to agent.thinking', () => {
      onEvent({ type: 'thinking', content: 'reasoning...' });

      assert.equal(bus.emitted[0].type, 'agent.thinking');
    });

    it('maps tool_use to agent.tool_use', () => {
      onEvent({ type: 'tool_use', tool: 'read', input: {}, toolUseId: 'tu-1' });

      assert.equal(bus.emitted[0].type, 'agent.tool_use');
    });

    it('maps tool_result to agent.tool_result', () => {
      onEvent({ type: 'tool_result', tool: 'read', output: 'data', toolUseId: 'tu-1', durationMs: 100 });

      assert.equal(bus.emitted[0].type, 'agent.tool_result');
    });

    it('maps turn_complete to agent.turn_complete', () => {
      onEvent({
        type: 'turn_complete',
        turnNumber: 3,
        usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150, cacheReadTokens: 0, cacheWriteTokens: 0 },
      });

      assert.equal(bus.emitted[0].type, 'agent.turn_complete');
    });

    it('maps context_compacted to agent.context_compacted', () => {
      onEvent({ type: 'context_compacted', fromTokens: 50000, toTokens: 10000 });

      assert.equal(bus.emitted[0].type, 'agent.context_compacted');
    });

    it('maps reflection to agent.reflection', () => {
      onEvent({ type: 'reflection', trial: 2, critique: 'needs improvement' });

      assert.equal(bus.emitted[0].type, 'agent.reflection');
    });

    it('maps budget_warning to agent.budget_warning', () => {
      onEvent({ type: 'budget_warning', resource: 'tokens', consumed: 80000, limit: 100000, percentUsed: 80 });

      assert.equal(bus.emitted[0].type, 'agent.budget_warning');
    });

    it('maps budget_exhausted to agent.budget_exhausted', () => {
      onEvent({ type: 'budget_exhausted', resource: 'cost', consumed: 10, limit: 10 });

      assert.equal(bus.emitted[0].type, 'agent.budget_exhausted');
    });

    it('maps error to agent.error', () => {
      onEvent({ type: 'error', message: 'API failure', recoverable: true });

      assert.equal(bus.emitted[0].type, 'agent.error');
    });

    it('maps completed to agent.completed', () => {
      onEvent({
        type: 'completed',
        result: { answer: 42 },
        usage: { inputTokens: 1000, outputTokens: 500, totalTokens: 1500, cacheReadTokens: 0, cacheWriteTokens: 0 },
        cost: { totalUsd: 0.03, perModel: {} },
        durationMs: 5000,
        turns: 3,
      });

      assert.equal(bus.emitted[0].type, 'agent.completed');
    });
  });

  describe('domain', () => {
    it('sets domain to agent for all events', () => {
      onEvent({ type: 'started', sessionId: 'x', timestamp: new Date().toISOString() });
      onEvent({ type: 'text', content: 'hi' });
      onEvent({ type: 'error', message: 'fail', recoverable: false });

      for (const e of bus.emitted) {
        assert.equal(e.domain, 'agent');
      }
    });
  });

  describe('severity mapping', () => {
    it('maps error type to error severity', () => {
      onEvent({ type: 'error', message: 'fail', recoverable: false });

      assert.equal(bus.emitted[0].severity, 'error');
    });

    it('maps budget_exhausted to error severity', () => {
      onEvent({ type: 'budget_exhausted', resource: 'tokens', consumed: 100, limit: 100 });

      assert.equal(bus.emitted[0].severity, 'error');
    });

    it('maps budget_warning to warning severity', () => {
      onEvent({ type: 'budget_warning', resource: 'cost', consumed: 8, limit: 10, percentUsed: 80 });

      assert.equal(bus.emitted[0].severity, 'warning');
    });

    it('maps other types to info severity', () => {
      onEvent({ type: 'started', sessionId: 'x', timestamp: new Date().toISOString() });
      assert.equal(bus.emitted[0].severity, 'info');

      onEvent({ type: 'text', content: 'hi' });
      assert.equal(bus.emitted[1].severity, 'info');

      onEvent({ type: 'completed', result: null, usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 }, cost: { totalUsd: 0, perModel: {} }, durationMs: 0, turns: 0 });
      assert.equal(bus.emitted[2].severity, 'info');

      onEvent({ type: 'tool_use', tool: 'x', input: {}, toolUseId: 'tu-1' });
      assert.equal(bus.emitted[3].severity, 'info');
    });
  });

  describe('session and project attachment', () => {
    it('attaches sessionId to the BridgeEvent', () => {
      onEvent({ type: 'text', content: 'hi' });

      assert.equal(bus.emitted[0].sessionId, SESSION_ID);
    });

    it('attaches projectId to the BridgeEvent', () => {
      onEvent({ type: 'text', content: 'hi' });

      assert.equal(bus.emitted[0].projectId, PROJECT_ID);
    });

    it('includes sessionId and projectId in the payload', () => {
      onEvent({ type: 'text', content: 'hi' });

      assert.equal(bus.emitted[0].payload.sessionId, SESSION_ID);
      assert.equal(bus.emitted[0].payload.projectId, PROJECT_ID);
    });
  });

  describe('payload passthrough', () => {
    it('includes original AgentEvent data in payload', () => {
      onEvent({ type: 'tool_use', tool: 'bash', input: { cmd: 'ls' }, toolUseId: 'tu-99' });

      const payload = bus.emitted[0].payload;
      assert.equal(payload.tool, 'bash');
      assert.equal(payload.toolUseId, 'tu-99');
      assert.deepEqual(payload.input, { cmd: 'ls' });
    });
  });

  describe('source', () => {
    it('sets source to bridge/agent/{sessionId}', () => {
      onEvent({ type: 'text', content: 'hi' });

      assert.equal(bus.emitted[0].source, `bridge/agent/${SESSION_ID}`);
    });
  });
});
