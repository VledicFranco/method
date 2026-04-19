# Routing

Capacity-weighted work routing for `@methodts/cluster`.

## Scoring Function

The `CapacityWeightedRouter` selects the optimal cluster node using a weighted scoring function over resource headroom and project locality:

```
score(node) =
  (sessionsMax - sessionsActive) / sessionsMax * sessionWeight   (40%)
  + memoryAvailableMb / memoryTotalMb * memoryWeight             (30%)
  + (1 - cpuLoadPercent / 100) * cpuWeight                       (20%)
  + (hasProject(node, request.projectId) ? localityWeight : 0)   (10%)
```

## Rules

- Only `alive` nodes are candidates; `draining`, `dead`, and `suspect` nodes are never selected.
- Nodes in `request.excludeNodes` are skipped entirely.
- Ties are broken by lowest `sessionsActive`.
- Returns `null` when no candidates have capacity.

## Configuration

Weights are configurable via `RouterConfigSchema` (Zod-validated):

| Parameter | Default | Description |
|-----------|---------|-------------|
| `sessionWeight` | 0.4 | Weight for session headroom |
| `memoryWeight` | 0.3 | Weight for memory headroom |
| `cpuWeight` | 0.2 | Weight for CPU headroom |
| `localityWeight` | 0.1 | Bonus for nodes with the requested project |

## Design

- **Port-free:** Pure scoring logic with no I/O dependencies. Receives `ClusterState` as input.
- **Interface:** Implements `WorkRouter` so alternative routing strategies can be swapped in.
- **Deterministic:** Given the same state and request, always returns the same node.
