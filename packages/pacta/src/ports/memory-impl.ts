// SPDX-License-Identifier: Apache-2.0
/**
 * InMemoryMemory — Map-backed implementation of MemoryPort v2.
 *
 * Supports two search modes:
 *   1. Keyword-only (default): BM25-like term frequency scoring
 *   2. Hybrid (when EmbeddingPort provided): RRF fusion of keyword + cosine similarity
 *
 * Backward compatible — embedding port is optional.
 */

import type {
  MemoryPortV2,
  MemoryEntry,
  FactCard,
  EpistemicType,
  SearchOptions,
} from './memory-port.js';
import type { EmbeddingPort } from './embedding-port.js';

// ── BM25 scoring helpers ──────────────────────────────────────────

/** Stop words to exclude from BM25 tokenization. */
const STOP_WORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'shall', 'can', 'need', 'dare', 'ought',
  'and', 'but', 'or', 'nor', 'not', 'so', 'yet', 'both', 'either',
  'neither', 'each', 'every', 'all', 'any', 'few', 'more', 'most',
  'other', 'some', 'such', 'no', 'only', 'same', 'than', 'too', 'very',
  'just', 'because', 'as', 'until', 'while', 'of', 'at', 'by', 'for',
  'with', 'about', 'against', 'between', 'through', 'during', 'before',
  'after', 'above', 'below', 'to', 'from', 'up', 'down', 'in', 'out',
  'on', 'off', 'over', 'under', 'again', 'further', 'then', 'once',
  'this', 'that', 'these', 'those', 'it', 'its',
]);

/** Tokenize text into lowercased terms, filtering stop words and short tokens. */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(w => w.length > 1 && !STOP_WORDS.has(w));
}

/** Count term frequencies in a token list. */
function termFrequencies(tokens: string[]): Map<string, number> {
  const tf = new Map<string, number>();
  for (const t of tokens) {
    tf.set(t, (tf.get(t) ?? 0) + 1);
  }
  return tf;
}

/**
 * BM25 score for a single document against a query.
 *
 * @param queryTerms  Unique query terms
 * @param docTf       Term frequency map for the document
 * @param docLength   Number of tokens in the document
 * @param avgDl       Average document length across corpus
 * @param idfMap      IDF values for query terms (pre-computed over corpus)
 * @param k1          Term saturation parameter (default 1.2)
 * @param b           Length normalization parameter (default 0.75)
 */
function bm25Score(
  queryTerms: string[],
  docTf: Map<string, number>,
  docLength: number,
  avgDl: number,
  idfMap: Map<string, number>,
  k1 = 1.2,
  b = 0.75,
): number {
  let score = 0;
  for (const term of queryTerms) {
    const tf = docTf.get(term) ?? 0;
    if (tf === 0) continue;
    const idf = idfMap.get(term) ?? 0;
    const numerator = tf * (k1 + 1);
    const denominator = tf + k1 * (1 - b + b * (docLength / (avgDl || 1)));
    score += idf * (numerator / denominator);
  }
  return score;
}

// ── Cosine similarity ─────────────────────────────────────────────

/** Compute cosine similarity between two vectors. */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

// ── RRF (Reciprocal Rank Fusion) ─────────────────────────────────

/**
 * Fuse multiple ranked lists using Reciprocal Rank Fusion.
 *
 * RRF score = sum(1 / (k + rank_i)) across all ranking sources.
 * k = 60 is the standard constant from Cormack et al. (2009).
 */
export function reciprocalRankFusion<T>(
  rankedLists: Array<Array<{ item: T; id: string }>>,
  k = 60,
): Array<{ item: T; id: string; score: number }> {
  const scores = new Map<string, { item: T; score: number }>();

  for (const list of rankedLists) {
    for (let rank = 0; rank < list.length; rank++) {
      const entry = list[rank];
      const existing = scores.get(entry.id);
      const rrfContribution = 1 / (k + rank + 1); // rank is 0-based, +1 for 1-based
      if (existing) {
        existing.score += rrfContribution;
      } else {
        scores.set(entry.id, { item: entry.item, score: rrfContribution });
      }
    }
  }

  return [...scores.entries()]
    .map(([id, { item, score }]) => ({ item, id, score }))
    .sort((a, b) => b.score - a.score);
}

// ── InMemoryMemory ────────────────────────────────────────────────

export interface InMemoryMemoryOptions {
  /** Optional embedding port for hybrid (keyword + semantic) search. */
  embeddingPort?: EmbeddingPort;
}

export class InMemoryMemory implements MemoryPortV2 {
  private readonly kvStore = new Map<string, { value: string; metadata?: Record<string, unknown> }>();
  private readonly cards = new Map<string, FactCard>();
  private readonly embeddingPort?: EmbeddingPort;

  constructor(options?: InMemoryMemoryOptions) {
    this.embeddingPort = options?.embeddingPort;
  }

  // ── Legacy methods ───────────────────────────────────────────────

  async store(key: string, value: string, metadata?: Record<string, unknown>): Promise<void> {
    this.kvStore.set(key, { value, metadata });
  }

  async retrieve(key: string): Promise<string | null> {
    const entry = this.kvStore.get(key);
    return entry ? entry.value : null;
  }

  async search(query: string, limit?: number): Promise<MemoryEntry[]> {
    const results: MemoryEntry[] = [];
    const q = query.toLowerCase();
    for (const [key, { value, metadata }] of this.kvStore) {
      if (key.toLowerCase().includes(q) || value.toLowerCase().includes(q)) {
        results.push({ key, value, metadata });
      }
    }
    return limit !== undefined ? results.slice(0, limit) : results;
  }

  // ── FactCard methods (PRD 031) ───────────────────────────────────

  async storeCard(card: FactCard): Promise<void> {
    // Auto-embed if embedding port is available and card has no embedding
    if (this.embeddingPort && !card.embedding) {
      const embedding = await this.embeddingPort.embed(card.content);
      this.cards.set(card.id, { ...card, embedding });
    } else {
      this.cards.set(card.id, { ...card });
    }
  }

  async retrieveCard(id: string): Promise<FactCard | null> {
    const card = this.cards.get(id);
    return card ? { ...card } : null;
  }

  async searchCards(query: string, options?: SearchOptions): Promise<FactCard[]> {
    const queryTokens = tokenize(query);
    if (queryTokens.length === 0) return [];

    // Get candidate cards (pre-filter by type/tags/confidence for efficiency)
    let candidates = [...this.cards.values()];
    if (options?.type) {
      candidates = candidates.filter(c => c.type === options.type);
    }
    if (options?.tags && options.tags.length > 0) {
      const filterTags = new Set(options.tags.map(t => t.toLowerCase()));
      candidates = candidates.filter(c =>
        c.tags.some(t => filterTags.has(t.toLowerCase())),
      );
    }
    if (options?.minConfidence !== undefined) {
      candidates = candidates.filter(c => c.confidence >= options.minConfidence!);
    }

    if (candidates.length === 0) return [];

    // ── BM25 keyword scoring ──────────────────────────────────────

    // Build corpus stats for BM25
    const uniqueQueryTerms = [...new Set(queryTokens)];
    const docData: Array<{ card: FactCard; tokens: string[]; tf: Map<string, number> }> = [];

    for (const card of candidates) {
      const text = card.content + ' ' + card.tags.join(' ');
      const tokens = tokenize(text);
      docData.push({ card, tokens, tf: termFrequencies(tokens) });
    }

    const avgDl = docData.reduce((s, d) => s + d.tokens.length, 0) / (docData.length || 1);

    // Compute IDF: idf(t) = ln((N - n(t) + 0.5) / (n(t) + 0.5) + 1)
    const idfMap = new Map<string, number>();
    const N = docData.length;
    for (const term of uniqueQueryTerms) {
      const docsWithTerm = docData.filter(d => d.tf.has(term)).length;
      const idf = Math.log((N - docsWithTerm + 0.5) / (docsWithTerm + 0.5) + 1);
      idfMap.set(term, idf);
    }

    // Score each document
    const keywordRanked: Array<{ item: FactCard; id: string }> = docData
      .map(d => ({
        item: d.card,
        id: d.card.id,
        score: bm25Score(uniqueQueryTerms, d.tf, d.tokens.length, avgDl, idfMap),
      }))
      .filter(d => d.score > 0)
      .sort((a, b) => b.score - a.score)
      .map(d => ({ item: d.item, id: d.id }));

    // ── Hybrid mode: add embedding similarity if available ─────────

    if (this.embeddingPort) {
      const queryEmbedding = await this.embeddingPort.embed(query);

      // Score candidates by cosine similarity to query embedding
      const embeddingRanked: Array<{ item: FactCard; id: string }> = candidates
        .filter(c => c.embedding && c.embedding.length > 0)
        .map(c => ({
          item: c,
          id: c.id,
          score: cosineSimilarity(queryEmbedding, c.embedding!),
        }))
        .sort((a, b) => b.score - a.score)
        .map(d => ({ item: d.item, id: d.id }));

      // Fuse with RRF
      const fused = reciprocalRankFusion([keywordRanked, embeddingRanked]);
      let results = fused.map(f => ({ ...f.item }));

      // Apply recency bias if requested
      if (options?.recencyBias !== undefined && options.recencyBias > 0) {
        const now = Date.now();
        const maxAge = Math.max(...results.map(c => now - c.updated), 1);
        results.sort((a, b) => {
          const recencyA = 1 - (now - a.updated) / maxAge;
          const recencyB = 1 - (now - b.updated) / maxAge;
          const bias = options.recencyBias!;
          // Blend: preserve RRF order (index-based relevance) with recency
          const idxA = results.indexOf(a);
          const idxB = results.indexOf(b);
          const relevanceA = 1 - idxA / (results.length || 1);
          const relevanceB = 1 - idxB / (results.length || 1);
          const scoreA = (1 - bias) * relevanceA + bias * recencyA;
          const scoreB = (1 - bias) * relevanceB + bias * recencyB;
          return scoreB - scoreA;
        });
      }

      if (options?.limit !== undefined) {
        results = results.slice(0, options.limit);
      }
      return results;
    }

    // ── Keyword-only mode ─────────────────────────────────────────

    let results = keywordRanked.map(r => ({ ...r.item }));

    // Apply recency bias blended with BM25 relevance
    if (options?.recencyBias !== undefined && options.recencyBias > 0) {
      const now = Date.now();
      const maxAge = Math.max(...results.map(c => now - c.updated), 1);
      results.sort((a, b) => {
        const recencyA = 1 - (now - a.updated) / maxAge;
        const recencyB = 1 - (now - b.updated) / maxAge;
        const bias = options.recencyBias!;
        const idxA = results.indexOf(a);
        const idxB = results.indexOf(b);
        const relevanceA = 1 - idxA / (results.length || 1);
        const relevanceB = 1 - idxB / (results.length || 1);
        const scoreA = (1 - bias) * relevanceA + bias * recencyA;
        const scoreB = (1 - bias) * relevanceB + bias * recencyB;
        return scoreB - scoreA;
      });
    }

    if (options?.limit !== undefined) {
      results = results.slice(0, options.limit);
    }

    return results;
  }

  async updateCard(
    id: string,
    updates: Partial<Pick<FactCard, 'content' | 'confidence' | 'tags' | 'links' | 'embedding'>>,
  ): Promise<void> {
    const card = this.cards.get(id);
    if (!card) return;

    if (updates.content !== undefined) card.content = updates.content;
    if (updates.confidence !== undefined) card.confidence = updates.confidence;
    if (updates.tags !== undefined) card.tags = updates.tags;
    if (updates.links !== undefined) card.links = updates.links;
    if (updates.embedding !== undefined) card.embedding = updates.embedding;

    card.updated = Date.now();
  }

  async linkCards(fromId: string, toId: string): Promise<void> {
    const from = this.cards.get(fromId);
    const to = this.cards.get(toId);

    if (from && !from.links.includes(toId)) {
      from.links.push(toId);
      from.updated = Date.now();
    }
    if (to && !to.links.includes(fromId)) {
      to.links.push(fromId);
      to.updated = Date.now();
    }
  }

  async listByType(type: EpistemicType): Promise<FactCard[]> {
    const results: FactCard[] = [];
    for (const card of this.cards.values()) {
      if (card.type === type) {
        results.push({ ...card });
      }
    }
    return results.sort((a, b) => b.confidence - a.confidence);
  }

  async listByTag(tag: string): Promise<FactCard[]> {
    const t = tag.toLowerCase();
    const results: FactCard[] = [];
    for (const card of this.cards.values()) {
      if (card.tags.some((ct) => ct.toLowerCase() === t)) {
        results.push({ ...card });
      }
    }
    return results.sort((a, b) => b.confidence - a.confidence);
  }

  async expireCard(id: string): Promise<void> {
    this.cards.delete(id);
  }

  async allCards(): Promise<FactCard[]> {
    const results = [...this.cards.values()].map((c) => ({ ...c }));
    return results.sort((a, b) => b.confidence - a.confidence);
  }
}
