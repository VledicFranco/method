# MCP Layer

## Responsibility

`packages/mcp/src/index.ts` is a thin adapter. It:

1. Resolves filesystem paths (see [path-resolution.md](path-resolution.md))
2. Creates one session instance via `createSession()`
3. Defines 6 MCP tools with Zod input schemas
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
  "methodologyId": "M1-MDES",
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
  "methodologyId": "M1-MDES",
  "methodId": "M1-MDES",
  "stepIndex": 0,
  "totalSteps": 7,
  "step": {
    "id": "S1",
    "name": "Domain Retraction",
    "guidance": "...",
    "preconditions": ["..."],
    "output_schema": { "...": "..." }
  }
}
```

### `step_advance`

Enriched with navigation context — previous/next step identifiers and position:

```json
{
  "methodologyId": "M1-MDES",
  "methodId": "M1-MDES",
  "previousStep": { "id": "S1", "name": "Domain Retraction" },
  "nextStep": { "id": "S2", "name": "Morphism Framing" },
  "stepIndex": 1,
  "totalSteps": 7
}
```

When advancing to the terminal step, `nextStep` is `null` to signal method completion.

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
