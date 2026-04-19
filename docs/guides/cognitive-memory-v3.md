# Cognitive Memory v3 — Usage Guide

CLS dual-store memory with ACT-R activation-based retrieval for cognitive agents (PRD 036).

## Quick Start

```typescript
import { createMemoryPreset } from '@methodts/pacta/cognitive/modules/memory-preset.js';
import { triggerSleep } from '@methodts/pacta/cognitive/modules/sleep-api.js';
import { defaultActivationConfig } from '@methodts/pacta/cognitive/modules/activation.js';

const { memory, consolidator, store } = createMemoryPreset({
  dualStore: {
    episodic: { capacity: 50, encoding: 'verbatim' },
    semantic: { capacity: 500, encoding: 'extracted', updateRate: 'slow' },
    consolidation: {
      replayBatchSize: 5,
      interleaveRatio: 0.6,
      schemaConsistencyThreshold: 0.8,
    },
  },
  consolidation: {
    onlineDepth: 'shallow',
    offlineReplayCount: 20,
    offlineInterleaveRatio: 0.6,
    pruningThreshold: -1.0,
  },
  activation: defaultActivationConfig(),
  writePort: workspace.writePort, // from your workspace manager
});

// Wire into cognitive agent
const agent = createCognitiveAgent({
  modules: {
    // ...other modules
    memory,          // REMEMBER phase
    reflector: consolidator, // LEARN phase (use adapter for input bridging)
  },
  workspace: { capacity: 100 },
  cycle: cycleConfig,
});
```

## Configuring the Dual Store

### Episodic Store (Fast)

| Parameter | Default | Description |
|-----------|---------|-------------|
| `capacity` | 50 | Max episodes before FIFO eviction |
| `encoding` | `'verbatim'` | Storage strategy (always verbatim) |

Increase capacity for agents with longer sessions or richer episode content. Decrease for memory-constrained environments.

### Semantic Store (Slow)

| Parameter | Default | Description |
|-----------|---------|-------------|
| `capacity` | 500 | Max generalized patterns |
| `encoding` | `'extracted'` | Storage strategy (always extracted) |
| `updateRate` | `'slow'` | Only updated through consolidation |

The semantic store is the long-term knowledge base. It is never written to directly by modules during the cognitive cycle — only by the consolidation engine during offline processing.

## Tuning ACT-R Activation Parameters

Activation determines which memories are retrieved. The formula:

```
total = baseLevelActivation + spreadingActivation + partialMatchPenalty + noise
```

| Parameter | Default | Effect |
|-----------|---------|--------|
| `retrievalThreshold` | -0.5 | Entries below this activation are inaccessible. Lower = more permissive retrieval. |
| `spreadingWeight` | 0.3 | Weight per context tag overlap. Higher = context matters more. |
| `partialMatchPenalty` | -0.2 | Penalty for entries with confidence < 0.5. More negative = stricter. |
| `noiseAmplitude` | 0.1 | Stochastic perturbation. Higher = more variability in retrieval. Set to 0 for deterministic tests. |
| `maxRetrievals` | 5 | Max entries returned per retrieval step. |

**Tuning tips:**
- For focused retrieval (fewer, more relevant results): raise `retrievalThreshold` to 0.0 or higher
- For broad retrieval (more results, some less relevant): lower `retrievalThreshold` to -2.0
- For deterministic testing: set `noiseAmplitude` to 0
- For stronger context sensitivity: raise `spreadingWeight` to 0.5

## Running Offline Consolidation (Sleep API)

The Sleep API triggers offline consolidation between sessions:

```typescript
import { triggerSleep } from '@methodts/pacta/cognitive/modules/sleep-api.js';

const result = await triggerSleep(store, {
  replayCount: 20,         // Episodes to replay (default: 20)
  interleaveRatio: 0.6,    // Recent-to-old ratio (default: 0.6)
  pruningThreshold: -1.0,  // Prune semantic entries below this activation (default: -1.0)
  schemaConsistencyThreshold: 0.8, // Jaccard similarity for schema matching (default: 0.8)
});

console.log(`Consolidated: ${result.episodesReplayed} episodes replayed`);
console.log(`  ${result.semanticUpdates} semantic updates`);
console.log(`  ${result.conflictsDetected} schema conflicts`);
console.log(`  ${result.entriesPruned} entries pruned`);
console.log(`  ${result.compressionRatio} compression ratio`);
console.log(`  ${result.durationMs}ms`);
```

### What Consolidation Does

1. **Interleaved sampling** — selects a mix of recent and older episodes for replay
2. **Schema consistency checking** — compares episode context against existing semantic patterns (Jaccard similarity)
3. **Pattern promotion** — when 3+ schema-inconsistent episodes share similar context, creates a new semantic entry
4. **Confidence boosting** — schema-consistent episodes increase the matched semantic entry's confidence
5. **Compression** — truncates old episodic entries exceeding capacity
6. **Pruning** — removes low-activation semantic entries below the pruning threshold

### When to Trigger Consolidation

- **After N cycles:** Run `triggerSleep()` every 10-20 cycles for agents with steady workloads
- **On idle:** Consolidate when the agent has no pending tasks
- **Between sessions:** Ideal timing — mirrors biological sleep consolidation
- **After a topic shift:** When the agent switches to a fundamentally different task domain

The Sleep API is idempotent on empty stores and safe to call multiple times. Each call processes whatever episodes are currently in the episodic store.

## Composing with Other Modules

### With Monitor v1/v2

MemoryV3 emits `MemoryMonitoring` signals compatible with both Monitor v1 and v2:

```typescript
{
  type: 'memory',
  source: 'memory-v3',
  timestamp: number,
  retrievalCount: number,   // How many entries were retrieved
  relevanceScore: number,    // 0-1, normalized retrieval quality
}
```

Monitor v2 can wrap this signal with metacognitive judgment for enriched monitoring.

### With Custom Reasoners

MemoryV3 writes retrieved entries to the workspace with high salience (0.85). Custom reasoners that read from the workspace will naturally receive these entries through the attention mechanism:

```
[EPISODIC] Fixed null pointer in API handler
[SEMANTIC] Always validate input types before processing (confidence: 0.9)
```

### Reflector-to-Consolidator Adapter

The cognitive cycle passes `{ traces }` to the reflector, but the Consolidator expects `{ traces, workspaceSnapshot, actionOutcome }`. When using the Consolidator as the reflector module in `createCognitiveAgent`, wrap it with an adapter:

```typescript
function asReflectorModule(consolidator) {
  return {
    id: consolidator.id,
    initialState: () => consolidator.initialState(),
    async step(input, state, control) {
      return consolidator.step({
        traces: input?.traces ?? [],
        workspaceSnapshot: input?.workspaceSnapshot ?? '',
        actionOutcome: input?.actionOutcome ?? '',
      }, state, control);
    },
  };
}

// Usage:
const modules = {
  // ...
  reflector: asReflectorModule(preset.consolidator),
};
```

## Architecture Summary

```
REMEMBER phase           LEARN phase              Between sessions
     |                       |                         |
  MemoryV3              Consolidator              triggerSleep()
     |                       |                         |
  searchByActivation()  storeEpisodic()         consolidateOffline()
  (reads both stores)   (episodic only)         (episodic -> semantic)
     |                       |                         |
  [Episodic Store]  <--->  [Shared InMemoryDualStore]  <--->  [Semantic Store]
```

See `docs/arch/cognitive-composition.md` for the full architecture specification.
