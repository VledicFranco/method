import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { MembershipManager } from './membership.js';
import { FakeDiscovery } from '../test-doubles/fake-discovery.js';
import { FakeNetwork } from '../test-doubles/fake-network.js';
import { FakeResources } from '../test-doubles/fake-resources.js';
import type { ClusterNode, NodeIdentity } from '../types.js';

// ── Helpers ────────────────────────────────────────────────────

const SELF_IDENTITY: NodeIdentity = {
  nodeId: 'self-node',
  instanceName: 'test-bridge',
  address: { host: 'localhost', port: 3456 },
};

function makePeerNode(id: string, overrides: Partial<ClusterNode> = {}): ClusterNode {
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
    ...overrides,
  };
}

/** Fast config — all timeouts in ms for deterministic tests. */
const FAST_CONFIG = {
  heartbeatMs: 100,
  suspectTimeoutMs: 300,
  deadTimeoutMs: 600,
  gcTimeoutMs: 900,
  stateBroadcastMs: 500,
  maxPeers: 50,
};

function createManager(config: Partial<import('./membership.config.js').MembershipConfig> = FAST_CONFIG) {
  const discovery = new FakeDiscovery();
  const network = new FakeNetwork();
  const resources = new FakeResources({ nodeId: SELF_IDENTITY.nodeId, instanceName: SELF_IDENTITY.instanceName });
  const manager = new MembershipManager(SELF_IDENTITY, { discovery, network, resources }, config);
  return { manager, discovery, network, resources };
}

// ── Tests ──────────────────────────────────────────────────────

describe('MembershipManager', () => {
  let managers: MembershipManager[] = [];

  afterEach(() => {
    for (const m of managers) m.stop();
    managers = [];
  });

  function track(manager: MembershipManager) {
    managers.push(manager);
    return manager;
  }

  // 1. Node joins cluster — added to peers with status alive
  it('adds a joining node to peers with status alive', () => {
    const { manager } = createManager();
    track(manager);

    const peer = makePeerNode('peer-1');
    manager.handleJoin(peer);

    const state = manager.getState();
    assert.equal(state.peers.size, 1);

    const stored = state.peers.get('peer-1');
    assert.ok(stored);
    assert.equal(stored.status, 'alive');
    assert.equal(stored.nodeId, 'peer-1');
    assert.equal(stored.instanceName, 'peer-peer-1');
  });

  // 2. Node leaves gracefully — removed from peers
  it('removes a node that leaves gracefully', () => {
    const { manager } = createManager();
    track(manager);

    manager.handleJoin(makePeerNode('peer-1'));
    assert.equal(manager.getState().peers.size, 1);

    manager.handleLeave('peer-1');
    assert.equal(manager.getState().peers.size, 0);
  });

  // 3. Heartbeat received — lastSeen updated
  it('updates lastSeen when a heartbeat is received', () => {
    const { manager } = createManager();
    track(manager);

    let clock = 1000;
    manager.now = () => clock;

    const peer = makePeerNode('peer-1');
    manager.handleJoin(peer);

    const initialLastSeen = manager.getState().peers.get('peer-1')!.lastSeen;

    clock = 5000;
    manager.handleHeartbeat('peer-1');

    const updatedLastSeen = manager.getState().peers.get('peer-1')!.lastSeen;
    assert.ok(updatedLastSeen > initialLastSeen, 'lastSeen should be updated after heartbeat');
    assert.equal(updatedLastSeen, 5000);
  });

  // 4. Heartbeat missed beyond suspectTimeout — status → suspect
  it('transitions to suspect when heartbeat missed beyond suspectTimeout', () => {
    const { manager, network } = createManager();
    track(manager);

    let clock = 1000;
    manager.now = () => clock;

    const peer = makePeerNode('peer-1');
    manager.handleJoin(peer);

    // Advance past suspectTimeout
    clock = 1000 + FAST_CONFIG.suspectTimeoutMs + 1;

    // Deliver a ping from self to trigger sweep via the message loop
    // Actually, we need to trigger a sweep directly. The sweep runs on setInterval,
    // but we can trigger it by starting and letting it run, or by using the internal method.
    // Instead, let's use the network.deliver to send a ping which triggers handleMessage,
    // but sweeps only run on the timer. So let's start the manager and wait.
    manager.start();

    // Wait for sweep to run (sweepTimer runs at heartbeatMs = 100ms)
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        const stored = manager.getState().peers.get('peer-1');
        assert.ok(stored);
        assert.equal(stored.status, 'suspect');
        resolve();
      }, FAST_CONFIG.heartbeatMs + 50);
    });
  });

  // 5. Suspect node recovers (heartbeat received) — status → alive
  it('recovers a suspect node to alive when heartbeat is received', () => {
    const { manager } = createManager();
    track(manager);

    let clock = 1000;
    manager.now = () => clock;

    const peer = makePeerNode('peer-1');
    manager.handleJoin(peer);

    // Advance past suspectTimeout to force suspect
    clock = 1000 + FAST_CONFIG.suspectTimeoutMs + 1;
    manager.start();

    return new Promise<void>((resolve) => {
      setTimeout(() => {
        // Verify suspect state
        const suspectPeer = manager.getState().peers.get('peer-1');
        assert.ok(suspectPeer);
        assert.equal(suspectPeer.status, 'suspect');

        // Now send a heartbeat — should recover to alive
        clock = clock + 100;
        manager.handleHeartbeat('peer-1');

        const recovered = manager.getState().peers.get('peer-1');
        assert.ok(recovered);
        assert.equal(recovered.status, 'alive');
        resolve();
      }, FAST_CONFIG.heartbeatMs + 50);
    });
  });

  // 6. Suspect node exceeds dead timeout — status → dead
  it('transitions suspect node to dead after extended timeout', () => {
    const { manager } = createManager();
    track(manager);

    let clock = 1000;
    manager.now = () => clock;

    const peer = makePeerNode('peer-1');
    manager.handleJoin(peer);

    manager.start();

    // First, advance past suspect timeout
    clock = 1000 + FAST_CONFIG.suspectTimeoutMs + 1;

    return new Promise<void>((resolve) => {
      setTimeout(() => {
        assert.equal(manager.getState().peers.get('peer-1')!.status, 'suspect');

        // Now advance past dead timeout
        clock = 1000 + FAST_CONFIG.deadTimeoutMs + 1;

        setTimeout(() => {
          const stored = manager.getState().peers.get('peer-1');
          assert.ok(stored);
          assert.equal(stored.status, 'dead');
          resolve();
        }, FAST_CONFIG.heartbeatMs + 50);
      }, FAST_CONFIG.heartbeatMs + 50);
    });
  });

  // 7. Dead node removed from peers after GC interval
  it('removes dead node from peers after GC interval', () => {
    const { manager } = createManager();
    track(manager);

    let clock = 1000;
    manager.now = () => clock;

    const peer = makePeerNode('peer-1');
    manager.handleJoin(peer);

    manager.start();

    // Advance past suspect
    clock = 1000 + FAST_CONFIG.suspectTimeoutMs + 1;

    return new Promise<void>((resolve) => {
      setTimeout(() => {
        // Advance past dead
        clock = 1000 + FAST_CONFIG.deadTimeoutMs + 1;

        setTimeout(() => {
          assert.equal(manager.getState().peers.get('peer-1')!.status, 'dead');

          // Advance past GC
          clock = 1000 + FAST_CONFIG.gcTimeoutMs + 1;

          setTimeout(() => {
            assert.equal(manager.getState().peers.has('peer-1'), false);
            resolve();
          }, FAST_CONFIG.heartbeatMs + 50);
        }, FAST_CONFIG.heartbeatMs + 50);
      }, FAST_CONFIG.heartbeatMs + 50);
    });
  });

  // 8. maxPeers limit — rejects join when at capacity
  it('rejects join when maxPeers limit is reached', () => {
    const { manager } = createManager({ ...FAST_CONFIG, maxPeers: 2 });
    track(manager);

    // Fill to capacity
    manager.handleJoin(makePeerNode('peer-1'));
    manager.handleJoin(makePeerNode('peer-2'));
    assert.equal(manager.getState().peers.size, 2);

    // Third peer should be rejected
    manager.handleJoin(makePeerNode('peer-3'));
    assert.equal(manager.getState().peers.size, 2);
    assert.equal(manager.getState().peers.has('peer-3'), false);

    // Updating an existing peer should still work
    const updated = makePeerNode('peer-1');
    updated.resources.cpuLoadPercent = 99;
    manager.handleJoin(updated);
    assert.equal(manager.getState().peers.get('peer-1')!.resources.cpuLoadPercent, 99);
  });

  // 9. onSendError callback is invoked on network failures
  it('invokes onSendError callback on network send failure', async () => {
    const discovery = new FakeDiscovery();
    const network = new FakeNetwork();
    const resources = new FakeResources({ nodeId: SELF_IDENTITY.nodeId, instanceName: SELF_IDENTITY.instanceName });

    // Make network.send fail
    const errors: Array<{ peer: import('../types.js').PeerAddress; error: Error }> = [];
    network.send = async () => { throw new Error('connection refused'); };

    const manager = new MembershipManager(SELF_IDENTITY, {
      discovery,
      network,
      resources,
      onSendError: (peer, err) => { errors.push({ peer, error: err }); },
    }, FAST_CONFIG);
    track(manager);

    manager.handleJoin(makePeerNode('peer-1'));
    manager.start();

    // Wait for heartbeat to fire
    await new Promise<void>(resolve => setTimeout(resolve, FAST_CONFIG.heartbeatMs + 50));

    assert.ok(errors.length > 0, 'onSendError should have been called');
    assert.ok(errors[0].error.message.includes('connection refused'));
  });

  // 10. Self-node state always reflects local resources
  it('refreshes self-node resources on every getState call', () => {
    const { manager, resources } = createManager();
    track(manager);

    const state1 = manager.getState();
    assert.equal(state1.self.resources.cpuLoadPercent, 25);

    // Change the underlying resource provider
    resources.current.cpuLoadPercent = 90;
    resources.current.sessionsActive = 8;

    const state2 = manager.getState();
    assert.equal(state2.self.resources.cpuLoadPercent, 90);
    assert.equal(state2.self.resources.sessionsActive, 8);
  });
});
