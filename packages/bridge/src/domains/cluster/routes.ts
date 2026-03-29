/**
 * Cluster Domain HTTP Routes — peer coordination, state queries, federation.
 *
 * Endpoints:
 *   GET    /cluster/state          — Full cluster state + all nodes
 *   GET    /cluster/nodes          — Node list with status and resources
 *   GET    /cluster/nodes/:nodeId  — Single node detail
 *   POST   /cluster/join           — Peer join notification
 *   POST   /cluster/leave          — Peer leave notification
 *   POST   /cluster/ping           — Heartbeat ping (returns ack + state)
 *   POST   /cluster/events         — Receive federated events
 *   POST   /cluster/drain          — Set self to draining status
 *   POST   /cluster/resume         — Clear draining status
 *
 * When CLUSTER_ENABLED=false, all endpoints return 404.
 */

import type { FastifyInstance } from 'fastify';
import type { ClusterDomain } from './core.js';
import type { ClusterNode, FederatedEvent } from '@method/cluster';

// ── Route Deps ────────────────────────────────────────────────────

export interface ClusterRouteDeps {
  domain: ClusterDomain;
}

// ── Disabled Guard ────────────────────────────────────────────────

function clusterDisabledReply(reply: { status(code: number): { send(body: unknown): unknown } }) {
  return reply.status(404).send({ error: 'Cluster not enabled' });
}

// ── Helper: serialize ClusterState for JSON ───────────────────────

function serializeState(state: ReturnType<ClusterDomain['getState']>) {
  if (!state) return null;
  return {
    self: state.self,
    peers: Object.fromEntries(state.peers),
    generation: state.generation,
  };
}

function serializeNodeList(state: ReturnType<ClusterDomain['getState']>): ClusterNode[] {
  if (!state) return [];
  return [state.self, ...state.peers.values()];
}

// ── Route Registration ────────────────────────────────────────────

export function registerClusterRoutes(app: FastifyInstance, deps: ClusterRouteDeps): void {
  const { domain } = deps;

  // ── GET /cluster/state — full cluster state ──

  app.get('/cluster/state', async (_request, reply) => {
    if (!domain.isEnabled()) return clusterDisabledReply(reply);

    const state = domain.getState();
    return reply.status(200).send(serializeState(state));
  });

  // ── GET /cluster/nodes — node list ──

  app.get('/cluster/nodes', async (_request, reply) => {
    if (!domain.isEnabled()) return clusterDisabledReply(reply);

    const state = domain.getState();
    return reply.status(200).send({ nodes: serializeNodeList(state) });
  });

  // ── GET /cluster/nodes/:nodeId — single node detail ──

  app.get<{ Params: { nodeId: string } }>('/cluster/nodes/:nodeId', async (request, reply) => {
    if (!domain.isEnabled()) return clusterDisabledReply(reply);

    const { nodeId } = request.params;
    const state = domain.getState();
    if (!state) return reply.status(500).send({ error: 'Cluster state unavailable' });

    // Check self first
    if (state.self.nodeId === nodeId) {
      return reply.status(200).send(state.self);
    }

    // Check peers
    const peer = state.peers.get(nodeId);
    if (!peer) {
      return reply.status(404).send({ error: `Node ${nodeId} not found` });
    }

    return reply.status(200).send(peer);
  });

  // ── POST /cluster/join — peer join notification ──

  app.post<{
    Body: { node: ClusterNode };
  }>('/cluster/join', async (request, reply) => {
    if (!domain.isEnabled()) return clusterDisabledReply(reply);

    const { node } = request.body ?? {};
    if (!node || !node.nodeId) {
      return reply.status(400).send({ error: 'Missing required field: node' });
    }

    const manager = domain.getManager();
    if (!manager) return reply.status(500).send({ error: 'Manager unavailable' });

    manager.handleJoin(node);
    app.log.info(`[cluster] Peer joined: ${node.nodeId} (${node.instanceName})`);

    return reply.status(200).send({ acknowledged: true, generation: manager.getState().generation });
  });

  // ── POST /cluster/leave — peer leave notification ──

  app.post<{
    Body: { nodeId: string };
  }>('/cluster/leave', async (request, reply) => {
    if (!domain.isEnabled()) return clusterDisabledReply(reply);

    const { nodeId } = request.body ?? {};
    if (!nodeId || typeof nodeId !== 'string') {
      return reply.status(400).send({ error: 'Missing required field: nodeId' });
    }

    const manager = domain.getManager();
    if (!manager) return reply.status(500).send({ error: 'Manager unavailable' });

    manager.handleLeave(nodeId);
    app.log.info(`[cluster] Peer left: ${nodeId}`);

    return reply.status(200).send({ acknowledged: true, generation: manager.getState().generation });
  });

  // ── POST /cluster/ping — heartbeat ping ──

  app.post<{
    Body: { from: string; generation: number };
  }>('/cluster/ping', async (request, reply) => {
    if (!domain.isEnabled()) return clusterDisabledReply(reply);

    const { from, generation } = request.body ?? {};
    if (!from || typeof from !== 'string') {
      return reply.status(400).send({ error: 'Missing required field: from' });
    }

    const manager = domain.getManager();
    if (!manager) return reply.status(500).send({ error: 'Manager unavailable' });

    manager.handleHeartbeat(from);

    const state = manager.getState();
    return reply.status(200).send({
      type: 'ack',
      from: state.self.nodeId,
      generation: state.generation,
    });
  });

  // ── POST /cluster/events — receive federated events ──

  app.post<{
    Body: { from: string; events: FederatedEvent[] };
  }>('/cluster/events', async (request, reply) => {
    if (!domain.isEnabled()) return clusterDisabledReply(reply);

    const { from, events } = request.body ?? {};
    if (!from || !Array.isArray(events)) {
      return reply.status(400).send({ error: 'Missing required fields: from, events' });
    }

    // For now, log and acknowledge — federation sink comes in C-5
    app.log.info(`[cluster] Received ${events.length} federated event(s) from ${from}`);

    return reply.status(200).send({ acknowledged: true, received: events.length });
  });

  // ── POST /cluster/drain — set self to draining status ──

  app.post('/cluster/drain', async (_request, reply) => {
    if (!domain.isEnabled()) return clusterDisabledReply(reply);

    const state = domain.getState();
    if (!state) return reply.status(500).send({ error: 'Cluster state unavailable' });

    state.self.status = 'draining';
    app.log.info(`[cluster] Node ${state.self.nodeId} entering drain mode`);

    return reply.status(200).send({
      nodeId: state.self.nodeId,
      status: 'draining',
    });
  });

  // ── POST /cluster/resume — clear draining status ──

  app.post('/cluster/resume', async (_request, reply) => {
    if (!domain.isEnabled()) return clusterDisabledReply(reply);

    const state = domain.getState();
    if (!state) return reply.status(500).send({ error: 'Cluster state unavailable' });

    state.self.status = 'alive';
    app.log.info(`[cluster] Node ${state.self.nodeId} resumed from drain mode`);

    return reply.status(200).send({
      nodeId: state.self.nodeId,
      status: 'alive',
    });
  });
}
