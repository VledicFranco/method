// SPDX-License-Identifier: Apache-2.0
/**
 * VoyageEmbeddingClient — EmbeddingClientPort implementation backed by Voyage AI REST API.
 *
 * Uses global fetch (Node 18+). No HTTP client library imports.
 * Handles rate limiting with exponential backoff (max 3 retries).
 */

import type { EmbeddingClientPort } from '../ports/internal/embedding-client.js';
import { EmbeddingClientError } from '../ports/internal/embedding-client.js';
import type { ObservabilityPort } from '../ports/observability.js';
import { NullObservabilitySink, scoped } from '../ports/observability.js';

interface VoyageEmbeddingResponse {
  data: Array<{ embedding: number[] }>;
}

export class VoyageEmbeddingClient implements EmbeddingClientPort {
  readonly dimensions: number;
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly obs: ReturnType<typeof scoped>;

  constructor(
    private readonly config: {
      apiKey: string;
      model?: string;
      dimensions?: number;
      baseUrl?: string;
    },
    observability: ObservabilityPort = new NullObservabilitySink(),
  ) {
    this.dimensions = config.dimensions ?? 512;
    this.model = config.model ?? 'voyage-3-lite';
    this.baseUrl = config.baseUrl ?? 'https://api.voyageai.com/v1';
    this.apiKey = config.apiKey;
    this.obs = scoped(observability, 'embed');
  }

  async embed(texts: string[]): Promise<number[][]> {
    const url = `${this.baseUrl}/embeddings`;
    const body = JSON.stringify({
      model: this.model,
      input: texts,
      input_type: 'document',
    });

    let attempt = 0;
    const maxRetries = 5;

    while (true) {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body,
      });

      if (response.status === 429) {
        if (attempt >= maxRetries) {
          throw new EmbeddingClientError('Rate limit exceeded after retries', 'RATE_LIMITED');
        }
        // Respect Retry-After header if present; otherwise exponential backoff starting at 5s
        const retryAfterRaw = response.headers.get('Retry-After') ?? response.headers.get('retry-after');
        const waitMs = retryAfterRaw
          ? parseInt(retryAfterRaw, 10) * 1000
          : Math.pow(2, attempt) * 5000;
        this.obs(
          'rate_limited',
          { wait_ms: waitMs, attempt: attempt + 1, max_retries: maxRetries },
          'warn',
        );
        await new Promise<void>((resolve) => setTimeout(resolve, waitMs));
        attempt++;
        continue;
      }

      if (!response.ok) {
        const code =
          response.status === 402 || response.status === 429
            ? 'QUOTA_EXCEEDED'
            : 'API_ERROR';
        throw new EmbeddingClientError(
          `Voyage API error: ${response.status} ${response.statusText}`,
          code,
        );
      }

      const data = (await response.json()) as VoyageEmbeddingResponse;
      return data.data.map((item) => item.embedding);
    }
  }
}
