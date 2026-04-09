# Project Events

Typed event definitions for the projects domain. All project lifecycle transitions (discovery, activation, deactivation, configuration changes) are represented as discriminated union members of `ProjectEvent`.

## Purpose

Separates the projects domain's event schema from its implementation. Consumers (EventBus sinks, persistence layer, frontend clients) import from here rather than from the broader projects domain — keeping the event contract narrow and stable.

## Key Type

`ProjectEvent` — discriminated union. Each variant carries a `type` discriminant and a typed `payload`:

| Event Type | Trigger |
|------------|---------|
| `project.discovered` | Scanner finds a new project directory |
| `project.activated` | Project becomes the active session target |
| `project.deactivated` | Project removed from active set |
| `project.config_changed` | `.fca-index.yaml` or project manifest reloaded |

Events flow into the Universal Event Bus (PRD 026) via the projects domain's route handlers.
