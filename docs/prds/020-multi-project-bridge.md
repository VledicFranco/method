# PRD 020: Multi-Project Bridge & Genesis Agent

**Status:** Phase 1-5 Complete (1185 tests passing, +11 from baseline). TIER_0 Fixes In Progress: 6 of 9 critical blockers implemented (F-P-1, F-S-1/2/3, F-R-001, F-R-002). Remaining: F-T-001/003 (FS error injection tests). Merge-ready pending final test suite stabilization. See git log for TIER_0 implementation details.
**Owner:** Steering Council (AG-064)
**Methodology:** P2-SD v2.0
**Target Release:** Phase 2 (after PRD 017 matures)
**Complexity:** High — architectural change to bridge, new persistent agent
**PRD 021 impact:** **Extended.** MethodTS needs project-scoped methodology loading from `manifest.yaml`. Every `runMethodology` execution binds to a `project_id`. Events tagged with project_id for isolation. Genesis agent (Phase 2) commissions MethodTS methodologies. Resource copying between projects gains typed validation for methodology compatibility.

---

## 1. Problem Statement

**Current state:**
- Bridge runs against a single project (hardcoded `npm run bridge` in the pv-method directory)
- Each project needs its own bridge instance if they want governance, strategies, or methodology support
- No unified view across projects; no way to coordinate work across multiple codebases
- Resources (methodologies, strategies, project cards) are isolated per project

**User friction:**
- Users working across multiple repos (Repositories/oss-constellation-engine, Repositories/pv-method, etc.) must manage separate bridge instances
- Can't easily copy methodologies between projects
- No way to route work across projects (e.g., "implement this feature across 3 repos")
- No persistent coordination agent — human must manually track state across projects

**Opportunity:**
The method system is designed to be composable and cross-cutting. Multi-project support unlocks:
- Portfolio-level governance (steering council sees all projects)
- Cross-project methodology execution (strategies span repos)
- Shared methodology registry (copy/inherit from other projects)
- Persistent agent (Genesis) managing coordination

---

## 2. Vision & Scope

### Vision
A single bridge instance running from a root directory (e.g., `~/Repositories/`) that:
1. **Auto-discovers** all git repositories as logical projects (each git repo becomes a project, identified by relative path from root)
2. **Initializes** each project with `.method/` configuration directories
3. **Federates** methodology execution across projects
4. **Enables** easy sharing of methodologies, strategies, and project cards between projects
5. **Anchors** a persistent Genesis agent that observes events and coordinates work (Phase 2 feature — see Phase 2 scope)

**Key Mental Model:** Projects are identified by relative path from root. Semantic namespaces (grouping repos into logical portfolios) are a Phase 2 feature. The bridge runs at ROOT_DIR. Each project below ROOT_DIR is auto-discovered. There is one bridge instance per ROOT_DIR, not one per project.

### Scope (Phase 1)

**Include:**
- Multi-project discovery (recursive `.git/` scan)
- Per-project `.method/` directory creation and configuration
- Bridge API enhancements: project selection, listing, filtering
- Project metadata storage (`.method/project-config.yaml`)
- Event aggregation with project isolation (project_id tagging)
- MCP tools for project metadata + event queries

**Defer (Phase 2):**
- Genesis agent (spawning, session management, budget enforcement — requires mature event API from Phase 1)
- Cross-project strategies (executing in multiple repos sequentially/parallel)
- Shared methodology registry (inheritance, imports)
- UI dashboard enhancements for multi-project visualization
- Resource copying UI (copy methodology/strategy through dashboard)

**Note:** Phase 1 provides the foundation (project registry, event API with persistence) that Phase 2 Genesis agent will consume. Genesis spawning and UI are deferred to avoid scope bloat in Phase 1.

---

## 3. Architecture Overview

```
Repositories/ (root project)
├── .git/
├── .method/ (root .method directory)
│   ├── project-config.yaml
│   ├── genesis-sessions/ (Genesis agent session logs)
│   ├── shared-strategies/
│   └── shared-methodologies/ (optional: imported from child projects)
├── genesis-session-log.yaml (persistent Genesis event log)
├── pv-method/ (project A)
│   ├── .git/
│   ├── .method/
│   │   ├── project-card.yaml
│   │   ├── council/
│   │   ├── manifest.yaml
│   │   └── retros/
│   └── [source code]
├── oss-constellation-engine/ (project B)
│   ├── .git/
│   ├── .method/
│   │   ├── project-card.yaml
│   │   └── ...
│   └── [source code]
└── oss-glyphjs/ (project C)
    ├── .git/
    └── .method/ (created by bridge on first discovery)
```

### Key Components

**1. Multi-Project Discovery (Fail-Safe)**
- Bridge starts with `--root-dir <path>` or `ROOT_DIR` env var (defaults to cwd)
- On startup, recursively scans for `.git/` directories with timeout (DISCOVERY_TIMEOUT_MS, default 60s, configurable)
- Per-project `.git` scan target: < 100ms; total discovery target: < 500ms (20 projects)
- Each git repo root becomes a project in the bridge's internal project registry
- Projects are indexed by relative path from root (e.g., `pv-method`, `oss-constellation-engine`)
- **Timeout & Recovery:**
  - If discovery exceeds timeout (60s), returns discovery_incomplete flag in /projects response
  - Sets failed/incomplete projects with status: "git_corrupted", "discovery_incomplete", or "discovery_timeout" with error message
  - Emits discovery_incomplete event to event log
  - User can call `POST /projects/validate` to retry discovery (manual, not automatic)
  - User can call `POST /projects/:id/repair` to diagnose/fix corrupted repos
  - Resumable discovery with checkpoint/resume (implementation detail; must not lose partial progress on timeout/crash)
- **Error Handling:**
  - Corrupted .git/ dirs: log warning, register with status="git_corrupted" + error detail, continue discovery
  - Permission denied: register with status="discovery_permission_error" + path, continue
  - MAX_PROJECTS limit (if set): emit max_projects_reached event, return discovery_incomplete when limit reached

**2. Project Configuration (.method/ Directory)**
- Bridge creates `.method/` in each project if missing
- Stores:
  - `project-config.yaml` — project-specific metadata (name, description, owner, dependencies)
  - `manifest.yaml` — installed methodologies (same as current pv-method)
  - `council/` — steering council artifacts
  - `retros/`, `strategies/`, etc. — execution artifacts
  - `.gitignore` — whitelist relevant artifacts (same pattern as current)

**3. Root Project .method/ (New)**
- Root-level configuration directory at `Repositories/.method/`
- Stores:
  - `project-config.yaml` — root project metadata (portfolio name, shared resources)
  - `genesis-events.yaml` — accumulated event log for Genesis agent
  - `shared-strategies/` — strategies that apply to multiple projects
  - Optional: shared methodology registry (Phase 2)
- Gitignored selectively (like current pv-method pattern)

**4. Genesis Agent (Phase 2 Feature)**
- See Phase 2 scope above. Genesis is deferred to Phase 2 to avoid scope bloat in Phase 1.
- Phase 1 provides the foundation: ProjectRegistry + event aggregation with project_id tagging
- Phase 2 will introduce Genesis agent with: spawning, session management, initialization prompt, polling loop, and MCP tools

**5. Event Aggregation**
- All events (from all projects) are accumulated at root level
- **Event schema:** Each event is tagged with `project_id` (relative path) for isolation filtering

  ```typescript
  interface ProjectEvent {
    type: ProjectEventType;            // "completed", "error", "escalation", etc.
    project_id: string;                // relative path (e.g., "pv-method", "") for filtering
    timestamp: string;                 // ISO 8601
    content: Record<string, unknown>;  // event-specific data
  }
  ```

- **Phase 1 Event Durability:** Events persisted to `.method/genesis-events.yaml` (disk write is async, buffered, non-blocking). Event log capped at 10K events. When overflow occurs, oldest events are pruned (respecting project_id boundaries — projects never lose their own events out of order). File rotation at > 5MB (rotate to genesis-events.YYYY-MM-DD-HH-MM-SS.yaml.gz, keep last 3 rotated files).
  - **Backpressure Protection:** Disk writes are async; agent sessions are never blocked waiting for event persist. If write fails after 3 retries (exponential backoff), event is dropped and logged as `genesis_events_write_failed` (not fatal).
  - **Startup Recovery:** On bridge startup, loads all events from genesis-events.yaml. If file is corrupted (partial write, truncation), attempts to recover valid entries. Emits `{type: 'genesis_events_corruption_detected', recovered_events: N, skipped_events: M}` event. Backup copy saved as genesis-events.yaml.backup for operator review.
  - **Per-project retention policy:** Phase 1 uses global FIFO. Phase 2 adds per-project budgets or event-type weighting (high-priority events never pruned until retention expires).
- **Phase 2+ Event Durability:** Enhanced retention policies, cross-project event aggregation, event replay UI, and Genesis session recovery strategies built on Phase 1 persistence foundation.
- Sessions belong to specific projects; queries for project A cannot see project B's events
- Genesis (Phase 2) will consume events via `project_read_events(project_id?)` to filter by project or get all

- Example flow (Phase 2):
  ```
  pv-method/session-1 → completed event {project_id: "pv-method", ...}
  oss-glyphjs/session-2 → completed event {project_id: "oss-glyphjs", ...}
  [Genesis idle, polls events]
  Genesis reads both → "Two projects completed tasks. Analyze and report."
  Genesis → human report
  ```

**6. Resource Sharing (UI + MCP)**
- **UI:** Dashboard provides "copy methodology" UI
  - Select source project + methodology name
  - Select target projects
  - Bridge copies `.method/manifest.yaml` reference (or full methodology YAML)
- **MCP:** New tools for resource operations
  - `project_list_methodologies` — list installed methodologies in a project
  - `project_copy_methodology` — copy methodology from one project to another
  - `project_copy_strategy` — copy strategy between projects
  - `project_copy_project_card` — copy/merge project card settings

---

## 4. Detailed Design

### 4.1 Bridge Startup & Discovery

**Environment variables (Phase 1):**
```bash
ROOT_DIR=/path/to/Repositories              # defaults to cwd
MAX_PROJECTS=50                             # safety limit on auto-discovery
```

**(Phase 2 — Genesis environment variables will be added)**

**Startup sequence (bootstrap discovery — one-time per bridge start):**
1. Load root project config
2. Scan for .git/ repos recursively (up to 3 levels deep, timeout 60s)
3. One-time bootstrap discovery (populate registry with all projects)
4. Init .method/ for each project
5. Optional: POST /projects/rescan for manual re-discovery after adding new repos

**Error Handling:**
- If .git/ is corrupted, log warning and skip project (do NOT crash bridge). Operator reviews in logs. Use POST /projects/:id/repair for diagnosis.
- Symlink collision detection: If two discovered repos resolve to same real path (symlink/alias), use first discovered and skip duplicate.

**Initialization Failure Handling:**
- If `.method/` creation fails for any project (permissions, disk full, etc.): log error, mark project with `init_failed: true` in registry, and **continue discovery** (do not abort for other projects)
- Failed projects are visible in `/projects` list with error details
- User can manually fix the issue and retry via `POST /projects/:id/init-retry` (which attempts `.method/` creation again)

**Optional re-scan:** `POST /projects/rescan` allows manual re-discovery (useful if new repos added after bridge startup)

### 4.2 Project Model

**ProjectMetadata (in-memory):**
```typescript
interface ProjectMetadata {
  id: string;                           // relative path from root ("pv-method", "", etc.)
  root_dir: string;                     // absolute path
  method_dir: string;                   // ${root_dir}/.method
  name: string;                         // from project-config.yaml
  description?: string;
  owner?: string;
  installed_methodologies: string[];    // from manifest.yaml
  has_council: boolean;
  last_scanned: string;                 // ISO timestamp
}
```

**project-config.yaml (new, per project):**

Each discovered project auto-creates .method/project-config.yaml if missing. Schema: {id, name, description?, owner?, version?, dependencies?, shared_with?, genesis_enabled?, resource_copy?, genesis_budget?}.

Example:
```yaml
project_config:
  id: pv-method                                              # relative path from ROOT_DIR (kebab-case, auto-set by bridge)
  name: "pv-method"                                          # project display name (readable)
  description: "Runtime for formal methodologies"            # optional
  owner: "steering council"                                  # optional
  version: "1.0"                                             # optional, metadata version
  dependencies: []                                           # optional, other project IDs this depends on (Phase 2)
  shared_with: []                                            # optional, projects that can import methodologies from here (Phase 2)
  genesis_enabled: false                                     # optional, enable Genesis agent for this project (Phase 2)
  resource_copy: true                                        # optional, allow copying resources to/from this project
  genesis_budget: 50000                                      # optional, daily token budget for Genesis agent (Phase 2)
```

**Initialization behavior:**
- If `.method/project-config.yaml` missing: bridge creates it with auto-set `id` (relative path) and placeholder name
- If present: bridge loads and validates (id must match expected relative path)
- Per-project `.method/project-config.yaml` is committed to git; human edits `name`, `description`, `owner` as needed
- Root `.method/project-config.yaml` (at ROOT_DIR) is similar but `id` is "" or "root"

**Configuration Schema & Validation:**

Bridge validates all `project-config.yaml` files at startup and on reload using strict schema:

```yaml
project_config:
  id: string                              # required: relative path (auto-set by bridge)
  name: string                            # required: project display name
  description: string                     # optional
  owner: string                           # optional
  version: string                         # optional (default: "1.0")
  dependencies: array of strings          # optional: project IDs this depends on (Phase 2)
  shared_with: array of strings           # optional: project IDs that can import from here (Phase 2)
```

Validation Rules:
- `id` must match relative path from ROOT_DIR (auto-corrected if mismatch detected; warning emitted)
- `name` required; non-empty string
- Return 400 Bad Request on validation failure with clear error message
- Silent drops: **not allowed** (previous behavior rejected)
- Test cases: missing fields, type mismatches, stale id, invalid path

**Configuration Management:**
- **Phase 1:** Configuration is loaded once at bridge startup and cached in-memory. If user edits `.method/project-config.yaml` directly, bridge **restart is required** for changes to take effect. No POST /projects/:id/reload in Phase 1 (eliminates TOCTOU race).
- **Phase 2:** Adds manual reload API `POST /projects/:id/reload` for live config updates. When implemented: returns 200 on success, 400 on validation failure, 409 on conflict; config write is atomic (temp file + rename); emits config_reloaded event; privilege enforcement (session.project_id === id or human-only); audit logging required.
- **Hot reload** (bridge watches `.method/` for changes automatically): Phase 2 feature (post-Phase 1 stability achieved).

### 4.3 Genesis Agent Architecture

**Note:** Genesis is a Phase 2 feature. Phase 1 provides the project discovery, event schema, and API foundation. This section describes the Phase 2 architecture.

**Spawning:**
```
bridge startup → ProjectDiscovery complete (Phase 1)
              → if GENESIS_ENABLED (Phase 2): spawn_session(
                  project_id: "root",
                  isolation: none,
                  model: GENESIS_MODEL,
                  initial_prompt: genesis_initialization_prompt(),
                  persistent: true
                )
```

**Session config:**
- Session ID: `genesis-root`
- Budget: 50K tokens per day (configurable)
- Tools: method MCP + project navigation MCP
- Input: human prompts via UI + accumulated events
- Output: status reports and real-time TUI rendering

**Polling loop:**
```typescript
while (genesis_session.is_active) {
  if (genesis_session.is_idle) {
    events = await bridge_read_events(since_cursor);
    if (events.length > 0) {
      prompt = `New events received:\n${format_events(events)}\nAnalyze and report.`;
      await genesis_session.send_prompt(prompt);
    }
  }
  await sleep(GENESIS_POLL_INTERVAL_MS);
}
```

**Initialization prompt:**
```
You are Genesis, a persistent coordination agent for the pv-method portfolio.

Your role: OBSERVE and REPORT ONLY.
- You read events from all projects
- You analyze the current state
- You report to the human about what's happening
- You decide: should we execute the next task, wait, or escalate?

You do NOT:
- Write code
- Make implementation decisions
- Directly invoke agents
- Modify files

Your human partner controls execution via:
- /commission: spawn a child agent for a task
- /review-pipeline: review a branch
- /steering-council: governance

You have access to:
- Full method MCP tools
- Project metadata and navigation
- Event streams across all projects
- .method/ directories and artifacts

Available commands (for your prompts to the human):
- "EXECUTE <commission_spec>" — human confirms, then spawns agent
- "REVIEW <branch>" — human confirms, then runs review-pipeline
- "REPORT <status_update>" — inform human of analysis

Current portfolio state:
${portfolio_status}

Begin by reporting the current state.
```

### 4.4 Genesis UI/UX (Phase 2)

**Pattern: Material Design FAB + Draggable Expandable Chat**

The Genesis chat interface uses the existing **PTY bridge infrastructure** (xterm.js + SSE streaming) to mimic a real Claude Code terminal session, enabling the most natural interaction model.

**Design:**

1. **Floating Action Button (FAB)**
   - Circular `+` button (60px) in bottom-right corner of dashboard, draggable
   - Always visible, always accessible
   - Click to expand/collapse chat panel; rotate 45° when expanded (visual feedback)
   - Button is **part of the chat panel**, not separate (maintains consistency)

2. **Expanded Chat Panel**
   - Full-screen or half-screen modal expanding from bottom-right
   - **Header:** "Genesis Control" title + close button (✕)
   - **Status bar:** Genesis status (Active/Idle), budget %, last action timestamp
   - **Terminal area:** xterm.js emulator rendering raw PTY output (same as `/sessions/:id/output.html`)
   - **Input bar:** At bottom (mimics Claude Code TUI), input field + Enter to send (no explicit Send button)
   - **Draggable:** Header and panel are draggable; can reposition while expanded without blocking dashboard

3. **PTY Implementation Details**

   **Connection:**
   - Genesis spawns as a regular session with `persistent: true` and `session_id: genesis-root`
   - Dashboard queries `/sessions/genesis-root/stream` (SSE endpoint) for live PTY output
   - Dashboard POST to `/sessions/genesis-root/prompt` to send user input

   **Terminal rendering:**
   - Reuse existing `live-output.html` xterm.js setup (same fonts, colors, cursor behavior)
   - Vidtecci color scheme (void, abyss, bio, solar, etc.) consistent with dashboard
   - Parse raw PTY data (ANSI escape codes) via xterm.js; no custom parsing needed

   **Input handling:**
   - Input field captures keydown events; **Enter key sends** the prompt
   - No explicit Send button (matches Claude Code TUI)
   - Input field injects cleanly into the PTY output (xterm.js manages scroll)
   - Supports readline history (↑/↓ navigation) if Claude Code session handles it

4. **Interaction Flow**

   ```
   User sees FAB in bottom-right
   User clicks FAB → panel expands, renders genesis-root PTY stream
   User types prompt in input field
   User presses Enter → POST /sessions/genesis-root/prompt
   Genesis responds → SSE sends PTY output back
   Panel updates in real-time (scrolling follows Genesis response)
   User can drag panel to move it while reading dashboard
   User clicks FAB again → panel collapses, FAB returns to + icon
   ```

5. **State Management**

   - **Open/Closed:** Toggle on FAB click; stored in browser localStorage or session state
   - **Position:** Dragging updates CSS `bottom`/`right`; persisted to localStorage (optional: remember position across sessions)
   - **Session binding:** Genesis session is project-agnostic (`project_id: "root"`); always targets the root portfolio Genesis agent

6. **Responsiveness**

   - **Desktop:** Panel expands from bottom-right, takes ~40-50% of viewport
   - **Mobile (< 768px):** Panel adapts to full-screen overlay with close button (↑ swipe or ✕ tap closes)
   - FAB remains visible and draggable on all viewports
   - Input bar sticky at bottom on mobile (handles virtual keyboard)

7. **Visual Hierarchy (Narrative Flow)**

   - **Glance:** FAB status indicator (color change on new events or budget warning)
   - **Scan:** Expanded header shows status, budget %, recent timestamp
   - **Deep Dive:** Full PTY terminal with conversation history and input

8. **Prototype Reference**

   A prototype of this pattern (FAB + draggable expand/collapse) exists in `tmp/genesis-ui-options.html`. Phase 2 implementation should use this as a reference for interaction patterns and drag behavior.

---

## 5. API Changes

### 5.1 New Bridge Endpoints

**Project Management:**
```
GET /projects
  → { projects: [ { id, name, method_dir, installed_methodologies, ... } ] }

GET /projects/:id
  → { project: ProjectMetadata }

POST /projects/rescan
  → Re-scan ROOT_DIR for new git repos (optional; discovery happens at startup)

GET /projects/:id/.method/project-config.yaml
  → raw YAML content
```

**Session→Project Binding & Isolation Enforcement:**

Every session references a project_id (extracted from x-project-id header or injected by MCP tools). Project_id is non-optional; all event queries, config reads, and project operations are scoped to the session's project_id.

Every session created via bridge is bound to a specific project_id. Isolation is enforced at the MCP tool layer:
- `POST /sessions` with `project_id` parameter binds session to that project
- Sessions for project A **cannot access** method definitions, configurations, or events from project B
- The `project_id` is embedded in session metadata and **validated by every MCP tool** before granting access
- All MCP tools that reference project metadata (project_list, project_get, project_read_events) validate the requester's project_id against the target project_id
- Genesis tools (genesis_report, etc.) can only be called by sessions with project_id = "root"
- Config reload (POST /projects/:id/reload) enforces session.project_id === id (or human-only override)
- **Root project access control:** Sessions with project_id != "root" **cannot** access root-level events, config, or root-scoped MCP tools. Root project is isolated by design; child agents operate within their own project boundary.
- MCP tool validation is centralized in validation middleware (e.g., `@method/mcp/validate-project-access.ts`), not duplicated in each tool:
  - Stripping user-supplied project_id (use session metadata instead)
  - Access control check before returning any project data (project_id must match session context)
  - Root-level operation checks (genesis_report, project_copy_* only with project_id="root")
  - Audit logging for all access attempts (timestamp, session_id, tool, action, project_id, allowed/denied)
  - Test coverage: cross-project query rejection, event filtering per project, session identity enforcement, root-level isolation

**Test Requirements:** Isolation test suite at `packages/bridge/src/__tests__/project-isolation.test.ts` must verify:
1. Agent in project A cannot read project B's events
2. GET /projects/:A returns only A's metadata (child agent does not see B)
3. Child agent in project A cannot read root-level events
4. Sessions spawned for A have correct project_id tag
5. Non-Genesis agents cannot call genesis_report
6. Config reload restricted to same project_id
7. Root project isolation: POST /projects/:id/reload fails if session.project_id != "root" and id == ""

**Event Queries (Phase 1 basic, Phase 2 advanced):**
```
GET /projects/:id/events
  → { events: [ { type, project_id, timestamp, ... } ], nextCursor?: string }
  → Returns events for project_id only (not cross-project)
  → Optional: since_cursor parameter for incremental polling

GET /events?since_cursor=X
  → { events: [ { type, project_id, timestamp, ... } ], nextCursor?: string }
  → Returns all events (Genesis Phase 2 will filter by project_id as needed)
  → Cursor-based polling: since_cursor parameter skips to new events
  → nextCursor in response enables incremental fetches

**Cursor Strategy (Phase 1):**
  - Implementation: In-memory cursor tracking (list index or timestamp)
  - Cursor format: Opaque string (e.g., base64-encoded timestamp or ID; format internal only)
  - Cursor invalidation: On bridge restart, cursors are lost; Genesis Phase 2 polling must handle InvalidCursor gracefully (reset to start or latest)
  - Cursor TTL: No expiration in Phase 1 (cursor valid until bridge restart)
  - Phase 2 enhancement: Persistent cursor storage (per-session or per-Genesis-poll-context) to survive bridge restart
```

**Genesis Control (Phase 2):**
```
(Deferred to Phase 2 — see Phase 2 scope)
```

**Resource Operations:**
```
POST /projects/:source_id/copy-methodology/:method_name
  → { source_id, method_name, target_project_ids: [...] }
  → Copies methodology YAML to target projects' manifest.yaml

POST /projects/:source_id/copy-strategy/:strategy_name
  → Similar for strategies
```

### 5.2 MCP Tools (New)

**For Genesis (and sub-agents):**
```
project_list()
  → [ { id, name, description, ... } ]

project_get(project_id: string)
  → ProjectMetadata

project_get_manifest(project_id: string)
  → manifest.yaml content

project_copy_methodology(source_id, method_name, target_ids: string[])
  → { copied_to: [ ... ], errors?: [ ... ] }

project_read_events(project_id?: string, since_cursor?: string)
  → [ { type, project_id, timestamp, content, ... } ]

genesis_report(message: string)
  → Sends report to human (Genesis only)
```

---

## 6. Implementation Phases

### Phase 1 vs Phase 2 Boundary

| Feature | Phase 1 | Phase 2 | Notes |
|---------|---------|---------|-------|
| Project discovery | ✅ | — | Recursive .git scan with error handling |
| Project metadata (.method/project-config.yaml) | ✅ | — | Schema, validation, reload endpoints |
| Event aggregation with project_id tagging | ✅ | — | Disk persistence, cursor-based polling |
| Project isolation enforcement | ✅ | — | MCP tool validation, access control, tests |
| Session→project binding | ✅ | — | Metadata embedding, API validation |
| Genesis spawning | — | ✅ | Persistent session, initialization, polling loop |
| Genesis UI (FAB + chat) | — | ✅ | Floating action button, PTY bridge rendering |
| Genesis tools (genesis_report, etc.) | — | ✅ | Depends on mature event API from Phase 1 |
| Resource copying tools | — | ✅ | Phase 3: project_copy_methodology, etc. |
| Cross-project strategies | — | ✅ | Deferred to Phase 2+ |
| Shared methodology registry | — | ✅ | Deferred to Phase 2+ |
| Hot config reload | — | ✅ | File watching; Phase 1 uses manual reload |
| Multi-project dashboard UI | — | ✅ | Phase 4: project list, session isolation, event stream |

**Phase 1 is not deferred; Genesis is.** Phase 1 delivers complete multi-project support with persistent events, isolation enforcement, and all read-only APIs. Phase 2 adds Genesis (the persistent agent) and UI enhancements.

### Phase 1: Multi-Project Discovery & Configuration

**Deliverables:**
- ProjectDiscovery service (recursive .git scan with timeout, error handling, recovery endpoints)
- ProjectRegistry (in-memory with fail-safe status tracking)
- project-config.yaml JSON Schema with validation
- Root `.method/` directory creation
- **Event persistence:** `.method/genesis-events.yaml` disk sync, file rotation (> 5MB), per-project retention
- Event aggregation with project_id tagging and cursor-based polling API
- Project isolation enforcement at MCP tool layer (validation, access control, audit logging)
- API endpoints:
  - GET /projects (with discovery_incomplete flag)
  - GET /projects/:id
  - POST /projects/validate (retry discovery)
  - POST /projects/:id/repair (diagnose/fix corrupted repos)
  - GET /projects/:id/events
  - GET /events (cursor-based, with since_cursor parameter)
  - GET /health (includes registry_consistent: bool flag)
- Unit tests for discovery, metadata, event persistence
- **Isolation test suite:** `packages/bridge/src/__tests__/project-isolation.test.ts`
  - Verify sessions/events for project A don't leak to project B
  - Cross-project query rejection
  - Session identity enforcement
  - Config reload privilege check
  - 4+ concrete test cases with temp fixtures
  - Cross-project isolation validation tests: unit tests verify project_id filtering. Event queries for project A don't see project B's events.
- **Failure scenario tests:** disk-full, permission-denied, partial init, incomplete discovery
- Performance testing: startup < 2s, discovery < 500ms, event queries < 100ms
- **Human interaction model:** Phase 1 is data-only (no Genesis agent). GET /projects returns all projects. /projects/:id/{manifest,config} returns project-specific data. Phase 1 consumers: CLI tools, dashboards, programmatic access via MCP.

**Files:**
- `packages/bridge/src/project-discovery.ts` (new)
- `packages/bridge/src/project-registry.ts` (new)
- `packages/bridge/src/project-routes.ts` (new)
- `packages/bridge/src/event-aggregation.ts` (new) — event schema, disk persistence, cursor API
- `packages/bridge/src/event-persistence.ts` (new) — disk I/O, file rotation, recovery
- Schema: `.method/project-config.yaml` JSON Schema (document)
- Test file: `packages/bridge/src/__tests__/project-isolation.test.ts` (new)
- Test fixture: disk-full, permission-denied scenarios

### Phase 2: Genesis Agent Foundation & Resource Sharing

**Deliverables:**
- Genesis spawning & session management (depends on mature event API from Phase 1)
- Genesis MCP tools (project_list, project_get, project_read_events, genesis_report, etc.)
- Genesis initialization prompt
- Genesis polling loop with cursor-based event incremental fetch (Phase 1 cursor API supports this)
- API endpoints: GET /genesis/status, POST /genesis/prompt, GET /genesis/events
- Budget enforcement for persistent Genesis sessions
- **Config reload:** POST /projects/:id/reload (live config updates with TOCTOU protection, audit logging)
- **Hot config reload:** File watching on .method/ directories (auto-triggers rescan on changes)
- resource_copy_methodology and resource_copy_strategy MCP tools
- UI copy modal for methodology sharing
- **Persistent cursor storage:** Per-Genesis-session cursor file in .method/genesis-cursors.yaml (survives bridge restart)

**Files:**
- `packages/bridge/src/genesis/spawner.ts` (new)
- `packages/bridge/src/genesis/tools.ts` (new)
- `packages/bridge/src/genesis-routes.ts` (new)
- `packages/bridge/src/resource-copier.ts` (new)

### Phase 3: Resource Sharing

**Deliverables:**
- project_copy_methodology MCP tool
- project_copy_strategy MCP tool
- UI: Copy modal in methodology browser
- Tests for resource copying

**Files:**
- `packages/bridge/src/resource-copier.ts` (new)
- UI updates (bridge/viz/)

### Phase 4: Dashboard Enhancements

**Deliverables:**
- Multi-project project list view
- Per-project session isolation in dashboard
- Genesis status panel
- Event stream visualization

---

## 7. Configuration & Gitignore

### Root-Level .gitignore Pattern

```
# Repositories/.gitignore
.method/genesis-events.yaml       # Genesis event log (accumulates, do not commit)
.method/genesis-sessions/         # Genesis session logs (Phase 2)
.method/shared-strategies/         # Eventually shared strategies

# Whitelist (keep these committed):
!.method/project-config.yaml      # Root project config — commit this
!.method/.gitkeep
```

### Per-Project .gitignore Pattern
(Same as current pv-method, already in place)

### Gitignore Precedence Rules
- Root `.gitignore` applies globally to ROOT_DIR
- Per-project `.gitignore` applies within each project directory
- **Precedence:** Root .gitignore applies globally. Per-project .gitignore overrides for project-local artifacts. No conflicts — per-project rules win on file-level conflicts.
- In practice:
  - Root ignores specific files: `.method/genesis-events.yaml` (not a directory)
  - Root whitelists: `!.method/project-config.yaml`, `!.method/.gitkeep`
  - Per-project `.method/project-config.yaml` and `.method/manifest.yaml` are committed
  - Per-project `genesis-events.yaml` (if it were in per-project) would be ignored by root rule
- **No directory-level conflicts:** Root rules target specific files (genesis-events.yaml), not directories. Each project's `.method/` directory is committed.
- Test: validate no file-level conflicts via pre-commit hook warning if genesis-* files are accidentally staged

---

## 8. Success Criteria

### Functional Criteria (Phase 1)
- ✅ Bridge discovers all git repos in ROOT_DIR recursively (with error handling for corrupted repos, timeout, discovery_incomplete flag)
- ✅ Each project has `.method/` auto-created if missing (with auto-set id in project-config.yaml)
- ✅ Bridge API returns project list with metadata (GET /projects includes discovery_incomplete flag)
- ✅ Failed projects visible in /projects with error details (status: "git_corrupted", "discovery_incomplete", with error message)
- ✅ Project isolation: sessions/events for project A don't see project B's metadata (verified by isolation test suite)
- ✅ Event log persists to `.method/genesis-events.yaml` (survives bridge restart)
- ✅ Event log accumulates with project_id tagging (capped at 10K, pruned on overflow, file rotation at > 5MB)
- ✅ Config validation: invalid configs return 400 with clear error (not silent drops)
- ✅ Config reload is synchronous, atomic, with error reporting (not async)

### Concrete Test Cases (Phase 1)
- **Isolation tests (4+ minimum):** `packages/bridge/src/__tests__/project-isolation.test.ts`
  1. Agent in project A cannot read project B's events (GET /projects/B/events returns 403 or empty)
  2. Session spawned for A has project_id="A" in metadata; queries for B fail
  3. Config reload restricted to same project_id (POST /projects/B/reload blocked if session.project_id="A")
  4. Non-root sessions cannot call genesis_report
- **Failure scenario tests:**
  1. Disk-full: event write fails, error logged, bridge continues, event skipped
  2. Permission-denied: project directory not readable, status="git_corrupted", error in response
  3. Partial init: .method/ partially created, recovery via POST /projects/:id/repair
  4. Incomplete discovery: timeout at 60s, discovery_incomplete flag set, user can retry via POST /projects/validate
- **Event persistence:**
  1. Bridge restart loads events from disk
  2. File rotation at > 5MB (old events pruned)
  3. Cursor-based polling works (GET /events?since_cursor=X returns new events since X)

### Functional Criteria (Phase 2)
- ✅ Genesis agent spawns on startup (if enabled)
- ✅ Genesis reads events and reports status
- ✅ project_copy_methodology works (test: copy from pv-method to oss-glyphjs)
- ✅ resource_copy_strategy works

### Non-Functional Criteria (Phase 1)
- ✅ Bridge startup < 2 seconds with 20 projects
- ✅ Discovery scan < 500ms for 20 projects
- ✅ Event log queries < 100ms
- ✅ Event log size capped at 10K events; old events pruned on overflow
- ✅ Memory footprint < 200MB (projects + sessions + events)

### User Experience Criteria (Phase 1)
- ✅ Human can see all projects in bridge dashboard (or via API: GET /projects)
- ✅ Easy to add new project: just clone repo in ROOT_DIR, bridge auto-discovers it (manual rescan via POST /projects/rescan if needed)
- ✅ Project isolation is enforced (no cross-project event leaks)

### User Experience Criteria (Phase 2)
- ✅ Copy methodology via UI modal
- ✅ Genesis status visible at top-level
- ✅ Portfolio event dashboard showing all project activity

---

## 9. Risk & Mitigation

| Risk | Severity | Mitigation |
|------|----------|-----------|
| Bridge discovery is slow with 20+ projects | Low | Recursive scan < 500ms target; stop at MAX_PROJECTS safety limit |
| Corrupted .git/ crashes discovery | Medium | Error handling: log warning and skip corrupted repo (don't crash) |
| Project isolation breaks (cross-project leaks) | High | Unit tests verify session isolation; project_id tagging enforced in event schema |
| Event log grows unbounded | Medium | Cap at 10K events; prune oldest on overflow (respects project_id isolation) |
| Gitignore whitelist too permissive | Low | Review against pv-method pattern; per-project overrides when needed |

**Phase 2 Risks (Genesis):**
| Risk | Severity | Mitigation |
|------|----------|-----------|
| Genesis token budget exhausted | Medium | Budget enforcement in Phase 2; daily reset; escalate if over 80% |
| Genesis reports miss critical state | High | Event log has complete history; human can query directly via API |

---

## 10. Future Extensions (Phase 2+)

- Cross-project strategies (execute in parallel/sequential across repos)
- Shared methodology registry (import/inheritance between projects)
- Genesis autonomous decision-making (spawn agents without human confirmation)
- Portfolio-level council (steering council spanning all projects)
- Dependency tracking (A depends on B; auto-order execution)
- Resource versioning (methodology versioning across projects)

---

## 11. Glossary & Terms

- **Root project:** The top-level directory (Repositories/) where bridge starts
- **Child project:** A git repo discovered inside ROOT_DIR
- **Project ID:** Relative path from root (pv-method, oss-glyphjs, etc.)
- **Genesis:** Persistent coordination agent for the root project
- **Event:** Signal emitted by a session (completed, error, escalation, etc.)
- **Whitelist:** Explicit gitignore entries to preserve artifacts

---

## Appendix: Example Workflow

**Phase 1 (Discovery & Configuration)**

**Day 1: Setup**
```bash
cd ~/Repositories
npm run bridge  # starts with ROOT_DIR=~/Repositories
# Discovery: pv-method, oss-glyphjs, oss-constellation-engine, ...
# Each gets .method/ directory if missing
# ProjectRegistry initialized with all projects
# Bridge endpoints available: GET /projects, GET /projects/:id, etc.
```

**Day 2: Human Inspects Projects**
```bash
curl http://localhost:3456/projects
# Response: {projects: [{id: "pv-method", name: "pv-method", ...}, {id: "oss-glyphjs", ...}, ...]}

curl http://localhost:3456/projects/pv-method
# Response: {project: {id: "pv-method", root_dir: "/home/user/Repositories/pv-method", ...}}
```

**Phase 2 (Genesis & Resource Sharing)**

**Day 3: Copy Methodology (Phase 2 UI)**
```
Human: "Copy P1-EXEC methodology from pv-method to oss-glyphjs"
Bridge UI: Copy modal → select source, target, confirm
→ Copies .method/manifest.yaml reference
→ oss-glyphjs now has access to P1-EXEC
→ Event emitted: {type: "methodology_copied", project_id: "oss-glyphjs", ...}

Genesis (Phase 2): "Methodology copied. oss-glyphjs can now use P1-EXEC. Ready for next task."
```

**Day 4: Multi-Project Coordination (Phase 2)**
```
Human: "/commission Run tests across all projects"
Genesis: "Understood. Spawning 3 test sessions (one per project)."
→ 3 sessions run in parallel (pv-method, oss-glyphjs, oss-constellation-engine)
→ Events accumulated with project_id tagging

Genesis: "Tests complete. Results:
  - pv-method: 749 passing
  - oss-glyphjs: 203 passing
  - oss-constellation-engine: 156 passing

All green. Ready for next."
```

