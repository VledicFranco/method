# PRD 020: Multi-Project Bridge & Genesis Agent

**Status:** Draft
**Owner:** Steering Council (AG-064)
**Methodology:** P2-SD v2.0
**Target Release:** Phase 2 (after PRD 017 matures)
**Complexity:** High — architectural change to bridge, new persistent agent

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

**Note:** The bridge runs at ROOT_DIR. Each project below ROOT_DIR is auto-discovered. There is one bridge instance per ROOT_DIR, not one per project.

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

**Note:** Phase 1 provides the foundation (project registry, event API) that Phase 2 Genesis agent will consume. Genesis is deferred to avoid scope bloat in Phase 1.

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

**1. Multi-Project Discovery**
- Bridge starts with `--root-dir <path>` or `ROOT_DIR` env var (defaults to cwd)
- On startup, recursively scans for `.git/` directories
- Each git repo root becomes a project in the bridge's internal project registry
- Projects are indexed by relative path from root (e.g., `pv-method`, `oss-constellation-engine`)

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
- All events (from all projects) are accumulated at root level (`.method/genesis-events.yaml` or in-memory store)
- **Event schema:** Each event is tagged with `project_id` (relative path) for isolation filtering

  ```typescript
  interface ProjectEvent {
    type: string;                      // "completed", "error", "escalation", etc.
    project_id: string;                // relative path (e.g., "pv-method", "") for filtering
    timestamp: string;                 // ISO 8601
    content: Record<string, unknown>;  // event-specific data
  }
  ```

- Event log capped at 10K events; oldest events pruned on overflow (respects project_id isolation — does not preferentially delete events from one project)
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
1. Bridge starts in `ROOT_DIR`
2. Register ROOT_DIR as project ID "" (empty, or "root")
3. Create `.method/` in ROOT_DIR if missing
4. Recursively scan for `.git/` directories up to 3 levels deep
   - If `.git/` is corrupted/invalid, log warning and skip (do not crash)
   - If two repos resolve to same real path (symlink/alias), use first discovered, skip duplicate
   - Stop if discovery hits `MAX_PROJECTS` safety limit
5. For each found: register as project, create `.method/` if missing
6. Load project config from each `.method/project-config.yaml`
7. Initialize route handlers with project context

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

Bridge initializes this file automatically if missing. Schema:

```yaml
project_config:
  id: pv-method                                              # relative path from ROOT_DIR (auto-set by bridge)
  name: "pv-method"                                          # project display name
  description: "Runtime for formal methodologies"            # optional
  owner: "steering council"                                  # optional
  version: "1.0"                                             # metadata version
  dependencies: []                                           # other project IDs this depends on (Phase 2)
  shared_with: []                                            # projects that can import methodologies from here (Phase 2)
```

**Initialization behavior:**
- If `.method/project-config.yaml` missing: bridge creates it with auto-set `id` (relative path) and placeholder name
- If present: bridge loads and validates (id must match expected relative path)
- Per-project `.method/project-config.yaml` is committed to git; human edits `name`, `description`, `owner` as needed
- Root `.method/project-config.yaml` (at ROOT_DIR) is similar but `id` is "" or "root"

### 4.3 Genesis Agent Architecture

**Spawning:**
```
bridge startup → ProjectDiscovery complete
              → if GENESIS_ENABLED: spawn_session(
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
- Input: human prompts via `bridge_prompt` + accumulated events
- Output: status reports via `bridge_event`

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

**Note on Session→Project Binding:** Every session created via bridge is bound to a specific project_id. Sessions are isolated per project:
- `POST /sessions` with `project_id` parameter binds session to that project
- Sessions for project A cannot access method definitions, configurations, or events from project B
- The `project_id` is embedded in session metadata and enforced at the bridge level

**Event Queries (Phase 1 basic, Phase 2 advanced):**
```
GET /projects/:id/events
  → { events: [ { type, project_id, timestamp, ... } ] }
  → Returns events for project_id only (not cross-project)

GET /events  (aggregated, Phase 2 with Genesis)
  → { events: [ { type, project_id, timestamp, ... } ] }
  → Returns all events (Genesis will filter by project_id as needed)
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

### Phase 1: Multi-Project Discovery & Configuration

**Deliverables:**
- ProjectDiscovery service (recursive .git scan with error handling)
- ProjectRegistry (in-memory)
- project-config.yaml schema & creation
- Root `.method/` directory creation
- Event aggregation with project_id tagging
- API endpoints: GET /projects, GET /projects/:id, POST /projects/rescan, GET /projects/:id/events
- Unit tests for discovery & project metadata
- **Cross-project isolation tests:** verify sessions/events for project A don't leak to project B
- Performance testing: startup < 2s, discovery < 500ms, event queries < 100ms

**Files:**
- `packages/bridge/src/project-discovery.ts` (new)
- `packages/bridge/src/project-registry.ts` (new)
- `packages/bridge/src/project-routes.ts` (new)
- `packages/bridge/src/event-aggregation.ts` (new) — event schema with project_id
- Schema: `.method/project-config.yaml` (document)
- Test file: `packages/bridge/src/__tests__/project-isolation.test.ts` (new)

### Phase 2: Genesis Agent Foundation & Resource Sharing

**Deliverables:**
- Genesis spawning & session management (depends on mature event API from Phase 1)
- Genesis MCP tools (project_list, project_get, project_read_events, etc.)
- Genesis initialization prompt
- Genesis polling loop
- API endpoints: GET /genesis/status, POST /genesis/prompt, GET /genesis/events
- Budget enforcement for persistent Genesis sessions
- resource_copy_methodology and resource_copy_strategy MCP tools
- UI copy modal for methodology sharing

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
- On file-level conflicts (e.g., root says ignore `.method/`, per-project says keep it): **per-project wins**
- In practice: root ignores `.method/genesis-*` files; per-project `.method/` directories are committed (each project's `.method/project-config.yaml` is versioned)

---

## 8. Success Criteria

### Functional Criteria (Phase 1)
- ✅ Bridge discovers all git repos in ROOT_DIR recursively (with error handling for corrupted repos)
- ✅ Each project has `.method/` auto-created if missing
- ✅ Bridge API returns project list with metadata
- ✅ Project isolation: sessions/events for project A don't see project B's metadata
- ✅ Event log accumulates with project_id tagging (capped at 10K, pruned on overflow)

### Functional Criteria (Phase 2)
- ✅ Genesis agent spawns on startup (if enabled)
- ✅ Genesis reads events and reports status
- ✅ project_copy_methodology works (test: copy from pv-method to oss-glyphjs)
- ✅ resource_copy_strategy works

### Non-Functional Criteria (Phase 1)
- ✅ Bridge startup time < 2s (with up to 20 projects)
- ✅ Project discovery < 500ms (recursive scan of ROOT_DIR)
- ✅ Event log queries < 100ms (filtering by project_id)
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

