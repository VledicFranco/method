---
guide: 31
title: "Bridge Cluster"
domain: cluster
audience: [agent-operators, platform-engineers]
summary: >-
  Enable clustering across bridge instances — peer discovery, capacity-aware work routing,
  event federation, and unified management via method-ctl.
prereqs: [10, 15, 30]
touches:
  - packages/cluster/
  - packages/bridge/src/domains/cluster/
  - packages/method-ctl/
  - docs/arch/cluster.md
---

# Guide 31 — Bridge Cluster

How to run multiple bridge instances as a coordinated cluster: automatic peer discovery via Tailscale, capacity-aware work routing, event federation across nodes, and unified management through `method-ctl`.

**Prerequisites:** Familiarity with bridge basics (Guide 10), Tailscale mesh setup (Guide 15), and instance profiles (Guide 30).

## 1. Enabling Clustering

Clustering is opt-in. Set `CLUSTER_ENABLED=true` in your instance profile or environment:

```bash
# .method/instances/production.env
INSTANCE_NAME=mission-control
PORT=3456
CLUSTER_ENABLED=true
CLUSTER_SEEDS=laptop.emu-cosmological.ts.net:3456
```

When disabled (default), the cluster domain is a complete no-op: zero timers, zero network calls, zero overhead. All `/cluster/*` endpoints return 404.

### Minimum config for two machines

**Machine A** (`mission-control`):
```bash
# .method/instances/production.env
INSTANCE_NAME=mission-control
PORT=3456
CLUSTER_ENABLED=true
```

**Machine B** (`laptop`):
```bash
# .method/instances/production.env
INSTANCE_NAME=laptop
PORT=3456
CLUSTER_ENABLED=true
CLUSTER_SEEDS=mission-control.emu-cosmological.ts.net:3456
```

Both machines must be on the same Tailscale mesh. If Tailscale is available, bridges discover each other automatically. `CLUSTER_SEEDS` provides a fallback when the Tailscale CLI isn't installed or accessible.

### All cluster environment variables

| Variable | Default | What it does |
|----------|---------|-------------|
| `CLUSTER_ENABLED` | `false` | Master switch for the cluster subsystem |
| `CLUSTER_NODE_ID` | auto-generated UUID | Stable identity for this bridge install, persisted to `.method/cluster-node-id` |
| `CLUSTER_SEEDS` | `""` | Comma-separated `host:port` addresses for bootstrapping when Tailscale is unavailable |
| `CLUSTER_HEARTBEAT_MS` | `5000` | How often to ping peers (ms) |
| `CLUSTER_SUSPECT_TIMEOUT_MS` | `15000` | How long before a silent peer is marked suspect |
| `CLUSTER_STATE_BROADCAST_MS` | `10000` | How often to broadcast full state to all peers |
| `CLUSTER_FEDERATION_ENABLED` | `true` | Whether to relay events to peers |
| `CLUSTER_FEDERATION_FILTER_SEVERITY` | `warning,error,critical` | Only federate events at these severity levels |
| `CLUSTER_FEDERATION_FILTER_DOMAIN` | `""` | Only federate events from these domains (empty = all) |

## 2. How Discovery Works

When a bridge starts with `CLUSTER_ENABLED=true`:

1. **Tailscale probe:** Runs `tailscale status --json` to get all machines on the mesh. For each machine, probes `GET /health` on the bridge port. Machines that respond with a bridge health check are added as peers.

2. **Seed fallback:** If the Tailscale CLI isn't available, parses `CLUSTER_SEEDS` and probes those addresses directly.

3. **Join handshake:** For each discovered peer, sends a `join` message with the local node's identity and resources. The peer adds the new node to its membership state.

After initial discovery, the heartbeat loop maintains the connection. Each node pings all known peers every `CLUSTER_HEARTBEAT_MS`. If a peer stops responding:

```
alive ──(no heartbeat for 15s)──→ suspect ──(no heartbeat for 30s)──→ dead ──(gc after 45s)──→ removed
```

A recovering peer that sends a heartbeat moves back from `suspect` to `alive`.

## 3. Using method-ctl

`method-ctl` is a standalone CLI for querying cluster state. It talks to bridges over HTTP — no internal dependencies.

### Setup

Create `~/.method/cluster.json`:

```json
{
  "default_bridge": "localhost:3456",
  "known_bridges": [
    { "name": "mission-control", "address": "mission-control.emu-cosmological.ts.net:3456" },
    { "name": "laptop", "address": "laptop.emu-cosmological.ts.net:3456" }
  ],
  "output_format": "table"
}
```

If the config file doesn't exist, `method-ctl` defaults to `localhost:3456`.

### Commands

**Cluster status:**
```bash
method-ctl status
```
Shows a summary of the cluster: node count, alive/suspect/dead counts, total sessions, and a per-node table with status, sessions, CPU, memory, projects, and uptime.

**Node list:**
```bash
method-ctl nodes                    # All nodes
method-ctl nodes mission-control    # Single node detail
```

**Projects across the cluster:**
```bash
method-ctl projects
```
Aggregates discovered projects from all bridges. Shows which projects are on which nodes.

**Override the target bridge:**
```bash
method-ctl --bridge laptop.emu-cosmological.ts.net:3456 status
```

**JSON output:**
```bash
method-ctl --format json status
```

## 4. Work Routing

The cluster can recommend which bridge should handle a new workload based on capacity:

```bash
# From any bridge or method-ctl
curl -X POST http://localhost:3456/cluster/route \
  -H "Content-Type: application/json" \
  -d '{"type": "strategy", "projectId": "pv-method"}'
```

The response includes the selected node and its score:

```json
{
  "node": { "nodeId": "...", "instanceName": "laptop", "address": { "host": "laptop", "port": 3456 }, ... },
  "score": 0.82
}
```

The scoring algorithm weighs:
- **Session headroom** (40%) — how many session slots are free
- **Memory** (30%) — available RAM
- **CPU** (20%) — idle CPU percentage
- **Project locality** (10%) — bonus if the node already has the requested project cloned

Nodes marked as `draining` are never selected.

## 5. Event Federation

When enabled, events from one bridge are visible on all other bridges in the cluster. A strategy completing on `laptop` generates events that appear on `mission-control`'s dashboard and event bus.

**What gets federated:**
- Events at severity `warning`, `error`, or `critical` (configurable via `CLUSTER_FEDERATION_FILTER_SEVERITY`)
- All domains by default (filterable via `CLUSTER_FEDERATION_FILTER_DOMAIN`)

**Loop prevention:** Federated events arrive with `federated: true` and `sourceNodeId` set. The federation sink never re-relays events that already have `federated: true`. This prevents A→B→A loops.

**Failure isolation:** If one peer is unreachable, events are still delivered to all other peers. Individual send failures are logged, not fatal.

## 6. Draining a Node

Before maintenance or shutdown, drain a node to stop it from receiving routed work:

```bash
curl -X POST http://mission-control:3456/cluster/drain
```

The node's status changes to `draining`. The routing algorithm gives draining nodes a score of 0, so no new work is directed to them. Existing sessions continue running.

To resume:
```bash
curl -X POST http://mission-control:3456/cluster/resume
```

Graceful shutdown (`SIGTERM`/`SIGINT`) sends a leave message to all peers so they immediately remove the node from their state, rather than waiting for the heartbeat timeout.

## 7. Verifying Cluster Health

### From the /health endpoint

When clustering is enabled, `GET /health` includes a `cluster` field:

```json
{
  "status": "ok",
  "instance_name": "mission-control",
  "cluster": {
    "enabled": true,
    "node_id": "a1b2c3d4-...",
    "peers_alive": 1,
    "peers_suspect": 0,
    "peers_dead": 0
  }
}
```

### From the cluster endpoints

```bash
# Full state (self + all peers with resources)
curl http://localhost:3456/cluster/state

# Node list
curl http://localhost:3456/cluster/nodes

# Single node
curl http://localhost:3456/cluster/nodes/<nodeId>
```

## 8. Troubleshooting

**Peers not discovering each other:**
- Verify both bridges have `CLUSTER_ENABLED=true`
- Check `tailscale status` — are both machines visible?
- Try setting `CLUSTER_SEEDS` explicitly: `CLUSTER_SEEDS=otherhost:3456`
- Check bridge logs for `[cluster]` messages

**Events not federating:**
- Verify `CLUSTER_FEDERATION_ENABLED=true` (default)
- Check the severity filter — only `warning`, `error`, `critical` are federated by default
- Federated events appear with `federated: true` in the event bus

**Peer showing as suspect/dead:**
- Check if the peer's bridge is running: `curl http://peer:3456/health`
- The suspect timeout is 15s by default — a brief network blip can trigger it
- Increase `CLUSTER_SUSPECT_TIMEOUT_MS` if your network has high latency

**method-ctl shows no data:**
- Verify `~/.method/cluster.json` points to the right bridge
- Try `method-ctl --bridge localhost:3456 status` to override
- Check that the target bridge has `CLUSTER_ENABLED=true`

## Technical Reference

For internal architecture details (port interfaces, message types, state machine, scoring algorithm), see `docs/arch/cluster.md`.
