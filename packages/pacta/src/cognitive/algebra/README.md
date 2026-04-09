# cognitive/algebra/ — Cognitive Composition Algebra (RFC 001, PRD 030)

The algebraic core of the cognitive architecture. Defines the composition operators, workspace types, partition types, and routing logic that form the mathematical foundation of the cognitive engine.

## Key Types

| Type | Description |
|------|-------------|
| `CognitiveWorkspace` | The shared working memory — partitions, active modules, trace |
| `CognitiveModule` | A stateless reasoning function: `(workspace, input) → output` |
| `CognitivePartition` | Named memory region: operational / task / constraint |
| `CompositionOperator` | Algebra operators: sequence, parallel, choice, loop |
| `ControlPolicy` | Decision policy for the choice operator — selects next module |
| `DiscrepancyFunction` | Measures divergence between expected and actual workspace state |
| `KpiCheckerPort` | Port interface for SLM-based KPI evaluation (RFC 002) |

## Composition Operators

| Operator | Symbol | Semantics |
|----------|--------|-----------|
| `sequence` | `;` | Run A, then B with A's output as B's input |
| `parallel` | `‖` | Run A and B concurrently, merge workspaces |
| `choice` | `⊕` | Run A or B based on control policy evaluation |
| `loop` | `↺` | Run A repeatedly until discrepancy function converges |

## Design

The algebra is pure data — operators are constructed as typed objects, not executed directly. The `CognitiveEngine` in `engine/` interprets the algebra against a provider. This enables testing compositions without LLM calls.
