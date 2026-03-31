// ── Cluster Domain Core ─────────────────────────────────────────
//
// Orchestrates the MembershipManager lifecycle within the bridge.
// When CLUSTER_ENABLED=false, all methods are no-ops — zero network
// calls, zero timers, zero resource overhead.

import {
  MembershipManager,
  type ClusterState,
  type ClusterNode,
  type DiscoveryProvider,
  type NetworkProvider,
  type ResourceProvider,
  type PeerAddress,
} from '@method/cluster';
import type { ClusterConfig } from './config.js';

// ── Logger Interface ──────────────────────────────────────────────

export interface ClusterLogger {
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
}

// ── Cluster Domain ────────────────────────────────────────────────

export class ClusterDomain {
  private readonly config: ClusterConfig;
  private readonly logger: ClusterLogger;
  private readonly manager: MembershipManager | null;
  private readonly ports: {
    discovery: DiscoveryProvider;
    network: NetworkProvider;
    resources: ResourceProvider;
  } | null;

  constructor(
    config: ClusterConfig,
    ports: {
      discovery: DiscoveryProvider;
      network: NetworkProvider;
      resources: ResourceProvider;
    },
    logger: ClusterLogger,
  ) {
    this.config = config;
    this.logger = logger;

    if (!config.enabled) {
      this.manager = null;
      this.ports = null;
      return;
    }

    this.ports = { discovery: ports.discovery, network: ports.network, resources: ports.resources };

    this.manager = new MembershipManager(
      {
        nodeId: config.nodeId,
        instanceName: config.instanceName ?? 'bridge',
        address: {
          host: config.host ?? 'localhost',
          port: config.port ?? 3456,
        },
      },
      {
        discovery: ports.discovery,
        network: ports.network,
        resources: ports.resources,
        onSendError: (peer: PeerAddress, err: Error) => {
          logger.warn(`[cluster] send to ${peer.host}:${peer.port} failed: ${err.message}`);
        },
      },
      {
        heartbeatMs: config.heartbeatMs,
        suspectTimeoutMs: config.suspectTimeoutMs,
        stateBroadcastMs: config.stateBroadcastMs,
        maxPeers: config.maxPeers,
      },
    );
  }

  /** Whether the cluster subsystem is active. */
  isEnabled(): boolean {
    return this.config.enabled;
  }

  /** Start membership manager and run initial discovery. */
  async start(): Promise<void> {
    if (!this.manager || !this.ports) {
      this.logger.info('[cluster] Cluster disabled — skipping start');
      return;
    }

    this.logger.info(`[cluster] Starting cluster node ${this.config.nodeId}`);
    this.manager.start();

    // Run initial peer discovery — without this, the node starts with zero peers
    try {
      const peers = await this.ports.discovery.discover();
      for (const addr of peers) {
        try {
          await this.ports.network.send(addr, {
            type: 'join',
            from: this.manager.getState().self.nodeId,
            node: this.manager.getState().self,
          });
        } catch {
          this.logger.warn(`[cluster] Failed to announce to ${addr.host}:${addr.port}`);
        }
      }
      if (peers.length > 0) {
        this.logger.info(`[cluster] Initial discovery found ${peers.length} peer(s)`);
      }
    } catch (err) {
      this.logger.warn(`[cluster] Initial discovery failed: ${(err as Error).message}`);
    }

    this.logger.info('[cluster] Membership manager started');
  }

  /** Stop membership manager and announce leave to peers. */
  async stop(): Promise<void> {
    if (!this.manager || !this.ports) return;

    this.logger.info('[cluster] Stopping cluster node — announcing leave to peers');

    // Best-effort parallel leave announcement with total timeout
    const state = this.manager.getState();
    const leaveMsg = {
      type: 'leave' as const,
      from: state.self.nodeId,
      nodeId: state.self.nodeId,
    };

    const alivePeers = [...state.peers.values()].filter(
      p => p.status === 'alive' || p.status === 'suspect',
    );

    if (alivePeers.length > 0) {
      const sends = alivePeers.map(peer =>
        this.ports!.network.send(peer.address, leaveMsg).catch(() => {
          // Best-effort — peer will eventually detect via timeout
        }),
      );

      // Race all sends against a 10s total timeout
      const timeout = new Promise<void>(resolve => setTimeout(resolve, 10_000));
      await Promise.race([Promise.allSettled(sends), timeout]);
    }

    this.manager.stop();
    this.logger.info('[cluster] Membership manager stopped');
  }

  /** Get the current cluster state. Returns null when disabled. */
  getState(): ClusterState | null {
    if (!this.manager) return null;
    return this.manager.getState();
  }

  /** Get the underlying MembershipManager. Returns null when disabled. */
  getManager(): MembershipManager | null {
    return this.manager;
  }

  /** Get the cluster config. */
  getConfig(): ClusterConfig {
    return this.config;
  }
}
