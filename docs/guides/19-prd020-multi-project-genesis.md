# Guide 19: PRD 020 — Multi-Project Genesis Agent

**Audience:** Agent operators, project leads
**Level:** Intermediate (requires Guides 1-2, 10)
**Goal:** Understand Phase 1 & Phase 2 features: Genesis persistent coordination agent, project discovery, and resource sharing across projects

---

## What is PRD 020?

PRD 020 extends the bridge with **multi-project awareness**. Instead of a single isolated session pool, the bridge now:
1. **Discovers** all .git repositories in your filesystem (Phase 1)
2. **Spawns a Genesis agent** — a persistent coordinator that monitors all projects and reacts to events (Phase 2A)
3. **Shares resources** (methodologies, strategies) across projects atomically (Phase 2A)
4. **Provides a dashboard** with cross-project visibility into Genesis activity (Phase 2A)

This guide covers the operational aspects of Phase 1 & Phase 2A. See the project spec in `docs/prds/020.md` for design details.

---

## Phase 1: Project Discovery

### What Gets Discovered?

The bridge scans your filesystem recursively for **project markers**:
- A `.git/` directory (repository root)
- A `.method/` directory (optional, but required for Phase 2A features)

Each discovered project gets a `ProjectMetadata` record:

```yaml
id: "my-project"                  # Derived from directory name
path: "/path/to/my-project"       # Absolute filesystem path
status: "healthy"                 # One of: healthy, git_corrupted, missing_config
git_valid: true                   # Is .git/ directory intact?
method_dir_exists: true           # Does .method/ exist?
config_loaded: true               # Was .method/manifest.yaml loaded?
config_valid: true                # Is manifest valid YAML?
discovered_at: "2026-03-22T..."   # ISO timestamp
```

### Discovery Endpoints

The bridge exposes three HTTP endpoints for discovering projects:

**`GET /api/projects`** — List all discovered projects
```json
{
  "projects": [
    { "id": "method", "path": "...", "status": "healthy", ... },
    { "id": "augury", "path": "...", "status": "missing_config", ... }
  ],
  "discovery_incomplete": false,
  "scanned_count": 142,
  "error_count": 3,
  "elapsed_ms": 487
}
```

**`POST /api/projects/:id/reload`** — Trigger discovery refresh for one project (or all if `:id` = "root")
```json
{ "reloaded": true, "metadata": { ... } }
```

**`GET /api/projects/:id/events`** — Stream recent project events (cursor-based pagination)
```json
{
  "events": [
    { "id": "proj-evt-1", "type": "config_loaded", "project_id": "my-project", "timestamp": "...", "data": {...} }
  ],
  "next_cursor": "1|proj-evt-2|1234567890"
}
```

### Configuring Discovery

Discovery behavior is controlled via environment variables on the bridge:

| Variable | Default | Purpose |
|----------|---------|---------|
| `DISCOVERY_TIMEOUT_MS` | 60000 | Max time to scan filesystem (30s–60s typical) |
| `DISCOVERY_MAX_PROJECTS` | 1000 | Stop scanning after finding N projects |

```bash
npm run bridge:dev
# or
DISCOVERY_TIMEOUT_MS=30000 npm run bridge
```

---

## Phase 2A: Genesis Persistent Agent

### What is Genesis?

Genesis is a **long-lived coordination agent** with:
- **Persistent identity**: `project_id="root"` (never expires)
- **50K token budget** per session (resets when agent restarts)
- **Polling loop**: Polls project event queues every 5 seconds
- **Cross-project visibility**: Sees events from all projects
- **Event filtering**: Only acts on projects with `.method/` directory

Genesis is **not** the user's agent. It's infrastructure that:
- Reacts to project changes (new commits, config reloads, etc.)
- Coordinates resource sharing between projects
- Maintains audit logs across your workspace
- Can be extended with custom reactions (Phase 2B)

### Starting Genesis

Genesis starts automatically when the bridge starts **if the environment variable is set**:

```bash
GENESIS_ENABLED=true npm run bridge
```

Or in development:

```bash
GENESIS_ENABLED=true npm run bridge:dev
```

Check if Genesis is running:

```bash
curl http://localhost:3456/genesis/status
```

Response:

```json
{
  "status": "spawned",
  "session_id": "genesis-root-...",
  "project_id": "root",
  "budget": { "used": 2450, "remaining": 47550 },
  "uptime_ms": 123456,
  "polling": {
    "active": true,
    "interval_ms": 5000,
    "last_poll": "2026-03-22T02:15:30Z"
  }
}
```

### Genesis Event Polling Loop

Genesis continuously:

1. **Query event queues** for each project (cursor-based, resumable)
2. **Apply isolation checks** — Genesis can only see events from projects with `.method/` directory
3. **Accumulate new events** in memory (circular buffer, 100K event cap)
4. **Manage cursors** — one cursor per project, stored in-memory, expires after 7 days of inactivity
5. **React to events** (Phase 2B) — custom workflows triggered by event types

```
Genesis Loop (every 5 seconds):
  for each project P with .method/:
    cursor ← load_cursor(P)
    events ← GET /api/projects/{P}/events?cursor={cursor}
    if events.count > 0:
      accumulate(events)
      save_cursor(P, events.next_cursor)
      trigger_reactions(events)  ← Phase 2B
    cleanup_expired_cursors(ttl=7days)
```

### Controlling Genesis

**`POST /genesis/prompt`** — Send a message to Genesis
```bash
curl -X POST http://localhost:3456/genesis/prompt \
  -H "Content-Type: application/json" \
  -d '{
    "text": "Summarize recent events across all projects"
  }'
```

**`DELETE /genesis/prompt`** — Kill Genesis and clear its session
```bash
curl -X DELETE http://localhost:3456/genesis/prompt
```

**Restart Genesis** — it will spawn with a fresh budget:
```bash
GENESIS_ENABLED=true npm run bridge
```

---

## Phase 2A: Resource Sharing

### What Can Be Shared?

Two types of resources can be copied atomically across projects:

1. **Methodologies** — YAML definitions from `registry/` (e.g., P2-SD, P1-EXEC)
2. **Strategies** — YAML pipelines from `.method/strategies/` (custom workflows)

### Resource Copying Endpoints

**`POST /api/resources/copy-methodology`** — Copy a methodology from source to target projects

```bash
curl -X POST http://localhost:3456/api/resources/copy-methodology \
  -H "Content-Type: application/json" \
  -d '{
    "source_project": "method",           # Must exist
    "source_registry_id": "P2-SD",         # e.g., P2-SD v2.0 from registry/
    "target_projects": ["my-project", "other-project"],
    "overwrite": false
  }'
```

Response:

```json
{
  "copied": ["my-project", "other-project"],
  "skipped": [],
  "errors": [],
  "timestamp": "2026-03-22T..."
}
```

**`POST /api/resources/copy-strategy`** — Copy a strategy from source to target projects

```bash
curl -X POST http://localhost:3456/api/resources/copy-strategy \
  -H "Content-Type: application/json" \
  -d '{
    "source_project": "pv-method",
    "strategy_id": "S-CODE-REVIEW",      # ID from .method/strategies/
    "target_projects": ["my-project"],
    "overwrite": false
  }'
```

### Resource Copying Constraints

- **Source validation**: Source project must exist and have the resource
- **Target isolation**: Resources are copied to each target project's `.method/` directory separately
- **Atomicity**: Copy either succeeds for all targets or fails for all (rollback on any error)
- **Overwrite control**: Set `overwrite=false` to skip existing resources; `overwrite=true` to replace
- **Permissions**: Only projects with `.method/` directory can receive resources (isolation boundary)

---

## Cross-Project Isolation

### The Isolation Boundary

By design, **only projects with `.method/` directory participate in Phase 2A features**:

- A project **without `.method/`** is "Phase 1 only" — discovered but not coordinated
- A project **with `.method/`** is "Phase 2 eligible" — can receive resources, appears in Genesis polling loop
- Genesis **cannot see events** from projects without `.method/`

This is enforced by `DefaultIsolationValidator` in the bridge:

```python
allowed = (
  requested_project_id == session.project_id  # Same project
  OR session.project_id is None AND has_method_dir  # Read-only discovery
  OR is_authorization_bypass_attempt  # DENIED
)
```

### Testing Isolation

Run the isolation test suite:

```bash
npm test -- packages/bridge/src/__tests__/isolation-cross-project.test.ts
```

All 18 tests should pass, confirming:
- Genesis cannot read events from non-.method/ projects
- Sessions bound to project A cannot access project B's resources
- Cross-project resource copies are scoped correctly

---

## Performance & Scaling

Phase 1 & Phase 2A are optimized for **< 20 projects**:

| Operation | Target | Actual (20 projects) | Headroom |
|-----------|--------|--------|----------|
| Initial discovery | < 500ms | 45–65ms | 8–11x |
| Event polling (per project) | < 100ms | 10–15ms | 7–10x |
| Cursor cleanup (7-day TTL) | < 50ms | 2–3ms | 15–25x |
| Circular buffer (100K events) | < 200MB | 28–35MB | 6–7x |

These numbers assume:
- ~200–500ms per project to clone/.git/ discovery (I/O bound)
- 10–50 events per project per polling cycle
- Typical filesystem (SSD, local, no network mount)

### Monitoring Performance

Check bridge health:

```bash
curl http://localhost:3456/health
```

Response includes uptime, active sessions, version.

Check Genesis performance:

```bash
curl http://localhost:3456/genesis/status
```

Check event log size:

```bash
curl http://localhost:3456/api/projects | jq '.events | length'
```

---

## Common Tasks

### Task 1: Check if all projects are discovered

```bash
curl http://localhost:3456/api/projects | jq '.projects | length'
```

### Task 2: See what Genesis is doing right now

```bash
curl http://localhost:3456/genesis/status | jq '.polling'
```

### Task 3: Share a methodology across projects

```bash
# 1. Check that source project has the methodology
curl http://localhost:3456/api/projects/method | jq '.config | .installed_methodologies'

# 2. Copy to targets
curl -X POST http://localhost:3456/api/resources/copy-methodology \
  -H "Content-Type: application/json" \
  -d '{
    "source_project": "method",
    "source_registry_id": "P2-SD",
    "target_projects": ["my-project", "other-project"],
    "overwrite": false
  }'

# 3. Verify receipt
curl http://localhost:3456/api/projects/my-project | jq '.config | .installed_methodologies'
```

### Task 4: Debug a project that won't be discovered

```bash
# 1. Check if path exists
ls -la /path/to/project

# 2. Check for .git/
ls -la /path/to/project/.git

# 3. Trigger a manual reload
curl -X POST http://localhost:3456/api/projects/root/reload

# 4. Check discovery logs in bridge output
# (look for "Scanning..." and error messages)
```

### Task 5: Clear Genesis and restart fresh

```bash
# 1. Kill Genesis
curl -X DELETE http://localhost:3456/genesis/prompt

# 2. Verify it's dead
curl http://localhost:3456/genesis/status  # Should show "not_spawned"

# 3. Restart bridge (or just let Genesis respawn in 30s)
GENESIS_ENABLED=true npm run bridge:dev
```

---

## Phase 2A Features Checklist

- ✅ Project discovery: Recursive `.git/` scanning with timeout protection
- ✅ Event queue: Circular buffer (100K cap) per project
- ✅ Genesis persistence: Long-lived agent with project_id="root"
- ✅ Event polling loop: 5-second cadence, cursor management, 7-day TTL cleanup
- ✅ Cross-project isolation: Only projects with `.method/` participate
- ✅ Resource copying: Atomic methodology/strategy copies with validation
- ✅ HTTP API: 7 endpoints (projects, events, resources, Genesis status/prompt)
- ✅ Dashboard: Multi-project event stream view
- ✅ Performance: Baseline validation for < 20 projects

---

## What's Next? (Phase 2B & 2C)

**Phase 2B** (planned):
- Custom Genesis reactions (e.g., "When project A updates, rebuild project B")
- Persistent event storage (replace in-memory circular buffer)
- Genesis concurrent polling (flag lock for thread-safe cursor writes)

**Phase 2C** (planned):
- Cross-project workflows (Genesis coordinates work across project boundaries)
- Resource versioning (track which project versions depend on which)
- Dashboard drill-down (inspect individual Genesis decisions)

---

## References

- **PRD 020 spec:** `docs/prds/020.md`
- **Bridge architecture:** `packages/bridge/src/README.md`
- **Genesis implementation:** `packages/bridge/src/genesis/`
- **Project isolation:** `packages/bridge/src/project-routes.ts`
- **Test suite:** `packages/bridge/src/__tests__/isolation-cross-project.test.ts` (18 tests)
