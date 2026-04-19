---
guide: 40
title: "Cognitive Composition Operators"
domain: pacta-cognitive
audience: [contributors, agent-operators]
summary: >-
  Compose cognitive modules using the four algebraic operators: sequential, parallel, competitive, hierarchical.
prereqs: [27]
touches:
  - packages/pacta/src/cognitive/algebra/composition.ts
  - packages/pacta/src/cognitive/algebra/module.ts
  - packages/pacta/src/cognitive/algebra/tower.ts
---

# Guide 40 — Cognitive Composition Operators

How to compose cognitive modules using the four algebraic operators.

## What Are Composition Operators?

The cognitive algebra defines four operators that combine `CognitiveModule` instances into larger modules. The key property: every composed module is itself a `CognitiveModule`, so composition works at every scale. You can compose composed modules, nest hierarchies inside parallel branches, or build towers of self-monitoring modules.

All four operators live in `packages/pacta/src/cognitive/algebra/composition.ts` and are exported from `@methodts/pacta`:

```typescript
import {
  sequential,
  parallel,
  competitive,
  hierarchical,
} from '@methodts/pacta';
```

## The CognitiveModule Interface

Every module — atomic or composed — satisfies this interface:

```typescript
interface CognitiveModule<I, O, S, Mu extends MonitoringSignal, Kappa extends ControlDirective> {
  readonly id: ModuleId;
  step(input: I, state: S, control: Kappa): Promise<StepResult<O, S, Mu>>;
  initialState(): S;
  stateInvariant?(state: S): boolean;
}
```

- **I** — input type (what the module reads)
- **O** — output type (what the module produces)
- **S** — state type (private, opaque to other modules)
- **Mu** — monitoring signal type (reported upward after each step)
- **Kappa** — control directive type (received from above)

A step produces a `StepResult`:

```typescript
interface StepResult<O, S, Mu extends MonitoringSignal> {
  output: O;
  state: S;
  monitoring: Mu;
  error?: StepError;
  trace?: TraceRecord;
}
```

State invariant checking runs after every step inside every composition operator. If a module provides `stateInvariant` and it returns `false` after a step, the operator throws a `CompositionError`.

## sequential(A, B)

**Notation:** `A >> B`

A's output feeds B's input. Aborts on first error — if A's step throws, B never runs.

```typescript
function sequential<I, Mid, O, SA, SB, MuA, MuB, KappaA, KappaB>(
  a: CognitiveModule<I, Mid, SA, MuA, KappaA>,
  b: CognitiveModule<Mid, O, SB, MuB, KappaB>,
): CognitiveModule<I, O, [SA, SB], ComposedMonitoring<MuA, MuB>, ComposedControl<KappaA, KappaB>>
```

**Combined state:** `[SA, SB]` — a tuple of both modules' states.

**Monitoring:** `ComposedMonitoring<MuA, MuB>` with `.first` and `.second` fields carrying each module's signal.

**Control:** `ComposedControl<KappaA, KappaB>` — pass directives to each module via `.first` and `.second`.

**Use case:** Pipeline processing — parse then validate, observe then reason, reason then act.

### Example

```typescript
import { sequential, moduleId } from '@methodts/pacta';
import type { CognitiveModule, MonitoringSignal, ControlDirective } from '@methodts/pacta';

// A module that uppercases its input
const upper: CognitiveModule<string, string, number, MonitoringSignal, ControlDirective> = {
  id: moduleId('upper'),
  initialState: () => 0,
  async step(input, state, _control) {
    return {
      output: input.toUpperCase(),
      state: state + 1,
      monitoring: { source: moduleId('upper'), timestamp: Date.now() },
    };
  },
};

// A module that wraps its input in brackets
const bracket: CognitiveModule<string, string, number, MonitoringSignal, ControlDirective> = {
  id: moduleId('bracket'),
  initialState: () => 0,
  async step(input, state, _control) {
    return {
      output: `[${input}]`,
      state: state + 1,
      monitoring: { source: moduleId('bracket'), timestamp: Date.now() },
    };
  },
};

const pipeline = sequential(upper, bracket);
// pipeline.step('hello', ...) → output: '[HELLO]'
// pipeline.initialState() → [0, 0]
```

## parallel(A, B, merge, errorMerge?)

**Notation:** `A | B`

Both modules execute on the same input simultaneously via `Promise.allSettled`. A `merge` function combines both outputs into a single result.

```typescript
function parallel<I, OA, OB, O, SA, SB, MuA, MuB, KappaA, KappaB>(
  a: CognitiveModule<I, OA, SA, MuA, KappaA>,
  b: CognitiveModule<I, OB, SB, MuB, KappaB>,
  merge: ParallelMerge<OA, OB, O>,
  errorMerge?: ParallelErrorMerge<OA, OB, O, MuA, MuB>,
): CognitiveModule<I, O, [SA, SB], ComposedMonitoring<MuA, MuB>, ComposedControl<KappaA, KappaB>>
```

**merge:** `(outputA: OA, outputB: OB) => O` — called when both sides succeed.

**errorMerge:** `(resultA: ParallelSideResult, resultB: ParallelSideResult) => O` — called when at least one side fails. Each side result is either `{ ok: true, output, monitoring }` or `{ ok: false, error }`. If `errorMerge` is not provided and one side throws, the error is rethrown.

**Use case:** Fan-out + merge — run two analysis strategies on the same input, then combine results.

### Example

```typescript
import { parallel, moduleId } from '@methodts/pacta';

const analyzerA = createAnalysisModule('fast-heuristic');
const analyzerB = createAnalysisModule('thorough-search');

const combined = parallel(
  analyzerA,
  analyzerB,
  // merge: combine both analyses
  (resultA, resultB) => ({
    heuristic: resultA,
    thorough: resultB,
    consensus: resultA.verdict === resultB.verdict,
  }),
  // errorMerge: handle partial failure
  (sideA, sideB) => {
    if (sideA.ok) return { heuristic: sideA.output, thorough: null, consensus: false };
    if (sideB.ok) return { heuristic: null, thorough: sideB.output, consensus: false };
    return { heuristic: null, thorough: null, consensus: false };
  },
);
```

## competitive(A, B, selector)

**Notation:** `A <|> B`

Both modules produce outputs. A `selector` function chooses the winner. If one module throws, the other wins by default. If both throw, the composition rethrows a `CompositionError`.

```typescript
function competitive<I, OA, OB, SA, SB, MuA, MuB, KappaA, KappaB>(
  a: CognitiveModule<I, OA, SA, MuA, KappaA>,
  b: CognitiveModule<I, OB, SB, MuB, KappaB>,
  selector: CompetitiveSelector<OA, OB, MuA, MuB>,
): CognitiveModule<I, OA | OB, [SA, SB], ComposedMonitoring<MuA, MuB>, ComposedControl<KappaA, KappaB>>
```

**selector:** `(outputA, outputB, muA, muB) => 'a' | 'b'` — receives both outputs and both monitoring signals, returns which module wins.

**Output type:** `OA | OB` — the union of both output types, since either module can win.

**Use case:** Racing strategies (pick the faster or higher-confidence result), best-of-N evaluation, A/B testing cognitive approaches.

### Example

```typescript
import { competitive, moduleId } from '@methodts/pacta';

const creative = createReasoningModule('creative');
const analytical = createReasoningModule('analytical');

const bestOf = competitive(
  creative,
  analytical,
  // selector: pick the module with higher confidence
  (_outputA, _outputB, muA, muB) => {
    return muA.confidence > muB.confidence ? 'a' : 'b';
  },
);
```

## hierarchical(M, T)

**Notation:** `M controls T`

Two-level metacognitive loop. The target module (T) runs first, producing output and a monitoring signal. The monitor module (M) reads T's monitoring signal from the *previous* step and issues control directives. On the first step, M receives a no-op signal since there is no prior monitoring.

```typescript
function hierarchical<I, OTarget, OMonitor, STarget, SMonitor, MuTarget, MuMonitor, KappaTarget, KappaMonitor>(
  monitor: CognitiveModule<MuTarget, OMonitor, SMonitor, MuMonitor, KappaMonitor>,
  target: CognitiveModule<I, OTarget, STarget, MuTarget, KappaTarget>,
): CognitiveModule<
  I,
  OTarget,
  HierarchicalState<STarget, SMonitor, MuTarget>,
  ComposedMonitoring<MuTarget, MuMonitor>,
  ComposedControl<KappaTarget, KappaMonitor>
>
```

**Monitor input:** `MuTarget` — the monitor's input type is the target's monitoring signal type. The monitor literally reads the target's self-reports.

**Composed output:** `OTarget` — the target's output passes through. The monitor's output is internal (used for its own monitoring signal).

**State:** `HierarchicalState<STarget, SMonitor, MuTarget>` — carries `targetState`, `monitorState`, and `lastMonitoring` (the target's signal from the previous step).

**Error behavior:** Target errors propagate normally. Monitor errors escalate — wrapped in a `CompositionError` with context.

**Use case:** Supervisor patterns — a meta-level module watches a task-level module's confidence, error rate, or progress and adjusts behavior. Nelson & Narens monitor/control architecture.

### Example

```typescript
import { hierarchical, moduleId } from '@methodts/pacta';
import type { CognitiveModule, MonitoringSignal, ControlDirective } from '@methodts/pacta';

// Target: does the actual work, reports confidence
const worker = createWorkerModule('task-executor');

// Monitor: reads worker's monitoring signals, detects anomalies
const supervisor: CognitiveModule<MonitoringSignal, string, number, MonitoringSignal, ControlDirective> = {
  id: moduleId('supervisor'),
  initialState: () => 0,
  async step(targetSignal, state, _control) {
    const anomaly = targetSignal.timestamp === 0; // no-op signal on first step
    return {
      output: anomaly ? 'no-data' : 'monitoring-ok',
      state: state + 1,
      monitoring: {
        source: moduleId('supervisor'),
        timestamp: Date.now(),
      },
    };
  },
};

const supervised = hierarchical(supervisor, worker);
// On each step:
//   1. worker runs on the input
//   2. supervisor reads worker's *previous* monitoring signal
//   3. composed output = worker's output
```

## Composed Type Helpers

All operators produce composed monitoring and control types:

```typescript
// Monitoring from two modules — access via .first and .second
interface ComposedMonitoring<MuA, MuB> extends MonitoringSignal {
  first: MuA;
  second: MuB;
}

// Control directives to two modules — set via .first and .second
interface ComposedControl<KappaA, KappaB> extends ControlDirective {
  first: KappaA;
  second: KappaB;
}

// Hierarchical state — target + monitor + temporal link
interface HierarchicalState<STarget, SMonitor, MuTarget> {
  targetState: STarget;
  monitorState: SMonitor;
  lastMonitoring: MuTarget | undefined;
}
```

## Nesting and Composability

Since every operator returns a `CognitiveModule`, operators compose freely:

```typescript
// Sequential pipeline inside a parallel fan-out
const branch1 = sequential(parse, validate);
const branch2 = sequential(parse, transform);
const fanOut = parallel(branch1, branch2, mergeResults);

// Hierarchical supervision of a competitive pair
const racingPair = competitive(strategyA, strategyB, pickBest);
const supervised = hierarchical(monitor, racingPair);
```

The `tower(M, n)` helper builds n-level hierarchical self-monitoring stacks. Depth is bounded by `MAX_TOWER_DEPTH` (default: 5) to prevent runaway recursion:

```typescript
import { tower, MAX_TOWER_DEPTH } from '@methodts/pacta';

// 3-level self-monitoring tower
const selfMonitoring = tower(myModule, 3);

// Exceeding max depth throws CompositionError
tower(myModule, MAX_TOWER_DEPTH + 1); // throws
```

## Error Handling Summary

| Operator | One side throws | Both throw |
|----------|----------------|------------|
| `sequential` | Aborts immediately (exception propagates, second module never runs) | N/A (sequential) |
| `parallel` | Uses `errorMerge` if provided; otherwise rethrows | Both errors in `errorMerge`, or rethrows first |
| `competitive` | Other module wins by default | Throws `CompositionError` |
| `hierarchical` | Target error propagates; monitor error escalates (wrapped in `CompositionError`) | Both propagate |

## Next Steps

- **[Cognitive Composition Guide](./cognitive-composition.md)** — the 8 lifecycle modules (Observer, Reasoner, Actor, etc.) that plug into these operators.
- **[Guide 27 — Pacta: Assembling Agents](./27-pacta-assembling-agents.md)** — agent-level composition with pacts, providers, and middleware.
