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

async function buildApp(config: ClusterConfig): Promise<{ app: FastifyInstance; domain: ClusterDomain }> {
  const discovery = new FakeDiscovery();
  const network = new FakeNetwork();
  const resources = new FakeResources({ nodeId: config.nodeId, instanceName: 'test' });

  const domain = new ClusterDomain(config, { discovery, network, resources }, makeLogger());
  await domain.start();

  const app = Fastify({ logger: false });
  registerClusterRoutes(app, { domain });
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
});
