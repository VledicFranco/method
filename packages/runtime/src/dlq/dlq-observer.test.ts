// SPDX-License-Identifier: Apache-2.0
/**
 * G-DLQ-SINGLE-EMIT — PRD-062 / S5 §7.
 *
 * Both inline (from the handler) and external (from CortexDlqObserver)
 * DLQ paths must produce at most ONE `PactDeadLetterEvent` per sessionId.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type { PactDeadLetterEvent } from '@methodts/pacta';
import { CortexJobBackedExecutor } from '../executors/cortex-job-backed-executor.js';
import { CortexDlqObserver } from './cortex-dlq-observer.js';
import type { ContinuationEnvelope } from '../ports/continuation-envelope.js';
import { makeInMemorySessionStore, sampleEnvelope } from '../__fixtures__/executor-fixtures.js';

describe('G-DLQ-SINGLE-EMIT — only one PactDeadLetterEvent per sessionId', () => {
  let events: PactDeadLetterEvent[];
  let executor: CortexJobBackedExecutor;
  let observer: CortexDlqObserver;
  let envelope: ContinuationEnvelope;

  beforeEach(async () => {
    events = [];
    const store = makeInMemorySessionStore();
    envelope = sampleEnvelope();
    await store.create({
      schemaVersion: 1,
      sessionId: envelope.sessionId,
      scopeId: 'scope',
      pactRef: { id: envelope.pactKey, version: '1', fingerprint: envelope.pactKey },
      status: 'running',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      latestCheckpointSequence: null,
      depth: 0,
      metadata: { '__method.lastAckedTurn': -1 },
    });
    executor = new CortexJobBackedExecutor({
      sessionStore: store,
      workerId: 'test-worker',
      emitAgentEvent: (e) => events.push(e),
    });
    observer = new CortexDlqObserver({
      executor,
      emitAgentEvent: (_e) => {
        /* counted already by executor.emitAgentEvent */
      },
    });
  });

  it('inline path emits one event on first fire', async () => {
    const event = await executor.emitInlineDeadLetter(envelope, 'boom', 1);
    assert.ok(event);
    assert.equal(events.length, 1);
    assert.equal(events[0].type, 'pact.dead_letter');
    assert.equal(events[0].sessionId, envelope.sessionId);
    assert.equal(events[0].lastError, 'boom');
    assert.equal(events[0].attempts, 1);
  });

  it('inline path is idempotent — second fire returns null', async () => {
    await executor.emitInlineDeadLetter(envelope, 'boom', 1);
    const second = await executor.emitInlineDeadLetter(envelope, 'boom again', 2);
    assert.equal(second, null);
    assert.equal(events.length, 1);
  });

  it('external DLQ path suppresses when inline already fired', async () => {
    await executor.emitInlineDeadLetter(envelope, 'inline-boom', 1);
    const external = await observer.onDeadLetter(envelope, {
      jobId: 'job-123',
      attempts: 4,
      lastError: 'exhausted',
      deadLetteredAt: Date.now(),
    });
    assert.equal(external, null);
    assert.equal(events.length, 1);
  });

  it('external path fires once if inline never did', async () => {
    const event = await observer.onDeadLetter(envelope, {
      jobId: 'job-123',
      attempts: 4,
      lastError: 'exhausted',
      deadLetteredAt: Date.now(),
    });
    assert.ok(event);
    assert.equal(events.length, 1);
    assert.equal(events[0].attempts, 4);
  });

  it('both paths firing sequentially for the same sessionId emit exactly one event', async () => {
    await executor.emitInlineDeadLetter(envelope, 'inline', 1);
    await observer.onDeadLetter(envelope, {
      jobId: 'job-123',
      attempts: 4,
      lastError: 'external',
      deadLetteredAt: Date.now(),
    });
    assert.equal(events.length, 1, 'exactly one PactDeadLetterEvent per sessionId');
    // Repeated calls remain idempotent.
    await executor.emitInlineDeadLetter(envelope, 'again', 5);
    await observer.onDeadLetter(envelope, {
      jobId: 'j2',
      attempts: 4,
      lastError: 'again',
      deadLetteredAt: Date.now(),
    });
    assert.equal(events.length, 1);
  });
});
