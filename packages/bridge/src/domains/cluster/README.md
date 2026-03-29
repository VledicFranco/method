---
title: Cluster
scope: domain
package: bridge
contents:
  - index.ts
  - config.ts
  - core.ts
  - core.test.ts
  - routes.ts
  - routes.test.ts
  - adapters/tailscale-discovery.ts
  - adapters/tailscale-discovery.test.ts
  - adapters/http-network.ts
  - adapters/http-network.test.ts
  - adapters/node-resource.ts
  - adapters/node-resource.test.ts
---

# Cluster

Bridge domain for multi-machine cluster coordination (PRD 039 Phase 2). Wraps the transport-agnostic `@method/cluster` package with bridge-specific adapters and HTTP routes.

When `CLUSTER_ENABLED=false` (default), the domain is a complete no-op: no timers, no network calls, no resource overhead. When enabled, it discovers peer bridges (via Tailscale or static seeds), maintains cluster membership through heartbeat-based failure detection, and exposes HTTP endpoints for peer coordination.

## Architecture

```
ClusterDomain (core.ts)
  |-- MembershipManager (@method/cluster)
  |     |-- DiscoveryProvider  <-- TailscaleDiscovery (adapters/)
  |     |-- NetworkProvider    <-- HttpNetwork (adapters/)
  |     \-- ResourceProvider   <-- NodeResource (adapters/)
  \-- registerClusterRoutes (routes.ts)
```

The domain follows the port/adapter pattern: `@method/cluster` defines transport-agnostic port interfaces, and this domain provides concrete implementations injected at the composition root.

## Configuration

All values load from `CLUSTER_*` environment variables via Zod-validated config (config.ts).

| Variable | Type | Default | Description |
|----------|------|---------|-------------|
| `CLUSTER_ENABLED` | boolean | `false` | Master switch for the cluster subsystem |
| `CLUSTER_NODE_ID` | string | auto-UUID | Stable node identity, persisted to `.method/cluster-node-id` |
| `CLUSTER_SEEDS` | string | `""` | Comma-separated seed peer addresses (host:port) |
| `CLUSTER_HEARTBEAT_MS` | number | `5000` | Heartbeat interval |
| `CLUSTER_SUSPECT_TIMEOUT_MS` | number | `15000` | Time before marking unresponsive peer as suspect |
| `CLUSTER_STATE_BROADCAST_MS` | number | `10000` | Full state sync broadcast interval |
| `CLUSTER_FEDERATION_ENABLED` | boolean | `true` | Whether to relay events to/from peers |
| `CLUSTER_FEDERATION_FILTER_SEVERITY` | string | `"warning,error,critical"` | Event severity filter for federation |
| `CLUSTER_FEDERATION_FILTER_DOMAIN` | string | `""` | Domain filter for federated events (empty = all) |

## HTTP Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/cluster/state` | Full cluster state with all nodes |
| GET | `/cluster/nodes` | Node list with status and resources |
| GET | `/cluster/nodes/:nodeId` | Single node detail |
| POST | `/cluster/join` | Peer join notification |
| POST | `/cluster/leave` | Peer leave notification |
| POST | `/cluster/ping` | Heartbeat ping (returns ack + state) |
| POST | `/cluster/events` | Receive federated events |
| POST | `/cluster/drain` | Set self to draining status |
| POST | `/cluster/resume` | Clear draining status |

All endpoints return `404 { error: "Cluster not enabled" }` when `CLUSTER_ENABLED=false`.

## Adapters

| Adapter | Port | Description |
|---------|------|-------------|
| `TailscaleDiscovery` | `DiscoveryProvider` | Uses `tailscale status --json` to find peers, falls back to seeds |
| `HttpNetwork` | `NetworkProvider` | Sends/receives cluster messages via HTTP POST |
| `NodeResource` | `ResourceProvider` | Reports CPU, memory, session, and project counts via `node:os` |

## Module Map

| Module | Purpose |
|--------|---------|
| [index.ts](index.ts) | Barrel exports for all cluster domain types and implementations |
| [config.ts](config.ts) | Zod config schema loading from CLUSTER_* env vars |
| [core.ts](core.ts) | ClusterDomain class — lifecycle orchestration around MembershipManager |
| [routes.ts](routes.ts) | Fastify HTTP routes for cluster coordination |
| [adapters/tailscale-discovery.ts](adapters/tailscale-discovery.ts) | Tailscale CLI + seed fallback discovery |
| [adapters/http-network.ts](adapters/http-network.ts) | HTTP POST peer messaging |
| [adapters/node-resource.ts](adapters/node-resource.ts) | OS-level resource snapshot reporting |
