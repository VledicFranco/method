/**
 * Hybrid Search — combines keyword matching with vector similarity using RRF fusion.
 * Inspired by T1 Cortex's hybrid retrieval (PR #154).
 */
import type { FactCard } from '../ports/memory-port.js';

/** Cosine similarity between two vectors. */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0,
    normA = 0,
    normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom > 0 ? dot / denom : 0;
}

/** Simple keyword score: fraction of query words found in text. */
export function keywordScore(query: string, text: string): number {
  const queryWords = query
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 2);
  if (queryWords.length === 0) return 0;
  const textLower = text.toLowerCase();
  const matches = queryWords.filter((w) => textLower.includes(w));
  return matches.length / queryWords.length;
}

/** RRF fusion score from two rank positions. k=60 is standard. */
export function rrfScore(
  rank1: number,
  rank2: number,
  k: number = 60,
): number {
  return 1 / (k + rank1) + 1 / (k + rank2);
}

export interface HybridSearchOptions {
  limit?: number;
  queryEmbedding?: number[]; // pre-computed query embedding
  minScore?: number; // minimum RRF score threshold
}

/**
 * Perform hybrid search over FactCards.
 * Combines keyword matching with vector similarity (when embeddings exist).
 * Returns cards sorted by RRF-fused score.
 */
export function hybridSearch(
  cards: FactCard[],
  query: string,
  options: HybridSearchOptions = {},
): Array<FactCard & { score: number }> {
  const { limit = 5, queryEmbedding, minScore = 0 } = options;

  // Keyword ranking
  const keywordRanked = cards
    .map((c) => ({
      card: c,
      score: keywordScore(query, c.content + ' ' + c.tags.join(' ')),
    }))
    .sort((a, b) => b.score - a.score);

  // Vector ranking (if embeddings available)
  const vectorRanked = queryEmbedding
    ? cards
        .filter((c) => c.embedding && c.embedding.length > 0)
        .map((c) => ({
          card: c,
          score: cosineSimilarity(queryEmbedding, c.embedding!),
        }))
        .sort((a, b) => b.score - a.score)
    : [];

  // Build rank maps
  const keywordRankMap = new Map<string, number>();
  keywordRanked.forEach((item, i) => keywordRankMap.set(item.card.id, i + 1));

  const vectorRankMap = new Map<string, number>();
  vectorRanked.forEach((item, i) => vectorRankMap.set(item.card.id, i + 1));

  // Fuse with RRF
  const allIds = new Set([
    ...keywordRankMap.keys(),
    ...vectorRankMap.keys(),
  ]);
  const fused: Array<{ card: FactCard; score: number }> = [];

  for (const id of allIds) {
    const card = cards.find((c) => c.id === id)!;
    const kwRank = keywordRankMap.get(id) ?? cards.length;
    const vecRank = vectorRankMap.get(id) ?? cards.length;
    const score = rrfScore(kwRank, vecRank);
    if (score >= minScore) {
      fused.push({ card, score });
    }
  }

  // Sort by fused score descending, apply limit
  fused.sort((a, b) => b.score - a.score);
  return fused.slice(0, limit).map((f) => ({ ...f.card, score: f.score }));
}
