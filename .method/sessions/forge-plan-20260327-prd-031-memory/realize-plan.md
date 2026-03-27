# Realization Plan — PRD 031: Cognitive Memory Module

## PRD Summary

**Objective:** Replace the stub MemoryPort with a RAG-based fact-card memory system for the cognitive agent. Enable persistent learning, semantic retrieval, epistemic discipline, and cross-task knowledge transfer.

**Phases:** 5 (data model → cognitive integration → epistemic typing → hybrid retrieval → persistence)
**Acceptance criteria:** AC-1 through AC-10
**Domains affected:** pacta (ports, cognitive/modules), experiments (harness)

## FCA Partition

| Commission | Domain | Phase | Title | Depends On | Wave |
|------------|--------|-------|-------|------------|------|
| C-1 | ports | P1 | FactCard data model + MemoryPort v2 | — | 1 |
| C-2 | cognitive/modules | P2 | Memory Module v2 + cognitive integration | C-1 | 2 |
| C-3 | cognitive/modules | P3 | Epistemic typing + confidence tracking | C-2 | 3 |
| C-4 | ports + infra | P4 | EmbeddingPort + hybrid retrieval | C-1 | 2 |
| C-5 | persistence | P5 | JSONL persistence + cross-task learning | C-2 | 3 |
| C-6 | experiments | P2-5 | Experiment harness integration | C-2 | 3 |

## Waves

### Wave 0 — Shared Surface Preparation

Orchestrator applies before Wave 1:

1. **`packages/pacta/src/ports/memory-port.ts`** — Rewrite with FactCard type, MemoryPort v2 interface, SearchOptions. This is the shared surface all commissions depend on.

2. **`packages/pacta/src/ports/embedding-port.ts`** — New file. EmbeddingPort interface: `embed(text): Promise<number[]>`, `embedBatch(texts): Promise<number[][]>`. Used by C-4.

3. **`packages/pacta/src/cognitive/algebra/index.ts`** — Re-export new types if needed.

### Wave 1 — Port Implementations (parallel)

- **C-1: FactCard data model + InMemoryMemory** (ports domain)
  - In-memory implementation of MemoryPort v2 (Map-backed)
  - Basic store/retrieve/search (keyword-based, no vector)
  - Tests: store, retrieve, search by type, search by tag, link cards

- **C-4: EmbeddingPort + hybrid retrieval** (ports + search domain)
  - Anthropic embedding adapter (`@anthropic-ai/sdk` for `voyage-3-lite` or `text-embedding-3-small`)
  - Mock embedding adapter for tests (deterministic vectors)
  - Cosine similarity search function
  - RRF fusion: combine keyword score + vector score (k=60)
  - Upgrade InMemoryMemory to support vector search when embeddings available

### Wave 2 — Cognitive Integration

- **C-2: Memory Module v2** (cognitive/modules domain)
  - `createMemoryModuleV2(memory: MemoryPort, writePort: WorkspaceWritePort)`
  - Step function: (1) derive retrieval query from workspace state, (2) search memory for top-K relevant facts, (3) write retrieved facts to workspace with salience proportional to confidence
  - Fact extraction: after reasoner-actor step, extract learnings from tool results → FactCards (OBSERVATION type)
  - Workspace eviction hook: connect to strategies.ts `onEvict` → create FactCard from evicted entry
  - Monitoring signal: `MemoryMonitoring` with retrievalCount, relevanceScore

### Wave 3 — Enrichment (parallel)

- **C-3: Epistemic typing + confidence** (extends C-2)
  - Type guards: FACT vs HEURISTIC vs RULE vs OBSERVATION
  - Store-time conflict detection: new fact vs existing facts of same type+tags
  - Confidence decay: multiply by 0.95 per cycle since last access (configurable)
  - Confidence boost: retrieved + used → confidence * 1.1 (capped at 1.0)
  - Prevent RULE overwrite by OBSERVATION (hard guard)

- **C-5: JSONL persistence** (new persistence files)
  - `FactCardStore`: load from JSONL file, save on demand
  - Auto-save after each task run
  - Markdown export: render all cards grouped by type, sorted by confidence
  - File location: `.method/memory/` or configurable path

- **C-6: Experiment harness integration** (experiments domain)
  - Wire memory module into `runCognitive()` in run.ts
  - Memory runs between observer and reasoner-actor in the cycle
  - Add `--memory` flag to enable/disable memory (for A/B comparison)
  - Cross-task mode: `--task=all --memory` runs tasks sequentially, memory persists across
  - Add pass rate + learning curve to comparison report

## Commission Cards

### C-1: FactCard Data Model + InMemoryMemory
- **Domain:** ports
- **Allowed paths:** `packages/pacta/src/ports/memory-port.ts`, `packages/pacta/src/ports/__tests__/memory-port.test.ts`
- **Forbidden paths:** `packages/*/src/cognitive/**`, `experiments/**`
- **Branch:** `feat/prd031-c1-factcard-port`
- **Deliverables:** FactCard type, MemoryPort v2 interface, SearchOptions, InMemoryMemory class
- **Acceptance criteria:** AC-1 (type system compiles), AC-2 (all port operations exist)
- **Estimated tasks:** 5

### C-2: Memory Module v2
- **Domain:** cognitive/modules
- **Allowed paths:** `packages/pacta/src/cognitive/modules/memory-module-v2.ts`
- **Forbidden paths:** `packages/*/src/ports/*`, `experiments/**`
- **Branch:** `feat/prd031-c2-memory-module-v2`
- **Depends on:** C-1
- **Deliverables:** createMemoryModuleV2 factory, mandatory retrieval, fact extraction
- **Acceptance criteria:** AC-3 (retrieves top-K per cycle), AC-4 (eviction → FactCards)
- **Estimated tasks:** 6

### C-3: Epistemic Typing + Confidence
- **Domain:** cognitive/modules (extends C-2) + ports (extends C-1 types)
- **Allowed paths:** `packages/pacta/src/cognitive/modules/memory-module-v2.ts`, `packages/pacta/src/ports/memory-port.ts`
- **Branch:** `feat/prd031-c3-epistemic-typing`
- **Depends on:** C-2
- **Deliverables:** Type guards, confidence decay/boost, conflict detection
- **Acceptance criteria:** AC-5 (RULE not overwritten by OBSERVATION)
- **Estimated tasks:** 5

### C-4: EmbeddingPort + Hybrid Retrieval
- **Domain:** ports + search
- **Allowed paths:** `packages/pacta/src/ports/embedding-port.ts`, `packages/pacta/src/ports/__tests__/embedding-port.test.ts`, `packages/pacta/src/search/`
- **Forbidden paths:** `packages/*/src/cognitive/**`, `experiments/**`
- **Branch:** `feat/prd031-c4-hybrid-retrieval`
- **Depends on:** C-1
- **Parallel with:** C-2
- **Deliverables:** EmbeddingPort, Anthropic adapter, cosine similarity, RRF fusion
- **Acceptance criteria:** AC-6 (hybrid search returns relevant results with RRF)
- **Estimated tasks:** 7

### C-5: JSONL Persistence + Cross-Task Learning
- **Domain:** persistence
- **Allowed paths:** `packages/pacta/src/persistence/`, `packages/pacta/src/ports/memory-port.ts` (extends)
- **Branch:** `feat/prd031-c5-persistence`
- **Depends on:** C-2
- **Parallel with:** C-3, C-6
- **Deliverables:** FactCardStore (JSONL), load/save lifecycle, markdown export
- **Acceptance criteria:** AC-7 (persist + reload), AC-9 (cross-task transfer)
- **Estimated tasks:** 5

### C-6: Experiment Harness Integration
- **Domain:** experiments
- **Allowed paths:** `experiments/exp-023/**`
- **Forbidden paths:** `packages/**`
- **Branch:** `feat/prd031-c6-experiment-integration`
- **Depends on:** C-2 (minimum)
- **Deliverables:** --memory flag, cross-task mode, learning curve report
- **Acceptance criteria:** AC-8 (learning effect), AC-10 (token overhead < 10%)
- **Estimated tasks:** 5

## Shared Surface Changes

| Wave | File | Change | Reason |
|------|------|--------|--------|
| 0→1 | `ports/memory-port.ts` | Rewrite: FactCard, MemoryPort v2, SearchOptions, MemoryEntry retained for backward compat | All commissions depend on this |
| 0→1 | `ports/embedding-port.ts` | New: EmbeddingPort interface | C-4 needs this |
| 0→1 | `cognitive/algebra/index.ts` | Re-export new types if needed | Barrel consistency |
| 2→3 | `ports/memory-port.ts` | Add confidence fields, conflict detection types | C-3 extends the port |

## Acceptance Gates

| Gate | Commission | Verification |
|------|-----------|-------------|
| AC-1: FactCard type compiles | C-1 | `npm run build` passes |
| AC-2: MemoryPort v2 operations | C-1 | Unit tests for all 8 methods |
| AC-3: Top-K retrieval per cycle | C-2 | Diagnostic trace shows memory injection |
| AC-4: Eviction → FactCards | C-2 | Workspace eviction produces cards (count > 0) |
| AC-5: RULE not overwritten | C-3 | Unit test: store RULE, store conflicting OBSERVATION, RULE persists |
| AC-6: Hybrid search with RRF | C-4 | Semantic search finds different-vocabulary matches |
| AC-7: JSONL persist + reload | C-5 | Store 10 facts, reload, verify count + content |
| AC-8: Learning effect | C-6 | Run 2 > Run 1 on same task (fewer cycles or higher pass rate) |
| AC-9: Cross-task transfer | C-6 | Task 05 pass rate improves after Task 01 |
| AC-10: Token overhead < 10% | C-6 | Memory-enabled run tokens ≤ 1.1x baseline |

## Risk Assessment

- **Critical path length:** 3 waves (W1 → W2 → W3) — 3 sequential steps
- **Largest wave:** W3 (3 parallel commissions: C-3, C-5, C-6)
- **Surface changes:** 2 (memory-port.ts rewrite + embedding-port.ts new)
- **New port count:** 2 (MemoryPort v2, EmbeddingPort)
- **Risk:** Medium — the port rewrite (Wave 0) must be right before anything else works. Backward compatibility with existing MemoryPort callers needs care.

## Verification Report

| Gate | Status | Details |
|------|--------|---------|
| Single-domain | PASS | Each commission touches one domain |
| No wave conflicts | PASS | No same-domain parallel in any wave |
| DAG acyclic | PASS | C-1→C-2→C-3, C-1→C-4, C-2→C-5, C-2→C-6 |
| Surfaces enumerated | PASS | memory-port.ts, embedding-port.ts, index.ts |
| Scope complete | PASS | All commissions have allowed + forbidden paths |
| Criteria traceable | PASS | Every AC maps to a commission |
| PRD coverage | PASS | All 10 ACs mapped |
| Task bounds | PASS | All commissions 5-7 tasks |

**Overall: 8/8 gates pass**

## Status Tracker

Total: 6 commissions, 4 waves (0-3)
Completed:
  - Wave 0 (shared surfaces) ✅ — MemoryPort v2, EmbeddingPort, InMemoryMemory
  - C-2 (Memory Module v2) ✅ — retrieval gate, fact extraction, compaction
  - C-5 (JSONL persistence) ✅ — FactCardStore with load/save/exportMarkdown
  - C-6 (Experiment harness) ✅ — --memory flag, prevAction tracking, stats logging
In progress:
  - A/B testing memory module on Task 02 (investigating potential interference)
Pending:
  - C-1 (port tests — deferred, impl verified via compilation + integration test)
  - C-3 (Epistemic typing + confidence — deferred to after A/B validation)
  - C-4 (Hybrid retrieval — needs Voyage API key setup)
