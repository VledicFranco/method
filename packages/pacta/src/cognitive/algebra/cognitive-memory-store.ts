/**
 * CognitiveMemoryStore — unified memory architecture (RFC 006 Part III).
 *
 * Replaces bounded partitioned workspaces with an unbounded store where every
 * write is a memory store and every read is an activation-based retrieval query.
 * Nothing is ever destructively evicted — activation decays but entries remain
 * retrievable when spreading activation cues match.
 *
 * Retrieval uses hybrid scoring (Collins & Loftus, 1975):
 * - Lexical: term overlap between cues and entry content (ACT-R spreading activation)
 * - Semantic: cosine similarity between cue embedding and entry embedding (when EmbeddingPort available)
 * - Fusion: RRF (Reciprocal Rank Fusion) combines both rankings
 *
 * Grounded in Cowan's embedded-processes model (1999, 2001): working memory is
 * the activated subset of long-term memory, not a separate buffer. The "capacity
 * limit" is an attention bottleneck (retrieval budget), not a container size.
 *
 * @see docs/rfcs/006-anticipatory-monitoring.md — Part III
 */

import type { WorkspaceEntry, ReadonlyWorkspaceSnapshot } from './workspace-types.js';
import type { ModuleId } from './module.js';
import type { EmbeddingPort } from '../../ports/embedding-port.js';

// ── Types ─────────────────────────────────────────────────────

/** Partition role — retrieval filter tag, not a capacity-limited bin. */
export type PartitionRole = 'constraint' | 'operational' | 'task' | 'goal' | 'memory' | 'correction';

/** Entry in the unified store. */
export interface MemoryStoreEntry {
  /** Unique ID. */
  id: string;
  /** The workspace entry content. */
  entry: WorkspaceEntry;
  /** Role tag for retrieval filtering. */
  role: PartitionRole;
  /** Source module that stored this entry. */
  source: ModuleId;
  /** Timestamp of initial storage. */
  storedAt: number;
  /** Number of times retrieved. Feeds base-level activation. */
  accessCount: number;
  /** Last retrieval timestamp. */
  lastAccessed: number;
  /** Context tags for tag-based spreading activation. */
  tags: string[];
  /** Whether this entry has been marked expired (stale invalidation). */
  expired: boolean;
  /** Embedding vector for semantic retrieval (populated when EmbeddingPort available). */
  embedding?: number[];
}

/** Per-module retrieval query. */
export interface RetrievalQuery {
  /** Requesting module. */
  module: ModuleId;
  /** Role filter (optional — retrieve from specific roles or all). */
  roles?: PartitionRole[];
  /** Token budget for the result. */
  budget: number;
  /** Spreading activation cues — content-based term matching. */
  cues: string[];
  /** Minimum activation threshold. Default: -1.0 */
  threshold?: number;
}

/** Configuration for the store. */
export interface CognitiveMemoryStoreConfig {
  /** Spreading activation weight for content-term matches. Default: 0.25 */
  contentSpreadingWeight?: number;
  /** Spreading activation weight for tag matches. Default: 0.3 */
  tagSpreadingWeight?: number;
  /** Base-level activation decay parameter. Default: 0.5 */
  decayRate?: number;
  /** Noise amplitude for retrieval variability. Default: 0.05 */
  noiseAmplitude?: number;
  /** Age gating: don't retrieve entries stored within this many ms. Default: 0 */
  ageGateMs?: number;
  /** Optional embedding port for semantic retrieval. When present, enables hybrid search. */
  embeddingPort?: EmbeddingPort;
  /** RRF k parameter for rank fusion. Default: 60 */
  rrfK?: number;
}

// ── Cosine Similarity ─────────────────────────────────────

function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom > 0 ? dot / denom : 0;
}

// ── RRF Fusion ────────────────────────────────────────────

function rrfScore(rank1: number, rank2: number, k: number): number {
  return 1 / (k + rank1) + 1 / (k + rank2);
}

// ── Term Extraction ───────────────────────────────────────────

/** Extract meaningful terms from text for content-based spreading activation. */
function extractTerms(text: string): Set<string> {
  const words = text.toLowerCase().match(/[a-z][a-z0-9_]{2,}/g) ?? [];
  const stops = new Set([
    'the', 'and', 'for', 'that', 'this', 'with', 'from', 'your', 'you',
    'are', 'was', 'were', 'has', 'have', 'had', 'not', 'but', 'can',
    'will', 'should', 'must', 'may', 'use', 'using', 'used',
    'file', 'files', 'code', 'task', 'make', 'sure', 'any', 'been',
    'into', 'also', 'each', 'which', 'then', 'than', 'when', 'what',
  ]);
  return new Set(words.filter(w => !stops.has(w)));
}

// ── Activation Scoring ────────────────────────────────────────

function computeStoreActivation(
  entry: MemoryStoreEntry,
  cueTerms: Set<string>,
  now: number,
  config: ResolvedConfig,
): number {
  // 1. Base-level activation: log(accessCount / sqrt(ageSec))
  const ageMs = now - entry.lastAccessed;
  const ageSec = Math.max(1, ageMs / 1000);
  const baseLevelActivation = Math.log(Math.max(1, entry.accessCount) / Math.pow(ageSec, config.decayRate));

  // 2. Content-based spreading activation: term overlap with entry content
  const entryContent = typeof entry.entry.content === 'string'
    ? entry.entry.content : JSON.stringify(entry.entry.content);
  const entryTerms = extractTerms(entryContent);
  let contentOverlap = 0;
  for (const cue of cueTerms) {
    if (entryTerms.has(cue)) contentOverlap++;
  }
  const contentSpread = cueTerms.size > 0
    ? (contentOverlap / cueTerms.size) * config.contentSpreadingWeight * 5 // scale up to be meaningful
    : 0;

  // 3. Tag-based spreading activation (classic ACT-R)
  let tagOverlap = 0;
  for (const cue of cueTerms) {
    if (entry.tags.some(t => t.includes(cue.toString()))) tagOverlap++;
  }
  const tagSpread = tagOverlap * config.tagSpreadingWeight;

  // 4. Noise
  const noise = (Math.random() - 0.5) * config.noiseAmplitude;

  return baseLevelActivation + contentSpread + tagSpread + noise;
}

// ── Store Implementation ──────────────────────────────────────

export interface CognitiveMemoryStore {
  /** Store an entry. Embeds content asynchronously when EmbeddingPort is available. */
  store(entry: WorkspaceEntry, role: PartitionRole, source: ModuleId, tags?: string[]): void;

  /** Retrieve entries relevant to a query. Uses hybrid search when embeddings available. */
  retrieve(query: RetrievalQuery): Promise<ReadonlyWorkspaceSnapshot>;

  /** Expire entries matching a predicate (stale invalidation). */
  expire(predicate: (entry: MemoryStoreEntry) => boolean): number;

  /** Total entries in store. */
  size(): number;

  /** All entries (for debugging). */
  allEntries(): MemoryStoreEntry[];
}

/** Resolved config — optional fields replaced with concrete values or undefined. */
interface ResolvedConfig {
  contentSpreadingWeight: number;
  tagSpreadingWeight: number;
  decayRate: number;
  noiseAmplitude: number;
  ageGateMs: number;
  embeddingPort: EmbeddingPort | undefined;
  rrfK: number;
}

/**
 * Create a CognitiveMemoryStore — the unified memory that replaces partitions.
 *
 * When an EmbeddingPort is provided, store() embeds entry content and retrieve()
 * uses hybrid search: lexical activation + semantic cosine similarity, fused via RRF.
 * Without an EmbeddingPort, falls back to lexical-only scoring.
 */
export function createCognitiveMemoryStore(
  config?: CognitiveMemoryStoreConfig,
): CognitiveMemoryStore {
  const cfg: ResolvedConfig = {
    contentSpreadingWeight: config?.contentSpreadingWeight ?? 0.25,
    tagSpreadingWeight: config?.tagSpreadingWeight ?? 0.3,
    decayRate: config?.decayRate ?? 0.5,
    noiseAmplitude: config?.noiseAmplitude ?? 0.05,
    ageGateMs: config?.ageGateMs ?? 0,
    embeddingPort: config?.embeddingPort,
    rrfK: config?.rrfK ?? 60,
  };

  const entries: MemoryStoreEntry[] = [];
  let idCounter = 0;

  // Background embedding queue — entries are embedded asynchronously after store()
  const pendingEmbeddings: Array<{ entry: MemoryStoreEntry; text: string }> = [];

  async function processPendingEmbeddings(): Promise<void> {
    if (!cfg.embeddingPort || pendingEmbeddings.length === 0) return;
    const batch = pendingEmbeddings.splice(0);
    try {
      const texts = batch.map(b => b.text.slice(0, 2000)); // truncate for embedding
      const vectors = await cfg.embeddingPort.embedBatch(texts);
      for (let i = 0; i < batch.length; i++) {
        batch[i].entry.embedding = vectors[i];
      }
    } catch {
      // Embedding failure is non-fatal — entries just won't have vectors
    }
  }

  return {
    store(entry: WorkspaceEntry, role: PartitionRole, source: ModuleId, tags?: string[]): void {
      const content = typeof entry.content === 'string' ? entry.content : JSON.stringify(entry.content);
      const autoTags = tags ?? [];
      const pathMatch = content.match(/[\w/.-]+\.\w{1,4}/g);
      if (pathMatch) autoTags.push(...pathMatch.slice(0, 5));

      const now = Date.now();
      const storeEntry: MemoryStoreEntry = {
        id: `cms-${idCounter++}`,
        entry,
        role,
        source,
        storedAt: now,
        accessCount: 1,
        lastAccessed: now,
        tags: autoTags,
        expired: false,
      };
      entries.push(storeEntry);

      // Queue for async embedding if port available
      if (cfg.embeddingPort) {
        pendingEmbeddings.push({ entry: storeEntry, text: content });
      }
    },

    async retrieve(query: RetrievalQuery): Promise<ReadonlyWorkspaceSnapshot> {
      // Process any pending embeddings before retrieval
      await processPendingEmbeddings();

      const now = Date.now();
      const cueTerms = new Set<string>();
      for (const cue of query.cues) {
        for (const term of extractTerms(cue)) {
          cueTerms.add(term);
        }
      }

      const threshold = query.threshold ?? -1.0;

      // Filter eligible entries
      const eligible: MemoryStoreEntry[] = [];
      for (const e of entries) {
        if (e.expired) continue;
        if (query.roles && !query.roles.includes(e.role)) continue;
        if (cfg.ageGateMs > 0 && (now - e.storedAt) < cfg.ageGateMs) continue;
        eligible.push(e);
      }

      // 1. Lexical scoring (ACT-R activation)
      const lexicalScored = eligible
        .map(e => ({ entry: e, score: computeStoreActivation(e, cueTerms, now, cfg) }))
        .filter(s => s.score >= threshold)
        .sort((a, b) => b.score - a.score);

      // 2. Semantic scoring (cosine similarity, when embeddings available)
      let fusedRanking: Array<{ entry: MemoryStoreEntry; score: number }>;

      const hasEmbeddings = cfg.embeddingPort && eligible.some(e => e.embedding);
      if (hasEmbeddings) {
        // Embed the cue text
        const cueText = query.cues.join(' ').slice(0, 2000);
        let cueEmbedding: number[] | null = null;
        try {
          cueEmbedding = await cfg.embeddingPort!.embed(cueText);
        } catch {
          // Fall through to lexical-only
        }

        if (cueEmbedding) {
          // Compute semantic scores
          const semanticScored = eligible
            .filter(e => e.embedding)
            .map(e => ({ entry: e, score: cosine(cueEmbedding!, e.embedding!) }))
            .sort((a, b) => b.score - a.score);

          // Build rank maps
          const lexicalRank = new Map<string, number>();
          lexicalScored.forEach((s, i) => lexicalRank.set(s.entry.id, i + 1));

          const semanticRank = new Map<string, number>();
          semanticScored.forEach((s, i) => semanticRank.set(s.entry.id, i + 1));

          // RRF fusion
          const allIds = new Set([...lexicalRank.keys(), ...semanticRank.keys()]);
          const fused: Array<{ entry: MemoryStoreEntry; score: number }> = [];
          for (const id of allIds) {
            const e = eligible.find(x => x.id === id)!;
            const lRank = lexicalRank.get(id) ?? eligible.length;
            const sRank = semanticRank.get(id) ?? eligible.length;
            fused.push({ entry: e, score: rrfScore(lRank, sRank, cfg.rrfK) });
          }
          fused.sort((a, b) => b.score - a.score);
          fusedRanking = fused;
        } else {
          fusedRanking = lexicalScored;
        }
      } else {
        fusedRanking = lexicalScored;
      }

      // Select entries within token budget
      const result: WorkspaceEntry[] = [];
      let tokensUsed = 0;
      for (const { entry: se } of fusedRanking) {
        const content = typeof se.entry.content === 'string'
          ? se.entry.content : JSON.stringify(se.entry.content);
        const entryTokens = Math.ceil(content.length / 4);

        if (tokensUsed + entryTokens > query.budget) {
          if (result.length === 0) {
            result.push(se.entry);
            se.accessCount++;
            se.lastAccessed = now;
          }
          break;
        }

        result.push(se.entry);
        tokensUsed += entryTokens;
        se.accessCount++;
        se.lastAccessed = now;
      }

      return result;
    },

    expire(predicate: (entry: MemoryStoreEntry) => boolean): number {
      let count = 0;
      for (const e of entries) {
        if (!e.expired && predicate(e)) {
          e.expired = true;
          count++;
        }
      }
      return count;
    },

    size(): number {
      return entries.filter(e => !e.expired).length;
    },

    allEntries(): MemoryStoreEntry[] {
      return [...entries];
    },
  };
}
