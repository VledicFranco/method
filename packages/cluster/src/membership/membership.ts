// ── Membership Manager ──────────────────────────────────────────
//
// State machine managing cluster membership: join, leave, suspect,
// dead transitions. Uses configurable heartbeat intervals with
// setInterval/setTimeout (language primitives, not transport deps).
//
// All I/O enters through port interfaces injected via constructor.
//
// Consistency model: eventual consistency, no split-brain protection.
// Designed for small (2-10 node) trusted clusters on Tailscale.
// Partitioned halves operate independently; state reconciles on
// partition heal via state-sync merge (latest lastSeen wins).
// No quorum or leader election.
//
// Clock assumption: assumes NTP-synchronized clocks across cluster
// nodes. mergeState() uses wall-clock timestamps (lastSeen) for
// conflict resolution. Clock skew > heartbeatMs may cause stale
// state to win merge conflicts.

import type { ClusterState, ClusterNode, NodeIdentity, PeerAddress, ClusterMessage, NodeStatus } from '../types.js';
import type { DiscoveryProvider } from '../ports/discovery-provider.js';
import type { NetworkProvider } from '../ports/network-provider.js';
import type { ResourceProvider } from '../ports/resource-provider.js';
import { MembershipConfigSchema, resolveConfig } from './membership.config.js';
import type { MembershipConfig } from './membership.config.js';

// ── Ports Bundle ────────────────────────────────────────────────

export interface MembershipPorts {
  discovery: DiscoveryProvider;
  network: NetworkProvider;
  resources: ResourceProvider;
  /** Optional callback for network send errors (L3 has no logger dependency). */
  onSendError?: (peer: PeerAddress, error: Error) => void;
}

// ── Membership Manager ─────────────────────────────────────────

export class MembershipManager {
  private readonly ports: MembershipPorts;
  private readonly config: Required<MembershipConfig>;
  private readonly state: ClusterState;

  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private sweepTimer: ReturnType<typeof setInterval> | null = null;
  private broadcastTimer: ReturnType<typeof setInterval> | null = null;

  /** Inject a clock function for testing (returns epoch ms). */
  public now: () => number;

  constructor(
    identity: NodeIdentity,
    ports: MembershipPorts,
    config: Partial<MembershipConfig> = {},
  ) {
    this.ports = ports;
    this.config = resolveConfig(MembershipConfigSchema.parse(config));
    this.now = () => Date.now();

    const snapshot = ports.resources.snapshot();
    this.state = {
      self: {
        nodeId: identity.nodeId,
        instanceName: identity.instanceName,
        address: identity.address,
        resources: snapshot,
        status: 'alive',
        lastSeen: this.now(),
        projects: [],
      },
      peers: new Map(),
      generation: 0,
    };

    // Wire incoming message handler
    this.ports.network.onMessage((from, msg) => this.handleMessage(from, msg));
  }

  // ── Public API ──────────────────────────────────────────────────

  /** Get the current cluster state (read-only snapshot). */
  getState(): ClusterState {
    // Refresh self resources on every read
    this.refreshSelf();
    return this.state;
  }

  /** Start heartbeat, sweep, and broadcast loops. Idempotent — safe to call twice. */
  start(): void {
    if (this.heartbeatTimer) return; // already running

    // Heartbeat: send ping to all peers
    this.heartbeatTimer = setInterval(() => {
      this.sendHeartbeats();
    }, this.config.heartbeatMs);

    // Sweep: check for suspect/dead/gc transitions
    // Add jitter (80%-120% of heartbeatMs) to avoid thundering herd
    const sweepJitter = Math.floor(this.config.heartbeatMs * (0.8 + 0.4 * Math.random()));
    this.sweepTimer = setInterval(() => {
      this.sweep();
    }, sweepJitter);

    // State broadcast: full state sync to all peers
    this.broadcastTimer = setInterval(() => {
      this.broadcastState();
    }, this.config.stateBroadcastMs);
  }

  /** Stop all timers and announce departure. */
  stop(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    if (this.broadcastTimer) clearInterval(this.broadcastTimer);
    this.heartbeatTimer = null;
    this.sweepTimer = null;
    this.broadcastTimer = null;
  }

  /** Process a node joining the cluster. Rejects if maxPeers limit is reached. */
  handleJoin(node: ClusterNode): void {
    // Allow updating an existing peer even at capacity
    if (!this.state.peers.has(node.nodeId) && this.state.peers.size >= this.config.maxPeers) {
      this.ports.onSendError?.(
        node.address,
        new Error(`maxPeers limit reached (${this.config.maxPeers}), rejecting join from ${node.nodeId}`),
      );
      return;
    }
    this.state.peers.set(node.nodeId, {
      ...node,
      status: 'alive',
      lastSeen: this.now(),
    });
    this.bumpGeneration();
  }

  /** Process a node leaving gracefully. */
  handleLeave(nodeId: string): void {
    this.state.peers.delete(nodeId);
    this.bumpGeneration();
  }

  /** Set this node's status (e.g., draining/alive). Bumps generation. */
  setStatus(status: NodeStatus): void {
    this.state.self.status = status;
    this.bumpGeneration();
  }

  /** Process an incoming heartbeat from a peer. */
  handleHeartbeat(nodeId: string): void {
    const peer = this.state.peers.get(nodeId);
    if (!peer) return;

    const wasNotAlive = peer.status !== 'alive';
    peer.lastSeen = this.now();

    // Recover from suspect back to alive
    if (peer.status === 'suspect') {
      peer.status = 'alive';
    }

    if (wasNotAlive || peer.status === 'alive') {
      this.bumpGeneration();
    }
  }

  // ── Message Handling ──────────────────────────────────────────

  private handleMessage(_from: PeerAddress, msg: ClusterMessage): void {
    switch (msg.type) {
      case 'ping':
        this.handleHeartbeat(msg.from);
        break;

      case 'join':
        this.handleJoin(msg.node);
        break;

      case 'leave':
        this.handleLeave(msg.nodeId);
        break;

      case 'state-sync':
        this.mergeState(msg.nodes);
        break;

      case 'ack':
      case 'event-relay':
        // Handled by other subsystems
        break;
    }
  }

  // ── Internal ──────────────────────────────────────────────────

  private refreshSelf(): void {
    this.state.self.resources = this.ports.resources.snapshot();
    this.state.self.lastSeen = this.now();
  }

  private bumpGeneration(): void {
    this.state.generation++;
  }

  private async sendHeartbeats(): Promise<void> {
    const msg: ClusterMessage = {
      type: 'ping',
      from: this.state.self.nodeId,
      generation: this.state.generation,
    };

    for (const peer of this.state.peers.values()) {
      if (peer.status !== 'dead') {
        try {
          await this.ports.network.send(peer.address, msg);
        } catch (err) {
          this.ports.onSendError?.(peer.address, err as Error);
        }
      }
    }
  }

  private async broadcastState(): Promise<void> {
    this.refreshSelf();
    const nodes = [this.state.self, ...this.state.peers.values()];
    const msg: ClusterMessage = {
      type: 'state-sync',
      from: this.state.self.nodeId,
      nodes,
    };

    for (const peer of this.state.peers.values()) {
      if (peer.status === 'alive' || peer.status === 'suspect') {
        try {
          await this.ports.network.send(peer.address, msg);
        } catch (err) {
          this.ports.onSendError?.(peer.address, err as Error);
        }
      }
    }
  }

  /** Check all peers for timeout transitions. */
  private sweep(): void {
    const now = this.now();
    const toRemove: string[] = [];

    for (const [nodeId, peer] of this.state.peers) {
      const elapsed = now - peer.lastSeen;

      if (peer.status === 'alive' && elapsed > this.config.suspectTimeoutMs) {
        peer.status = 'suspect';
        this.bumpGeneration();
      } else if (peer.status === 'suspect' && elapsed > this.config.deadTimeoutMs) {
        peer.status = 'dead';
        this.bumpGeneration();
      } else if (peer.status === 'dead' && elapsed > this.config.gcTimeoutMs) {
        toRemove.push(nodeId);
      }
    }

    for (const nodeId of toRemove) {
      this.state.peers.delete(nodeId);
      this.bumpGeneration();
    }
  }

  private mergeState(nodes: ClusterNode[]): void {
    for (const node of nodes) {
      if (node.nodeId === this.state.self.nodeId) continue;

      const existing = this.state.peers.get(node.nodeId);
      if (!existing || node.lastSeen > existing.lastSeen) {
        this.state.peers.set(node.nodeId, { ...node });
        this.bumpGeneration();
      }
    }
  }
}
