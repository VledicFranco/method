# query domain

Implements `ContextQueryPort` — semantic retrieval of FCA component descriptors from a project index.

## Files

| File | Purpose |
|------|---------|
| `query-engine.ts` | `QueryEngine` — main port implementation |
| `result-formatter.ts` | `ResultFormatter` — maps `IndexEntry` to `ComponentContext` |

## Retrieval strategy

**Hybrid retrieval: embed → similarity search → filter → rank**

1. The natural-language query is embedded via `EmbeddingClientPort.embed()`.
2. `IndexStorePort.queryBySimilarity()` performs cosine-similarity search against all stored component embeddings, with metadata filters applied server-side (levels, parts, minCoverageScore).
3. Results are returned pre-ranked by the store (most similar first).
4. `ResultFormatter` maps store entries to `ComponentContext` descriptors, assigning positional relevance scores.

## IndexMode determination

After retrieval, `QueryEngine` calls `store.getCoverageStats(projectRoot)` to obtain the weighted-average coverage score across all indexed components. This is compared against `coverageThreshold` (default `0.8`):

- `weightedAverage >= coverageThreshold` → mode is `'production'` (index is trustworthy)
- `weightedAverage < coverageThreshold` → mode is `'discovery'` (index is incomplete; results carry less confidence)

Consumers (e.g., `@method/mcp`) may surface discovery-mode warnings to the agent so it knows to treat results with appropriate caution.

## Constructor injection

`QueryEngine` depends on two ports injected at construction time:

```typescript
new QueryEngine(store, embedder, { projectRoot, coverageThreshold })
```

- `store: IndexStorePort` — the hybrid SQLite+Lance index (or `InMemoryIndexStore` in tests)
- `embedder: EmbeddingClientPort` — the embedding service (or a stub in tests)

This pattern keeps the query domain free of I/O concerns and makes it fully unit-testable.

## FcaLevel case convention

`IndexStorePort` and `ContextQueryPort` both use uppercase `FcaLevel` values (`'L0'`–`'L5'`). `ResultFormatter` uppercases the first character of the stored level string as a defensive normalisation step, so either casing in a store implementation is handled safely.
