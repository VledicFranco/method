# strategy/ — Strategy Execution System

Composable multi-step strategy pipelines that orchestrate methodology execution across agent sessions. Strategies are defined as DAGs (directed acyclic graphs) in YAML and executed by `DagStrategyExecutor`.

## Components

| Component | Description |
|-----------|-------------|
| `StrategyController` | Top-level controller — routes strategy decisions to the right executor |
| `run-strategy.ts` | Runs a strategy to completion; handles suspension and resumption |
| `prebuilt.ts` | Pre-built strategy definitions for common patterns (scan-refine, build-validate) |
| `compat.ts` | Backward-compatibility shims for legacy strategy format |
| `DagStrategyExecutor` | Core DAG executor — topological ordering, parallel node execution |
| `DagParser` | Parses strategy YAML into typed `StrategyDAG` structures |
| `DagGates` | Gate evaluation integrated with DAG node transitions |
| `DagArtifactStore` | Stores artifacts produced at each DAG node for downstream consumption |
| `DagRetro` | Retrospective generation from DAG execution traces |
| `dag-types.ts` | Complete type system for DAG strategies |
| `StrategySource` | Port interface — how to look up a strategy by name |
| `StdlibStrategySource` | Implementation backed by the stdlib registry |
| `agent-steered.ts` | Agent-controlled strategy navigation (the agent decides next node) |

## DAG Strategy YAML

```yaml
id: scan-refine
nodes:
  - id: scan
    type: methodology
    methodology: P2-SD
  - id: refine
    type: script
    command: npm run validate
    dependsOn: [scan]
gates:
  - on: scan
    gate: test-runner
```

## Integration

Strategies are registered in `.method/manifest.yaml` and invoked via the bridge's `/strategies` endpoints or the MCP `run_strategy` tool.
