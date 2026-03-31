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
 *   POST   /cluster/state-sync     — Receive full state broadcast from peer
 *   POST   /cluster/events         — Receive federated events
 *   POST   /cluster/drain          — Set self to draining status
 *   POST   /cluster/resume         — Clear draining status
 *   POST   /cluster/route          — Route work to best available node
 *
 * When CLUSTER_ENABLED=false, all endpoints return 404.
 */

import { z } from 'zod';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { ClusterDomain } from './core.js';
import type { ClusterNode, FederatedEvent, WorkRequest } from '@method/cluster';
import type { CapacityWeightedRouter } from '@method/cluster';
import type { HttpNetwork } from './adapters/http-network.js';
import type { EventBus, BridgeEventInput } from '../../ports/event-bus.js';

// ── Zod Schemas for Route Body Validation ─────────────────────

const PeerAddressSchema = z.object({
  host: z.string().min(1),
  port: z.number().int().positive(),
});

const ResourceSnapshotSchema = z.object({
  nodeId: z.string().min(1),
  instanceName: z.string(),
  cpuCount: z.number(),
  cpuLoadPercent: z.number(),
  memoryTotalMb: z.number(),
  memoryAvailableMb: z.number(),
  sessionsActive: z.number(),
  sessionsMax: z.number(),
  projectCount: z.number(),
  uptimeMs: z.number(),
  version: z.string(),
});

const ClusterNodeSchema = z.object({
  nodeId: z.string().min(1),
  instanceName: z.string(),
  address: PeerAddressSchema,
  resources: ResourceSnapshotSchema,
  status: z.enum(['alive', 'suspect', 'dead', 'draining']),
  lastSeen: z.number(),
  projects: z.array(z.object({ projectId: z.string(), name: z.string() })),
});

const JoinBodySchema = z.object({
  node: ClusterNodeSchema,
});

const LeaveBodySchema = z.object({
  nodeId: z.string().min(1),
});

const PingBodySchema = z.object({
  from: z.string().min(1),
  generation: z.number().int(),
});

const StateSyncBodySchema = z.object({
  from: z.string().min(1),
  nodes: z.array(ClusterNodeSchema),
});

const FederatedEventSchema = z.object({
  domain: z.string().min(1),
  type: z.string().min(1),
  severity: z.enum(['debug', 'info', 'warning', 'error', 'critical']),
  payload: z.record(z.unknown()),
  timestamp: z.number(),
  sourceNodeId: z.string().min(1),
});

const EventRelayBodySchema = z.object({
  from: z.string().min(1),
  events: z.array(FederatedEventSchema),
});

const WorkRequestTypeSchema = z.enum(['strategy', 'session', 'genesis']);

const RouteBodySchema = z.object({
  type: WorkRequestTypeSchema,
  projectId: z.string().optional(),
  resourceHint: z.enum(['cpu', 'memory', 'sessions']).optional(),
  excludeNodes: z.array(z.string()).optional(),
});

// ── Route Deps ────────────────────────────────────────────────

export interface ClusterRouteDeps {
  domain: ClusterDomain;
  /** Optional capacity-weighted router for POST /cluster/route. When absent, returns 501. */
  router?: CapacityWeightedRouter;
  /** HttpNetwork adapter for dispatching inbound messages through the L3 port contract. */
  network?: HttpNetwork;
  /** EventBus for injecting inbound federated events. */
  eventBus?: EventBus;
  /** Optional shared secret for authenticating cluster POST requests. */
  clusterSecret?: string;
}

// ── Disabled Guard ────────────────────────────────────────────

function clusterDisabledReply(reply: { status(code: number): { send(body: unknown): unknown } }) {
  return reply.status(404).send({ error: 'Cluster not enabled' });
}

// ── Auth Guard ────────────────────────────────────────────────

function checkClusterSecret(
  request: FastifyRequest,
  reply: FastifyReply,
  secret: string | undefined,
): boolean {
  if (!secret) return true; // no secret configured — allow all
  const provided = request.headers['x-cluster-secret'];
  if (provided !== secret) {
    reply.status(401).send({ error: 'Invalid or missing x-cluster-secret header' });
    return false;
  }
  return true;
}

// ── Helper: serialize ClusterState for JSON ───────────────────

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

// ── Route Registration ────────────────────────────────────────

export function registerClusterRoutes(app: FastifyInstance, deps: ClusterRouteDeps): void {
  const { domain, router, network, eventBus, clusterSecret } = deps;

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

  app.post('/cluster/join', async (request, reply) => {
    if (!domain.isEnabled()) return clusterDisabledReply(reply);
    if (!checkClusterSecret(request, reply, clusterSecret)) return;

    const parsed = JoinBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid body', details: parsed.error.issues });
    }

    const { node } = parsed.data;

    // Dispatch through L3 port contract via HttpNetwork
    if (network) {
      const peerAddress = { host: request.ip ?? 'unknown', port: 0 };
      network.dispatch(peerAddress, { type: 'join', from: node.nodeId, node: node as ClusterNode });
    } else {
      // Fallback: call manager directly (backward compatibility)
      const manager = domain.getManager();
      if (!manager) return reply.status(500).send({ error: 'Manager unavailable' });
      manager.handleJoin(node as ClusterNode);
    }

    app.log.info(`[cluster] Peer joined: ${node.nodeId} (${node.instanceName})`);

    const manager = domain.getManager();
    return reply.status(200).send({ acknowledged: true, generation: manager?.getState().generation ?? 0 });
  });

  // ── POST /cluster/leave — peer leave notification ──

  app.post('/cluster/leave', async (request, reply) => {
    if (!domain.isEnabled()) return clusterDisabledReply(reply);
    if (!checkClusterSecret(request, reply, clusterSecret)) return;

    const parsed = LeaveBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid body', details: parsed.error.issues });
    }

    const { nodeId } = parsed.data;

    if (network) {
      const peerAddress = { host: request.ip ?? 'unknown', port: 0 };
      network.dispatch(peerAddress, { type: 'leave', from: nodeId, nodeId });
    } else {
      const manager = domain.getManager();
      if (!manager) return reply.status(500).send({ error: 'Manager unavailable' });
      manager.handleLeave(nodeId);
    }

    app.log.info(`[cluster] Peer left: ${nodeId}`);

    const manager = domain.getManager();
    return reply.status(200).send({ acknowledged: true, generation: manager?.getState().generation ?? 0 });
  });

  // ── POST /cluster/ping — heartbeat ping ──

  app.post('/cluster/ping', async (request, reply) => {
    if (!domain.isEnabled()) return clusterDisabledReply(reply);
    if (!checkClusterSecret(request, reply, clusterSecret)) return;

    const parsed = PingBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid body', details: parsed.error.issues });
    }

    const { from } = parsed.data;

    if (network) {
      const peerAddress = { host: request.ip ?? 'unknown', port: 0 };
      network.dispatch(peerAddress, { type: 'ping', from, generation: parsed.data.generation });
    } else {
      const manager = domain.getManager();
      if (!manager) return reply.status(500).send({ error: 'Manager unavailable' });
      manager.handleHeartbeat(from);
    }

    const manager = domain.getManager();
    if (!manager) return reply.status(500).send({ error: 'Manager unavailable' });

    const state = manager.getState();
    return reply.status(200).send({
      type: 'ack',
      from: state.self.nodeId,
      generation: state.generation,
    });
  });

  // ── POST /cluster/state-sync — receive full state broadcast from peer ──

  app.post('/cluster/state-sync', async (request, reply) => {
    if (!domain.isEnabled()) return clusterDisabledReply(reply);
    if (!checkClusterSecret(request, reply, clusterSecret)) return;

    const parsed = StateSyncBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid body', details: parsed.error.issues });
    }

    const { from, nodes } = parsed.data;

    // Dispatch through L3 port contract — mergeState handles deduplication
    if (network) {
      const peerAddress = { host: request.ip ?? 'unknown', port: 0 };
      network.dispatch(peerAddress, { type: 'state-sync', from, nodes: nodes as ClusterNode[] });
    } else {
      const manager = domain.getManager();
      if (!manager) return reply.status(500).send({ error: 'Manager unavailable' });
      // Fallback: process each node (less optimal — uses handleJoin instead of mergeState)
      for (const node of nodes) {
        if (node.nodeId === manager.getState().self.nodeId) continue;
        manager.handleJoin(node as ClusterNode);
      }
    }

    const manager = domain.getManager();
    return reply.status(200).send({ acknowledged: true, generation: manager?.getState().generation ?? 0 });
  });

  // ── POST /cluster/events — receive federated events ──

  app.post('/cluster/events', async (request, reply) => {
    if (!domain.isEnabled()) return clusterDisabledReply(reply);
    if (!checkClusterSecret(request, reply, clusterSecret)) return;

    const parsed = EventRelayBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid body', details: parsed.error.issues });
    }

    const { from, events } = parsed.data;

    app.log.info(`[cluster] Received ${events.length} federated event(s) from ${from}`);

    // Inject federated events into the local event bus with federated marker
    if (eventBus) {
      for (const evt of events) {
        const bridgeEvent: BridgeEventInput = {
          version: 1,
          domain: evt.domain,
          type: evt.type,
          // Bridge EventSeverity does not include 'debug' — map to 'info'
          severity: evt.severity === 'debug' ? 'info' : evt.severity as BridgeEventInput['severity'],
          payload: evt.payload,
          source: `cluster/federation/${from}`,
          sourceNodeId: evt.sourceNodeId,
          federated: true,
        };
        eventBus.emit(bridgeEvent);
      }
    }

    return reply.status(200).send({ acknowledged: true, received: events.length });
  });

  // ── POST /cluster/drain — set self to draining status ──

  app.post('/cluster/drain', async (request, reply) => {
    if (!domain.isEnabled()) return clusterDisabledReply(reply);
    if (!checkClusterSecret(request, reply, clusterSecret)) return;

    const manager = domain.getManager();
    if (!manager) return reply.status(500).send({ error: 'Manager unavailable' });

    manager.setStatus('draining');
    const state = manager.getState();
    app.log.info(`[cluster] Node ${state.self.nodeId} entering drain mode`);

    return reply.status(200).send({
      nodeId: state.self.nodeId,
      status: 'draining',
    });
  });

  // ── POST /cluster/resume — clear draining status ──

  app.post('/cluster/resume', async (request, reply) => {
    if (!domain.isEnabled()) return clusterDisabledReply(reply);
    if (!checkClusterSecret(request, reply, clusterSecret)) return;

    const manager = domain.getManager();
    if (!manager) return reply.status(500).send({ error: 'Manager unavailable' });

    manager.setStatus('alive');
    const state = manager.getState();
    app.log.info(`[cluster] Node ${state.self.nodeId} resumed from drain mode`);

    return reply.status(200).send({
      nodeId: state.self.nodeId,
      status: 'alive',
    });
  });

  // ── POST /cluster/route — route work to best available node ──

  app.post('/cluster/route', async (request, reply) => {
    if (!domain.isEnabled()) return clusterDisabledReply(reply);
    if (!checkClusterSecret(request, reply, clusterSecret)) return;

    if (!router) {
      return reply.status(501).send({ error: 'Router not configured' });
    }

    const parsed = RouteBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid body', details: parsed.error.issues });
    }

    const state = domain.getState();
    if (!state) return reply.status(500).send({ error: 'Cluster state unavailable' });

    const workRequest: WorkRequest = {
      type: parsed.data.type,
      projectId: parsed.data.projectId,
      resourceHint: parsed.data.resourceHint,
      excludeNodes: parsed.data.excludeNodes,
    };

    const bestNode = router.selectNode(workRequest, state);
    if (!bestNode) {
      return reply.status(404).send({ error: 'No node with available capacity' });
    }

    const score = router.score(bestNode, workRequest);

    return reply.status(200).send({ node: bestNode, score });
  });
}
