# PRD 005 — Bridge v2: MCP Integration and Human Observability

**Status:** Implemented
**Date:** 2026-03-14
**Scope:** Bridge MCP proxy tools + permission handling + human observability dashboard + token usage tracking
**Depends on:** 003-dispatch (bridge implementation), 004-methodology-runtime (methodology session tools)
**Requested by:** pv-agi (steering council acceptance test blocked by bridge UX gaps)
**Evidence:** [pv-agi acceptance test report](../../../pv-agi/tmp/001-bridge-acceptance-test.md), council session 2026-03-14

---

## Contents

| File | Description |
|------|-------------|
| [README.md](README.md) | This file — the PRD specification |
| `mocks/` | UI mockups for the dashboard (to be added) |

---

## Purpose

PRD 003 built the bridge — a PTY HTTP server that spawns and manages Claude Code agent sessions. PRD 004 built the runtime methodology tools — start, route, load, transition. But the pv-agi acceptance test revealed that these two systems don't compose well:

1. **Two protocols.** The orchestrator calls MCP for methodology logic and HTTP for agent spawning. Two APIs, two error models, two sets of session IDs to correlate manually.
2. **No permission handling.** Spawned agents hit MCP tool permission prompts that the bridge can't detect or respond to. The acceptance test is blocked at Gate 1.
3. **Zero human visibility.** The operator has no way to see what spawned agents are doing, whether they're stuck, or how many are alive. Debugging requires reading raw HTTP responses.

This PRD collapses the control plane to one protocol (MCP), unblocks MCP tool permissions in spawned agents, and gives humans a live view of agent activity.

---

## Problem

After PRDs 003 + 004, an orchestrating agent can:
- Start a methodology session and route through δ_Φ (PRD 004)
- Spawn Claude Code agents via the bridge HTTP API (PRD 003)
- Send prompts and receive responses via HTTP (PRD 003)

But it **cannot**:
- Spawn agents through MCP (must use a separate HTTP client)
- Pass CLI flags to spawned agents (no `spawn_args` support — blocks permission bypass)
- Automatically correlate methodology sessions with bridge sessions
- Give the human operator visibility into agent activity
- Handle the case where the bridge is unreachable (no health check, no clear error)

The pv-agi acceptance test (steering council dispatching work) is **blocked** because spawned agents prompt for MCP tool permissions and the bridge has no mechanism to handle this.

---

## What to Build

### Phase 1: MCP Proxy + Permission Handling

#### Bridge-side: `spawn_args` support

Extend `POST /sessions` to accept a `spawn_args` field:

```
POST /sessions
{
  workdir: string,
  spawn_args?: string[],       // NEW: CLI flags passed to claude binary
  initial_prompt?: string,
  metadata?: Record<string, unknown>   // NEW: arbitrary metadata stored with session
}
```

`spawn_args` are appended to the Claude Code binary invocation. This allows:
- `["--dangerously-skip-permissions"]` — bypass all permission prompts (development)
- `["--allowedTools", "mcp__method__*"]` — allow specific MCP tools without prompting (production)

The `metadata` field is stored with the session and returned by `GET /sessions` and `GET /sessions/:id/status`. The MCP proxy uses this to store the methodology session ID for correlation.

Update `pty-session.ts` spawn logic:

```typescript
// Current
const args = process.platform === 'win32' ? ['/c', claudeBin] : ['-c', claudeBin];

// New
const cliFlags = options.spawnArgs?.join(' ') ?? '';
const fullCmd = cliFlags ? `${claudeBin} ${cliFlags}` : claudeBin;
const args = process.platform === 'win32' ? ['/c', fullCmd] : ['-c', fullCmd];
```

#### MCP-side: 4 proxy tools

Add 4 new MCP tools in `@methodts/mcp` that proxy to the bridge HTTP API. These are thin transport adapters — they translate MCP tool calls into HTTP requests.

**Configuration:** `BRIDGE_URL` environment variable (default: `http://localhost:3456`). Same pattern as `METHOD_ROOT`.

**HTTP client:** Node.js built-in `fetch` (available since Node 18). No new dependencies.

##### Tool 1: `bridge_spawn`

Spawn a new Claude Code agent session via the bridge.

```
Input:  {
  workdir: string,
  spawn_args?: string[],
  initial_prompt?: string,
  session_id?: string          // methodology session ID — auto-correlated
}
Output: {
  bridge_session_id: string,
  status: string,
  message: "Agent spawned. Call bridge_prompt to send work."
}
Error: "Bridge error: connection refused — is the bridge running on {BRIDGE_URL}?"
       "Bridge error: session pool full (max {n})"
```

The handler automatically includes the MCP `session_id` (the one shared with methodology tools) in the bridge session's `metadata.methodology_session_id`. This enables automatic correlation — the orchestrator doesn't need to manage two ID spaces.

##### Tool 2: `bridge_prompt`

Send a prompt to a spawned agent and wait for the response.

```
Input:  {
  bridge_session_id: string,
  prompt: string,
  timeout_ms?: number          // default: 120000 (2 minutes)
}
Output: {
  output: string,
  timed_out: boolean,
  message: "Response received (247 chars)" | "Prompt timed out — partial output returned"
}
Error: "Bridge error: session {id} not found"
       "Bridge error: session {id} is dead"
```

##### Tool 3: `bridge_kill`

Kill a spawned agent session.

```
Input:  {
  bridge_session_id: string
}
Output: {
  bridge_session_id: string,
  killed: boolean,
  message: "Session killed"
}
Error: "Bridge error: session {id} not found"
```

##### Tool 4: `bridge_list`

List all active bridge sessions.

```
Input:  {}
Output: {
  sessions: [{
    bridge_session_id: string,
    status: string,
    queue_depth: number,
    metadata: Record<string, unknown>,
    methodology_session_id: string | null    // extracted from metadata for convenience
  }],
  capacity: { active: number, max: number },
  message: "2 of 5 sessions active"
}
```

#### Error handling pattern

All proxy tools catch `fetch` errors and wrap them with a `"Bridge error:"` prefix:

```typescript
try {
  const res = await fetch(`${BRIDGE_URL}/sessions`, { ... });
  if (!res.ok) {
    const body = await res.json();
    throw new Error(`Bridge error: ${body.error}`);
  }
  return { ... };
} catch (e) {
  if (e instanceof TypeError) {
    // fetch network error — bridge unreachable
    throw new Error(`Bridge error: connection refused — is the bridge running on ${BRIDGE_URL}?`);
  }
  throw e;
}
```

This distinguishes bridge infrastructure errors from methodology domain errors for the orchestrating agent.

#### Implementation constraints

- **DR-03 preserved.** The proxy tools live in `@methodts/mcp`, not `@methodts/core`. Core remains transport-free.
- **DR-04 extended.** The proxy tools follow the same pattern: parse input → make HTTP call → format response. The HTTP call replaces the core function call, but the wrapper pattern is identical.
- **No bridge dependency.** `@methodts/mcp` does not import from `@methodts/bridge`. The proxy communicates via HTTP only. The two packages have no compile-time relationship.

---

### Phase 2: Human Observability Dashboard + Token Usage

Phase 2 adds three capabilities: the dashboard UI, subscription usage polling, and per-session token tracking from session logs. All three are served through a single `GET /dashboard` endpoint.

#### New files

| File | Responsibility |
|------|---------------|
| `packages/bridge/src/dashboard.html` | HTML template with placeholder tokens |
| `packages/bridge/src/usage-poller.ts` | Polls Anthropic OAuth usage endpoint, caches result |
| `packages/bridge/src/token-tracker.ts` | Parses Claude Code JSONL session logs for per-session token data |
| `packages/bridge/src/dashboard-route.ts` | Fastify route handler — assembles data, renders template |

#### Type definitions

```typescript
// ── Subscription usage (from Anthropic OAuth endpoint) ──

type UsageBucket = {
  utilization: number;      // 0-100
  resets_at: string | null; // ISO timestamp
};

type SubscriptionUsage = {
  five_hour: UsageBucket;
  seven_day: UsageBucket;
  seven_day_sonnet: UsageBucket;
  seven_day_opus: UsageBucket;
  extra_usage: { enabled: boolean } | null;
  polled_at: string;        // ISO timestamp of last successful poll
};

// ── Per-session token tracking (from JSONL session logs) ──

type SessionTokenUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;      // inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens
  cacheHitRate: number;     // cacheReadTokens / (inputTokens + cacheReadTokens), 0-100
};

// ── Aggregate (computed from all sessions) ──

type AggregateTokenUsage = {
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  cacheHitRate: number;     // aggregate across all sessions
  sessionCount: number;     // sessions with token data available
};

// ── Extended session info for dashboard ──

type DashboardSession = {
  sessionId: string;
  status: string;
  workdir: string;
  metadata: Record<string, unknown>;
  promptCount: number;
  lastActivityAt: string;         // ISO timestamp
  tokenUsage: SessionTokenUsage | null;  // null if logs not found
};

// ── Full dashboard data (assembled by route handler) ──

type DashboardData = {
  bridge: {
    port: number;
    startedAt: string;
    version: string;
    uptime: string;              // formatted: "2h 14m"
    activeSessions: number;
    maxSessions: number;
    totalSpawned: number;
    deadSessions: number;
  };
  tokens: AggregateTokenUsage;
  subscription: SubscriptionUsage | null;  // null if CLAUDE_OAUTH_TOKEN not set
  sessions: DashboardSession[];
};
```

#### `GET /dashboard` route handler (`dashboard-route.ts`)

```typescript
export function registerDashboardRoute(
  app: FastifyInstance,
  pool: Pool,
  usagePoller: UsagePoller,
  tokenTracker: TokenTracker,
): void
```

The handler:

1. Calls `pool.list()` to get all sessions with their status, metadata, queue depth
2. For each session, calls `tokenTracker.getUsage(sessionId)` to get per-session token data (returns `null` if unavailable)
3. Computes aggregate token usage by summing across all sessions that have token data
4. Calls `usagePoller.getCached()` to get the latest subscription usage (returns `null` if token not configured)
5. Reads `dashboard.html` template (cached in memory after first read)
6. Replaces placeholder tokens (`{{bridge.uptime}}`, `{{tokens.totalTokens}}`, `{{sessions}}`, etc.) with rendered HTML
7. Returns `Content-Type: text/html`

**Template rendering:** The template uses simple `{{key}}` placeholders. The session table rows and subscription meter bars are rendered as HTML strings by the handler and injected into the template. No template engine dependency — `String.prototype.replace()` is sufficient.

#### Subscription usage poller (`usage-poller.ts`)

```typescript
export function createUsagePoller(config: {
  oauthToken: string | null;
  pollIntervalMs: number;
}): UsagePoller

type UsagePoller = {
  start(): void;                               // begin polling timer
  stop(): void;                                // clear polling timer
  getCached(): SubscriptionUsage | null;       // latest result (null if no token or not yet polled)
};
```

**Implementation:**

1. If `oauthToken` is null, `start()` is a no-op and `getCached()` always returns null
2. On start, immediately polls once, then sets `setInterval` at `pollIntervalMs`
3. Each poll:
   ```typescript
   const res = await fetch('https://api.anthropic.com/api/oauth/usage', {
     headers: {
       'Authorization': `Bearer ${oauthToken}`,
       'anthropic-beta': 'oauth-2025-04-20',
     },
   });
   ```
4. On success, caches the parsed response with a `polled_at` timestamp
5. On 403 (missing `user:profile` scope), logs a warning once and stops polling
6. On network error, logs and retries on next interval — does not crash

**Lifecycle:** Created at bridge startup. `start()` called after the HTTP server is listening. `stop()` called on graceful shutdown.

#### Per-session token tracker (`token-tracker.ts`)

```typescript
export function createTokenTracker(config: {
  sessionsDir: string;        // default: ~/.claude/projects
}): TokenTracker

type TokenTracker = {
  registerSession(sessionId: string, workdir: string, startedAt: Date): void;
  refreshUsage(sessionId: string): SessionTokenUsage | null;
  getUsage(sessionId: string): SessionTokenUsage | null;
  getAggregate(): AggregateTokenUsage;
};
```

**Implementation:**

1. `registerSession()` — called by the pool when a session is spawned. Records the workdir and start time.

2. `refreshUsage(sessionId)` — called after each `prompt()` response:
   a. Derives the Claude Code project hash from the workdir path
   b. Finds the most recent JSONL file in `{sessionsDir}/{projectHash}/sessions/`
   c. Reads the file line by line, filtering events with `usage` fields that occurred after `startedAt`
   d. Sums `input_tokens`, `output_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`
   e. Computes `cacheHitRate = cacheReadTokens / (inputTokens + cacheReadTokens) * 100`
   f. Caches the result and returns it
   g. Returns `null` if the log file doesn't exist or can't be parsed

3. `getUsage(sessionId)` — returns the cached result from the last `refreshUsage()` call. Does not re-read the log file.

4. `getAggregate()` — iterates all registered sessions, sums their cached token data:
   ```typescript
   const aggregate: AggregateTokenUsage = {
     totalTokens: 0, inputTokens: 0, outputTokens: 0,
     cacheReadTokens: 0, cacheWriteTokens: 0,
     cacheHitRate: 0, sessionCount: 0,
   };
   for (const usage of allCachedUsages) {
     aggregate.totalTokens += usage.totalTokens;
     aggregate.inputTokens += usage.inputTokens;
     aggregate.outputTokens += usage.outputTokens;
     aggregate.cacheReadTokens += usage.cacheReadTokens;
     aggregate.cacheWriteTokens += usage.cacheWriteTokens;
     aggregate.sessionCount++;
   }
   const totalInput = aggregate.inputTokens + aggregate.cacheReadTokens;
   aggregate.cacheHitRate = totalInput > 0
     ? (aggregate.cacheReadTokens / totalInput) * 100
     : 0;
   ```

**Project hash derivation:** Claude Code hashes the absolute project path to create the subdirectory name under `~/.claude/projects/`. The bridge must replicate this hashing. The exact algorithm should be verified by inspecting Claude Code's source or by empirical observation (create a session in a known workdir, check which directory appears). If the algorithm changes, the token tracker falls back gracefully (returns `null`).

**Integration with pool:** The pool calls `tokenTracker.registerSession()` in `create()` and `tokenTracker.refreshUsage()` after each `prompt()` resolves. This keeps token data fresh without requiring a separate polling timer.

#### Session state extensions (`pty-session.ts`)

Add two fields to the session state tracked by each `PtySession`:

```typescript
// Add to PtySession internal state
promptCount: number;        // incremented on each prompt() call
lastActivityAt: Date;       // updated on prompt send and response receive
```

These are exposed via `pool.list()` and `pool.status()` for the dashboard.

#### Dashboard visual layout

See `mocks/dashboard-overview.html` for the full Vidtecci OS design system mockup. Layout summary:

```
┌─────────────────────────────────────────────────────────────────┐
│ @methodts/bridge                              Port 3456 │ v0.2.0 │
│ Agent Session Dashboard                     Started ...        │
├─────────────────────────────────────────────────────────────────┤
│ HEALTH CARDS ROW 1: Bridge                                      │
│ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐            │
│ │ Active   │ │ Total    │ │ Uptime   │ │ Dead     │            │
│ │ 2 of 5   │ │ 7        │ │ 2h 14m   │ │ 1        │            │
│ └──────────┘ └──────────┘ └──────────┘ └──────────┘            │
├─────────────────────────────────────────────────────────────────┤
│ HEALTH CARDS ROW 2: Aggregate Tokens                            │
│ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐            │
│ │ Total    │ │ In / Out │ │ Cache    │ │ Cache    │            │
│ │ 142.7k   │ │109.7/33k │ │ 75%      │ │ 82.6k   │            │
│ └──────────┘ └──────────┘ └──────────┘ └──────────┘            │
├─────────────────────────────────────────────────────────────────┤
│ SUBSCRIPTION USAGE (if CLAUDE_OAUTH_TOKEN set)                  │
│ 5-Hour Window   ████████░░░░░░░░░  42%    resets in 3h 18m     │
│ 7-Day Ceiling   ████░░░░░░░░░░░░░  28%    resets in 4d 11h     │
│ 7-Day Sonnet    ███░░░░░░░░░░░░░░  19%    resets in 4d 11h     │
│ 7-Day Opus      █████████████████  87%    resets in 4d 11h     │
├─────────────────────────────────────────────────────────────────┤
│ SESSIONS                                  3 total · 2 active   │
│ ID       │ Status  │ Workdir  │ SID     │ Prm │ Tokens │ Cache │
│ 56edd62a │ working │ /pv-agi  │ cncl-1  │  4  │ 68.4k  │  78% │
│ 1dc309d3 │ ready   │ /pv-mthd │ impl-2  │ 12  │ 51.2k  │  82% │
│ a3f7bc01 │ dead    │ /pv-agi  │ cncl-1  │  7  │ 23.1k  │  54% │
├─────────────────────────────────────────────────────────────────┤
│ @methodts/bridge v0.2.0         Auto-refresh 5s · Usage poll 60s │
└─────────────────────────────────────────────────────────────────┘
```

**Color system** (from Vidtecci Visual Compass):
- Status: bio/green (ready), solar/amber (working), red (dead), dim/gray (initializing)
- Subscription meters: bio (0-60%), solar (60-85%), red (85-100%)
- Cache hit rate: bio (70%+), solar (40-69%), dim (<40%)
- Token columns show breakdown on hover/sub-line: `in: 52.1k · out: 16.3k`

#### Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `CLAUDE_OAUTH_TOKEN` | *(none)* | OAuth token for subscription usage polling. When unset, subscription panel shows "not configured". |
| `USAGE_POLL_INTERVAL_MS` | `60000` | Interval between subscription usage polls (ms) |
| `CLAUDE_SESSIONS_DIR` | `~/.claude/projects` | Base directory for Claude Code JSONL session logs |

**Fallback behavior:** Every data source degrades gracefully:
- No `CLAUDE_OAUTH_TOKEN` → subscription panel hidden, everything else works
- Session logs not found → token columns show "—", aggregate excludes that session
- OAuth endpoint returns 403 → warning logged, polling stops, panel shows "scope error"
- OAuth endpoint unreachable → last cached value shown with "stale" indicator

---

### Phase 3: Operational Polish

#### `GET /health`

```json
{
  "status": "ok",
  "active_sessions": 2,
  "max_sessions": 5,
  "uptime_ms": 8040000,
  "version": "0.2.0"
}
```

Returns 200 when healthy. Useful for monitoring and for orchestrators to pre-check bridge availability.

#### Graceful shutdown

Handle `SIGTERM` and `SIGINT`:
1. Stop accepting new sessions
2. Kill all active PTY processes
3. Log shutdown summary (sessions killed, uptime)
4. Exit cleanly

#### Dead session auto-cleanup

Configurable TTL for dead sessions (default: 5 minutes). Dead sessions are removed from the pool after the TTL expires. Prevents unbounded memory growth during long orchestration runs.

New environment variable: `DEAD_SESSION_TTL_MS` (default: `300000`).

#### New environment variables (Phase 2)

| Variable | Default | Description |
|----------|---------|-------------|
| `CLAUDE_OAUTH_TOKEN` | *(none)* | OAuth token for subscription usage polling. When unset, subscription meters are hidden. |
| `USAGE_POLL_INTERVAL_MS` | `60000` | Interval between subscription usage polls |
| `CLAUDE_SESSIONS_DIR` | `~/.claude/projects` | Base directory for Claude Code session logs |

#### Permission prompt detection (future fallback)

Pattern detection in `pty-session.ts` for Claude Code's permission prompt format. When detected:
- If the session has an allowlist configured, auto-respond
- Otherwise, return a structured response: `{ type: "permission_required", tool: "...", description: "..." }`

This is a reliability improvement for scenarios where `spawn_args` doesn't cover all cases. Deferred from Phase 1 because `spawn_args` provides the primary mechanism.

#### Per-prompt settle delay

Allow `settle_delay_ms` as a per-prompt parameter in `POST /sessions/:id/prompt`:

```json
{
  "prompt": "...",
  "timeout_ms": 120000,
  "settle_delay_ms": 5000
}
```

MCP tool calls produce longer output streams than simple text responses. A per-prompt settle delay avoids premature extraction for heavy operations.

---

## Relationship to Existing Tools

| Existing Tool / API | Change |
|---------------------|--------|
| `POST /sessions` | Extended: new `spawn_args` and `metadata` fields |
| `POST /sessions/:id/prompt` | No change (Phase 3 adds `settle_delay_ms`) |
| `GET /sessions/:id/status` | Extended: includes `metadata` in response |
| `GET /sessions` | Extended: includes `metadata` per session |
| `DELETE /sessions/:id` | No change |
| All methodology MCP tools (14) | No change |

New surfaces:

| New Tool / Endpoint | Phase |
|---------------------|-------|
| MCP `bridge_spawn` | Phase 1 |
| MCP `bridge_prompt` | Phase 1 |
| MCP `bridge_kill` | Phase 1 |
| MCP `bridge_list` | Phase 1 |
| `GET /dashboard` | Phase 2 |
| Subscription usage polling | Phase 2 |
| Per-session token tracking | Phase 2 |
| `GET /health` | Phase 3 |

After Phase 1, the MCP server exposes **18 tools** (14 methodology + 4 bridge proxy).

---

## Documentation Impact

### Architecture docs (`docs/arch/`)

| Document | Change |
|----------|--------|
| `bridge.md` | Already updated with PRD 004 integration section. Phase 1 requires adding: MCP proxy architecture, `BRIDGE_URL` config, error handling pattern, session ID correlation. Phase 2 requires: dashboard endpoint, template rendering, session tracking fields. |
| `mcp-layer.md` | Add 4 bridge proxy tools to the tool table. Add proxy error handling pattern (distinct from core error handling). Update tool count to 18. |
| `state-model.md` | No change — bridge sessions are not methodology sessions |
| `dependencies.md` | Note that `@methodts/mcp` now makes HTTP calls to the bridge (runtime dependency, not compile-time) |

### Guides (`docs/guides/`)

| Guide | Change |
|-------|--------|
| `10-bridge-orchestration.md` | **Major update.** Currently documents the HTTP workflow. Must be rewritten to use MCP proxy tools as the primary interface. The HTTP API becomes an implementation detail. Update the orchestration loop, session ID correlation (now automatic), error handling, and prerequisites. |
| `08-prompting-methodology-agents.md` | Minor update: add a section on sub-agent spawning via `bridge_spawn` in the sub-agent instructions template. |

### New documentation

| Document | Content |
|----------|---------|
| `docs/guides/10-bridge-orchestration.md` (rewrite) | Full guide rewrite using MCP proxy tools. Drop HTTP examples, add `bridge_spawn` / `bridge_prompt` examples. Add dashboard usage section. |

---

## Out of Scope

- **Bridge lifecycle management via MCP** — the human starts/stops the bridge independently. MCP tools assume the bridge is running. Lifecycle management (start/stop via MCP) is a future extension.
- **Prompt/response history API** — storing full transcripts per session. Deferred until logging infrastructure exists.
- **Agent-readable observability MCP tool** — a `bridge_dashboard` tool returning structured summary for agents. Deferred to future PRD.
- **WebSocket real-time dashboard** — auto-refresh is sufficient for v1.
- **Multi-bridge federation** — connecting to multiple bridge instances. Single bridge instance only.
- **Admin API integration** — the org-level `GET /v1/organizations/usage_report/messages` endpoint provides aggregate token breakdowns by model/workspace. Requires admin key. Useful for multi-user orgs but not for single-operator bridge use. Deferred.

---

## Implementation Order

### Phase 1: MCP Proxy + Permission Handling

Add `spawn_args` and `metadata` to bridge. Implement 4 MCP proxy tools. This unblocks the pv-agi acceptance test — agents can be spawned with permission bypass through MCP.

### Phase 2: Human Observability Dashboard + Token Usage

Add `GET /dashboard` to bridge. Add prompt count and last-activity tracking to sessions. Poll subscription usage via OAuth. Parse session logs for per-agent token consumption and cache hit rates. The operator opens a browser tab and sees live agent state, subscription quota, and token usage.

### Phase 3: Operational Polish

Health endpoint, graceful shutdown, dead session cleanup, per-prompt settle delay, permission detection.

---

## Acceptance Test

**Test case:** pv-agi steering council dispatching work through MCP-only tooling.

**Scenario:**
1. Human starts the bridge: `cd packages/bridge && npm start`
2. Agent calls `methodology_start({ methodology_id: "P1-EXEC" })`
3. Agent calls `methodology_route({ challenge_predicates: { adversarial_pressure_beneficial: true } })` → M1-COUNCIL
4. Agent calls `methodology_load_method({ method_id: "M1-COUNCIL" })`
5. Agent calls `bridge_spawn({ workdir: "/path/to/pv-agi", spawn_args: ["--allowedTools", "mcp__method__*"] })`
6. For each step: agent calls `step_context` → composes prompt → calls `bridge_prompt` → parses output → calls `step_validate` → calls `step_advance`
7. Agent calls `bridge_kill` to clean up the sub-agent
8. Agent calls `methodology_transition` → routes to M3-TMP
9. Agent calls `bridge_spawn` for M3-TMP execution
10. After M3-TMP: `step_context.priorMethodOutputs` includes M1-COUNCIL's outputs
11. Agent calls `methodology_transition` → methodology complete or routes back

**Pass criteria:**
- Full loop executes through MCP only — no direct HTTP calls to the bridge
- Spawned agents execute MCP tool calls without permission prompts
- `bridge_list` shows methodology session ID correlation
- Dashboard (if Phase 2 complete) shows live session activity
- Cross-method output forwarding works (same as PRD 004 acceptance test)

**Comparison against pv-agi Session 001:**
- PO intervention frequency (lower = better orchestration)
- Time from decision to executed artifact (faster = less overhead)
- Whether output quality is maintained or improved

---

## Success Criteria

1. An orchestrating agent can spawn sub-agents via `bridge_spawn` MCP tool with permission bypass
2. The entire methodology session loop (start → route → load → spawn → execute → transition) uses MCP only
3. Bridge session metadata automatically includes the methodology session ID
4. A human operator can open `http://localhost:3456/dashboard` and see live agent activity, subscription quota meters, and per-session token usage
5. Subscription meters show 5-hour and 7-day utilization with reset times when `CLAUDE_OAUTH_TOKEN` is configured
6. Per-session token breakdown (input, output, cache hit rate) is visible in the session table
7. The pv-agi acceptance test (blocked since PRD 004) passes end-to-end
6. All existing bridge HTTP endpoints continue to work unchanged (backward compatible)
7. All existing MCP tools (14) continue to work unchanged
