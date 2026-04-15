/**
 * Tests for publish-retry — PRD-063 §Tests.
 *
 * Verifies transient/permanent classification + backoff semantics.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import type { CortexEventsCtx } from '../ctx-types.js';
import type { CortexEnvelope } from '../event-envelope-mapper.js';
import { publishWithRetry, classifyError } from './publish-retry.js';

function envelope(): CortexEnvelope {
  return {
    eventId: 'mre-abc',
    eventType: 'method.session.started',
    emitterAppId: 'app',
    emittedAt: '2026-04-15T00:00:00Z',
    emittedBy: 'service:app',
    payload: {},
    schemaVersion: 1,
  };
}

const immediateDelay = (): Promise<void> => Promise.resolve();

describe('publishWithRetry', () => {
  it('returns success on first attempt', async () => {
    const events: CortexEventsCtx = {
      async emit() {
        return { eventId: 'srv-id', subscriberCount: 3 };
      },
    };
    const res = await publishWithRetry(events, 't', envelope(), { delay: immediateDelay });
    assert.equal(res.kind, 'success');
    if (res.kind === 'success') {
      assert.equal(res.subscriberCount, 3);
    }
  });

  it('retries on transient (429) and eventually succeeds', async () => {
    let calls = 0;
    const events: CortexEventsCtx = {
      async emit() {
        calls += 1;
        if (calls < 3) {
          const err: Error & { statusCode?: number } = new Error('rate limited');
          err.statusCode = 429;
          throw err;
        }
        return { eventId: 'x', subscriberCount: 1 };
      },
    };
    const res = await publishWithRetry(events, 't', envelope(), {
      maxRetries: 3,
      retryBaseMs: 1,
      delay: immediateDelay,
    });
    assert.equal(res.kind, 'success');
    assert.equal(calls, 3);
  });

  it('returns permanent failure on 4xx schema rejection', async () => {
    const events: CortexEventsCtx = {
      async emit() {
        const err: Error & { statusCode?: number; reason?: string } = new Error('bad schema');
        err.statusCode = 400;
        err.reason = 'schema_rejected';
        throw err;
      },
    };
    const res = await publishWithRetry(events, 't', envelope(), { delay: immediateDelay });
    assert.equal(res.kind, 'failure');
    if (res.kind === 'failure') {
      assert.equal(res.category, 'permanent');
      assert.equal(res.reason, 'schema_rejected');
      assert.equal(res.statusCode, 400);
      assert.equal(res.attempts, 1);
    }
  });

  it('exhausts maxRetries on transient and reports failure', async () => {
    let calls = 0;
    const events: CortexEventsCtx = {
      async emit() {
        calls += 1;
        const err: Error & { statusCode?: number } = new Error('server');
        err.statusCode = 503;
        throw err;
      },
    };
    const res = await publishWithRetry(events, 't', envelope(), {
      maxRetries: 2,
      retryBaseMs: 1,
      delay: immediateDelay,
    });
    assert.equal(res.kind, 'failure');
    assert.equal(calls, 3); // initial + 2 retries
    if (res.kind === 'failure') {
      assert.equal(res.category, 'transient');
      assert.equal(res.statusCode, 503);
    }
  });
});

describe('classifyError', () => {
  it('classifies 429 as transient', () => {
    assert.equal(classifyError({ statusCode: 429 }).category, 'transient');
  });
  it('classifies 5xx as transient', () => {
    assert.equal(classifyError({ statusCode: 502 }).category, 'transient');
  });
  it('classifies 4xx (non-429) as permanent', () => {
    assert.equal(classifyError({ statusCode: 400, reason: 'schema_rejected' }).category, 'permanent');
  });
  it('classifies TimeoutError by name', () => {
    assert.equal(classifyError({ name: 'TimeoutError' }).category, 'transient');
  });
  it('classifies schema_rejected by reason (no status)', () => {
    assert.equal(classifyError({ reason: 'schema_rejected' }).category, 'permanent');
  });
  it('returns unknown for unrecognised shapes', () => {
    assert.equal(classifyError(null).category, 'unknown');
    assert.equal(classifyError({}).category, 'unknown');
  });
});
