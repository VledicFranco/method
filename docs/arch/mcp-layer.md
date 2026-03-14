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

| Tool | Input Schema | Core Function |
|------|-------------|---------------|
| `methodology_list` | `{}` | `listMethodologies(REGISTRY)` |
| `methodology_load` | `{ methodology_id: string, method_id: string }` | `loadMethodology(REGISTRY, mid, methid)` → `session.load(result)` |
| `methodology_status` | `{}` | `session.status()` |
| `step_current` | `{}` | `session.current()` |
| `step_advance` | `{}` | `session.advance()` |
| `theory_lookup` | `{ term: string }` | `lookupTheory(THEORY, term)` |

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

Tool responses are JSON-stringified core return values, with one exception: `methodology_load` appends a next-action hint:

```
Loaded M1-MDES — Method Design from Established Domain Knowledge (7 steps).
Call step_current to see the first step.
```

`step_current` returns the step record as structured JSON — the guidance text is the primary content the agent needs.

## Tool Descriptions

Tool descriptions are what the agent reads to decide which tool to call. They must be concise and action-oriented:

- `methodology_list`: "List all available methodologies and methods in the registry with their descriptions."
- `methodology_load`: "Load a method into the active session. Provide methodology_id and method_id."
- `methodology_status`: "Show what method is loaded, the current step, and progress."
- `step_current`: "Get the full record for the current step: guidance, preconditions, output schema."
- `step_advance`: "Mark the current step complete and advance to the next step."
- `theory_lookup`: "Search the formal theory (F1-FTH, F4-PHI) for a term or definition."
