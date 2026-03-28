# Cognitive Composition — Architecture

## Responsibility

The `cognitive/` domain within `@method/pacta` implements the Calculus of Cognitive Composition (RFC `docs/rfcs/001-cognitive-composition.md`). It provides a typed module abstraction, composition operators, a port-mediated workspace, and an 8-phase cognitive cycle orchestrator. This is a **parallel execution model** alongside the existing flat middleware pipeline — not a replacement.

**Position in the layer stack:** L3 (library), co-located with `@method/pacta`.

**Core thesis:** Agents are assemblies of cognitive modules that compose via typed operators and communicate through a shared workspace with salience-based attention. A two-level architecture (object-level + meta-level) enables metacognitive monitoring and control.

## Sub-Domain Structure

```
packages/pacta/src/cognitive/
  algebra/       Pure types, composition operators, workspace types, trace, events
  modules/       8 module implementations (4 object-level + 4 meta-level)
  engine/        CognitiveCycle, createCognitiveAgent, asFlatAgent adapter
```

**Boundary rules (G-BOUNDARY):**
- `algebra/` depends on nothing within `cognitive/` (leaf)
- `modules/` depends only on `algebra/` types and pacta ports — never on `engine/`
- `engine/` depends only on `algebra/` types — receives modules via injection, never imports from `modules/`
- `cognitive/` must not import from `agents/` and vice versa

Modules are not re-exported from the domain barrel. Consumers import module factories directly (e.g., `import { createReasoner } from '@method/pacta/cognitive/modules/reasoner.js'`).

## Module Contracts

The fundamental type is `CognitiveModule<I, O, S, Mu, Kappa>` with `step: (I, S, kappa) -> (O, S', mu)`.

### Object-Level

| Module | Uses Port | Mu (monitoring) | Kappa (control) |
|--------|-----------|-----------------|-----------------|
| Observer | WorkspaceWritePort | `{ type: 'observer', inputProcessed, noveltyScore }` | `{ focusFilter? }` |
| Memory | MemoryPort, WorkspaceWritePort | `{ type: 'memory', retrievalCount, relevanceScore }` | `{ retrievalStrategy }` |
| Reasoner | ProviderAdapter, WorkspaceReadPort, WorkspaceWritePort | `{ type: 'reasoner', confidence, conflictDetected, effortLevel }` | `{ strategy, effort }` |
| Actor | ToolProvider, WorkspaceReadPort | `{ type: 'actor', actionTaken, success, unexpectedResult }` | `{ allowedActions?, escalate? }` |

### Meta-Level

| Module | Uses Port | Mu (monitoring) | Kappa (control) |
|--------|-----------|-----------------|-----------------|
| Monitor | (reads AggregatedSignals) | `{ type: 'monitor', escalation?, anomalyDetected }` | `never` (top-level) |
| Evaluator | (reads workspace + signals) | `{ type: 'evaluator', estimatedProgress, diminishingReturns }` | `{ evaluationHorizon }` |
| Planner | ProviderAdapter | `{ type: 'planner', planRevised, subgoalCount }` | `{ replanTrigger? }` |
| Reflector | MemoryPort | `{ type: 'reflector', lessonsExtracted }` | `{ reflectionDepth }` |

## Composition Operators

Four operators produce new cognitive modules from existing ones:

| Operator | Signature | Semantics | Error Behavior |
|----------|-----------|-----------|----------------|
| `sequential(A, B)` | A's output feeds B's input | Both signals emitted | Abort on first error |
| `parallel(A, B, merge)` | Both execute on same input | Merge combines outputs | Collect errors, pass to error merge function |
| `competitive(A, B, selector)` | Both produce; selector chooses | Selector has own signal | Throwing module is non-candidate |
| `hierarchical(M, T)` | M reads T's mu, issues kappa | Temporal: T first, M reacts | T error propagates; M error escalates |

Plus `tower(M, n)` — bounded recursive hierarchical composition (max depth: 3 by default). Budget constraints propagate downward.

All operators perform both compile-time (TypeScript generics) and runtime (`CompositionError`) validation.

## Workspace Access Model

Modules interact with the workspace through typed, per-module port interfaces — not through a shared mutable bag.

**Ports:**
- `WorkspaceReadPort` — `read(filter?)`, `attend(budget)`, `snapshot()`
- `WorkspaceWritePort` — `write(entry)`

**Access contracts (enforced by WorkspaceManager):**
- Per-module write quota: max entries per cycle
- Salience computation: pluggable `SalienceFunction`, default formula = `0.4 * recency + 0.3 * sourcePriority + 0.3 * goalOverlap`
- Capacity enforcement: lowest-salience eviction with FIFO tie-breaking
- TTL-based expiry
- Eviction notifications via `CognitiveWorkspaceEviction` events

**WorkspaceConfig:**
```typescript
interface WorkspaceConfig {
  capacity: number;
  salience?: SalienceFunction;
  writeQuotaPerModule?: number;
  defaultTtl?: number;
}
```

## Cognitive Cycle

Eight phases per agent turn. Async/await sequential (phases 1-7). LEARN is fire-and-forget with state-lock.

```
1. OBSERVE   — Observer processes new input
2. ATTEND    — Workspace attention selects salient entries
3. REMEMBER  — Memory retrieves relevant knowledge
4. REASON    — Reasoner produces reasoning trace
5. MONITOR   — Meta: reads aggregated monitoring signals [DEFAULT-INTERVENTIONIST]
6. CONTROL   — Meta: issues control directives, validated by ControlPolicy [DEFAULT-INTERVENTIONIST]
7. ACT       — Actor selects and executes action
8. LEARN     — Reflector distills cycle into memory [FIRE-AND-FORGET, state-locked]
```

**Default-interventionist pattern:** MONITOR/CONTROL only fire when monitoring signals cross configurable thresholds (`ThresholdPolicy`). This keeps cost low on routine turns.

**Error handling:** `CycleErrorPolicy` with per-module override (`abort | skip | retry`). LEARN failures emit `CognitiveLEARNFailed` events and roll back reflector state (state-lock). Cycle aborts emit `CognitiveCycleAborted` events.

**CycleConfig:**
```typescript
interface CycleConfig {
  thresholds: ThresholdPolicy;
  errorPolicy: CycleErrorPolicy;
  controlPolicy: ControlPolicy;
  cycleBudget?: CycleBudget;
  maxConsecutiveInterventions?: number;
}
```

## Observability

Every module step produces a `TraceRecord` (module ID, phase, timestamp, input hash, output summary, monitoring signal, state hash, duration, optional token usage). Traces flow through `TraceSink` ports.

**Built-in sinks:**
- `InMemoryTraceSink` — array-backed, for testing and programmatic inspection
- `ConsoleTraceSink` — formatted output for development

**Cognitive events** (`CognitiveEvent` union): 9 event types covering module steps, monitoring signals, control directives, policy violations, workspace writes/evictions, cycle phases, LEARN failures, and cycle aborts. All events carry timestamps and relevant context.

## Design Decisions

1. **Separate interface, not subtype.** `CognitiveAgent` is a separate interface from `Agent`. The `asFlatAgent()` adapter bridges the two explicitly, making impedance mismatch visible and testable. This prevents leaky abstractions where cognitive semantics (phases, workspace, monitoring) would be hidden behind the flat Agent contract.

2. **Port-mediated workspace.** Modules access the workspace through typed read/write ports, not through a shared mutable bag. This makes data flow explicit, enforces write quotas at the engine level, and allows salience computation to be centralized rather than trusting module-reported values.

3. **Three sub-domains (algebra/modules/engine).** The algebra is the leaf — pure types and operators with zero awareness of specific modules. Modules depend only on algebra types. The engine depends only on algebra types and receives modules via injection. This prevents circular dependencies and ensures modules can be tested without the engine and vice versa.

4. **Default-interventionist meta-level.** Rather than always running 8 phases (expensive), MONITOR/CONTROL are gated by threshold policies. This is grounded in dual-process theory: the meta-level only engages when object-level signals indicate something noteworthy. The threshold mechanism is pluggable (predicate or field-based rules).

5. **LEARN as fire-and-forget.** The reflector step runs after the cycle returns its result. State mutations are protected by a lock — on error, state rolls back to the pre-step snapshot. This prevents learning failures from blocking agent output or corrupting future cycles.

## References

- RFC: Calculus of Cognitive Composition (`docs/rfcs/001-cognitive-composition.md`)
- PRD 030: Pacta Cognitive Composition (`docs/prds/030-pacta-cognitive-composition.md`)
- PRD 027: Pacta SDK (`docs/prds/027-pacta.md`)
- FCA specification (`docs/fractal-component-architecture/`)
