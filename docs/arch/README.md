# Architecture

Evolving architecture documentation for `pv-method`.

## Contents

| Document | Covers |
|----------|--------|
| [path-resolution.md](path-resolution.md) | How core and MCP layer resolve registry and theory file paths |
| [loader.md](loader.md) | YAML parsing, registry scanning, `listMethodologies` and `loadMethodology` design |
| [state-model.md](state-model.md) | `SessionState`, `LoadedMethod`, factory-based session, traversal API |
| [theory-lookup.md](theory-lookup.md) | Theory file parsing, section/definition extraction, search hierarchy |
| [routing.md](routing.md) | Transition function extraction, predicate merge, `getMethodologyRouting` design |
| [mcp-layer.md](mcp-layer.md) | Thin MCP adapter design, 14 tools, error handling, response formatting |
| [dependencies.md](dependencies.md) | Package dependencies and principles |
| [bridge.md](bridge.md) | PTY bridge HTTP server — session pool, output parser, API routes |
| [cluster.md](cluster.md) | Bridge cluster — membership, routing, event federation, method-ctl CLI |
| [pacta.md](pacta.md) | Pacta Agent SDK — pact contracts, ports, composition engine, reasoning, context, providers |
| [cortical-workspace.md](cortical-workspace.md) | PRD-068 S10/S11 — cognitive tenant-app coordination substrate (topic family + handshake protocol) |
| [cross-app-invoker.md](cross-app-invoker.md) | PRD-067 — cross-app strategy execution port, simulator (Track A), and Cortex stub (Track B blocked on PRD-080) |

## Conventions

- One document per architectural concern
- Each document states what it covers, the current design, and any open questions
- Superseded designs are noted inline (not deleted) so the reasoning trail is preserved
- Cross-reference the PRD (`docs/prds/001-mvp.md`) for scope and the theory (`theory/`) for formal grounding
