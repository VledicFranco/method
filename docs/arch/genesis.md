# Genesis

## Responsibility

Genesis is a persistent root-level session that monitors project discovery events and reports observations to human operators. It runs continuously in the background and receives event batches from the Universal Event Bus via GenesisSink.

**Key constraints:**
- Genesis has `project_id='root'` (bridge metadata). This distinguishes it from spawned agent sessions which target specific projects.
- Genesis sessions are marked `persistent=true`, skipping stale detection and auto-kill.
- Genesis receives events via GenesisSink (PRD 026 Phase 4) — no polling loop or cursor persistence.

### Relationship to Bridge Lifecycle

Genesis is spawned at bridge startup, after the HTTP server binds. If `GENESIS_ENABLED=true` (default), `spawnGenesis()` creates a new session with the OBSERVE+REPORT initialization prompt. A `GenesisSink` is registered on the event bus immediately after spawn — it batches events every 30 seconds and forwards warning/error/critical events to the Genesis session.

## File Structure

```
packages/bridge/src/
└── domains/genesis/
    ├── spawner.ts            Genesis spawn logic, dedup on recovery, session metadata setup
    ├── spawner.test.ts        Spawner unit tests (dedup, status helpers)
    ├── initialization.ts      OBSERVE+REPORT prompt template
    ├── routes.ts              HTTP endpoints for Genesis interaction
    └── config.ts              Zod-validated config (GENESIS_ENABLED, GENESIS_BUDGET_TOKENS_PER_DAY)
```

> **Note:** `polling-loop.ts` and `cursor-manager.ts` were deleted in PRD 026 Phase 5.
> Event delivery now goes through `GenesisSink` (see `shared/event-bus/genesis-sink.ts`
> and `docs/arch/event-bus.md`).

## Genesis Session Lifecycle

### 0. Startup Recovery Dedup (PRD 029 C-3)

When the bridge restarts after a crash, startup recovery (PRD 029) restores persistent sessions from disk snapshots **before** Genesis spawn runs. If the recovered sessions include a genesis-tagged session (`metadata.genesis === true`) in an adoptable state (`running`, `idle`, or `recovering`), `spawnGenesis()` adopts it instead of creating a duplicate.

**Dedup invariant:** At most one genesis session exists per bridge instance. The dedup check uses `getGenesisStatus(pool)`, which scans the pool's `list()` for any session with `metadata.genesis === true`.

**Adoption behavior:**
- Adopted sessions return `initialized: false` (they were initialized in a previous bridge lifetime).
- Dead recovered genesis sessions are ignored — a fresh session is spawned.
- The GenesisSink is wired to the adopted session's ID, so event delivery resumes seamlessly.

```
Bridge restart
  └─ startup recovery restores sessions from disk
       └─ recovered sessions added to pool (may include genesis)
  └─ spawnGenesis(pool, workdir, budget)
       ├─ getGenesisStatus(pool) → found idle genesis?
       │   YES → adopt: return existing sessionId, initialized=false
       │   NO  → spawn new session via pool.create(...)
```

### 1. Spawn Phase

On bridge startup (or after dedup finds no adoptable session), `spawnGenesis(pool, workdir, budgetTokensPerDay)` creates a new PTY session:

```
pool.create({
  workdir,
  initialPrompt: getGenesisInitializationPrompt(),
  nickname: 'genesis-root',
  metadata: { project_id: 'root', genesis: true, budget_tokens_per_day: 50000 },
  persistent: true,  // Skip stale detection
})
```

Returns `GenesisSpawnResult` with session ID, status, and budget info. The session enters `initializing` state as Claude Code starts.

**Key invariants:**
- Each Genesis session has exactly one entry with `metadata.genesis === true`.
- Budget is attached at spawn time and enforced at runtime.
- Session ID is stable for the bridge uptime and persists across PTY restarts (if recovery enabled).

### 2. Initialization Phase

Genesis loads with the OBSERVE+REPORT prompt (from `initialization.ts`). The prompt:
- Explains Genesis's role as a root observer
- Lists available tools: `project_list`, `project_get`, `project_read_events`, `genesis_report`
- Instructs Genesis to monitor events and report observations

Once the PTY shows the `❯` prompt, initialization completes and Genesis enters `ready` state.

### 3. Event Delivery (GenesisSink)

Rather than a polling loop, Genesis receives events via `GenesisSink` registered on the Universal Event Bus:

```
eventBus.registerSink(new GenesisSink({
  promptSession: (id, text) => pool.prompt(id, text, 10000),
  sessionId: genesisResult.sessionId,
  batchWindowMs: 30_000,        // Batch events every 30 seconds
  severityFilter: ['warning', 'error', 'critical'],  // Only significant events
}));
```

**GenesisSink flow:**
1. Bus emits a `BridgeEvent` with severity `warning`, `error`, or `critical`
2. GenesisSink batches events in the 30-second window
3. On window flush, GenesisSink formats events as a structured summary and calls `pool.prompt(genesisSessionId, summary)`
4. Genesis receives the prompt and responds with observations

See `docs/arch/event-bus.md` for the full event bus architecture.

## Data Flow

```
Bridge startup
  └─ startup recovery (PRD 029)
       └─ restores persistent sessions from disk → pool
  └─ spawnGenesis(pool) ─┐
                         ├─ check pool for existing genesis (dedup)
                         ├─ if found (idle/running/recovering): adopt → return sessionId
                         ├─ else: create PTY session, mark persistent=true
                         └─ return sessionId

  └─ eventBus.registerSink(new GenesisSink(...))
       ├─ batches warning/error/critical events (30s window)
       └─ forwards batches as prompts to Genesis session

[Bus event (severity ≥ warning)]
  └─ GenesisSink.onEvent(event)
       └─ accumulates in batch buffer

[Every 30 seconds]
  └─ GenesisSink flush
       └─ pool.prompt(genesisSessionId, formattedBatch)

[HTTP request arrives]
  └─ POST /genesis/prompt ──┐
                            ├─ generate prompt ID
                            ├─ call pool.prompt(genesisSessionId, prompt)
                            └─ return response
```

## HTTP Endpoints

### GET /genesis/status
Returns Genesis session status:
```typescript
// Response 200
{
  sessionId: string;
  status: 'initializing' | 'ready' | 'working' | 'dead';
  projectId: string;        // always 'root'
  budgetTokensPerDay: number;
  lastActivityAt: Date;
}

// Response 503 (Genesis not running)
{ error: 'Genesis not running', message: '...' }
```

### POST /genesis/prompt
Send a prompt to Genesis and wait for response:
```typescript
// Request
{ prompt: string; timeout_ms?: number; metadata?: Record<string, any> }

// Response 200
{ output: string; promptId: string; timed_out: boolean }

// Response 503 (Genesis not running)
// Response 400 (Genesis dead)
```

### DELETE /genesis/prompt
Cancel an in-flight prompt (stop processing):
```typescript
// Request (optional)
{ promptId?: string }

// Response 200
{ cancelled: boolean; promptId: string | null }

// Response 503 (Genesis not running)
```

## Type Definitions

### GenesisSpawnResult
```typescript
interface GenesisSpawnResult {
  sessionId: string;
  nickname: string;
  status: string;
  projectId: string;        // always 'root'
  budgetTokensPerDay: number;
  initialized: boolean;
}
```

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `GENESIS_ENABLED` | `true` | Enable Genesis on bridge startup |
| `GENESIS_BUDGET_TOKENS_PER_DAY` | `50000` | Daily token budget for Genesis |

## Error Handling

### Session-level Errors
- PTY process exits → session status set to `dead`, pending prompts resolve with captured output
- GenesisSink batch flush failure → logged and skipped, next batch proceeds normally

### HTTP-level Errors
- Genesis not running → 503 with descriptive message
- Genesis dead → 400 with status information
- Timeout on prompt → 200 response with `timed_out: true`

## Dependencies

| Module | Purpose |
|--------|---------|
| `pool.ts` | Session spawning and management |
| `genesis/initialization.ts` | Prompt template |
| `shared/event-bus/genesis-sink.ts` | Bus-based event delivery (PRD 026 Phase 4) |

## Key Design Decisions

### Why GenesisSink Instead of Polling?

PRD 026 Phase 4 replaced the polling loop with a bus-based GenesisSink. The bus is the single source of truth for all domain events — polling was a parallel, duplicative event path. GenesisSink subscribes to the bus directly, eliminating cursor state, YAML persistence, and the polling interval entirely. The 30-second batch window prevents Genesis from being overwhelmed by high-frequency event bursts.

### Why Budget Enforcement at Spawn + Runtime?

Budget is metadata attached at spawn time so it's immediately visible in `GET /genesis/status`. Runtime checks prevent Genesis from exceeding daily limits even if clients misbehave.

## Related Files

- **`packages/bridge/src/domains/genesis/spawner.ts`** — Session spawn, metadata setup
- **`packages/bridge/src/domains/genesis/initialization.ts`** — Prompt template
- **`packages/bridge/src/domains/genesis/routes.ts`** — HTTP routes
- **`packages/bridge/src/shared/event-bus/genesis-sink.ts`** — GenesisSink implementation
- **`packages/bridge/src/shared/event-bus/index.ts`** — Event bus exports
- **`docs/arch/event-bus.md`** — Universal Event Bus architecture
