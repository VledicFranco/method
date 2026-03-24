---
title: Genesis
scope: domain
package: bridge
contents:
  - index.ts
  - spawner.ts
  - spawner.test.ts
  - polling-loop.ts
  - polling-loop-parallel.test.ts
  - cursor-manager.ts
  - cursor-manager.test.ts
  - cursor-lifecycle.test.ts
  - initialization.ts
  - tools.ts
  - tools.test.ts
  - routes.ts
  - routes.test.ts
  - e2e-discovery-genesis.test.ts
  - performance-baselines.test.ts
---

# Genesis

Multi-project coordination agent domain (PRD 020 Phase 2A). Genesis is a persistent background agent that observes project state across all discovered repositories and reports findings without executing changes directly. This domain manages spawning the Genesis session with root-level access and budget tracking, polling project event streams with cursor-based pagination and file-persisted cursor state, scheduled cursor cleanup with file-level mutex protection, the behavioral initialization prompt, MCP tool implementations for project discovery and event reading, and HTTP routes for Genesis status, prompting, and reporting.

| Module | Purpose |
|--------|---------|
| [index.ts](index.ts) | Barrel exports for spawner, polling loop, cursor manager, routes, and initialization |
| [spawner.ts](spawner.ts) | Creates and manages the persistent Genesis session with budget tracking and root-level access |
| [polling-loop.ts](polling-loop.ts) | Polls project event streams, manages cursor state in .method/genesis-cursors.yaml, dispatches to Genesis |
| [cursor-manager.ts](cursor-manager.ts) | Scheduled background job for cursor cleanup with file-level mutex to prevent race conditions |
| [initialization.ts](initialization.ts) | Genesis behavioral initialization prompt establishing the OBSERVE+REPORT contract |
| [tools.ts](tools.ts) | MCP tool implementations — project_list, project_get, project_get_manifest, project_read_events, genesis_report |
| [routes.ts](routes.ts) | Fastify HTTP routes for Genesis status, prompt, abort, project access, and report submission |
