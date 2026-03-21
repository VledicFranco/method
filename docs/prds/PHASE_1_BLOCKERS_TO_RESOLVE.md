# Phase 1 Blockers: 3 Critical Clarifications Required
## PRD 020 Phase A Re-Review

**Status:** Phase 1 implementation blocked on these 3 specifications. Estimated resolution: 10-15 minutes.

---

## BLOCKER 1: Project Config Reload Semantics

**Advisor:** Harlan (Specification Engineer)
**Finding ID:** F-HARLAN-3
**Severity:** CRITICAL — blocks Phase 1 implementation start

### The Question
If a user edits `.method/project-config.yaml` in a project, when does the bridge reload it?

### Current PRD State
Section 4.2 says: "If present: bridge loads and validates (id must match expected relative path)"

**Problem:** No mention of reload semantics. Complete silence on:
- Hot reload on file change?
- Manual reload trigger (API endpoint)?
- Static load-once with restart requirement?

### Decision Required (Choose One)

**Option A: Hot reload on file change** (most user-friendly, most complex)
```
When .method/project-config.yaml is edited:
- Bridge detects file change (fs.watch or chokidar)
- Reloads config for that project
- Updates ProjectRegistry with new metadata
- Emits event: {type: "project_config_reloaded", project_id: "..."}
```
**Pros:** Seamless; users don't need to restart bridge
**Cons:** Requires file watching; complexity; edge cases (partial writes, permission issues)
**Recommendation:** Defer to Phase 2+

**Option B: Manual reload endpoint** (middle ground, explicit)
```
New API endpoint: POST /projects/:id/reload-config
- Triggers reload of .method/project-config.yaml for that project
- Returns updated ProjectMetadata
- Fails explicitly if config is invalid
```
**Pros:** Explicit; user controls when reload happens; simpler than hot reload
**Cons:** Manual step; users must remember to call endpoint after editing
**Recommendation:** Acceptable for Phase 1

**Option C: Static load-once with restart requirement** (simplest, current assumption)
```
- Bridge loads all .method/project-config.yaml files at startup
- Edits to project-config.yaml are ignored until bridge restarts
- If user edits config, bridge must be restarted: npm run bridge:stop && npm run bridge
```
**Pros:** Simplest implementation; no file watching; clear semantics
**Cons:** Requires bridge restart; friction for users; not ideal for running systems
**Recommendation:** Acceptable for Phase 1 with clear documentation

### Recommended Resolution

**Choose Option C (static load-once) for Phase 1.**

Add to PRD Section 4.2, after project-config.yaml schema:

```markdown
### Configuration Reload Behavior

Bridge loads `.method/project-config.yaml` once at startup for each project.
Edits to project-config.yaml are **not** hot-reloaded; bridge must be restarted to pick up changes:

```bash
npm run bridge:stop
npm run bridge
```

**Rationale:** Static load-once minimizes complexity in Phase 1. Hot reload or manual reload can be Phase 2+ enhancements if needed.

**Future enhancement (Phase 2+):** Add `POST /projects/:id/reload-config` endpoint for manual reload, or implement hot reload with fs.watch.
```

---

## BLOCKER 2: Event Log Durability

**Advisor:** Harlan (Specification Engineer)
**Finding ID:** F-HARLAN-7
**Severity:** CRITICAL — blocks Phase 1 implementation start

### The Question
Are events persisted to disk? In-memory only? Lost on restart? What's the YAML format?

### Current PRD State
Section 4.1 says: "All events (from all projects) are accumulated at root level (`.method/genesis-events.yaml` or in-memory store)"

**Problem:** Two options mentioned, zero decision made. No specification of:
- Which option is chosen?
- YAML serialization format
- Durability guarantees
- Recovery strategy on restart

### Decision Required (Choose One)

**Option A: Persistent to `.method/genesis-events.yaml`** (safer, survives restart)
```yaml
# .method/genesis-events.yaml (persisted to disk)
events:
  - id: evt-001
    timestamp: "2026-03-20T14:30:00Z"
    project_id: "pv-method"
    session_id: "session-abc123"
    type: "completed"
    content:
      message: "Task finished successfully"

  - id: evt-002
    timestamp: "2026-03-20T14:31:00Z"
    project_id: "oss-glyphjs"
    session_id: "session-def456"
    type: "error"
    content:
      error: "Test suite failed"
      reason: "2 tests failing"
```

**Pros:**
- Events survive bridge restart
- Human can inspect/edit event log manually
- Foundation for Genesis (Phase 2) which needs history
- Audit trail for portfolio activity

**Cons:**
- File I/O on every event (needs buffering/batching for performance)
- YAML parsing/serialization overhead
- Requires .gitignore rules to prevent committing ephemeral events

**Recommendation:** Better for long-term Phase 2 Genesis polling; requires buffering to avoid performance impact.

**Option B: In-memory only** (simplest, events lost on restart)
```typescript
// In-memory event store
class EventStore {
  private events: ProjectEvent[] = [];

  addEvent(event: ProjectEvent) {
    this.events.push(event);
    if (this.events.length > 10000) {
      this.events.shift(); // FIFO pruning
    }
  }
}
```

**Pros:**
- Simplest implementation; no file I/O
- No performance overhead
- No .gitignore complexity
- Sufficient for Phase 1 (events are debugging/visibility aid, not required for core functionality)

**Cons:**
- Events lost on bridge restart
- No audit trail across restarts
- Genesis (Phase 2) will need persistent events; Phase 2 must add durability then

**Recommendation:** Acceptable for Phase 1; Phase 2 adds persistence when Genesis needs it.

### Recommended Resolution

**Choose Option B (in-memory only) for Phase 1. Plan Option A for Phase 2 when Genesis is implemented.**

Add to PRD Section 4.1, after "Event Aggregation":

```markdown
### Event Log Durability

**Phase 1 (current):** Events are accumulated in-memory during bridge runtime.

```typescript
interface ProjectEvent {
  type: string;                      // "completed", "error", "escalation", etc.
  project_id: string;                // relative path for filtering
  timestamp: string;                 // ISO 8601
  content: Record<string, unknown>;  // event-specific data
}

// Event store (in-memory, capped at 10K)
const eventLog: ProjectEvent[] = [];

function addEvent(event: ProjectEvent) {
  eventLog.push(event);
  if (eventLog.length > 10000) {
    eventLog.shift(); // FIFO pruning, respects project_id isolation
  }
}
```

Events are queryable via API (`GET /projects/:id/events`, `GET /events`) but **not persisted to disk in Phase 1**.

**Important:** Events are lost when bridge restarts. This is acceptable for Phase 1 because:
1. Events are used for visibility/debugging (not mission-critical)
2. Genesis agent (which requires event history) is Phase 2
3. Persistent event log adds file I/O complexity; can be deferred

**Phase 2+ (when Genesis is implemented):** Persistent event log to `.method/genesis-events.yaml` with:
- YAML serialization format (as above)
- Buffered writes (batch events for performance)
- .gitignore rules to prevent committing ephemeral events
- Recovery on startup: load events from `.method/genesis-events.yaml`
```

---

## BLOCKER 3: Partial Project Initialization Failure Handling

**Advisor:** Orion (Reliability Engineer)
**Finding ID:** F-ORION-5
**Severity:** CRITICAL — blocks Phase 1 implementation start

### The Question
If `.method/` directory creation fails for one project (permission denied, disk full, etc.), what happens to the bridge?

### Current PRD State
Section 4.1 says: "For each found: register as project, create `.method/` if missing"

**Problem:** No explicit handling if creation fails. Assumption is unclear:
- Does bridge crash/abort discovery?
- Does bridge skip that project and continue?
- Does bridge retry with backoff?

### Decision Required (Choose One)

**Option A: Abort on first failure** (safest, most conservative)
```typescript
for (const repoPath of discoveredRepos) {
  try {
    createMethodDirIfMissing(repoPath);
  } catch (error) {
    console.error(`Failed to initialize .method/ for ${repoPath}: ${error.message}`);
    throw error; // ABORT discovery
  }
}
```

**Pros:**
- Prevents silent errors
- Forces user to fix permission/disk issues before bridge can run
- Safer: no degraded-mode surprises

**Cons:**
- Single failing project blocks entire bridge
- User can't work with other projects if one has permission issues
- Less resilient

**Recommendation:** Too strict; hurts usability.

**Option B: Log and skip (resilient degradation)** ← **RECOMMENDED**
```typescript
for (const repoPath of discoveredRepos) {
  try {
    createMethodDirIfMissing(repoPath);
    registry.register(projectMetadata);
  } catch (error) {
    console.warn(`[project-init-failed] ${repoPath}: ${error.message}`);
    // Register with degraded flag
    registry.register({
      ...projectMetadata,
      initialization_status: "failed",
      initialization_error: error.message,
    });
  }
}
```

**Pros:**
- Bridge starts even if one project has issues
- Other projects continue to work normally
- User can see which projects failed via API (`GET /projects`, filter by `initialization_status`)
- Allows partial portfolio usage (user fixes permissions and rescans)

**Cons:**
- Bridge runs with partial state (some projects unavailable)
- User might not notice a project failed

**Recommendation:** Best balance of resilience and visibility. Suitable for Phase 1.

**Option C: Retry with exponential backoff** (complex, future)
```typescript
// Retry up to 3 times with 1s, 2s, 4s backoff
for (let attempt = 1; attempt <= 3; attempt++) {
  try {
    createMethodDirIfMissing(repoPath);
    break;
  } catch (error) {
    if (attempt < 3) {
      console.warn(`Retry ${attempt}/3 for ${repoPath}...`);
      await sleep(1000 * Math.pow(2, attempt - 1));
    } else {
      console.error(`Failed after 3 retries: ${repoPath}`);
      // Log and skip (fallback to Option B)
    }
  }
}
```

**Pros:**
- Handles transient errors (disk hiccup, permission race condition)
- More resilient

**Cons:**
- Adds startup latency
- Complex; risk of timeout
- Overkill for Phase 1

**Recommendation:** Defer to Phase 2+ if needed.

### Recommended Resolution

**Choose Option B (log and skip) for Phase 1.**

Add to PRD Section 4.1, after "Startup sequence":

```markdown
### Initialization Failure Handling

If `.method/` directory creation fails for a project (e.g., permission denied, disk full):

1. Bridge logs warning: `[project-init-failed] <project_id>: <error reason>`
2. Project is registered in ProjectRegistry with `initialization_status: "failed"` and error details
3. Bridge **continues** startup with remaining projects (does not abort)
4. Human can see failed projects via `GET /projects` (filter by `initialization_status`)
5. Human can fix underlying issue (permissions, disk space) and run `POST /projects/rescan` to retry

**Example API response:**
```json
{
  "projects": [
    {
      "id": "pv-method",
      "name": "pv-method",
      "initialization_status": "success"
    },
    {
      "id": "oss-glyphjs",
      "name": "oss-glyphjs",
      "initialization_status": "failed",
      "initialization_error": "EACCES: permission denied, mkdir '.method'"
    }
  ]
}
```

**Rationale:** Allows bridge to serve other projects even if one fails. Provides visibility (human can see which project failed and why). Allows recovery via manual rescan.

**Future enhancement (Phase 2+):** Add retry with exponential backoff if transient errors become common.
```

---

## Summary: Action Items for Author

Add these 3 sections to PRD 020 to resolve blockers:

1. **Section 4.2, after project-config.yaml schema:** "Configuration Reload Behavior"
   - Recommend: Static load-once; restart required to pick up edits

2. **Section 4.1, after "Event Aggregation":** "Event Log Durability"
   - Recommend: In-memory only for Phase 1; persistent YAML for Phase 2

3. **Section 4.1, after "Startup sequence":** "Initialization Failure Handling"
   - Recommend: Log and skip; don't abort; allow recovery via rescan

**Estimated writing time:** 10-15 minutes

**Then:** Steering council reviews clarifications → approves Phase 1 implementation → kick-off.

---

## Blocked vs. Unblocked

### After These 3 Clarifications Are Added

| Role | Finding | Status | Action |
|------|---------|--------|--------|
| Harlan | Config reload | RESOLVED | ✅ Proceed |
| Harlan | Event durability | RESOLVED | ✅ Proceed |
| Orion | Init failures | RESOLVED | ✅ Proceed |
| Thane | Minor gaps | NOTED | ⚠️ Nice-to-have (e2e test, template docs) |
| Reva | UX gaps | DEFERRED | ℹ️ Phase 2 responsibility |

**Once 3 blockers resolved → Phase 1 is APPROVED for implementation.**
