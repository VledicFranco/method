# @method/cluster — Cluster Protocol

L3 library. Transport-agnostic cluster protocol for coordinating multiple bridge instances. Defines membership state machine, resource reporting, work routing, and peer federation. Zero transport dependencies — all I/O enters through ports.

## Purpose

Enables multiple bridge instances to discover each other, share load, and federate events. A cluster node knows its peers' resource availability and routes work (agent sessions) to the least-loaded node.

## Core Concepts

- **Node identity** — each bridge instance is a cluster node with `nodeId`, `address`, and a `ResourceSnapshot` (CPU, memory, active sessions)
- **Membership** — `MembershipManager` maintains a live view of the cluster: which nodes are online, their last heartbeat, their resource state
- **Federation** — `FederationManager` propagates events across nodes so all instances share the same event stream
- **Routing** — `RoutingManager` selects target nodes for work requests based on resource capacity

## Public API

```typescript
import { MembershipManager, RoutingManager, FederationManager } from '@method/cluster';

// Wire with ports
const membership = new MembershipManager({ discovery, network, resource }, config);
await membership.start();

// Route work to least-loaded peer
const target = await routing.selectNode({ type: 'session', requirements: { minMemoryMb: 512 } });

// Query cluster state
const state = membership.getClusterState(); // { nodes: ClusterNode[], self: NodeIdentity }
```

## Port Interfaces

| Port | Description |
|------|-------------|
| `DiscoveryProvider` | Peer discovery (mDNS, static list, Kubernetes DNS) |
| `NetworkProvider` | Send/receive `ClusterMessage` over chosen transport |
| `ResourceProvider` | Read local resource snapshot (CPU, memory, sessions) |

## Key Types

- `ClusterNode` — node identity + status + resource snapshot
- `ClusterMessage` — typed message envelope (heartbeat, work-request, federated-event)
- `ResourceSnapshot` — CPU usage, memory available, active session count, GPU stats
- `FederatedEvent` — bridge event wrapped for cross-node propagation
- `ProjectSummary` — project metadata shared across nodes for routing decisions
