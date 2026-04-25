// SPDX-License-Identifier: Apache-2.0
/**
 * Unit tests for FeatureTierRouter — PRD 057 Wave 3.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  FeatureTierRouter,
  keywordMatch,
  lengthAbove,
  type FeatureRule,
} from './feature-tier-router.js';
import type { Pact, AgentRequest } from '../../pact.js';

const pact = {} as Pact<unknown>;

describe('FeatureTierRouter', () => {
  it('returns the first matching rule (rule order wins)', async () => {
    const rules: FeatureRule[] = [
      { name: 'r1', match: () => true, tier: 'first' },
      { name: 'r2', match: () => true, tier: 'second' },
    ];
    const router = new FeatureTierRouter({ rules, defaultTier: 'd' });
    const tier = await router.select(pact, { prompt: 'whatever' });
    assert.equal(tier, 'first');
  });

  it('skips non-matching rules and uses the first that fires', async () => {
    const rules: FeatureRule[] = [
      { name: 'r1', match: () => false, tier: 'first' },
      { name: 'r2', match: () => false, tier: 'second' },
      { name: 'r3', match: () => true, tier: 'third' },
    ];
    const router = new FeatureTierRouter({ rules, defaultTier: 'd' });
    assert.equal(await router.select(pact, { prompt: 'x' }), 'third');
  });

  it('falls back to defaultTier when no rule matches', async () => {
    const rules: FeatureRule[] = [
      { name: 'r1', match: () => false, tier: 'first' },
    ];
    const router = new FeatureTierRouter({ rules, defaultTier: 'fallback' });
    assert.equal(await router.select(pact, { prompt: 'x' }), 'fallback');
  });

  it('falls back to defaultTier when no rules are configured', async () => {
    const router = new FeatureTierRouter({ rules: [], defaultTier: 'fallback' });
    assert.equal(await router.select(pact, { prompt: 'x' }), 'fallback');
  });

  it('passes the request and pact to match()', async () => {
    let receivedReq: AgentRequest | undefined;
    let receivedPact: Pact<unknown> | undefined;
    const rules: FeatureRule[] = [
      {
        name: 'spy',
        match: (req, p) => {
          receivedReq = req;
          receivedPact = p;
          return true;
        },
        tier: 'spy-tier',
      },
    ];
    const router = new FeatureTierRouter({ rules, defaultTier: 'd' });
    const req: AgentRequest = { prompt: 'hello' };
    await router.select(pact, req);
    assert.equal(receivedReq, req);
    assert.equal(receivedPact, pact);
  });
});

describe('keywordMatch helper', () => {
  it('fires when a keyword appears in the prompt (case-insensitive)', () => {
    const m = keywordMatch(['SECURITY']);
    assert.equal(m({ prompt: 'this is a security audit' }), true);
  });

  it('fires when a keyword appears in the systemPrompt', () => {
    const m = keywordMatch(['urgent']);
    assert.equal(
      m({ prompt: 'noop', systemPrompt: 'tag: URGENT priority' }),
      true,
    );
  });

  it('returns false when no keyword matches', () => {
    const m = keywordMatch(['alpha', 'beta']);
    assert.equal(m({ prompt: 'gamma delta' }), false);
  });

  it('handles empty keyword list as never matching', () => {
    const m = keywordMatch([]);
    assert.equal(m({ prompt: 'anything' }), false);
  });
});

describe('lengthAbove helper', () => {
  it('returns true when prompt length exceeds threshold', () => {
    const m = lengthAbove(5);
    assert.equal(m({ prompt: 'abcdef' }), true);
  });

  it('returns false when prompt length equals threshold', () => {
    const m = lengthAbove(5);
    assert.equal(m({ prompt: 'abcde' }), false);
  });

  it('returns false when prompt length is below threshold', () => {
    const m = lengthAbove(10);
    assert.equal(m({ prompt: 'short' }), false);
  });
});
