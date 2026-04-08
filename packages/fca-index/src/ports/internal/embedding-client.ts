/**
 * EmbeddingClientPort — Internal port isolating index-store domain from HTTP calls.
 *
 * Owner: @method/fca-index (defines interface + provides VoyageEmbeddingClient impl)
 * Consumer: index-store domain (internal)
 * Direction: embedding service → index-store (unidirectional)
 * Status: frozen 2026-04-08
 */

export interface EmbeddingClientPort {
  /**
   * Batch-embed texts. Returns one float32 vector per input text.
   * Preserves input order: result[i] is the embedding for texts[i].
   */
  embed(texts: string[]): Promise<number[][]>;

  /** Dimensionality of returned vectors. Must match the Lance table schema. */
  readonly dimensions: number;
}

export class EmbeddingClientError extends Error {
  constructor(
    message: string,
    public readonly code: 'API_ERROR' | 'RATE_LIMITED' | 'QUOTA_EXCEEDED',
  ) {
    super(message);
    this.name = 'EmbeddingClientError';
  }
}
