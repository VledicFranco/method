// SPDX-License-Identifier: Apache-2.0
/**
 * Cluster Federation Sink — Tests.
 *
 * Validates that ClusterFederationSink correctly:
 * 1. Relays local events matching severity filters to alive peers via EventRelay.
 * 2. Skips events that are already federated (loop prevention).
 * 3. Is backward compatible — adding federation fields to BridgeEvent
 *    does not break existing sinks that ignore those fields.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  FakeDiscovery,
  FakeNetwork,
  FakeResources,
  EventRelay,
  type ClusterNode,
} from '@methodts/cluster';
import { ClusterDomain, type ClusterLogger } from './core.js';
import { ClusterFederationSink } from './federation-sink.js';
import type { ClusterConfig } from './config.js';
import type { BridgeEvent, EventSink } from '../../ports/event-bus.js';

// ── Helpers ────────────────────────────────────────────────────

function makeConfig(overrides: Partial<ClusterConfig> = {}): ClusterConfig {
  return {
    enabled: true,
    nodeId: 'federation-test-node',
    seeds: '',
    heartbeatMs: 100,
    suspectTimeoutMs: 300,
    stateBroadcastMs: 500,
    federationEnabled: true,
    federationFilterSeverity: 'warning,error,critical',
    federationFilterDomain: '',
    ...overrides,
  };
}

function makeLogger(): ClusterLogger {
  return {
    info() {},
    warn() {},
    error() {},
  };
}

function makePeerNode(id: string): ClusterNode {
  return {
    nodeId: id,
    instanceName: `peer-${id}`,
    address: { host: `${id}.ts.net`, port: 3456 },
    resources: {
      nodeId: id,
      instanceName: `peer-${id}`,
      cpuCount: 4,
      cpuLoadPercent: 20,
      memoryTotalMb: 8192,
      memoryAvailableMb: 4096,
      sessionsActive: 1,
      sessionsMax: 10,
      projectCount: 5,
      uptimeMs: 30000,
      version: '0.1.0',
    },
    status: 'alive',
    lastSeen: Date.now(),
    projects: [],
  };
}

function makeBridgeEvent(overrides: Partial<BridgeEvent> = {}): BridgeEvent {
  return {
    id: 'evt-001',
    version: 1,
    timestamp: new Date().toISOString(),
    sequence: 1,
    domain: 'session',
    type: 'session.error',
    severity: 'error',
    payload: { message: 'test error' },
    source: 'bridge/test',
    ...overrides,
  };
}

// ── Tests ──────────────────────────────────────────────────────

describe('ClusterFederationSink', () => {

  // 1. Local event matching severity filter is relayed to alive peers
  it('relays local event matching severity filter to alive peers via EventRelay', async () => {
    const network = new FakeNetwork();
    const discovery = new FakeDiscovery();
    const resources = new FakeResources({ nodeId: 'federation-test-node', instanceName: 'test' });

    const config = makeConfig();
    const domain = new ClusterDomain(config, { discovery, network, resources }, makeLogger());
    await domain.start();

    try {
      // Add an alive peer so relay has a target
      domain.getManager()!.handleJoin(makePeerNode('peer-alpha'));

      // Create EventRelay with federation enabled and matching severity filter
      const relay = new EventRelay(network, {
        federationEnabled: true,
        severityFilter: ['warning', 'error', 'critical'],
        domainFilter: [],
      });

      const sink = new ClusterFederationSink(relay, domain, 'federation-test-node');

      // Verify it implements EventSink interface
      assert.equal(sink.name, 'cluster-federation');
      assert.equal(typeof sink.onEvent, 'function');

      // Emit a local error event (should be relayed)
      const event = makeBridgeEvent({ severity: 'error' });
      await sink.onEvent(event);

      // FakeNetwork records sent messages in .sent — verify relay happened
      assert.ok(network.sent.length > 0, 'Expected at least one message sent to peers');

      const relayMsg = network.sent[0];
      assert.equal(relayMsg.message.type, 'event-relay');
      assert.equal((relayMsg.message as { from: string }).from, 'federation-test-node');
      const events = (relayMsg.message as { events: Array<{ severity: string; sourceNodeId: string }> }).events;
      assert.ok(Array.isArray(events));
      assert.equal(events.length, 1);
      assert.equal(events[0].severity, 'error');
      assert.equal(events[0].sourceNodeId, 'federation-test-node');
    } finally {
      await domain.stop();
    }
  });

  // 2. Federated event (federated: true) is NOT relayed (loop prevention)
  it('does not relay events that are already federated (loop prevention)', async () => {
    const network = new FakeNetwork();
    const discovery = new FakeDiscovery();
    const resources = new FakeResources({ nodeId: 'federation-test-node', instanceName: 'test' });

    const config = makeConfig();
    const domain = new ClusterDomain(config, { discovery, network, resources }, makeLogger());
    await domain.start();

    try {
      domain.getManager()!.handleJoin(makePeerNode('peer-beta'));

      const relay = new EventRelay(network, {
        federationEnabled: true,
        severityFilter: ['warning', 'error', 'critical'],
        domainFilter: [],
      });

      const sink = new ClusterFederationSink(relay, domain, 'federation-test-node');

      // Emit an event that's already federated from another bridge
      const federatedEvent = makeBridgeEvent({
        severity: 'error',
        federated: true,
        sourceNodeId: 'remote-node-42',
      });

      await sink.onEvent(federatedEvent);

      // FakeNetwork should have zero sends — the sink skipped this event
      assert.equal(network.sent.length, 0, 'Federated events must not be re-relayed');
    } finally {
      await domain.stop();
    }
  });

  // 3. Backward compatibility — existing sinks work fine with federation fields
  it('existing sinks continue to work when BridgeEvent has federation fields', async () => {
    // Simulate an existing sink that only cares about basic event fields
    const received: BridgeEvent[] = [];
    const legacySink: EventSink = {
      name: 'legacy-test-sink',
      onEvent(event: BridgeEvent) {
        // A sink that only accesses standard fields — federation fields are optional
        received.push(event);
      },
    };

    // Event WITH federation fields
    const eventWithFederation = makeBridgeEvent({
      severity: 'warning',
      federated: true,
      sourceNodeId: 'remote-node',
    });

    // Event WITHOUT federation fields
    const eventWithout = makeBridgeEvent({
      severity: 'info',
    });

    // Both events should be handled without error
    legacySink.onEvent(eventWithFederation);
    legacySink.onEvent(eventWithout);

    assert.equal(received.length, 2);
    assert.equal(received[0].federated, true);
    assert.equal(received[0].sourceNodeId, 'remote-node');
    assert.equal(received[1].federated, undefined);
    assert.equal(received[1].sourceNodeId, undefined);
  });
});
