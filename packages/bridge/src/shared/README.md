# shared/ — Cross-Domain Bridge Utilities

Utilities shared across bridge domains that do not belong to any single domain. All modules here are side-effect free or infrastructure-level — no domain logic.

## Modules

| Module | Purpose |
|--------|---------|
| `event-bus/` | Universal typed event backbone (PRD 026) — InMemoryEventBus + all sinks |
| `config/` | Config reload utilities — hot-reload `.method/project-card.yaml` without restart |
| `validation/` | Zod-based request validation middleware for bridge HTTP routes |
| `websocket/` | WebSocket server abstraction for frontend event streaming |

## Design Rule

Modules in `shared/` must not import from `domains/`. They may import from `ports/`. If a utility needs domain behavior, it belongs in that domain, not here.
