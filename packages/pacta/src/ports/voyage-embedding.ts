// SPDX-License-Identifier: Apache-2.0
/**
 * Voyage AI Embedding Adapter — implements EmbeddingPort for Voyage 4 models.
 *
 * Uses the Voyage AI REST API directly (no SDK needed — simple fetch).
 * Models: voyage-4-nano (free, 256-dim), voyage-4 ($0.06/MTok, 1024-dim).
 */
import type { EmbeddingPort } from './embedding-port.js';

export interface VoyageEmbeddingOptions {
  apiKey?: string; // defaults to process.env.VOYAGE_API_KEY
  model?: string; // defaults to 'voyage-3-lite' (free tier)
}

export function createVoyageEmbedding(
  options: VoyageEmbeddingOptions = {},
): EmbeddingPort {
  const apiKey = options.apiKey ?? process.env.VOYAGE_API_KEY;
  if (!apiKey) throw new Error('VOYAGE_API_KEY not set');

  const model = options.model ?? 'voyage-3-lite';

  // Dimension map for known models
  const DIMENSIONS: Record<string, number> = {
    'voyage-3-lite': 512,
    'voyage-3-large': 1024,
    'voyage-4-nano': 256,
    'voyage-4-lite': 512,
    'voyage-4': 1024,
    'voyage-4-large': 1024,
  };

  const dimensions = DIMENSIONS[model] ?? 1024;

  return {
    model,
    dimensions,

    async embed(text: string): Promise<number[]> {
      const result = await callVoyageAPI(apiKey, model, [text]);
      return result[0];
    },

    async embedBatch(texts: string[]): Promise<number[][]> {
      // Voyage supports up to 128 texts per batch
      const results: number[][] = [];
      for (let i = 0; i < texts.length; i += 128) {
        const batch = texts.slice(i, i + 128);
        const batchResults = await callVoyageAPI(apiKey, model, batch);
        results.push(...batchResults);
      }
      return results;
    },
  };
}

async function callVoyageAPI(
  apiKey: string,
  model: string,
  texts: string[],
): Promise<number[][]> {
  const response = await fetch('https://api.voyageai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      input: texts,
      input_type: 'document', // Use 'query' for search queries
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Voyage API error (${response.status}): ${error}`);
  }

  const data = (await response.json()) as {
    data: Array<{ embedding: number[] }>;
  };
  return data.data.map((d) => d.embedding);
}

/**
 * Mock Embedding — deterministic vector generation for tests.
 * Hashes input text into a normalized vector of the given dimensionality.
 */
export function createMockEmbedding(dimensions: number = 256): EmbeddingPort {
  const embedOne = async (text: string): Promise<number[]> => {
    // Deterministic: hash the text into a vector
    const vec = new Array<number>(dimensions).fill(0);
    for (let i = 0; i < text.length; i++) {
      vec[i % dimensions] += text.charCodeAt(i) / 1000;
    }
    // Normalize
    const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
    return norm > 0 ? vec.map((v) => v / norm) : vec;
  };

  return {
    model: 'mock',
    dimensions,
    embed: embedOne,
    async embedBatch(texts: string[]): Promise<number[][]> {
      return Promise.all(texts.map((t) => embedOne(t)));
    },
  };
}
