/**
 * InMemoryMemory — Map-backed implementation of MemoryPort v2.
 * For testing and development. No vector search (keyword substring matching only).
 */

import type {
  MemoryPortV2,
  MemoryEntry,
  FactCard,
  EpistemicType,
  SearchOptions,
} from './memory-port.js';

export class InMemoryMemory implements MemoryPortV2 {
  private readonly kvStore = new Map<string, { value: string; metadata?: Record<string, unknown> }>();
  private readonly cards = new Map<string, FactCard>();

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
    this.cards.set(card.id, { ...card });
  }

  async retrieveCard(id: string): Promise<FactCard | null> {
    const card = this.cards.get(id);
    return card ? { ...card } : null;
  }

  async searchCards(query: string, options?: SearchOptions): Promise<FactCard[]> {
    // Split query into words and score by number of matching words
    const queryWords = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);
    if (queryWords.length === 0) return [];

    let scored: Array<{ card: FactCard; score: number }> = [];

    for (const card of this.cards.values()) {
      const text = (card.content + ' ' + card.tags.join(' ')).toLowerCase();
      let matchCount = 0;
      for (const word of queryWords) {
        if (text.includes(word)) matchCount++;
      }
      if (matchCount > 0) {
        scored.push({ card: { ...card }, score: matchCount / queryWords.length });
      }
    }

    // Sort by score descending (most matching words first)
    scored.sort((a, b) => b.score - a.score);
    let results = scored.map(s => s.card);

    // Apply filters from SearchOptions
    if (options?.type) {
      results = results.filter((c) => c.type === options.type);
    }
    if (options?.tags && options.tags.length > 0) {
      const filterTags = new Set(options.tags.map((t) => t.toLowerCase()));
      results = results.filter((c) =>
        c.tags.some((t) => filterTags.has(t.toLowerCase())),
      );
    }
    if (options?.minConfidence !== undefined) {
      results = results.filter((c) => c.confidence >= options.minConfidence!);
    }

    // Sort by confidence descending (recencyBias ignored in keyword-only mode)
    results.sort((a, b) => b.confidence - a.confidence);

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
