# cognitive/observability — PRD 058 Wave 0 skeleton

Hierarchical trace observability — assembler, ring buffer, and SQLite store
that consume the `TraceEvent` stream and produce assembled `CycleTrace`s.

## Status

**Wave 0 (skeleton)** — types and ports are frozen in
[`docs/prds/058-hierarchical-trace-observability.md`](../../../../../docs/prds/058-hierarchical-trace-observability.md);
the implementations below are stubs that throw on use. Subsequent waves fill them in:

| Component | File | Wave | Commission |
|---|---|---|---|
| `TraceAssembler` | `assembler.ts` | 1 | C-1 |
| `TraceRingBuffer` | `ring-buffer.ts` | 1 | C-1 |
| `SqliteTraceStore` | `sqlite-store.ts` | 2 | C-4 |

## Mental model

```
producer → TraceSink.onEvent(event) → [ assembler | ring buffer | sqlite store ]
                                              │             │            │
                                              ▼             ▼            ▼
                                        CycleTrace    live stream    persisted
                                                                      history
```

- **TraceAssembler** — stateful event-stream → `CycleTrace` accumulator. Emits
  one `CycleTrace` per `cycle-end` event. Graceful degradation when
  `cycle-start` is missing (uses first event's timestamp as fallback).

- **TraceRingBuffer** — bounded deque + fan-out subscriptions. Implements both
  `TraceSink` (write) and `TraceStream` (subscribe). Slow subscribers whose
  internal queue saturates are dropped to prevent backpressure.

- **SqliteTraceStore** — persistent `TraceStore` over `better-sqlite3`. Implements
  both `TraceSink.onEvent` (consumes events, assembles via internal
  `TraceAssembler`, persists `CycleTrace`s) and `TraceStore` (read API). Time-
  range queries; retention cleanup on `initialize()`.

## Migration policy (from flat `TraceRecord`)

The legacy flat `TraceRecord` path stays in place during the migration window.
New code emits hierarchical events via `TraceSink.onEvent`; existing code keeps
using `onTrace`. Both flow through the same `TraceSink` port. A future PRD
removes flat traces once no consumer remains.

## Related

- [`docs/prds/058-hierarchical-trace-observability.md`](../../../../../docs/prds/058-hierarchical-trace-observability.md) — full PRD
- [`.method/sessions/fcd-plan-20260425-prd-058-trace/realize-plan.md`](../../../../../.method/sessions/fcd-plan-20260425-prd-058-trace/realize-plan.md) — wave plan
- `../algebra/trace-events.ts` — Surface 1 (streaming)
- `../algebra/trace-cycle.ts` — Surface 2 (assembled hierarchy)
- `../algebra/trace-stream.ts`, `trace-store.ts` — Surface 3 (ports)
