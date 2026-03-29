/** Cluster domain barrel — core lifecycle, config, routes, and adapters. */

export { ClusterDomain } from './core.js';
export type { ClusterLogger } from './core.js';

export { ClusterConfigSchema, loadClusterConfig, resolvePersistedNodeId } from './config.js';
export type { ClusterConfig, NodeIdFs } from './config.js';

export { registerClusterRoutes } from './routes.js';
export type { ClusterRouteDeps } from './routes.js';

export { TailscaleDiscovery } from './adapters/tailscale-discovery.js';
export type { TailscaleDiscoveryConfig, TailscaleDiscoveryLogger } from './adapters/tailscale-discovery.js';

export { HttpNetwork } from './adapters/http-network.js';

export { NodeResource } from './adapters/node-resource.js';
export type { NodeResourceConfig, NodeResourceCallbacks } from './adapters/node-resource.js';
