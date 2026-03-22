# PRD 018 — Strategy Phase 2: Event Triggers

**Status:** Implemented (all 4 phases: 2a-1 through 2a-4)
**Date:** 2026-03-19
**Scope:** Phase 2a — Event trigger system for Strategy Pipelines
**Depends on:** PRD 017 (Strategy Pipelines Phase 1), PRD 010 (PTY Auto-Detection), PRD 008 (Agent Visibility)
**Evidence:** Council SESSION-038 (D-091 roadmap item #4), gov-proposal Section 7 (Continuous Governance), PRD 017 Section 6 (Phase 2 deferral), vision doc D-007
**Council memory:** `.method/council/memory/strategy-pipelines.yaml` (TOPIC-STRATEGY-PIPELINES)
**PRD 021 impact:** **Extended.** MethodTS's `EventBus<S>` emits 20 typed `RuntimeEvent<S>` variants that feed into `channel_event` triggers — enabling triggers that react to methodology lifecycle events (step_completed, gate_evaluated, methodology_suspended). Trigger context injection gets typed mapping. MethodTS becomes the richest event source for the trigger system.

---

## 1. Purpose and Problem Statement

### Strategy execution is manual-only

Phase 1 delivered a working Strategy executor with DAG scheduling, gate evaluation, retries, and retrospectives. But execution requires an explicit trigger — either a human calling `POST /strategies/execute` or an agent invoking the `strategy_execute` MCP tool. There is no way for a Strategy to run in response to project events: a commit landing, tests failing, a new PRD being filed, or a retrospective containing actionable signals. Every workflow that should be automatic still requires a human or agent to notice the event and manually start the pipeline.

### Continuous governance requires event-driven automation

The autonomous government design (Section 7) defines nine event trigger types (EVT-GIT-COMMIT, EVT-TEST-FAILURE, EVT-NEW-PRD, EVT-RETRO-SIGNAL, EVT-STALE-AGENDA, EVT-SECURITY, EVT-DRIFT-DETECTED, EVT-BRIDGE-INCIDENT, EVT-SESSION-COMPLETE) that must fire automatically and route to the correct governance committee or strategy pipeline. Without event triggers in the Strategy system, the government design cannot operate in 24/7 mode — it degrades to a manually-convened council.

### What this PRD delivers

An **event trigger system** that watches for project events, matches them to registered Strategy definitions, and invokes the existing Strategy executor (PRD 017) automatically. Strategies declare their triggers in YAML (extending the existing `triggers:` field). The bridge process hosts the trigger watchers. Trigger fires are debounced, logged, and visible in the dashboard. The system restores registered triggers on bridge restart by scanning Strategy YAML files in `.method/strategies/`.

**Architectural constraint (DR-03):** The trigger system lives entirely in `@method/bridge` at `packages/bridge/src/triggers/`. It does NOT touch `@method/core`. The strategy executor is invoked via HTTP, not direct import.

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
      debounce_strategy: leading            # leading = fire on first event, suppress for window
      max_concurrent: 1                     # Max concurrent executions from this trigger (default: 1)

    - type: file_watch                      # Phase 2 — NEW
      paths:
        - "docs/prds/*.md"
        - ".method/retros/*.yaml"
      events: [create]                      # create | modify | delete
      debounce_ms: 5000
      debounce_strategy: trailing           # trailing = wait for quiet period, then fire (default)
      max_batch_size: 10                    # Override default max batch (env: TRIGGERS_MAX_BATCH_SIZE)

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

**Security constraint — sandboxed expression evaluation:** All JavaScript expressions in trigger configurations (webhook `filter`, pty_watcher `condition`, channel_event `filter`) MUST be evaluated using the existing sandboxed expression evaluator from the gate framework (`evaluateGateExpression` in `packages/core/src/strategy/gates.ts`). Expressions run in a `new Function()` sandbox with frozen context, no access to `require`/`process`/`fs`/globals. This is a security requirement, not an implementation suggestion — webhook payloads are external untrusted input.

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
  max_concurrent: number;          // From YAML (default: 1) — skip fire if this many executions active
  active_executions: number;       // Currently running executions from this trigger
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
| `git_commit` | `fs.watch()` + `git log` validation (Windows/macOS); polling (Linux) | See platform strategy below |
| `file_watch` | `fs.watch()` (recursive) on configured paths | Filters by event type (create/modify/delete) |
| `schedule` | `setInterval` with cron-expression parser | Uses a minimal cron parser (no external dep) |
| `webhook` | Fastify route registered at the configured path | HMAC-SHA256 validation, optional JS filter |
| `pty_watcher` | Hooks into existing PTY watcher observation callback | Reuses PRD 010 infrastructure (see integration note below) |
| `channel_event` | Subscribes to bridge channel event feed | Filters by event type and optional JS expression |

**Git commit detection — platform strategy:**

- `fs.watch()` on `.git/refs/heads/` is a **notification hint only** — on every watch event, validate by running `git log --oneline -1 HEAD` and comparing against a cached last-seen SHA. Only fire if the SHA actually changed.
- Modern Git with `packed-refs` may not update individual ref files — `.git/packed-refs` changes instead. The watcher must monitor both locations.
- On Linux, recursive `fs.watch()` is not supported (inotify limitation) — **polling is the primary mechanism**. Default to polling on Linux (`TRIGGERS_GIT_POLL_INTERVAL_MS`), `fs.watch()` + validation on Windows/macOS.
- Platform detection at startup: `process.platform === 'linux'` selects the polling path; `'win32'` and `'darwin'` use `fs.watch()` with poll fallback.

**PTY watcher integration architecture:** The pool's existing `diagnosticsCallback` (`pool.ts`) will forward observations to a global callback registry managed by the TriggerRouter. The `createPtyWatcher` interface remains unchanged — the pool adds a second subscriber by wrapping its callback to also invoke `TriggerRouter.onObservation()`. This avoids modifying the watcher interface while enabling multi-subscriber observation.

**Channel event push mechanism:** The TriggerRouter registers an `onMessage` hook on the channel system's `appendMessage()` function. This is a small addition to `channels.ts` — an optional callback invoked on every channel message append. The TriggerRouter filters by `event_type` to match registered `channel_event` triggers. This avoids polling and provides near-instant trigger response.

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

**Debounce strategies:**

- **`trailing`** (default for `file_watch`, `pty_watcher`, `channel_event`): After the first event arrives, the engine waits for `debounce_ms` of silence before firing. Best for batching rapid changes (e.g., a multi-file save).
- **`leading`** (default for `git_commit`): Fire immediately on the first event, then suppress further events for the `debounce_ms` window. Best for events where the first occurrence is most informative (e.g., a commit landing).

The `debounce_strategy` field is optional in trigger YAML — each trigger type has a sensible default. Override explicitly when the default doesn't match your use case.

**Default behavior:** 5000ms window. If events keep arriving past the window, the `max_batch_size` (default: 10) forces a fire to prevent indefinite accumulation.

**Concurrency control:** Each trigger supports an optional `max_concurrent` field (default: `1`). If a trigger fires while `max_concurrent` executions from that trigger are already running, the fire is skipped and logged. This prevents a slow strategy from accumulating unbounded parallel runs from rapid trigger events.

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

**Authentication model:** Trigger management endpoints follow the existing bridge auth model: no authentication, localhost access assumed. The `/shutdown` endpoint (PR #33) set the precedent with a localhost-only IP check. If PRD 011 remote access is implemented, trigger management endpoints should inherit the same auth mechanism. Webhook trigger endpoints use HMAC-SHA256 validation for external payloads — these are the only trigger endpoints exposed to untrusted input.

**Webhook routes:** Each webhook trigger registers a dynamic Fastify route at its configured path (e.g., `POST /triggers/webhook/S-CODE-REVIEW`). These routes are created/removed as strategies are registered/unregistered.

### Component 7: MCP Tools for Trigger Management

Six new MCP tools (thin wrappers per DR-04) proxying to the bridge trigger endpoints. Each tool maps to exactly one bridge endpoint — no compound `action` parameter.

```typescript
// tool: trigger_list
// Lists all registered triggers with status and stats.
{
  strategy_id?: string;  // Optional filter by strategy
}

// tool: trigger_enable
// Enable a specific trigger.
{
  trigger_id: string;    // Required — trigger ID to enable
}

// tool: trigger_disable
// Disable a specific trigger without unregistering.
{
  trigger_id: string;    // Required — trigger ID to disable
}

// tool: trigger_pause_all
// Pause all triggers (maintenance mode). No parameters.
{}

// tool: trigger_resume_all
// Resume all triggers after maintenance. No parameters.
{}

// tool: trigger_reload
// Hot-reload strategy registrations from .method/strategies/. No parameters.
{}
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

**Startup error isolation:** Scanning uses per-file error isolation: malformed strategy YAML, invalid cron expressions, or unresolvable watch paths are logged as warnings and skipped. The bridge starts successfully even if some strategies fail to register. `GET /triggers` response includes a `registration_errors` array showing which strategies failed and why.

**On bridge restart:** All triggers are automatically re-registered. No state is lost because the Strategy YAML files are the persistent store. Trigger stats (fire counts, etc.) are reset on restart — this is acceptable because the retrospective system (PRD 017 Component 7) captures execution history permanently.

**Hot reload:** `POST /triggers/reload` re-scans the strategies directory and performs full reconciliation: register new strategies, update changed strategies (via file content comparison), and **unregister strategies whose files were deleted**. If a strategy YAML no longer exists, all its triggers are stopped and deregistered. This allows updating triggers without restarting the bridge.

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
- `trigger_list`, `trigger_enable`, `trigger_disable`, `trigger_pause_all`, `trigger_resume_all`, `trigger_reload` MCP tools
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

### Testing Architecture (all phases)

Testing event-driven systems requires deterministic control over time and the filesystem. The following conventions apply across all phases:

- **Injectable timer interface:** The debounce engine accepts a timer abstraction (`{ setTimeout, clearTimeout, now }`) instead of using real `setTimeout` directly. Tests inject a mock clock for deterministic debounce testing without real delays.
- **Test fixture strategies:** A test fixture strategy YAML with event triggers lives in `.method/strategies/` (e.g., `smoke-test.yaml`). Integration tests use this fixture to verify end-to-end trigger registration and firing.
- **File watch CI guidance:** Use temp directories created with `fs.mkdtempSync`, write files with explicit `fs.writeFileSync`, and use short debounce windows (100-200ms) for `file_watch` trigger tests. Clean up temp directories after each test.
- **Mock clock for schedule triggers:** Cron-based triggers use the injectable timer interface. Tests advance the mock clock to verify fire timing without waiting real minutes.
- **Git trigger tests:** Use a temp git repo (`git init` in a temp directory), make real commits, and verify the watcher detects them.

---

## 4. Success Criteria

1. **File watch triggers work:** Creating a new `.md` file in `docs/prds/` causes a strategy with a `file_watch` trigger on that path to execute automatically within 10 seconds.

2. **Git commit triggers work:** A commit to `master` causes a strategy with a `git_commit` trigger to execute. Rapid commits (10 in 5 seconds) produce a single debounced trigger fire.

3. **Schedule triggers work:** A strategy with `cron: "* * * * *"` (every minute) fires within 90 seconds of registration (60s cron interval + 30s tolerance for startup and scheduling jitter). Fires are visible in the dashboard.

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
| `TRIGGERS_MAX_BATCH_SIZE` | `10` | Max events per debounce batch before forced fire |
| `TRIGGERS_HISTORY_SIZE` | `200` | Max trigger fire events retained in memory |
| `TRIGGERS_GIT_POLL_INTERVAL_MS` | `5000` | Fallback polling interval for git commit detection |
| `TRIGGERS_FILE_WATCH_RECURSIVE` | `true` | Enable recursive file watching |
| `TRIGGERS_WEBHOOK_MAX_PAYLOAD_BYTES` | `1048576` | Max webhook payload size (1 MB) |
| `TRIGGERS_MAX_WATCHERS` | `50` | Max total active file/git watchers (prevents inotify exhaustion) |
| `TRIGGERS_LOG_FIRES` | `true` | Log trigger fires to stdout |

**Tuning guidance:** All variables have sensible defaults. In practice, only 3-4 need tuning for specific environments: `TRIGGERS_DEFAULT_DEBOUNCE_MS` (if default debounce is too aggressive), `TRIGGERS_GIT_POLL_INTERVAL_MS` (for repos with very high commit frequency), `TRIGGERS_MAX_WATCHERS` (for Linux systems with low inotify limits), and `TRIGGERS_WEBHOOK_MAX_PAYLOAD_BYTES` (if receiving large webhook payloads). The rest can be left at defaults.

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
- **Session lifecycle triggers** — triggering on session spawned/killed events. The `channel_event` trigger type already covers `completed` and `error` events, which are the actionable lifecycle signals. Raw spawn/kill events are infrastructure noise — if needed, they can be added as new event types in the channel system and matched by `channel_event` triggers without new trigger types.
- **MCP tool triggers** — triggering strategies from MCP tool invocations beyond `strategy_execute`. The existing `mcp_tool` trigger type (Phase 1) covers the primary use case. A general "fire trigger from any MCP call" mechanism would require MCP middleware hooks and blurs the line between explicit invocation and event-driven automation. Defer until a concrete use case emerges.

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
| **File descriptor / inotify exhaustion** — too many active watchers consume OS-level resources | MEDIUM | HIGH | `TRIGGERS_MAX_WATCHERS` config (default: 50) caps total active watchers. Log total active watcher count at startup. Refuse registration over the limit with a clear error. On Linux, document `sysctl fs.inotify.max_user_watches` tuning for environments with many watched paths. |

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

Per the DR-03 constraint stated in Section 1, the trigger system lives entirely in `@method/bridge`. The trigger watcher implementations depend on Node.js APIs (`fs.watch`, `child_process`, `setInterval`) and Fastify (webhooks), all of which are bridge-layer concerns.

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
| EVT-DRIFT-DETECTED | `schedule` (periodic audit) | Drift detection strategy (invokes M4-DDAG) |
| EVT-BRIDGE-INCIDENT | `channel_event` (error events) | Operations emergency strategy |
| EVT-SESSION-COMPLETE | `channel_event` (completed events) | Session review strategy |

The government design specifies *what* should happen. This PRD specifies *how* the trigger infrastructure detects events and routes them to strategy executions.
