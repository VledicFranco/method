// SPDX-License-Identifier: Apache-2.0
/**
 * Memory Port — unified memory interface for agent context strategies.
 *
 * v2 (PRD 031): Adds FactCard type system, epistemic typing, and structured
 * memory operations alongside the legacy key-value + notes interface.
 *
 * v3 (PRD 036): Adds CLS dual-store (episodic + semantic) with ACT-R
 * activation-based retrieval and offline consolidation. MemoryPortV3
 * extends MemoryPort (not MemoryPortV2) — the two memory systems coexist.
 *
 * Backward-compatible: MemoryEntry, AgentNote, NoteFilter, and legacy
 * MemoryPort methods are preserved for existing consumers.
 */

import type { EmbeddingPort } from './embedding-port.js';

// ── Legacy Types (backward compat) ──────────────────────────────────

export interface MemoryEntry {
  key: string;
  value: string;
  metadata?: Record<string, unknown>;
}

export interface AgentNote {
  id?: string;
  content: string;
  timestamp?: string;
  tags?: string[];
}

export interface NoteFilter {
  tags?: string[];
  since?: string;
  limit?: number;
}

// ── FactCard System (PRD 031) ────────────────────────────────────────

export type EpistemicType = 'FACT' | 'HEURISTIC' | 'RULE' | 'OBSERVATION' | 'PROCEDURE';

/** A reusable cognitive template for common task types (PRD 032, P5). */
export interface ThoughtPattern {
  name: string;
  trigger: string;
  steps: string[];
  exitCondition: string;
}

export interface FactCard {
  id: string;
  content: string;
  type: EpistemicType;
  source: { task?: string; cycle?: number; module?: string };
  tags: string[];
  embedding?: number[];
  created: number;  // timestamp ms
  updated: number;
  confidence: number;  // 0-1
  links: string[];  // related card IDs
}

export interface SearchOptions {
  limit?: number;
  type?: EpistemicType;
  tags?: string[];
  minConfidence?: number;
  recencyBias?: number;  // 0-1, how much to weight recency vs relevance
}

// ── MemoryPort v2 ────────────────────────────────────────────────────

/**
 * MemoryPort — unified memory interface.
 *
 * Legacy methods (store, retrieve, search) are required for backward compat.
 * FactCard methods (PRD 031) are optional so existing v1 consumers compile
 * without modification. Full v2 implementations (e.g. InMemoryMemory) provide
 * all methods; consumers requiring FactCard capabilities should use the
 * MemoryPortV2 branded type which makes them mandatory.
 */
export interface MemoryPort {
  // Legacy methods (backward compat — required)
  store(key: string, value: string, metadata?: Record<string, unknown>): Promise<void>;
  retrieve(key: string): Promise<string | null>;
  search?(query: string, limit?: number): Promise<MemoryEntry[]>;

  /** Write a note to the agent's scratchpad (optional, legacy) */
  writeNote?(note: AgentNote): Promise<void>;
  /** Read notes from the agent's scratchpad (optional, legacy) */
  readNotes?(filter?: NoteFilter): Promise<AgentNote[]>;

  // FactCard methods (PRD 031 — optional on base interface for backward compat)
  storeCard?(card: FactCard): Promise<void>;
  retrieveCard?(id: string): Promise<FactCard | null>;
  searchCards?(query: string, options?: SearchOptions): Promise<FactCard[]>;
  updateCard?(id: string, updates: Partial<Pick<FactCard, 'content' | 'confidence' | 'tags' | 'links' | 'embedding'>>): Promise<void>;
  linkCards?(fromId: string, toId: string): Promise<void>;
  listByType?(type: EpistemicType): Promise<FactCard[]>;
  listByTag?(tag: string): Promise<FactCard[]>;
  expireCard?(id: string): Promise<void>;
  allCards?(): Promise<FactCard[]>;
}

/**
 * MemoryPortV2 — full FactCard-capable memory port (PRD 031).
 *
 * Use this type when a consumer requires FactCard operations.
 * InMemoryMemory implements this interface. Legacy consumers
 * should continue using MemoryPort.
 */
export interface MemoryPortV2 extends MemoryPort {
  search(query: string, limit?: number): Promise<MemoryEntry[]>;
  storeCard(card: FactCard): Promise<void>;
  retrieveCard(id: string): Promise<FactCard | null>;
  searchCards(query: string, options?: SearchOptions): Promise<FactCard[]>;
  updateCard(id: string, updates: Partial<Pick<FactCard, 'content' | 'confidence' | 'tags' | 'links' | 'embedding'>>): Promise<void>;
  linkCards(fromId: string, toId: string): Promise<void>;
  listByType(type: EpistemicType): Promise<FactCard[]>;
  listByTag(tag: string): Promise<FactCard[]>;
  expireCard(id: string): Promise<void>;
  allCards(): Promise<FactCard[]>;
}

// ── CLS Dual-Store Types (PRD 036) ─────────────────────────────────

/**
 * Verbatim episode stored in the fast (episodic) store.
 * High-fidelity, sparse encoding. Indexed by recency + context.
 */
export interface EpisodicEntry {
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

/**
 * Generalized pattern stored in the slow (semantic) store.
 * Updated ONLY through consolidation — never directly by modules.
 */
export interface SemanticEntry {
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

/** Configuration for the CLS dual-store. */
export interface DualStoreConfig {
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

/** Configuration for ACT-R activation-based retrieval. */
export interface ActivationConfig {
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
  /** Optional embedding port for future embedding-enhanced spreading activation (PRD 038). */
  embeddingPort?: EmbeddingPort;
}

/** Configuration for the consolidation module. */
export interface ConsolidationConfig {
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

/** Result of an offline consolidation pass. */
export interface ConsolidationResult {
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

// ── MemoryPort v3 ───────────────────────────────────────────────────

/**
 * MemoryPortV3 — CLS dual-store memory port (PRD 036).
 *
 * Extends MemoryPort (not MemoryPortV2) — the two memory systems coexist.
 * Adds episodic/semantic dual-store operations and ACT-R activation retrieval.
 * InMemoryDualStore is the canonical implementation.
 */
export interface MemoryPortV3 extends MemoryPort {
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
