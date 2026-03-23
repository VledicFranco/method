---
title: Projects
scope: domain
package: bridge
contents:
  - index.ts
  - discovery-service.ts
  - discovery-service.test.ts
  - discovery-service.e2e.test.ts
  - discovery-registry-integration.ts
  - discovery-config-integration.test.ts
  - routes.ts
  - routes.test.ts
  - dashboard-multi-project.test.ts
  - isolation-cross-project.test.ts
  - event-persistence-contract.test.ts
  - event-persistence.test.ts
  - yaml-event-persistence.test.ts
  - jsonl-event-persistence.test.ts
  - project-event.test.ts
---

# Projects

Multi-project discovery and event persistence domain (PRD 020). Handles recursive scanning of the filesystem to find .git repositories with .method/ directories, loading and validating their manifest configurations, and providing cursor-based event streams for project lifecycle tracking. The event subsystem supports two persistence backends (YAML and JSONL) with append-only semantics, file rotation, and automatic migration. All project access is isolation-enforced to prevent cross-project data leaks.

| Module | Purpose |
|--------|---------|
| [index.ts](index.ts) | Barrel exports for routes, event log, cursor utilities, and isolation validators |
| [discovery-service.ts](discovery-service.ts) | Recursive fail-safe repository scanner with timeout protection, checkpoint support, and manifest loading |
| [discovery-registry-integration.ts](discovery-registry-integration.ts) | Bridges DiscoveryService with ProjectRegistry — loads manifests and emits CONFIG_DISCOVERED events |
| [routes.ts](routes.ts) | Fastify routes for project listing, detail, validation, repair, reload, and cursor-based event polling |
| [events/project-event.ts](events/project-event.ts) | Core ProjectEvent schema — immutable, YAML-serializable, append-only event type |
| [events/event-persistence.ts](events/event-persistence.ts) | Abstract EventPersistence interface for append-only queryable event storage |
| [events/yaml-event-persistence.ts](events/yaml-event-persistence.ts) | Disk-based YAML event persistence with async-buffered writes, rotation, and startup recovery |
| [events/jsonl-event-persistence.ts](events/jsonl-event-persistence.ts) | High-performance JSON Lines event persistence with streaming reads and YAML migration |
