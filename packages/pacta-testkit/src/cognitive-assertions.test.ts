import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { ConsolidationResult } from '@method/pacta';
import { dualStoreBuilder } from './cognitive-builders.js';
import {
  assertConsolidationResult,
  assertEpisodicStoreContains,
  assertSemanticStoreContains,
  assertActivationAboveThreshold,
} from './cognitive-assertions.js';

// ── assertConsolidationResult ──────────────────────────────────

describe('assertConsolidationResult', () => {
  const baseResult: ConsolidationResult = {
    semanticUpdates: 3,
    conflictsDetected: 1,
    compressionRatio: 0.5,
    entriesPruned: 2,
    episodesReplayed: 10,
    durationMs: 150,
  };

  it('passes on matching result', () => {
    assert.doesNotThrow(() => {
      assertConsolidationResult(baseResult, {
        semanticUpdates: 3,
        conflictsDetected: 1,
      });
    });
  });

  it('passes on exact full match', () => {
    assert.doesNotThrow(() => {
      assertConsolidationResult(baseResult, { ...baseResult });
    });
  });

  it('throws on mismatch', () => {
    assert.throws(
      () => assertConsolidationResult(baseResult, { semanticUpdates: 5 }),
      (err: Error) => {
        assert.ok(
          err.message.includes('semanticUpdates') && err.message.includes('5'),
          `Expected error about semanticUpdates mismatch, got: ${err.message}`,
        );
        return true;
      },
    );
  });

  it('throws on compressionRatio mismatch', () => {
    assert.throws(
      () => assertConsolidationResult(baseResult, { compressionRatio: 0.9 }),
      (err: Error) => {
        assert.ok(err.message.includes('compressionRatio'));
        return true;
      },
    );
  });

  it('passes with empty expected (vacuous truth)', () => {
    assert.doesNotThrow(() => {
      assertConsolidationResult(baseResult, {});
    });
  });
});

// ── assertEpisodicStoreContains ────────────────────────────────

describe('assertEpisodicStoreContains', () => {
  it('finds matching entries', async () => {
    const store = dualStoreBuilder()
      .withEpisodicEntry({ id: 'e1', content: 'found a bug in module X' })
      .withEpisodicEntry({ id: 'e2', content: 'refactored module Y' })
      .build();

    await assert.doesNotReject(
      assertEpisodicStoreContains(store, (e) => e.content.includes('bug')),
    );
  });

  it('throws when no entry matches', async () => {
    const store = dualStoreBuilder()
      .withEpisodicEntry({ id: 'e1', content: 'nothing special' })
      .build();

    await assert.rejects(
      assertEpisodicStoreContains(store, (e) => e.content.includes('bug')),
      (err: Error) => {
        assert.ok(err.message.includes('assertEpisodicStoreContains'));
        assert.ok(err.message.includes('1 entries'));
        return true;
      },
    );
  });

  it('throws with custom message', async () => {
    const store = dualStoreBuilder().build();

    await assert.rejects(
      assertEpisodicStoreContains(store, () => true, 'custom error message'),
      (err: Error) => {
        assert.equal(err.message, 'custom error message');
        return true;
      },
    );
  });

  it('matches by ID', async () => {
    const store = dualStoreBuilder()
      .withEpisodicEntry({ id: 'target-001', content: 'data' })
      .build();

    await assert.doesNotReject(
      assertEpisodicStoreContains(store, (e) => e.id === 'target-001'),
    );
  });
});

// ── assertSemanticStoreContains ────────────────────────────────

describe('assertSemanticStoreContains', () => {
  it('finds matching entries', async () => {
    const store = dualStoreBuilder()
      .withSemanticEntry({ id: 's1', pattern: 'X implies Y', confidence: 0.9 })
      .build();

    await assert.doesNotReject(
      assertSemanticStoreContains(store, (s) => s.confidence > 0.8),
    );
  });

  it('throws when no entry matches', async () => {
    const store = dualStoreBuilder()
      .withSemanticEntry({ id: 's1', pattern: 'weak', confidence: 0.2 })
      .build();

    await assert.rejects(
      assertSemanticStoreContains(store, (s) => s.confidence > 0.8),
      (err: Error) => {
        assert.ok(err.message.includes('assertSemanticStoreContains'));
        return true;
      },
    );
  });

  it('matches by tag', async () => {
    const store = dualStoreBuilder()
      .withSemanticEntry({ id: 's1', pattern: 'rule', tags: ['causal', 'domain-a'] })
      .build();

    await assert.doesNotReject(
      assertSemanticStoreContains(store, (s) => s.tags.includes('causal')),
    );
  });
});

// ── assertActivationAboveThreshold ─────────────────────────────

describe('assertActivationAboveThreshold', () => {
  it('passes when enough entries are above threshold', async () => {
    const store = dualStoreBuilder()
      .withRetrievalThreshold(-10)  // Very permissive
      .withNoiseAmplitude(0)
      .withEpisodicEntry({ id: 'e1', content: 'a', context: ['ctx'] })
      .withEpisodicEntry({ id: 'e2', content: 'b', context: ['ctx'] })
      .withSemanticEntry({ id: 's1', pattern: 'p', tags: ['ctx'] })
      .build();

    await assert.doesNotReject(
      assertActivationAboveThreshold(store, ['ctx'], 2),
    );
  });

  it('throws when too few entries are above threshold', async () => {
    const store = dualStoreBuilder()
      .withRetrievalThreshold(100)  // Very restrictive — nothing will pass
      .withNoiseAmplitude(0)
      .withEpisodicEntry({ id: 'e1', content: 'a', context: ['ctx'] })
      .build();

    await assert.rejects(
      assertActivationAboveThreshold(store, ['ctx'], 1),
      (err: Error) => {
        assert.ok(err.message.includes('assertActivationAboveThreshold'));
        assert.ok(err.message.includes('at least 1'));
        return true;
      },
    );
  });

  it('uses custom message on failure', async () => {
    const store = dualStoreBuilder()
      .withRetrievalThreshold(100)
      .withNoiseAmplitude(0)
      .build();

    await assert.rejects(
      assertActivationAboveThreshold(store, ['ctx'], 1, 'custom activation msg'),
      (err: Error) => {
        assert.equal(err.message, 'custom activation msg');
        return true;
      },
    );
  });
});
