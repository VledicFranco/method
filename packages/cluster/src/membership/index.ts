/**
 * membership/ — Cluster membership state machine (PRD 039).
 *
 * MembershipManager: join/leave/suspect/dead state transitions.
 *   Heartbeat-driven with configurable intervals (language primitives only —
 *   no transport dependencies). All I/O through injected port interfaces.
 *
 * Ports bundle: { discovery: DiscoveryProvider, network: NetworkProvider,
 *   resources: ResourceProvider } — injected at the composition root.
 */

export { MembershipManager } from './membership.js';
export type { MembershipPorts } from './membership.js';
export { MembershipConfigSchema, resolveConfig } from './membership.config.js';
export type { MembershipConfig } from './membership.config.js';
