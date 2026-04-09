# semantic/ — Semantic Programming Language (Incubating)

Experimental semantic layer for expressing methodology computations as composable semantic functions. Under active research — not yet part of the public API.

## Components

| Component | Description |
|-----------|-------------|
| `fn.ts` | Semantic function type — typed computation `A → B` with semantic metadata |
| `compose.ts` | Semantic function composition operators |
| `truth.ts` | Truth value types for semantic evaluation (supports partial truth) |
| `run.ts` | Semantic function executor |
| `node-executor.ts` | Node-level execution of semantic functions in a DAG context |
| `algorithms/` | Semantic algorithm implementations (sorting, search, transformation) |

## Status

The semantic module is currently gated behind an export comment in `methodts/src/index.ts`:
```
// export * from "./semantic/index.js"; // Uncomment when SPL stabilizes
```

It is activated only after experiment validation (see `experiments/exp-slm-composition/`).
