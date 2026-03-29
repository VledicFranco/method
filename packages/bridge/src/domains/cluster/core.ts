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
      return;
    }

    this.manager = new MembershipManager(
      {
        nodeId: config.nodeId,
        instanceName: process.env.INSTANCE_NAME ?? 'bridge',
        address: {
          host: process.env.HOST ?? 'localhost',
          port: parseInt(process.env.PORT ?? '3456', 10),
        },
      },
      { discovery: ports.discovery, network: ports.network, resources: ports.resources },
      {
        heartbeatMs: config.heartbeatMs,
        suspectTimeoutMs: config.suspectTimeoutMs,
        stateBroadcastMs: config.stateBroadcastMs,
      },
    );
  }

  /** Whether the cluster subsystem is active. */
  isEnabled(): boolean {
    return this.config.enabled;
  }

  /** Start membership manager and run initial discovery. */
  async start(): Promise<void> {
    if (!this.manager) {
      this.logger.info('[cluster] Cluster disabled — skipping start');
      return;
    }

    this.logger.info(`[cluster] Starting cluster node ${this.config.nodeId}`);
    this.manager.start();
    this.logger.info('[cluster] Membership manager started');
  }

  /** Stop membership manager and announce leave to peers. */
  async stop(): Promise<void> {
    if (!this.manager) return;

    this.logger.info('[cluster] Stopping cluster node');
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
