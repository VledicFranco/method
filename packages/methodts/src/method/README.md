# method/ — Method and Step Types

Core execution unit of the formal methodology model. A `Method<S>` is a sequence of `Step<S>` objects operating over a world state `S`, with associated measures, tools, and test suites.

## Components

| Component | Description |
|-----------|-------------|
| `Method<S>` | Ordered step sequence with identity, domain ref, test suite, and measures |
| `Step<S>` | Single execution unit: prompt template, input/output types, preconditions, gates |
| `Measure<S>` | Scalar metric derived from world state (used for convergence and scoring) |
| `Dag` | Directed acyclic graph type for multi-step method structure (non-sequential methods) |
| `Tool` | Tool declaration: name, description, input/output schema — provided to agent at execution time |

## Key Concepts

**Steps** are the atomic units the agent executes. Each step has:
- A prompt template (rendered against world state)
- Type declarations for input and output
- Optional preconditions (predicates that must hold before execution)
- Optional post-conditions (predicates checked after execution)
- Optional gates (quality checks before the runtime accepts the step's output)

**Measures** track quantitative progress. The runtime evaluates measures after each step to determine convergence. Safety bounds in the methodology spec use measures to define termination criteria.
