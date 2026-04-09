# Commission Mandate — Feature Set A: Scan Hygiene + CI Gate + Freshness Signal

**Domain:** `packages/fca-index/src/`
**Session slug:** `fcd-commission-fca-feature-set-a`
**Iteration:** 0

## Task Summary

Bug fixes and small enhancements within the `@method/fca-index` package:
1. Scanner: exclude test dirs/files by default
2. Index store: skip Lance upsert for components with < 100 chars of doc text
3. Coverage CLI: exit with code 1 when below threshold
4. ContextQueryResult: add optional `staleComponents` field
5. FileSystemPort: add `getModifiedTime` (WARN-LEGACY)
6. NodeFileSystem: implement `getModifiedTime`
7. QueryEngine: inject FileSystemPort, populate `staleComponents`
8. Query CLI command: print stale warning

## Consumed Ports

| Port | File | Status |
|------|------|--------|
| `FileSystemPort` | `src/ports/internal/file-system.ts` | WARN-LEGACY (frozen 2026-04-08; adding `getModifiedTime` post-freeze) |
| `IndexStorePort` | `src/ports/internal/index-store.ts` | PASS (frozen 2026-04-08; not modified) |
| `ContextQueryPort` | `src/ports/context-query.ts` | PASS (frozen 2026-04-08; additive field only) |

## Tech Debt Notes

- `getModifiedTime` on `FileSystemPort` was added post-freeze. Needs formal co-design record in a future surface session.
- `IndexEntry` has no top-level `docText` field — doc text is computed from `parts[].excerpt`. The lance upsert guard uses this computed value.

## Files to Modify

- `src/scanner/project-scanner.ts`
- `src/index-store/index-store.ts`
- `src/cli/commands/coverage.ts`
- `src/ports/context-query.ts`
- `src/ports/internal/file-system.ts`
- `src/cli/node-filesystem.ts`
- `src/query/query-engine.ts`
- `src/cli/commands/query.ts`
- `src/factory.ts`
- `src/cli/index.ts`

## Completed Tasks

(none yet)
