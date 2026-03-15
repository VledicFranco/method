# Guide 10 — Bridge Orchestration: Multi-Method Sessions with Sub-Agents

How to use the bridge MCP proxy tools together with the runtime methodology tools (PRD 004) to orchestrate multi-method sessions where sub-agents execute methods autonomously.

## The Problem This Solves

Without the bridge, an orchestrator runs every method in its own context window. This works for simple sequences but fails for pv-agi's steering council pattern: a council debate (M1-COUNCIL) produces a decision, then a sub-agent executes the dispatched task (M3-TMP), then the council reviews the result. The orchestrator can't do all three without burning its context window on implementation details.

With the bridge MCP proxy tools + methodology tools, the orchestrator:
1. Uses MCP tools for methodology routing and session management
2. Uses MCP bridge proxy tools (`bridge_spawn`, `bridge_prompt`, `bridge_kill`, `bridge_list`) to spawn and manage sub-agents
3. Records outputs via `step_validate`, which flow automatically to the next method via `priorMethodOutputs`

## Architecture

```
Orchestrator (human's Claude Code session)
    │
    ├── MCP methodology tools ──→ @method/mcp ──→ @method/core
    │   methodology_start        (initialize session)
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
```

The MCP server exposes both methodology tools and bridge proxy tools. The orchestrator calls everything through MCP — methodology tools for intelligence, bridge proxy tools for agent labor. The proxy tools internally call the bridge HTTP API, so the orchestrator never needs to make raw HTTP requests.

The bridge itself remains methodology-unaware: it just spawns agents and relays prompts. The MCP proxy layer adds methodology awareness by auto-correlating session IDs (see Session ID Correlation below).

## Prerequisites

1. **Bridge server running:** `npm run bridge` (builds first, then launches via `scripts/start-bridge.js`)
   - Auto-loads OAuth token from `~/.claude/.credentials.json` for subscription usage meters
   - Shows plan type, rate limit tier, and token expiry on startup
   - Default port: 3456
2. **Dashboard:** Open `http://localhost:3456/dashboard` in a browser for live observability
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
  session_id: "council-run-1"
})
→ {
    bridge_session_id: "abc-123",
    status: "ready",
    message: "Agent spawned. Call bridge_prompt to send work."
  }
```

The `session_id` parameter auto-correlates this bridge session with the methodology session (see Session ID Correlation above). The `spawn_args` restrict the sub-agent to only methodology MCP tools.

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

### Monitoring active sessions

At any point during orchestration, check session status:

```
bridge_list()
→ {
    sessions: [
      {
        bridge_session_id: "abc-123",
        status: "ready",
        queue_depth: 0,
        metadata: {},
        methodology_session_id: "council-run-1"
      }
    ],
    capacity: { active: 1, max: 1 },
    message: "1 of 1 sessions active"
  }
```

Use this to verify sessions are alive before sending prompts, or to detect dead sessions that need respawning.

## Dashboard

The bridge serves a browser dashboard at `http://localhost:3456/dashboard` that provides live observability into all sessions and resource usage. The dashboard auto-refreshes every 5 seconds.

### Health cards

Top-level stats: bridge port, uptime, active/max sessions, total spawned, dead sessions, and aggregate token usage (total, input, output, cache hit rate).

### Subscription usage meters

Four usage meters sourced from the Anthropic API (requires OAuth token):
- **5-Hour Window** — rolling short-term usage
- **7-Day Ceiling** — aggregate weekly limit
- **7-Day Sonnet** — per-model weekly (Sonnet)
- **7-Day Opus** — per-model weekly (Opus)

Each meter shows utilization percentage, color-coded (green < 60%, yellow 60-85%, red > 85%), with time-until-reset.

If no OAuth token is available, the panel shows status: "Not Configured", "Scope Error (403)", "Network Error", or "Loading..." with instructions for resolution.

### Session table

Each active session displays:

| Column | Description |
|--------|-------------|
| Session ID | First 8 chars of the bridge session UUID |
| Status | `initializing`, `ready`, `working`, `dead` |
| Workdir | Last path segment of the session's working directory |
| Method Session | Methodology session ID (from `bridge_spawn` correlation) |
| Prompts | Number of prompts sent to this session |
| Tokens | Total tokens with input/output breakdown |
| Cache | Cache hit rate percentage with cache read token count |
| Last Activity | Time since last prompt or status change |

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

If any bridge proxy tool returns a connection refused error, start the bridge with `npm run bridge` and retry. The error message includes the `BRIDGE_URL` being used.

## Relationship to Guide 8

Guide 8 covers orchestrator prompt design — how to write the initial prompt that sets up the orchestrating agent's role, methodology binding, and sub-agent instructions. This guide (10) covers what happens at runtime — the actual MCP tool calls during a multi-method session.

Use Guide 8 to write the orchestrator prompt. Use this guide to understand the execution mechanics.

## HTTP API Reference

The bridge proxy MCP tools call the bridge HTTP API internally. This section documents the raw endpoints for debugging, direct integration, or cases where the MCP proxy is unavailable.

| MCP Proxy Tool | HTTP Endpoint | Method |
|----------------|---------------|--------|
| `bridge_spawn` | `/sessions` | `POST` |
| `bridge_prompt` | `/sessions/:id/prompt` | `POST` |
| `bridge_kill` | `/sessions/:id` | `DELETE` |
| `bridge_list` | `/sessions` | `GET` |

Additional endpoints not exposed via MCP:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | `GET` | Health check — JSON with status, session count, uptime |
| `/dashboard` | `GET` | Browser dashboard (HTML) |
| `/sessions/:id/status` | `GET` | Single session status and metadata |

### POST /sessions

```json
{
  "workdir": "/path/to/project",
  "spawn_args": ["--allowedTools", "mcp__method__*"],
  "initial_prompt": "optional initial prompt",
  "metadata": { "methodology_session_id": "council-run-1" }
}
```

Response: `{ "session_id": "abc-123", "status": "ready" }`

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

Response: array of `{ session_id, status, queue_depth, metadata }`

### Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3456` | HTTP listen port |
| `CLAUDE_BIN` | `claude` | Path to Claude Code binary |
| `MAX_SESSIONS` | `5` | Max concurrent PTY sessions |
| `SETTLE_DELAY_MS` | `2000` | Response completion debounce |
| `DEAD_SESSION_TTL_MS` | `300000` | Auto-cleanup TTL for dead sessions (5 min) |
| `CLAUDE_OAUTH_TOKEN` | *(auto-loaded)* | Enables subscription usage meters in dashboard |
| `USAGE_POLL_INTERVAL_MS` | `60000` | Subscription usage poll interval |
| `CLAUDE_SESSIONS_DIR` | `~/.claude/projects` | Base dir for Claude Code session logs |
