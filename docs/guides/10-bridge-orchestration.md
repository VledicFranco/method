---
guide: 10
title: "Bridge Orchestration"
domain: bridge
audience: [agent-operators]
summary: >-
  Using the bridge MCP proxy tools for multi-method sessions with sub-agents.
prereqs: [1, 2]
touches:
  - packages/bridge/src/
  - packages/mcp/src/
---

# Guide 10 — Bridge Orchestration: Multi-Method Sessions with Sub-Agents

How to use the bridge MCP proxy tools together with the runtime methodology tools (PRD 004) to orchestrate multi-method sessions where sub-agents execute methods autonomously.

## The Problem This Solves

Without the bridge, an orchestrator runs every method in its own context window. This works for simple sequences but fails for pv-agi's steering council pattern: a council debate (M1-COUNCIL) produces a decision, then a sub-agent executes the dispatched task (M3-TMP), then the council reviews the result. The orchestrator can't do all three without burning its context window on implementation details.

With the bridge MCP proxy tools + methodology tools, the orchestrator:
1. Uses MCP tools for methodology routing and session management
2. Uses MCP bridge proxy tools (`bridge_spawn`, `bridge_prompt`, `bridge_kill`, `bridge_list`) to spawn and manage sub-agents
3. Uses visibility channels (`bridge_progress`, `bridge_event`, `bridge_read_progress`, `bridge_read_events`) to monitor sub-agent work in real time
4. Records outputs via `step_validate`, which flow automatically to the next method via `priorMethodOutputs`

## Architecture

```
Orchestrator (human's Claude Code session)
    │
    ├── MCP methodology tools ──→ @method/mcp ──→ MethodologySource port ──→ StdlibSource
    │   methodology_start        (initialize session)        (@method/methodts stdlib)
    │   methodology_route         (evaluate delta_phi)
    │   methodology_load_method   (load method in session)
    │   step_context              (get step + prior method outputs)
    │   step_validate             (record outputs)
    │   step_advance              (advance steps)
    │   methodology_transition    (complete method, re-route)
    │
    └── MCP bridge proxy tools ──→ @method/mcp ──→ HTTP ──→ @method/bridge
        bridge_spawn              (spawn sub-agent)     → POST /sessions
        bridge_prompt             (send step prompt)    → POST /sessions/:id/prompt
        bridge_kill               (cleanup)             → DELETE /sessions/:id
        bridge_list               (monitor sessions)    → GET /sessions
        bridge_progress           (report progress)     → POST /sessions/:id/channels/progress
        bridge_event              (report events)       → POST /sessions/:id/channels/events
        bridge_read_progress      (read child progress) → GET /sessions/:id/channels/progress
        bridge_read_events        (read child events)   → GET /sessions/:id/channels/events
        bridge_all_events         (all session events)  → GET /channels/events
```

> **Deprecation note:** The previous diagram showed methodology tools flowing through
> `@method/core` (the legacy YAML loader). As of WS-1, methodology data access goes through
> the `MethodologySource` port backed by `StdlibSource` (wrapping `@method/methodts` stdlib).
> `@method/core` is deprecated for methodology loading. See `docs/arch/methodology-source.md`.

The MCP server exposes both methodology tools and bridge proxy tools. The orchestrator calls everything through MCP — methodology tools for intelligence, bridge proxy tools for agent labor. The proxy tools internally call the bridge HTTP API, so the orchestrator never needs to make raw HTTP requests.

The bridge itself remains methodology-unaware: it just spawns agents and relays prompts. The MCP proxy layer adds methodology awareness by auto-correlating session IDs (see Session ID Correlation below).

## Prerequisites

1. **Bridge server running:** `npm run bridge` (builds first, then launches via `scripts/start-bridge.js`)
   - Auto-loads OAuth token from `~/.claude/.credentials.json` for subscription usage meters
   - Shows plan type, rate limit tier, and token expiry on startup
   - Default port: 3456
2. **Dashboard:** Open `http://localhost:3456/dashboard` in a browser for live observability (see [Guide 14](14-bridge-dashboard-ui.md))
3. **MCP server configured:** `.mcp.json` in the project workdir so spawned agents connect to the method MCP server
4. **`BRIDGE_URL` env var:** The MCP server reads `BRIDGE_URL` (default `http://localhost:3456`) to know where to proxy bridge tool calls
5. **Claude Code available:** The `CLAUDE_BIN` environment variable (or `claude` on PATH) must point to the Claude Code binary

## Session ID Correlation

When you pass `session_id` to `bridge_spawn`, the MCP proxy automatically stores it as `metadata.methodology_session_id` in the bridge session. No manual mapping needed.

```
bridge_spawn({ workdir: "/path/to/project", session_id: "council-run-1" })
```

Internally, this sends `{ workdir: "...", metadata: { methodology_session_id: "council-run-1" } }` to the bridge. The correlation is visible in:
- `bridge_list()` — each session includes `methodology_session_id`
- The dashboard session table — "Method Session" column

This means the orchestrator does not need to maintain its own mapping between methodology session IDs and bridge session IDs. The bridge tracks it.

```
Methodology session "council-run-1"
  └── Bridge session "abc-123" (spawned for M1-COUNCIL execution)
  └── Bridge session "def-456" (spawned for M3-TMP execution)
```

## The Orchestration Loop

### Step 1: Start the methodology session

```
methodology_start({ methodology_id: "P1-EXEC", challenge: "Design the caching layer" })
→ { methodologySessionId: "...", status: "initialized", ... }
```

### Step 2: Evaluate routing

```
methodology_route({
  challenge_predicates: {
    adversarial_pressure_beneficial: true
  }
})
→ { selectedArm: { label: "adversarial_dispatch" }, selectedMethod: { id: "M1-COUNCIL" } }
```

The orchestrator evaluates the predicates based on the challenge context. The tool applies the priority stack and returns the recommended method.

### Step 3: Load the method

```
methodology_load_method({ method_id: "M1-COUNCIL" })
→ { method: { id: "M1-COUNCIL", stepCount: 5 }, priorMethodOutputs: [] }
```

### Step 4: Spawn a sub-agent via bridge proxy

```
bridge_spawn({
  workdir: "/path/to/project",
  spawn_args: ["--allowedTools", "mcp__method__*"],
  session_id: "council-run-1",
  nickname: "council",
  purpose: "Execute M1-COUNCIL debate for caching layer design"
})
→ {
    bridge_session_id: "abc-123",
    nickname: "council",
    status: "ready",
    message: "Agent 'council' spawned. Call bridge_prompt to send work."
  }
```

The `session_id` parameter auto-correlates this bridge session with the methodology session (see Session ID Correlation above). The `spawn_args` restrict the sub-agent to only methodology MCP tools. The `nickname` and `purpose` appear in the dashboard for human observability.

### Step 5: Execute the method steps via the sub-agent

For each step in the method, the orchestrator:

a. Gets the step context (includes prior method outputs):
```
step_context()
→ { step: { id: "sigma_1", guidance: "..." }, priorMethodOutputs: [...] }
```

b. Composes a prompt for the sub-agent using the step context and sends it via the bridge proxy:
```
bridge_prompt({
  bridge_session_id: "abc-123",
  prompt: "You are executing sigma_1 of M1-COUNCIL. <step context here>...",
  timeout_ms: 120000
})
→ { output: "...", timed_out: false, message: "Response received (2341 chars)" }
```

c. Records the sub-agent's output:
```
step_validate({ step_id: "sigma_1", output: { ... parsed from sub-agent response ... } })
→ { valid: true, recommendation: "advance" }
```

d. Advances to the next step:
```
step_advance()
```

e. Repeats until the method is complete (advance returns `nextStep: null`).

### Step 6: Complete the method and transition

Kill the bridge session, then transition:

```
bridge_kill({ bridge_session_id: "abc-123" })
→ { bridge_session_id: "abc-123", killed: true, message: "Session killed" }
```

```
methodology_transition({
  completion_summary: "Council decided to implement a two-tier LRU cache",
  challenge_predicates: {
    adversarial_pressure_beneficial: false,
    decomposable_before_execution: false
  }
})
→ { completedMethod: { id: "M1-COUNCIL" }, nextMethod: { id: "M3-TMP" } }
```

### Step 7: Load next method and repeat

```
methodology_load_method({ method_id: "M3-TMP" })
→ { priorMethodOutputs: [{ methodId: "M1-COUNCIL", stepOutputs: [...] }] }
```

The sub-agent for M3-TMP now has access to M1-COUNCIL's outputs via `step_context.priorMethodOutputs`. The orchestrator doesn't need to manually carry outputs between methods.

Spawn a new bridge session, execute M3-TMP steps, transition again. Repeat until `methodology_transition` returns `nextMethod: null`.

## Visibility Channels (PRD 008)

The bridge provides two communication channels per session — **progress** and **events** — so orchestrators can monitor sub-agent work without polling raw output.

### Progress channel

Sub-agents (or the PTY watcher — see below) report structured progress updates: step transitions, tool calls, status changes.

**Agent reports progress:**
```
bridge_progress({
  bridge_session_id: "abc-123",
  type: "step_completed",
  content: { step: "sigma_2", description: "Council positions established" }
})
```

**Orchestrator reads child progress:**
```
bridge_read_progress({
  bridge_session_id: "abc-123",
  since_sequence: 0
})
→ {
    messages: [
      { sequence: 1, sender: "abc-123", type: "step_started", content: { step: "sigma_2", ... } },
      { sequence: 2, sender: "pty-watcher", type: "tool_call", content: { tool: "Edit", ... } }
    ],
    last_sequence: 2
  }
```

The `since_sequence` parameter enables incremental reading — pass the `last_sequence` from the previous call to get only new messages.

### Events channel

Lifecycle events that signal completion, errors, escalations, or budget warnings.

**Agent reports completion:**
```
bridge_event({
  bridge_session_id: "abc-123",
  type: "completed",
  summary: "M1-COUNCIL executed successfully, decision: two-tier LRU cache"
})
```

**Event types:**

| Type | When | Push notification? |
|------|------|--------------------|
| `started` | Session begins work | No |
| `completed` | Task finished successfully | Yes |
| `error` | Unrecoverable error | Yes |
| `escalation` | Sub-agent needs orchestrator decision | Yes |
| `budget_warning` | Approaching depth or agent budget limit | Yes |
| `scope_violation` | Agent wrote outside its `allowed_paths` (PRD 014) | Yes |
| `stale` | Session inactive for 30+ minutes | Yes |
| `killed` | Session killed | No |
| `retro_generated` | Auto-retrospective written | No |

### Push notifications

When a child session emits a pushable event (`completed`, `error`, `escalation`, `budget_warning`, `scope_violation`, `stale`), the bridge automatically sends a notification prompt to the parent agent. The orchestrator doesn't need to poll — it receives a prompt with the event summary and suggested action.

Push delivery is fire-and-forget: if the parent is busy processing another prompt, the notification queues. If delivery fails, it's non-fatal.

### Cross-session event aggregation

For council-level oversight or human monitoring:

```
bridge_all_events({ since_sequence: 0, filter_type: "completed" })
→ { events: [...all completed events across all sessions...], last_sequence: 5 }
```

The optional `filter_type` filter limits results to specific event types.

**Trigger fire events:** When the event trigger system (PRD 018) fires a trigger, a `trigger_fired` event appears in the aggregated events feed with `bridge_session_id: 'triggers'`. Filter with `filter_type: "trigger_fired"` to see only trigger events.

## PTY Activity Auto-Detection (PRD 010)

Agents rarely call `bridge_progress` voluntarily — they optimize out non-task-critical work. The PTY watcher solves this by detecting structured patterns in raw PTY output and auto-emitting to channels.

### What it detects

| Pattern | Detects | Channel emission |
|---------|---------|-----------------|
| Tool call | Read, Edit, Write, Bash, Glob, Grep, MCP tools | `progress: tool_call` |
| Git commit | Branch, hash, message from git output | `progress: git_commit` |
| Test result | Jest/Vitest/Mocha pass/fail counts | `progress: test_result` |
| File operation | File paths touched (read/write/edit) | `progress: file_activity` |
| Build result | tsc errors, build exit codes | `progress: build_result` |
| Error | Stack traces, exceptions, non-zero exits | `events: error_detected` |
| Idle | Prompt character after active work | `progress: idle` |

Auto-detected messages have `sender: "pty-watcher"` so they're distinguishable from agent-reported messages in the progress timeline.

### Rate limiting and dedup

The watcher rate-limits emissions to avoid flooding channels:
- Default: 1 emission per category per 5 seconds
- File operations: 1 per 10 seconds (high-frequency pattern)
- Errors: 1 per 15 seconds (multi-line stack traces)
- Deduplication window: 10 seconds (same category + type = suppressed)

### Configuration

Enable/disable globally via environment variables, or per-session via spawn metadata:

```
bridge_spawn({
  workdir: "/path/to/project",
  metadata: {
    pty_watcher: {
      enabled: true,
      patterns: ["tool_call", "git_commit", "test_result"],
      auto_retro: true
    }
  }
})
```

### Auto-retrospective generation

When a session exits (normal exit, kill, or stale auto-kill), the watcher synthesizes a retrospective YAML from accumulated observations and writes it to `.method/retros/retro-YYYY-MM-DD-NNN.yaml`. The retro includes:

- **Timing** — spawn time, termination time, active vs idle minutes, termination reason
- **Activity summary** — tool call counts with per-tool breakdown, files touched, git commits
- **Quality** — whether tests ran, pass/fail counts, build status, error count

Auto-retros are marked `generated_by: pty-watcher` to distinguish them from agent-authored retrospectives. If `.method/retros/` doesn't exist (project doesn't use the method system), the retro is silently skipped.

## Batch Spawn with Stagger (PRD 012)

When spawning multiple agents in parallel, use `bridge_spawn_batch` to stagger initialization. Simultaneous spawns cause API rate limit contention — 0/5 agents completed when spawned at the same instant, but 3/3 completed with 5s stagger.

```
bridge_spawn_batch({
  sessions: [
    { workdir: "/path/to/project", nickname: "impl-1", purpose: "Implement component A" },
    { workdir: "/path/to/project", nickname: "impl-2", purpose: "Implement component B" },
    { workdir: "/path/to/project", nickname: "impl-3", purpose: "Write tests" }
  ],
  stagger_ms: 3000
})
→ {
    results: [
      { bridge_session_id: "abc-123", nickname: "impl-1", status: "ready" },
      { bridge_session_id: "def-456", nickname: "impl-2", status: "ready" },
      { bridge_session_id: "ghi-789", nickname: "impl-3", status: "ready" }
    ]
  }
```

The default stagger is 3000ms (configurable via `BATCH_STAGGER_MS`). Each session is spawned `stagger_ms` after the previous one. The HTTP endpoint is `POST /sessions/batch`.

## Session Diagnostics (PRD 012)

Every session tracks diagnostic metrics for debugging stalls and failures:

```
GET /sessions/:id/status
→ {
    ...
    diagnostics: {
      time_to_first_output_ms: 1200,
      time_to_first_tool_ms: 3400,
      tool_call_count: 47,
      total_settle_overhead_ms: 14100,
      false_positive_settles: 2,
      current_settle_delay_ms: 300,
      idle_transitions: 3,
      longest_idle_ms: 45000,
      permission_prompt_detected: false,
      stall_reason: null
    }
  }
```

**Stall classification:** When a session goes idle without completing, the bridge classifies the cause:

| Classification | Condition |
|---------------|-----------|
| `permission_blocked` | No tool calls ever observed — likely hit a permission prompt |
| `task_complexity` | Tool calls started but agent got stuck in a read-think-stall loop |
| `resource_contention` | Slow first output AND other agents also slow |
| `unknown` | None of the above |

The dashboard shows diagnostics per session. Permission prompt detection fires when the PTY watcher sees "Allow ... ? (Y/N)" patterns.

## Adaptive Settle Delay (PRD 012)

The bridge detects response completion by waiting for PTY silence. The adaptive algorithm starts with a short delay (300ms) and backs off only when false-positive cutoffs are detected:

- **Initial delay:** 300ms (vs fixed 1s previously)
- **Backoff:** 1.5x on false-positive cutoff (response cut short)
- **Reset:** Returns to initial delay when tool-output markers detected
- **Cap:** 2000ms maximum, 200ms floor

This reduces idle overhead by 50-70% for tool-heavy agents. Configure via `ADAPTIVE_SETTLE_ENABLED` (default: true), `ADAPTIVE_SETTLE_INITIAL_MS`, `ADAPTIVE_SETTLE_MAX_MS`, `ADAPTIVE_SETTLE_BACKOFF`.

## Split Prompt Delivery

Long initial prompts (> 500 characters) are automatically split into two messages to prevent agents from treating the instructions as passive context (EXP-OBS02 finding):

1. **Activation prompt** — short message with the session ID, asks the agent to acknowledge with "ready"
2. **Full commission** — queued 3 seconds later with the complete task instructions and an "execute immediately" directive

Short prompts (≤ 500 characters) are sent as-is with the session ID prefix. This splitting is transparent to the orchestrator — just pass the full prompt to `bridge_spawn` or `bridge_prompt` and the bridge handles delivery.

## Persistent Sessions (PRD 011)

Sessions spawned with `persistent: true` skip stale detection entirely. They won't be auto-killed after inactivity — they stay alive until explicitly killed or the bridge restarts.

```
bridge_spawn({
  workdir: "/path/to/project",
  persistent: true,
  nickname: "mission",
  purpose: "Remote admin session"
})
```

Use persistent sessions for:
- Long-running background agents that work intermittently
- Remote access sessions (phone reconnects after disconnect)
- Infrastructure agents that should survive inactivity periods

Persistent sessions still die if the underlying PTY process exits, and are still subject to `DEAD_SESSION_TTL_MS` cleanup after death.

## Stale Session Detection

Non-persistent sessions are automatically monitored for inactivity:

1. **Mark stale** — after 30 minutes of inactivity, the session gets a `stale` flag and a `stale` event is emitted to the events channel (triggers push notification to parent)
2. **Auto-kill** — after 60 minutes of inactivity, the session is killed and a `stale` event with `action: "auto_killed"` is emitted

Check staleness via `bridge_list()` — each session includes a `stale` boolean flag. Per-session timeout overrides are available via the `timeout_ms` parameter on spawn (the kill timeout is double the stale timeout).

## Worktree Isolation

Sessions can be spawned in isolated git worktrees to prevent file conflicts between parallel agents:

```
bridge_spawn({
  workdir: "/path/to/project",
  isolation: "worktree",
  session_id: "impl-run-1"
})
→ {
    bridge_session_id: "def-456",
    worktree_path: ".claude/worktrees/def45678/",
    metals_available: false,
    ...
  }
```

The bridge creates a worktree at `.claude/worktrees/{session_id[:8]}/` with a branch named `worktree-{session_id[:8]}`. The agent runs in the worktree directory.

**Trade-off:** Metals MCP (language server) is not available in worktrees (`metals_available: false` in the spawn response). If the sub-agent needs Metals for code navigation, use `isolation: "shared"` (default) instead.

On kill, the worktree can be merged, kept, or discarded via the `worktree_action` parameter on `bridge_kill`.

## Scope Enforcement (PRD 014)

Sub-agents can be constrained to modify only specific files via `allowed_paths`. This provides three layers of enforcement:

1. **Pre-commit hook** (hard block) — git-level rejection of commits with out-of-scope files
2. **PTY watcher** (real-time signal) — `scope_violation` events emitted on Write/Edit to out-of-scope paths
3. **Push notification** — parent agent notified immediately when a child writes out of scope

### Basic Usage

```
bridge_spawn({
  workdir: "/path/to/project",
  isolation: "worktree",
  allowed_paths: ["packages/bridge/src/**", "packages/bridge/src/__tests__/**"],
  scope_mode: "enforce"
})
```

### Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `allowed_paths` | `string[]` | `[]` (no constraint) | Glob patterns of files the agent may modify |
| `scope_mode` | `'enforce' \| 'warn'` | `'enforce'` | `enforce` installs pre-commit hook + PTY detection. `warn` emits events only. |

### Glob Pattern Semantics

| Pattern | Matches |
|---------|---------|
| `packages/bridge/src/**` | All files under `packages/bridge/src/` at any depth |
| `docs/prds/*.md` | Markdown files directly in `docs/prds/` |
| `*.ts` | Any TypeScript file at any depth |
| `packages/core/**` `packages/mcp/**` | Multiple package scopes (pass as separate array entries) |

### How It Works

When `allowed_paths` is provided with `isolation: "worktree"` and `scope_mode: "enforce"`:

1. The bridge creates the worktree (existing PRD 006 logic)
2. A pre-commit hook is generated and installed in the worktree's hooks directory
3. The PTY watcher is configured with the scope context
4. If the agent tries to `git commit` files outside `allowed_paths`, the hook rejects with a clear error
5. If the agent uses `Write` or `Edit` on out-of-scope files, a `scope_violation` event is emitted to the events channel
6. The parent agent receives a push notification for `scope_violation` events

### Worktree Requirement

The pre-commit hook requires `isolation: "worktree"`. If `allowed_paths` is provided without worktree isolation, the bridge automatically falls back to `scope_mode: "warn"` and logs a warning. In warn mode, the PTY watcher still emits `scope_violation` events, but commits are not blocked.

### Backwards Compatibility

Sessions spawned without `allowed_paths` behave exactly as before — no hook is installed, no scope checking occurs. Read operations are never restricted regardless of `allowed_paths`.

### Commission Integration

The `/commission` skill automatically includes `allowed_paths` in `bridge_spawn` calls when the orchestrator prompt specifies file-scope constraints (Section 9). The commission maps each sub-agent's declared scope to glob patterns.

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `SCOPE_ENFORCEMENT_DEFAULT` | `enforce` | Default scope mode when `allowed_paths` is provided but `scope_mode` is not |

## Chain and Budget System

Sessions track parent-child relationships for multi-level orchestration:

```
bridge_spawn({
  workdir: "/path/to/project",
  parent_session_id: "abc-123",
  budget: { max_depth: 3, max_agents: 10 }
})
```

The budget is shared across the entire chain:
- `max_depth` — maximum nesting level (orchestrator → sub-agent → sub-sub-agent)
- `max_agents` — total agents that can be spawned across the chain
- `agents_spawned` — incremented atomically on each spawn, validated against `max_agents`

If a spawn would exceed the budget, the bridge rejects it with an error. The orchestrator can check current budget status via `bridge_list()`.

## Monitoring Active Sessions

At any point during orchestration, check session status:

```
bridge_list()
→ {
    sessions: [
      {
        bridge_session_id: "abc-123",
        nickname: "council",
        status: "ready",
        stale: false,
        queue_depth: 0,
        metadata: {},
        methodology_session_id: "council-run-1"
      }
    ],
    capacity: { active: 1, max: 10 },
    message: "1 of 10 sessions active"
  }
```

Use this to verify sessions are alive before sending prompts, or to detect dead sessions that need respawning.

### Live output

For real-time visibility into what a sub-agent is doing, open the live output page in a browser:

```
http://localhost:3456/sessions/{session_id}/live
```

This renders a full xterm.js terminal emulator with the agent's raw PTY output — ANSI colors, cursor movement, box-drawing characters all render correctly. The page also shows session metadata (nickname, status, tokens, cache rate).

The underlying SSE stream is at `/sessions/{session_id}/stream` for programmatic consumption.

## Dashboard

The bridge serves a browser dashboard at `http://localhost:3456/dashboard` that provides live observability into all sessions and resource usage. See [Guide 14](14-bridge-dashboard-ui.md) for the full dashboard reference and extension patterns.

### Health cards

Top-level stats: bridge port, uptime, active/max sessions, total spawned, dead sessions, and aggregate token usage (total, input, output, cache hit rate).

### Subscription usage meters

Four usage meters sourced from the Anthropic API (requires OAuth token):
- **5-Hour Window** — rolling short-term usage
- **7-Day Ceiling** — aggregate weekly limit
- **7-Day Sonnet** — per-model weekly (Sonnet)
- **7-Day Opus** — per-model weekly (Opus)

Each meter shows utilization percentage, color-coded (green < 60%, yellow 60-85%, red > 85%), with time-until-reset.

### Session table

Tree-ordered by depth (parent-child indentation). Each active session displays:

| Column | Description |
|--------|-------------|
| Nickname | Session nickname (indented by depth for chain visualization) |
| Status | `initializing`, `ready`, `working`, `dead` |
| Workdir | Last path segment of the session's working directory |
| Method Session | Methodology session ID (from `bridge_spawn` correlation) |
| Prompts | Number of prompts sent to this session |
| Tokens | Total tokens with input/output breakdown |
| Cache | Cache hit rate percentage with cache read token count |
| Last Activity | Time since last prompt or status change |

Clickable rows expand a detail view with purpose, full session ID, and links to "View Live Output" (xterm.js) and "View Transcript" (session history).

### Progress timeline

Per-session timeline showing the last 8 progress entries — step advances, tool calls, idle transitions. Time, type, and description for each entry.

### Event feed

Global feed of the 20 most recent events across all sessions. Each entry shows time, session nickname, color-coded event badge, and summary.

## Prompt Composition for Sub-Agents

When sending a step prompt to a bridge sub-agent, include:

1. **Role and scope** — what the agent is doing (one step of one method)
2. **Step context** — from `step_context()`, includes guidance, preconditions, output schema
3. **Prior method outputs** — from `step_context().priorMethodOutputs`, so the agent knows what previous methods produced
4. **Delivery rules** — from the project card, relevant to this step
5. **Output format** — what the orchestrator expects back (must match the step's output schema for `step_validate` to pass)

Example prompt skeleton:

```
You are executing step {step.id} ({step.name}) of method {method.id}.

## Context
Methodology: {methodology.name} — progress: {methodology.progress}
Method objective: {method.objective}

## Step
Precondition: {step.precondition}
Guidance: {step.guidance}
Postcondition: {step.postcondition}

## Prior Method Outputs
{priorMethodOutputs formatted}

## Output Format
Return a JSON object matching this schema:
{step.outputSchema}

## Rules
- {relevant delivery rules}
- Do not make scope decisions — report uncertainties back
- Commit your work with a descriptive message
```

## When to Spawn vs. Execute In-Context

Not every method step needs a bridge sub-agent. Use this decision tree:

| Situation | Approach |
|-----------|----------|
| Step requires code changes | Bridge sub-agent (needs file access) |
| Step is pure reasoning (routing, planning) | Orchestrator in-context (M3-TMP) |
| Step is a council debate (M1-COUNCIL) | Orchestrator in-context (manages characters) |
| Step dispatches parallel work | One bridge sub-agent per parallel task |
| Step is trivial (1-2 minutes) | Orchestrator in-context (bridge overhead not worth it) |

The bridge exists for work that would burn the orchestrator's context. Use it when the sub-agent needs its own context window to do meaningful work.

## Error Handling

### Bridge session dies mid-method

If a sub-agent's session dies (check via `bridge_list()` — status `"dead"`), the orchestrator should:
1. Check what outputs were already recorded via `step_context.priorStepOutputs`
2. Spawn a new bridge session with `bridge_spawn`
3. Resume from the current step (the methodology session tracks position)

### Transition fails (no matching arm)

If `methodology_transition` returns `nextMethod: null` unexpectedly:
1. Check the `evaluatedPredicates` — are the provided predicates correct?
2. The methodology may be complete (check `globalObjectiveStatus`)
3. Re-route with different predicates if the objective isn't satisfied

### Bridge timeout

If a prompt times out (`timed_out: true` in `bridge_prompt` response), the partial output may still be usable. Check the output, and either:
- Retry the prompt with a longer `timeout_ms`
- Record the partial output and let the orchestrator decide whether to advance or retry

### Bridge not running

If any bridge proxy tool returns a connection refused error, start the bridge with `npm run bridge` and retry. The error message includes the `BRIDGE_URL` being used. All MCP proxy tools retry once (after 1 second) on connection errors automatically.

## Relationship to Other Guides

- **Guide 8** covers orchestrator prompt design — how to write the initial prompt that sets up the orchestrating agent. This guide (10) covers the runtime execution mechanics.
- **Guide 14** covers the dashboard UI — rendering architecture, design system, and how to add new panels.
- **Guide 15** covers remote access via Tailscale — accessing the bridge from a phone or another machine.

Use Guide 8 to write the orchestrator prompt. Use this guide to understand the execution mechanics. Use Guide 14 to understand the dashboard. Use Guide 15 to access the bridge remotely.

## HTTP API Reference

The bridge proxy MCP tools call the bridge HTTP API internally. This section documents the raw endpoints for debugging, direct integration, or cases where the MCP proxy is unavailable.

### Session management

| MCP Proxy Tool | HTTP Endpoint | Method |
|----------------|---------------|--------|
| `bridge_spawn` | `/sessions` | `POST` |
| `bridge_spawn_batch` | `/sessions/batch` | `POST` |
| `bridge_prompt` | `/sessions/:id/prompt` | `POST` |
| `bridge_kill` | `/sessions/:id` | `DELETE` |
| `bridge_list` | `/sessions` | `GET` |

### Visibility channels

| MCP Proxy Tool | HTTP Endpoint | Method |
|----------------|---------------|--------|
| `bridge_progress` | `/sessions/:id/channels/progress` | `POST` |
| `bridge_event` | `/sessions/:id/channels/events` | `POST` |
| `bridge_read_progress` | `/sessions/:id/channels/progress` | `GET` |
| `bridge_read_events` | `/sessions/:id/channels/events` | `GET` |
| `bridge_all_events` | `/channels/events` | `GET` |

### Additional endpoints (not exposed via MCP)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | `GET` | Health check — JSON with status, session count, uptime |
| `/dashboard` | `GET` | Browser dashboard (HTML) |
| `/sessions/:id/status` | `GET` | Single session status, metadata, chain info, stale flag |
| `/sessions/:id/resize` | `POST` | Resize PTY terminal dimensions (`cols`, `rows`) |
| `/sessions/:id/stream` | `GET` | SSE stream of raw PTY output (for xterm.js) |
| `/sessions/:id/live` | `GET` | HTML page with embedded xterm.js terminal emulator |
| `/sessions/:id/transcript` | `GET` | Transcript browser for a specific session |
| `/transcripts` | `GET` | List all available transcript sessions |
| `/pool/stats` | `GET` | Pool statistics: `max_sessions`, `active_count`, `dead_count`, `total_spawned`, `uptime_ms` |
| `/shutdown` | `POST` | Graceful shutdown (localhost only) — cleans up sessions before exit |

### POST /sessions

```json
{
  "workdir": "/path/to/project",
  "spawn_args": ["--allowedTools", "mcp__method__*"],
  "initial_prompt": "optional initial prompt",
  "metadata": { "methodology_session_id": "council-run-1" },
  "parent_session_id": "optional-parent-id",
  "budget": { "max_depth": 3, "max_agents": 10 },
  "isolation": "worktree",
  "nickname": "council",
  "purpose": "Execute M1-COUNCIL debate",
  "persistent": false,
  "timeout_ms": 1800000,
  "mode": "pty",
  "spawn_delay_ms": 0
}
```

**Parameters of note:**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `mode` | `'pty' \| 'print'` | `'pty'` | Session mode. `pty` spawns an interactive PTY with TUI rendering. `print` runs `claude --print` headlessly — no PTY, no settle delay, no split prompt delivery. Use `print` for batch/scripted workloads. |
| `spawn_delay_ms` | `number` | `0` | Delay in milliseconds before spawning the PTY process. Useful for staggering manual spawns. |

Response: `{ "session_id": "abc-123", "nickname": "council", "status": "ready", "mode": "pty", "worktree_path": null, "metals_available": true }`

### POST /sessions/:id/prompt

```json
{
  "prompt": "Execute sigma_1...",
  "timeout_ms": 120000
}
```

Response: `{ "output": "...", "timed_out": false }`

### DELETE /sessions/:id

Response: `{ "session_id": "abc-123", "killed": true }`

### GET /sessions

Response: array of `{ session_id, nickname, status, stale, queue_depth, metadata, methodology_session_id }`

### POST /sessions/:id/channels/progress

Progress type must be one of: `step_started`, `step_completed`, `working_on`, `sub_agent_spawned`.

```json
{
  "type": "step_completed",
  "content": { "step": "sigma_2", "description": "Council positions established" }
}
```

### POST /sessions/:id/channels/events

```json
{
  "type": "completed",
  "summary": "Task completed successfully"
}
```

### GET /sessions/:id/channels/progress?since_sequence=0

Query parameters:
- `since_sequence` — read messages after this sequence number (default `0` for full history)
- `reader_id` — optional named cursor; the server auto-advances it so the next call with the same `reader_id` returns only new messages

Response: `{ "messages": [...], "last_sequence": 5, "has_more": false }`

### GET /sessions/:id/channels/events?since_sequence=0

Same query parameters as progress (`since_sequence`, `reader_id`).

Response: `{ "messages": [...], "last_sequence": 5, "has_more": false }`

### Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3456` | HTTP listen port |
| `CLAUDE_BIN` | `claude` | Path to Claude Code binary |
| `MAX_SESSIONS` | `10` | Max concurrent PTY sessions |
| `SETTLE_DELAY_MS` | `1000` | Response completion debounce |
| `DEAD_SESSION_TTL_MS` | `300000` | Auto-cleanup TTL for dead sessions (5 min) |
| `STALE_CHECK_INTERVAL_MS` | `60000` | Interval for stale session detection (1 min) |
| `CLAUDE_OAUTH_TOKEN` | *(auto-loaded)* | Enables subscription usage meters in dashboard |
| `USAGE_POLL_INTERVAL_MS` | `600000` | Subscription usage poll interval (10 min) |
| `CLAUDE_SESSIONS_DIR` | `~/.claude/projects` | Base dir for Claude Code session logs |
| `SSE_HEARTBEAT_MS` | `15000` | SSE keepalive interval for xterm.js stream |
| `MAX_TRANSCRIPT_SIZE_BYTES` | `5242880` | Transcript buffer cap (5 MB) |
| `PTY_WATCHER_ENABLED` | `true` | Enable PTY activity auto-detection |
| `PTY_WATCHER_PATTERNS` | `all` | Pattern categories to track (comma-separated or "all") |
| `PTY_WATCHER_RATE_LIMIT_MS` | `5000` | Rate limit for observation emissions |
| `PTY_WATCHER_DEDUP_WINDOW_MS` | `10000` | Dedup window for repeated observations |
| `PTY_WATCHER_AUTO_RETRO` | `true` | Auto-generate retrospective on session exit |
| `PTY_WATCHER_LOG_MATCHES` | `false` | Debug logging for pattern matches |
| `BATCH_STAGGER_MS` | `3000` | Default stagger between batch spawns |
| `MIN_SPAWN_GAP_MS` | `2000` | Minimum gap between PTY process launches (enforced by spawn queue) |
| `ADAPTIVE_SETTLE_ENABLED` | `true` | Enable adaptive settle delay algorithm |
| `ADAPTIVE_SETTLE_INITIAL_MS` | `300` | Starting adaptive settle delay |
| `ADAPTIVE_SETTLE_MAX_MS` | `2000` | Maximum adaptive settle delay cap |
| `ADAPTIVE_SETTLE_BACKOFF` | `1.5` | Backoff multiplier on false-positive cutoff |
| `SCOPE_ENFORCEMENT_DEFAULT` | `enforce` | Default scope mode when `allowed_paths` provided (PRD 014) |
