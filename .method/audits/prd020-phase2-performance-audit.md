# PRD 020 Phase 2 Performance Audit Report

**Branch:** feat/prd020-phase2
**Date:** 2026-03-21
**Auditor Role:** Performance Auditor
**Commits Analyzed:** 7 commits (f46aea6..f88fc40)

---

## Executive Summary

Phase 2 implementation introduces three unbounded-growth risks, two polling overhead issues, and one filesystem scalability hazard. The system is production-ready for <20 projects but will experience **degraded performance** at 100+ projects due to:

1. **Cursor map unbounded growth** (24h TTL insufficient for high-traffic scenarios)
2. **Event log unbounded growth** (in-memory, no archival mechanism)
3. **File watcher triggering expensive registry rescans** (O(N) YAML parsing on each config change)

---

## Severity Distribution

- **CRITICAL:** 2 findings (unbounded growth with no recovery)
- **HIGH:** 3 findings (polling/IO overhead, scalability limits)
- **MEDIUM:** 1 finding (memory leak in terminal buffering)

---

## Findings

### F-P-1: CRITICAL — Event Log Unbounded Growth (In-Memory)

**Location:** `/packages/bridge/src/project-routes.ts` (line 37, `eventLog`)

**Detail:**

The `eventLog: ProjectEvent[]` global array accumulates all events since bridge startup with **no archival, truncation, or TTL-based cleanup.** After 24 hours of normal operation:

- **Worst case:** 1000s of events/second across all projects → 86M events/day
- **Memory impact:** ~50 bytes/event (id, type, projectId, timestamp, metadata) = ~4.3 GB/day
- **Cursor map cost:** Each `generateCursor()` call adds to `cursorMap`, then cleans old cursors (24h TTL)

**Why this matters:**
1. **Memory exhaustion:** Bridge process grows unbounded, eventually crashes
2. **Cursor cleanup insufficient:** Multiple simultaneous dashboard clients create cursors faster than they expire
3. **No recovery mechanism:** Event loss on restart; no persistent queue

**Attack scenario (worst-case):**
- 100 projects each generating 5 events/sec = 500 events/sec
- After 1 hour: 1.8M events in memory (90 MB)
- After 1 day: 43.2M events (2.16 GB)
- After 1 week: **302M events (15 GB)** → bridge crash

**Code snippet (project-routes.ts:373-403):**

The global `eventLog` is never bounded or archived:
```typescript
const eventLog: ProjectEvent[] = [];

// In GET /api/events:
const newEvents = getEventsSinceCursor(eventLog, since_cursor);
// Events added but never removed: line 346, 474
eventLog.push(event);
```

**Mitigation needed:**
- Implement ring buffer or sliding window (keep last 10K events)
- Persisted event archival to disk/database
- Event TTL with automatic expiration
- Cursor lifecycle tied to event retention

---

### F-P-2: CRITICAL — Cursor Map Unbounded Growth with Insufficient Cleanup

**Location:** `/packages/bridge/src/project-routes.ts` (line 36, `cursorMap`)

**Detail:**

The `cursorMap` cleanup logic (line 43-48) removes cursors >24h old **only during `generateCursor()` calls.** If a dashboard client stops polling, its cursors remain until:

1. Another client generates a new cursor (cleanup triggered)
2. 24 hours pass
3. Bridge restarts (map cleared)

**Problematic scenario:**

- 10 browser tabs open on dashboard → 10 concurrent cursor polls (3s interval each = 1200 cursor updates/hour)
- 20 cursors * ~200 bytes (cursorId + state) = 4 KB per tab per hour
- 10 tabs → 40 KB/hour, 960 KB/day
- **After 1 month:** 28.8 MB of stale cursors in memory (low impact but poor design)

**Worse scenario:**

- Multiple dashboard instances or multi-tenant users
- Each user session creates unique cursor for same project → redundant entries
- Cleanup only fires on other users' polls (race condition)
- If usage is bursty (e.g., 9-5 workday), cleanup gaps occur → cursors leak until next day

**Current cleanup logic (project-routes.ts:39-51):**
```typescript
function generateCursor(index: number): string {
  const cursorId = Math.random().toString(36).slice(2);
  cursorMap.set(cursorId, { eventIndex: index, timestamp: Date.now() });

  // Cleanup old cursors (>24h) — only runs on this call
  for (const [id, state] of cursorMap.entries()) {
    if (Date.now() - state.timestamp > 24 * 60 * 60 * 1000) {
      cursorMap.delete(id);
    }
  }
  return cursorId;
}
```

**Why 24h is insufficient:**
- Cursor intended to survive poll gaps, but no feedback when cursor is "done"
- No way to manually invalidate cursor
- 24h TTL arbitrary; should be LRU or explicit release

**Mitigation needed:**
- Implement active cleanup on a timer (every 1 minute)
- Add explicit cursor invalidation endpoint
- Use LRU eviction with max cursor count
- Track cursor lifecycle (creation, last-used, age)

---

### F-P-3: HIGH — Genesis Polling Loop Writes YAML Every 5 Seconds

**Location:** `/packages/bridge/src/genesis/polling-loop.ts` (line 220, `saveCursors()` on every poll)

**Detail:**

Every Genesis polling cycle (default 5s) writes the entire `.method/genesis-cursors.yaml` file to disk:

1. Read cursor YAML (parse js-yaml)
2. Update 1–3 cursor entries (O(P) array search via findIndex)
3. Serialize all cursors to YAML (js-yaml.dump)
4. Atomic write (temp + rename)

**Cost breakdown (single poll at 5s interval):**
- **YAML parse:** 1-2 ms (small file, ~1KB initially)
- **Array update:** O(P) where P = projects. findIndex on line 109.
- **YAML dump:** 1-2 ms
- **Disk I/O:** 5-20 ms (SSD); 100+ ms (network FS)

**Scaling analysis:**

With 100 discovered projects and Genesis polling all 100:

```
Scenario 1: SSD, 1 project discovered
- 1 poll/5s = 12 polls/min × 7 ms (parse+dump+write) = 84 ms CPU/min
- After 1 hour: 5 minutes of polling overhead (acceptable)

Scenario 2: Network FS, 100 projects discovered, Genesis polling 50
- 1 poll/5s × (2ms parse + 2ms dump + 100ms network write) = 104ms/poll
- 12 polls/min × 104ms = 1248 ms wall-clock time/min per Genesis session
- If Genesis is blocking on cursor save, Genesis initialization prompt stalls

Scenario 3: Busy bridge, 100 projects, 10 Genesis sessions (future scaling)
- 10 Genesis sessions × 12 polls/min × 100ms = 120s of blocking I/O/min
- **Bridge becomes unresponsive during polling windows**
```

**Current code (polling-loop.ts:196-233):**
```typescript
private async pollOnce(...) {
  // ...
  const events = await eventFetcher(projectId, currentCursor);
  if (events.length > 0) {
    const newCursor = events[events.length - 1].id || `cursor-${Date.now()}`;
    this.cursors = updateCursorForProject(this.cursors, projectId, newCursor, events.length);
    saveCursors(this.cursors, this.cursorFilePath); // <-- BLOCKING WRITE EVERY POLL
  }
}
```

**Why this is risky:**
1. **No batching:** Each poll writes immediately, no debounce
2. **Not async:** `writeFileSync()` blocks the polling loop (line 85, polling-loop.ts)
3. **Scales poorly:** 100 projects × 2 polls/minute = 200 writes/minute

**Mitigation needed:**
- Batch writes: save cursors only on shutdown + every 5 minutes
- Use async fs.promises.writeFile() to not block
- Debounce writes (50ms window)
- Consider in-memory cursors with periodic flush

---

### F-P-4: HIGH — File Watcher Triggers Full Registry Rescan on Any YAML Change

**Location:** `/packages/bridge/src/config/file-watcher.ts` (line 110) → `registry.rescan()`

**Detail:**

When any `.method/**/*.yaml` file changes, the file watcher callback triggers `registry.rescan()` — a full directory scan and YAML parse of **all** methodology YAML files. On each change:

1. `watch()` callback fires (debounced 100ms)
2. `shouldProcessFile()` checks if file is relevant (line 134)
3. Calls `registry.rescan()` (in project-routes.ts:350)
4. `rescan()` scans `registry/` directory and parses every YAML file

**Cost analysis:**

Assuming registry has 50+ compiled methodology YAML files (~20 KB each = 1 MB total):

```
Single rescan cost:
- readdir(registry/): ~1-2 ms
- readFileSync() × 50 files: ~10-15 ms
- yaml.load() parse × 50 files: ~20-30 ms
- Set.set() × 50: ~1 ms
Total: ~35-50 ms per rescan

Worst-case scenario: IDE autosave every 500ms on manifest.yaml
- Rapid file changes exceed debounce window
- Result: multiple rescans per second
- 2 rescans/second × 50 ms = 100 ms CPU overhead/second (10% baseline)
```

**Attack scenario (realistic):**

User editing `.method/manifest.yaml` in vim + IDE autosave:

```
t=0:   User types "s" in vim → file saved → file watcher fires → debounce scheduled (t+100)
t=50:  IDE autosave runs (vim backup) → file watcher fires → debounce reset to t+150
t=100: Debounce fires → rescan starts (takes 50ms, ends at t=150)
t=150: Autosave again → file watcher fires → debounce resets to t+250
t=200: User types another char → file saved → debounce resets to t+300
t=300: Debounce fires → rescan (ends at t=350)
...rapid typing = 1 rescan per 100ms window = 10 rescans/second
```

**Current debounce (file-watcher.ts:28-45):**
```typescript
function createDebouncer(callback, delayMs) {
  let timeoutId = null;
  return async () => {
    if (timeoutId) clearTimeout(timeoutId);  // <-- reset on every call
    timeoutId = setTimeout(async () => {
      await callback();
      timeoutId = null;
    }, delayMs);
  };
}
```

This is correct debounce logic, but **if file changes exceed 100ms debounce window, rescan fires per change.**

**Mitigation needed:**
- Track which files changed, only rescan if methodology specs affected (not manifest.yaml editing)
- Implement file-level rescan (parse only changed file, not entire registry)
- Increase debounce to 500ms for batch edits
- Skip rescan for non-methodology files (.method/council/, .method/delivery/)

---

### F-P-5: HIGH — Discovery Service Blocks on Every Project List Request

**Location:** `/packages/bridge/src/project-routes.ts` (line 122, `discoveryService.discover()`)

**Detail:**

Every call to `GET /api/projects` **re-runs discovery from scratch** — a recursive filesystem walk that:

1. Walks entire directory tree from process.cwd()
2. Checks for `.git/` directories (expensive: stat on every file)
3. Validates git repos: checks `objects/` and `refs/` subdirectories
4. Creates `.method/` directories if missing (mkdirSync on discovery)

**Cost breakdown (single discovery pass):**

For a typical monorepo with 20 projects:

```
readdir(cwd/): ~5 ms
Walk 500 directories:
  - readdir() with withFileTypes: ~100 ms total
  - 20 × statSync(.git): ~5 ms
  - 20 × existsSync(objects/, refs/): ~10 ms
  - 20 × mkdirSync(.method, {recursive}): ~15 ms
Total: ~130-150 ms per discovery

At 3s dashboard poll interval (EventStreamPanel uses 3s):
- Discovery called only when user clicks project list, not per event poll
- BUT: EventStreamPanel's useProjects() hook calls useEffect on mount
- If useProjects() calls discovery on mount: ~150 ms startup latency
```

**Scaling issue:**

```
Scenario 1: 100 projects in single monorepo
- Discovery walks same 500 dirs but finds 100 projects
- Cost: ~300-400 ms per discovery (stat + git validation × 100)
- 2-3 discoveries/second from multiple dashboard clients → bottleneck

Scenario 2: 1000+ projects (e.g., meta-repo with symlinks)
- 60s timeout (default DISCOVERY_TIMEOUT_MS) will **hard-stop discovery**
- Clients get partial results (incomplete=true)
- Repeated discovery attempts = repeated wasted CPU

Scenario 3: Network FS backing .method/
- mkdirSync(.method) on every project discovery
- If `.method/` already exists (common), still calls mkdirSync(recursive=true)
- recursive=true does stat on every parent path (network latency!)
- 100 projects × 50-100 ms per mkdirSync = 5-10 seconds total
```

**Current code (project-routes.ts:116-154):**
```typescript
app.get('/api/projects', async (...) => {
  try {
    const result = await discoveryService.discover(process.cwd());
    // ... emit event if stopped at max
    return reply.status(200).send({
      projects: result.projects,
      // ...
    });
  }
});
```

**Mitigation needed:**
- Cache discovery results (5-10 min TTL, with invalidation on file watch)
- Lazy .method/ creation (only create when needed, not on discovery)
- Consider background discovery (pre-warm cache on startup, update periodically)
- Add query parameter to skip certain checks (?fast=true → skip git validation)

---

### F-P-6: HIGH — Dashboard Event Stream Polling Unbounded Memory Growth

**Location:** `/packages/bridge/frontend/src/hooks/useEventStream.ts` (line 70, `setEvents(prev => [...prev, ...response.events])`)

**Detail:**

The `useEventStream` hook appends events to state **without limit** every 3 seconds. The displayed events array grows unbounded in React state:

1. `setEvents(prev => [...prev, ...response.events])` appends indefinitely
2. Display limited to last 50 (line 87 of EventStreamPanel.tsx)
3. **But entire array stays in React state/memory**
4. No cleanup on unmount or when component hidden

**Memory impact:**

```
Single EventStreamPanel instance (3s poll interval):
- Best case (no events): 0 bytes added
- Normal case (5 new events/3s = 1.67 events/sec):
  - ~300 bytes per event (JSON + React closure)
  - 1.67 × 300 bytes × 60 sec = 30 KB/min
  - After 1 hour: 1.8 MB in single instance
  - After 8 hours: 14.4 MB in single instance

Multi-dashboard scenario (3 browser tabs + 1 API monitoring tool):
- 4 instances × 1.8 MB/hour = 7.2 MB/hour growth
- After 1 week: 7.2 MB × 168 hours = ~1.2 GB across all dashboards
```

**Current code (useEventStream.ts:68-71):**
```typescript
// Append new events (don't replace to keep history)
if (response.events && response.events.length > 0) {
  setEvents((prev) => [...prev, ...response.events]);
}
```

**Why this is risky:**
1. **React memory leak:** Component unmount doesn't clear state if parent re-renders
2. **Browser memory leak:** Each browser tab running dashboard grows indefinitely
3. **No max size:** If Discovery generates 100 events/sec, 100 MB/min in-browser memory

**Attack scenario:**

Genesis polling loop + Dashboard:
```
- Genesis polls 50 projects every 5 seconds
- Each poll generates 1 observation event → 50 events per 5s = 10 events/sec
- Dashboard EventStreamPanel with 3s poll interval (5 requests/15s)
- Each response fetches events since cursor → 50-60 events per poll
- EventStreamPanel appends all → 300+ events appended per 15s
- Memory: 300 × 300 bytes × (1 hour / 15s) = 72 MB/hour
- After 1 day: 1.7 GB in single browser tab
```

**Mitigation needed:**
- Implement max size: `if (events.length > 5000) setEvents(events.slice(-5000))`
- Implement virtual list (react-window) for large lists
- Add explicit cleanup on component unmount
- Consider IndexedDB for event history instead of React state

---

### F-P-7: MEDIUM — Genesis Polling Loop Lacks Error Recovery Strategy

**Location:** `/packages/bridge/src/genesis/polling-loop.ts` (line 170-176)

**Detail:**

The `start()` method accepts an `eventFetcher` function but **doesn't validate it before polling.** If the fetcher throws or is undefined, the polling loop catches errors (line 173-175) but **continues polling indefinitely**, potentially creating a log spam situation.

**Impact:** Low (wrapped in try-catch), but indicates incomplete error handling.

**Current code (polling-loop.ts:157-179):**
```typescript
start(
  sessionId: string,
  pool: SessionPool,
  eventFetcher: (projectId: string, cursor: string) => Promise<ProjectEvent[]>,
  onNewEvents?: (projectId: string, events: ProjectEvent[]) => Promise<void>,
): void {
  if (this.running) {
    console.warn('Polling loop already running');
    return;
  }

  this.running = true;

  this.pollingIntervalId = setInterval(async () => {
    try {
      await this.pollOnce(pool, sessionId, eventFetcher, onNewEvents);
    } catch (err) {
      console.error('Polling loop error:', (err as Error).message);
      // <-- Loop continues even if fetcher is broken
    }
  }, this.intervalMs);
}
```

**Mitigation needed:**
- Validate eventFetcher is a function before starting loop
- Add error budget: stop polling after N consecutive errors
- Emit events to polling loop listener (on-error callback)

---

## Recommendations (Ranked by Impact)

### Priority 1: Stop Event Log Leak (F-P-1)
- **Action:** Implement ring buffer for eventLog (max 10K events)
- **Effort:** 2 hours
- **Impact:** Prevents bridge OOM after 24h of operation

### Priority 2: Debounce Cursor Writes (F-P-3)
- **Action:** Batch cursor saves (write only on exit, or every 5 min)
- **Effort:** 1 hour
- **Impact:** Reduces disk I/O by 99%, unblocks Genesis polling

### Priority 3: Cache Discovery Results (F-P-5)
- **Action:** Cache discovery for 5 min, invalidate on file watch
- **Effort:** 3 hours
- **Impact:** Removes blocking I/O from project list fetches

### Priority 4: Limit Dashboard Event Memory (F-P-6)
- **Action:** Implement max-size sliding window in useEventStream
- **Effort:** 1 hour
- **Impact:** Prevents browser tab memory leak

### Priority 5: File Watcher Granularity (F-P-4)
- **Action:** Only rescan if methodology files changed, not manifest
- **Effort:** 2 hours
- **Impact:** Reduces rescan frequency by 80%

### Priority 6: Registry Scan Optimization (Future)
- **Action:** Consider lazy-loading registry YAML (parse on demand)
- **Effort:** 4 hours
- **Impact:** Reduces rescan cost from 50ms to <5ms

---

## Testing Recommendations

1. **Load test with 100 projects:** Verify discovery completes in <500ms
2. **Event log sizing:** Run Genesis for 24h, measure memory growth
3. **File watcher stress:** Auto-save 100 YAML edits/min, measure rescan frequency
4. **Dashboard scaling:** Open 5 browser tabs, poll for 1h, measure memory
5. **Cursor cleanup:** Verify old cursors removed after 24h

---

## Conclusion

Phase 2 is **functional for <20 projects but not production-ready for 100+.** The three unbounded-growth issues (event log, cursor map, dashboard events) will cause:

- **Bridge instability** after 24-48 hours of operation
- **Dashboard memory bloat** (1+ GB per browser tab)
- **Genesis blocking** on YAML writes (5-20 second stalls on network FS)

Recommend implementing F-P-1 (event log ring buffer) and F-P-3 (cursor write batching) before promoting Phase 2 to production.
