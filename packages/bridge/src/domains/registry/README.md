---
title: Registry
scope: domain
package: bridge
contents:
  - index.ts
  - project-registry.ts
  - project-registry.test.ts
  - resource-copier.ts
  - resource-copier.test.ts
  - resource-copier-routes.test.ts
  - routes.ts
  - routes.test.ts
  - frontend.test.ts
---

# Registry

Project registry and resource management domain. Maintains an in-memory queryable registry of compiled methodology YAML specs and discovered project configurations. Serves the methodology tree, method details, manifest sync status, and promotion records via REST API backed by the @method/methodts stdlib catalog. Also provides resource copying between projects — copying methodology entries and strategy entries from a source manifest to target project manifests with per-target status reporting and graceful partial failure handling.

| Module | Purpose |
|--------|---------|
| [index.ts](index.ts) | Barrel exports for ProjectRegistry, routes, and resource copier functions |
| [project-registry.ts](project-registry.ts) | In-memory registry of methodology specs and project configurations with load, cache, and validate |
| [resource-copier.ts](resource-copier.ts) | Copies methodology and strategy entries between project manifest.yaml files with partial failure handling |
| [routes.ts](routes.ts) | Fastify routes for registry tree, manifest, method detail, promotion records, and cache reload |
