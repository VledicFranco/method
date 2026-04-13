---
type: co-design-record
surface: "ObservabilityPort"
date: "2026-04-13"
owner: "@method/fca-index"
producer: "@method/fca-index/cli (StderrObservabilitySink), @method/fca-index/testkit (RecordingObservabilitySink)"
consumer: "@method/fca-index/query, @method/fca-index/index-store (future: scanner, coverage, compliance)"
direction: "fca-index domains → sink (unidirectional, fire-and-forget)"
status: frozen
mode: "new"
skill_session: "/fcd-surface observability port"
---

# Co-Design Record — ObservabilityPort

## Interface

```typescript
export interface ObservabilityPort {
  /**
   * Emit a structured observability event. Fire-and-forget.
   * MUST NOT throw — observability failures must never break the operation
   * being observed.
   */
  emit(event: ObservabilityEvent): void;
}

export interface ObservabilityEvent {
  event: string;                               // "start", "done", "rate_limited", ...
  scope: string;                               // "query", "embed", "scan", ...
  ts: string;                                  // ISO 8601, filled by emitter
  severity?: 'debug' | 'info' | 'warn' | 'error';
  fields?: Record<string, unknown>;            // flat key-value preferred
  error?: { message: string; code?: string };
}

export class NullObservabilitySink implements ObservabilityPort { /* no-op */ }

export function scoped(
  port: ObservabilityPort,
  scope: string,
): (event: string, fields?: Record<string, unknown>, severity?: ObservabilityEvent['severity']) => void;
```

## Producer(s) — who IMPLEMENTS the interface

| Impl | Location | Purpose |
|---|---|---|
| `StderrObservabilitySink` | `packages/fca-index/src/cli/stderr-observability-sink.ts` | Default for CLI / standalone. Emits `[<prefix>.<scope>] {json}\n` lines to stderr — matches the legacy format pre-PR #163. Supports custom prefix and `minSeverity` filter. |
| `RecordingObservabilitySink` | `packages/fca-index/src/testkit/recording-observability-sink.ts` | Test double. Records every event; provides `find()`, `assertEmitted()`, `clear()`. |
| `NullObservabilitySink` | `packages/fca-index/src/ports/observability.ts` (co-located with port) | Safe default for library callers who don't care about observability. |
| Bridge adapter | *(future)* — `packages/bridge/src/...` | Will forward events to PRD 026 Universal Event Bus. Not in this PR's scope; belongs to whenever bridge integrates fca-index queries directly. |

## Consumer(s) — who CALLS the interface

| Caller | Location | Wiring |
|---|---|---|
| `QueryEngine` | `packages/fca-index/src/query/query-engine.ts` | 5th constructor param (optional, defaults to `NullObservabilitySink`). Emits `query.start`, `query.done`, `query.error`. |
| `VoyageEmbeddingClient` | `packages/fca-index/src/index-store/embedding-client.ts` | 2nd constructor param (optional, defaults to `NullObservabilitySink`). Emits `embed.rate_limited` with severity=warn. |
| Scanner, coverage, compliance | — *(future)* | Same pattern; no open call sites yet. |

## Composition root wiring

| Composition root | What it does |
|---|---|
| `createFcaIndex` | Reads `ports.observability` (optional); defaults to `NullObservabilitySink`. Passes to QueryEngine. EmbeddingClient is caller-provided, so its observability is the caller's concern. |
| `createDefaultFcaIndex` | Reads `config.observability` (optional); defaults to **`StderrObservabilitySink`** (so standalone library users get logs by default). Wires the same sink into `VoyageEmbeddingClient` and then delegates to `createFcaIndex`. |
| CLI `packages/fca-index/src/cli/index.ts` | Instantiates `StderrObservabilitySink` once at `main()` and passes it into both `VoyageEmbeddingClient` and `QueryEngine`. |

## Agreement

- **Frozen:** 2026-04-13
- **Changes require:** new `/fcd-surface` session
- **Extension without freeze change:** adding new event names and `fields` keys is additive (not a port change). Sinks ignore unknown events; callers can stop emitting deprecated events without sink updates.
- **Backwards-incompatible changes requiring a new session:**
  - Removing or renaming `emit`, `event`, `scope`, `ts`, `severity`, `fields`, or `error`
  - Changing method return type from `void` to anything non-void
  - Making the non-throwing contract non-binding (would require audit of all sinks + callers)

## Gate Assertion

`packages/fca-index/src/architecture.test.ts` — new **G-PORT-OBSERVABILITY** describe block:

```typescript
describe('G-PORT-OBSERVABILITY: domain code emits observability through the port, not stderr directly', () => {
  it('query/, index-store/, scanner/, coverage/, compliance/ do not write to process.stderr for observability', () => {
    // CLI error messages are presentation, not observability — excluded.
    // StderrObservabilitySink itself writes to stderr — excluded (composition root).
    // template-generator.ts contains a STRING LITERAL of code to be written out — excluded.
    const domainDirs = ['query', 'index-store', 'scanner', 'coverage', 'compliance'];
    // ... scan and assert no process.stderr.write in those dirs ...
  });
});
```

See `packages/fca-index/src/architecture.test.ts` for the full assertion including exceptions.

## Rationale notes (not in the port file)

### Why one method, not a multi-method logger interface

A multi-method logger (`info()`, `warn()`, `error()`) was considered and rejected. Every call site can express severity via the `severity` field — there is no consumer code path that needs method dispatch. A single method keeps the port surface minimal (composition theorem: fewer methods = less drift risk) and makes sinks trivially generic.

### Why `fields: Record<string, unknown>` and not a typed per-event payload

Typed payloads per event (`QueryStartEvent`, `QueryDoneEvent`, etc.) were considered and rejected **for now**. The full event catalog is still evolving; locking shapes per event would prevent callers from adding fields without port updates. When the catalog stabilises, we can layer a typed builder on top of the generic port without breaking the contract.

### Why not reuse bridge's `EventSink`

Bridge's `EventSink` (PRD 026) lives at L4. fca-index is L3 and cannot import from L4 (G-LAYER). Defining `ObservabilityPort` in fca-index preserves the layering. When the bridge integrates fca-index, a small adapter translates `ObservabilityEvent` → `BridgeEvent` — cheap, explicit, doesn't violate layers.

### Scope boundary: CLI error writes are NOT observability

`packages/fca-index/src/cli/*.ts` has multiple `process.stderr.write("Error: ...")` calls for user-facing error messages. Those are **presentation**, not observability, and are explicitly excluded from G-PORT-OBSERVABILITY. The distinction: observability events are structured, machine-parseable signals about *what the program is doing*; presentation is user-oriented prose about *what the user should know*.

## Known migration trade-off

Pre-port, `query-engine.ts` wrote `[fca-index.query] {json}` lines to stderr directly. Post-port, the same output is produced by `StderrObservabilitySink` (default). One slight additive change: the new sink always includes `severity` in the JSON payload (defaulted to `"info"` if the caller didn't provide it). Downstream grep/jq pipelines that don't reference `severity` continue to work unchanged; pipelines that do will see a new field.
