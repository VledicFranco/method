# semantic/algorithms/ — Semantic Algorithm Implementations (Incubating)

Concrete semantic function implementations for common software development tasks. These compose the semantic primitives from `semantic/fn.ts` into higher-level algorithms.

| Algorithm | Description |
|-----------|-------------|
| `explore.ts` | Codebase exploration: maps project structure to semantic facts |
| `design.ts` | Architecture design: produces structured design artifacts |
| `design-judge.ts` | Design evaluation: scores designs against quality criteria |
| `implement.ts` | Implementation: generates code from design artifacts |
| `review.ts` | Code review: produces structured critique from diff + context |
| `judge.ts` | Output quality judge: generic scoring function for any algorithm output |
| `gate-runner.ts` | Semantic gate: wraps algorithms as `Gate<S>` instances |
| `fs-loader.ts` | Filesystem loader: reads project files into semantic context |

These are used in SLM compilation experiments (RFC 002, RFC 005) to generate training traces.
