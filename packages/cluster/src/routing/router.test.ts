import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CapacityWeightedRouter } from './router.js';
import type { ClusterNode, ClusterState, WorkRequest, ResourceSnapshot, ProjectSummary } from '../types.js';

// ── Helpers ────────────────────────────────────────────────────

function makeResources(overrides: Partial<ResourceSnapshot> = {}): ResourceSnapshot {
  return {
    nodeId: 'node',
    instanceName: 'test',
    cpuCount: 4,
    cpuLoadPercent: 20,
    memoryTotalMb: 8192,
    memoryAvailableMb: 4096,
    sessionsActive: 2,
    sessionsMax: 10,
    projectCount: 3,
    uptimeMs: 60000,
    version: '0.1.0',
    ...overrides,
  };
}

function makeNode(id: string, overrides: Partial<ClusterNode> = {}): ClusterNode {
  return {
    nodeId: id,
    instanceName: `node-${id}`,
    address: { host: `${id}.ts.net`, port: 3456 },
    resources: makeResources({ nodeId: id, instanceName: `node-${id}` }),
    status: 'alive',
    lastSeen: Date.now(),
    projects: [],
    ...overrides,
  };
}

function makeState(self: ClusterNode, peers: ClusterNode[]): ClusterState {
  const peerMap = new Map<string, ClusterNode>();
  for (const p of peers) peerMap.set(p.nodeId, p);
  return { self, peers: peerMap, generation: 1 };
}

// ── Tests ──────────────────────────────────────────────────────

describe('CapacityWeightedRouter', () => {
  const router = new CapacityWeightedRouter();

  // 1. Route to node with most session headroom
  it('selects the node with the most session headroom', () => {
    const self = makeNode('self', {
      resources: makeResources({ nodeId: 'self', sessionsActive: 8, sessionsMax: 10 }),
    });
    const peerA = makeNode('peer-a', {
      resources: makeResources({ nodeId: 'peer-a', sessionsActive: 2, sessionsMax: 10 }),
    });
    const peerB = makeNode('peer-b', {
      resources: makeResources({ nodeId: 'peer-b', sessionsActive: 7, sessionsMax: 10 }),
    });

    const state = makeState(self, [peerA, peerB]);
    const request: WorkRequest = { type: 'session' };
    const selected = router.selectNode(request, state);

    assert.ok(selected);
    assert.equal(selected.nodeId, 'peer-a', 'should select peer-a with most session headroom (8/10 free)');
  });

  // 2. Route to node that has the requested project (locality bonus)
  it('prefers a node with the requested project (locality bonus)', () => {
    const project: ProjectSummary = { projectId: 'proj-x', name: 'Project X' };

    // Both peers have identical resources, but peer-b has the project
    const self = makeNode('self', {
      resources: makeResources({ nodeId: 'self', sessionsActive: 5, sessionsMax: 10 }),
    });
    const peerA = makeNode('peer-a', {
      resources: makeResources({ nodeId: 'peer-a', sessionsActive: 5, sessionsMax: 10 }),
      projects: [],
    });
    const peerB = makeNode('peer-b', {
      resources: makeResources({ nodeId: 'peer-b', sessionsActive: 5, sessionsMax: 10 }),
      projects: [project],
    });

    const state = makeState(self, [peerA, peerB]);
    const request: WorkRequest = { type: 'strategy', projectId: 'proj-x' };
    const selected = router.selectNode(request, state);

    assert.ok(selected);
    assert.equal(selected.nodeId, 'peer-b', 'should select peer-b which has project proj-x');
  });

  // 3. Exclude failed nodes from routing
  it('excludes nodes listed in request.excludeNodes', () => {
    const self = makeNode('self', {
      resources: makeResources({ nodeId: 'self', sessionsActive: 9, sessionsMax: 10 }),
    });
    const peerA = makeNode('peer-a', {
      resources: makeResources({ nodeId: 'peer-a', sessionsActive: 1, sessionsMax: 10 }),
    });
    const peerB = makeNode('peer-b', {
      resources: makeResources({ nodeId: 'peer-b', sessionsActive: 3, sessionsMax: 10 }),
    });

    const state = makeState(self, [peerA, peerB]);
    const request: WorkRequest = { type: 'session', excludeNodes: ['peer-a'] };
    const selected = router.selectNode(request, state);

    assert.ok(selected);
    assert.equal(selected.nodeId, 'peer-b', 'should select peer-b since peer-a is excluded');
  });

  // 4. Return null when no nodes have capacity (all draining/dead)
  it('returns null when all nodes are draining or dead', () => {
    const self = makeNode('self', { status: 'draining' });
    const peerA = makeNode('peer-a', { status: 'dead' });
    const peerB = makeNode('peer-b', { status: 'suspect' });

    const state = makeState(self, [peerA, peerB]);
    const request: WorkRequest = { type: 'genesis' };
    const selected = router.selectNode(request, state);

    assert.equal(selected, null, 'should return null when no alive nodes exist');
  });

  // 5. Tie-breaking by lowest active sessions
  it('breaks ties by selecting the node with lowest active sessions', () => {
    // Create two nodes with identical scores except sessionsActive
    const self = makeNode('self', {
      resources: makeResources({
        nodeId: 'self',
        sessionsActive: 5,
        sessionsMax: 10,
        cpuLoadPercent: 20,
        memoryAvailableMb: 4096,
        memoryTotalMb: 8192,
      }),
    });
    const peerA = makeNode('peer-a', {
      resources: makeResources({
        nodeId: 'peer-a',
        sessionsActive: 3,
        sessionsMax: 10,
        cpuLoadPercent: 20,
        memoryAvailableMb: 4096,
        memoryTotalMb: 8192,
      }),
    });
    const peerB = makeNode('peer-b', {
      resources: makeResources({
        nodeId: 'peer-b',
        sessionsActive: 3,
        sessionsMax: 10,
        cpuLoadPercent: 20,
        memoryAvailableMb: 4096,
        memoryTotalMb: 8192,
      }),
    });

    // Both peers have identical scores. But since they also have identical sessionsActive,
    // we need to make the scores actually tie while sessionsActive differs.
    // Let's adjust: peer-a has slightly less memory but fewer sessions.
    // Actually, for a pure tie-break test, we need equal scores but different sessionsActive.
    // The score includes session headroom which depends on sessionsActive, so to get equal
    // scores with different sessionsActive, we compensate via another dimension.

    // peer-c: sessionsActive=2, sessionsMax=10 → headroom = 0.8 * 0.4 = 0.32
    //         cpuLoad=40 → cpu headroom = 0.6 * 0.2 = 0.12
    //         mem = 4096/8192 → 0.5 * 0.3 = 0.15
    //         total = 0.32 + 0.15 + 0.12 = 0.59
    //
    // peer-d: sessionsActive=4, sessionsMax=10 → headroom = 0.6 * 0.4 = 0.24
    //         cpuLoad=20 → cpu headroom = 0.8 * 0.2 = 0.16
    //         mem = 4096/8192 → 0.5 * 0.3 = 0.15
    //         total = 0.24 + 0.15 + 0.16 = 0.55 ← not a tie
    //
    // To get exact ties: make all resource dimensions identical.
    // peer-c: sessions 3/10, cpu 20, mem 4096/8192
    // peer-d: sessions 3/10, cpu 20, mem 4096/8192
    // Scores are identical, sessionsActive identical — test verifies we get one (either).
    //
    // Better: sessions differ but we compensate via CPU.
    // peer-c: sessions 2/10 → 0.8*0.4=0.32, cpu 50 → 0.5*0.2=0.10, mem 0.5*0.3=0.15 → 0.57
    // peer-d: sessions 4/10 → 0.6*0.4=0.24, cpu 10 → 0.9*0.2=0.18, mem 0.5*0.3=0.15 → 0.57 ✓
    // Tie! peer-c has sessionsActive=2, peer-d has sessionsActive=4 → peer-c wins

    const selfNode = makeNode('self', { status: 'draining' }); // exclude self
    const peerC = makeNode('peer-c', {
      resources: makeResources({
        nodeId: 'peer-c',
        sessionsActive: 2,
        sessionsMax: 10,
        cpuLoadPercent: 50,
        memoryAvailableMb: 4096,
        memoryTotalMb: 8192,
      }),
    });
    const peerD = makeNode('peer-d', {
      resources: makeResources({
        nodeId: 'peer-d',
        sessionsActive: 4,
        sessionsMax: 10,
        cpuLoadPercent: 10,
        memoryAvailableMb: 4096,
        memoryTotalMb: 8192,
      }),
    });

    const request: WorkRequest = { type: 'session' };

    // Verify scores are actually tied
    const scoreC = router.score(peerC, request);
    const scoreD = router.score(peerD, request);
    assert.equal(scoreC, scoreD, `scores should be tied (C=${scoreC}, D=${scoreD})`);

    const tieState = makeState(selfNode, [peerC, peerD]);
    const selected = router.selectNode(request, tieState);

    assert.ok(selected);
    assert.equal(selected.nodeId, 'peer-c', 'should break tie by selecting node with fewer active sessions (2 < 4)');
  });
});
