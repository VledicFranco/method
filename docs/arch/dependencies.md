# Dependencies

## New Dependencies

| Package | Added to | Purpose |
|---------|----------|---------|
| `js-yaml` | `@method/core` | YAML parsing for registry files |
| `@types/js-yaml` | `@method/core` (dev) | TypeScript types for js-yaml |

## Existing Dependencies (no changes)

| Package | Package | Purpose |
|---------|---------|---------|
| `@modelcontextprotocol/sdk` | `@method/mcp` | MCP server protocol |
| `zod` | `@method/mcp` | Input validation for MCP tools |
| `typescript` | root (dev) | Build |
| `tsx` | root (dev) | Dev execution |
| `@types/node` | root (dev) | Node.js types |

## Dependency Principles

- `@method/core` has **no MCP dependency** — it's a pure domain library
- `@method/mcp` depends on `@method/core` and MCP SDK — it's the adapter
- No runtime dependencies beyond `js-yaml` in core and `zod` + MCP SDK in mcp
- Keep the dependency surface minimal — every dependency is a maintenance obligation
