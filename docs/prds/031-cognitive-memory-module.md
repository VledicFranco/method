---
title: "PRD 031: Cognitive Memory Module — RAG-Based Fact Cards for Agent Learning"
status: proposed
date: "2026-03-27"
tier: heavyweight
depends_on: [30]
enables: []
blocked_by: []
complexity: high
domains_affected: [pacta, pacta-testkit, pacta-playground]
---

# PRD 031: Cognitive Memory Module — RAG-Based Fact Cards for Agent Learning

**Status:** Proposed
**Author:** PO + Lysica
**Date:** 2026-03-27
**Package:** `@method/pacta` (L3 — library)
**Depends on:** PRD 030 (Pacta Cognitive Composition)
**Organization:** Vidtecci — vida, ciencia y tecnologia

## Context (from research)

The current memory module is a stub — it stores/retrieves key-value pairs with no semantic search, no episodic history, no learning across cycles. The cognitive agent forgets everything between cycles except what's in the workspace (capacity 4-8 entries).

Research sources informing this design:

- **A-MEM (2025)**: Zettelkasten-inspired fact cards with dynamic indexing and linking
- **Zep**: Temporal knowledge graph with episodic + semantic vertices, 4 timestamps per fact
- **MemGPT/Letta**: Tiered memory — core (workspace), recall (history), archival (facts)
- **EXP-015**: Dual memory degrades cliff-style at 60% budget — constraint memory collapses first
- **EXP-007**: Mandatory retrieval gates eliminate constraint violations
- **EXP-008**: Epistemic type separation (FACT/OBLIGATION/PERMISSION) prevents contamination
- **EXP-018**: Five-stage compaction — extract insights before summarization
- **T1 Cortex PR #154**: Hybrid retrieval (pgvector ANN + PostgreSQL FTS + RRF fusion), tag-driven chunking, context headers, 5-stage write pipeline

## Problem Statement

The cognitive agent's memory module (`packages/pacta/src/cognitive/modules/memory-module.ts`) currently wraps a `MemoryPort` that provides only key-value `store`/`retrieve` and an optional `search` method with no semantic capability. The interface (`packages/pacta/src/ports/memory-port.ts`) defines `MemoryEntry` as a flat `{ key, value, metadata? }` tuple — no epistemic typing, no confidence tracking, no linking between entries, no persistence across task runs.

This means:

1. **No learning across cycles.** Facts discovered in cycle 3 are lost by cycle 6 unless they remain in the workspace (capacity 4-8 entries).
2. **No epistemic discipline.** The agent cannot distinguish ground-truth facts from heuristic patterns from hard rules. EXP-008 showed this causes contamination — observations overwrite constraints.
3. **No cross-task transfer.** Running the same task battery twice produces identical behavior because nothing persists between runs.
4. **No semantic retrieval.** The `search` method (when implemented) does exact-match or substring matching. The agent cannot find relevant knowledge when vocabulary differs from the original storage key.
5. **No workspace compaction.** When workspace entries are evicted by capacity strategies, they are discarded — not compressed into retrievable knowledge.

## Objective

Replace the stub MemoryPort with a RAG-based fact-card memory system that gives the cognitive agent persistent, searchable, epistemically-typed knowledge across task cycles. The memory module should enable the agent to:

1. **Learn from completed tasks** — extract key observations and patterns into durable fact cards
2. **Retrieve relevant facts before acting** — mandatory retrieval gate injects top-K results into workspace each cycle
3. **Maintain epistemic discipline** — facts vs rules vs heuristics are typed separately and governed by different update/override rules
4. **Compress old workspace entries into retrievable knowledge** — evicted workspace entries become fact cards, not data loss

## Phases

### Phase 1 — Fact Card Data Model + MemoryPort v2

Design the fact card schema and upgrade the MemoryPort interface.

**Deliverables:**

- `FactCard` type: `id`, `content`, `type` (`FACT | HEURISTIC | RULE | OBSERVATION`), `source` (task/cycle/module), `tags`, `embedding` (optional `number[]`), `created`, `updated`, `confidence`, `links` (related card ids)
- `MemoryPort` v2: `store(card: FactCard)`, `retrieve(id: string)`, `search(query: string, options?: SearchOptions): FactCard[]`, `link(from: string, to: string)`, `listByType(type)`, `listByTag(tag)`, `expire(id)`, `update(id, partial)`
- `SearchOptions`: `limit`, `type` filter, `tag` filter, `minConfidence`, `recencyBias`
- In-memory implementation for testing (Map-backed, no vector search)
- Types exported from `packages/pacta/src/ports/memory-port.ts`

**Exit criteria:**

- FactCard and MemoryPort v2 types compile
- In-memory implementation passes basic store/retrieve/search tests

### Phase 2 — Memory Module v2 (Cognitive Integration)

Upgrade the cognitive memory module to use MemoryPort v2 with mandatory retrieval.

**Deliverables:**

- `createMemoryModuleV2(memory: MemoryPort, writePort: WorkspaceWritePort)` — new factory
- Mandatory retrieval gate: before each reasoner-actor cycle, the memory module queries for facts relevant to the current workspace state and writes top-K results to workspace
- Fact extraction: after each cycle, extract key learnings from tool results and write them as FactCards (type: `OBSERVATION` or `FACT`)
- Workspace-to-memory compaction: when workspace entries are evicted (via the `onEvict` callback from `strategies.ts`), compress them into FactCards instead of discarding
- Integration with the 5-module cycle in `run.ts`: memory module runs between observer and reasoner-actor

**Exit criteria:**

- Memory module retrieves relevant facts and injects them into workspace each cycle
- Workspace eviction produces FactCards (not data loss)
- Fact extraction creates at least 1 FactCard per write/edit action

### Phase 3 — Epistemic Typing + Confidence Tracking

Add epistemic discipline to the fact card system.

**Deliverables:**

- Type guards: `FACT` (observed ground truth), `HEURISTIC` (learned pattern), `RULE` (hard constraint from task), `OBSERVATION` (raw tool output summary)
- Confidence decay: facts that haven't been accessed decay in confidence over time (or cycles)
- Conflict detection: when storing a new fact, check for contradictions with existing facts of the same tag/type
- Confidence update on retrieval: facts that are retrieved and confirmed get confidence boost; facts retrieved but contradicted get reduced

**Exit criteria:**

- Facts are typed correctly
- Stale facts decay below retrieval threshold
- Contradictory facts are flagged (not silently overwritten)

### Phase 4 — Hybrid Retrieval (Vector + Keyword)

Add semantic search capability beyond exact keyword matching.

**Deliverables:**

- `EmbeddingPort`: `embed(text: string): Promise<number[]>`, `embedBatch(texts: string[]): Promise<number[][]>`, `dimensions: number`
- Voyage AI adapter: `voyage-4-nano` (free, 256-dim) for dev/testing, `voyage-4` ($0.06/MTok, 1,024-dim) for production. Shared embedding space allows mixing models without re-indexing. Mock adapter for unit tests (deterministic vectors).
- Cosine similarity search over FactCard embeddings
- Hybrid scoring: combine keyword match (BM25-like) with vector similarity using RRF fusion (k=60, same as Cortex)
- Tag-based pre-filtering before vector search (same pattern as Cortex's TagRouter)

**Exit criteria:**

- Semantic search finds relevant facts even with different vocabulary
- Hybrid search outperforms keyword-only on retrieval precision
- Embedding cost per task run < $0.01 (embeddings are cached per fact card)

### Phase 5 — Cross-Task Learning + Persistence

Enable the memory to persist across task runs and transfer learning between tasks.

**Deliverables:**

- JSON/JSONL file-based persistence for FactCards (simple, no DB required)
- Load/save lifecycle: memory loads from file at agent init, saves after task completion
- Cross-task fact transfer: facts from Task 01 (e.g., "circular deps need interface extraction") are available when running Task 02
- Markdown export: render all FactCards as a readable markdown document (for human review)
- Optional: pgvector-backed persistence for production use (via pv-silky's DO PostgreSQL)

**Exit criteria:**

- Facts persist across agent restarts
- Task 02 can retrieve facts learned during Task 01
- Memory state is human-reviewable as markdown

## Success Criteria

1. The cognitive agent with memory achieves >= 4/5 pass rate on the EXP-023 task battery (currently 4/5 on baseline without memory)
2. Token cost does not increase by more than 10% (retrieval gate adds context but prevents redundant exploration)
3. On repeated runs of the same task, the agent improves — later runs use fewer cycles than first runs (learning effect)
4. No epistemic contamination: facts of type RULE are never overwritten by OBSERVATION
5. Cross-task transfer: running Task 01 first, then Task 05 (dead code) improves Task 05 pass rate (the agent learns "search for dynamic references" from experience)

## Acceptance Criteria

- **AC-1:** FactCard type system compiles with all 4 epistemic types
- **AC-2:** MemoryPort v2 has store/retrieve/search/link/expire operations
- **AC-3:** Memory module retrieves top-K facts per cycle and injects into workspace
- **AC-4:** Workspace eviction produces FactCards via onEvict callback
- **AC-5:** Epistemic type guards prevent RULE overwrite by OBSERVATION
- **AC-6:** Hybrid search (vector + keyword) returns relevant results with RRF fusion
- **AC-7:** Facts persist to JSONL and reload on init
- **AC-8:** Repeated task runs show learning effect (fewer cycles, higher pass rate)
- **AC-9:** Cross-task fact transfer works (facts from task A available in task B)
- **AC-10:** Token overhead from retrieval < 10% of baseline

## Non-Goals

- Real-time vector database (pgvector is optional Phase 5, not required)
- Multi-agent shared memory (single agent, single memory store)
- Fine-tuning or weight updates (memory is retrieval-based, not parametric)
- Complex knowledge graph traversal (simple links between cards, not full graph queries)

## Dependencies

- PRD 030 (cognitive composition) — must be implemented (it is)
- EXP-023 experiment infrastructure — must exist (it does)
- `@anthropic-ai/sdk` — for LLM calls (already installed)
- Voyage AI API — for embeddings (`voyage-4-nano` free tier for dev, `voyage-4` for production). Cost: ~$0.00012 per task run. T1 Cortex already uses Voyage (PR #154 migration).
