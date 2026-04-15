/**
 * Unit tests for the opaque Resumption codec — PRD-058 §6.4 D4 + §4 criterion 9.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  createResumption,
  isResumptionLive,
  parseResumption,
  type ResumptionPayload,
} from './resumption.js';
import { UnknownSessionError } from './errors.js';

describe('Resumption codec', () => {
  it('round-trips a payload', () => {
    const payload: ResumptionPayload = {
      v: 1,
      sessionId: 'abc-123',
      checkpointRef: 'ckpt-42',
      budgetRef: 'budget-7',
      storeNamespace: 'agent/demo',
    };
    const resumption = createResumption(payload, 60_000);
    assert.strictEqual(resumption.sessionId, 'abc-123');
    assert.ok(typeof resumption.opaque === 'string' && resumption.opaque.length > 0);
    assert.ok(resumption.expiresAt > Date.now());

    const recovered = parseResumption(resumption);
    assert.deepStrictEqual(recovered, payload);
  });

  it('opaque token is NOT valid JSON at the boundary', () => {
    const resumption = createResumption(
      { v: 1, sessionId: 's1' } as ResumptionPayload,
    );
    // Base64url-encoded payload must not parse directly.
    assert.throws(() => JSON.parse(resumption.opaque));
  });

  it('parseResumption throws UnknownSessionError on tampered sessionId', () => {
    const resumption = createResumption({ v: 1, sessionId: 'real-s' });
    const tampered = { ...resumption, sessionId: 'different' };
    assert.throws(() => parseResumption(tampered), UnknownSessionError);
  });

  it('parseResumption throws on bad base64', () => {
    assert.throws(
      () =>
        parseResumption({
          sessionId: 'x',
          opaque: 'not-base64!!',
          expiresAt: Date.now() + 1000,
        }),
      UnknownSessionError,
    );
  });

  it('isResumptionLive respects expiration', () => {
    const expired: ReturnType<typeof createResumption> = {
      sessionId: 's',
      opaque: 'x',
      expiresAt: Date.now() - 1000,
    };
    assert.strictEqual(isResumptionLive(expired), false);
    const live = createResumption({ v: 1, sessionId: 's2' }, 60_000);
    assert.strictEqual(isResumptionLive(live), true);
  });
});
