# Genesis

## Responsibility

Genesis is a persistent root-level session that monitors project discovery events and reports observations to human operators. It runs continuously in the background, maintains a cursor for each project's event stream, and provides HTTP endpoints for prompt submission and status queries.

**Key constraints:**
- Genesis has `project_id='root'` (bridge metadata). This distinguishes it from spawned agent sessions which target specific projects.
- Genesis sessions are marked `persistent=true`, skipping stale detection and auto-kill.
- Cursor state persists to `.method/genesis-cursors.yaml` across bridge restarts.
- Genesis polling runs on a configurable interval (default 5 seconds) and is independent of HTTP traffic.

### Relationship to Bridge Lifecycle

Genesis is spawned at bridge startup, before the HTTP server binds. If `GENESIS_ENABLED=true` (default), `spawnGenesis()` creates a new session with the OBSERVE+REPORT initialization prompt. The polling loop begins automatically after initialization completes.

## File Structure

```
packages/bridge/src/
├── genesis/
│   ├── spawner.ts            Genesis spawn logic, session metadata setup
│   ├── polling-loop.ts        Cursor management, event fetching, polling orchestration
│   ├── initialization.ts      OBSERVE+REPORT prompt template
│   └── tools.ts               Project discovery + reporting tools (genesis_report, project_*)
├── genesis-routes.ts          HTTP endpoints for Genesis interaction
└── genesis-integration.ts     Bridge lifecycle integration (startup, shutdown, polling)
```

## Genesis Session Lifecycle

### 1. Spawn Phase

On bridge startup, `spawnGenesis(pool, workdir, budgetTokensPerDay)` creates a new PTY session:

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
- Instructs Genesis to poll for new events and report observations

Once the PTY shows the `❯` prompt, initialization completes and Genesis enters `ready` state.

### 3. Polling Loop

**CursorState Structure:**
```typescript
interface CursorState {
  projectId: string;
  cursor: string;            // JSON { version, projectId, index, timestamp }
  lastUpdate: string;        // ISO timestamp
  eventCount: number;        // Events processed for this project
}

interface GenesisCursors {
  lastPolled: string;
  cursors: CursorState[];    // Per-project cursor tracking
}
```

**Polling Flow:**

1. **Load cursors** — `loadCursors()` reads `.method/genesis-cursors.yaml` on startup
2. **Clean stale** — `cleanupStaleCursors()` removes entries older than 7 days (CURSOR_TTL_MS)
3. **Poll once per interval** — For each project:
   - Get current cursor via `getCursorForProject(cursors, projectId)`
   - Call `eventFetcher(projectId, cursor)` to fetch new events
   - If events found: update cursor with `updateCursorForProject()`, save to disk
   - Invoke `onNewEvents(projectId, events)` callback

**Cursor Format (Phase 1):**
```json
{
  "version": "1",
  "projectId": "project-id",
  "index": 42,               // Event count at this cursor
  "timestamp": "2026-03-21T10:30:00Z"
}
```

**Key invariants:**
- Client cursors (from `/sessions/:id/channels/events` polling) expire after 24 hours of inactivity (handled elsewhere)
- Genesis cursors (internal polling state) expire after 7 days
- Cursor cleanup runs on startup and is inline during `getCursorForProject()` access
- Cursor save is atomic: temp file write + atomic rename to prevent partial writes on crash

## Data Flow

```
Bridge startup
  └─ spawnGenesis(pool) ─┐
                         ├─ create PTY session
                         ├─ mark persistent=true
                         └─ return sessionId

  └─ GenesisPollingLoop.start() ─┐
                                 ├─ load cursors from .method/genesis-cursors.yaml
                                 ├─ clean stale entries (>7d)
                                 └─ schedule polling interval (5s)

[Polling loop every 5s]
  └─ pollOnce(pool, sessionId, eventFetcher) ─┐
                                              ├─ for projectId='root':
                                              │  ├─ cursor = getCursorForProject(projectId)
                                              │  ├─ events = eventFetcher(projectId, cursor)
                                              │  ├─ if events.length > 0:
                                              │  │  ├─ newCursor = events[-1].id
                                              │  │  ├─ updateCursorForProject(..., newCursor)
                                              │  │  ├─ saveCursors() [atomic write]
                                              │  │  └─ onNewEvents(projectId, events)
                                              │  └─ catch errors silently
                                              └─ sleep(intervalMs)

[HTTP request arrives]
  └─ POST /genesis/prompt ──┐
                            ├─ generate prompt ID
                            ├─ track in inFlightPrompts
                            ├─ call pool.prompt(genesisSessionId, prompt)
                            ├─ extract response from PTY
                            └─ untrack promptId, return response
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
  cursorState: GenesisCursors;
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

### GenesisPersistentState
Stored for recovery across bridge restarts (future enhancement):
```typescript
interface GenesisPersistentState {
  sessionId: string;
  startedAt: Date;
  budgetTokensPerDay: number;
  lastActivityAt: Date;
}
```

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `GENESIS_ENABLED` | `true` | Enable Genesis on bridge startup |
| `GENESIS_BUDGET_TOKENS_PER_DAY` | `50000` | Daily token budget for Genesis |
| `GENESIS_POLLING_INTERVAL_MS` | `5000` | Interval between event polls (5 seconds) |
| `GENESIS_CURSOR_FILE` | `.method/genesis-cursors.yaml` | Cursor persistence file path |
| `GENESIS_CURSOR_TTL_MS` | `604800000` | Cursor expiry (7 days in ms) |

## Error Handling

### Session-level Errors
- PTY process exits → session status set to `dead`, pending prompts resolve with captured output
- Polling error for a specific project → logged and skipped, polling continues for other projects
- Cursor load/save failure → logged; polling proceeds with empty cursors (begins from scratch)

### HTTP-level Errors
- Genesis not running → 503 with descriptive message
- Genesis dead → 400 with status information
- Timeout on prompt → 200 response with `timed_out: true`

## Dependencies

| Module | Purpose |
|--------|---------|
| `pool.ts` | Session spawning and management |
| `genesis/tools.ts` | Project discovery + reporting tools |
| `genesis/initialization.ts` | Prompt template |
| `js-yaml` | Cursor YAML persistence |
| `node:fs` | File I/O (cursors) |

## Key Design Decisions

### Why Polling Instead of Push?

Polling is more resilient to bridge restarts and project additions. New projects discovered via `project_list` are automatically included in the next polling cycle without requiring explicit subscription. Push would require hook registration in each project and maintain explicit subscriptions — more complex.

### Why 7-Day Genesis Cursor TTL, 24-Hour Client Cursor TTL?

Genesis cursors track the internal state of event polling — they can stay stale longer because the polling loop is deterministic and idempotent (it always fetches events newer than the cursor). Client cursors (`/sessions/:id/channels/events`) represent human-initiated queries and become stale quickly if unused. The split reflects their different usage patterns.

### Why Budget Enforcement at Spawn + Runtime?

Budget is metadata attached at spawn time so it's immediately visible in `GET /genesis/status`. Runtime checks (implemented in @method/core MethodologySessionManager) prevent Genesis from exceeding daily limits even if clients misbehave.

## Related Files

- **`packages/bridge/src/genesis/spawner.ts`** — Session spawn, metadata setup
- **`packages/bridge/src/genesis/polling-loop.ts`** — Cursor logic, polling orchestration
- **`packages/bridge/src/genesis/initialization.ts`** — Prompt template
- **`packages/bridge/src/genesis-routes.ts`** — HTTP routes
- **`packages/core/src/sessions/genesis-session.ts`** — Core Genesis session state
