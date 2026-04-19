// SPDX-License-Identifier: Apache-2.0
/**
 * Unit tests for CognitiveSink (PRD 041 C-1).
 *
 * Covers all 9 CognitiveEvent algebra types → BridgeEvent mappings:
 *   cognitive:module_step              → cognitive.module_step   (info)
 *   cognitive:monitoring_signal        → cognitive.monitoring_signal (info)
 *   cognitive:control_directive        → cognitive.control_directive (info)
 *   cognitive:control_policy_violation → cognitive.control_policy_violation (warning)
 *   cognitive:workspace_write          → cognitive.workspace_write (info)
 *   cognitive:workspace_eviction       → cognitive.workspace_eviction (warning)
 *   cognitive:cycle_phase              → cognitive.cycle_phase   (info)
 *   cognitive:learn_failed             → cognitive.learn_failed  (warning)
 *   cognitive:cycle_aborted            → cognitive.cycle_aborted (error)
 *
 * Also covers: context forwarding (sessionId, experimentId, runId, cycleNumber),
 * setContext() mutation, EventSink.onEvent() is a no-op, and toBridgeEventInput() directly.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { CognitiveEventBusSink as CognitiveSink } from '../cognitive-sink.js';
import type { RuntimeEvent as BridgeEvent, RuntimeEventInput as BridgeEventInput, EventBus, EventFilter, EventSubscription } from '../../ports/event-bus.js';
import type { CognitiveEvent, MonitorMonitoring } from '@methodts/pacta';
import { moduleId } from '@methodts/pacta';

// ── Test helpers ───────────────────────────────────────────────────

/** Minimal in-process EventBus stub that records emitted events. */
function makeStubBus(): EventBus & { emitted: BridgeEventInput[] } {
  const emitted: BridgeEventInput[] = [];
  let seq = 0;

  return {
    emitted,
    emit(event: BridgeEventInput): BridgeEvent {
      emitted.push(event);
      return {
        ...event,
        id: `test-${++seq}`,
        timestamp: new Date().toISOString(),
        sequence: seq,
      } as BridgeEvent;
    },
    importEvent(_event: BridgeEvent): void { /* no-op */ },
    subscribe(_filter: EventFilter, _handler: (event: BridgeEvent) => void): EventSubscription {
      return { unsubscribe: () => { /* no-op */ } };
    },
    query(_filter: EventFilter): BridgeEvent[] { return []; },
    registerSink(): void { /* no-op */ },
  };
}

// ── Fixtures for each of the 9 CognitiveEvent types ───────────────

const moduleStepEvent: CognitiveEvent = {
  type: 'cognitive:module_step',
  moduleId: moduleId('reasoner-actor'),
  phase: 'execute',
  durationMs: 42,
  hasError: false,
  timestamp: 1000,
};

const monitorSignal: MonitorMonitoring = { source: moduleId('monitor'), timestamp: 1001, type: 'monitor', escalation: 'stagnation', anomalyDetected: true };
const monitoringSignalEvent: CognitiveEvent = {
  type: 'cognitive:monitoring_signal',
  signal: monitorSignal,
  timestamp: 1001,
};

const controlDirectiveEvent: CognitiveEvent = {
  type: 'cognitive:control_directive',
  directive: { target: moduleId('reasoner-actor'), timestamp: 1002 },
  timestamp: 1002,
};

const controlPolicyViolationEvent: CognitiveEvent = {
  type: 'cognitive:control_policy_violation',
  directive: { target: moduleId('reasoner-actor'), timestamp: 1003 },
  reason: 'impasse: repeated action with identical input',
  timestamp: 1003,
};

const workspaceWriteEvent: CognitiveEvent = {
  type: 'cognitive:workspace_write',
  entry: { source: moduleId('observer'), content: 'task context', salience: 0.9, timestamp: 1004 },
  timestamp: 1004,
};

const workspaceEvictionEvent: CognitiveEvent = {
  type: 'cognitive:workspace_eviction',
  entry: { source: moduleId('observer'), content: 'old context', salience: 0.2, timestamp: 1005 },
  reason: 'capacity',
  timestamp: 1005,
};

const cyclePhaseEvent: CognitiveEvent = {
  type: 'cognitive:cycle_phase',
  phase: 'start',
  cycleNumber: 3,
  timestamp: 1006,
};

const learnFailedEvent: CognitiveEvent = {
  type: 'cognitive:learn_failed',
  error: { message: 'LEARN phase failed', recoverable: false, moduleId: moduleId('reflector') },
  cycleNumber: 2,
  timestamp: 1007,
};

const cycleAbortedEvent: CognitiveEvent = {
  type: 'cognitive:cycle_aborted',
  reason: 'budget exhausted',
  phase: 'execute',
  cycleNumber: 5,
  timestamp: 1008,
};

// ── Tests ──────────────────────────────────────────────────────────

describe('CognitiveSink', () => {
  let bus: EventBus & { emitted: BridgeEventInput[] };
  let sink: CognitiveSink;

  beforeEach(() => {
    bus = makeStubBus();
    sink = new CognitiveSink(bus);
  });

  // ── EventSink interface ────────────────────────────────────────

  describe('EventSink interface', () => {
    it('has name = "cognitive"', () => {
      assert.equal(sink.name, 'cognitive');
    });

    it('onEvent is a no-op (producer only, no double-emission)', () => {
      const bridgeEvent: BridgeEvent = {
        id: 'evt-1', version: 1, timestamp: new Date().toISOString(), sequence: 1,
        domain: 'cognitive', type: 'cognitive.module_step', severity: 'info',
        payload: {}, source: 'test',
      };
      sink.onEvent(bridgeEvent);
      assert.equal(bus.emitted.length, 0, 'onEvent must not forward to bus (would double-emit)');
    });
  });

  // ── domain and type mapping ─────────────────────────────────────

  describe('domain = "cognitive" for all variants', () => {
    const allEvents: CognitiveEvent[] = [
      moduleStepEvent, monitoringSignalEvent, controlDirectiveEvent,
      controlPolicyViolationEvent, workspaceWriteEvent, workspaceEvictionEvent,
      cyclePhaseEvent, learnFailedEvent, cycleAbortedEvent,
    ];

    for (const event of allEvents) {
      it(`${event.type} → domain = 'cognitive'`, () => {
        sink.handle(event);
        assert.equal(bus.emitted.length, 1);
        assert.equal(bus.emitted[0].domain, 'cognitive');
      });

      beforeEach(() => {
        bus = makeStubBus();
        sink = new CognitiveSink(bus);
      });
    }
  });

  // ── Individual event type mappings ─────────────────────────────

  describe('cognitive:module_step → cognitive.module_step (info)', () => {
    it('maps type and severity correctly', () => {
      sink.handle(moduleStepEvent);
      assert.equal(bus.emitted.length, 1);
      const e = bus.emitted[0];
      assert.equal(e.type, 'cognitive.module_step');
      assert.equal(e.severity, 'info');
      assert.equal(e.source, 'runtime/sessions/cognitive-sink');
    });

    it('preserves all event fields in payload', () => {
      sink.handle(moduleStepEvent);
      const payload = bus.emitted[0].payload;
      assert.equal(payload.moduleId, moduleStepEvent.moduleId);
      assert.equal(payload.phase, 'execute');
      assert.equal(payload.durationMs, 42);
      assert.equal(payload.hasError, false);
      assert.equal(payload.timestamp, 1000);
    });
  });

  describe('cognitive:monitoring_signal → cognitive.monitoring_signal (info)', () => {
    it('maps type and severity correctly', () => {
      sink.handle(monitoringSignalEvent);
      assert.equal(bus.emitted.length, 1);
      const e = bus.emitted[0];
      assert.equal(e.type, 'cognitive.monitoring_signal');
      assert.equal(e.severity, 'info');
    });

    it('includes signal in payload', () => {
      sink.handle(monitoringSignalEvent);
      const payload = bus.emitted[0].payload;
      assert.ok(payload.signal, 'payload.signal must be present');
    });
  });

  describe('cognitive:control_directive → cognitive.control_directive (info)', () => {
    it('maps type and severity correctly', () => {
      sink.handle(controlDirectiveEvent);
      const e = bus.emitted[0];
      assert.equal(e.type, 'cognitive.control_directive');
      assert.equal(e.severity, 'info');
    });
  });

  describe('cognitive:control_policy_violation → cognitive.control_policy_violation (warning)', () => {
    it('maps type and severity correctly', () => {
      sink.handle(controlPolicyViolationEvent);
      const e = bus.emitted[0];
      assert.equal(e.type, 'cognitive.control_policy_violation');
      assert.equal(e.severity, 'warning');
    });

    it('includes reason in payload', () => {
      sink.handle(controlPolicyViolationEvent);
      const payload = bus.emitted[0].payload;
      assert.equal(payload.reason, 'impasse: repeated action with identical input');
    });
  });

  describe('cognitive:workspace_write → cognitive.workspace_write (info)', () => {
    it('maps type and severity correctly', () => {
      sink.handle(workspaceWriteEvent);
      const e = bus.emitted[0];
      assert.equal(e.type, 'cognitive.workspace_write');
      assert.equal(e.severity, 'info');
    });

    it('includes entry in payload', () => {
      sink.handle(workspaceWriteEvent);
      const payload = bus.emitted[0].payload;
      assert.ok(payload.entry, 'payload.entry must be present');
    });
  });

  describe('cognitive:workspace_eviction → cognitive.workspace_eviction (warning)', () => {
    it('maps type and severity correctly', () => {
      sink.handle(workspaceEvictionEvent);
      const e = bus.emitted[0];
      assert.equal(e.type, 'cognitive.workspace_eviction');
      assert.equal(e.severity, 'warning');
    });

    it('includes eviction reason in payload', () => {
      sink.handle(workspaceEvictionEvent);
      const payload = bus.emitted[0].payload;
      assert.equal(payload.reason, 'capacity');
    });
  });

  describe('cognitive:cycle_phase → cognitive.cycle_phase (info)', () => {
    it('maps type and severity correctly', () => {
      sink.handle(cyclePhaseEvent);
      const e = bus.emitted[0];
      assert.equal(e.type, 'cognitive.cycle_phase');
      assert.equal(e.severity, 'info');
    });

    it('surfaces cycleNumber in payload', () => {
      sink.handle(cyclePhaseEvent);
      const payload = bus.emitted[0].payload;
      assert.equal(payload.cycleNumber, 3);
      assert.equal(payload.phase, 'start');
    });
  });

  describe('cognitive:learn_failed → cognitive.learn_failed (warning)', () => {
    it('maps type and severity correctly', () => {
      sink.handle(learnFailedEvent);
      const e = bus.emitted[0];
      assert.equal(e.type, 'cognitive.learn_failed');
      assert.equal(e.severity, 'warning');
    });

    it('surfaces cycleNumber in payload', () => {
      sink.handle(learnFailedEvent);
      const payload = bus.emitted[0].payload;
      assert.equal(payload.cycleNumber, 2);
    });

    it('includes error in payload', () => {
      sink.handle(learnFailedEvent);
      const payload = bus.emitted[0].payload;
      assert.ok(payload.error, 'payload.error must be present');
    });
  });

  describe('cognitive:cycle_aborted → cognitive.cycle_aborted (error)', () => {
    it('maps type and severity correctly', () => {
      sink.handle(cycleAbortedEvent);
      const e = bus.emitted[0];
      assert.equal(e.type, 'cognitive.cycle_aborted');
      assert.equal(e.severity, 'error');
    });

    it('surfaces cycleNumber and reason in payload', () => {
      sink.handle(cycleAbortedEvent);
      const payload = bus.emitted[0].payload;
      assert.equal(payload.cycleNumber, 5);
      assert.equal(payload.reason, 'budget exhausted');
      assert.equal(payload.phase, 'execute');
    });
  });

  // ── Context forwarding ─────────────────────────────────────────

  describe('context forwarding', () => {
    it('forwards sessionId and projectId to emitted BridgeEvent', () => {
      const contextSink = new CognitiveSink(bus, { sessionId: 'sess-abc', projectId: 'proj-xyz' });
      contextSink.handle(moduleStepEvent);
      const e = bus.emitted[0];
      assert.equal(e.sessionId, 'sess-abc');
      assert.equal(e.projectId, 'proj-xyz');
    });

    it('forwards experimentId and runId in payload', () => {
      const contextSink = new CognitiveSink(bus, { experimentId: 'exp-001', runId: 'run-42' });
      contextSink.handle(cyclePhaseEvent);
      const payload = bus.emitted[0].payload;
      assert.equal(payload.experimentId, 'exp-001');
      assert.equal(payload.runId, 'run-42');
    });

    it('omits experimentId/runId from payload when not set', () => {
      sink.handle(moduleStepEvent);
      const payload = bus.emitted[0].payload;
      assert.ok(!('experimentId' in payload), 'experimentId must not be injected when not set');
      assert.ok(!('runId' in payload), 'runId must not be injected when not set');
    });

    it('setContext() updates forwarded fields for subsequent events', () => {
      sink.setContext({ sessionId: 'sess-new', experimentId: 'exp-updated' });
      sink.handle(moduleStepEvent);
      const e = bus.emitted[0];
      assert.equal(e.sessionId, 'sess-new');
      assert.equal(e.payload.experimentId, 'exp-updated');
    });

    it('cycleNumber from cycle_phase event is surfaced in payload', () => {
      sink.handle(cyclePhaseEvent);
      assert.equal(bus.emitted[0].payload.cycleNumber, 3);
    });

    it('cycleNumber from learn_failed event is surfaced in payload', () => {
      sink.handle(learnFailedEvent);
      assert.equal(bus.emitted[0].payload.cycleNumber, 2);
    });

    it('cycleNumber from cycle_aborted event is surfaced in payload', () => {
      sink.handle(cycleAbortedEvent);
      assert.equal(bus.emitted[0].payload.cycleNumber, 5);
    });
  });

  // ── toBridgeEventInput directly ────────────────────────────────

  describe('toBridgeEventInput()', () => {
    it('does not emit to bus — pure transformation', () => {
      sink.toBridgeEventInput(moduleStepEvent);
      assert.equal(bus.emitted.length, 0, 'toBridgeEventInput must not emit to bus');
    });

    it('returns correct domain/type/severity/source', () => {
      const result = sink.toBridgeEventInput(cycleAbortedEvent);
      assert.equal(result.domain, 'cognitive');
      assert.equal(result.type, 'cognitive.cycle_aborted');
      assert.equal(result.severity, 'error');
      assert.equal(result.source, 'runtime/sessions/cognitive-sink');
    });

    it('version is always 1', () => {
      const result = sink.toBridgeEventInput(moduleStepEvent);
      assert.equal(result.version, 1);
    });
  });
});
