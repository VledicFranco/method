---
guide: 19
title: "Multi-Project Genesis Agent"
domain: multi-project
audience: [agent-operators, project-leads]
summary: >-
  Genesis persistent coordinator, project discovery service, cross-project event routing.
prereqs: [1, 2, 10]
touches:
  - packages/bridge/src/genesis/
  - packages/bridge/src/project-routes.ts
  - packages/bridge/src/discovery-service.ts
---

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
status: "healthy"                 # One of: healthy, git_corrupted, missing_config, permission_denied
git_valid: true                   # Is .git/ directory intact?
method_dir_exists: true           # Does .method/ exist?
config_loaded: true               # Was .method/project-config.yaml loaded?
config_valid: true                # Is config valid YAML with required fields (id, name)?
config_error: null                # Error message if config loading/validation failed (optional)
error_detail: null                # Detailed error info, e.g. git validation errors (optional)
discovered_at: "2026-03-22T..."   # ISO timestamp
```

**Note:** Discovery auto-creates the `.method/` directory for any project that lacks one. If directory creation fails (e.g., permissions), the project is still discovered but `method_dir_exists` will be `false`.

### Discovery Endpoints

The bridge exposes HTTP endpoints for project discovery and management:

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

**`GET /api/projects/:id`** — Get a single project's metadata (with isolation check)
```json
{ "id": "method", "path": "...", "status": "healthy", "git_valid": true, ... }
```

**`POST /api/projects/validate`** — Resume discovery from a checkpoint
```json
{ "checkpoint": { "last_scanned_dir": "..." } }
```

**`POST /api/projects/:id/repair`** — Diagnose a corrupted repository
```json
{
  "status": "git_corrupted",
  "diagnosis": "Git repository is corrupted or invalid.",
  "repair_steps": ["Run: git fsck --full", "..."]
}
```

**`POST /api/projects/:id/reload`** — Reload project config (atomic manifest write with audit logging)

Takes a body with `newConfig` and performs an atomic write for that specific project. Validates config structure, writes atomically (temp file + rename), emits a `CONFIG_UPDATED` event, and triggers a registry rescan.
```bash
curl -X POST http://localhost:3456/api/projects/my-project/reload \
  -H "Content-Type: application/json" \
  -d '{ "manifest": { "project": "my-project", "last_updated": "...", "installed": [...] } }'
```
```json
{
  "success": true,
  "message": "Config reloaded and rescanned successfully",
  "old_config": { ... },
  "new_config": { ... },
  "changes": "~ manifest: ..."
}
```

**`GET /api/events`** — Global event polling (cursor-based, unfiltered)
```json
{
  "events": [ ... ],
  "nextCursor": "a1b2c3...",
  "hasMore": true
}
```

**`GET /api/projects/:id/events`** — Project-scoped event polling (cursor-based, with isolation check)
```json
{
  "events": [
    { "id": "proj-evt-1", "type": "config_loaded", "project_id": "my-project", "timestamp": "...", "data": {...} }
  ],
  "nextCursor": "a1b2c3...",
  "hasMore": true,
  "project_id": "my-project"
}
```

**`POST /api/events/test`** — Append a test event (for testing/development)
```bash
curl -X POST http://localhost:3456/api/events/test \
  -H "Content-Type: application/json" \
  -d '{ "projectId": "my-project", "type": "config_loaded" }'
```

### Configuring Discovery

Discovery behavior is controlled via environment variables on the bridge:

| Variable | Default | Purpose |
|----------|---------|---------|
| `DISCOVERY_TIMEOUT_MS` | 60000 | Max time to scan filesystem (30s–60s typical) |
| `DISCOVERY_MAX_PROJECTS` | 1000 | Stop scanning after finding N projects |
| `DISCOVERY_CACHE_TTL_MS` | 1800000 | Cache TTL for discovery results (30 minutes) |

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

Response when running (200):

```json
{
  "sessionId": "genesis-root-...",
  "status": "idle",
  "nickname": "genesis",
  "csrf_token": "a1b2c3d4e5f6..."
}
```

Response when disabled (503):

```json
{
  "error": "Genesis not running",
  "message": "Genesis session has not been initialized. Check GENESIS_ENABLED env var."
}
```

**Important:** The `csrf_token` returned here is required for `POST /genesis/prompt` requests.

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

Requires a valid `csrf_token` obtained from `GET /genesis/status`.

```bash
# 1. Get a CSRF token
CSRF=$(curl -s http://localhost:3456/genesis/status | jq -r '.csrf_token')

# 2. Send the prompt
curl -X POST http://localhost:3456/genesis/prompt \
  -H "Content-Type: application/json" \
  -d "{
    \"message\": \"Summarize recent events across all projects\",
    \"csrf_token\": \"$CSRF\"
  }"
```

**`DELETE /genesis/prompt`** — Abort the current in-flight prompt

Sends a CTRL-C interrupt to the Genesis PTY session to cancel whatever is currently being processed. Does **not** kill or clear the Genesis session itself.

```bash
curl -X DELETE http://localhost:3456/genesis/prompt
```

**Restart Genesis** — it will spawn with a fresh budget:
```bash
GENESIS_ENABLED=true npm run bridge
```

### Genesis Project Tool Endpoints

These endpoints expose Genesis's project tools over HTTP. They require the Genesis tools context to be initialized (i.e., Genesis must be enabled and running).

**`GET /api/genesis/projects/list`** — List all discovered projects (Genesis/root only)
```json
{
  "projects": [ ... ],
  "stopped_at_max_projects": false,
  "scanned_count": 42,
  "discovery_incomplete": false
}
```

**`GET /api/genesis/projects/:projectId`** — Get project metadata (with isolation check)
```json
{ "id": "my-project", "summary": "...", "metadata": { ... } }
```

**`GET /api/genesis/projects/:projectId/manifest`** — Get project manifest YAML (with isolation check)

**`GET /api/genesis/projects/events`** — Read project events (cursor-based pagination)

Supports optional query parameters: `project_id` (filter by project) and `since_cursor` (pagination).
```bash
curl "http://localhost:3456/api/genesis/projects/events?project_id=my-project&since_cursor=abc123..."
```

**`POST /api/genesis/report`** — Report findings (Genesis session only, project_id must be "root")
```bash
curl -X POST http://localhost:3456/api/genesis/report \
  -H "Content-Type: application/json" \
  -d '{ "message": "Detected config drift in project X" }'
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

Check event log:

```bash
curl http://localhost:3456/api/events | jq '.events | length'
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

# 3. Use the repair endpoint for diagnostics
curl -X POST http://localhost:3456/api/projects/my-project/repair

# 4. Re-run discovery to pick up the project
curl http://localhost:3456/api/projects

# 5. Check discovery logs in bridge output
# (look for "Scanning..." and error messages)
```

### Task 5: Abort Genesis prompt and restart fresh

```bash
# 1. Abort any in-flight prompt (sends CTRL-C to PTY)
curl -X DELETE http://localhost:3456/genesis/prompt

# 2. Check Genesis status
curl http://localhost:3456/genesis/status  # 503 if not running, 200 with session info if alive

# 3. Restart bridge to get a fresh Genesis session
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
- ✅ HTTP API: 18 endpoints (10 project/event/resource routes + 8 Genesis routes)
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
- **Project routes:** `packages/bridge/src/project-routes.ts`
- **Genesis routes:** `packages/bridge/src/genesis-routes.ts`
- **Discovery service:** `packages/bridge/src/multi-project/discovery-service.ts`
- **Test suite:** `packages/bridge/src/__tests__/isolation-cross-project.test.ts` (18 tests)
