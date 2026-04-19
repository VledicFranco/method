# Dependencies

## New Dependencies

| Package | Added to | Purpose |
|---------|----------|---------|
| `js-yaml` | `@methodts/core` | YAML parsing for registry files |
| `@types/js-yaml` | `@methodts/core` (dev) | TypeScript types for js-yaml |

## Existing Dependencies (no changes)

| Package | Package | Purpose |
|---------|---------|---------|
| `@modelcontextprotocol/sdk` | `@methodts/mcp` | MCP server protocol |
| `zod` | `@methodts/mcp` | Input validation for MCP tools |
| `typescript` | root (dev) | Build |
| `tsx` | root (dev) | Dev execution |
| `@types/node` | root (dev) | Node.js types |

## PRD 003 Phase 1 — No New Dependencies

`getMethodologyRouting` (routing extraction) and `session.context()` (step context) use `js-yaml` for YAML parsing, which is already a dependency of `@methodts/core`. No new packages are required. The MCP layer uses the same `zod` schemas pattern for input validation.

## Dependency Principles

- `@methodts/core` has **no MCP dependency** — it's a pure domain library
- `@methodts/mcp` depends on `@methodts/core` and MCP SDK — it's the adapter
- No runtime dependencies beyond `js-yaml` in core and `zod` + MCP SDK in mcp
- Keep the dependency surface minimal — every dependency is a maintenance obligation
