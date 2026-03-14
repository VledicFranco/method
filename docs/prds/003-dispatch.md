# PRD — P3-DISPATCH: Methodology-Driven Agent Orchestration

**Status:** Draft
**Date:** 2026-03-14
**Scope:** Orchestration methodology + PTY bridge package + methodology-level MCP tools
**Depends on:** 001-mvp (completed), 002-post-mvp (P1 richer responses, P3 session isolation)
**Evidence:** EXP-001 (concurrent access findings), ov-oss/concepts/claude-pty-bridge.md (POC)

---

## Purpose

The MVP (001) proved that an MCP server can serve methodology content to agents. But execution is still manual — the agent loads a method, reads guidance, does the work, advances the step. The human must drive every session.

P3-DISPATCH closes the loop: **the methodology drives the agents**. A human (or automated orchestrator) loads a target methodology, the system evaluates which method to run, spawns Claude Code agents to execute it, validates their output, and advances — at whatever autonomy level the human chooses.

This requires three components:

1. **P3-DISPATCH** — a new methodology encoding three autonomy modes as methods
2. **`@method/bridge`** — a PTY bridge package that spawns and manages Claude Code agent sessions
3. **4 new MCP tools** — methodology-level routing, step context, and output validation

---

## Problem

After the MVP, executing a methodology requires an agent that:
- Knows which methodology applies and which method δ_Φ selects
- Understands how to compose a prompt for each step's guidance
- Can spawn sub-agents to execute steps in isolated sessions
- Validates outputs against postconditions before advancing
- Handles failures (retry, escalate, abort) according to a defined policy

None of this is encoded or automated today. The agent must figure it all out from raw guidance text. There is no structured support for transition function evaluation, no prompt composition from step context, no output validation, and no agent spawning infrastructure.

---

## Component 1: P3-DISPATCH Methodology

A methodology Φ_DISPATCH with three methods corresponding to autonomy levels.

### Domain Theory (D_Φ_DISPATCH)

Sorts:
- `TargetMethodology` — the methodology being executed (e.g., P2-SD)
- `TargetMethod` — the method selected by δ_Φ of the target (e.g., M1-IMPL)
- `AutonomyMode` — enum: `{INTERACTIVE, SEMIAUTO, FULLAUTO}`
- `DecisionPoint` — a point requiring human or agent judgment
- `EscalationChannel` — how to reach the human: `{TERMINAL, SLACK, ASYNC_REVIEW}`
- `AgentSession` — a spawned Claude Code agent executing a method step
- `StepOutput` — the result produced by an agent for a step
- `ValidationResult` — PASS/FAIL from postcondition checking

Key predicates:
- `requires_human(DecisionPoint)` — this decision exceeds the agent's authority in the current mode
- `within_budget(AgentSession)` — retry count < max for this step
- `validated(StepOutput, Step)` — output satisfies step postconditions

### Methods

#### M1-INTERACTIVE — Human-in-the-loop dispatch

Every decision point blocks for human confirmation.

| Decision Point | Behavior |
|---------------|----------|
| δ_Φ method selection | Human confirms routing |
| Step go/no-go (e.g., σ_A4) | Human confirms |
| Postcondition failure | Human decides: retry, skip, abort |
| Scope change / divergence | Human approves |
| Methodology complete | Human confirms |

Role structure: human is rho_PO with authority over all transitions. Agent is rho_executor — executes but does not decide. Communication channel: TERMINAL (interactive session).

#### M2-SEMIAUTO — Selective escalation dispatch

Agent handles clear decisions autonomously. Escalates on ambiguity.

| Decision Point | Behavior |
|---------------|----------|
| δ_Φ method selection | Agent decides if predicates are clear; escalates if borderline |
| Step go/no-go | Agent decides if postconditions pass cleanly; escalates on partial/unclear |
| Postcondition failure | Agent retries once with failure context; escalates on second failure |
| Scope change / divergence | Agent records and continues if minor (<30 lines); escalates if major |
| Methodology complete | Human notified |

Role structure: agent is rho_executor with conditional authority. Human is rho_PO with escalation authority. Communication channel: configurable (TERMINAL, SLACK, or ASYNC_REVIEW).

Escalation criteria (operationalized):
- **Borderline predicate:** agent cannot confidently assign TRUE/FALSE — names the uncertainty
- **Partial postcondition:** output satisfies some but not all schema fields
- **Major scope change:** affects files outside the step's declared scope

#### M3-FULLAUTO — Unattended dispatch

Agent drives end-to-end. Human is notified on completion or hard failure.

| Decision Point | Behavior |
|---------------|----------|
| δ_Φ method selection | Agent decides |
| Step go/no-go | Agent decides |
| Postcondition failure | Agent retries up to N times (default 3) with cumulative failure context |
| Scope change / divergence | Agent records and continues |
| Methodology complete | Human notified asynchronously |
| Budget exhausted (N retries failed) | Abort methodology, notify human with failure log |

Role structure: agent is rho_executor with full authority. Human is rho_observer — notified, not consulted. Communication channel: ASYNC_REVIEW (Slack, email, or dashboard).

### Transition Function (δ_DISPATCH)

```
δ_DISPATCH(s) =
  case autonomy_mode(s) of
    INTERACTIVE → Some(M1-INTERACTIVE)
    SEMIAUTO    → Some(M2-SEMIAUTO)
    FULLAUTO    → Some(M3-FULLAUTO)
```

Autonomy mode is set at methodology initialization and does not change mid-execution. The transition function fires once. The selected method drives the full target methodology execution.

### Termination

Each method terminates when:
- The target methodology's objective O_Φ is satisfied, OR
- The agent exhausts its retry budget and aborts (FULLAUTO only), OR
- The human terminates the session (INTERACTIVE / SEMIAUTO)

Certificate: ν_DISPATCH = ν_target (the target methodology's own certificate). P3-DISPATCH adds no additional loop — it wraps the target's execution.

---

## Component 2: `@method/bridge` Package

A standalone Node.js HTTP server that manages a pool of Claude Code PTY sessions. Lives at `packages/bridge/` in the monorepo.

### Architecture

```
packages/bridge/
├── src/
│   ├── index.ts          HTTP server (Fastify), session pool routes
│   ├── pty-session.ts    Single PTY session manager (spawn, prompt, kill)
│   ├── pool.ts           Session pool (Map<id, PtySession>)
│   └── parser.ts         PTY output extraction (●-based parser)
├── package.json          @method/bridge
└── tsconfig.json
```

**NOT an MCP server.** Standalone HTTP service. No MCP dependency. No methodology awareness — it spawns Claude Code sessions and relays prompts. The methodology intelligence comes from the MCP tools the orchestrator calls separately.

### API

#### `POST /sessions`

Spawn a new Claude Code agent session.

```
Input:  { workdir: string, initial_prompt?: string }
Output: { session_id: string, status: "ready" }
Error:  Spawn failure, startup timeout
```

`workdir` determines which `.mcp.json` the spawned agent picks up, giving it access to the method MCP tools. `initial_prompt` is sent immediately after the session is ready.

#### `POST /sessions/:id/prompt`

Send a prompt to an agent and wait for the response.

```
Input:  { prompt: string, timeout_ms?: number }
Output: { output: string, timed_out: boolean }
Error:  Session not found, session dead
```

Per-session prompt queue with concurrency 1. Requests are serialized — only one prompt in-flight per session at a time.

#### `GET /sessions/:id/status`

```
Output: { session_id, status: "initializing" | "ready" | "working" | "dead", queue_depth: number }
```

#### `DELETE /sessions/:id`

Kill the agent session and clean up the PTY.

```
Output: { session_id, killed: true }
```

#### `GET /sessions`

```
Output: [{ session_id, status, queue_depth }]
```

### Configuration

```
PORT              HTTP port (default: 3456)
CLAUDE_BIN        Path to claude.exe (default: "claude")
CLAUDE_WORKDIR    Default workdir for new sessions (default: cwd)
SETTLE_DELAY_MS   Debounce for response completion (default: 2000)
MAX_SESSIONS      Pool size limit (default: 5)
```

### Output Parsing

Uses the validated approach from the POC:
1. Slice from `●` marker to end of buffer
2. Replace `\x1b[1C` (cursor-right) with space
3. Strip ANSI escape sequences
4. Simulate `\r` (carriage return) overwriting
5. Cut at `❯` (input prompt)
6. Filter TUI chrome patterns
7. Completion detection via debounce (no new data for SETTLE_DELAY_MS)

### Dependencies

```
node-pty       PTY spawning (prebuilt binaries, no compilation needed)
fastify        HTTP server
p-queue        Per-session prompt serialization
strip-ansi     ANSI escape stripping
```

### Relationship to MCP Server

The bridge and MCP server are peers, not parent-child:

```
Human's Claude Code session (P3-DISPATCH orchestrator)
    ├── MCP tools ──→ @method/mcp (methodology intelligence)
    │                    └── reads registry/, theory/
    └── HTTP API ──→ @method/bridge (agent spawning)
                         └── spawns Claude Code agents via PTY
                               └── each agent has own MCP connection
```

No circular dependency. Spawned agents connect to the method MCP server through their workdir's `.mcp.json` — a separate server process from the orchestrator's.

---

## Component 3: New MCP Tools (4)

Added to `@method/mcp`. Depend on new `@method/core` functions.

### `methodology_get_routing`

Return the transition function structure for a methodology, including predicate operationalizations.

```
Input:  { methodology_id: string }
Output: {
  methodology_id, name,
  predicates: [{ name, description, true_when, false_when }],
  arms: [{ priority, label, condition, selects, rationale }],
  evaluation_order: string
}
Error:  Methodology not found; YAML has no transition_function
```

The orchestrating agent reads the predicates, evaluates them against the challenge, and determines which arm fires. This is Option A — server returns criteria, agent evaluates.

### `methodology_select`

Record the agent's routing decision and initialize a methodology-level session.

```
Input:  { methodology_id: string, selected_method_id: string, session_id?: string }
Output: {
  methodology_session_id,
  selected_method: { method_id, name, step_count, first_step },
  message: "Selected M1-IMPL (9 steps) under P2-SD. Call step_context to get the first step's context."
}
Error:  Methodology not found; method_id not in methodology's repertoire
```

Creates a methodology-level session that wraps a method session. Tracks which method is executing and why.

### `step_context`

Return an enriched context bundle for a step — everything an orchestrator needs to compose a sub-agent prompt.

```
Input:  { session_id?: string }
Output: {
  methodology: { id, name, progress },
  method: { id, name, objective },
  step: { id, name, role, precondition, postcondition, guidance, output_schema },
  stepIndex: number,
  totalSteps: number,
  prior_step_outputs: [{ step_id, summary }]
}
Error:  No session loaded
```

Difference from `step_current`: includes methodology context, method objective, and prior step output summaries. Designed for prompt composition — the orchestrator wraps this in a prompt for the spawned agent.

### `step_validate`

Validate a sub-agent's output against the step's output schema and postconditions.

```
Input:  { step_id: string, output: object, session_id?: string }
Output: {
  valid: boolean,
  findings: [{ field, issue, severity }],
  postcondition_met: boolean,
  recommendation: "advance" | "retry" | "escalate"
}
Error:  No session loaded; step_id mismatch with current step
```

Checks:
- Required fields present in output
- Field types match schema
- Hard invariants satisfied
- Postcondition text matched against output (heuristic — keyword/structural check, not formal verification)

The `recommendation` field suggests what the orchestrator should do based on the validation result and the current autonomy mode's failure policy.

---

## Out of Scope

- **Formal predicate evaluation (Option B/C)** — the server returns criteria, the agent evaluates. Automated predicate evaluation is a future extension.
- **Multi-bridge orchestration** — single bridge instance. Pool of sessions within one bridge, not multiple bridge servers.
- **Compiled P3-DISPATCH YAML** — the methodology is designed in this PRD but compiled via M1-MDES separately.
- **PTY bridge deployment automation** — Tailscale setup, VPS provisioning, etc. are infrastructure concerns outside this PRD.
- **Learning from execution history** — adaptive δ_Φ (Extension E3 from F1-FTH) is post-P3-DISPATCH.

---

## Implementation Order

### Phase 1: New MCP tools (`methodology_get_routing`, `step_context`)

Smallest scope, immediately useful. An orchestrating agent can evaluate routing and compose sub-agent prompts even without the bridge (using native Claude Code agent spawning).

### Phase 2: `@method/bridge` package

Port the POC from `ov-oss/tmp/claude-pty-bridge/` into `packages/bridge/`. Add session pool management. Validate with manual HTTP calls.

### Phase 3: `methodology_select` + `step_validate` tools

Complete the methodology-level session and validation loop. Requires Phase 1.

### Phase 4: P3-DISPATCH methodology design

Design and compile via M1-MDES. Produces the P3-DISPATCH YAML for the registry. Requires the tools and bridge to exist so the methodology can reference concrete capabilities.

### Phase 5: Integration validation

Spawn an orchestrating agent that uses P3-DISPATCH to execute P2-SD/M1-IMPL end-to-end. Validate all three autonomy modes. Write results to `docs/exp/`.

---

## Success Criteria

1. An agent can call `methodology_get_routing("P2-SD")` and receive the full δ_SD condition table with operationalized predicates
2. An agent can call `step_context` and receive a bundle sufficient to compose a sub-agent prompt (without reading the YAML directly)
3. An agent can call `step_validate` with sub-agent output and get a structured PASS/FAIL with findings
4. The bridge can spawn 3 concurrent Claude Code sessions, send prompts to each, and receive clean responses
5. An orchestrating agent running M1-INTERACTIVE can execute P2-SD/M1-IMPL Phase A (4 steps) with human confirmation at σ_A4
6. An orchestrating agent running M3-FULLAUTO can execute P2-SD/M1-IMPL Phase A without human intervention, retrying on validation failure
