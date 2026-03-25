/**
 * Memory Port — unified memory interface for agent context strategies.
 *
 * Provides key-value storage, optional semantic search, and optional
 * note-taking for the 'notes' context strategy. Implementations may
 * back this with in-memory stores, databases, or vector search.
 */

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

export interface MemoryPort {
  /** Store a value by key */
  store(key: string, value: string, metadata?: Record<string, unknown>): Promise<void>;

  /** Retrieve a value by key */
  retrieve(key: string): Promise<string | null>;

  /** Semantic search over stored values (optional capability) */
  search?(query: string, limit?: number): Promise<MemoryEntry[]>;

  /** Write a note to the agent's scratchpad (optional capability) */
  writeNote?(note: AgentNote): Promise<void>;

  /** Read notes from the agent's scratchpad (optional capability) */
  readNotes?(filter?: NoteFilter): Promise<AgentNote[]>;
}
