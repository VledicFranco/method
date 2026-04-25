# @methodts/pacta-trace-sqlite

SQLite-backed `TraceStore` for the `@methodts/pacta` hierarchical trace
pipeline (PRD 058).

## Why a separate package

`@methodts/pacta` enforces a `G-PORT` architecture gate: **zero
third-party runtime dependencies**. SQLite is a native binary
dependency (`better-sqlite3`), so the persistent store implementation
lives here, in a sibling package, and pacta stays clean.

Consumers who need ring-buffer-only observability use pacta directly.
Consumers who want persistent history pull this package in alongside.

## Usage

```typescript
import { createCognitiveCycle } from '@methodts/pacta';
import { SqliteTraceStore } from '@methodts/pacta-trace-sqlite';

const store = new SqliteTraceStore({ dbPath: './traces.db', retentionDays: 7 });
await store.initialize();

const cycle = createCognitiveCycle(modules, config);
await cycle.run(input, workspace, [store]);

// Query
const recent = await store.getCycles({ limit: 20 });
const stats = await store.getStats({ windowCycles: 50 });

await store.close();
```

`SqliteTraceStore` implements both `TraceSink` (consumes events,
assembles via an internal `TraceAssembler`, persists assembled
`CycleTrace`s) and `TraceStore` (read API for the bridge dashboard,
retros, self-monitor).

## Schema

Single `cycle_traces` table:

| Column | Type | Notes |
|---|---|---|
| cycle_id | TEXT | PK |
| cycle_number | INTEGER | |
| started_at | INTEGER | ms since epoch — indexed |
| ended_at | INTEGER | |
| duration_ms | REAL | |
| input_text | TEXT | |
| output_text | TEXT | |
| data | TEXT | full CycleTrace serialized as JSON |

## Retention

`retentionDays` (default 7) deletes cycles whose `started_at` is older
than the cutoff. Cleanup runs on `initialize()`.

## Related

- [PRD 058](../../docs/prds/058-hierarchical-trace-observability.md)
- [`@methodts/pacta` cognitive/observability](../pacta/src/cognitive/observability/README.md)
- [TraceStore port](../pacta/src/cognitive/algebra/trace-store.ts)
