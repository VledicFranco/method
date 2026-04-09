# @method/methodts — Typed Methodology SDK

L3 library. Makes the formal methodology theory (F1-FTH, F4-PHI) executable in TypeScript. Provides the type system, runtime, stdlib catalog, and tooling for defining and executing formal methodologies as structured agent workflows.

## Purpose

A methodology is a DAG of steps where each step has: a predicate (entry condition), a prompt template, an extractor (output parser), and a gate (quality check). Methodts compiles these into an executable `Method` that agents can follow step-by-step with full state tracking.

## Key Concepts

| Concept | Type | Description |
|---------|------|-------------|
| Method | `Method` | A named DAG of `Step`s with entry/exit conditions |
| Step | `Step` | Single node: predicate → prompt → extractor → gate |
| Methodology | `Methodology` | A collection of methods with shared domain theory |
| Predicate | `Predicate` | Boolean condition on `WorldState` |
| Domain Theory | `DomainTheory` | Formal ontology: roles, concepts, relationships |
| World State | `WorldState` | Mutable context carried through method execution |
| Gate | `Gate` | Quality assertion on step output (script-based or LLM-judged) |

## Runtime

```typescript
import { createRuntime } from '@method/methodts';

const runtime = createRuntime({ provider: claudeCliProvider });
const session = await runtime.startMethod(methodology, 'M1-PLAN');
const result = await session.step(); // executes next step, validates output
```

## Stdlib

Pre-compiled methodology catalog at `src/stdlib/`:
- `P0-META` — meta-methodology (bootstrapping, reflection)
- `P1-*` — discovery and analysis methods
- `P2-SD` — software development (design, implementation, review)
- `P3-DISP` — dispute resolution
- `P3-GOV` — governance
- `PGH-*` — ad-hoc methods

Each stdlib entry is a compiled YAML-backed `Methodology` object loadable at runtime.

## Semantic Layer

`src/semantic/` — algorithms for methodology matching, similarity scoring, and routing. Used by the MCP server to select the best methodology for a given task description.

## Testkit

`src/testkit/` — test assertions, builders, diagnostic runners for methodology testing. Enables testing methods without a live LLM using mock providers and canned world states.

## Providers

- `AgentProvider` — sends prompts to a real LLM agent
- `MockProvider` — deterministic responses for testing
