// SPDX-License-Identifier: Apache-2.0
/**
 * Unit tests for the Sleep API (PRD 036 C-5).
 *
 * Verifies that triggerSleep wraps consolidateOffline correctly,
 * applies defaults, respects parameter overrides, and is idempotent.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import type {
  DualStoreConfig,
  ActivationConfig,
  EpisodicEntry,
  SemanticEntry,
} from '../../../ports/memory-port.js';
import { defaultActivationConfig } from '../activation.js';
import { createInMemoryDualStore } from '../in-memory-dual-store.js';
import { triggerSleep } from '../sleep-api.js';

// ── Test Helpers ─────────────────────────────────────────────────

function defaultDualStoreConfig(): DualStoreConfig {
  return {
    episodic: { capacity: 50, encoding: 'verbatim' },
    semantic: { capacity: 500, encoding: 'extracted', updateRate: 'slow' },
    consolidation: {
      replayBatchSize: 5,
      interleaveRatio: 0.6,
      schemaConsistencyThreshold: 0.8,
    },
  };
}

function makeEpisodicEntry(overrides?: Partial<EpisodicEntry>): EpisodicEntry {
  const now = Date.now();
  return {
    id: `ep-${Math.random().toString(36).slice(2, 8)}`,
    content: 'Test episodic entry content',
    context: ['testing', 'sleep-api'],
    timestamp: now,
    accessCount: 1,
    lastAccessed: now,
    ...overrides,
  };
}

function makeSemanticEntry(overrides?: Partial<SemanticEntry>): SemanticEntry {
  const now = Date.now();
  return {
    id: `sem-${Math.random().toString(36).slice(2, 8)}`,
    pattern: 'Test semantic pattern',
    sourceEpisodes: ['ep-1'],
    confidence: 0.8,
    activationBase: 0.5,
    tags: ['testing', 'sleep-api'],
    created: now,
    updated: now,
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────

describe('Sleep API (PRD 036 C-5)', () => {

  it('1. Sleep API triggers offline consolidation and returns ConsolidationResult', async () => {
    const actConfig = defaultActivationConfig();
    const store = createInMemoryDualStore(defaultDualStoreConfig(), actConfig);

    const now = Date.now();

    // Seed a semantic entry for schema consistency matching
    await store.storeSemantic(makeSemanticEntry({
      id: 'sem-existing',
      tags: ['testing', 'sleep-api'],
      confidence: 0.6,
    }));

    // Populate episodic store with matching episodes
    for (let i = 0; i < 5; i++) {
      await store.storeEpisodic(makeEpisodicEntry({
        id: `ep-${i}`,
        context: ['testing', 'sleep-api'],
        timestamp: now - i * 100,
      }));
    }

    const result = await triggerSleep(store);

    // Verify ConsolidationResult shape
    assert.strictEqual(typeof result.semanticUpdates, 'number', 'semanticUpdates should be a number');
    assert.strictEqual(typeof result.conflictsDetected, 'number', 'conflictsDetected should be a number');
    assert.strictEqual(typeof result.compressionRatio, 'number', 'compressionRatio should be a number');
    assert.strictEqual(typeof result.entriesPruned, 'number', 'entriesPruned should be a number');
    assert.strictEqual(typeof result.episodesReplayed, 'number', 'episodesReplayed should be a number');
    assert.strictEqual(typeof result.durationMs, 'number', 'durationMs should be a number');

    // Should have replayed episodes
    assert.ok(result.episodesReplayed > 0, 'Should replay at least 1 episode');
    assert.ok(result.durationMs >= 0, 'Duration should be non-negative');

    // With matching context tags, episodes should be schema-consistent
    assert.ok(result.semanticUpdates > 0, 'Should have at least one semantic update from matching episodes');
  });

  it('2. Sleep API respects replayCount and interleaveRatio parameters', async () => {
    const actConfig = defaultActivationConfig();
    const store = createInMemoryDualStore(defaultDualStoreConfig(), actConfig);

    const now = Date.now();

    // Populate with 30 episodes
    for (let i = 0; i < 30; i++) {
      await store.storeEpisodic(makeEpisodicEntry({
        id: `ep-${i}`,
        context: ['testing', `batch-${i % 3}`],
        timestamp: now - i * 100,
      }));
    }

    // Test with small replayCount
    const resultSmall = await triggerSleep(store, {
      replayCount: 5,
      interleaveRatio: 0.8,
    });

    assert.ok(
      resultSmall.episodesReplayed <= 5,
      `Should replay at most 5 episodes (replayCount=5), got ${resultSmall.episodesReplayed}`,
    );

    // Test with larger replayCount
    const resultLarge = await triggerSleep(store, {
      replayCount: 25,
      interleaveRatio: 0.4,
    });

    assert.ok(
      resultLarge.episodesReplayed <= 25,
      `Should replay at most 25 episodes (replayCount=25), got ${resultLarge.episodesReplayed}`,
    );

    // The larger replay count should process more episodes (or equal if fewer available)
    assert.ok(
      resultLarge.episodesReplayed >= resultSmall.episodesReplayed,
      'Larger replayCount should process >= episodes than smaller replayCount',
    );
  });

  it('3. Sleep API callable multiple times (idempotent on empty episodic store)', async () => {
    const actConfig = defaultActivationConfig();
    const store = createInMemoryDualStore(defaultDualStoreConfig(), actConfig);

    // First call on empty store
    const result1 = await triggerSleep(store);
    assert.strictEqual(result1.episodesReplayed, 0, 'Empty store should replay 0 episodes');
    assert.strictEqual(result1.semanticUpdates, 0, 'Empty store should have 0 semantic updates');
    assert.strictEqual(result1.conflictsDetected, 0, 'Empty store should have 0 conflicts');

    // Second call — should still be safe
    const result2 = await triggerSleep(store);
    assert.strictEqual(result2.episodesReplayed, 0, 'Second call on empty store should replay 0 episodes');
    assert.strictEqual(result2.semanticUpdates, 0, 'Second call should have 0 semantic updates');

    // Third call after adding one episode
    await store.storeEpisodic(makeEpisodicEntry({
      id: 'ep-late',
      context: ['testing'],
    }));

    const result3 = await triggerSleep(store);
    assert.ok(result3.episodesReplayed >= 1, 'Third call with 1 episode should replay it');

    // Fourth call — the episode is still there (consolidation doesn't remove episodic entries)
    const result4 = await triggerSleep(store);
    assert.ok(result4.episodesReplayed >= 1, 'Fourth call should still replay the existing episode');

    // No errors thrown across all 4 calls — Sleep API is safe to call repeatedly
  });
});
