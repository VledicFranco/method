# coverage

Implements `CoverageReportPort` — computes documentation coverage statistics from the FCA index.

## Files

| File | Purpose |
|---|---|
| `mode-detector.ts` | Pure function: maps (weightedAverage, threshold) → IndexMode |
| `coverage-engine.ts` | `CoverageEngine` class — implements `CoverageReportPort` |
| `coverage-engine.test.ts` | Unit tests using `InMemoryIndexStore` |

## Mode determination

`detectMode(weightedAverage, threshold)` returns `'production'` when `weightedAverage >= threshold`, `'discovery'` otherwise. The comparison is `>=`, so `overallScore === threshold` qualifies as production mode. The default threshold is `0.8`.

## Coverage arithmetic

**overallScore** is the `weightedAverage` returned directly from `IndexStorePort.getCoverageStats()`.

**Bucket counts** are derived by iterating every entry from `queryByFilters`:

- `fullyDocumented` — entries where `coverageScore === 1.0`
- `partiallyDocumented` — entries where `0 < coverageScore < 1.0`
- `undocumented` — entries where `coverageScore === 0`

These three counts always sum to `totalComponents`.

## missingParts computation

For each component in a verbose report:

```
missingParts = requiredParts.filter(p => !presentParts.includes(p))
```

`presentParts` is derived from `IndexEntry.parts.map(p => p.part)`. `requiredParts` is taken from `CoverageEngineConfig.requiredParts`, defaulting to `['interface', 'documentation']`. Parts outside `requiredParts` are never listed as missing.

## FcaLevel case convention

`FcaLevel` is always uppercase (`'L0'`–`'L5'`) throughout the codebase. `IndexEntry.level` and `ComponentCoverageEntry.level` share the same type, so no case conversion is needed when mapping entries to coverage report entries.

## Constructor injection pattern

`CoverageEngine` receives its dependencies through the constructor:

```typescript
const engine = new CoverageEngine(store, { threshold: 0.9 });
```

`store` is any `IndexStorePort` implementation (production: `SqliteLanceIndexStore`, tests: `InMemoryIndexStore`). `config` is optional — both `threshold` and `requiredParts` have defaults.
