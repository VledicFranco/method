# Cognitive Composition — Usage Guide

This guide covers practical use of the cognitive composition system in `@method/pacta`. For architecture details, see `docs/arch/cognitive-composition.md`.

## Quick Start

Create a cognitive agent with default modules using `createCognitiveAgent`:

```typescript
import {
  createCognitiveAgent,
  type WorkspaceConfig,
  type CycleConfig,
  type CycleModules,
  moduleId,
} from '@method/pacta';

// Import specific module factories
import { createObserver } from '@method/pacta/cognitive/modules/observer.js';
import { createMemoryModule } from '@method/pacta/cognitive/modules/memory-module.js';
import { createReasoner } from '@method/pacta/cognitive/modules/reasoner.js';
import { createActor } from '@method/pacta/cognitive/modules/actor.js';
import { createMonitor } from '@method/pacta/cognitive/modules/monitor.js';
import { createEvaluator } from '@method/pacta/cognitive/modules/evaluator.js';
import { createPlanner } from '@method/pacta/cognitive/modules/planner.js';
import { createReflector } from '@method/pacta/cognitive/modules/reflector.js';

const workspace: WorkspaceConfig = {
  capacity: 100,
  writeQuotaPerModule: 20,
  defaultTtl: 60_000,
};

const cycleConfig: CycleConfig = {
  thresholds: {
    type: 'predicate',
    shouldIntervene: (signals) => {
      // Only engage meta-level when reasoner confidence is low
      const reasoner = signals.get(moduleId('reasoner'));
      if (!reasoner) return false;
      return (reasoner as any).confidence < 0.5;
    },
  },
  errorPolicy: { default: 'skip' },
  controlPolicy: {
    allowedDirectiveTypes: ['*'],
    validate: () => true,
  },
};

const modules: CycleModules = {
  observer: createObserver(/* ... */),
  memory: createMemoryModule(memoryPort),
  reasoner: createReasoner(providerAdapter),
  actor: createActor(toolProvider),
  monitor: createMonitor(),
  evaluator: createEvaluator(),
  planner: createPlanner(providerAdapter),
  reflector: createReflector(memoryPort),
};

const agent = createCognitiveAgent({ modules, workspace, cycle: cycleConfig });
const result = await agent.invoke('Analyze the codebase and suggest improvements');

console.log(result.phasesExecuted); // ['OBSERVE', 'ATTEND', 'REMEMBER', 'REASON', 'ACT', 'LEARN']
console.log(result.output);          // Actor's output
console.log(agent.traces());         // All trace records from the cycle
```

## Configuring the Workspace

The workspace is the shared memory surface where modules read and write entries.

```typescript
const workspace: WorkspaceConfig = {
  // Maximum number of entries. When full, lowest-salience entries are evicted.
  capacity: 200,

  // Max entries a single module can write per cycle. Prevents any module from
  // flooding the workspace.
  writeQuotaPerModule: 30,

  // Default time-to-live for entries (ms). Entries expire automatically.
  defaultTtl: 120_000, // 2 minutes

  // Custom salience function (optional). Default uses:
  // 0.4 * recency + 0.3 * sourcePriority + 0.3 * goalOverlap
  salience: (entry, context) => {
    const age = context.now - entry.timestamp;
    const recency = Math.exp(-age / 60_000); // 1-minute half-life
    const priority = context.sourcePriorities.get(entry.source) ?? 0.5;
    return 0.6 * recency + 0.4 * priority;
  },
};
```

**Key behaviors:**
- Eviction uses FIFO tie-breaking when salience scores are equal within epsilon
- Salience is computed by the workspace engine, not trusted from modules
- Each module gets scoped `WorkspaceReadPort` and `WorkspaceWritePort` at composition time

## Tuning Thresholds

The meta-level (MONITOR + CONTROL phases) only fires when monitoring signals cross thresholds. Two threshold policy types are available:

### Predicate-Based (Full Control)

```typescript
const thresholds: ThresholdPolicy = {
  type: 'predicate',
  shouldIntervene: (signals) => {
    const reasoner = signals.get(moduleId('reasoner'));
    const actor = signals.get(moduleId('actor'));

    // Intervene on low confidence or unexpected actor results
    const lowConfidence = reasoner && (reasoner as any).confidence < 0.4;
    const unexpected = actor && (actor as any).unexpectedResult;

    return Boolean(lowConfidence || unexpected);
  },
};
```

### Field-Based (Declarative Rules)

```typescript
const thresholds: ThresholdPolicy = {
  type: 'field',
  rules: [
    // Intervene when reasoner confidence drops below 0.5
    { source: moduleId('reasoner'), field: 'confidence', operator: '<', value: 0.5 },
    // Intervene when evaluator detects diminishing returns (boolean as 0/1)
    { source: moduleId('evaluator'), field: 'diminishingReturns', operator: '>', value: 0.5 },
  ],
};
```

**Tuning advice:**
- Start with `shouldIntervene: () => false` (never intervene) to establish baseline cost
- Enable meta-level selectively for specific signal patterns
- Use `maxConsecutiveInterventions` (default: 3) to prevent runaway meta-level loops
- `CycleBudget.maxConsecutiveMetaInterventions` provides a hard stop

## Error Handling

`CycleErrorPolicy` controls what happens when a module's `step()` fails:

```typescript
const errorPolicy: CycleErrorPolicy = {
  // Default for all modules
  default: 'skip',  // 'abort' | 'skip'

  // Per-module overrides
  perModule: new Map([
    [moduleId('reasoner'), 'retry'],  // Retry the reasoner once on failure
    [moduleId('actor'), 'abort'],     // Abort the cycle if the actor fails
  ]),

  // Max retries for modules with 'retry' policy
  maxRetries: 2,
};
```

**Policy semantics:**
- `abort` — stop the cycle immediately. `CycleResult.aborted` will be set with the phase and reason.
- `skip` — continue to the next phase. The skipped module's output is `null`.
- `retry` — re-run the module up to `maxRetries` times. Falls back to the default policy on exhaustion.

LEARN phase failures are special: they emit `CognitiveLEARNFailed` events and roll back reflector state, but never block the cycle result.

## Using asFlatAgent()

When you need a cognitive agent where a flat `Agent` is expected:

```typescript
import { asFlatAgent } from '@method/pacta';

const cognitive = createCognitiveAgent({ modules, workspace, cycle: cycleConfig });

// Wrap as a flat Agent — can be used with existing Pacta consumers
const flat = asFlatAgent(cognitive, {
  pact: { mode: { type: 'oneshot' } },
});

// Standard Agent.invoke() interface
const result = await flat.invoke({ prompt: 'Do the thing' });
console.log(result.output);      // Actor's output
console.log(result.usage);       // Aggregated token usage from all traces
console.log(result.turns);       // 1 (each cognitive cycle = 1 turn)
console.log(result.sessionId);   // 'cognitive-{cycleNumber}'
```

**Impedance mismatch:** The adapter maps `AgentRequest.prompt` to Observer input and `CycleResult.output` to `AgentResult.output`. Token usage is aggregated from all trace records. This mapping is intentionally explicit — the cognitive cycle has richer semantics than the flat Agent contract.

## Testing

### RecordingModule

The playground provides `RecordingModule` — a cognitive module that captures all step invocations and returns configurable outputs:

```typescript
import { RecordingModule } from '@method/pacta-playground';

const reasoner = new RecordingModule('reasoner', {
  defaultOutput: { reasoning: 'test trace' },
  monitoring: {
    type: 'reasoner',
    confidence: 0.9,
    conflictDetected: false,
    effortLevel: 'medium',
  },
});

// After running a cycle...
console.log(reasoner.stepCount);        // Number of times step() was called
console.log(reasoner.recordings);       // Array of { input, state, control, result }
console.log(reasoner.recordings[0].input);  // What the cycle passed as input
```

### Cognitive Scenarios

The scenario DSL provides a fluent builder for cognitive agent evaluation:

```typescript
import {
  cognitiveScenario,
  cyclePhaseOrder,
  monitorIntervened,
  workspaceSize,
  moduleStepCount,
} from '@method/pacta-playground';

// Basic scenario with default recording modules
const result = await cognitiveScenario('basic cycle')
  .when('Analyze this problem')
  .then(cyclePhaseOrder(['OBSERVE', 'ATTEND', 'REMEMBER', 'REASON', 'ACT', 'LEARN']))
  .run();

assert(result.passed);

// With custom modules and meta-level intervention
const interventionResult = await cognitiveScenario('meta intervention')
  .given({ capacity: 50 })
  .withCycleConfig({
    thresholds: {
      type: 'predicate',
      shouldIntervene: () => true,  // Always intervene
    },
  })
  .when('Complex task')
  .then(monitorIntervened())
  .then(cyclePhaseOrder([
    'OBSERVE', 'ATTEND', 'REMEMBER', 'REASON',
    'MONITOR', 'CONTROL', 'ACT', 'LEARN',
  ]))
  .then(moduleStepCount('monitor', 1))
  .run();

assert(interventionResult.passed);
```

**Available assertions:**
- `cyclePhaseOrder(phases)` — verify exact phase execution order
- `monitorIntervened()` — verify MONITOR + CONTROL phases fired
- `workspaceSize(predicate)` — check workspace write event count
- `moduleStepCount(moduleId, count)` — verify a module's step call count

### Builder Methods

```typescript
cognitiveScenario('name')
  .given({ capacity: 100, writeQuotaPerModule: 10 })  // Workspace config
  .withModules({ reasoner: customReasoner })            // Override specific modules
  .withCycleConfig({ thresholds, errorPolicy })         // Override cycle config
  .when('prompt text')                                   // Input to the cycle
  .then(assertion)                                       // Add assertion
  .run()                                                 // Execute and check
```

Unspecified modules are filled with `RecordingModule` instances that return sensible defaults. This lets you focus on the modules under test without wiring all 8 manually.
