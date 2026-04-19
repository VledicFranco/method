# Bridge Cluster

## Responsibility

`packages/cluster/` (L3) and `packages/bridge/src/domains/cluster/` (L4) implement peer-to-peer cluster coordination for bridge instances. Bridges on a Tailscale mesh discover each other, share capacity state, route work to the best-available node, and federate events across the cluster.

**Key constraints:**
- `@methodts/cluster` is an L3 package with zero transport dependencies — all I/O enters through port interfaces
- The bridge cluster domain (`domains/cluster/`) is an L4 consumer that provides adapters (Tailscale, HTTP, OS resources)
- Cluster is opt-in (`CLUSTER_ENABLED=false` by default) — zero overhead when disabled
- Bridges communicate over HTTP POST between peers — no shared database or central coordinator

## Architecture

```
Bridge A (mission-control)                    Bridge B (laptop)
┌───────────────────────────────────┐        ┌───────────────────────────────────┐
│ server-entry.ts (composition root)│        │ server-entry.ts (composition root)│
│                                   │        │                                   │
│  ClusterDomain                    │        │  ClusterDomain                    │
│   ├── MembershipManager           │        │   ├── MembershipManager           │
│   │   ├── heartbeat loop ────────────ping────→ │   ├── heartbeat loop          │
│   │   ├── sweep (suspect/dead)    │        │   │   ├── sweep (suspect/dead)    │
│   │   └── broadcast (state-sync)──────sync───→ │   └── broadcast (state-sync)  │
│   │                               │        │   │                               │
│   ├── Adapters                    │        │   ├── Adapters                    │
│   │   ├── TailscaleDiscovery      │        │   │   ├── TailscaleDiscovery      │
│   │   ├── HttpNetwork             │        │   │   ├── HttpNetwork             │
│   │   └── NodeResource            │        │   │   └── NodeResource            │
│   │                               │        │   │                               │
│   └── ClusterFederationSink       │        │   └── ClusterFederationSink       │
│       └── EventRelay ──────events──────────→       └── EventRelay              │
│                                   │        │                                   │
│  EventBus ◄───────────────────────│        │  EventBus                         │
│  CapacityWeightedRouter           │        │  CapacityWeightedRouter           │
└───────────────────────────────────┘        └───────────────────────────────────┘
         ▲                                            ▲
         │    method-ctl (L4 CLI)                     │
         └──── GET /cluster/state ────────────────────┘
               GET /cluster/nodes
               POST /cluster/route
```

## Layer Stack

```
L4  @methodts/bridge    — gains domains/cluster/ domain (adapters, routes, federation sink)
    method-ctl        — standalone CLI, pure HTTP client (no cluster/bridge deps)

L3  @methodts/cluster   — membership, routing, federation (zero transport deps)
```

## Membership Protocol

### State Machine

Each peer tracked by a `MembershipManager` has a status:

```
alive ──(missed heartbeat)──→ suspect ──(timeout)──→ dead ──(gc)──→ removed
  ▲                              │
  └──(heartbeat received)────────┘
```

Timers (configurable via env vars):
- **Heartbeat:** `CLUSTER_HEARTBEAT_MS` (default 5000) — ping all alive/suspect peers
- **Suspect timeout:** `CLUSTER_SUSPECT_TIMEOUT_MS` (default 15000) — alive → suspect
- **Dead timeout:** 2x suspect timeout — suspect → dead
- **GC timeout:** 3x suspect timeout — dead → removed from state

### Discovery

Peers are discovered at startup via `TailscaleDiscovery`:
1. Run `tailscale status --json` (10s timeout)
2. Extract hostnames from Tailscale mesh peers
3. Probe each hostname at the bridge port for `GET /health`
4. For responding bridges, send a join message

Fallback: if Tailscale CLI is unavailable, parse `CLUSTER_SEEDS` (comma-separated `host:port` addresses).

### Messages

`ClusterMessage` is a discriminated union:

| Type | Direction | Purpose |
|------|-----------|---------|
| `ping` | Outbound (heartbeat loop) | Liveness check |
| `ack` | Response to ping | Confirm alive + share generation |
| `join` | Both (discovery + incoming) | Announce new peer |
| `leave` | Outbound (graceful shutdown) | Remove self from cluster |
| `state-sync` | Outbound (broadcast loop) | Full state reconciliation |
| `event-relay` | Outbound (federation sink) | Federated events |

## Work Routing

`CapacityWeightedRouter` scores candidate nodes:

```
score(node) =
  (sessionsMax - sessionsActive) / sessionsMax * 0.4    // Session headroom (40%)
  + memoryAvailableMb / memoryTotalMb * 0.3             // Memory headroom (30%)
  + (1 - cpuLoadPercent / 100) * 0.2                    // CPU headroom (20%)
  + (hasProject(node, request.projectId) ? 0.1 : 0)     // Project locality (10%)
```

Rules:
- Only `alive` nodes are candidates
- `draining`, `suspect`, `dead` nodes score 0
- Ties broken by lowest `sessionsActive`
- Returns `null` when no capacity available

Weights are configurable via `RouterConfigSchema` (Zod).

## Event Federation

Local bridge events are relayed to cluster peers via `ClusterFederationSink` (registered on the EventBus when cluster is enabled).

**Filter chain:**
1. `ClusterFederationSink.onEvent()` — skip events with `federated: true` (loop prevention)
2. `EventRelay.shouldRelay()` — check severity filter (default: warning, error, critical) and domain filter
3. Relay to all alive peers via `NetworkProvider.send()` using `Promise.allSettled()` (one peer failure doesn't block others)

**Federated event fields** added to `BridgeEvent`:
- `sourceNodeId?: string` — originating bridge node ID
- `federated?: boolean` — `true` if received from another bridge

Both are optional for backward compatibility. Existing sinks ignore them.

## Port Interfaces

All defined in `packages/cluster/src/ports/`:

```typescript
interface DiscoveryProvider {
  discover(): Promise<PeerAddress[]>;
  announce(self: NodeIdentity): Promise<void>;
}

interface NetworkProvider {
  send(peer: PeerAddress, message: ClusterMessage): Promise<void>;
  onMessage(handler: (from: PeerAddress, msg: ClusterMessage) => void): void;
}

interface ResourceProvider {
  snapshot(): ResourceSnapshot;
}
```

Each has a test double under 20 lines in `packages/cluster/src/test-doubles/`.

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `CLUSTER_ENABLED` | `false` | Enable cluster protocol |
| `CLUSTER_NODE_ID` | auto-UUID (persisted to `.method/cluster-node-id`) | Stable node identity |
| `CLUSTER_SEEDS` | `""` | Comma-separated fallback peer addresses (`host:port`) |
| `CLUSTER_HEARTBEAT_MS` | `5000` | Peer health check interval |
| `CLUSTER_SUSPECT_TIMEOUT_MS` | `15000` | Time before alive → suspect |
| `CLUSTER_STATE_BROADCAST_MS` | `10000` | Full state sync interval |
| `CLUSTER_FEDERATION_ENABLED` | `true` | Enable event federation to peers |
| `CLUSTER_FEDERATION_FILTER_SEVERITY` | `warning,error,critical` | Minimum severity for federated events |
| `CLUSTER_FEDERATION_FILTER_DOMAIN` | `""` | Domain filter (empty = all) |

## HTTP Endpoints

All under `/cluster/`. Return 404 when `CLUSTER_ENABLED=false`.

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/cluster/state` | GET | Full cluster state (self + all peers) |
| `/cluster/nodes` | GET | Node list with status and resources |
| `/cluster/nodes/:nodeId` | GET | Single node detail |
| `/cluster/route` | POST | Route work request to best node |
| `/cluster/join` | POST | Peer join notification |
| `/cluster/leave` | POST | Peer leave notification |
| `/cluster/ping` | POST | Heartbeat (returns ack + generation) |
| `/cluster/state-sync` | POST | Receive full state from peer |
| `/cluster/events` | POST | Receive federated events from peer |
| `/cluster/drain` | POST | Set self to draining (stop accepting routed work) |
| `/cluster/resume` | POST | Clear draining status |

## File Structure

```
packages/cluster/                          L3 — zero transport deps
  src/
    index.ts                               Public API barrel
    types.ts                               ClusterState, ClusterNode, ClusterMessage, etc.
    membership/
      membership.ts                        MembershipManager state machine
      membership.config.ts                 Zod config + defaults
      membership.test.ts                   8 scenarios
    resources/
      resource-schema.ts                   ResourceSnapshot Zod schema
      resource-schema.test.ts              2 scenarios
    routing/
      router.ts                            CapacityWeightedRouter
      router.config.ts                     Weight tuning
      router.test.ts                       5 scenarios
    federation/
      event-relay.ts                       EventRelay + loop prevention
      event-relay.config.ts                Federation filter config
      event-relay.test.ts                  4 scenarios
    ports/
      discovery-provider.ts                DiscoveryProvider interface
      network-provider.ts                  NetworkProvider interface
      resource-provider.ts                 ResourceProvider interface
    test-doubles/
      fake-discovery.ts                    < 20 lines
      fake-network.ts                      < 20 lines
      fake-resources.ts                    < 20 lines

packages/bridge/src/domains/cluster/      L4 — bridge integration
  core.ts                                  ClusterDomain lifecycle
  core.test.ts                             4 scenarios
  config.ts                                CLUSTER_* env vars (Zod)
  routes.ts                                HTTP endpoints (thin wrappers)
  routes.test.ts                           6+ scenarios
  federation-sink.ts                       ClusterFederationSink (EventSink impl)
  federation-sink.test.ts                  3 scenarios
  index.ts                                 Domain barrel
  adapters/
    tailscale-discovery.ts                 DiscoveryProvider → tailscale CLI
    http-network.ts                        NetworkProvider → fetch()
    node-resource.ts                       ResourceProvider → os.cpus(), etc.

packages/method-ctl/                       L4 — standalone CLI
  src/
    index.ts                               CLI dispatcher
    config.ts                              ~/.method/cluster.json
    commands/
      status.ts                            method-ctl status
      nodes.ts                             method-ctl nodes [name]
      projects.ts                          method-ctl projects
```

## PRD Reference

- PRD 039: Bridge Cluster — membership, routing, federation (Phases 1-4 implemented)
- PRD 038: Bridge Deployment — instance profiles, secrets, packaging (all phases implemented)
- PRD 026: Universal Event Bus — federation sink integrates via existing EventSink interface
