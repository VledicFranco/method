# MCP Layer

## Responsibility

`packages/mcp/src/index.ts` is a thin adapter. It:

1. Resolves filesystem paths (see [path-resolution.md](path-resolution.md))
2. Creates one session instance via `createSession()`
3. Defines 10 MCP tools with Zod input schemas
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
| `methodology_select` | `{ methodology_id: string, selected_method_id: string, session_id?: string }` | `selectMethodology(REGISTRY, mid, methid, session, sid)` | PRD 003 Phase 3 |
| `step_validate` | `{ step_id: string, output: object, session_id?: string }` | `validateStepOutput(session, stepId, output)` | PRD 003 Phase 3 |

`session_id` is optional on all tools (P3). When omitted, the MCP layer passes `"__default__"` to the SessionManager. See [state-model.md](state-model.md) for SessionManager design.

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

`priorStepOutputs` is populated by `step_validate` (Phase 3). Returns recorded outputs for steps before the current step index.

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
