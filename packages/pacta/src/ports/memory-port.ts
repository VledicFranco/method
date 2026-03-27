/**
 * Memory Port — unified memory interface for agent context strategies.
 *
 * v2 (PRD 031): Adds FactCard type system, epistemic typing, and structured
 * memory operations alongside the legacy key-value + notes interface.
 *
 * Backward-compatible: MemoryEntry, AgentNote, NoteFilter, and legacy
 * MemoryPort methods are preserved for existing consumers.
 */

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

export type EpistemicType = 'FACT' | 'HEURISTIC' | 'RULE' | 'OBSERVATION';

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
