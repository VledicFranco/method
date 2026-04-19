// SPDX-License-Identifier: Apache-2.0
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EventRelay, type RelayableEvent } from './event-relay.js';
import { FakeNetwork } from '../test-doubles/fake-network.js';
import type { ClusterNode, ResourceSnapshot } from '../types.js';

// ── Helpers ────────────────────────────────────────────────────

function makeResources(overrides: Partial<ResourceSnapshot> = {}): ResourceSnapshot {
  return {
    nodeId: 'node',
    instanceName: 'test',
    cpuCount: 4,
    cpuLoadPercent: 20,
    memoryTotalMb: 8192,
    memoryAvailableMb: 4096,
    sessionsActive: 1,
    sessionsMax: 10,
    projectCount: 3,
    uptimeMs: 60000,
    version: '0.1.0',
    ...overrides,
  };
}

function makePeer(id: string, overrides: Partial<ClusterNode> = {}): ClusterNode {
  return {
    nodeId: id,
    instanceName: `peer-${id}`,
    address: { host: `${id}.ts.net`, port: 3456 },
    resources: makeResources({ nodeId: id, instanceName: `peer-${id}` }),
    status: 'alive',
    lastSeen: Date.now(),
    projects: [],
    ...overrides,
  };
}

function makeEvent(overrides: Partial<RelayableEvent> = {}): RelayableEvent {
  return {
    domain: 'sessions',
    severity: 'warning',
    timestamp: Date.now(),
    payload: { message: 'test event' },
    ...overrides,
  };
}

const SOURCE_NODE_ID = 'self-node';

// ── Tests ──────────────────────────────────────────────────────

describe('EventRelay', () => {
  // 1. Local event matching filter → relayed to all alive peers
  it('relays a local event matching the severity filter to all alive peers', async () => {
    const network = new FakeNetwork();
    const relay = new EventRelay(network);

    const event = makeEvent({ severity: 'error', domain: 'strategies' });
    const peers = [makePeer('peer-a'), makePeer('peer-b')];

    await relay.relay(event, SOURCE_NODE_ID, peers);

    assert.equal(network.sent.length, 2, 'should send to both alive peers');

    // Verify the message structure
    const msg = network.sent[0]!.message;
    assert.equal(msg.type, 'event-relay');
    assert.equal(msg.from, SOURCE_NODE_ID);

    if (msg.type === 'event-relay') {
      assert.equal(msg.events.length, 1);
      assert.equal(msg.events[0]!.sourceNodeId, SOURCE_NODE_ID);
      assert.equal(msg.events[0]!.severity, 'error');
      assert.equal(msg.events[0]!.domain, 'strategies');
    }

    // Verify sent to correct peers
    const sentHosts = network.sent.map(s => s.peer.host);
    assert.ok(sentHosts.includes('peer-a.ts.net'));
    assert.ok(sentHosts.includes('peer-b.ts.net'));
  });

  // 2. Federated event (federated: true) → NOT re-relayed (loop prevention)
  it('does not re-relay events already marked as federated', async () => {
    const network = new FakeNetwork();
    const relay = new EventRelay(network);

    const event = makeEvent({
      severity: 'error',
      federated: true,
      sourceNodeId: 'remote-node',
    });
    const peers = [makePeer('peer-a')];

    await relay.relay(event, SOURCE_NODE_ID, peers);

    assert.equal(network.sent.length, 0, 'should not relay a federated event');

    // Verify shouldRelay returns false
    assert.equal(relay.shouldRelay(event), false);
  });

  // 3. Event below severity filter → not relayed
  it('does not relay events below the severity filter threshold', async () => {
    const network = new FakeNetwork();
    const relay = new EventRelay(network, {
      severityFilter: ['warning', 'error', 'critical'],
    });

    const event = makeEvent({ severity: 'info' });
    const peers = [makePeer('peer-a')];

    await relay.relay(event, SOURCE_NODE_ID, peers);

    assert.equal(network.sent.length, 0, 'info event should not be relayed with warning+ filter');

    // Also check debug
    const debugEvent = makeEvent({ severity: 'debug' });
    assert.equal(relay.shouldRelay(debugEvent), false);
  });

  // 4. No alive peers → events dropped silently (no error)
  it('silently drops events when no alive peers exist', async () => {
    const network = new FakeNetwork();
    const relay = new EventRelay(network);

    const event = makeEvent({ severity: 'critical' });
    const peers = [
      makePeer('peer-a', { status: 'dead' }),
      makePeer('peer-b', { status: 'draining' }),
    ];

    // Should not throw
    await relay.relay(event, SOURCE_NODE_ID, peers);

    assert.equal(network.sent.length, 0, 'should send nothing when no alive peers');
  });
});
