---
title: "PRD 036: Cognitive Memory Architecture"
status: proposed
date: "2026-03-29"
tier: heavyweight
depends_on: [30]
enables: []
blocked_by: []
complexity: high
domains_affected: [pacta, pacta-testkit]
---

# PRD 036: Cognitive Memory Architecture

**Status:** Proposed
**Author:** PO + Lysica
**Date:** 2026-03-29
**Package:** `@method/pacta` (L3 — library)
**Depends on:** PRD 030 (Pacta Cognitive Composition)
**Research:** `tmp/20260328-cognitive-architecture-research.md`, `tmp/20260328-cognitive-module-proposals.md`
**Organization:** Vidtecci — vida, ciencia y tecnologia

## Problem Statement

The current memory subsystem has three implementations — each an incremental improvement, but all sharing the same structural limitation: a single flat store with no consolidation pathway.

**Memory v1** (`memory-module.ts`) retrieves entries by keyword match against a `MemoryPort`. It derives a 200-character retrieval key from workspace contents, queries a flat key-value store, and computes relevance heuristically from entry count and content length. There is no decay, no frequency tracking, no principled retrieval algorithm.

**Memory v2** (`memory-module-v2.ts`) introduces FactCards with epistemic types (FACT, HEURISTIC, OBSERVATION, PROCEDURE, RULE) and confidence scores. It adds a fact extraction phase that derives new cards from successful actions, and a compaction handler that stores evicted workspace entries as low-confidence OBSERVATIONs. Retrieval uses `searchCards()` with keyword matching, limited to 3 results per step. This is better — but retrieval is still keyword-based with no activation model, and there is no mechanism to generalize across episodes or consolidate facts over time.

**The Reflector** (`reflector.ts`) extracts lessons from cycle traces and writes them to `MemoryPort` as key-value entries. It operates in shallow mode (one summary per trace) or deep mode (cross-trace pattern analysis). But the lessons it extracts are never integrated into a coherent knowledge structure — they accumulate without consolidation, without decay, and without any mechanism to detect when new lessons contradict old ones.

The consequence: episodes are stored but never generalized. Knowledge accumulates without structure. Old entries never decay. Retrieval is keyword-based, which means the agent retrieves entries that contain the right words rather than entries that are most relevant to the current context. There is no separation between fast episodic memory (verbatim episodes that should be quickly accessible but transient) and slow semantic memory (generalized patterns that should be stable and durable). The Reflector extracts lessons but doesn't integrate them into a coherent knowledge structure.

The most validated memory architecture in cognitive science — Complementary Learning Systems (McClelland, McNaughton, O'Reilly 1995) — provides a proven solution to exactly these problems. CLS demonstrates that a single learning system cannot simultaneously achieve both fast episodic storage and slow semantic generalization, because the update dynamics required for each are structurally different — fast one-shot storage and slow pattern extraction benefit from separate stores with different retention policies, regardless of representation substrate. The solution: two stores with opposite properties, connected by interleaved replay during consolidation. This architecture has been validated across decades of neuroscience research, updated for modern AI systems (Kumaran, Hassabis, McClelland 2016), and implemented in recent agent architectures (MIRIX 2025, Google Nested Learning NeurIPS 2025).

**Relationship to PRD 031:** This PRD delivers successors to the memory and reflector modules specified in PRD 031. PRD 031's MemoryV2 and FactCard architecture remain available for existing consumers. MemoryV3 is a parallel option with a different storage model (CLS dual-store), not a forced replacement. MemoryPortV3 extends MemoryPort (not MemoryPortV2) — the two memory systems coexist.

## Objective

Deliver a principled memory subsystem as **plug-and-play cognitive modules** that compose with any Monitor version (v1 or v2) via the existing cognitive composition engine (PRD 030). Four deliverables:

1. **MemoryV3** — CLS dual-store module (fast episodic + slow semantic) implementing `CognitiveModule`
2. **ACT-R activation-based retrieval** — replaces keyword search with Anderson's activation equations
3. **Consolidation module** — extends/replaces the Reflector with interleaved replay and schema-consistency checking
4. **Sleep API** — between-session offline consolidation for transferring episodic knowledge to semantic generalizations

All modules follow the plug-and-play principle established in PRD 030: they implement `CognitiveModule<I, O, S, Mu, Kappa>` and compose via the standard operators without requiring changes to the cycle engine or other modules.

## Architecture & Design

### Plug-and-Play Principle

Memory v3 and the Consolidation module are standalone cognitive modules. They compose with any existing module set — no coupling to a specific Monitor or Reasoner version:

```typescript
// Mix and match freely — any monitor version works
const agent = createCognitiveAgent({
  modules: {
    memory: createMemoryV3(dualStoreConfig),     // NEW: CLS dual-store
    reflector: createConsolidator(consolConfig),  // NEW: replaces reflector
    monitor: createMonitor(monitorConfig),        // v1 or v2 — either works
    reasoner: createReasoner(adapter),
    // ... remaining modules unchanged
  }
});
```

### CLS Dual-Store Theory

The design is inspired by McClelland, McNaughton, O'Reilly (1995) with updates from Kumaran, Hassabis, McClelland (2016). The core insight: the update dynamics required for fast one-shot episodic storage and slow statistical generalization are structurally different — fast one-shot storage and slow pattern extraction benefit from separate stores with different retention policies, regardless of representation substrate.

- **Fast learning** (episodic) requires **sparse, non-overlapping** representations — so new episodes don't overwrite old ones. This gives high fidelity but no generalization.
- **Slow learning** (semantic) requires **distributed, overlapping** representations — so shared structure across episodes can be extracted. This gives generalization but is vulnerable to catastrophic forgetting if updated too quickly.

The solution: two stores connected by interleaved replay. The fast store captures episodes verbatim. During consolidation (hippocampal replay), episodes are replayed to the slow store in an interleaved fashion — mixing recent and older episodes — so the slow store can extract patterns without catastrophic forgetting.

### Module Dependency Graph

```
                    Workspace
                       |
          ┌────────────┼────────────┐
          v            v            v
    MemoryV3      Consolidator   (other modules)
    ┌──────┐      ┌──────────┐
    │ Fast │<─────│  Online   │   (store episode during LEARN)
    │(epis)│      │  mode     │
    │      │      ├──────────┤
    │ Slow │<─────│  Offline  │   (interleaved replay via Sleep API)
    │(sem) │      │  mode     │
    └──┬───┘      └──────────┘
       │
   ACT-R Activation
   (retrieval algorithm)
```

### Type Definitions

#### DualStoreConfig

```typescript
interface DualStoreConfig {
  episodic: {
    /** Maximum episodes in fast store. FIFO eviction when exceeded. Default: 50. */
    capacity: number;
    /** Encoding strategy. Verbatim = high-fidelity, minimal processing. */
    encoding: 'verbatim';
  };
  semantic: {
    /** Maximum patterns in slow store. Default: 500. */
    capacity: number;
    /** Encoding strategy. Extracted = generalized rules/patterns. */
    encoding: 'extracted';
    /** Update rate. Slow = only updated through consolidation, never directly. */
    updateRate: 'slow';
  };
  consolidation: {
    /** Number of episodes to replay per consolidation pass. Default: 5. */
    replayBatchSize: number;
    /** Ratio of recent-to-old episodes in replay batch. 0.6 = 60% recent. Default: 0.6. */
    interleaveRatio: number;
    /** Minimum similarity score for schema-consistent fast-tracking. Default: 0.8. */
    schemaConsistencyThreshold: number;
  };
}
```

#### EpisodicEntry

```typescript
interface EpisodicEntry {
  /** Unique identifier. */
  id: string;
  /** Verbatim episode content — the full trace or observation as stored. */
  content: string;
  /** Context tags at time of storage — workspace state, active goals, module sources. */
  context: string[];
  /** Timestamp of initial storage (ms since epoch). */
  timestamp: number;
  /** Number of times this entry has been retrieved. Feeds ACT-R base-level activation. */
  accessCount: number;
  /** Timestamp of most recent retrieval (ms since epoch). */
  lastAccessed: number;
}
```

#### SemanticEntry

```typescript
interface SemanticEntry {
  /** Unique identifier. */
  id: string;
  /** Generalized pattern, rule, or principle extracted from episodes. */
  pattern: string;
  /** IDs of episodic entries this pattern was derived from. Provenance chain. */
  sourceEpisodes: string[];
  /** Confidence in this pattern (0-1). Increases with corroborating episodes. */
  confidence: number;
  /** ACT-R base-level activation — computed from access frequency and recency. */
  activationBase: number;
  /** Semantic tags for spreading activation context matching. */
  tags: string[];
  /** Timestamp of initial creation (ms since epoch). */
  created: number;
  /** Timestamp of last update via consolidation (ms since epoch). */
  updated: number;
}
```

#### ConsolidationConfig

```typescript
interface ConsolidationConfig {
  /** Online mode depth: shallow = 1-2 lessons, deep = cross-episode patterns. */
  onlineDepth: 'shallow' | 'deep';
  /** Number of episodes to replay during offline consolidation. Default: 20. */
  offlineReplayCount: number;
  /** Ratio of recent-to-old episodes in interleaved replay batch. Default: 0.6. */
  offlineInterleaveRatio: number;
  /** Activation threshold below which semantic entries are pruned. Default: -1.0. */
  pruningThreshold: number;
  /** Module ID override. Default: 'consolidator'. */
  id?: string;
}
```

#### ConsolidationResult

```typescript
interface ConsolidationResult {
  /** Number of new semantic patterns extracted during this pass. */
  semanticUpdates: number;
  /** Number of schema-inconsistent episodes flagged for slow integration. */
  conflictsDetected: number;
  /** Ratio of episodic entries compressed or evicted. */
  compressionRatio: number;
  /** Number of low-activation semantic entries pruned. */
  entriesPruned: number;
  /** Total episodes replayed in this consolidation pass. */
  episodesReplayed: number;
  /** Duration of consolidation pass in milliseconds. */
  durationMs: number;
}
```

#### MemoryPortV3

The existing `MemoryPortV2` interface (PRD 031) supports FactCard operations but has no concept of dual stores or activation-based retrieval. A new `MemoryPortV3` extends it:

```typescript
interface MemoryPortV3 extends MemoryPort {
  /** Store a verbatim episode in the fast episodic store. */
  storeEpisodic(episode: EpisodicEntry): Promise<void>;

  /** Store a generalized pattern in the slow semantic store. Only called by consolidation. */
  storeSemantic(pattern: SemanticEntry): Promise<void>;

  /** Retrieve an episodic entry by ID. */
  retrieveEpisodic(id: string): Promise<EpisodicEntry | null>;

  /** Retrieve a semantic entry by ID. */
  retrieveSemantic(id: string): Promise<SemanticEntry | null>;

  /** Search both stores by ACT-R activation, returning top entries above threshold. */
  searchByActivation(context: string[], limit: number): Promise<(EpisodicEntry | SemanticEntry)[]>;

  /** Run offline consolidation over the episodic store. */
  consolidate(config: ConsolidationConfig): Promise<ConsolidationResult>;

  /** List all episodic entries (for consolidation iteration). */
  allEpisodic(): Promise<EpisodicEntry[]>;

  /** List all semantic entries (for consolidation iteration). */
  allSemantic(): Promise<SemanticEntry[]>;

  /** Update a semantic entry (confidence, activation, tags). Only called by consolidation. */
  updateSemantic(id: string, updates: Partial<Pick<SemanticEntry, 'confidence' | 'activationBase' | 'tags' | 'pattern'>>): Promise<void>;

  /** Remove a semantic entry (pruning during consolidation). */
  expireSemantic(id: string): Promise<void>;

  /** Remove an episodic entry (eviction or compression). */
  expireEpisodic(id: string): Promise<void>;
}
```

### ACT-R Activation-Based Retrieval

Keyword search is replaced with Anderson's activation equations (ACT-R; Anderson 1993, 2007). This is the most validated computational model of human memory retrieval, predicting both accuracy and latency across hundreds of experimental conditions.

The activation of a memory chunk determines its accessibility. Chunks with activation above a retrieval threshold are retrievable; chunks below the threshold are effectively "forgotten" — stored but inaccessible. This models the well-established finding that memories are not lost but become irretrievable when not maintained.

```typescript
function computeActivation(
  chunk: EpisodicEntry | SemanticEntry,
  context: string[],
  now: number,
): number {
  // ── Base-level activation ──────────────────────────────────────
  // Power-law decay: frequently and recently accessed items have higher activation.
  // This captures the well-established finding that memory strength follows a
  // power function of time since last access (Anderson & Schooler 1991).
  const age = Math.max(1, (now - getLastAccessed(chunk)) / 1000); // seconds, floor at 1
  const accessCount = getAccessCount(chunk);
  const baseLevelA = Math.log(accessCount / Math.sqrt(age));

  // ── Spreading activation ───────────────────────────────────────
  // Context elements spread activation to chunks that share tags/context.
  // Each matching element contributes a fixed weight (0.3).
  // This models associative priming: related concepts activate each other.
  const chunkTags = new Set(getTags(chunk));
  const contextSet = new Set(context);
  const overlap = [...contextSet].filter(t => chunkTags.has(t)).length;
  const spreadingA = overlap * 0.3;

  // ── Partial match penalty ──────────────────────────────────────
  // Low-confidence entries receive a retrieval penalty.
  // This models the finding that weakly encoded memories require
  // stronger cues for successful retrieval.
  const confidence = getConfidence(chunk);
  const partialMatchPenalty = confidence < 0.5 ? -0.2 : 0;

  // ── Noise ──────────────────────────────────────────────────────
  // Stochastic component prevents deterministic retrieval loops.
  // Models the well-established variability in human recall — the same
  // cue does not always retrieve the same memory. Enables natural
  // exploration of memory space.
  const noise = (Math.random() - 0.5) * 0.1;

  return baseLevelA + spreadingA + partialMatchPenalty + noise;
}
```

This is a simplified single-access approximation of ACT-R's full base-level learning equation, which sums decay over all individual access timestamps. The core behavioral properties — power-law-like decay, frequency sensitivity, context-dependent spreading activation, and stochastic retrieval — are preserved. The full ACT-R equation can be substituted without changing the module interface.

**Retrieval rule:** Sort all entries (episodic + semantic) by activation. Return top-N entries whose activation exceeds the retrieval threshold (default: -0.5). Entries below threshold are "forgotten" — stored but inaccessible. The threshold is configurable to tune the tradeoff between recall (lower threshold, more results, more noise) and precision (higher threshold, fewer results, higher relevance).

**Why this matters:** The noise parameter ensures the agent does not always retrieve the same facts for the same context. This creates natural exploration of memory, preventing the agent from getting locked into a single retrieval pattern. The power-law decay ensures that old, unused memories gracefully fade while frequently accessed memories remain highly available — matching the well-documented characteristics of human long-term memory (Anderson & Schooler 1991).

### Modules to Deliver

#### 1. MemoryV3 — CLS Dual-Store

A cognitive module implementing `CognitiveModule<MemoryV3Input, MemoryV3Output, MemoryV3State, MemoryMonitoring, MemoryV3Control>`.

Two stores with opposite properties, inspired by McClelland et al. (1995):

- **Fast store (episodic):** Verbatim episodes. High-fidelity, sparse encoding. Bounded capacity with FIFO eviction. Indexed by recency + context. Minimal interference between episodes — new entries do not overwrite old ones. Analogous to hippocampal memory.

- **Slow store (semantic):** Extracted patterns, rules, and generalizations. Distributed encoding with overlapping representations. Updated ONLY through consolidation — never directly by the REMEMBER phase or by external callers. Protected from catastrophic forgetting by interleaved replay. Analogous to neocortical memory.

**REMEMBER phase behavior:** When the cycle enters REMEMBER, MemoryV3 queries both stores using ACT-R activation. Episodic entries are activated by recency + context match. Semantic entries are activated by base-level activation + spreading activation from current workspace context. Results are merged, sorted by activation, and the top-N above threshold are written to the workspace as high-salience entries.

**LEARN phase behavior:** MemoryV3 does not directly handle LEARN — that is the Consolidator's responsibility. MemoryV3 exposes `MemoryPortV3` for the Consolidator to write to both stores.

References: McClelland, McNaughton, O'Reilly 1995; O'Reilly & Norman 2002; Kumaran, Hassabis, McClelland 2016; MIRIX architecture 2025; Google Nested Learning NeurIPS 2025.

#### 2. ACT-R Activation-Based Retrieval

Not a separate module but the retrieval algorithm used by MemoryV3 internally. Replaces the keyword-based `searchCards()` in Memory v2.

The activation equation is defined above. Helper functions:

```typescript
function getLastAccessed(chunk: EpisodicEntry | SemanticEntry): number {
  return 'lastAccessed' in chunk ? chunk.lastAccessed : chunk.updated;
}

function getAccessCount(chunk: EpisodicEntry | SemanticEntry): number {
  return 'accessCount' in chunk ? chunk.accessCount : Math.max(1, chunk.sourceEpisodes.length);
}

function getTags(chunk: EpisodicEntry | SemanticEntry): string[] {
  return 'tags' in chunk ? chunk.tags : ('context' in chunk ? chunk.context : []);
}

function getConfidence(chunk: EpisodicEntry | SemanticEntry): number {
  return 'confidence' in chunk ? chunk.confidence : 1.0;
}
```

**Configuration:**

```typescript
interface ActivationConfig {
  /** Retrieval threshold. Entries below this activation are inaccessible. Default: -0.5. */
  retrievalThreshold: number;
  /** Weight per context element in spreading activation. Default: 0.3. */
  spreadingWeight: number;
  /** Penalty for low-confidence entries. Default: -0.2. */
  partialMatchPenalty: number;
  /** Noise amplitude. Higher = more stochastic retrieval. Default: 0.1. */
  noiseAmplitude: number;
  /** Maximum entries to retrieve per step. Default: 5. */
  maxRetrievals: number;
}
```

References: Anderson 1993 (original ACT-R); Anderson 2007 (How Can the Human Mind Occur in the Physical Universe?); Anderson & Schooler 1991 (power-law forgetting).

#### 3. Consolidation Module (extends/replaces Reflector)

A cognitive module implementing `CognitiveModule<ConsolidatorInput, ConsolidatorOutput, ConsolidatorState, ReflectorMonitoring, ConsolidatorControl>`. Uses the same `ReflectorMonitoring` signal type as the existing Reflector for backward compatibility with Monitor threshold policies.

The Consolidator is split across two sub-domains: (a) the online LEARN-phase handler lives in `modules/consolidator.ts` as a standard CognitiveModule — it stores episodes and extracts shallow lessons with the same fire-and-forget contract as the Reflector it replaces. (b) The offline consolidation pipeline (interleaved replay, schema consistency checking, compression, pruning) lives in `engine/consolidation.ts` as a standalone orchestration function. The Sleep API calls the engine function, not the module.

Two operational modes:

**Online mode (during LEARN phase):** Preserves the Reflector's fire-and-forget semantics. When the cycle enters LEARN:
1. Store the current episode verbatim in the episodic store — full workspace snapshot + action outcome.
2. Extract 1-2 shallow lessons from the cycle traces (same logic as the existing Reflector's shallow mode).
3. Return immediately. No consolidation, no replay. The episodic store is the only write target.

This ensures LEARN phase latency remains bounded and predictable — the same contract as the existing Reflector.

**Offline mode (between sessions, triggered by Sleep API):** Full consolidation pass with interleaved replay, inspired by CLS theory (McClelland et al. 1995) and hippocampal replay findings (2025 Trends in Neurosciences):

1. **Sample interleaved batch** from episodic store: `ceil(replayCount * interleaveRatio)` recent episodes + `floor(replayCount * (1 - interleaveRatio))` older episodes. The interleaving prevents catastrophic forgetting — the slow store sees a mix of recent and old experiences, allowing it to update without losing previously learned patterns.

2. **Schema consistency check** for each replayed episode: Compare the episode against existing semantic entries. If the episode is consistent with existing patterns (overlap score >= `schemaConsistencyThreshold`), it is **schema-consistent** and can be fast-tracked to the semantic store — immediate integration with increased confidence on the matching pattern. This follows Kumaran et al. (2016): schema-consistent information is rapidly integrated into neocortical representations even outside of sleep. Overlap score is computed as Jaccard similarity on normalized tag sets: `|tags_episode ∩ tags_semantic| / |tags_episode ∪ tags_semantic|`. Tags are lowercased and deduplicated before comparison. Content-level similarity (TF-IDF, embeddings) is deferred to a future iteration.

3. **Schema-inconsistent episodes** remain in the episodic store only. They are not integrated into the semantic store on this pass. Over multiple consolidation passes, if a schema-inconsistent pattern appears repeatedly, it will eventually form its own semantic entry — the slow store learns the new pattern gradually without overwriting existing knowledge.

4. **Compression:** Old episodic entries beyond the fast store's capacity are compressed to summary form. The summary preserves key facts but discards verbatim detail. This models the well-established finding that episodic memories lose perceptual detail over time while retaining gist.

5. **Pruning:** Semantic entries whose ACT-R activation has decayed below `pruningThreshold` are removed. This models the forgetting of unused generalizations — patterns that were once relevant but are no longer accessed or corroborated.

References: Hippocampal replay (2025 Trends in Neurosciences — "Awake replay: off the clock but on the job"); interleaved learning prevents catastrophic forgetting (McClelland et al. 1995); schema-consistent rapid learning (Kumaran, Hassabis, McClelland 2016); Google Nested Learning (NeurIPS 2025).

#### 4. Sleep API

Programmatic and HTTP interface for triggering offline consolidation between sessions.

```typescript
// Standalone function — does not extend CognitiveAgent interface
import { consolidateOffline } from '@method/pacta';

await consolidateOffline(store, {
  mode: 'offline',
  replayCount: 20,
  interleaveRatio: 0.6,
});

// Returns ConsolidationResult with stats:
// {
//   semanticUpdates: 8,
//   conflictsDetected: 3,
//   compressionRatio: 0.4,
//   entriesPruned: 2,
//   episodesReplayed: 20,
//   durationMs: 142,
// }
```

The Sleep API is a standalone function that operates on the shared InMemoryDualStore instance, not a method on CognitiveAgent. This avoids modifying the CognitiveAgent interface from PRD 030.

If the bridge integration is pursued in a follow-up PRD, the Sleep API would be exposed as:

```
POST /sessions/:id/consolidate
Content-Type: application/json

{
  "replayCount": 20,
  "interleaveRatio": 0.6
}
```

The Sleep API can also be triggered on a schedule (e.g., after every N cycles, or when the agent is idle) via the existing trigger system (PRD 018).

### Preset Composition

A convenience preset composing MemoryV3 + Consolidator for common use:

```typescript
function createMemoryPreset(config: {
  dualStore: DualStoreConfig;
  consolidation: ConsolidationConfig;
  activation: ActivationConfig;
  writePort: WorkspaceWritePort;
}): {
  memory: CognitiveModule<MemoryV3Input, MemoryV3Output, MemoryV3State, MemoryMonitoring, MemoryV3Control>;
  consolidator: CognitiveModule<ConsolidatorInput, ConsolidatorOutput, ConsolidatorState, ReflectorMonitoring, ConsolidatorControl>;
  store: MemoryPortV3;
} {
  const store = createInMemoryDualStore(config.dualStore, config.activation);
  return {
    memory: createMemoryV3(store, config.writePort, config.activation),
    consolidator: createConsolidator(store, config.consolidation),
    store,
  };
}
```

## Alternatives Considered

### Alternative 1: Extend MemoryV2 with consolidation logic inline

Add a consolidation pass inside the existing `createMemoryModuleV2` factory, keeping the single FactCard store.

**Pros:** No new module, no new port interface, incremental change.
**Cons:** A single store cannot achieve the CLS separation. FactCards with different epistemic types (OBSERVATION vs HEURISTIC) are stored in the same flat collection with the same update dynamics. Adding consolidation without separating the stores would require complex guards to prevent direct writes to "semantic-like" entries — guards that fight the data model rather than being expressed by it.
**Why rejected:** The CLS insight is that the two stores need opposite properties (sparse vs distributed encoding, fast vs slow update rates). Retrofitting this onto a single store produces a worse design than building the separation into the architecture.

### Alternative 2: Vector embedding retrieval instead of ACT-R activation

Use vector embeddings (e.g., sentence-transformers) for retrieval similarity instead of the ACT-R activation equation.

**Pros:** Semantic similarity via embeddings would capture meaning better than tag overlap.
**Cons:** Requires an external embedding model dependency (violates G-PORT — zero runtime dependencies). Embeddings don't model temporal decay or frequency effects. A memory that is semantically similar but old and unused should not be retrieved — ACT-R captures this via base-level activation. Embeddings do not.
**Why rejected:** ACT-R activation captures temporal, frequency, and context effects in a single equation with no external dependencies. Embedding retrieval can be added as a future enhancement to the spreading activation component without replacing the core equation.

### Alternative 3: External vector database for persistent memory

Use ChromaDB, Pinecone, or similar for persistent cross-session memory.

**Pros:** Production-grade persistence, scalable retrieval.
**Cons:** Massive external dependency. In-memory-only constraint (this is L3 research infrastructure, not production). The cognitive architecture should be validated before committing to a storage backend.
**Why rejected:** Out of scope. In-memory implementation first; persistence port can be added later (same pattern as workspace persistence — PRD 030 deferred it for the same reason).

## Scope

### In-Scope

- `MemoryV3` cognitive module implementing CLS dual-store with ACT-R retrieval
- ACT-R activation computation function (base-level + spreading + partial match + noise)
- `MemoryPortV3` interface extending `MemoryPort` with dual-store and activation operations
- `InMemoryDualStore` — in-memory implementation of `MemoryPortV3`
- `Consolidation` module with online (LEARN phase) and offline (Sleep API) modes
- Schema consistency checking for fast-track semantic integration
- Episodic compression and semantic pruning during offline consolidation
- Sleep API — programmatic interface for triggering offline consolidation
- `createMemoryPreset()` convenience factory composing MemoryV3 + Consolidator
- Testkit extensions: `DualStoreBuilder`, `ConsolidationAssertions`
- 37+ test scenarios across 4 phases

### Out-of-Scope

- Vector embedding storage — requires external dependency (violates G-PORT)
- Persistent disk storage — in-memory only for L3 validation
- Distributed memory across agents — single-agent scope
- Bridge HTTP endpoint for Sleep API — bridge integration is a follow-up PRD
- Monitor v2 or Attention v2 — those are separate PRDs even though they compose with this one

### Non-Goals

- Replacing MemoryPort v1 or MemoryPortV2 — they remain for existing consumers
- Achieving human memory fidelity — CLS is a design inspiration, not a simulation target
- Production performance optimization — research infrastructure; optimize after validation
- Formal mathematical proof of consolidation convergence — empirical validation via test scenarios

## Implementation Phases

### Phase 1: ACT-R Activation + MemoryPortV3

The foundation — activation computation and the port interface that all modules depend on.

Files:
- `packages/pacta/src/ports/memory-port.ts` — modified — add `EpisodicEntry`, `SemanticEntry`, `DualStoreConfig`, `ActivationConfig`, `ConsolidationConfig`, `ConsolidationResult`, `MemoryPortV3` interface
- `packages/pacta/src/cognitive/modules/activation.ts` — new — `computeActivation()`, `getLastAccessed()`, `getAccessCount()`, `getTags()`, `getConfidence()` helpers
- `packages/pacta/src/cognitive/modules/in-memory-dual-store.ts` — new — `InMemoryDualStore` implementing `MemoryPortV3`, FIFO eviction on episodic store, activation-sorted retrieval
- `packages/pacta/src/cognitive/modules/__tests__/activation.test.ts` — new — 12 scenarios:
  1. Base-level activation increases with access count
  2. Base-level activation decreases with age (power-law decay)
  3. Spreading activation increases with context overlap
  4. Spreading activation is zero with no context match
  5. Partial match penalty applied when confidence < 0.5
  6. Partial match penalty is zero when confidence >= 0.5
  7. Noise produces different values across calls
  8. Noise amplitude scales with configuration
  9. Total activation is sum of all four components
  10. Retrieval threshold filters low-activation entries
  11. Below-threshold entries are excluded from results
  12. Results sorted by activation descending

Checkpoint: `npm run build` passes. Activation function independently tested.

### Phase 2: MemoryV3 Module

Files:
- `packages/pacta/src/cognitive/modules/memory-module-v3.ts` — new — `createMemoryV3()` factory, CLS dual-store module implementing `CognitiveModule`, uses `MemoryPortV3` + `WorkspaceWritePort`
- `packages/pacta/src/cognitive/modules/__tests__/memory-module-v3.test.ts` — new — 15 scenarios:
  1. Retrieves from both episodic and semantic stores
  2. Episodic entries sorted by recency + context activation
  3. Semantic entries sorted by ACT-R activation
  4. Merged results written to workspace as high-salience entries
  5. Respects maxRetrievals limit
  6. Emits MemoryMonitoring signal with retrieval count and relevance
  7. Episodic store enforces FIFO capacity — oldest evicted first
  8. Semantic store is never written to directly by MemoryV3 (only by consolidation)
  9. Episodic entry accessCount incremented on retrieval
  10. Episodic entry lastAccessed updated on retrieval
  11. Empty stores produce zero retrievals without error
  12. Module composes with v1 Monitor (threshold policy works with MemoryMonitoring signals)
  13. Module composes with v2 Monitor (same)
  14. step() rejection on MemoryPortV3 failure produces recoverable StepError
  15. Module ID defaults to 'memory-v3', overridable via config

Dependencies: Phase 1.
Checkpoint: `npm run build` passes. MemoryV3 implements CognitiveModule. Dual-store invariants tested.

### Phase 3: Consolidation Module

Files:
- `packages/pacta/src/cognitive/modules/consolidator.ts` — new — online LEARN-phase module, `createConsolidator()` factory, stores episodes and extracts shallow lessons
- `packages/pacta/src/cognitive/engine/consolidation.ts` — new — offline consolidation orchestration, interleaved replay, schema consistency checking, compression, pruning
- `packages/pacta/src/cognitive/modules/__tests__/consolidator.test.ts` — new — 10 scenarios:
  1. Online mode stores episode verbatim in episodic store
  2. Online mode extracts 1-2 shallow lessons from traces
  3. Online mode does not write to semantic store
  4. Offline mode samples interleaved batch (correct recent/old ratio)
  5. Offline mode fast-tracks schema-consistent episodes to semantic store
  6. Offline mode leaves schema-inconsistent episodes in episodic store only
  7. Offline mode compresses old episodic entries when capacity exceeded
  8. Offline mode prunes low-activation semantic entries
  9. Offline mode returns ConsolidationResult with accurate stats
  10. Emits ReflectorMonitoring signal with lessonsExtracted count (backward compat)

Dependencies: Phase 1, Phase 2.
Checkpoint: `npm run build` passes. Consolidator implements CognitiveModule. Online and offline paths independently verified.

### Phase 4: Sleep API + Preset + Integration

Files:
- `packages/pacta/src/cognitive/modules/memory-preset.ts` — new — `createMemoryPreset()` factory composing MemoryV3 + Consolidator + InMemoryDualStore
- `packages/pacta/src/cognitive/modules/sleep-api.ts` — new — `consolidateOffline()` standalone function wrapping the offline consolidation engine, operates on InMemoryDualStore instance
- `packages/pacta/src/cognitive/modules/__tests__/memory-preset.test.ts` — new — 5 scenarios:
  1. Preset produces valid MemoryV3 + Consolidator modules
  2. Both modules share the same InMemoryDualStore instance
  3. Online consolidation during LEARN stores episodes retrievable by MemoryV3
  4. Offline consolidation via Sleep API transfers episodic to semantic
  5. Cross-session knowledge retained after consolidation (episodic -> semantic -> retrieval)
- `packages/pacta/src/cognitive/modules/__tests__/sleep-api.test.ts` — new — 3 scenarios:
  1. Sleep API triggers offline consolidation and returns ConsolidationResult
  2. Sleep API respects replayCount and interleaveRatio parameters
  3. Sleep API callable multiple times (idempotent on empty episodic store)
- `packages/pacta/src/cognitive/modules/__tests__/integration-memory-v3.test.ts` — new — 5 scenarios:
  1. Full cycle: OBSERVE -> REMEMBER (MemoryV3) -> REASON -> ACT -> LEARN (Consolidator) end-to-end
  2. After 5 cycles + offline consolidation: semantic store contains generalized patterns
  3. Retrieval relevance: top-5 results from activation retrieval vs keyword baseline
  4. Catastrophic forgetting test: 100 new episodes, semantic store retains prior patterns
  5. MemoryV3 + Consolidator compose with asFlatAgent() adapter (PRD 030 interop)

Dependencies: Phases 1-3.
Checkpoint: `npm run build` passes. `npm test` passes. Integration scenarios verified end-to-end.

## Acceptance Criteria

### AC-01: Episodic store preserves verbatim episode content

**Given** an episode stored via `storeEpisodic()`
**When** the episode is retrieved by ID
**Then** the content field is identical to the stored content (byte-for-byte)
**Test location:** `packages/pacta/src/cognitive/modules/__tests__/memory-module-v3.test.ts`
**Automatable:** yes

### AC-02: Semantic store only updated through consolidation

**Given** a MemoryV3 module and an InMemoryDualStore
**When** the MemoryV3 module's `step()` is called during REMEMBER phase
**Then** the semantic store has no new entries (only consolidation writes to semantic)
**Test location:** `packages/pacta/src/cognitive/modules/__tests__/memory-module-v3.test.ts` scenario 8
**Automatable:** yes

### AC-03: ACT-R activation correctly computes base-level + spreading + noise

**Given** an entry with accessCount=10, age=3600s, 2 matching context tags, confidence=0.8
**When** `computeActivation()` is called
**Then** the result equals `ln(10/sqrt(3600)) + 2*0.3 + 0 + noise` within noise bounds
**Test location:** `packages/pacta/src/cognitive/modules/__tests__/activation.test.ts` scenario 9
**Automatable:** yes

### AC-04: Retrieval returns entries above activation threshold, sorted by activation

**Given** 10 entries in dual store with varying activation levels and a threshold of -0.5
**When** `searchByActivation()` is called
**Then** only entries with activation > -0.5 are returned, sorted descending by activation
**Test location:** `packages/pacta/src/cognitive/modules/__tests__/activation.test.ts` scenario 10
**Automatable:** yes

### AC-05: Below-threshold entries are inaccessible

**Given** an entry stored with accessCount=1 and age=1,000,000s (very old, rarely accessed)
**When** `searchByActivation()` is called with default threshold
**Then** the entry is not in the results (correctly "forgotten")
**Test location:** `packages/pacta/src/cognitive/modules/__tests__/activation.test.ts` scenario 11
**Automatable:** yes

### AC-06: Noise parameter produces different retrieval orderings across calls

**Given** 5 entries with similar activation levels (within noise amplitude)
**When** `searchByActivation()` is called twice with the same context
**Then** the two orderings are not identical (stochastic retrieval verified)
**Test location:** `packages/pacta/src/cognitive/modules/__tests__/activation.test.ts` scenario 7
**Automatable:** yes (run N trials, assert not all identical)

### AC-07: Online consolidation stores episode and extracts shallow lessons

**Given** a Consolidator in online mode with cycle traces
**When** the Consolidator's `step()` is called during LEARN phase
**Then** exactly 1 episodic entry is stored AND 1-2 Lesson objects are returned in the output
**Test location:** `packages/pacta/src/cognitive/modules/__tests__/consolidator.test.ts` scenarios 1-2
**Automatable:** yes

### AC-08: Offline replay interleaves recent and old episodes

**Given** an episodic store with 30 episodes (10 recent, 20 older) and `interleaveRatio=0.6` and `replayCount=10`
**When** offline consolidation is triggered
**Then** the replay batch contains 6 recent episodes and 4 older episodes
**Test location:** `packages/pacta/src/cognitive/modules/__tests__/consolidator.test.ts` scenario 4
**Automatable:** yes

### AC-09: Schema-consistent facts are fast-tracked to semantic store

**Given** an episodic entry whose content matches an existing semantic pattern above `schemaConsistencyThreshold`
**When** offline consolidation replays this episode
**Then** the matching semantic entry's confidence increases and the episode is marked as consolidated
**Test location:** `packages/pacta/src/cognitive/modules/__tests__/consolidator.test.ts` scenario 5
**Automatable:** yes

### AC-10: Schema-inconsistent facts remain in episodic store only

**Given** an episodic entry whose content does NOT match any semantic pattern above threshold
**When** offline consolidation replays this episode
**Then** no new semantic entry is created on this pass, and the episode remains in episodic store
**Test location:** `packages/pacta/src/cognitive/modules/__tests__/consolidator.test.ts` scenario 6
**Automatable:** yes

### AC-11: Old episodic entries are compressed when capacity reached

**Given** an episodic store at capacity (50 entries) with 10 entries older than the median age
**When** a new episode is stored
**Then** the oldest entry is evicted (FIFO), and a compressed summary is available
**Test location:** `packages/pacta/src/cognitive/modules/__tests__/memory-module-v3.test.ts` scenario 7
**Automatable:** yes

### AC-12: Sleep API triggers offline consolidation and returns stats

**Given** an agent with MemoryV3 + Consolidator and 20 episodic entries
**When** `consolidateOffline(store, { mode: 'offline', replayCount: 20, interleaveRatio: 0.6 })` is called
**Then** a ConsolidationResult is returned with `episodesReplayed: 20`, `durationMs > 0`, and accurate `semanticUpdates` and `conflictsDetected` counts
**Test location:** `packages/pacta/src/cognitive/modules/__tests__/sleep-api.test.ts` scenario 1
**Automatable:** yes

### AC-13: MemoryV3 composes with any Monitor version

**Given** a cognitive agent configured with MemoryV3 and Monitor v1 (or v2)
**When** the cognitive cycle executes
**Then** the Monitor correctly reads MemoryMonitoring signals from MemoryV3 and threshold policies function as expected
**Test location:** `packages/pacta/src/cognitive/modules/__tests__/memory-module-v3.test.ts` scenarios 12-13
**Automatable:** yes

## Success Metrics

| Metric | Target | Method | Baseline |
|--------|--------|--------|----------|
| Cross-session knowledge retention | >60% of relevant facts retrievable after 5 sessions | Consolidation test battery: store 50 facts across 5 mock sessions, consolidate between each, measure retrieval rate at end | v2: 0% (no consolidation pathway) |
| Retrieval relevance | >80% of top-5 results rated relevant | Human eval on 20 test queries against populated dual store | v2: ~50% (keyword match) |
| Catastrophic forgetting rate | <5% of semantic entries lost after 100 new episodes | Stability test: populate semantic store with 50 patterns, add 100 new episodes with consolidation, measure survival rate | N/A (new capability) |
| Episodic-to-semantic conversion | >30% of episodic entries consolidated per offline pass | Consolidation metrics from ConsolidationResult across test scenarios | v2: 0% (no consolidation) |

## Risks & Mitigations

| Risk | Severity | Likelihood | Impact | Mitigation |
|------|----------|-----------|--------|-----------|
| ACT-R activation parameters poorly tuned — retrieval too noisy or too strict | High | Medium | Agent retrieves irrelevant entries or "forgets" everything | All activation parameters are configurable (threshold, spreading weight, noise amplitude). Phase 1 includes 12 test scenarios calibrating parameter effects. Default values derived from ACT-R literature. |
| Schema consistency check produces false positives — inconsistent episodes fast-tracked to semantic store | High | Medium | Semantic store corrupted with contradictory patterns, catastrophic forgetting of established knowledge | Conservative default threshold (0.8). Schema consistency uses tag overlap + content similarity, not just keyword match. Phase 3 tests include adversarial scenarios with contradictory episodes. |
| Consolidation pass is too expensive for large episodic stores | Medium | Medium | Sleep API blocks for unacceptable duration, or offline consolidation dominates idle time | Batch size is configurable (default: 20 episodes per pass). Consolidation is offline-only by design — never blocks the cognitive cycle. Multiple small passes preferred over one large pass. |
| Interleaved replay ratio is wrong — too much recency bias or not enough | Medium | High | Either recent experiences dominate the semantic store (forgetting old patterns) or old patterns dominate (failing to learn new ones) | Interleave ratio is a tunable parameter (default: 0.6 recent). Phase 3 tests sweep ratios from 0.3 to 0.9 to characterize behavior. |
| FIFO eviction in episodic store drops important old episodes before consolidation | Medium | Medium | Episodes evicted before they can be consolidated to semantic store | Episodic capacity default (50) is generous relative to typical session length. Consolidation should be triggered before episodic store fills. Sleep API documentation emphasizes consolidation frequency. |
| MemoryPortV3 interface too large — violates interface segregation | Low | Low | Consumers forced to implement methods they don't need | MemoryPortV3 extends MemoryPort (not MemoryPortV2) — consumers can implement only the methods they need. InMemoryDualStore is the canonical full implementation. |

## Dependencies & Cross-Domain Impact

### Depends On

- PRD 030: Pacta Cognitive Composition — CognitiveModule interface, composition operators, cycle engine, workspace ports, MonitoringSignal types, TraceSink infrastructure

### Enables

- Monitor v2 PRD (prediction-error monitoring) — MemoryV3's monitoring signals integrate with enriched monitoring
- Affect module PRD — somatic markers stored in semantic memory
- Curiosity module PRD — learning progress computed from episodic store

### Blocks / Blocked By

None. PRD 030 is implemented.

## Documentation Impact

| Document | Action | Details |
|----------|--------|---------|
| `docs/arch/cognitive-composition.md` | Update | Add CLS dual-store section, MemoryPortV3, ACT-R retrieval |
| `docs/guides/cognitive-memory-v3.md` | Create | Usage guide: configuring dual store, tuning activation, triggering consolidation |
| `packages/pacta/src/ports/memory-port.ts` | Update | Add MemoryPortV3, EpisodicEntry, SemanticEntry types |
| `CLAUDE.md` | Update | Add MemoryV3 and Consolidator to cognitive modules list |

## Open Questions

| # | Question | Owner | Deadline |
|---|----------|-------|----------|
| OQ-1 | What is the right default episodic capacity for production use? 50 is conservative — should it scale with session length? | PO | Phase 2 |
| OQ-2 | Should schema consistency use tag overlap only, or also content similarity (e.g., TF-IDF)? Content similarity is more accurate but adds complexity. | Implementation agent | Phase 3 |
| OQ-3 | Should the Consolidator support a `deep` online mode that does partial consolidation during the LEARN phase (not just shallow lessons)? This would improve knowledge transfer but increases LEARN latency. | PO | Phase 3 |

## References

### Primary Sources

- McClelland, J.L., McNaughton, B.L., & O'Reilly, R.C. (1995). "Why there are complementary learning systems in the hippocampus and neocortex: Insights from the successes and failures of connectionist models of learning and memory." *Psychological Review*, 102(3), 419-457.

- O'Reilly, R.C. & Norman, K.A. (2002). "Hippocampal and neocortical contributions to memory: Advances in the complementary learning systems framework." *Trends in Cognitive Sciences*, 6(12), 505-510.

- Kumaran, D., Hassabis, D., & McClelland, J.L. (2016). "What Learning Systems do Intelligent Agents Need? Complementary Learning Systems Theory Updated." *Trends in Cognitive Sciences*, 20(7), 512-534.

- Anderson, J.R. (1993). *Rules of the Mind.* Lawrence Erlbaum Associates. (Original ACT-R formalization.)

- Anderson, J.R. (2007). *How Can the Human Mind Occur in the Physical Universe?* Oxford University Press. (ACT-R activation equations, production compilation.)

- Anderson, J.R. & Schooler, L.J. (1991). "Reflections of the environment in memory." *Psychological Science*, 2(6), 396-408. (Power-law forgetting.)

### Supporting Sources

- 2025. "Awake replay: off the clock but on the job." *Trends in Neurosciences*. (Hippocampal replay during rest supports prioritized offline learning and tags memories for consolidation.)

- MIRIX Architecture (2025). Six-component memory system for LLM agents: Core, Episodic, Semantic, Procedural, Resource, Knowledge Vault. Demonstrates episodic-to-semantic conversion pathway.

- Google Nested Learning (NeurIPS 2025). Treats a single model as interconnected optimization problems at different speeds. HOPE proof-of-concept demonstrated unbounded in-context learning without forgetting.

- arXiv:2512.13564 (2025). "Memory in the Age of AI Agents." Survey of memory architectures for autonomous agents, including CLS-inspired designs.

## Implementation Status

| Phase | Status | Notes |
|-------|--------|-------|
| Phase 1: ACT-R Activation + MemoryPortV3 | pending | |
| Phase 2: MemoryV3 Module | pending | |
| Phase 3: Consolidation Module | pending | |
| Phase 4: Sleep API + Preset + Integration | pending | |
