---
title: "PRD 039: Bridge Cluster — Membership, Work Routing, and Event Federation"
status: draft
date: "2026-03-29"
tier: "heavyweight"
depends_on: [38]
enables: []
blocked_by: []
complexity: "high"
domains_affected: [bridge-server-entry, bridge-sessions, bridge-event-bus, new-package-cluster, new-app-method-ctl]
---

# PRD 039: Bridge Cluster — Membership, Work Routing, and Event Federation

## 1. Problem Statement

The bridge is single-node. All work — strategy execution, session spawning, genesis monitoring — runs on one machine (`mission-control`). Three concrete limitations:

1. **Capacity ceiling.** The bridge pool has a hard `MAX_SESSIONS` limit (default 10). As agent workloads grow, a single machine will reach its capacity ceiling. Other machines on the Tailscale mesh with available CPU and memory would sit idle. There is no mechanism to overflow work to another bridge. (No capacity-blocking incidents have been observed yet — this PRD captures the coordination design proactively so that PRD 038's deployment model feeds into a known architectural direction.)

2. **No cluster awareness.** Bridges on different machines don't know about each other. An operator managing multiple bridges must check each `/health` endpoint manually. There is no unified view of capacity and no way for an orchestrator to query "which bridge has capacity for this strategy?"

PRD 038 (Bridge Deployment) establishes the foundation: instance profiles and secrets management. Once bridges are deployable on multiple machines, coordination becomes the next concern.

### Assumptions

These assumptions guide the design. PO should validate before implementation begins:

- **[ASSUMPTION] Scale:** 2-5 machines in the next 6 months. The protocol should handle up to 20 nodes but is optimized for small clusters.
- **[ASSUMPTION] No shared filesystem:** Each machine has its own git clones. Project identity is by git remote URL + project name, not filesystem path.
- **[ASSUMPTION] Work routing starts client-side:** The CLI or orchestrator picks the best bridge explicitly. Server-side forwarding comes later.
- **[ASSUMPTION] Tailscale is the network layer:** All bridges are on the same Tailscale mesh (`emu-cosmological.ts.net`). No public internet exposure.

## 2. Objective

Turn isolated bridge instances into a coordinated cluster:

- **Bridges discover each other** automatically via the Tailscale mesh and share capacity state
- **Work routes to the best bridge** — an orchestrator or CLI can query cluster state and direct strategy execution to the node with the most available resources
- **Events federate across bridges** — a strategy completing on bridge-2 is visible on bridge-1's dashboard and event bus
- **`method-ctl` provides unified management** — health, capacity, projects, upgrade, and drain across all bridges from a single CLI

## 3. Architecture & Design

### 3.1 — FCA Layer Stack

```
L5  System       The cluster (multiple bridges + CLI + protocol)
                  Observable via method-ctl and federated dashboards
                  No code at this level — emergent from L4 coordination

L4  @method/bridge     Application — gains domains/cluster/ domain
    method-ctl         Application — CLI management tool (new binary)
                       Both are composition roots: wire ports, no domain logic

L3  @method/cluster    Package — cluster protocol, membership, routing (NEW)
                       Zero transport dependencies (FCA P7, DR-03 spirit)
                       Port interfaces for network, discovery, resources
    @method/mcp        Protocol adapter — unchanged
    @method/pacta       Agent SDK — unchanged

L2  @method/methodts   Domain extensions — unchanged
```

**Dependency rule (downward only):**
- `@method/bridge` depends on `@method/cluster` (L4 → L3)
- `method-ctl` depends on `@method/cluster` (L4 → L3)
- `@method/cluster` has no dependency on `@method/methodts` — cluster types are self-contained
- `@method/cluster` has zero transport deps — no HTTP, no WebSocket, no Tailscale SDK

### 3.2 — `@method/cluster` Package (L3 — New)

This is the domain logic package. It defines the cluster protocol, membership state machine, and routing algorithm — all transport-agnostic. External dependencies enter through ports.

**FCA component structure:**

```
packages/cluster/
  src/
    index.ts                    Interface — public API barrel
    membership/
      membership.ts             Membership state machine (join, leave, suspect, dead)
      membership.test.ts        Verification — co-located unit tests
      membership.config.ts      Configuration — Zod schema, defaults
      swim-detector.ts          SWIM failure detector (Phase 3)
      swim-detector.test.ts
      README.md                 Documentation — membership protocol spec
    resources/
      resource-schema.ts        Resource reporting types (CPU, memory, sessions, projects)
      resource-schema.test.ts
      README.md
    routing/
      router.ts                 Work routing algorithm (capacity-weighted)
      router.test.ts
      router.config.ts
      README.md
    federation/
      event-relay.ts            Event fan-out logic (which events, to whom)
      event-relay.test.ts
      event-relay.config.ts
      README.md
    ports/
      discovery-provider.ts     Port: discover peers (Tailscale, static, gossip)
      network-provider.ts       Port: send/receive messages between peers
      resource-provider.ts      Port: report local machine resources
      README.md
    types.ts                    Shared cluster types (ClusterNode, ClusterState, etc.)
  package.json
  tsconfig.json
  README.md                     Package-level documentation
```

**Port interfaces (FCA P3):**

```typescript
// Discovery: how to find other bridges
interface DiscoveryProvider {
  discover(): Promise<PeerAddress[]>;
  announce(self: NodeIdentity): Promise<void>;
}

// Network: how to communicate with peers
interface NetworkProvider {
  send(peer: PeerAddress, message: ClusterMessage): Promise<void>;
  onMessage(handler: (from: PeerAddress, msg: ClusterMessage) => void): void;
}

// Resources: what this machine has available
interface ResourceProvider {
  snapshot(): ResourceSnapshot;
}

interface ResourceSnapshot {
  nodeId: string;
  instanceName: string;
  cpuCount: number;
  cpuLoadPercent: number;         // 1-minute average
  memoryTotalMb: number;
  memoryAvailableMb: number;
  sessionsActive: number;
  sessionsMax: number;
  projectCount: number;
  uptimeMs: number;
  version: string;
}
```

**Cluster state model:**

```typescript
interface ClusterState {
  self: ClusterNode;
  peers: Map<string, ClusterNode>;  // nodeId → node
  generation: number;                // Monotonic, increments on state change
}

interface ClusterNode {
  nodeId: string;                    // Stable UUID per bridge install
  instanceName: string;              // From INSTANCE_NAME env var
  address: PeerAddress;              // How to reach this node
  resources: ResourceSnapshot;       // Last known resource state
  status: 'alive' | 'suspect' | 'dead' | 'draining';
  lastSeen: number;                  // Epoch ms
  projects: ProjectSummary[];        // Discovered project IDs + names
}

type ClusterMessage =
  | { type: 'ping'; from: string; generation: number }
  | { type: 'ack'; from: string; generation: number; state: ClusterState }
  | { type: 'join'; from: string; node: ClusterNode }
  | { type: 'leave'; from: string; nodeId: string }
  | { type: 'state-sync'; from: string; nodes: ClusterNode[] }
  | { type: 'event-relay'; from: string; events: FederatedEvent[] };
```

**Routing algorithm:**

```typescript
interface WorkRouter {
  selectNode(request: WorkRequest, state: ClusterState): ClusterNode | null;
}

interface WorkRequest {
  type: 'strategy' | 'session' | 'genesis';
  projectId?: string;               // Prefer node that has this project
  resourceHint?: 'cpu' | 'memory' | 'sessions';
  excludeNodes?: string[];          // Already tried, failed
}
```

The default router uses a scoring function:

```
score(node) =
  (sessionsMax - sessionsActive) / sessionsMax * 0.4    // Session headroom
  + memoryAvailableMb / memoryTotalMb * 0.3             // Memory headroom
  + (1 - cpuLoadPercent / 100) * 0.2                    // CPU headroom
  + (hasProject(node, request.projectId) ? 0.1 : 0)     // Project locality
```

Nodes with status `draining` have score 0 and are never selected. Highest score wins among remaining nodes. Ties broken by lowest `sessionsActive` (prefer idle nodes).

### 3.3 — Bridge `domains/cluster/` Domain (L4 — New)

A new FCA domain in the bridge that integrates `@method/cluster` with the bridge's composition root.

```
packages/bridge/src/domains/cluster/
  core.ts                    ClusterDomain — lifecycle, port wiring
  core.test.ts               Unit tests
  routes.ts                  HTTP endpoints (/cluster/*)
  routes.test.ts             Route tests
  config.ts                  Zod config schema (CLUSTER_ENABLED, CLUSTER_SEEDS, etc.)
  adapters/
    tailscale-discovery.ts   DiscoveryProvider impl: Tailscale API + MagicDNS
    http-network.ts          NetworkProvider impl: HTTP POST between peers
    node-resource.ts         ResourceProvider impl: os.cpus(), process.memoryUsage()
  README.md
```

**Config (Zod-validated):**

| Env Var | Default | Purpose |
|---------|---------|---------|
| `CLUSTER_ENABLED` | `false` | Enable cluster protocol |
| `CLUSTER_NODE_ID` | auto-generated UUID (persisted to `.method/cluster-node-id`) | Stable node identity |
| `CLUSTER_SEEDS` | `""` | Comma-separated seed peer addresses (e.g., `mission-control:3456,laptop:3456`) |
| `CLUSTER_HEARTBEAT_MS` | `5000` | Peer health check interval |
| `CLUSTER_SUSPECT_TIMEOUT_MS` | `15000` | Time before suspect → dead transition |
| `CLUSTER_STATE_BROADCAST_MS` | `10000` | Full state sync broadcast interval |
| `CLUSTER_FEDERATION_ENABLED` | `true` | Enable event federation to peers |
| `CLUSTER_FEDERATION_FILTER_SEVERITY` | `warning,error,critical` | Minimum severity for federated events |
| `CLUSTER_FEDERATION_FILTER_DOMAIN` | `""` | Domain filter (empty = all) |

**HTTP endpoints (thin wrappers per FCA P5):**

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/cluster/state` | GET | Full cluster state (all nodes, resources, projects) |
| `/cluster/nodes` | GET | Node list with status and resources |
| `/cluster/nodes/:nodeId` | GET | Single node detail |
| `/cluster/route` | POST | Route a work request — returns best node address |
| `/cluster/join` | POST | Peer join notification (called by peers) |
| `/cluster/leave` | POST | Peer leave notification |
| `/cluster/ping` | POST | Heartbeat ping (returns ack + state delta) |
| `/cluster/events` | POST | Receive federated events from peers |
| `/cluster/drain` | POST | Set node status to `draining` — stops accepting new work via routing. Existing sessions continue. |
| `/cluster/resume` | POST | Clear `draining` status — resume accepting work. |

**Integration with existing bridge surfaces:**

| Surface | Integration |
|---------|-------------|
| `/health` | Add `cluster` field: `{ enabled, node_id, peers_alive, peers_suspect, peers_dead }` |
| Event Bus | Register `ClusterFederationSink` — relays events to peers via `NetworkProvider` |
| Pool Stats | `ResourceProvider` reads `pool.poolStats()` for session capacity |
| Project Discovery | `ClusterDomain` exposes discovered projects as `ProjectSummary[]` for peer state |

### 3.4 — `method-ctl` CLI Application (L4 — New)

A standalone CLI for cluster management. Command handlers are HTTP clients that call cluster endpoints and format responses — they do not contain routing, membership, or federation logic.

```
packages/method-ctl/
  src/
    index.ts                 CLI entry point (arg parsing, command dispatch)
    commands/
      status.ts              method-ctl status — unified cluster health
      nodes.ts               method-ctl nodes — list nodes with resources
      projects.ts            method-ctl projects — projects across cluster
      route.ts               method-ctl route — test work routing (post-MVP)
      drain.ts               method-ctl drain <node> — stop new work on a node (post-MVP)
    config.ts                CLI config (cluster address, output format)
    README.md
  bin/
    method-ctl.js            Shebang entry point
  package.json
  tsconfig.json
  README.md
```

**Config file:** `~/.method/cluster.json`

```json
{
  "default_bridge": "mission-control:3456",
  "known_bridges": [
    { "name": "mission-control", "address": "mission-control.emu-cosmological.ts.net:3456" },
    { "name": "laptop", "address": "laptop.emu-cosmological.ts.net:3456" }
  ],
  "output_format": "table"
}
```

**Commands:**

```bash
method-ctl status                    # Cluster overview (nodes, capacity, health)
method-ctl nodes                     # Detailed node list
method-ctl nodes mission-control     # Single node detail
method-ctl projects                  # Projects across all bridges
method-ctl route --type strategy --project pv-method   # Test routing decision (post-MVP)
method-ctl drain laptop              # Stop accepting work on laptop (post-MVP)
```

### 3.5 — Event Federation Model

Each bridge runs a `ClusterFederationSink` registered on its event bus. When a local event matches the federation filter (severity + domain), the sink forwards it to all alive peers via the `NetworkProvider`.

```
Bridge A (mission-control)              Bridge B (laptop)
┌──────────────────────────┐            ┌──────────────────────────┐
│ Event Bus                │            │ Event Bus                │
│  ├── WebSocketSink       │            │  ├── WebSocketSink       │
│  ├── PersistenceSink     │            │  ├── PersistenceSink     │
│  ├── ClusterFedSink ─────┼──HTTP──→───┼──→ POST /cluster/events │
│  │                       │            │  │   └── importEvent()   │
│  └── ...                 │            │  └── ClusterFedSink ─────┼──→ A
└──────────────────────────┘            └──────────────────────────┘
```

Federated events are tagged with `source_node_id` and `federated: true` to prevent loops. A bridge never re-federates a federated event.

The existing `BridgeEvent` schema gains two optional fields:

```typescript
interface BridgeEvent {
  // ... existing fields ...
  sourceNodeId?: string;     // Originating bridge node ID
  federated?: boolean;       // true if received from another bridge
}
```

### 3.6 — Discovery Protocol (Phased)

**Phase 1 — Tailscale-backed discovery:**

Uses the Tailscale local API (`/localapi/v0/status`) to enumerate machines on the tailnet, then probes each for a bridge `/health` endpoint. No gossip — pure polling.

```typescript
class TailscaleDiscovery implements DiscoveryProvider {
  async discover(): Promise<PeerAddress[]> {
    // 1. Access Tailscale local API:
    //    - Linux/macOS: GET http://127.0.0.1/localapi/v0/status (Unix socket)
    //    - Windows: access via named pipe \\.\pipe\ProtectedPrefix\Administrators\Tailscale\tailscaled
    //    - Cross-platform alternative: shell out to `tailscale status --json`
    // 2. Extract machine hostnames from status.Peer
    // 3. For each machine, probe GET http://{hostname}:{port}/health
    // 4. Return addresses of machines that respond with bridge health
  }

  async announce(self: NodeIdentity): Promise<void> {
    // No-op for Tailscale discovery — discovery is by probing
  }
}
```

Seed addresses (`CLUSTER_SEEDS`) serve as fallback when Tailscale API is unavailable.

**Phase 4 — SWIM-lite gossip (future):**

Replaces polling with a protocol where nodes autonomously detect failures and propagate state changes. Each heartbeat cycle:

1. Pick a random alive peer → send `ping`
2. If no `ack` within timeout → pick K random peers → send indirect `ping-req`
3. If still no ack → mark peer `suspect`
4. After `SUSPECT_TIMEOUT_MS` without recovery → mark `dead`
5. State changes piggyback on all messages (protocol-efficient)

This provides sub-second failure detection without O(n^2) polling. Implementation deferred because Tailscale-backed polling is sufficient for <10 nodes with 5s heartbeat.

## 4. Alternatives Considered

### Alternative 1: Central Coordinator

**Approach:** One designated bridge acts as the cluster coordinator. All others register with it and report state to it. Work routing goes through the coordinator.

**Pros:** Simple, well-understood model. No gossip complexity. Single source of truth for cluster state.

**Cons:** Single point of failure — if the coordinator dies, the cluster loses coordination. Requires leader election (Raft/Paxos) for fault tolerance, which is more complex than gossip for small clusters. The coordinator becomes a bottleneck for state queries.

**Why rejected:** A peer-to-peer model matches the Tailscale mesh topology (no master node) and the small cluster size. Each bridge is independently useful — the cluster is additive, not mandatory.

### Alternative 2: Shared Database (SQLite on NFS / PostgreSQL)

**Approach:** All bridges read/write cluster state to a shared database. No protocol — just reads and writes.

**Pros:** Trivially consistent. Standard tooling. Easy to query.

**Cons:** Requires shared infrastructure (NFS or a database server) that doesn't exist. Adds operational complexity. Network filesystem performance on Windows is poor for writes. Database becomes a SPOF.

**Why rejected:** Introduces infrastructure dependency that the current setup doesn't have. The Tailscale mesh provides point-to-point connectivity — use it directly instead of adding a database in the middle.

### Alternative 3: Pure CLI Polling (No Protocol)

**Approach:** No cluster protocol at all. `method-ctl` simply polls `/health` on configured bridges and displays results. Work routing is manual.

**Pros:** Zero complexity. Works immediately. No state to manage.

**Cons:** No automatic failure detection. No event federation. No resource-aware routing. The operator must manually decide which bridge to use and manually check if a bridge is alive.

**Why rejected:** Alternative 3 is the expected operational model after PRD 038 deploys, and is a viable near-term approach for 2-3 machines. PRD 039 automates what operators would otherwise do manually — automatic discovery, state sharing, intelligent routing, and event federation. Implementation should begin only after manual coordination with PRD 038 proves insufficient.

### Surface-First vs. Implementation-First Trade-off

**Surface-first** (chosen): Define port interfaces (`DiscoveryProvider`, `NetworkProvider`, `ResourceProvider`, `WorkRouter`) before implementing any protocol. This allows:
- Bridge integration to proceed with mock providers
- `method-ctl` to develop against the port interface
- Protocol implementation to be swapped (Tailscale → gossip) without changing consumers

**Implementation-first** (rejected): Build the gossip protocol first, then design ports around it. Risks coupling the bridge to one discovery mechanism and making the protocol hard to test.

## 5. Scope

### In-Scope

- `@method/cluster` L3 package with port interfaces, membership, routing, federation
- Bridge `domains/cluster/` domain with Tailscale discovery, HTTP networking, OS resource reporting
- `method-ctl` CLI with status, nodes, projects, route, drain commands
- Event federation via `ClusterFederationSink` on the event bus
- Extended `/health` endpoint with cluster state
- Cluster config via Zod-validated env vars
- `~/.method/cluster.json` config for method-ctl
- Test doubles and verification affordances co-located in `packages/cluster/src/test-doubles/`
- Co-located documentation per FCA P8/P10

### Out of Scope

- SWIM gossip protocol (deferred to Phase 5 — designed but not implemented)
- Remote upgrade orchestration (use `method-ctl drain` + manual restart)
- Server-side work forwarding (bridges accepting requests and forwarding to peers)
- Automatic failover (restarting dead sessions on another bridge)
- Shared project registry (cross-bridge deduplication)
- Multi-cluster (clusters talking to other clusters)
- Authentication between bridges (Tailscale mesh is trusted)
- Automatic `method-ctl` installation on remote machines
- CI/CD for cluster releases
- Split-brain resolution beyond simple majority

### Non-Goals

- Replacing the single-bridge workflow — cluster is opt-in via `CLUSTER_ENABLED=true`
- Building a general-purpose gossip library — the protocol is purpose-built for bridge coordination
- Supporting non-Tailscale networks in Phase 1 (seed addresses provide manual fallback)

## 6. Implementation Phases

**Implementation gate:** Implementation begins only after (1) PRD 038 Phase 1 is operational and (2) PO validates the scale assumption in OQ-1. Until then, this PRD serves as an architectural direction document.

### Phase 1: Cluster Package Foundation + Port Interfaces

**Deliverables:**

Files:
- `packages/cluster/package.json` — new — `@method/cluster`, zero transport deps
- `packages/cluster/tsconfig.json` — new — extends root tsconfig
- `packages/cluster/src/index.ts` — new — public API barrel
- `packages/cluster/src/types.ts` — new — `ClusterState`, `ClusterNode`, `ClusterMessage`, `PeerAddress`, `NodeIdentity`, `FederatedEvent`
- `packages/cluster/src/ports/discovery-provider.ts` — new — `DiscoveryProvider` interface
- `packages/cluster/src/ports/network-provider.ts` — new — `NetworkProvider` interface
- `packages/cluster/src/ports/resource-provider.ts` — new — `ResourceProvider` + `ResourceSnapshot` interface
- `packages/cluster/src/ports/README.md` — new — port documentation
- `packages/cluster/src/membership/membership.ts` — new — `MembershipManager` state machine (join, leave, suspect, dead transitions, heartbeat loop)
- `packages/cluster/src/membership/membership.test.ts` — new — 8 scenarios
  1. Node joins cluster — added to peers with status `alive`
  2. Node leaves gracefully — removed from peers
  3. Heartbeat received — `lastSeen` updated
  4. Heartbeat missed beyond `suspectTimeout` — status transitions to `suspect`
  5. Suspect node recovers (heartbeat received) — status returns to `alive`
  6. Suspect node exceeds dead timeout — status transitions to `dead`
  7. Dead node removed from peers after GC interval
  8. Self-node state always reflects local resources
- `packages/cluster/src/membership/membership.config.ts` — new — Zod config
- `packages/cluster/src/membership/README.md` — new — membership protocol spec
- `packages/cluster/src/resources/resource-schema.ts` — new — `ResourceSnapshot` type, scoring utilities
- `packages/cluster/src/resources/resource-schema.test.ts` — new — 2 scenarios
- `packages/cluster/src/resources/README.md` — new
- `packages/cluster/README.md` — new — package documentation
- `packages/cluster/src/test-doubles/` — new — `FakeDiscovery`, `FakeNetwork`, `FakeResources` test doubles, co-located with the cluster package (FCA P4/P8). Note: `@method/pacta-testkit` is Pacta-scoped and should not gain cluster concerns.
- Root `tsconfig.json` — modified — add `packages/cluster` to project references

Tests:
- All tests listed above are co-located (FCA P8)
- Test doubles ship with `@method/cluster` in `src/test-doubles/` (FCA P4)

Configuration:
- None at this phase — config lives in the bridge domain (Phase 2)

**Dependencies:** None.

**Checkpoint:** `npm run build` passes. `npm test` passes. `@method/cluster` exports `MembershipManager`, port interfaces, and types. All 10+ unit tests pass using test doubles only.

### Phase 2: Bridge Cluster Domain + Tailscale Discovery

**Deliverables:**

Files:
- `packages/bridge/src/domains/cluster/core.ts` — new — `ClusterDomain` lifecycle (init, start heartbeat loop, stop)
- `packages/bridge/src/domains/cluster/core.test.ts` — new — 4 scenarios
  1. Domain starts with `CLUSTER_ENABLED=true` — discovers peers, begins heartbeat
  2. Domain starts with `CLUSTER_ENABLED=false` — no-op, no network calls
  3. Peer health check fails — peer marked suspect after timeout
  4. New peer discovered — added to membership, resources synced
- `packages/bridge/src/domains/cluster/routes.ts` — new — HTTP endpoints (`/cluster/state`, `/cluster/nodes`, `/cluster/ping`, `/cluster/join`, `/cluster/leave`, `/cluster/events`)
- `packages/bridge/src/domains/cluster/routes.test.ts` — new — 6 scenarios (one per endpoint)
- `packages/bridge/src/domains/cluster/config.ts` — new — Zod config for all `CLUSTER_*` env vars
- `packages/bridge/src/domains/cluster/adapters/tailscale-discovery.ts` — new — `DiscoveryProvider` impl using Tailscale local API
- `packages/bridge/src/domains/cluster/adapters/tailscale-discovery.test.ts` — new — 3 scenarios (API available, API unavailable + seed fallback, no bridges found)
- `packages/bridge/src/domains/cluster/adapters/http-network.ts` — new — `NetworkProvider` impl using HTTP POST between peers
- `packages/bridge/src/domains/cluster/adapters/http-network.test.ts` — new — 2 scenarios
- `packages/bridge/src/domains/cluster/adapters/node-resource.ts` — new — `ResourceProvider` impl using `os.cpus()`, `os.totalmem()`, `os.freemem()`, `process.memoryUsage()`, `pool.poolStats()`
- `packages/bridge/src/domains/cluster/adapters/node-resource.test.ts` — new — 1 scenario
- `packages/bridge/src/domains/cluster/README.md` — new
- `packages/bridge/src/server-entry.ts` — modified — wire `ClusterDomain` at composition root (port injection, sink registration, route registration), add cluster info to `/health`
- `packages/bridge/package.json` — modified — add `@method/cluster` dependency

Tests: All listed above, co-located.

Configuration: All `CLUSTER_*` env vars from Section 3.3.

**Dependencies:** Phase 1 must complete (port interfaces and membership logic).

**Checkpoint:** `npm run build` passes. `npm test` passes. With `CLUSTER_ENABLED=true` and `CLUSTER_SEEDS=localhost:3457`, two bridge instances discover each other and show peer state in `GET /cluster/state`. `GET /health` includes cluster info.

### Phase 3: Work Routing + Event Federation

**Deliverables:**

Files:
- `packages/cluster/src/routing/router.ts` — new — `CapacityWeightedRouter` implementing `WorkRouter` interface with scoring function from Section 3.2
- `packages/cluster/src/routing/router.test.ts` — new — 5 scenarios
  1. Route to node with most session headroom
  2. Route to node that has the requested project
  3. Exclude failed nodes from routing
  4. Return null when no nodes have capacity
  5. Tie-breaking by lowest active sessions
- `packages/cluster/src/routing/router.config.ts` — new — weight configuration
- `packages/cluster/src/routing/README.md` — new
- `packages/cluster/src/federation/event-relay.ts` — new — `EventRelay` — decides which events to federate, tags with `sourceNodeId`, prevents loops
- `packages/cluster/src/federation/event-relay.test.ts` — new — 4 scenarios
  1. Local event matching filter → relayed to peers
  2. Federated event → not re-relayed (loop prevention)
  3. Event below severity filter → not relayed
  4. No alive peers → events dropped silently
- `packages/cluster/src/federation/event-relay.config.ts` — new
- `packages/cluster/src/federation/README.md` — new
- `packages/bridge/src/domains/cluster/routes.ts` — modified — add `POST /cluster/route` endpoint
- `packages/bridge/src/domains/cluster/federation-sink.ts` — new — `ClusterFederationSink` implementing `EventSink`, delegates to `EventRelay`. Lives in domains/cluster/ (not shared/event-bus/) because it is cluster-specific logic. Registered on the event bus by the composition root when CLUSTER_ENABLED=true.
- `packages/bridge/src/domains/cluster/federation-sink.test.ts` — new — co-located — 3 scenarios
- `packages/bridge/src/server-entry.ts` — modified — register `ClusterFederationSink` when cluster enabled
- `packages/bridge/src/ports/event-bus.ts` — modified — add optional `sourceNodeId` and `federated` fields to `BridgeEvent`

Tests: All listed above, co-located.

**Dependencies:** Phase 2 must complete (cluster domain + discovery operational).

**Checkpoint:** Start two bridges. Execute a strategy on bridge-1. Bridge-2 receives the `strategy.completed` event via federation. `POST /cluster/route` on either bridge returns the node with best capacity.

### Phase 4: `method-ctl` CLI

**Deliverables:**

Files:
- `packages/method-ctl/package.json` — new — standalone CLI package
- `packages/method-ctl/tsconfig.json` — new
- `packages/method-ctl/bin/method-ctl.js` — new — shebang entry point
- `packages/method-ctl/src/index.ts` — new — arg parsing, command dispatch
- `packages/method-ctl/src/config.ts` — new — reads `~/.method/cluster.json`
- `packages/method-ctl/src/commands/status.ts` — new — unified cluster health
- `packages/method-ctl/src/commands/nodes.ts` — new — node list with resources
- `packages/method-ctl/src/commands/projects.ts` — new — cross-cluster projects
- `packages/method-ctl/src/commands/route.ts` — new — test routing decision (post-MVP, added when need demonstrated)
- `packages/method-ctl/src/commands/drain.ts` — new — mark node as draining (post-MVP, added when need demonstrated)
- `packages/method-ctl/README.md` — new
- Root `package.json` — modified — add `method-ctl` workspace, add `ctl` script

Tests (MVP — co-located per FCA P8):
- `packages/method-ctl/src/commands/status.test.ts` — 2 scenarios (cluster healthy, node unreachable)
- `packages/method-ctl/src/commands/nodes.test.ts` — 1 scenario (node list with resources)

Configuration:
- `~/.method/cluster.json` — cluster address config, known bridges

**Dependencies:** Phase 3 must complete (routing + federation endpoints exist).

**Checkpoint:** `method-ctl status` shows unified cluster health across two bridges. `method-ctl route --type strategy --project pv-method` returns the best node. `method-ctl drain laptop` stops new work on laptop.

### Phase 5: SWIM-Lite Gossip (Future — Not Scheduled)

Replaces Tailscale polling with autonomous SWIM-based failure detection (see Section 3.6 for protocol design). Implementation deferred until cluster exceeds 5 nodes or Tailscale local API proves unreliable. Full deliverables will be specified when this phase is promoted.

## 7. Success Criteria

### Functional

| Metric | Target | Measurement Method | Current Baseline |
|--------|--------|-------------------|-----------------|
| Peer discovery latency | <10s from bridge start to peer visible in `/cluster/state` | Time from bridge startup to first peer appearing | N/A (no cluster) |
| Failure detection time | <20s from peer death to `suspect` status | Kill a bridge, measure time until peer marks it suspect | N/A |
| Routing accuracy | Route to node with most available capacity 95%+ of the time | Run 100 routing decisions against known state, verify optimal selection | N/A |
| Event federation latency | <5s from event emission to appearance on peer's event bus | Emit event on bridge-1, measure time until visible on bridge-2's `/api/events` | N/A |
| `method-ctl status` response | <2s for 5-node cluster | Time to query and display unified status | N/A |
| Zero-impact on single-bridge | `CLUSTER_ENABLED=false` adds zero overhead | Profile bridge startup and runtime with cluster disabled vs. pre-PRD | Current behavior |

### Non-Functional

| Metric | Target | Measurement Method | Current Baseline |
|--------|--------|-------------------|-----------------|
| Network overhead | <1KB/s per peer for heartbeat traffic | Measure HTTP payload sizes × frequency | N/A |
| Memory overhead | <10MB for cluster state with 20 peers | Measure `process.memoryUsage()` delta with cluster enabled | N/A |

### Architecture (FCA Gates)

| Gate | Impact | Details |
|------|--------|---------|
| G-PORT | New ports | 3 new port interfaces in `@method/cluster` (`DiscoveryProvider`, `NetworkProvider`, `ResourceProvider`). All follow FCA P3 — minimal interface, test double under 20 lines. |
| G-BOUNDARY | New domain | `domains/cluster/` added to bridge with clear boundary. No direct imports from other domains — communicates via event bus and composition root wiring. |
| G-LAYER | New L3 package | `@method/cluster` at L3 with zero transport deps. Bridge (L4) depends on it, not the reverse. |

## 8. Acceptance Criteria

### AC-1: Two bridges discover each other

**Given** two bridge instances running on different ports with `CLUSTER_ENABLED=true` and `CLUSTER_SEEDS` pointing to each other
**When** both instances are started
**Then** within 10 seconds, `GET /cluster/state` on either instance shows the other as `alive` with its `ResourceSnapshot`

**Test location:** `packages/bridge/src/domains/cluster/core.test.ts` scenario 1
**Automatable:** yes

### AC-2: Cluster disabled has zero impact

**Given** `CLUSTER_ENABLED=false` (default)
**When** the bridge starts
**Then** no cluster domain is initialized, no network probes are sent, `/cluster/*` endpoints return 404, and `/health` has no `cluster` field

**Test location:** `packages/bridge/src/domains/cluster/core.test.ts` scenario 2
**Automatable:** yes

### AC-3: Failure detection marks unresponsive peer as suspect

**Given** two bridges in a cluster, both `alive`
**When** one bridge is killed (process dies)
**Then** within `CLUSTER_SUSPECT_TIMEOUT_MS` (default 15s), the surviving bridge marks the dead peer as `suspect`
**And** after the dead timeout, marks it as `dead`

**Test location:** `packages/bridge/src/domains/cluster/core.test.ts` scenario 3
**Automatable:** yes

### AC-4: Work routing selects optimal node

**Given** a cluster with 3 nodes: A (8/10 sessions), B (2/10 sessions), C (9/10 sessions)
**When** `POST /cluster/route { type: "strategy" }` is called
**Then** the response selects node B (most session headroom)

**Test location:** `packages/cluster/src/routing/router.test.ts` scenario 1
**Automatable:** yes

### AC-5: Project locality influences routing

**Given** a cluster with 2 nodes: A (has project `pv-method`, 5/10 sessions), B (no `pv-method`, 4/10 sessions)
**When** `POST /cluster/route { type: "strategy", projectId: "pv-method" }` is called
**Then** the response selects node A (project locality bonus outweighs slight capacity disadvantage)

**Test location:** `packages/cluster/src/routing/router.test.ts` scenario 2
**Automatable:** yes

### AC-6: Events federate between bridges

**Given** two bridges in a cluster with federation enabled
**When** bridge-1 emits a `strategy.completed` event with severity `warning`
**Then** within 5 seconds, bridge-2's event bus contains the event with `federated: true` and `sourceNodeId` set to bridge-1's node ID

**Test location:** `packages/bridge/src/domains/cluster/federation-sink.test.ts` scenario 1
**Automatable:** yes

### AC-7: Federated events are not re-relayed (loop prevention)

**Given** bridge-2 receives a federated event from bridge-1
**When** the event is imported into bridge-2's event bus
**Then** bridge-2's `ClusterFederationSink` does NOT relay it back to bridge-1

**Test location:** `packages/cluster/src/federation/event-relay.test.ts` scenario 2
**Automatable:** yes

### AC-8: method-ctl status shows unified view

**Given** a cluster with 2 bridges
**When** `method-ctl status` is run
**Then** output shows both nodes with: instance name, status, active/max sessions, CPU %, memory %, project count, uptime

**Test location:** `packages/method-ctl/src/commands/status.test.ts` scenario 1
**Automatable:** yes

### AC-9: method-ctl route tests routing

**Given** a cluster with 2 bridges, one at 80% capacity, one at 20%
**When** `method-ctl route --type strategy` is run
**Then** output shows the selected node (20% capacity) with the routing score breakdown

**Test location:** `packages/method-ctl/src/commands/route.test.ts` scenario 1
**Automatable:** yes

### AC-10: method-ctl drain stops new work

**Given** a bridge in a cluster
**When** `method-ctl drain laptop` is run
**Then** the laptop bridge's `/health` reports `status: "draining"`
**And** `POST /cluster/route` never selects the draining node
**And** existing sessions continue to run

**Test location:** `packages/method-ctl/src/commands/drain.test.ts` scenario 1
**Automatable:** yes

### AC-11: Health endpoint includes cluster info

**Given** `CLUSTER_ENABLED=true` and 2 peers alive
**When** `GET /health` is called
**Then** response includes `cluster: { enabled: true, node_id: "...", peers_alive: 2, peers_suspect: 0, peers_dead: 0 }`

**Test location:** `packages/bridge/src/domains/cluster/routes.test.ts` scenario 1
**Automatable:** yes

### AC-12: Extended resource snapshot in node detail

**Given** a bridge in a cluster
**When** `GET /cluster/nodes/:nodeId` is called
**Then** response includes full `ResourceSnapshot`: cpuCount, cpuLoadPercent, memoryTotalMb, memoryAvailableMb, sessionsActive, sessionsMax, projectCount, uptimeMs, version

**Test location:** `packages/bridge/src/domains/cluster/routes.test.ts` scenario 2
**Automatable:** yes

### AC-13: BridgeEvent schema backward compatible

**Given** existing event consumers (WebSocketSink, PersistenceSink, GenesisSink)
**When** `sourceNodeId` and `federated` fields are added to `BridgeEvent`
**Then** all existing sinks continue to work without modification (fields are optional)
**And** existing JSONL event logs are parseable (new fields absent = local event)

**Test location:** `packages/bridge/src/domains/cluster/federation-sink.test.ts` scenario 3
**Automatable:** yes

### AC-14: Tailscale API unavailable falls back to seeds

**Given** Tailscale local API is not accessible (e.g., Tailscale not running)
**And** `CLUSTER_SEEDS=mission-control:3456` is configured
**When** the bridge starts with `CLUSTER_ENABLED=true`
**Then** discovery uses seed addresses only
**And** a warning is logged: "Tailscale API unavailable — using seed addresses only"

**Test location:** `packages/bridge/src/domains/cluster/adapters/tailscale-discovery.test.ts` scenario 2
**Automatable:** yes

### AC-15: Port interfaces are testable with sub-20-line doubles

**Given** the port interfaces `DiscoveryProvider`, `NetworkProvider`, `ResourceProvider`
**When** test doubles are implemented in `@method/testkit`
**Then** each test double is under 20 lines of code (FCA P3 port width check)

**Test location:** `packages/cluster/src/test-doubles/` — verify line count
**Automatable:** yes (static analysis)

## 9. Risks & Mitigations

| Risk | Severity | Likelihood | Impact | Mitigation |
|------|----------|-----------|--------|-----------|
| Tailscale local API not available on all machines | High | Medium | Discovery fails | Seed address fallback (`CLUSTER_SEEDS`). Log clear warning. Phase 4 gossip eliminates Tailscale dependency entirely. |
| Network partition between bridges | High | Low | Split-brain — two halves of cluster unaware of each other | No automatic failover in this PRD. Cluster state is advisory, not authoritative. `method-ctl` shows partition status. Human decides. |
| Event federation loop (A→B→A→B...) | Critical | Medium | Infinite event amplification, resource exhaustion | `federated: true` flag on relayed events. `ClusterFederationSink` never relays events with `federated: true`. Tested in AC-7. |
| Resource reporting overhead | Medium | Low | `os.cpus()` and `process.memoryUsage()` add latency to heartbeat | Cache resource snapshots for 5s. Heartbeat loop runs asynchronously. |
| `@method/cluster` accumulates transport deps | High | Medium | Violates FCA L3 constraint | Port pattern enforced: all network/discovery/resource access through injected providers. CI lint rule: `@method/cluster` may not import `node:http`, `node:net`, or any HTTP library. |
| method-ctl config drift (stale known_bridges) | Medium | High | CLI shows stale data or can't reach bridges | `method-ctl status` probes all known bridges and marks unreachable ones. `method-ctl discover` refreshes the list from any reachable bridge's `/cluster/state`. |

## 10. Dependencies & Cross-Domain Impact

### Depends On
- **PRD 038** (Bridge Deployment) — instance profiles and packaging provide the per-node config layer. `INSTANCE_NAME` provides node identity. `CLUSTER_SEEDS` would reference instance names from profiles.

### Enables
- Distributed genesis (genesis on one bridge monitors events across all bridges)
- Cross-bridge strategy execution (orchestrator routes steps to different bridges)
- Dashboard federation (frontend shows unified cluster view)

### Blocks / Blocked By
- None

### Cross-Domain Impact Matrix

| Domain | Change Type | Files Affected | Port Changes | Test Impact | Doc Impact |
|--------|------------|----------------|--------------|-------------|------------|
| NEW: `@method/cluster` | New package | ~20 files | 3 new port interfaces | ~30 test scenarios | New package README + per-module READMEs |
| NEW: `domains/cluster/` | New domain | ~12 files | None (uses cluster ports) | ~16 test scenarios | New domain README |
| NEW: `method-ctl` | New package | ~12 files | None | ~5 test scenarios | New package README |
| `server-entry.ts` | Modified | 1 file | None | None | Updated bridge arch doc |
| `ports/event-bus.ts` | Modified | 1 file | `BridgeEvent` gains 2 optional fields | Backward compat test | Updated event-bus arch doc |
| `domains/cluster/` | Federation sink | 1 new file (federation-sink.ts) | None | 3 test scenarios | Updated event-bus arch doc |
| Root `package.json` | Modified | 1 file | None | None | CLAUDE.md |

## 11. Documentation Impact

| Document | Action | Content to Add/Change |
|----------|--------|-----------------------|
| `CLAUDE.md` | Update | **Architecture section:** Add `@method/cluster` to layer stack at L3. Add `method-ctl` to L4. Add `domains/cluster/` to bridge domain list. **Commands section:** Add `method-ctl status`, `method-ctl nodes`, `method-ctl route`, `method-ctl drain`. Add cluster env vars to bridge config reference. **Key Directories:** Add `packages/cluster/` and `packages/method-ctl/`. |
| `docs/arch/bridge.md` | Update | **Configuration table:** Add all `CLUSTER_*` env vars. **New section "Cluster Integration":** How the cluster domain is wired, event federation flow, routing endpoint. |
| `docs/arch/event-bus.md` | Update | **BridgeEvent schema:** Add `sourceNodeId` and `federated` fields. **New sink:** Document `ClusterFederationSink` — purpose, filter config, loop prevention. |
| `docs/arch/cluster.md` | Create | **New arch doc.** Cluster protocol spec: membership state machine, discovery mechanisms (Tailscale + seeds + future gossip), heartbeat protocol, resource reporting schema, routing algorithm with scoring function, event federation model with loop prevention, `method-ctl` CLI design. |
| `docs/guides/XX-bridge-cluster.md` | Create | **New guide.** Sections: (1) Enabling clustering — env vars, seed config, Tailscale setup. (2) Adding a bridge to the cluster — install, configure seeds, verify join. (3) Using method-ctl — commands, config file, output formats. (4) Work routing — how to route strategies, project locality. (5) Event federation — what events are federated, severity filter. (6) Draining a node — pre-upgrade workflow. (7) Troubleshooting — peer not discovered, events not federating. |
| `packages/cluster/README.md` | Create | Package-level docs: purpose, port interfaces, zero-transport-dep constraint, architecture diagram, usage from bridge and method-ctl. |
| `packages/method-ctl/README.md` | Create | Package-level docs: purpose, commands, config file format, installation. |
| Parent `CLAUDE.md` (`../CLAUDE.md`) | Update | **Method Bridge section:** Add cluster commands. Add note about `method-ctl` for managing bridge clusters. |

## 12. Open Questions

| # | Question | Owner | Deadline |
|---|----------|-------|----------|
| OQ-1 | Validate scale assumption: 2-5 machines in 6 months? This determines whether SWIM gossip is worth implementing vs. keeping Tailscale polling permanently. | Franco | Before Phase 1 |
| OQ-2 | Should `method-ctl` be bundled in the bridge tarball (PRD 038 Phase 3) or distributed separately? | Franco | Before Phase 4 |
| OQ-3 | Should the routing algorithm account for network latency between the requester and candidate bridges? (Requires latency probing in heartbeat.) | Franco | Before Phase 3 |
| OQ-4 | Should federated events be persisted by the receiving bridge's `PersistenceSink`, or kept in memory only? Persisting creates a complete audit trail but doubles storage. | Franco | Before Phase 3 |
| OQ-5 | What Tailscale plan features are available? The local API (`/localapi/v0/status`) is available on all plans, but machine tags and ACL-based discovery require Tailscale Business. | Franco | Before Phase 2 |

## 13. Review Findings

PRD designed with FCA compliance as primary architectural constraint. Key FCA alignment:

| FCA Principle | How Applied |
|---------------|-------------|
| P1 (Every layer produces a component) | New L3 package (`@method/cluster`), new L4 domain (`domains/cluster/`), new L4 app (`method-ctl`) |
| P2 (Interface discipline) | `@method/cluster` exports a minimal public API barrel. Port interfaces are contracts. |
| P3 (Port pattern) | 3 port interfaces with sub-20-line test doubles (AC-15). All external deps injected. |
| P4 (Verification affordances) | Test doubles ship co-located in `packages/cluster/src/test-doubles/`. Every module has co-located tests. |
| P5 (Highest component is composition) | Bridge `server-entry.ts` wires cluster ports. `method-ctl` dispatches commands. No domain logic in composition roots. |
| P6 (Verify independently) | `@method/cluster` tests use only test doubles. Bridge domain tests use mocked providers. No cross-domain test deps. |
| P7 (Boundaries through structure) | `@method/cluster` has zero transport deps (enforced by CI lint). Domains don't import each other. |
| P8 (Co-locate artifacts) | Tests, config, README co-located in every domain directory. |
| P9 (Observable) | Cluster metrics in `/health`, `/cluster/state`, `/cluster/nodes`. Event bus emits `cluster.peer_joined`, `cluster.peer_suspect`, `cluster.peer_dead`. |
| P10 (README indexing) | Every directory with >1 file has a README. Package-level README indexes modules. |

Adversarial review completed 2026-03-29: 5 advisors (FCA Purist, Coherence Analyst, Codebase Auditor, Skeptic, Implementor), 83 findings, 4 synthesizers. Key resolutions applied:

| Finding | Severity | Resolution |
|---------|----------|------------|
| F-A1-1: @method/testkit phantom | CRITICAL | Fixed: test doubles co-located in packages/cluster/src/test-doubles/ |
| F-A5-6: drain has no backend | CRITICAL | Fixed: added POST /cluster/drain endpoint, draining status, router exclusion |
| F-A5-7: upgrade unimplementable | CRITICAL | Fixed: removed upgrade command, added to Out of Scope |
| F-A4-2: PRD premature | CRITICAL | Addressed: added implementation gate gated on 038 P1 + OQ-1 validation |
| F-A1-7: federation sink domain leak | HIGH | Fixed: moved to domains/cluster/federation-sink.ts |
| F-A3-10: L2 vs L4 mislabel | HIGH | Fixed: Section 3.3 heading + FCA table |
| F-A5-2: Windows Tailscale API | HIGH | Fixed: added platform-specific access note |
| F-A1-2: test co-location | HIGH | Fixed: tests co-located next to source |

Full review: `tmp/review-report-prd038-039-2026-03-29.md`, `tmp/action-plan-prd038-039-2026-03-29.md`

## 14. Implementation Status

| Phase | Status | Notes |
|-------|--------|-------|
| Phase 1: Cluster Package + Ports | Not started | Foundation — no bridge changes |
| Phase 2: Bridge Domain + Tailscale Discovery | Not started | Depends on Phase 1 |
| Phase 3: Work Routing + Event Federation | Not started | Depends on Phase 2 |
| Phase 4: method-ctl CLI | Not started | Depends on Phase 3 |
| Phase 5: SWIM-Lite Gossip | Not scheduled | Future — when >5 nodes or Tailscale API insufficient |
