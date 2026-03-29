// ── @method/cluster — Shared Cluster Types ─────────────────────
//
// Transport-agnostic types for the cluster protocol. These define
// the shape of cluster state, peer identity, and message formats.
// No runtime dependencies — pure type definitions + discriminated unions.

// ── Peer Identity & Addressing ──────────────────────────────────

/** Network-level address for reaching a peer bridge. */
export interface PeerAddress {
  /** Hostname or IP (e.g., Tailscale MagicDNS name). */
  host: string;
  /** Port the bridge listens on. */
  port: number;
}

/** Stable identity of a bridge node. */
export interface NodeIdentity {
  /** Stable UUID per bridge install. */
  nodeId: string;
  /** Human-readable instance name (from INSTANCE_NAME env var). */
  instanceName: string;
  /** How to reach this node. */
  address: PeerAddress;
}

// ── Resource Reporting ──────────────────────────────────────────

/** Summary of a discovered project on a node. */
export interface ProjectSummary {
  /** Unique project identifier (git remote URL or name-based). */
  projectId: string;
  /** Human-readable project name. */
  name: string;
}

// ── Cluster Node & State ────────────────────────────────────────

/** Possible lifecycle statuses for a cluster node. */
export type NodeStatus = 'alive' | 'suspect' | 'dead' | 'draining';

/** A single node in the cluster, with its last-known state. */
export interface ClusterNode {
  /** Stable UUID per bridge install. */
  nodeId: string;
  /** Human-readable instance name. */
  instanceName: string;
  /** How to reach this node. */
  address: PeerAddress;
  /** Last known resource snapshot. */
  resources: ResourceSnapshot;
  /** Lifecycle status. */
  status: NodeStatus;
  /** Epoch ms of last heartbeat received. */
  lastSeen: number;
  /** Projects discovered on this node. */
  projects: ProjectSummary[];
}

/** Full cluster state as seen by a single node. */
export interface ClusterState {
  /** This node's own state. */
  self: ClusterNode;
  /** Known peers, keyed by nodeId. */
  peers: Map<string, ClusterNode>;
  /** Monotonic generation counter — increments on every state change. */
  generation: number;
}

// ── Resource Snapshot ───────────────────────────────────────────

/** Point-in-time resource report for a node (defined here, re-exported from ports). */
export interface ResourceSnapshot {
  nodeId: string;
  instanceName: string;
  cpuCount: number;
  /** 1-minute load average as a percentage (0–100+). */
  cpuLoadPercent: number;
  memoryTotalMb: number;
  memoryAvailableMb: number;
  sessionsActive: number;
  sessionsMax: number;
  projectCount: number;
  uptimeMs: number;
  version: string;
}

// ── Federated Events ────────────────────────────────────────────

/** An event relayed from one bridge to another. */
export interface FederatedEvent {
  /** Domain that emitted the event (e.g., 'sessions', 'strategies'). */
  domain: string;
  /** Domain-owned type string (e.g., 'session.spawned', 'strategy.gate_failed'). */
  type: string;
  /** Severity level. */
  severity: 'debug' | 'info' | 'warning' | 'error' | 'critical';
  /** Event payload (opaque to the cluster layer). */
  payload: Record<string, unknown>;
  /** Epoch ms when the event was originally emitted. */
  timestamp: number;
  /** nodeId of the originating bridge. */
  sourceNodeId: string;
}

// ── Work Routing ────────────────────────────────────────────────

/** A request to route work to the best available node. */
export interface WorkRequest {
  /** Kind of work to execute. */
  type: 'strategy' | 'session' | 'genesis';
  /** Prefer a node that has this project cloned locally. */
  projectId?: string;
  /** Which resource dimension matters most. */
  resourceHint?: 'cpu' | 'memory' | 'sessions';
  /** Nodes to exclude (e.g., already tried and failed). */
  excludeNodes?: string[];
}

// ── Cluster Messages (Discriminated Union) ──────────────────────

export type ClusterMessage =
  | { type: 'ping'; from: string; generation: number }
  | { type: 'ack'; from: string; generation: number; state: ClusterState }
  | { type: 'join'; from: string; node: ClusterNode }
  | { type: 'leave'; from: string; nodeId: string }
  | { type: 'state-sync'; from: string; nodes: ClusterNode[] }
  | { type: 'event-relay'; from: string; events: FederatedEvent[] };
