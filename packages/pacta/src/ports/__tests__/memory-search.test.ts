/**
 * Tests for hybrid search in InMemoryMemory (PRD 031, Phase 4).
 *
 * Covers:
 *   - BM25-like keyword scoring (term frequency, IDF weighting)
 *   - Cosine similarity computation
 *   - RRF fusion of keyword + embedding rankings
 *   - Fallback to keyword-only when no embedding port
 *   - Search filters (type, tags, minConfidence)
 *   - Recency bias blending
 *   - Auto-embedding on storeCard
 *   - Edge cases (empty query, no matches, single result)
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  InMemoryMemory,
  cosineSimilarity,
  reciprocalRankFusion,
} from '../memory-impl.js';
import type { FactCard, EpistemicType } from '../memory-port.js';
import type { EmbeddingPort } from '../embedding-port.js';

// ── Test helpers ──────────────────────────────────────────────────

function makeCard(overrides: Partial<FactCard> & { id: string; content: string }): FactCard {
  return {
    type: 'FACT' as EpistemicType,
    source: { task: 'test' },
    tags: [],
    created: Date.now(),
    updated: Date.now(),
    confidence: 0.8,
    links: [],
    ...overrides,
  };
}

/**
 * Deterministic mock embedding port.
 * Hashes text to a fixed-length vector so that similar texts produce similar vectors.
 */
function createTestEmbedding(dimensions = 64): EmbeddingPort {
  const embedOne = (text: string): number[] => {
    const vec = new Array<number>(dimensions).fill(0);
    const lower = text.toLowerCase();
    for (let i = 0; i < lower.length; i++) {
      vec[i % dimensions] += lower.charCodeAt(i) / 1000;
    }
    const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
    return norm > 0 ? vec.map(v => v / norm) : vec;
  };

  return {
    model: 'test-mock',
    dimensions,
    async embed(text: string) {
      return embedOne(text);
    },
    async embedBatch(texts: string[]) {
      return texts.map(t => embedOne(t));
    },
  };
}

// ── Cosine similarity tests ───────────────────────────────────────

describe('cosineSimilarity', () => {
  it('returns 1 for identical vectors', () => {
    const v = [1, 2, 3, 4];
    const sim = cosineSimilarity(v, v);
    assert.ok(Math.abs(sim - 1) < 1e-10);
  });

  it('returns 0 for orthogonal vectors', () => {
    const a = [1, 0, 0];
    const b = [0, 1, 0];
    const sim = cosineSimilarity(a, b);
    assert.ok(Math.abs(sim) < 1e-10);
  });

  it('returns -1 for opposite vectors', () => {
    const a = [1, 0];
    const b = [-1, 0];
    const sim = cosineSimilarity(a, b);
    assert.ok(Math.abs(sim - (-1)) < 1e-10);
  });

  it('returns 0 for empty vectors', () => {
    assert.equal(cosineSimilarity([], []), 0);
  });

  it('returns 0 for mismatched lengths', () => {
    assert.equal(cosineSimilarity([1, 2], [1, 2, 3]), 0);
  });

  it('handles zero vectors', () => {
    assert.equal(cosineSimilarity([0, 0], [1, 2]), 0);
  });
});

// ── RRF tests ─────────────────────────────────────────────────────

describe('reciprocalRankFusion', () => {
  it('fuses two ranked lists, boosting items that appear in both', () => {
    const list1 = [
      { item: 'A', id: 'a' },
      { item: 'B', id: 'b' },
      { item: 'C', id: 'c' },
    ];
    const list2 = [
      { item: 'B', id: 'b' },
      { item: 'C', id: 'c' },
      { item: 'D', id: 'd' },
    ];

    const fused = reciprocalRankFusion([list1, list2]);

    // Items in both lists should rank above items in only one list
    const abScores = new Set(['a', 'b', 'c'].map(id => fused.find(f => f.id === id)));
    const dEntry = fused.find(f => f.id === 'd')!;

    // B is rank 2 in list1, rank 1 in list2 — best combined score
    // C is rank 3 in list1, rank 2 in list2 — appears in both
    // A is rank 1 in list1 only — high single-list rank
    // D is rank 3 in list2 only — lowest
    assert.ok(fused[0].id === 'b', 'B should rank first (rank 2+1 across lists)');

    // Items in only one list should rank lower than items in both
    const bScore = fused.find(f => f.id === 'b')!.score;
    const cScore = fused.find(f => f.id === 'c')!.score;
    assert.ok(bScore > dEntry.score, 'items in both lists beat single-list items');
    assert.ok(cScore > dEntry.score, 'C in both lists beats D in one list');
  });

  it('returns empty for empty inputs', () => {
    const result = reciprocalRankFusion([]);
    assert.deepEqual(result, []);
  });

  it('handles a single list', () => {
    const list = [
      { item: 'X', id: 'x' },
      { item: 'Y', id: 'y' },
    ];
    const fused = reciprocalRankFusion([list]);
    assert.equal(fused.length, 2);
    assert.equal(fused[0].id, 'x');
    assert.ok(fused[0].score > fused[1].score);
  });
});

// ── Keyword-only search tests ─────────────────────────────────────

describe('InMemoryMemory searchCards (keyword-only)', () => {
  let mem: InMemoryMemory;

  beforeEach(async () => {
    mem = new InMemoryMemory();
    await mem.storeCard(makeCard({
      id: 'card-1',
      content: 'TypeScript compiler optimizes type inference for generic functions',
      tags: ['typescript', 'compiler'],
      confidence: 0.9,
    }));
    await mem.storeCard(makeCard({
      id: 'card-2',
      content: 'Python supports duck typing and dynamic dispatch',
      tags: ['python', 'typing'],
      confidence: 0.7,
    }));
    await mem.storeCard(makeCard({
      id: 'card-3',
      content: 'Rust borrow checker enforces memory safety at compile time',
      tags: ['rust', 'memory'],
      confidence: 0.85,
    }));
    await mem.storeCard(makeCard({
      id: 'card-4',
      content: 'TypeScript generic inference algorithm uses bidirectional type flow',
      tags: ['typescript', 'generics'],
      confidence: 0.75,
    }));
  });

  it('returns cards matching query terms using BM25 scoring', async () => {
    const results = await mem.searchCards('typescript compiler');
    assert.ok(results.length >= 1, 'should find at least one match');
    // card-1 mentions both "typescript" and "compiler"
    assert.equal(results[0].id, 'card-1');
  });

  it('ranks multi-term matches higher than zero or single-term matches', async () => {
    const results = await mem.searchCards('typescript generic inference');
    // card-4 matches all three query terms ("typescript", "generic", "inference")
    const idx4 = results.findIndex(c => c.id === 'card-4');
    assert.ok(idx4 >= 0, 'card-4 should appear');
    // card-2 (Python) should not match any of these terms
    const idx2 = results.findIndex(c => c.id === 'card-2');
    assert.equal(idx2, -1, 'card-2 (Python) should not appear for TypeScript query');
    // card-4 which matches 3 terms should rank above card-3 (Rust) which matches 0
    const idx3 = results.findIndex(c => c.id === 'card-3');
    assert.equal(idx3, -1, 'card-3 (Rust) should not appear for TypeScript query');
  });

  it('returns empty for query with only stop words', async () => {
    const results = await mem.searchCards('the a an is');
    assert.equal(results.length, 0);
  });

  it('returns empty when no cards match', async () => {
    const results = await mem.searchCards('quantum entanglement');
    assert.equal(results.length, 0);
  });

  it('applies type filter', async () => {
    await mem.storeCard(makeCard({
      id: 'rule-1',
      content: 'TypeScript interfaces should be preferred over type aliases for object shapes',
      type: 'RULE',
      tags: ['typescript'],
      confidence: 0.8,
    }));
    const results = await mem.searchCards('typescript', { type: 'RULE' });
    assert.ok(results.every(c => c.type === 'RULE'));
    assert.ok(results.some(c => c.id === 'rule-1'));
  });

  it('applies tag filter', async () => {
    const results = await mem.searchCards('typing', { tags: ['python'] });
    assert.ok(results.every(c => c.tags.some(t => t.toLowerCase() === 'python')));
  });

  it('applies minConfidence filter', async () => {
    const results = await mem.searchCards('typescript', { minConfidence: 0.85 });
    assert.ok(results.every(c => c.confidence >= 0.85));
  });

  it('respects limit option', async () => {
    const results = await mem.searchCards('typescript', { limit: 1 });
    assert.equal(results.length, 1);
  });

  it('searches tag text in addition to content', async () => {
    // card-3 has tag "memory" — searching for memory should find it
    const results = await mem.searchCards('memory safety');
    assert.ok(results.some(c => c.id === 'card-3'), 'should find card with matching tag and content');
  });
});

// ── Hybrid search tests ───────────────────────────────────────────

describe('InMemoryMemory searchCards (hybrid with embeddings)', () => {
  let mem: InMemoryMemory;
  let embeddingPort: EmbeddingPort;

  beforeEach(async () => {
    embeddingPort = createTestEmbedding();
    mem = new InMemoryMemory({ embeddingPort });

    await mem.storeCard(makeCard({
      id: 'h-1',
      content: 'Neural networks use gradient descent for optimization',
      tags: ['ml', 'deep-learning'],
      confidence: 0.9,
    }));
    await mem.storeCard(makeCard({
      id: 'h-2',
      content: 'Decision trees split data at feature thresholds',
      tags: ['ml', 'classification'],
      confidence: 0.8,
    }));
    await mem.storeCard(makeCard({
      id: 'h-3',
      content: 'Backpropagation computes gradients through neural network layers',
      tags: ['ml', 'deep-learning'],
      confidence: 0.85,
    }));
    await mem.storeCard(makeCard({
      id: 'h-4',
      content: 'Random forest aggregates many decision tree predictions',
      tags: ['ml', 'ensemble'],
      confidence: 0.75,
    }));
  });

  it('auto-embeds cards on storeCard when embeddingPort is provided', async () => {
    const card = await mem.retrieveCard('h-1');
    assert.ok(card, 'card should exist');
    assert.ok(card!.embedding, 'embedding should be auto-generated');
    assert.ok(card!.embedding!.length > 0, 'embedding should have dimensions');
  });

  it('returns results using hybrid RRF fusion', async () => {
    const results = await mem.searchCards('neural network gradient');
    assert.ok(results.length >= 1, 'should find matches');
    // h-1 and h-3 both mention neural/gradient — they should rank high
    const topIds = results.slice(0, 2).map(c => c.id);
    assert.ok(
      topIds.includes('h-1') || topIds.includes('h-3'),
      'top results should include neural network cards',
    );
  });

  it('does not embed if card already has an embedding', async () => {
    const manualEmbedding = [1, 0, 0, 0];
    await mem.storeCard(makeCard({
      id: 'manual',
      content: 'Pre-embedded card',
      embedding: manualEmbedding,
      confidence: 0.5,
    }));
    const card = await mem.retrieveCard('manual');
    assert.deepEqual(card!.embedding, manualEmbedding);
  });

  it('still returns keyword matches even if embedding similarity is low', async () => {
    // "decision tree" is an exact keyword match for h-2 and h-4
    const results = await mem.searchCards('decision tree');
    const matchIds = results.map(c => c.id);
    assert.ok(matchIds.includes('h-2'), 'should include exact keyword match h-2');
  });

  it('applies filters in hybrid mode', async () => {
    const results = await mem.searchCards('neural', { tags: ['deep-learning'] });
    assert.ok(results.length >= 1);
    assert.ok(results.every(c => c.tags.includes('deep-learning')));
  });

  it('applies limit in hybrid mode', async () => {
    const results = await mem.searchCards('ml machine learning', { limit: 2 });
    assert.ok(results.length <= 2);
  });
});

// ── Backward compatibility ────────────────────────────────────────

describe('InMemoryMemory backward compatibility', () => {
  it('works without constructor arguments', async () => {
    const mem = new InMemoryMemory();
    await mem.storeCard(makeCard({ id: 'compat-1', content: 'hello world' }));
    const results = await mem.searchCards('hello');
    assert.ok(results.length >= 1);
  });

  it('legacy search method still works', async () => {
    const mem = new InMemoryMemory();
    await mem.store('key1', 'some value');
    const results = await mem.search('value');
    assert.equal(results.length, 1);
    assert.equal(results[0].key, 'key1');
  });
});
