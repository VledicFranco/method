// SPDX-License-Identifier: Apache-2.0
/**
 * Continuation envelope — PRD-067 cross-app extension tests.
 *
 * Gates:
 *   - G-ENVELOPE-BACKWARD-COMPAT: pre-PRD-067 envelopes (no crossApp field)
 *     round-trip byte-identically via JSON.
 *   - version literal stays 1 (additive extension — no version bump).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseContinuationEnvelope,
  type ContinuationEnvelope,
  type CrossAppContinuationContext,
} from './continuation-envelope.js';

function preCrossAppEnvelope(): ContinuationEnvelope {
  return {
    version: 1,
    sessionId: 'sess-xyz',
    turnIndex: 3,
    checkpointRef: { id: 'cp1', hash: 'h', sizeBytes: 100 },
    budgetRef: {
      reservationId: 'res1',
      strategy: 'fresh-per-continuation',
      remainingUsd: 1.0,
      expiresAt: Date.now() + 60_000,
    },
    nextAction: { type: 'resume', reason: 'async_io' },
    pactKey: 'pact-1',
    tokenContext: {
      userSub: 'user-1',
      exchangeDepth: 1,
      originatingRequestId: 'req-1',
    },
    emittedAt: Date.now(),
    traceId: 'trace-1',
  };
}

describe('ContinuationEnvelope — PRD-067 extension', () => {
  it('G-ENVELOPE-BACKWARD-COMPAT: pre-PRD-067 envelope round-trips byte-identical', () => {
    const envelope = preCrossAppEnvelope();
    const serialised = JSON.stringify(envelope);
    const reparsed = JSON.parse(serialised) as ContinuationEnvelope;
    assert.equal(reparsed.version, 1);
    assert.equal('crossApp' in reparsed, false);
    const reserialised = JSON.stringify(reparsed);
    assert.equal(serialised, reserialised, 'serialisation must be byte-identical');
    const parsed = parseContinuationEnvelope(JSON.parse(serialised));
    assert.equal(parsed.version, 1);
  });

  it('accepts optional crossApp field without version bump', () => {
    const crossApp: CrossAppContinuationContext = {
      callerNodeId: 'commission',
      targetAppId: 'feature-dev-agent',
      operation: 'commission_fix',
      originatingRequestId: 'req-1',
      targetDecisionId: 'd-1',
      phase: 'awaiting_callee',
    };
    const envelope: ContinuationEnvelope = { ...preCrossAppEnvelope(), crossApp };
    const serialised = JSON.stringify(envelope);
    const parsed = parseContinuationEnvelope(JSON.parse(serialised));
    assert.equal(parsed.version, 1, 'version stays 1 — additive extension');
    assert.ok(parsed.crossApp);
    assert.equal(parsed.crossApp.phase, 'awaiting_callee');
    assert.equal(parsed.crossApp.targetAppId, 'feature-dev-agent');
  });

  it('supports completed + failed phases carrying callee output / failure reason', () => {
    const base = preCrossAppEnvelope();
    const completed: ContinuationEnvelope = {
      ...base,
      crossApp: {
        callerNodeId: 'n',
        targetAppId: 't',
        operation: 'o',
        originatingRequestId: 'req-1',
        targetDecisionId: 'd',
        phase: 'completed',
        calleeOutput: { pr_url: 'x', effort: 'S' },
      },
    };
    const failed: ContinuationEnvelope = {
      ...base,
      crossApp: {
        callerNodeId: 'n',
        targetAppId: 't',
        operation: 'o',
        originatingRequestId: 'req-1',
        targetDecisionId: 'd',
        phase: 'failed',
        failureReason: 'target 5xx',
      },
    };
    assert.equal(JSON.parse(JSON.stringify(completed)).crossApp.phase, 'completed');
    assert.equal(JSON.parse(JSON.stringify(failed)).crossApp.phase, 'failed');
  });
});
