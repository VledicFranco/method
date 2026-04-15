/**
 * Shared test fixtures for PRD-062 executor + DLQ tests.
 *
 * Not part of the public surface — only consumed by *.test.ts files.
 */

import { createInMemorySessionStore } from '../sessions/session-store/in-memory-session-store.js';
import type { SessionStore } from '../ports/session-store.js';
import type { ContinuationEnvelope } from '../ports/continuation-envelope.js';

export function makeInMemorySessionStore(): SessionStore {
  return createInMemorySessionStore();
}

export function sampleEnvelope(
  overrides: Partial<ContinuationEnvelope> = {},
): ContinuationEnvelope {
  const nowMs = Date.now();
  return {
    version: 1,
    sessionId: 'sess-fixture-1',
    turnIndex: 0,
    checkpointRef: { id: 'ck-0', hash: 'hash-0', sizeBytes: 128 },
    budgetRef: {
      reservationId: '',
      strategy: 'fresh-per-continuation',
      remainingUsd: 2.0,
      expiresAt: nowMs + 60 * 60 * 1000,
    },
    nextAction: { type: 'resume', reason: 'checkpoint_yield' },
    pactKey: 'test-pact',
    tokenContext: {
      userSub: 'user-1',
      exchangeDepth: 0,
      originatingRequestId: 'req-1',
    },
    emittedAt: nowMs,
    traceId: 'trace-1',
    ...overrides,
  };
}
