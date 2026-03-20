# PRD 018 — Strategy Phase 2: Event Triggers

**Status:** Draft
**Date:** 2026-03-19
**Scope:** Phase 2a — Event trigger system for Strategy Pipelines
**Depends on:** PRD 017 (Strategy Pipelines Phase 1), PRD 010 (PTY Auto-Detection), PRD 008 (Agent Visibility)
**Evidence:** Council SESSION-038 (D-091 roadmap item #4), gov-proposal Section 7 (Continuous Governance), PRD 017 Section 6 (Phase 2 deferral), vision doc D-007
**Council memory:** `.method/council/memory/strategy-pipelines.yaml` (TOPIC-STRATEGY-PIPELINES)

---

## 1. Purpose and Problem Statement

### Strategy execution is manual-only

Phase 1 delivered a working Strategy executor with DAG scheduling, gate evaluation, retries, and retrospectives. But execution requires an explicit trigger — either a human calling `POST /strategies/execute` or an agent invoking the `strategy_execute` MCP tool. There is no way for a Strategy to run in response to project events: a commit landing, tests failing, a new PRD being filed, or a retrospective containing actionable signals. Every workflow that should be automatic still requires a human or agent to notice the event and manually start the pipeline.

### Continuous governance requires event-driven automation

The autonomous government design (Section 7) defines nine event trigger types (EVT-GIT-COMMIT, EVT-TEST-FAILURE, EVT-NEW-PRD, EVT-RETRO-SIGNAL, EVT-STALE-AGENDA, EVT-SECURITY, EVT-DRIFT-DETECTED, EVT-BRIDGE-INCIDENT, EVT-SESSION-COMPLETE) that must fire automatically and route to the correct governance committee or strategy pipeline. Without event triggers in the Strategy system, the government design cannot operate in 24/7 mode — it degrades to a manually-convened council.

### What this PRD delivers

An **event trigger system** that watches for project events, matches them to registered Strategy definitions, and invokes the existing Strategy executor (PRD 017) automatically. Strategies declare their triggers in YAML (extending the existing `triggers:` field). The bridge process hosts the trigger watchers. Trigger fires are debounced, logged, and visible in the dashboard. The system restores registered triggers on bridge restart by scanning Strategy YAML files in `.method/strategies/`.

---

## 2. Components

### Component 1: Trigger YAML Schema Extension

Extends the existing Strategy YAML `triggers:` array with structured trigger definitions. Phase 1 triggers (`manual`, `mcp_tool`) continue to work unchanged.

```yaml
strategy:
  id: S-CODE-REVIEW
  name: "Commit Code Review"
  version: "1.0"

  triggers:
    - type: manual                          # Phase 1 — unchanged
    - type: mcp_tool                        # Phase 1 — unchanged
      tool: strategy_execute

    - type: git_commit                      # Phase 2 — NEW
      branch_pattern: "master"              # Glob pattern for branch names
      path_pattern: "packages/**"           # Optional: only fire for commits touching these paths
      debounce_ms: 10000                    # Collapse rapid commits into one fire

    - type: file_watch                      # Phase 2 — NEW
      paths:
        - "docs/prds/*.md"
        - ".method/retros/*.yaml"
      events: [create]                      # create | modify | delete
      debounce_ms: 5000

    - type: schedule                        # Phase 2 — NEW
      cron: "0 */6 * * *"                   # Standard cron expression (every 6 hours)

    - type: webhook                         # Phase 2 — NEW
      path: "/triggers/webhook/S-CODE-REVIEW"  # Unique webhook URL path
      secret_env: "WEBHOOK_SECRET_CODE_REVIEW" # Env var containing HMAC secret
      filter: "payload.action === 'completed'" # Optional JS expression filter

    - type: pty_watcher                     # Phase 2 — NEW
      pattern: "test_result"                # ObservationCategory from PRD 010
      condition: "detail.failed > 0"        # JS expression over PatternMatch detail
      debounce_ms: 15000

    - type: channel_event                   # Phase 2 — NEW
      event_types: [completed, error, escalation]  # Bridge channel event types
      filter: "event.session_metadata?.strategy_id !== undefined"

  context:
    inputs:
      - { name: trigger_event, type: object }  # Trigger context auto-injected
      - { name: commit_sha, type: string, default: "" }
```

**Backward compatibility:** The parser accepts both the Phase 1 shorthand (`{ type: manual }`) and the Phase 2 extended form. Strategies without event triggers are unaffected.

### Component 2: TriggerRouter

Central coordinator that manages all active trigger watchers and routes events to strategy executions.

```typescript
interface TriggerEvent {
  trigger_type: TriggerType;
  strategy_id: string;
  trigger_id: string;               // Unique: "{strategy_id}:{trigger_type}:{index}"
  timestamp: string;
  payload: Record<string, unknown>; // Event-specific data
  debounced_count: number;          // How many raw events were collapsed
}

type TriggerType =
  | 'manual'
  | 'mcp_tool'
  | 'git_commit'
  | 'file_watch'
  | 'schedule'
  | 'webhook'
  | 'pty_watcher'
  | 'channel_event';

interface TriggerRegistration {
  trigger_id: string;
  strategy_id: string;
  strategy_path: string;           // Path to Strategy YAML (for reload)
  trigger_config: TriggerConfig;   // Parsed from YAML
  enabled: boolean;
  watcher: TriggerWatcher | null;  // Active watcher instance
  stats: TriggerStats;
}

interface TriggerStats {
  total_fires: number;
  last_fired_at: string | null;
  last_execution_id: string | null;
  debounced_events: number;        // Total events collapsed by debouncing
  errors: number;
}

interface TriggerRouter {
  /** Register all triggers from a Strategy YAML file */
  registerStrategy(strategyPath: string): Promise<TriggerRegistration[]>;

  /** Unregister all triggers for a strategy */
  unregisterStrategy(strategyId: string): void;

  /** Enable/disable a specific trigger without unregistering */
  setTriggerEnabled(triggerId: string, enabled: boolean): void;

  /** Pause all triggers (e.g., during maintenance) */
  pauseAll(): void;

  /** Resume all triggers */
  resumeAll(): void;

  /** Get status of all registered triggers */
  getStatus(): TriggerRegistration[];

  /** Get fire history */
  getHistory(limit?: number): TriggerEvent[];

  /** Shutdown: stop all watchers, clear state */
  shutdown(): Promise<void>;
}
```

**Lifecycle:** The TriggerRouter is created when the bridge starts, scans `.method/strategies/` for Strategy YAML files, and registers all event triggers found. On bridge shutdown, all watchers are stopped cleanly.

### Component 3: TriggerWatcher Interface and Implementations

Each trigger type has a concrete watcher implementation. All watchers share a common interface.

```typescript
interface TriggerWatcher {
  readonly type: TriggerType;
  readonly active: boolean;

  /** Start watching. Calls onFire when the trigger condition is met. */
  start(onFire: (payload: Record<string, unknown>) => void): void;

  /** Stop watching. Releases resources. */
  stop(): void;
}
```

**Watcher implementations:**

| Type | Mechanism | Notes |
|------|-----------|-------|
| `git_commit` | `fs.watch()` on `.git/refs/heads/` + `git log --oneline -1` | Polls on watch event, extracts commit metadata |
| `file_watch` | `fs.watch()` (recursive) on configured paths | Filters by event type (create/modify/delete) |
| `schedule` | `setInterval` with cron-expression parser | Uses a minimal cron parser (no external dep) |
| `webhook` | Fastify route registered at the configured path | HMAC-SHA256 validation, optional JS filter |
| `pty_watcher` | Hooks into existing PTY watcher observation callback | Reuses PRD 010 infrastructure |
| `channel_event` | Subscribes to bridge channel event feed | Filters by event type and optional JS expression |

### Component 4: Debounce Engine

Trigger events, especially from git commits and file watchers, can fire in rapid bursts. The debounce engine collapses multiple raw events into a single trigger fire.

```typescript
interface DebounceConfig {
  window_ms: number;                // From trigger YAML (debounce_ms)
  max_batch_size: number;           // Hard cap: fire even if window hasn't elapsed
  strategy: 'trailing' | 'leading'; // trailing = fire after quiet period (default)
}

interface DebouncedTriggerFire {
  events: Array<{                   // All raw events in the batch
    timestamp: string;
    payload: Record<string, unknown>;
  }>;
  first_event_at: string;
  last_event_at: string;
  count: number;
}
```

**Default behavior:** Trailing-edge debounce with a 5000ms window. After the first event arrives, the engine waits for `debounce_ms` of silence before firing. If events keep arriving, the `max_batch_size` (default: 50) forces a fire to prevent indefinite accumulation.

**Context merging:** For git_commit triggers, the debounced payload includes all commit SHAs in the batch. For file_watch triggers, it includes all changed paths. The Strategy receives the merged context as `trigger_event` in its context inputs.

### Component 5: Trigger Context Injection

When a trigger fires, the event payload is injected into the Strategy's context inputs as `trigger_event`. This provides the Strategy's DAG nodes with information about what triggered the execution.

```typescript
interface TriggerContext {
  trigger_type: TriggerType;
  trigger_id: string;
  fired_at: string;
  debounced_count: number;

  // Type-specific fields:
  // git_commit:
  commits?: Array<{ sha: string; message: string; author: string; branch: string }>;

  // file_watch:
  changed_files?: Array<{ path: string; event: 'create' | 'modify' | 'delete' }>;

  // schedule:
  scheduled_at?: string;
  cron_expression?: string;

  // webhook:
  webhook_payload?: Record<string, unknown>;
  webhook_headers?: Record<string, string>;

  // pty_watcher:
  observation?: { category: string; detail: Record<string, unknown>; session_id: string };

  // channel_event:
  channel_event?: { type: string; session_id: string; data: Record<string, unknown> };
}
```

**Injection point:** The TriggerRouter calls `POST /strategies/execute` (the existing Phase 1 endpoint) with `context_inputs: { trigger_event: triggerContext, ...defaults }`. This means trigger-invoked executions use the exact same code path as manual executions — no special handling in the executor.

### Component 6: HTTP API for Trigger Management

New REST endpoints on the bridge for managing triggers.

| Endpoint | Method | Description |
|----------|--------|-------------|
| `GET /triggers` | GET | List all registered triggers with status and stats |
| `GET /triggers/:id` | GET | Get specific trigger details and fire history |
| `POST /triggers/:id/enable` | POST | Enable a disabled trigger |
| `POST /triggers/:id/disable` | POST | Disable a trigger without unregistering |
| `POST /triggers/pause` | POST | Pause all triggers (maintenance mode) |
| `POST /triggers/resume` | POST | Resume all triggers |
| `POST /triggers/reload` | POST | Re-scan `.method/strategies/` and update registrations |
| `GET /triggers/history` | GET | Global trigger fire history (last N fires) |

**Webhook routes:** Each webhook trigger registers a dynamic Fastify route at its configured path (e.g., `POST /triggers/webhook/S-CODE-REVIEW`). These routes are created/removed as strategies are registered/unregistered.

### Component 7: MCP Tools for Trigger Management

Two new MCP tools (thin wrappers per DR-04) proxying to the bridge trigger endpoints.

```typescript
// tool: trigger_list
// Lists all registered triggers with status and stats.
{
  // No required parameters
  strategy_id?: string;  // Optional filter by strategy
}

// tool: trigger_control
// Enable, disable, pause, or resume triggers.
{
  action: 'enable' | 'disable' | 'pause_all' | 'resume_all' | 'reload';
  trigger_id?: string;   // Required for enable/disable
}
```

### Component 8: Dashboard Integration

The bridge dashboard (`GET /dashboard`) gains a new panel showing trigger status.

**Trigger panel contents:**
- Table of registered triggers: strategy ID, trigger type, enabled/disabled, last fired, total fires, error count
- Color-coded status: green (active, no recent errors), yellow (active, recent error), gray (disabled), red (paused)
- Fire history timeline: last 20 trigger fires with timestamp, strategy, debounce count
- Maintenance mode indicator: prominent banner when triggers are paused

**Event feed integration:** Trigger fires appear as events in the existing aggregated event feed (`GET /channels/events`) with event type `trigger_fired`. This provides visibility through the existing channel infrastructure (PRD 008).

### Component 9: Persistence via Strategy File Scanning

Triggers are not stored in a separate database. The source of truth is the Strategy YAML files in `.method/strategies/`. On bridge startup, the TriggerRouter:

1. Scans `.method/strategies/*.yaml` for all Strategy files
2. Parses each file and extracts trigger definitions
3. Registers watchers for all event triggers (skipping `manual` and `mcp_tool`)
4. Logs which triggers were restored

**On bridge restart:** All triggers are automatically re-registered. No state is lost because the Strategy YAML files are the persistent store. Trigger stats (fire counts, etc.) are reset on restart — this is acceptable because the retrospective system (PRD 017 Component 7) captures execution history permanently.

**Hot reload:** `POST /triggers/reload` re-scans the strategies directory. Added, modified, or removed strategies are detected via file content comparison. Changed strategies are unregistered and re-registered. This allows updating triggers without restarting the bridge.

---

## 3. Implementation Order

### Phase 2a-1: TriggerRouter Core + File Watch + Git Commit (Foundation)

**Deliverables:**
- `TriggerRouter` implementation in `packages/bridge/src/triggers/`
- `TriggerWatcher` interface and base debounce engine
- `FileWatchTrigger` watcher (covers `file_watch` and the `new_prd` / `retro_signal` use cases)
- `GitCommitTrigger` watcher
- Strategy YAML parser extension for Phase 2 trigger definitions
- Startup scanning of `.method/strategies/`
- Unit tests: debounce logic, file watch detection, git commit detection, trigger registration/unregistration
- Integration test: file creation in `docs/prds/` triggers a strategy execution

**Why first:** File watching and git commit detection are the two trigger types that enable the most governance use cases (EVT-GIT-COMMIT, EVT-NEW-PRD, EVT-RETRO-SIGNAL). The debounce engine is shared infrastructure needed by all subsequent watchers.

### Phase 2a-2: Schedule + PTY Watcher Integration

**Deliverables:**
- `ScheduleTrigger` watcher with cron expression parser
- `PtyWatcherTrigger` that hooks into existing PRD 010 observation callbacks
- `ChannelEventTrigger` that subscribes to bridge event feed
- Unit tests: cron parsing, PTY observation filtering, channel event matching

**Why second:** These three watchers complete the "internal event" category — events originating within the bridge process itself. The PTY watcher integration is architecturally interesting because it bridges PRD 010's per-session observations to the trigger system.

### Phase 2a-3: Webhook + HTTP API + MCP Tools

**Deliverables:**
- `WebhookTrigger` with HMAC validation and JS filter expressions
- All trigger management HTTP endpoints
- `trigger_list` and `trigger_control` MCP tools
- Hot reload endpoint (`POST /triggers/reload`)
- Integration test: GitHub webhook payload triggers a strategy

**Why third:** Webhooks require the HTTP server to be configured, which means the route registration must integrate with Fastify's lifecycle. The management API depends on the TriggerRouter being complete.

### Phase 2a-4: Dashboard + Observability + Hardening

**Deliverables:**
- Dashboard trigger panel (status table, fire history timeline, maintenance banner)
- `trigger_fired` events in the channel event feed
- Error handling: watcher crash recovery, malformed event resilience
- Performance test: 100 rapid git commits produce exactly 1 debounced trigger fire
- Documentation: update `docs/guides/` for trigger configuration

**Why last:** The observability layer builds on top of all the trigger infrastructure. Dashboard integration requires all trigger types to be operational so the panel can display meaningful data.

---

## 4. Success Criteria

1. **File watch triggers work:** Creating a new `.md` file in `docs/prds/` causes a strategy with a `file_watch` trigger on that path to execute automatically within 10 seconds.

2. **Git commit triggers work:** A commit to `master` causes a strategy with a `git_commit` trigger to execute. Rapid commits (10 in 5 seconds) produce a single debounced trigger fire.

3. **Schedule triggers work:** A strategy with `cron: "* * * * *"` (every minute) fires within 60 seconds of registration. Fires are visible in the dashboard.

4. **Webhook triggers work:** An HTTP POST to a registered webhook path with a valid HMAC signature triggers a strategy execution. Invalid signatures are rejected with 401.

5. **PTY watcher integration works:** A test failure detected by the PTY watcher (PRD 010) fires a strategy with a `pty_watcher` trigger configured for `test_result` with `detail.failed > 0`.

6. **Trigger context is injected:** Strategy DAG nodes receive the `trigger_event` context input with correct type-specific fields (commit SHAs, changed files, cron timestamp, etc.).

7. **Persistence across restarts:** After bridge restart, all triggers from `.method/strategies/*.yaml` are re-registered and fire correctly.

8. **Debouncing prevents flood:** 100 file changes within 1 second produce at most ceil(100 / max_batch_size) trigger fires, not 100.

9. **Dashboard visibility:** The trigger panel shows all registered triggers, their status, and recent fire history. Trigger fires appear in the aggregated event feed.

10. **No regression:** Existing manual and MCP-tool triggers continue to work. The Strategy executor (PRD 017) is not modified — triggers invoke it through the existing `POST /strategies/execute` endpoint.

---

## 5. Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `TRIGGERS_ENABLED` | `true` | Master switch for the trigger system |
| `TRIGGERS_STRATEGY_DIR` | `.method/strategies` | Directory to scan for Strategy YAML files |
| `TRIGGERS_SCAN_ON_STARTUP` | `true` | Auto-register triggers from strategy files on bridge start |
| `TRIGGERS_DEFAULT_DEBOUNCE_MS` | `5000` | Default debounce window when not specified in YAML |
| `TRIGGERS_MAX_BATCH_SIZE` | `50` | Max events per debounce batch before forced fire |
| `TRIGGERS_HISTORY_SIZE` | `200` | Max trigger fire events retained in memory |
| `TRIGGERS_GIT_POLL_INTERVAL_MS` | `5000` | Fallback polling interval for git commit detection |
| `TRIGGERS_FILE_WATCH_RECURSIVE` | `true` | Enable recursive file watching |
| `TRIGGERS_WEBHOOK_MAX_PAYLOAD_BYTES` | `1048576` | Max webhook payload size (1 MB) |
| `TRIGGERS_LOG_FIRES` | `true` | Log trigger fires to stdout |

---

## 6. Out of Scope (Phase 2a)

All items below are documented for future phases.

- **Trigger chaining** — one trigger fire's output feeds another trigger's condition. Requires a trigger dependency graph, which adds complexity without current use cases.
- **Trigger templates** — reusable trigger definitions shared across strategies. Current YAML copy is acceptable for < 20 strategies.
- **Distributed trigger coordination** — multiple bridge instances deduplicating the same trigger. Single-bridge deployment assumed.
- **Trigger-level cost budgets** — capping total cost of trigger-invoked executions per time window. Oversight rules in the Strategy handle this per-execution.
- **External event bus integration** — connecting to Kafka, RabbitMQ, or cloud pub/sub. Webhook triggers cover external integration for now.
- **LLM-evaluated trigger conditions** — having an LLM decide whether a trigger should fire based on event content. JS filter expressions handle simple conditions; complex evaluation belongs in the Strategy's DAG nodes.
- **Trigger priority and queuing** — ordering trigger-invoked executions by priority when the executor is at capacity. First-come-first-served with the existing `STRATEGY_MAX_PARALLEL` limit.

---

## 7. Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| **Trigger storm** — a bug in file watching fires thousands of events | MEDIUM | HIGH | Debounce engine with max_batch_size hard cap. `TRIGGERS_ENABLED` master switch for emergency shutdown. Rate limit: max 1 strategy execution per trigger per debounce window. |
| **`fs.watch()` platform inconsistency** — Node.js file watching behaves differently on Windows (ReadDirectoryChangesW), macOS (FSEvents), and Linux (inotify) | HIGH | MEDIUM | Use `fs.watch()` (not deprecated `fs.watchFile()`) with recursive option. Accept platform quirks and document them. Fallback polling for git commit detection. |
| **Webhook secret leaks** — HMAC secrets stored in env vars could be exposed | LOW | HIGH | Secrets referenced by env var name in YAML, never inlined. Webhook validation rejects requests with missing or invalid signatures. Timing-safe comparison for HMAC. |
| **Bridge restart during trigger fire** — a trigger fires while the bridge is shutting down | MEDIUM | LOW | TriggerRouter.shutdown() stops all watchers before the HTTP server closes. In-flight `POST /strategies/execute` calls complete normally (Fastify graceful shutdown). Missed fires are acceptable — the next event will re-trigger. |
| **Cron drift** — setInterval-based scheduling drifts over days | LOW | LOW | Acceptable for governance use cases (6-hour intervals). Document that cron triggers are approximate, not precise. Use `Date.now()` comparison instead of pure interval counting. |
| **Git ref race condition** — reading `.git/refs/heads/` while git is writing | LOW | LOW | `git log` command is atomic — it reads the object store, not ref files directly. The file watch on `.git/refs/` is just the notification mechanism; the actual data is read via `git log`. |
| **Recursive file watch resource exhaustion** — watching too many directories | MEDIUM | MEDIUM | `TRIGGERS_FILE_WATCH_RECURSIVE` config to disable. Strategy YAML `paths` should be specific (e.g., `docs/prds/*.md` not `**/*`). Log warning if a watcher covers > 1000 files. |

---

## 8. Relationship to Existing PRDs

| PRD | Relationship |
|-----|-------------|
| **PRD 017** (Strategy Pipelines Phase 1) | Event triggers invoke the existing Strategy executor through `POST /strategies/execute`. The executor is not modified. Trigger context is passed via `context_inputs`. |
| **PRD 010** (PTY Auto-Detection) | The `pty_watcher` trigger type hooks into PRD 010's `ObservationCallback` to receive structured observations. PTY watcher remains unchanged — triggers subscribe to its output. |
| **PRD 008** (Agent Visibility) | Trigger fires emit events to bridge channels as `trigger_fired` events. Visible in aggregated event feed and dashboard. |
| **PRD 005** (Bridge) | TriggerRouter lives in the bridge process. Webhook triggers register Fastify routes. Startup scanning integrates with bridge initialization. |
| **PRD 011** (Remote Bridge) | Triggers work with remote bridge access — webhook URLs are reachable from external systems. Trigger management endpoints follow the same auth model as bridge session endpoints. |
| **PRD 014** (Scope Enforcement) | Trigger-invoked strategy executions respect the same scope enforcement as manual executions. The trigger system does not bypass capability restrictions. |

### Architectural Note

The trigger system lives entirely in `@method/bridge` at `packages/bridge/src/triggers/`. It does NOT touch `@method/core` (DR-03 — no transport dependencies in core). The trigger watcher implementations depend on Node.js APIs (`fs.watch`, `child_process`, `setInterval`) and Fastify (webhooks), all of which are bridge-layer concerns.

The TriggerRouter is instantiated alongside the Strategy routes during bridge startup. It receives a reference to the Fastify app (for webhook route registration) and the bridge's channel system (for event emission). Strategy execution is invoked through the internal HTTP endpoint, maintaining a clean separation — the trigger system is a client of the strategy executor, not a part of it.

### Relationship to Autonomous Government Design

The government design (Section 7) defines event triggers at the governance level (EVT-GIT-COMMIT, EVT-TEST-FAILURE, etc.). This PRD provides the infrastructure layer that makes those triggers executable. The mapping is:

| Government Event | PRD 018 Trigger Type | Strategy |
|-----------------|---------------------|----------|
| EVT-GIT-COMMIT | `git_commit` | Code review strategy |
| EVT-TEST-FAILURE | `pty_watcher` (test_result pattern) | Quality emergency strategy |
| EVT-NEW-PRD | `file_watch` on `docs/prds/*.md` | Bill introduction strategy |
| EVT-RETRO-SIGNAL | `file_watch` on `.method/retros/*.yaml` | Signal review strategy |
| EVT-STALE-AGENDA | `schedule` (cron-based check) | PR-02 enforcement strategy |
| EVT-SECURITY | `pty_watcher` or `webhook` | Emergency session strategy |
| EVT-BRIDGE-INCIDENT | `channel_event` (error events) | Operations emergency strategy |
| EVT-SESSION-COMPLETE | `channel_event` (completed events) | Session review strategy |

The government design specifies *what* should happen. This PRD specifies *how* the trigger infrastructure detects events and routes them to strategy executions.
