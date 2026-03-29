// ── @method/cluster — Public API ────────────────────────────────
//
// Transport-agnostic cluster protocol package (L3). Defines
// membership state machine, resource reporting, and port interfaces
// for discovery, networking, and resource monitoring.
//
// Zero transport dependencies — all I/O enters through ports.

// ── Types ───────────────────────────────────────────────────────

export type {
  PeerAddress,
  NodeIdentity,
  NodeStatus,
  ClusterNode,
  ClusterState,
  ClusterMessage,
  ResourceSnapshot,
  FederatedEvent,
  ProjectSummary,
  WorkRequest,
} from './types.js';

// ── Port Interfaces ─────────────────────────────────────────────

export type { DiscoveryProvider } from './ports/discovery-provider.js';
export type { NetworkProvider } from './ports/network-provider.js';
export type { ResourceProvider } from './ports/resource-provider.js';

// ── Membership ──────────────────────────────────────────────────

export { MembershipManager } from './membership/membership.js';
export type { MembershipPorts } from './membership/membership.js';
export { MembershipConfigSchema, resolveConfig } from './membership/membership.config.js';
export type { MembershipConfig } from './membership/membership.config.js';

// ── Resources ───────────────────────────────────────────────────

export {
  ResourceSnapshotSchema,
  parseResourceSnapshot,
  safeParseResourceSnapshot,
} from './resources/resource-schema.js';

// ── Test Doubles ────────────────────────────────────────────────

export { FakeDiscovery } from './test-doubles/fake-discovery.js';
export { FakeNetwork } from './test-doubles/fake-network.js';
export { FakeResources } from './test-doubles/fake-resources.js';
