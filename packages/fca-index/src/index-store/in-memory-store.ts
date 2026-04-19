// SPDX-License-Identifier: Apache-2.0
/**
 * InMemoryIndexStore — in-process, ephemeral implementation of IndexStorePort.
 *
 * Intended for testing and development. Not for production use.
 * Acts as a test double for SqliteLanceIndexStore.
 */

import type {
  IndexStorePort,
  IndexEntry,
  IndexQueryFilters,
  IndexCoverageStats,
} from '../ports/internal/index-store.js';
import type { FcaPart } from '../ports/context-query.js';

const ALL_PARTS: FcaPart[] = [
  'interface',
  'boundary',
  'port',
  'domain',
  'architecture',
  'verification',
  'observability',
  'documentation',
];

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom === 0) return 0;
  return dot / denom;
}

function applyFilters(entries: IndexEntry[], filters: IndexQueryFilters): IndexEntry[] {
  return entries.filter((entry) => {
    if (entry.projectRoot !== filters.projectRoot) return false;
    if (filters.levels && filters.levels.length > 0) {
      if (!filters.levels.includes(entry.level)) return false;
    }
    if (filters.parts && filters.parts.length > 0) {
      const entryPartNames = new Set(entry.parts.map((p) => p.part));
      const hasAny = filters.parts.some((p) => entryPartNames.has(p));
      if (!hasAny) return false;
    }
    if (filters.minCoverageScore !== undefined) {
      if (entry.coverageScore < filters.minCoverageScore) return false;
    }
    return true;
  });
}

export class InMemoryIndexStore implements IndexStorePort {
  private entries: Map<string, IndexEntry> = new Map();

  async upsertComponent(entry: IndexEntry): Promise<void> {
    this.entries.set(entry.id, { ...entry });
  }

  async queryBySimilarity(
    queryEmbedding: number[],
    topK: number,
    filters: IndexQueryFilters,
  ): Promise<IndexEntry[]> {
    const filtered = applyFilters(Array.from(this.entries.values()), filters);
    const scored = filtered.map((entry) => ({
      entry,
      score: cosineSimilarity(queryEmbedding, entry.embedding),
    }));
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK).map((s) => s.entry);
  }

  async queryByFilters(filters: IndexQueryFilters): Promise<IndexEntry[]> {
    const filtered = applyFilters(Array.from(this.entries.values()), filters);
    filtered.sort((a, b) => b.coverageScore - a.coverageScore);
    return filtered;
  }

  async getCoverageStats(projectRoot: string): Promise<IndexCoverageStats> {
    const entries = Array.from(this.entries.values()).filter(
      (e) => e.projectRoot === projectRoot,
    );
    const totalComponents = entries.length;
    const weightedAverage =
      totalComponents === 0
        ? 0
        : entries.reduce((sum, e) => sum + e.coverageScore, 0) / totalComponents;

    const byPart = {} as Record<FcaPart, number>;
    for (const part of ALL_PARTS) {
      const count = entries.filter((e) => e.parts.some((p) => p.part === part)).length;
      byPart[part] = totalComponents === 0 ? 0 : count / totalComponents;
    }

    return { totalComponents, weightedAverage, byPart };
  }

  async clear(projectRoot: string): Promise<void> {
    for (const [id, entry] of this.entries) {
      if (entry.projectRoot === projectRoot) {
        this.entries.delete(id);
      }
    }
  }

  async getByPath(path: string, projectRoot: string): Promise<IndexEntry | null> {
    for (const entry of this.entries.values()) {
      if (entry.projectRoot === projectRoot && entry.path === path) {
        return { ...entry };
      }
    }
    return null;
  }
}
