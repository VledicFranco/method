/**
 * Cluster Domain — HTTP Route tests.
 *
 * Uses Fastify inject() to test routes without a live server.
 * Test doubles from @method/cluster handle all I/O.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import {
  FakeDiscovery,
  FakeNetwork,
  FakeResources,
  CapacityWeightedRouter,
  type ClusterNode,
} from '@method/cluster';
import { ClusterDomain, type ClusterLogger } from './core.js';
import { registerClusterRoutes } from './routes.js';
import type { ClusterConfig } from './config.js';

// ── Helpers ────────────────────────────────────────────────────

function makeConfig(overrides: Partial<ClusterConfig> = {}): ClusterConfig {
  return {
    enabled: true,
    nodeId: 'route-test-node',
    seeds: '',
    heartbeatMs: 100,
    suspectTimeoutMs: 300,
    stateBroadcastMs: 500,
    federationEnabled: true,
    federationFilterSeverity: 'warning,error,critical',
    federationFilterDomain: '',
    maxPeers: 50,
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

async function buildApp(
  config: ClusterConfig,
  opts: { router?: CapacityWeightedRouter } = {},
): Promise<{ app: FastifyInstance; domain: ClusterDomain }> {
  const discovery = new FakeDiscovery();
  const network = new FakeNetwork();
  const resources = new FakeResources({ nodeId: config.nodeId, instanceName: 'test' });

  const domain = new ClusterDomain(config, { discovery, network, resources }, makeLogger());
  await domain.start();

  const app = Fastify({ logger: false });
  registerClusterRoutes(app, { domain, router: opts.router });
  await app.ready();

  return { app, domain };
}

// ── Tests ──────────────────────────────────────────────────────

describe('Cluster Routes', () => {

  // 1. GET /cluster/state returns full state
  it('GET /cluster/state returns full cluster state', async () => {
    const { app, domain } = await buildApp(makeConfig());

    try {
      const res = await app.inject({ method: 'GET', url: '/cluster/state' });
      assert.equal(res.statusCode, 200);

      const body = JSON.parse(res.payload);
      assert.ok(body.self);
      assert.equal(body.self.nodeId, 'route-test-node');
      assert.equal(body.self.status, 'alive');
      assert.ok(body.peers !== undefined);
      assert.ok(typeof body.generation === 'number');
    } finally {
      await domain.stop();
      await app.close();
    }
  });

  // 2. GET /cluster/nodes returns node list
  it('GET /cluster/nodes returns node list including self', async () => {
    const { app, domain } = await buildApp(makeConfig());

    try {
      // Add a peer for richer output
      domain.getManager()!.handleJoin(makePeerNode('peer-1'));

      const res = await app.inject({ method: 'GET', url: '/cluster/nodes' });
      assert.equal(res.statusCode, 200);

      const body = JSON.parse(res.payload);
      assert.ok(Array.isArray(body.nodes));
      assert.equal(body.nodes.length, 2); // self + peer-1
      assert.ok(body.nodes.some((n: ClusterNode) => n.nodeId === 'route-test-node'));
      assert.ok(body.nodes.some((n: ClusterNode) => n.nodeId === 'peer-1'));
    } finally {
      await domain.stop();
      await app.close();
    }
  });

  // 3. POST /cluster/ping returns ack
  it('POST /cluster/ping returns ack with generation', async () => {
    const { app, domain } = await buildApp(makeConfig());

    try {
      // Add a peer so the heartbeat has a target
      domain.getManager()!.handleJoin(makePeerNode('peer-ping'));

      const res = await app.inject({
        method: 'POST',
        url: '/cluster/ping',
        payload: { from: 'peer-ping', generation: 1 },
      });
      assert.equal(res.statusCode, 200);

      const body = JSON.parse(res.payload);
      assert.equal(body.type, 'ack');
      assert.equal(body.from, 'route-test-node');
      assert.ok(typeof body.generation === 'number');
    } finally {
      await domain.stop();
      await app.close();
    }
  });

  // 4. POST /cluster/drain sets draining status
  it('POST /cluster/drain sets node to draining', async () => {
    const { app, domain } = await buildApp(makeConfig());

    try {
      const res = await app.inject({ method: 'POST', url: '/cluster/drain' });
      assert.equal(res.statusCode, 200);

      const body = JSON.parse(res.payload);
      assert.equal(body.nodeId, 'route-test-node');
      assert.equal(body.status, 'draining');

      // Verify state is actually draining
      const state = domain.getState();
      assert.ok(state);
      assert.equal(state.self.status, 'draining');

      // Resume should restore alive
      const resumeRes = await app.inject({ method: 'POST', url: '/cluster/resume' });
      assert.equal(resumeRes.statusCode, 200);
      assert.equal(JSON.parse(resumeRes.payload).status, 'alive');
    } finally {
      await domain.stop();
      await app.close();
    }
  });

  // 5. Cluster disabled returns 404
  it('returns 404 for all endpoints when cluster is disabled', async () => {
    const { app, domain } = await buildApp(makeConfig({ enabled: false }));

    try {
      const endpoints = [
        { method: 'GET' as const, url: '/cluster/state' },
        { method: 'GET' as const, url: '/cluster/nodes' },
        { method: 'POST' as const, url: '/cluster/ping', payload: { from: 'x', generation: 0 } },
        { method: 'POST' as const, url: '/cluster/drain' },
        { method: 'POST' as const, url: '/cluster/resume' },
        { method: 'POST' as const, url: '/cluster/events', payload: { from: 'x', events: [] } },
        { method: 'POST' as const, url: '/cluster/route', payload: { type: 'session' } },
      ];

      for (const ep of endpoints) {
        const res = await app.inject(ep);
        assert.equal(res.statusCode, 404, `Expected 404 for ${ep.method} ${ep.url}, got ${res.statusCode}`);
        const body = JSON.parse(res.payload);
        assert.equal(body.error, 'Cluster not enabled');
      }
    } finally {
      await domain.stop();
      await app.close();
    }
  });

  // 6. GET /cluster/nodes/:nodeId for unknown node returns 404
  it('GET /cluster/nodes/:nodeId returns 404 for unknown node', async () => {
    const { app, domain } = await buildApp(makeConfig());

    try {
      const res = await app.inject({ method: 'GET', url: '/cluster/nodes/nonexistent-node' });
      assert.equal(res.statusCode, 404);

      const body = JSON.parse(res.payload);
      assert.ok(body.error.includes('not found'));
    } finally {
      await domain.stop();
      await app.close();
    }
  });

  // 7. POST /cluster/route returns best node based on cluster state
  it('POST /cluster/route returns best node based on cluster state', async () => {
    const router = new CapacityWeightedRouter();
    const { app, domain } = await buildApp(makeConfig(), { router });

    try {
      // Add a peer with moderate load
      domain.getManager()!.handleJoin(makePeerNode('peer-route-1'));

      // Add a peer with lighter load (more available sessions)
      const lightPeer = makePeerNode('peer-route-2');
      lightPeer.resources.sessionsActive = 0;
      lightPeer.resources.memoryAvailableMb = 7000;
      lightPeer.resources.cpuLoadPercent = 5;
      domain.getManager()!.handleJoin(lightPeer);

      const res = await app.inject({
        method: 'POST',
        url: '/cluster/route',
        payload: { type: 'session' },
      });
      assert.equal(res.statusCode, 200);

      const body = JSON.parse(res.payload);
      assert.ok(body.node, 'Expected a node in the response');
      assert.ok(typeof body.score === 'number', 'Expected a numeric score');
      assert.ok(body.node.nodeId, 'Node should have a nodeId');
      // The lighter peer should score higher
      assert.equal(body.node.nodeId, 'peer-route-2');
    } finally {
      await domain.stop();
      await app.close();
    }
  });

  // 8. POST /cluster/route returns 501 when router is not configured
  it('POST /cluster/route returns 501 when router is not provided', async () => {
    const { app, domain } = await buildApp(makeConfig()); // no router

    try {
      const res = await app.inject({
        method: 'POST',
        url: '/cluster/route',
        payload: { type: 'session' },
      });
      assert.equal(res.statusCode, 501);

      const body = JSON.parse(res.payload);
      assert.equal(body.error, 'Router not configured');
    } finally {
      await domain.stop();
      await app.close();
    }
  });

  // 9. Zod validation — invalid join body returns 400
  it('POST /cluster/join returns 400 for invalid body', async () => {
    const { app, domain } = await buildApp(makeConfig());

    try {
      // Missing node entirely
      const res1 = await app.inject({
        method: 'POST',
        url: '/cluster/join',
        payload: {},
      });
      assert.equal(res1.statusCode, 400);

      // node missing nodeId
      const res2 = await app.inject({
        method: 'POST',
        url: '/cluster/join',
        payload: { node: { instanceName: 'x' } },
      });
      assert.equal(res2.statusCode, 400);
    } finally {
      await domain.stop();
      await app.close();
    }
  });

  // 10. Zod validation — invalid ping body returns 400
  it('POST /cluster/ping returns 400 for invalid body', async () => {
    const { app, domain } = await buildApp(makeConfig());

    try {
      const res = await app.inject({
        method: 'POST',
        url: '/cluster/ping',
        payload: { from: 123, generation: 'not-a-number' },
      });
      assert.equal(res.statusCode, 400);
    } finally {
      await domain.stop();
      await app.close();
    }
  });

  // 11. Zod validation — invalid route body type returns 400
  it('POST /cluster/route returns 400 for invalid work request type', async () => {
    const router = new CapacityWeightedRouter();
    const { app, domain } = await buildApp(makeConfig(), { router });

    try {
      const res = await app.inject({
        method: 'POST',
        url: '/cluster/route',
        payload: { type: 'invalid-type' },
      });
      assert.equal(res.statusCode, 400);

      const body = JSON.parse(res.payload);
      assert.ok(body.details, 'Should include Zod error details');
    } finally {
      await domain.stop();
      await app.close();
    }
  });

  // 12. CLUSTER_SECRET auth — returns 401 when secret is wrong
  it('returns 401 when x-cluster-secret header is missing/wrong', async () => {
    const discovery = new FakeDiscovery();
    const network = new FakeNetwork();
    const resources = new FakeResources({ nodeId: 'auth-test', instanceName: 'test' });

    const domain = new ClusterDomain(makeConfig({ nodeId: 'auth-test' }), { discovery, network, resources }, makeLogger());
    await domain.start();

    const app = Fastify({ logger: false });
    registerClusterRoutes(app, { domain, clusterSecret: 'my-secret-123' });
    await app.ready();

    try {
      // No header
      const res1 = await app.inject({
        method: 'POST',
        url: '/cluster/ping',
        payload: { from: 'peer-1', generation: 1 },
      });
      assert.equal(res1.statusCode, 401);

      // Wrong header
      const res2 = await app.inject({
        method: 'POST',
        url: '/cluster/ping',
        headers: { 'x-cluster-secret': 'wrong' },
        payload: { from: 'peer-1', generation: 1 },
      });
      assert.equal(res2.statusCode, 401);

      // Correct header
      domain.getManager()!.handleJoin(makePeerNode('peer-1'));
      const res3 = await app.inject({
        method: 'POST',
        url: '/cluster/ping',
        headers: { 'x-cluster-secret': 'my-secret-123' },
        payload: { from: 'peer-1', generation: 1 },
      });
      assert.equal(res3.statusCode, 200);
    } finally {
      await domain.stop();
      await app.close();
    }
  });

  // 13. GET endpoints are not gated by auth (no secret required)
  it('GET endpoints do not require x-cluster-secret', async () => {
    const discovery = new FakeDiscovery();
    const network = new FakeNetwork();
    const resources = new FakeResources({ nodeId: 'auth-get-test', instanceName: 'test' });

    const domain = new ClusterDomain(makeConfig({ nodeId: 'auth-get-test' }), { discovery, network, resources }, makeLogger());
    await domain.start();

    const app = Fastify({ logger: false });
    registerClusterRoutes(app, { domain, clusterSecret: 'my-secret' });
    await app.ready();

    try {
      const res = await app.inject({ method: 'GET', url: '/cluster/state' });
      assert.equal(res.statusCode, 200);
    } finally {
      await domain.stop();
      await app.close();
    }
  });
});
