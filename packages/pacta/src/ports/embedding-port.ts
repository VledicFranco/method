/**
 * Embedding Port — vector generation abstraction for semantic search.
 *
 * Supports Voyage AI models (voyage-4-nano for dev, voyage-4 for production).
 * The shared embedding space allows mixing models without re-indexing.
 */

export interface EmbeddingPort {
  /** Generate embedding vector for a single text. */
  embed(text: string): Promise<number[]>;

  /** Generate embedding vectors for multiple texts (batch). */
  embedBatch(texts: string[]): Promise<number[][]>;

  /** Dimensionality of the embedding vectors produced. */
  readonly dimensions: number;

  /** Model identifier (e.g. 'voyage-4-nano', 'voyage-4'). */
  readonly model: string;
}
