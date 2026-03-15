# MCP Layer

## Responsibility

`packages/mcp/src/index.ts` is a thin adapter. It:

1. Resolves filesystem paths (see [path-resolution.md](path-resolution.md))
2. Creates session managers via `createSessionManager()` and `createMethodologySessionManager()`
3. Defines 23 MCP tools with Zod input schemas
4. Maps each tool call to a core function
5. Formats responses and catches errors

**No business logic lives here.** If a function does more than validate → call core → format, it belongs in core.

## Tool Definitions

| Tool | Input Schema | Core Function | Notes |
|------|-------------|---------------|-------|
| `methodology_list` | `{ session_id?: string }` | `listMethodologies(REGISTRY)` | |
| `methodology_load` | `{ methodology_id: string, method_id: string, session_id?: string }` | `loadMethodology(REGISTRY, mid, methid)` → `session.load(result)` | Returns enriched response from core |
| `methodology_status` | `{ session_id?: string }` | `session.status()` | |
| `step_current` | `{ session_id?: string }` | `session.current()` | Returns context envelope from core |
| `step_advance` | `{ session_id?: string }` | `session.advance()` | Returns enriched response from core |
| `theory_lookup` | `{ term: string, session_id?: string }` | `lookupTheory(THEORY, term)` | |
| `methodology_get_routing` | `{ methodology_id: string, session_id?: string }` | `getMethodologyRouting(REGISTRY, mid)` | PRD 003 Phase 1 |
| `step_context` | `{ session_id?: string }` | `session.context()` | PRD 003 Phase 1 |
| `methodology_select` | `{ methodology_id: string, selected_method_id: string, session_id?: string }` | `selectMethodology(REGISTRY, mid, methid, session, sid)` | PRD 003 Phase 3. Also creates MethodologySession for backward compat (PRD 004). |
| `step_validate` | `{ step_id: string, output: object, session_id?: string }` | `validateStepOutput(session, stepId, output)` | PRD 003 Phase 3 |
| `methodology_start` | `{ methodology_id: string, challenge?: string, session_id?: string }` | `startMethodologySession(REGISTRY, mid, challenge, sid)` | PRD 004 Phase 1 |
| `methodology_route` | `{ challenge_predicates?: object, session_id?: string }` | `routeMethodology(REGISTRY, methSession, predicates)` | PRD 004 Phase 2 |
| `methodology_load_method` | `{ method_id: string, session_id?: string }` | `loadMethodInSession(REGISTRY, methSession, mid, session, sid)` | PRD 004 Phase 2 |
| `methodology_transition` | `{ completion_summary?: string, challenge_predicates?: object, session_id?: string }` | `transitionMethodology(REGISTRY, methSession, session, summary, predicates)` | PRD 004 Phase 3 |
| `bridge_spawn` | `{ workdir, spawn_args?, initial_prompt?, session_id? }` | HTTP proxy | PRD 005 Phase 1 |
| `bridge_prompt` | `{ bridge_session_id, prompt, timeout_ms?, settle_delay_ms? }` | HTTP proxy | PRD 005 Phase 1+3 |
| `bridge_kill` | `{ bridge_session_id }` | HTTP proxy | PRD 005 Phase 1 |
| `bridge_list` | `{}` | HTTP proxy | PRD 005 Phase 1 |
| `bridge_progress` | `{ bridge_session_id: string, type: string, content: object }` | HTTP proxy | PRD 008 — agent reports progress |
| `bridge_event` | `{ bridge_session_id: string, type: string, content: object }` | HTTP proxy | PRD 008 — agent reports lifecycle events |
| `bridge_read_progress` | `{ bridge_session_id: string, since_sequence?: number }` | HTTP proxy | PRD 008 — parent reads child progress |
| `bridge_read_events` | `{ bridge_session_id: string, since_sequence?: number }` | HTTP proxy | PRD 008 — parent reads child events |
| `bridge_all_events` | `{ since_sequence?: number, filter_type?: string }` | HTTP proxy | PRD 008 — cross-session event aggregation |

`session_id` is optional on all tools (P3). When omitted, the MCP layer passes `"__default__"` to both the SessionManager and MethodologySessionManager. See [state-model.md](state-model.md) for session design.

## Bridge Proxy Tools

PRD 005 Phase 1 introduces four bridge proxy tools (`bridge_spawn`, `bridge_prompt`, `bridge_kill`, `bridge_list`). These are thin HTTP transport adapters, NOT core function wrappers. They proxy requests to the bridge HTTP API and relay responses back through MCP.

**Configuration:**
- `BRIDGE_URL` environment variable (default: `http://localhost:3456`)

**Starting the bridge:** `npm run bridge` from the repo root. The launcher script (`scripts/start-bridge.js`) auto-loads `CLAUDE_OAUTH_TOKEN` from `~/.claude/.credentials.json` for subscription usage meters.

**HTTP client:** Node.js built-in `fetch` (Node 18+). No additional HTTP library dependency.

**Error pattern:** All `fetch` errors are wrapped with a `"Bridge error:"` prefix to distinguish transport failures from methodology domain errors. This lets the orchestrating agent differentiate between "the bridge is down" and "the methodology logic rejected the input."

**Design rationale:** The proxy tools follow DR-04's spirit (thin wrappers) but the wrapped target is HTTP instead of core. There is no compile-time dependency between `@method/mcp` and `@method/bridge` — communication is HTTP only. The MCP server does not import any bridge types or modules.

The 5 channel tools added by PRD 008 follow the same HTTP proxy pattern as the existing 4 bridge tools.

### Channel Tools (PRD 008)

PRD 008 adds 5 channel proxy tools for agent visibility. These follow the same HTTP proxy pattern as the existing bridge tools:

- **Agent-side:** `bridge_progress` and `bridge_event` POST messages to bridge channel endpoints
- **Parent-side:** `bridge_read_progress` and `bridge_read_events` read messages with consumption cursors
- **Council/cross-cutting:** `bridge_all_events` aggregates events across all sessions

Auto-progress: The `step_advance` handler checks for `BRIDGE_URL` and `BRIDGE_SESSION_ID` environment variables. When present (i.e., agent is running in a bridge session), it automatically POSTs `step_completed` and `step_started` messages to the bridge progress endpoint after each step transition. This gives methodology-driven agents free progress reporting.

## Error Handling

Core functions throw plain `Error` with descriptive messages. The MCP layer catches all errors uniformly:

```typescript
try {
  const result = coreFunction(...);
  return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
} catch (e) {
  return { content: [{ type: "text", text: (e as Error).message }], isError: true };
}
```

No error codes, no error taxonomies. The message is the interface. The agent reads it and acts.

### Dual Error Model (PRD 005)

With the addition of bridge proxy tools, the MCP layer has two distinct error paths:

- **Methodology tools:** catch core function errors → return `{ isError: true, text: message }`
- **Bridge proxy tools:** catch `fetch` errors → wrap with `"Bridge error:"` prefix → return `{ isError: true, text: message }`

The prefix convention lets agents distinguish transport failures (bridge unavailable, network timeout) from domain errors (invalid session ID, methodology not found) without needing structured error codes.

## Response Formatting

Tool responses are JSON-stringified core return values. The MCP layer does not construct or enrich response payloads — enrichment logic lives in core (DR-04). MCP serializes whatever core returns.

## Response Formats (P1 — Enriched Responses)

### `methodology_load`

```json
{
  "methodologyId": "P0-META",
  "methodId": "M1-MDES",
  "methodName": "Method Design from Established Domain Knowledge",
  "stepCount": 7,
  "objective": "Design a validated methodology...",
  "firstStep": { "id": "S1", "name": "Domain Retraction" },
  "message": "Loaded M1-MDES — Method Design from Established Domain Knowledge (7 steps). Call step_current to see the first step."
}
```

### `step_current`

Context envelope — gives the agent its position within the method alongside the step record:

```json
{
  "methodologyId": "P0-META",
  "methodId": "M1-MDES",
  "stepIndex": 0,
  "totalSteps": 7,
  "step": {
    "id": "S1",
    "name": "Domain Retraction",
    "role": "designer",
    "precondition": "Domain literature reviewed",
    "postcondition": "Retracted principles documented",
    "guidance": "...",
    "outputSchema": { "...": "..." }
  }
}
```

### `step_advance`

Enriched with navigation context — previous/next step identifiers and position:

```json
{
  "methodologyId": "P0-META",
  "methodId": "M1-MDES",
  "previousStep": { "id": "S1", "name": "Domain Retraction" },
  "nextStep": { "id": "S2", "name": "Morphism Framing" },
  "stepIndex": 1,
  "totalSteps": 7
}
```

When advancing to the terminal step, `nextStep` is `null` to signal method completion.

### `methodology_get_routing`

Returns the transition function structure for agent-side evaluation. See [routing.md](routing.md) for extraction details.

```json
{
  "methodologyId": "P2-SD",
  "name": "Software Delivery Methodology",
  "predicates": [
    {
      "name": "task_type",
      "description": "The challenge is of the given task type",
      "trueWhen": null,
      "falseWhen": null
    },
    {
      "name": "task_type = section",
      "description": null,
      "trueWhen": "The challenge is a full PRD document that needs to be decomposed...",
      "falseWhen": "The PRD is already a single section..."
    }
  ],
  "arms": [
    {
      "priority": 1,
      "label": "section",
      "condition": "NOT is_method_selected(s) AND task_type(challenge, section)",
      "selects": "M7-PRDS",
      "rationale": "Full PRD needs sectioning before any downstream work."
    }
  ],
  "evaluationOrder": "1. Is this a full PRD needing sectioning? If yes: section. ..."
}
```

### `step_context`

Enriched context envelope for prompt composition — a superset of `step_current`:

```json
{
  "methodology": {
    "id": "P0-META",
    "name": "Meta-Methodology",
    "progress": "3 / 7"
  },
  "method": {
    "id": "M1-MDES",
    "name": "Method Design from Established Domain Knowledge",
    "objective": "Design a validated methodology..."
  },
  "step": {
    "id": "S3",
    "name": "Morphism Framing",
    "role": "designer",
    "precondition": "Retracted principles documented",
    "postcondition": "Morphisms defined",
    "guidance": "...",
    "outputSchema": { "...": "..." }
  },
  "stepIndex": 2,
  "totalSteps": 7,
  "priorStepOutputs": []
}
```

`priorStepOutputs` is populated by `step_validate` (Phase 3). Returns recorded outputs for steps before the current step index. `priorMethodOutputs` (PRD 004) returns outputs from completed methods in the methodology session.

### `methodology_select`

Records a routing decision and initializes a methodology-level session:

```json
{
  "methodologySessionId": "my-session",
  "selectedMethod": {
    "methodId": "M1-IMPL",
    "name": "Method for Implementing Software from Architecture and PRDs",
    "stepCount": 9,
    "firstStep": { "id": "sigma_A1", "name": "Inventory" }
  },
  "message": "Selected M1-IMPL — Method for Implementing Software... (9 steps) under Software Delivery Methodology. Call step_context to get the first step's context."
}
```

Sets the methodology context so `step_context` returns the correct methodology name (not the method name).

### `step_validate`

Validates sub-agent output against the current step's output schema and postconditions:

```json
{
  "valid": true,
  "findings": [],
  "postconditionMet": true,
  "recommendation": "advance"
}
```

Recommendation values: `"advance"` (all clear), `"retry"` (schema errors), `"escalate"` (postcondition not met). Output is always recorded in the session regardless of validation result — `step_context` returns it in `priorStepOutputs` for subsequent steps.

### `methodology_start` (PRD 004)

Initializes a methodology-level session:

```json
{
  "methodologySessionId": "my-session",
  "methodology": {
    "id": "P1-EXEC",
    "name": "Execution Methodology",
    "objective": "∀s ∈ S: method_completed(s) ...",
    "methodCount": 3
  },
  "transitionFunction": {
    "predicateCount": 12,
    "armCount": 6
  },
  "status": "initialized",
  "message": "Methodology P1-EXEC initialized. Call methodology_route to evaluate δ_Φ and select the first method."
}
```

### `methodology_route` (PRD 004)

Evaluates δ_Φ and returns routing decision:

```json
{
  "methodologyId": "P1-EXEC",
  "evaluatedPredicates": [
    { "name": "adversarial_pressure_beneficial", "value": true, "source": "provided" },
    { "name": "is_method_selected", "value": false, "source": "inferred" }
  ],
  "selectedArm": {
    "priority": 1,
    "label": "adversarial_dispatch",
    "condition": "NOT is_method_selected(s) AND adversarial_pressure_beneficial(s.challenge)",
    "rationale": "Adversarial debate produces better outcomes..."
  },
  "selectedMethod": {
    "id": "M1-COUNCIL",
    "name": "Adversarial Council",
    "stepCount": 5,
    "description": "..."
  },
  "priorMethodsCompleted": [],
  "message": "Route selected: adversarial_dispatch → M1-COUNCIL. Call methodology_load_method to load it."
}
```

### `methodology_load_method` (PRD 004)

Loads a method within the active methodology session:

```json
{
  "methodologySessionId": "my-session",
  "method": {
    "id": "M3-TMP",
    "name": "Sequential Task Method",
    "stepCount": 3,
    "firstStep": { "id": "sigma_0", "name": "Task Analysis" }
  },
  "methodologyProgress": {
    "methodsCompleted": 1,
    "methodsRemaining": "unknown",
    "currentMethodIndex": 1
  },
  "priorMethodOutputs": [
    { "methodId": "M1-COUNCIL", "stepOutputs": [{ "stepId": "sigma_1", "summary": "..." }] }
  ],
  "message": "Loaded M3-TMP — Sequential Task Method (3 steps) under Execution Methodology."
}
```

### `methodology_transition` (PRD 004)

Completes the current method and re-evaluates δ_Φ:

```json
{
  "completedMethod": {
    "id": "M3-TMP",
    "name": "M3-TMP",
    "stepCount": 3,
    "outputsRecorded": 2
  },
  "methodologyProgress": {
    "methodsCompleted": 2,
    "globalObjectiveStatus": "in_progress"
  },
  "nextMethod": {
    "id": "M1-COUNCIL",
    "name": "Adversarial Council",
    "stepCount": 5,
    "description": "...",
    "routingRationale": "Review results of dispatched task."
  },
  "message": "M3-TMP completed. δ_Φ re-evaluated → M1-COUNCIL selected. Call methodology_load_method to begin."
}
```

When methodology is complete, `nextMethod` is `null` and `globalObjectiveStatus` is `"satisfied"`.

### Design Note

All enrichment is computed by core functions. The MCP layer's only job is `JSON.stringify(result, null, 2)`. This keeps MCP as a thin wrapper (DR-04) and ensures core has zero transport dependencies (DR-03).

## Tool Descriptions

Tool descriptions are what the agent reads to decide which tool to call. They must be concise and action-oriented:

- `methodology_list`: "List all available methodologies and methods in the registry with their descriptions."
- `methodology_load`: "Load a method into the active session. Provide methodology_id and method_id."
- `methodology_status`: "Show what method is loaded, the current step, and progress."
- `step_current`: "Get the full record for the current step: guidance, preconditions, output schema."
- `step_advance`: "Mark the current step complete and advance to the next step."
- `theory_lookup`: "Search the formal theory (F1-FTH, F4-PHI) for a term or definition."
- `methodology_get_routing`: "Get the routing criteria for a methodology — predicates and transition function arms for agent-side evaluation."
- `step_context`: "Get enriched context for the current step: methodology progress, method objective, step record, and prior outputs."
- `methodology_select`: "Record a routing decision and initialize a methodology-level session. Loads the selected method and tracks the methodology context."
- `step_validate`: "Validate a sub-agent's output against the current step's output schema and postconditions. Records the output for step_context's prior_step_outputs."
- `methodology_start`: "Start a methodology-level session that tracks global state across method transitions. Returns methodology metadata and transition function summary."
- `methodology_route`: "Evaluate δ_Φ against current state and return the recommended method with routing rationale. Requires an active methodology session."
- `methodology_load_method`: "Load a specific method within the active methodology session. Prior method outputs will be available in step_context."
- `methodology_transition`: "Complete the current method and evaluate δ_Φ for the next method. Returns the completed method summary and next method recommendation."
