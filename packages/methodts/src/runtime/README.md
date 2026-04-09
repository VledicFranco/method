# runtime/ — Methodology Execution Engine

The core execution engine that runs methodologies and methods against an agent provider. Manages the full execution lifecycle: step dispatch, world state threading, hook invocation, error handling, suspension, and retrospective generation.

## Components

| Component | Description |
|-----------|-------------|
| `run-methodology.ts` | Top-level entry point — runs a `Methodology<S>` to completion or suspension |
| `run-method.ts` | Runs a single `Method<S>` — iterates steps, checks gates, threads world state |
| `run-step.ts` | Runs a single `Step<S>` — renders prompt, dispatches to provider, validates output |
| `context.ts` | `RunContext` — per-execution context (provider, config, event bus, domain facts) |
| `config.ts` | `RuntimeConfig` — execution parameters (max retries, timeouts, gate behavior) |
| `event-bus.ts` | Internal event bus — publishes step started/completed/failed events |
| `events.ts` | `RuntimeEvent` discriminated union — all events emitted during execution |
| `hooks.ts` | `RuntimeHooks` — lifecycle callbacks (onStepStart, onStepEnd, onGateFail) |
| `bridge-hook.ts` | Hook implementation that publishes events to the bridge EventBus |
| `errors.ts` | `RuntimeError` types — step failure, gate failure, safety violation, suspension |
| `suspension.ts` | Suspension protocol — serializes execution state for resumption |
| `accumulator.ts` | Accumulates step outputs into world state |
| `middleware.ts` | Middleware pipeline — intercepts step execution for cross-cutting concerns |
| `reconciliation.ts` | World state reconciliation after failed steps |
| `domain-facts.ts` | Domain fact store — runtime-accessible assertions about the world |
| `insight-store.ts` | Stores insights generated during execution for retrospective generation |
| `retro.ts` | Retrospective generation from execution traces |

## Execution Flow

```
runMethodology()
  └─ resolve arm (transition predicates)
  └─ check safety bounds
  └─ runMethod()
      └─ for each step:
          └─ check preconditions
          └─ runStep() → dispatch to provider
          └─ check gates
          └─ accumulate output → world state
          └─ emit RuntimeEvent
  └─ check terminal conditions
  └─ generate TerminationCertificate or suspend
```
