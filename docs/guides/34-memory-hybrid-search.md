---
guide: 34
title: "Memory: Hybrid Search & Persistence"
domain: pacta
audience: [agent-operators, contributors]
summary: >-
  BM25 keyword search, hybrid mode with embeddings and RRF fusion, JSONL persistence.
prereqs: [26]
touches:
  - packages/pacta/src/ports/memory-impl.ts
  - packages/pacta/src/ports/memory-persistence.ts
  - packages/pacta/src/ports/memory-port.ts
---

# Guide 34 — Memory: Hybrid Search & Persistence

The memory subsystem (PRD 031) stores typed FactCards and supports two search modes: BM25 keyword scoring (default) and hybrid keyword + embedding search with Reciprocal Rank Fusion. A companion JSONL persistence layer handles file-backed storage and Markdown export.

## FactCards

A `FactCard` is a typed memory entry with epistemic classification:

```typescript
interface FactCard {
  id: string;
  content: string;
  type: EpistemicType;       // 'FACT' | 'HEURISTIC' | 'RULE' | 'OBSERVATION' | 'PROCEDURE'
  source: { task?: string; cycle?: number; module?: string };
  tags: string[];
  embedding?: number[];      // populated automatically in hybrid mode
  created: number;
  updated: number;
  confidence: number;        // 0-1
  links: string[];           // related card IDs
}
```

## InMemoryMemory

The `InMemoryMemory` class implements `MemoryPortV2`. It works out of the box with keyword-only search and upgrades to hybrid search when an `EmbeddingPort` is provided.

### Keyword-Only Mode (Default)

```typescript
import { InMemoryMemory } from '@method/pacta/ports/memory-impl.js';

const memory = new InMemoryMemory();

await memory.storeCard({
  id: 'card-1',
  content: 'The payment service retries on 503 errors',
  type: 'FACT',
  source: { task: 'investigate-payments' },
  tags: ['payments', 'retry'],
  created: Date.now(),
  updated: Date.now(),
  confidence: 0.9,
  links: [],
});

const results = await memory.searchCards('payment retry', {
  limit: 5,
  minConfidence: 0.5,
});
```

Keyword search uses BM25 scoring with stop-word removal, term frequency weighting, IDF computation, and document length normalization (k1=1.2, b=0.75).

### Hybrid Mode (Keyword + Embeddings)

Pass an `EmbeddingPort` to enable semantic search alongside BM25:

```typescript
import { InMemoryMemory } from '@method/pacta/ports/memory-impl.js';
import type { EmbeddingPort } from '@method/pacta/ports/embedding-port.js';

const embeddingPort: EmbeddingPort = {
  embed: async (text: string) => { /* return number[] */ },
};

const memory = new InMemoryMemory({ embeddingPort });
```

When hybrid mode is active:

1. **Auto-embedding** — `storeCard()` automatically embeds card content if no embedding is provided
2. **Dual ranking** — `searchCards()` scores candidates via both BM25 and cosine similarity
3. **RRF fusion** — the two ranked lists are fused using Reciprocal Rank Fusion (k=60, Cormack et al. 2009)

This means keyword-exact matches and semantically similar content both surface in results, with RRF balancing the two signals.

### Search Options

```typescript
interface SearchOptions {
  limit?: number;           // max results
  type?: EpistemicType;     // filter by epistemic type
  tags?: string[];          // filter by tags (OR match)
  minConfidence?: number;   // minimum confidence threshold
  recencyBias?: number;     // 0-1, blend relevance with recency (0 = pure relevance)
}
```

The `recencyBias` parameter blends relevance ranking with recency. At 0, results are purely relevance-ordered. At 1, the most recent cards dominate.

### Other Operations

```typescript
await memory.updateCard('card-1', { confidence: 0.95, tags: ['payments', 'retry', 'verified'] });
await memory.linkCards('card-1', 'card-2');           // bidirectional link
await memory.listByType('FACT');                      // all facts, sorted by confidence
await memory.listByTag('payments');                   // all cards with tag
await memory.expireCard('card-1');                    // remove
const all = await memory.allCards();                  // dump everything
```

## JSONL Persistence

The `JsonlMemoryStore` class provides file-backed persistence for FactCards using newline-delimited JSON.

```typescript
import { JsonlMemoryStore } from '@method/pacta/ports/memory-persistence.js';

const store = new JsonlMemoryStore('/path/to/memory.jsonl');
```

### Operations

```typescript
// Load all cards (returns [] if file doesn't exist, skips corrupt lines)
const cards = await store.load();

// Save all cards (full rewrite)
await store.save(cards);

// Append a single card (creates file if needed)
await store.append(newCard);

// Export as human-readable Markdown
const markdown = store.exportMarkdown(cards);
```

### JSONL Format

Each line is a single JSON-serialized FactCard. Corrupt lines are skipped with a warning to stderr. The format is append-friendly -- new cards can be added without rewriting the entire file.

### Markdown Export

`exportMarkdown()` groups cards by epistemic type (FACT, RULE, PROCEDURE, HEURISTIC, OBSERVATION), sorts by confidence within each group, and renders confidence bars:

```
## Facts

- [*****] **The payment service retries on 503 errors**
  _confidence: 0.90 (very high) | created: 2026-03-15 — tags: payments, retry_
```

## Memory Viewer (Frontend)

The bridge dashboard includes a Memory Viewer modal (PRD 033) at `packages/bridge/frontend/src/domains/sessions/MemoryViewer.tsx`. It displays FactCards grouped by epistemic type with search/filter, confidence bars, tag pills, and per-card metadata (source module, cycle, timestamp).

## Key Files

- `packages/pacta/src/ports/memory-impl.ts` — InMemoryMemory with BM25 and hybrid search
- `packages/pacta/src/ports/memory-persistence.ts` — JsonlMemoryStore (JSONL + Markdown export)
- `packages/pacta/src/ports/memory-port.ts` — MemoryPortV2 interface and FactCard type
- `packages/pacta/src/ports/embedding-port.ts` — EmbeddingPort interface
- `packages/bridge/frontend/src/domains/sessions/MemoryViewer.tsx` — Memory Viewer modal
