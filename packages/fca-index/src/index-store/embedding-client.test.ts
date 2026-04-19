// SPDX-License-Identifier: Apache-2.0
/**
 * VoyageEmbeddingClient — unit tests.
 *
 * Uses vi.stubGlobal to mock fetch. Tests rate-limit backoff with fake timers.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { VoyageEmbeddingClient } from './embedding-client.js';
import { EmbeddingClientError } from '../ports/internal/embedding-client.js';

function makeSuccessResponse(embeddings: number[][]): Response {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => ({
      data: embeddings.map((embedding) => ({ embedding })),
    }),
  } as unknown as Response;
}

function make429Response(retryAfterSeconds?: number): Response {
  return {
    ok: false,
    status: 429,
    statusText: 'Too Many Requests',
    headers: {
      get: (name: string) => {
        if (name === 'Retry-After' || name === 'retry-after') {
          return retryAfterSeconds !== undefined ? String(retryAfterSeconds) : null;
        }
        return null;
      },
    },
    json: async () => ({ error: 'rate limited' }),
  } as unknown as Response;
}

function make500Response(): Response {
  return {
    ok: false,
    status: 500,
    statusText: 'Internal Server Error',
    json: async () => ({ error: 'server error' }),
  } as unknown as Response;
}

describe('VoyageEmbeddingClient', () => {
  let client: VoyageEmbeddingClient;

  beforeEach(() => {
    client = new VoyageEmbeddingClient({
      apiKey: 'test-key',
      model: 'voyage-3-lite',
      dimensions: 4,
      baseUrl: 'https://api.test.com/v1',
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('has correct dimensions from config', () => {
    expect(client.dimensions).toBe(4);
  });

  it('uses default dimensions when not specified', () => {
    const defaultClient = new VoyageEmbeddingClient({ apiKey: 'key' });
    expect(defaultClient.dimensions).toBe(512);
  });

  describe('successful embed', () => {
    it('returns embeddings for given texts', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        makeSuccessResponse([[1, 0, 0, 0], [0, 1, 0, 0]]),
      );
      vi.stubGlobal('fetch', mockFetch);

      const result = await client.embed(['hello', 'world']);
      expect(result).toEqual([[1, 0, 0, 0], [0, 1, 0, 0]]);
    });

    it('sends correct request body and headers', async () => {
      const mockFetch = vi.fn().mockResolvedValue(
        makeSuccessResponse([[1, 0, 0, 0]]),
      );
      vi.stubGlobal('fetch', mockFetch);

      await client.embed(['test text']);

      expect(mockFetch).toHaveBeenCalledOnce();
      const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://api.test.com/v1/embeddings');
      expect(options.method).toBe('POST');
      expect((options.headers as Record<string, string>)['Authorization']).toBe('Bearer test-key');
      expect((options.headers as Record<string, string>)['Content-Type']).toBe('application/json');

      const body = JSON.parse(options.body as string) as Record<string, unknown>;
      expect(body['model']).toBe('voyage-3-lite');
      expect(body['input']).toEqual(['test text']);
      expect(body['input_type']).toBe('document');
    });
  });

  describe('rate limit handling', () => {
    it('retries on 429 with exponential backoff', async () => {
      vi.useFakeTimers();
      try {
        const mockFetch = vi.fn()
          .mockResolvedValueOnce(make429Response())
          .mockResolvedValueOnce(make429Response())
          .mockResolvedValueOnce(makeSuccessResponse([[1, 0, 0, 0]]));
        vi.stubGlobal('fetch', mockFetch);

        const embedPromise = client.embed(['text']);

        // Advance timers for first retry: 2^0 * 5000 = 5000ms
        await vi.advanceTimersByTimeAsync(5000);
        // Advance timers for second retry: 2^1 * 5000 = 10000ms
        await vi.advanceTimersByTimeAsync(10000);

        const result = await embedPromise;
        expect(result).toEqual([[1, 0, 0, 0]]);
        expect(mockFetch).toHaveBeenCalledTimes(3);
      } finally {
        vi.useRealTimers();
      }
    });

    it('throws EmbeddingClientError after max retries exhausted', async () => {
      vi.useFakeTimers();
      try {
        const mockFetch = vi.fn().mockResolvedValue(make429Response());
        vi.stubGlobal('fetch', mockFetch);

        // Attach catch immediately to prevent unhandled rejection
        let caughtError: unknown;
        const embedPromise = client.embed(['text']).catch((e) => { caughtError = e; });

        // Advance through all 5 retry delays: 5000 + 10000 + 20000 + 40000 + 80000ms
        await vi.advanceTimersByTimeAsync(5000);
        await vi.advanceTimersByTimeAsync(10000);
        await vi.advanceTimersByTimeAsync(20000);
        await vi.advanceTimersByTimeAsync(40000);
        await vi.advanceTimersByTimeAsync(80000);

        await embedPromise;
        expect(caughtError).toBeInstanceOf(EmbeddingClientError);
      } finally {
        vi.useRealTimers();
      }
    });

    it('throws EmbeddingClientError with RATE_LIMITED code after retries', async () => {
      vi.useFakeTimers();
      try {
        const mockFetch = vi.fn().mockResolvedValue(make429Response());
        vi.stubGlobal('fetch', mockFetch);

        // Attach catch immediately to prevent unhandled rejection
        let caughtError: unknown;
        const embedPromise = client.embed(['text']).catch((e) => { caughtError = e; });

        // Advance through all 5 retry delays: 5000 + 10000 + 20000 + 40000 + 80000ms
        await vi.advanceTimersByTimeAsync(5000);
        await vi.advanceTimersByTimeAsync(10000);
        await vi.advanceTimersByTimeAsync(20000);
        await vi.advanceTimersByTimeAsync(40000);
        await vi.advanceTimersByTimeAsync(80000);

        await embedPromise;
        expect(caughtError).toBeInstanceOf(EmbeddingClientError);
        expect((caughtError as EmbeddingClientError).code).toBe('RATE_LIMITED');
        expect((caughtError as EmbeddingClientError).message).toContain('Rate limit exceeded');
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('API error handling', () => {
    it('throws EmbeddingClientError with API_ERROR on non-429 failure', async () => {
      const mockFetch = vi.fn().mockResolvedValue(make500Response());
      vi.stubGlobal('fetch', mockFetch);

      await expect(client.embed(['text'])).rejects.toThrow(EmbeddingClientError);
    });

    it('includes status in error message', async () => {
      const mockFetch = vi.fn().mockResolvedValue(make500Response());
      vi.stubGlobal('fetch', mockFetch);

      try {
        await client.embed(['text']);
        expect.fail('Should have thrown');
      } catch (err) {
        expect((err as EmbeddingClientError).message).toContain('500');
      }
    });
  });
});
