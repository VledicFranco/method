// SPDX-License-Identifier: Apache-2.0
/**
 * publish-retry — exponential backoff helper around
 * `ctx.events.emit(topic, payload)`. Mirrors `WebhookConnector`
 * backoff semantics (PRD-063 §Architecture).
 *
 * Failure categorisation:
 *   - transient: 429 / 5xx / network / timeout → retry up to maxRetries
 *   - permanent: 4xx schema-rejected, topic-unknown → no retry, drop
 *
 * The `PublishFailure.category` tells the connector whether to buffer
 * (transient-exhausted), dual-write to audit (permanent), or do nothing.
 */

import type { CortexEnvelope } from '../event-envelope-mapper.js';
import type { CortexEventsCtx } from '../ctx-types.js';

export type PublishFailureCategory = 'transient' | 'permanent' | 'unknown';

export interface PublishSuccess {
  readonly kind: 'success';
  readonly eventId: string;
  readonly subscriberCount: number;
}

export interface PublishFailure {
  readonly kind: 'failure';
  readonly category: PublishFailureCategory;
  readonly statusCode?: number;
  readonly reason: string;
  readonly lastError: unknown;
  readonly attempts: number;
}

export type PublishResult = PublishSuccess | PublishFailure;

export interface PublishRetryOptions {
  readonly maxRetries: number;
  readonly retryBaseMs: number;
  /** Injected delay for tests (awaited). Defaults to `setTimeout`. */
  readonly delay?: (ms: number) => Promise<void>;
}

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_RETRY_BASE_MS = 1000;

export async function publishWithRetry(
  events: CortexEventsCtx,
  topic: string,
  envelope: CortexEnvelope,
  options: Partial<PublishRetryOptions> = {},
): Promise<PublishResult> {
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  const retryBaseMs = options.retryBaseMs ?? DEFAULT_RETRY_BASE_MS;
  const delay = options.delay ?? defaultDelay;

  let lastError: unknown;
  let lastCategory: PublishFailureCategory = 'unknown';
  let lastReason = 'unknown';
  let lastStatus: number | undefined;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await events.emit(topic, envelope as unknown as Readonly<Record<string, unknown>>);
      return {
        kind: 'success',
        eventId: result.eventId,
        subscriberCount: result.subscriberCount,
      };
    } catch (err) {
      lastError = err;
      const classified = classifyError(err);
      lastCategory = classified.category;
      lastReason = classified.reason;
      lastStatus = classified.statusCode;

      if (classified.category === 'permanent') {
        return {
          kind: 'failure',
          category: 'permanent',
          statusCode: lastStatus,
          reason: lastReason,
          lastError,
          attempts: attempt + 1,
        };
      }

      if (attempt < maxRetries) {
        await delay(retryBaseMs * 2 ** attempt);
      }
    }
  }

  return {
    kind: 'failure',
    category: lastCategory,
    statusCode: lastStatus,
    reason: lastReason,
    lastError,
    attempts: maxRetries + 1,
  };
}

// ── Error classification ─────────────────────────────────────────

interface Classification {
  readonly category: PublishFailureCategory;
  readonly reason: string;
  readonly statusCode?: number;
}

/**
 * Classify a thrown error from `ctx.events.emit`. The Cortex SDK throws
 * errors with:
 *   - `statusCode` (number): HTTP-like code — 4xx permanent (except 429),
 *     5xx transient, 429 transient.
 *   - `reason` (string): topic_unknown | schema_rejected | quota_exceeded | ...
 *   - `message` (string): human text.
 *
 * We accept any shape defensively (never assume), but hard-prefer
 * `statusCode` and `reason` when present.
 */
export function classifyError(err: unknown): Classification {
  if (err && typeof err === 'object') {
    const e = err as {
      statusCode?: unknown;
      status?: unknown;
      reason?: unknown;
      code?: unknown;
      name?: unknown;
      message?: unknown;
    };

    const status =
      typeof e.statusCode === 'number'
        ? e.statusCode
        : typeof e.status === 'number'
          ? e.status
          : undefined;
    const reason =
      typeof e.reason === 'string'
        ? e.reason
        : typeof e.code === 'string'
          ? e.code
          : typeof e.message === 'string'
            ? e.message
            : 'unknown';

    if (typeof status === 'number') {
      if (status === 429) {
        return { category: 'transient', reason: 'rate_limited', statusCode: status };
      }
      if (status >= 500) {
        return { category: 'transient', reason: `server_error_${status}`, statusCode: status };
      }
      if (status >= 400) {
        return { category: 'permanent', reason, statusCode: status };
      }
    }

    // No status — inspect names for common patterns.
    const nameLike = typeof e.name === 'string' ? e.name.toLowerCase() : '';
    if (nameLike.includes('timeout') || nameLike.includes('abort')) {
      return { category: 'transient', reason: 'timeout' };
    }
    if (nameLike.includes('network') || nameLike.includes('fetch')) {
      return { category: 'transient', reason: 'network' };
    }
    if (
      reason === 'schema_rejected' ||
      reason === 'topic_unknown' ||
      reason === 'validation_failed'
    ) {
      return { category: 'permanent', reason };
    }
  }
  return { category: 'unknown', reason: 'unknown' };
}

function defaultDelay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export { DEFAULT_MAX_RETRIES, DEFAULT_RETRY_BASE_MS };
