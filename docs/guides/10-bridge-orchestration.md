# Guide 10 — Bridge Orchestration: Multi-Method Sessions with Sub-Agents

How to use the bridge (`@method/bridge`) together with the runtime methodology tools (PRD 004) to orchestrate multi-method sessions where sub-agents execute methods autonomously.

## The Problem This Solves

Without the bridge, an orchestrator runs every method in its own context window. This works for simple sequences but fails for pv-agi's steering council pattern: a council debate (M1-COUNCIL) produces a decision, then a sub-agent executes the dispatched task (M3-TMP), then the council reviews the result. The orchestrator can't do all three without burning its context window on implementation details.

With the bridge + PRD 004 tools, the orchestrator:
1. Uses MCP tools for methodology routing and session management
2. Uses the bridge HTTP API to spawn sub-agents that execute each method
3. Records outputs via `step_validate`, which flow automatically to the next method via `priorMethodOutputs`

## Architecture

```
Orchestrator (human's Claude Code session)
    │
    ├── MCP tools ──→ @method/mcp ──→ @method/core
    │   methodology_start        (initialize session)
    │   methodology_route         (evaluate δ_Φ)
    │   methodology_load_method   (load method in session)
    │   step_context              (get step + prior method outputs)
    │   step_validate             (record outputs)
    │   step_advance              (advance steps)
    │   methodology_transition    (complete method, re-route)
    │
    └── HTTP API ──→ @method/bridge
        POST /sessions            (spawn sub-agent)
        POST /sessions/:id/prompt (send step prompt)
        DELETE /sessions/:id      (cleanup)
```

The MCP server and bridge are peers. The orchestrator calls both — MCP for methodology intelligence, bridge for agent labor. The bridge is methodology-unaware: it just spawns agents and relays prompts.

## Session ID Correlation

The methodology session (`methodology_start`) and bridge sessions (`POST /sessions`) use independent IDs. The orchestrator tracks the mapping:

```
Methodology session "council-run-1"
  └── Bridge session "abc-123" (spawned for M1-COUNCIL execution)
  └── Bridge session "def-456" (spawned for M3-TMP execution)
```

The methodology session ID is passed to all MCP tool calls. Bridge session IDs are ephemeral — created per method execution, destroyed after the method completes.

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

### Step 4: Spawn a sub-agent via bridge

```http
POST /sessions
{ "workdir": "/path/to/project" }
→ { "session_id": "abc-123", "status": "ready" }
```

### Step 5: Execute the method steps via the sub-agent

For each step in the method, the orchestrator:

a. Gets the step context (includes prior method outputs):
```
step_context()
→ { step: { id: "sigma_1", guidance: "..." }, priorMethodOutputs: [...] }
```

b. Composes a prompt for the sub-agent using the step context and sends it via bridge:
```http
POST /sessions/abc-123/prompt
{ "prompt": "You are executing sigma_1 of M1-COUNCIL. <step context here>..." }
→ { "output": "...", "timed_out": false }
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

```http
DELETE /sessions/abc-123
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

If a sub-agent's PTY session dies (`status: "dead"`), the orchestrator should:
1. Check what outputs were already recorded via `step_context.priorStepOutputs`
2. Spawn a new bridge session
3. Resume from the current step (the methodology session tracks position)

### Transition fails (no matching arm)

If `methodology_transition` returns `nextMethod: null` unexpectedly:
1. Check the `evaluatedPredicates` — are the provided predicates correct?
2. The methodology may be complete (check `globalObjectiveStatus`)
3. Re-route with different predicates if the objective isn't satisfied

### Bridge timeout

If a prompt times out (`timed_out: true`), the partial output may still be usable. Check the output, and either:
- Retry the prompt with a longer timeout
- Record the partial output and let the orchestrator decide whether to advance or retry

## Prerequisites

1. **Bridge server running:** `cd packages/bridge && npm start` (default port 3456)
2. **MCP server configured:** `.mcp.json` in the project workdir so spawned agents connect to the method MCP server
3. **Claude Code available:** The `CLAUDE_BIN` environment variable (or `claude` on PATH) must point to the Claude Code binary

## Relationship to Guide 8

Guide 8 covers orchestrator prompt design — how to write the initial prompt that sets up the orchestrating agent's role, methodology binding, and sub-agent instructions. This guide (10) covers what happens at runtime — the actual tool calls and bridge API interactions during a multi-method session.

Use Guide 8 to write the orchestrator prompt. Use this guide to understand the execution mechanics.
