# Build Orchestrator Domain — PRD 047

8-phase autonomous build lifecycle for agent-driven project construction. Manages the full arc from initialization through refinement, with checkpoint persistence, testable assertion validation, and conversation tracking.

## Phases

| Phase | Name | Description |
|-------|------|-------------|
| 1 | Initialization | Project scaffolding and goal specification |
| 2 | Exploration | Codebase discovery, context gathering |
| 3 | Planning | Strategy selection, task decomposition |
| 4 | Execution | Code generation, tool use |
| 5 | Validation | Assertion-based correctness checking |
| 6 | Evidence | Gathering artifacts for verification |
| 7 | Refinement | Iterative improvement from validation failures |
| 8 | Completion | Checkpoint finalization, handoff |

## Components

| Component | Description |
|-----------|-------------|
| `BuildOrchestrator` | Core 8-phase state machine — drives lifecycle, emits `PhaseEvent` to bus |
| `FileCheckpointAdapter` | Persists build state as YAML files via `FileSystemProvider` + `YamlLoader` |
| `ConversationAdapter` | Tracks agent↔user messages within a build session |
| `Validator` | Runs shell assertions (`CommandExecutor`) and scores `ValidationReport` |
| `StrategyExecutorAdapter` | Adapts `DagExecutor` to the `StrategyExecutorPort` interface |
| `registerBuildRoutes` | Fastify route registration (REST endpoints for UI / MCP clients) |

## Domain Factory

Use `createBuildDomain(options)` from `server-entry.ts`. It wires:
1. `FileCheckpointAdapter` (fs + yaml ports)
2. `ConversationAdapter` (event callback → EventBus)
3. Phase event mapping (`PhaseEvent` → `BridgeEvent`)

All bridge event types are prefixed `build.*` on the Universal Event Bus (PRD 026).

## FCA Notes

- External dependencies accessed exclusively through injected ports (`EventBus`, `FileSystemProvider`, `YamlLoader`, `StrategyExecutorPort`, `ProjectLookup`)
- `CommandExecutor` (for `Validator`) is optional — builds without it skip assertion validation
- Checkpoint state survives process restarts via the YAML persistence layer
