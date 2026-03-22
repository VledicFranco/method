# Cursor Persistence

## Responsibility

Cursor Persistence manages the stateful tracking of event stream positions across multiple projects. Cursors are opaque markers that indicate "I have read events up to position X in project Y." Two types of cursors exist: client cursors (ephemeral, 24-hour TTL) and Genesis cursors (persistent, 7-day TTL). Cursor state persists to disk for recovery across bridge restarts.

**Key constraints:**
- Each project has at most one active cursor at a time
- Client cursors expire after 24 hours of inactivity
- Genesis cursors (internal polling state) expire after 7 days
- Cursor cleanup is asynchronous and non-blocking
- Circular buffers cap event payload size (500 messages max in GenesisChatPanel)

### Relationship to Event Fetching

When a client calls `/sessions/:id/channels/events?cursor=xyz`, the endpoint returns all events since cursor `xyz`, along with a new cursor `abc` for the next poll. The client stores `abc` and uses it on the next request. Expired cursors are silently treated as empty string (fetch from beginning). Genesis uses the same mechanism but with persistent cursor storage (`.method/genesis-cursors.yaml`).

## File Structure

```
packages/bridge/src/
├── cursor-store.ts          Cursor generation, lookup, cleanup, TTL management
├── genesis/polling-loop.ts  Cursor persistence (load/save .method/genesis-cursors.yaml)
├── channels.ts              Client cursor handling in progress/events channels
└── project-routes.ts        Event fetching + cursor advancement

packages/bridge/frontend/src/components/
└── GenesisChatPanel.tsx     Circular buffer for UI (500 message cap)

.method/
└── genesis-cursors.yaml     Cursor state file (Phase 1 format)
```

## Cursor Lifecycle

### Generation

When events are fetched and returned to a client, a new cursor is generated:

```typescript
function generateCursor(projectId: string, eventIndex: number): string {
  // Format: JSON { version, projectId, index, timestamp }
  return JSON.stringify({
    version: '1',
    projectId,
    index: eventIndex,
    timestamp: new Date().toISOString(),
  });
}
```

**Key invariants:**
- Cursor generation is idempotent — same eventIndex always produces the same cursor string
- Cursors are opaque to clients (clients must not parse or construct them)
- Cursor includes version for migration compatibility

### Storage

#### Client Cursors (24-hour TTL)

Client cursors are stored in-memory in the session's event channel state:

```typescript
interface SessionChannels {
  progressState: { lastSequence: number };
  eventsState: { cursor: string; lastUpdate: Date };  // Client cursor + timestamp
}
```

When a client polls `/sessions/:id/channels/events?cursor=xyz`:
1. Parse incoming cursor (deserialize JSON or treat as empty string if invalid)
2. Look up events since that cursor
3. Generate new cursor from latest event's index
4. Update `eventsState.cursor` and `eventsState.lastUpdate`
5. Return events + new cursor to client

**Cleanup:** Happens in background. Every 1 hour, iterate all session event states, remove entries where `lastUpdate` is > 24 hours old.

#### Genesis Cursors (7-day TTL)

Genesis cursors persist to `.method/genesis-cursors.yaml`:

```yaml
lastPolled: "2026-03-21T10:30:00Z"
cursors:
  - projectId: "root"
    cursor: '{"version":"1","projectId":"root","index":42,"timestamp":"2026-03-21T10:00:00Z"}'
    lastUpdate: "2026-03-21T10:00:00Z"
    eventCount: 42
  - projectId: "proj1"
    cursor: '{"version":"1","projectId":"proj1","index":5,"timestamp":"2026-03-20T14:30:00Z"}'
    lastUpdate: "2026-03-20T14:30:00Z"
    eventCount: 5
```

**Load on startup:**
```typescript
function loadCursors(filePath: string): GenesisCursors {
  if (!fs.existsSync(filePath)) return { lastPolled: now, cursors: [] };

  const content = fs.readFileSync(filePath, 'utf-8');
  const parsed = yaml.load(content);

  if (parsed.cursors && Array.isArray(parsed.cursors)) {
    return parsed as GenesisCursors;
  }
  return { lastPolled: now, cursors: [] };
}
```

**Save after polling:**
```typescript
function saveCursors(cursors: GenesisCursors, filePath: string): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const tempFile = `${filePath}.tmp`;
  const content = yaml.dump(cursors, { lineWidth: -1 });
  fs.writeFileSync(tempFile, content, 'utf-8');
  fs.renameSync(tempFile, filePath);  // Atomic rename
}
```

**Key invariants:**
- Cursors are written atomically (temp file + rename) to prevent corruption on crash
- YAML serialization includes version field for migration path
- File is created in `.method/` directory (created if needed)

### Lookup

When a client provides a cursor, it's looked up to find the event starting position:

```typescript
function getCursorForProject(cursors: GenesisCursors, projectId: string): string {
  // F-P-2: Check TTL on access, remove expired entries
  const now = Date.now();
  cursors.cursors = cursors.cursors.filter((c) => {
    const age = now - new Date(c.lastUpdate).getTime();
    return age < CURSOR_TTL_MS;  // 7 days for Genesis
  });

  const existing = cursors.cursors.find((c) => c.projectId === projectId);
  if (!existing?.cursor) return '';  // Return empty string if expired or missing

  try {
    const parsed = JSON.parse(existing.cursor);
    if (parsed.version !== '1') return '';  // Version mismatch -> reset
    return existing.cursor;
  } catch {
    return existing.cursor;  // Backward compatible: return as-is
  }
}
```

**Lookup behavior:**
- If cursor not found → return empty string (fetch from beginning)
- If cursor expired (> 7 days old) → remove from map, return empty string
- If cursor version mismatch → reset to empty string
- If parse fails → return plain cursor string (backward compatibility)

### Update

After fetching events and finding new ones, the cursor is advanced:

```typescript
function updateCursorForProject(
  cursors: GenesisCursors,
  projectId: string,
  newCursor: string,
  eventCount: number,
): GenesisCursors {
  const existing = cursors.cursors.findIndex((c) => c.projectId === projectId);

  const updated: CursorState = {
    projectId,
    cursor: newCursor,
    lastUpdate: new Date().toISOString(),
    eventCount,
  };

  if (existing >= 0) {
    cursors.cursors[existing] = updated;
  } else {
    cursors.cursors.push(updated);
  }

  cursors.lastPolled = new Date().toISOString();
  return cursors;
}
```

**Key invariants:**
- Update always overwrites old cursor (no merge)
- `lastUpdate` is set to current time (used for TTL calculation)
- `eventCount` is monotonic (increases as events arrive)

## Data Flow — Genesis Polling

```
Bridge startup
  └─ GenesisPollingLoop.__init__() ─┐
                                    ├─ loadCursors('.method/genesis-cursors.yaml')
                                    ├─ cleanupStaleCursors() — remove >7d entries
                                    └─ store in this.cursors

GenesisPollingLoop.start(eventFetcher, onNewEvents)
  └─ setInterval(pollOnce, 5000ms) {
      ├─ for projectId in ['root', ...discoveredProjects]:
      │  ├─ currentCursor = getCursorForProject(this.cursors, projectId)
      │  ├─ events = await eventFetcher(projectId, currentCursor)
      │  │
      │  └─ if events.length > 0:
      │     ├─ newCursor = events[-1].id || `cursor-${Date.now()}`
      │     ├─ this.cursors = updateCursorForProject(..., newCursor, events.length)
      │     ├─ saveCursors(this.cursors, filePath) — atomic write
      │     └─ await onNewEvents(projectId, events)  — report to Genesis
      │
      └─ sleep(5000ms)
  }
```

## Type Definitions

### Client Cursor

```typescript
interface ClientCursor {
  version: '1';
  projectId: string;
  index: number;           // Position in event stream
  timestamp: string;       // ISO when cursor was generated
}

// Serialized as JSON string
const cursorString = JSON.stringify(clientCursor);
```

### Genesis Cursor State

```typescript
interface CursorState {
  projectId: string;
  cursor: string;          // Serialized { version, projectId, index, timestamp }
  lastUpdate: string;      // ISO timestamp — used for 7-day TTL check
  eventCount: number;      // Events processed at this cursor (advisory)
}

interface GenesisCursors {
  lastPolled: string;      // ISO timestamp of last poll
  cursors: CursorState[];  // Per-project cursor tracking
}
```

## Circular Buffer

Genesis UI (GenesisChatPanel) uses a circular buffer to cap memory usage:

```typescript
class GenesisChatPanel {
  private messages: ChatMessage[] = [];
  private MAX_MESSAGES = 500;  // Configurable

  addMessage(msg: ChatMessage): void {
    this.messages.push(msg);

    if (this.messages.length > this.MAX_MESSAGES) {
      this.messages = this.messages.slice(-this.MAX_MESSAGES);
    }

    this.emit('stateChanged', { messages: this.messages });
  }
}
```

**Key invariants:**
- Max 500 messages in the circular buffer
- When limit exceeded, oldest messages are discarded
- Client must scroll to retain history (messages are not persisted to disk)
- Each message includes timestamp for ordering

## Cleanup

### Client Cursor Cleanup

Runs asynchronously every 1 hour:

```typescript
function cleanupClientCursors(): void {
  setInterval(() => {
    const now = Date.now();
    const TTL_24H = 24 * 60 * 60 * 1000;

    for (const session of sessionPool.list()) {
      const eventsState = session.channels?.eventsState;
      if (!eventsState) continue;

      const age = now - eventsState.lastUpdate.getTime();
      if (age > TTL_24H) {
        eventsState.cursor = '';  // Reset to empty
      }
    }
  }, 60 * 60 * 1000);  // 1 hour
}
```

### Genesis Cursor Cleanup

Runs on startup and inline during cursor access:

```typescript
function cleanupStaleCursors(cursors: GenesisCursors): GenesisCursors {
  const now = Date.now();
  const initialCount = cursors.cursors.length;

  cursors.cursors = cursors.cursors.filter((cursor) => {
    const age = now - new Date(cursor.lastUpdate).getTime();
    return age < CURSOR_TTL_MS;  // 7 days
  });

  if (cursors.cursors.length < initialCount) {
    console.log(`Cleaned up ${initialCount - cursors.cursors.length} stale cursor(s)`);
  }

  return cursors;
}
```

**Key invariants:**
- Cleanup does not block event fetching (runs asynchronously or inline with minimal overhead)
- Stale entries are logged when removed
- Cleanup is idempotent (safe to call multiple times)

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `CURSOR_CLIENT_TTL_MS` | `86400000` | Client cursor expiry (24 hours) |
| `CURSOR_GENESIS_TTL_MS` | `604800000` | Genesis cursor expiry (7 days) |
| `CURSOR_CLEANUP_INTERVAL_MS` | `3600000` | Client cursor cleanup interval (1 hour) |
| `GENESIS_CURSORS_FILE` | `.method/genesis-cursors.yaml` | Cursor persistence path |
| `GENESIS_CHAT_PANEL_MAX_MESSAGES` | `500` | Circular buffer size |

## Error Handling

### Cursor Load Failure

If `.method/genesis-cursors.yaml` is missing or corrupted:
```typescript
try {
  const cursors = loadCursors(filePath);
  // Use loaded cursors
} catch (err) {
  console.warn(`Failed to load cursors: ${err.message}`);
  // Return empty cursors — polling starts from beginning
  return { lastPolled: now, cursors: [] };
}
```

### Cursor Save Failure

If write fails:
```typescript
try {
  saveCursors(cursors, filePath);
} catch (err) {
  console.error(`Failed to save cursors: ${err.message}`);
  // Polling continues in-memory; cursors not persisted across restart
}
```

### Expired Cursor Handling

Clients with expired cursors receive an empty event list (cursor has no matching events):
```typescript
if (cursor === '' || expired(cursor)) {
  // Return all events from beginning (or paginated batch)
  return getEventsFrom(projectId, '');
}
```

## Dependencies

| Module | Purpose |
|--------|---------|
| `node:fs` | File I/O (load/save cursors) |
| `node:path` | Path operations |
| `js-yaml` | YAML serialization |
| `event-fetcher` | Fetch events since cursor |

## Key Design Decisions

### Why Two Cursor Types with Different TTLs?

**Genesis cursors (7-day TTL):** Genesis is a system agent that polls deterministically. Stale cursors are safe — the polling loop always fetches events newer than the cursor, even if the cursor is old. Longer TTL provides recovery window across bridge restarts.

**Client cursors (24-hour TTL):** Clients are humans at browsers. If a browser tab is idle for 24 hours and then refreshed, it's reasonable to require a fresh poll (losing message history). This bounds in-memory cursor storage.

### Why Inline Cleanup Instead of Async?

Cursor lookup (`getCursorForProject`) does cleanup inline — checking TTL when the cursor is accessed. This eliminates a separate cleanup loop and ensures expired cursors are never returned. Cost is minimal (one timestamp comparison per lookup).

### Why Circular Buffer at 500 Messages?

500 messages in memory is approximately 5-10 MB (assuming 10-20 KB per message with formatting). This balances user experience (reasonable scrollback) with memory constraints on long-running sessions. Configurable via environment variable for different deployments.

### Why Atomic Writes for Genesis Cursors?

If the bridge crashes during a cursor write, an atomic rename ensures the file is either the old state or the new state — never partial. This prevents corruption that would break all future polling cycles. The cost (temp file + rename) is negligible.

## Related Files

- **`packages/bridge/src/cursor-store.ts`** — Cursor generation and lookup (if separate file exists)
- **`packages/bridge/src/genesis/polling-loop.ts`** — Cursor persistence (load, save, cleanup)
- **`packages/bridge/src/channels.ts`** — Client cursor handling in event channels
- **`packages/bridge/src/project-routes.ts`** — Event fetching + cursor advancement
- **`packages/bridge/frontend/src/components/GenesisChatPanel.tsx`** — Circular buffer (500 cap)
- **`.method/genesis-cursors.yaml`** — Cursor state persistence file
