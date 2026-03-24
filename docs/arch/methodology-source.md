# Architecture: MethodologySource Port

Concern: methodology data access abstraction (WS-1 core deprecation).

## Problem

The original architecture used `@method/core` (L1) as a YAML loader to read methodology
specs from `registry/` at runtime. Meanwhile, `@method/methodts` (L2) provided a typed
stdlib catalog with the same data compiled into TypeScript. This dual-source pattern
created ambiguity about which layer was the source of truth for methodology data.

## Solution: MethodologySource Port

A port interface (`MethodologySource`) provides a single seam for all methodology data
access. Consumers depend on the port, not on any concrete data source.

### Port Interface

```typescript
// packages/bridge/src/ports/methodology-source.ts

interface MethodologySource {
  /** List all available methodologies and their methods. */
  list(): CatalogMethodologyEntry[];

  /** Lookup a typed Method by methodology ID and method ID. */
  getMethod(methodologyId: string, methodId: string): Method<any> | undefined;

  /** Lookup a typed Methodology by ID. */
  getMethodology(methodologyId: string): Methodology<any> | undefined;
}
```

### Implementations

| Class | Location | Purpose |
|-------|----------|---------|
| `StdlibSource` | `ports/stdlib-source.ts` | Production — wraps `@method/methodts` stdlib catalog. Zero I/O. |
| `InMemorySource` | `ports/in-memory-source.ts` | Testing — accepts data in constructor, proves port substitutability. |

`StdlibSource` delegates to three functions from `@method/methodts/stdlib`:
`getStdlibCatalog()`, `getMethod()`, and `getMethodology()`. All data is compiled
TypeScript — no YAML parsing, no filesystem access at runtime.

`InMemorySource` is a ~30-line data container that satisfies the same interface. Its
existence proves the port is a real seam, not a port-shaped wrapper around a single
concrete dependency.

## Composition Root Wiring

The composition root (`packages/bridge/src/server-entry.ts`) instantiates the concrete
provider and injects it into consumers:

```typescript
const methodologySource = new StdlibSource();
const methodologyStore = new MethodologySessionStore(methodologySource);
```

Domain code (`MethodologySessionStore`, route handlers) receives the port via constructor
injection and never imports `@method/core` or `@method/methodts` directly.

## What This Replaces

The old `@method/core` package provided:
- YAML loader (`loadMethodology`, `loadMethod`) — read from `registry/` at runtime
- Theory lookup functions

With the MethodologySource port:
- Methodology data comes from the typed stdlib catalog via `StdlibSource`
- Theory lookup remains in `@method/core` (no port needed — read-only, no substitutability requirement)
- `@method/core` is **deprecated** for methodology loading; its only remaining use is theory lookup

## DR-15 Compliance

This pattern follows DR-15 (FCA port discipline): external dependencies are accessed
through port interfaces, domain code accepts ports via constructor injection, and the
composition root is the only place that instantiates concrete providers.

## Files

| Path | Role |
|------|------|
| `packages/bridge/src/ports/methodology-source.ts` | Port interface definition |
| `packages/bridge/src/ports/stdlib-source.ts` | Production implementation |
| `packages/bridge/src/ports/in-memory-source.ts` | Test implementation |
| `packages/bridge/src/ports/methodology-source.test.ts` | Port contract tests |
| `packages/bridge/src/server-entry.ts` | Composition root wiring |
