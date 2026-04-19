// SPDX-License-Identifier: Apache-2.0
/**
 * Cluster Domain — Core lifecycle tests.
 *
 * Uses FakeDiscovery, FakeNetwork, FakeResources from @methodts/cluster
 * to verify domain behavior without real network calls.
 */

import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  FakeDiscovery,
  FakeNetwork,
  FakeResources,
  type ClusterNode,
} from '@methodts/cluster';
import { ClusterDomain, type ClusterLogger } from './core.js';
import type { ClusterConfig } from './config.js';

// ── Helpers ────────────────────────────────────────────────────

function makeConfig(overrides: Partial<ClusterConfig> = {}): ClusterConfig {
  return {
    enabled: true,
    nodeId: 'test-node-id',
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

function makeLogger(): ClusterLogger & { messages: string[] } {
  const messages: string[] = [];
  return {
    messages,
    info(msg: string) { messages.push(`[info] ${msg}`); },
    warn(msg: string) { messages.push(`[warn] ${msg}`); },
    error(msg: string) { messages.push(`[error] ${msg}`); },
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

// ── Tests ──────────────────────────────────────────────────────

describe('ClusterDomain', () => {
  const domains: ClusterDomain[] = [];

  afterEach(async () => {
    for (const d of domains) await d.stop();
    domains.length = 0;
  });

  function track(domain: ClusterDomain) {
    domains.push(domain);
    return domain;
  }

  // 1. Domain starts with CLUSTER_ENABLED=true — discovers peers, begins heartbeat
  it('starts membership manager when enabled', async () => {
    const discovery = new FakeDiscovery();
    const network = new FakeNetwork();
    const resources = new FakeResources({ nodeId: 'test-node-id', instanceName: 'test' });
    const logger = makeLogger();

    const domain = track(new ClusterDomain(
      makeConfig({ enabled: true }),
      { discovery, network, resources },
      logger,
    ));

    assert.equal(domain.isEnabled(), true);
    assert.ok(domain.getManager(), 'Manager should be created when enabled');

    await domain.start();

    // Manager should be running — state should be accessible
    const state = domain.getState();
    assert.ok(state, 'getState should return state when enabled');
    assert.equal(state.self.nodeId, 'test-node-id');
    assert.equal(state.self.status, 'alive');

    // Logger should have recorded start messages
    assert.ok(logger.messages.some(m => m.includes('Starting cluster node')));
    assert.ok(logger.messages.some(m => m.includes('Membership manager started')));
  });

  // 2. Domain starts with CLUSTER_ENABLED=false — no-op, no network calls
  it('is a complete no-op when disabled', async () => {
    const discovery = new FakeDiscovery();
    const network = new FakeNetwork();
    const resources = new FakeResources();
    const logger = makeLogger();

    const domain = track(new ClusterDomain(
      makeConfig({ enabled: false }),
      { discovery, network, resources },
      logger,
    ));

    assert.equal(domain.isEnabled(), false);
    assert.equal(domain.getManager(), null);
    assert.equal(domain.getState(), null);

    // start/stop are no-ops — should not throw
    await domain.start();
    await domain.stop();

    // No network calls should have been made
    assert.equal(network.sent.length, 0);
    assert.equal(discovery.announced.length, 0);
  });

  // 3. Peer health check fails — peer marked suspect after timeout
  it('marks peer as suspect after heartbeat timeout', async () => {
    const discovery = new FakeDiscovery();
    const network = new FakeNetwork();
    const resources = new FakeResources({ nodeId: 'test-node-id', instanceName: 'test' });
    const logger = makeLogger();

    const config = makeConfig({
      enabled: true,
      heartbeatMs: 50,
      suspectTimeoutMs: 150,
    });

    const domain = track(new ClusterDomain(config, { discovery, network, resources }, logger));
    const manager = domain.getManager()!;

    let clock = 1000;
    manager.now = () => clock;

    // Join a peer
    manager.handleJoin(makePeerNode('peer-1'));
    assert.equal(manager.getState().peers.get('peer-1')!.status, 'alive');

    // Start the manager (begins sweep timer)
    await domain.start();

    // Advance clock past suspect timeout
    clock = 1000 + 151;

    // Wait for sweep to run
    await new Promise<void>(resolve => setTimeout(resolve, 100));

    const peer = manager.getState().peers.get('peer-1');
    assert.ok(peer);
    assert.equal(peer.status, 'suspect');
  });

  // 4. New peer discovered — added to membership, resources synced
  it('adds newly discovered peer to membership', async () => {
    const discovery = new FakeDiscovery();
    const network = new FakeNetwork();
    const resources = new FakeResources({ nodeId: 'test-node-id', instanceName: 'test' });
    const logger = makeLogger();

    const domain = track(new ClusterDomain(
      makeConfig({ enabled: true }),
      { discovery, network, resources },
      logger,
    ));

    const manager = domain.getManager()!;

    await domain.start();

    // Simulate a peer joining via network message
    const peerNode = makePeerNode('peer-2');
    manager.handleJoin(peerNode);

    const state = manager.getState();
    assert.equal(state.peers.size, 1);

    const stored = state.peers.get('peer-2');
    assert.ok(stored);
    assert.equal(stored.status, 'alive');
    assert.equal(stored.instanceName, 'peer-peer-2');
    assert.equal(stored.resources.cpuCount, 4);
    assert.equal(stored.resources.projectCount, 5);
  });
});
