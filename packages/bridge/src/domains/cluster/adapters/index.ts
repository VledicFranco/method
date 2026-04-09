/**
 * cluster/adapters/ — L4 adapter implementations for cluster L3 port interfaces.
 *
 * HttpNetworkAdapter: NetworkProvider impl — peer-to-peer HTTP messaging.
 * NodeResourceAdapter: ResourceProvider impl — CPU/memory reporting via node:os.
 * TailscaleDiscoveryAdapter: DiscoveryProvider impl — peer discovery via Tailscale API.
 *
 * Instantiated in server-entry.ts, injected into MembershipManager at startup.
 */

export * from './http-network.js';
export * from './node-resource.js';
export * from './tailscale-discovery.js';
