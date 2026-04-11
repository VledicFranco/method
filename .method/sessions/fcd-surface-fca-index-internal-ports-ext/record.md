---
type: co-design-record
surface: "FileSystemPort + IndexStorePort (extension)"
date: "2026-04-10"
owner: "fca-index"
producer: "fca-index"
consumer: "fca-index (internal domains)"
direction: "internal"
status: frozen
mode: "extension"
extends:
  - "FileSystemPort (frozen 2026-04-08)"
  - "IndexStorePort (frozen 2026-04-08)"
---

# Co-Design Record — Internal Port Extensions

## Context

Two internal ports in `@method/fca-index` were extended post-freeze (2026-04-09) to support
Feature Sets A and B. The extensions were marked WARN-LEGACY at the time. This record
formalizes them as frozen extensions.

Both ports are **internal** — they do not cross package boundaries. All producers and
consumers are within `@method/fca-index`. The co-design obligation is lighter than for
external ports but the record still matters for maintaining port discipline.

## Extension 1: FileSystemPort.getModifiedTime

**Added:** 2026-04-09 (Feature Set A — freshness tracking)
**Producer:** `NodeFileSystem` in `cli/node-filesystem.ts`
**Consumer:** `QueryEngine` in `query/query-engine.ts`
**Purpose:** Detect stale index entries by comparing directory mtime to `indexedAt` timestamp.

```typescript
/**
 * Get the last modified time of a path, in milliseconds since Unix epoch.
 */
getModifiedTime(path: string): Promise<number>;
```

### Decision: Why on FileSystemPort (not a new port)

`getModifiedTime` is a filesystem operation — it belongs on the existing filesystem
abstraction. Creating a separate `FreshnessPort` would split a coherent capability across
two interfaces without benefit. The scanner already uses `FileSystemPort` for `glob()` and
`readFile()` in the same domain.

### Decision: Return type is raw milliseconds

Milliseconds since epoch (not `Date`, not ISO string) because:
- Arithmetic comparison against `indexedAt` is the only consumer operation
- `Date` objects add conversion overhead with no benefit
- Matches `fs.stat().mtimeMs` exactly — no precision loss

## Extension 2: IndexStorePort.getByPath

**Added:** 2026-04-09 (Feature Set B — ComponentDetailPort)
**Producer:** `SqliteLanceIndexStore`, `InMemoryIndexStore`
**Consumer:** `ComponentDetailEngine` in `query/component-detail-engine.ts`
**Purpose:** Single-entry lookup by path for the `context_detail` MCP tool.

```typescript
/**
 * Retrieve a single entry by its path within a project.
 * Returns null if no entry exists for the given path.
 */
getByPath(path: string, projectRoot: string): Promise<IndexEntry | null>;
```

### Decision: Return null (not throw) for missing entries

The existing `queryBySimilarity` returns an empty array for no matches — it does not throw.
`getByPath` follows the same pattern: return `null` for "not found". The caller
(`ComponentDetailEngine`) translates `null` into a typed `ComponentDetailError('NOT_FOUND')`
at the port boundary. This keeps the store layer unaware of consumer error semantics.

### Decision: Path is relative to projectRoot (not absolute)

Consistent with `IndexEntry.path` which is always relative. The store uses `(path, projectRoot)`
as a composite lookup key — same as `clear(projectRoot)` scoping.

## Updated Freeze Status

| Port | Original freeze | Extension date | New freeze |
|------|----------------|----------------|------------|
| `FileSystemPort` | 2026-04-08 | 2026-04-09 | 2026-04-10 |
| `IndexStorePort` | 2026-04-08 | 2026-04-09 | 2026-04-10 |

Both ports are now frozen at 2026-04-10 including the extensions.

## Agreement
- Extended: 2026-04-09 (WARN-LEGACY)
- Formalized: 2026-04-10
- Frozen: 2026-04-10
- Future changes require: new `/fcd-surface` session
