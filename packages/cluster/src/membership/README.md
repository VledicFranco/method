# Membership

State machine managing cluster membership for `@methodts/cluster`.

## State Transitions

```
              heartbeat received
  ┌───────────────────────────────────┐
  │                                   │
  ▼                                   │
alive ──── missed heartbeat ───► suspect ──── extended timeout ───► dead ──── GC ───► removed
  ▲           (suspectTimeout)           │      (deadTimeout)              (gcTimeout)
  │                                      │
  └──────────── heartbeat ───────────────┘
                received
```

## Configuration

All timeouts are configurable via `MembershipConfigSchema` (Zod-validated):

| Parameter | Default | Description |
|-----------|---------|-------------|
| `heartbeatMs` | 5000 | Interval between heartbeat pings |
| `suspectTimeoutMs` | 15000 | Time before alive → suspect |
| `deadTimeoutMs` | 30000 (2x suspect) | Time before suspect → dead |
| `gcTimeoutMs` | 45000 (3x suspect) | Time before dead → removed |
| `stateBroadcastMs` | 10000 | Full state sync broadcast interval |

## Design

- **Port injection:** All I/O (discovery, network, resources) enters via constructor-injected ports.
- **Clock injection:** `manager.now` can be replaced for deterministic testing.
- **Timer primitives:** Uses `setInterval`/`setTimeout` (language primitives, not transport deps).
- **Generation counter:** Monotonically increases on every state change, enabling crdt-style convergence.
