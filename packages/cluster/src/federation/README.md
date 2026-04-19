# Federation

Event federation layer for `@methodts/cluster`.

## EventRelay

The `EventRelay` decides which local bridge events should be relayed to remote cluster peers. It enforces loop prevention, severity filtering, and domain filtering before sending events through the injected `NetworkProvider`.

## Filter Rules

An event is relayed only if ALL conditions are met:

1. **Federation enabled** — `federationEnabled` is `true` in config.
2. **Not already federated** — the event does not have `federated: true` (loop prevention).
3. **Severity matches** — the event's severity is in the `severityFilter` list.
4. **Domain matches** — the event's domain is in the `domainFilter` list, OR the filter is empty (all domains pass).

## Configuration

All settings are configurable via `EventRelayConfigSchema` (Zod-validated):

| Parameter | Default | Description |
|-----------|---------|-------------|
| `federationEnabled` | `true` | Master switch for event federation |
| `severityFilter` | `['warning', 'error', 'critical']` | Only relay events at these severity levels |
| `domainFilter` | `[]` (all) | Only relay events from these domains; empty = all |

## Design

- **Loop prevention:** Events arriving with `federated: true` are never re-relayed. The relay stamps all outgoing events with `sourceNodeId` and `federated: true` via the `event-relay` cluster message type.
- **Port injection:** All network I/O goes through the injected `NetworkProvider` — zero transport dependencies.
- **Silent drops:** If no alive peers exist, events are dropped without error. Federation is best-effort.
- **Peer filtering:** Only `alive` peers receive relayed events. Dead, suspect, and draining nodes are skipped.
