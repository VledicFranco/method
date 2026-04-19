// SPDX-License-Identifier: Apache-2.0
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { EpisodicEntry, SemanticEntry } from '@methodts/pacta';
import { DualStoreBuilder, dualStoreBuilder } from './cognitive-builders.js';

// ── DualStoreBuilder ──────────────────────────────────────────

describe('DualStoreBuilder', () => {
  it('produces a valid MemoryPortV3 with defaults', async () => {
    const store = dualStoreBuilder().build();

    // All MemoryPortV3 methods should exist
    assert.equal(typeof store.store, 'function');
    assert.equal(typeof store.retrieve, 'function');
    assert.equal(typeof store.storeEpisodic, 'function');
    assert.equal(typeof store.retrieveEpisodic, 'function');
    assert.equal(typeof store.storeSemantic, 'function');
    assert.equal(typeof store.retrieveSemantic, 'function');
    assert.equal(typeof store.searchByActivation, 'function');
    assert.equal(typeof store.consolidate, 'function');
    assert.equal(typeof store.allEpisodic, 'function');
    assert.equal(typeof store.allSemantic, 'function');
    assert.equal(typeof store.updateSemantic, 'function');
    assert.equal(typeof store.expireSemantic, 'function');
    assert.equal(typeof store.expireEpisodic, 'function');

    // Starts empty
    const episodic = await store.allEpisodic();
    const semantic = await store.allSemantic();
    assert.equal(episodic.length, 0);
    assert.equal(semantic.length, 0);
  });

  it('seeds episodic entries that are retrievable', async () => {
    const store = dualStoreBuilder()
      .withEpisodicEntry({ id: 'e1', content: 'observed pattern X' })
      .withEpisodicEntry({ id: 'e2', content: 'observed pattern Y', context: ['debug'] })
      .build();

    const all = await store.allEpisodic();
    assert.equal(all.length, 2);

    const e1 = await store.retrieveEpisodic('e1');
    assert.ok(e1, 'e1 should be retrievable');
    assert.equal(e1.content, 'observed pattern X');
    assert.deepEqual(e1.context, []);  // default context

    const e2 = await store.retrieveEpisodic('e2');
    assert.ok(e2, 'e2 should be retrievable');
    assert.equal(e2.content, 'observed pattern Y');
    assert.deepEqual(e2.context, ['debug']);
  });

  it('seeds semantic entries that are retrievable', async () => {
    const store = dualStoreBuilder()
      .withSemanticEntry({ id: 's1', pattern: 'X implies Y', tags: ['causal'] })
      .withSemanticEntry({ id: 's2', pattern: 'A correlates B' })
      .build();

    const all = await store.allSemantic();
    assert.equal(all.length, 2);

    const s1 = await store.retrieveSemantic('s1');
    assert.ok(s1, 's1 should be retrievable');
    assert.equal(s1.pattern, 'X implies Y');
    assert.deepEqual(s1.tags, ['causal']);
    assert.equal(s1.confidence, 0.5);  // default confidence

    const s2 = await store.retrieveSemantic('s2');
    assert.ok(s2, 's2 should be retrievable');
    assert.equal(s2.pattern, 'A correlates B');
  });

  it('fills in default values for episodic entries', async () => {
    const store = dualStoreBuilder()
      .withEpisodicEntry({ id: 'e1', content: 'test' })
      .build();

    const entries = await store.allEpisodic();
    const entry = entries[0];

    assert.equal(entry.id, 'e1');
    assert.equal(entry.content, 'test');
    assert.deepEqual(entry.context, []);
    assert.equal(typeof entry.timestamp, 'number');
    assert.ok(entry.timestamp > 0, 'timestamp should be positive');
    assert.equal(entry.accessCount, 1);
    assert.equal(typeof entry.lastAccessed, 'number');
    assert.ok(entry.lastAccessed > 0, 'lastAccessed should be positive');
  });

  it('fills in default values for semantic entries', async () => {
    const store = dualStoreBuilder()
      .withSemanticEntry({ id: 's1', pattern: 'test' })
      .build();

    const entries = await store.allSemantic();
    const entry = entries[0];

    assert.equal(entry.id, 's1');
    assert.equal(entry.pattern, 'test');
    assert.deepEqual(entry.sourceEpisodes, []);
    assert.equal(entry.confidence, 0.5);
    assert.equal(entry.activationBase, 0);
    assert.deepEqual(entry.tags, []);
    assert.equal(typeof entry.created, 'number');
    assert.equal(typeof entry.updated, 'number');
  });

  it('applies config overrides', async () => {
    const store = dualStoreBuilder()
      .withEpisodicCapacity(3)
      .build();

    // Store 4 episodes — capacity is 3, so first should be evicted (FIFO)
    for (let i = 0; i < 4; i++) {
      await store.storeEpisodic({
        id: `e${i}`,
        content: `episode ${i}`,
        context: [],
        timestamp: Date.now(),
        accessCount: 1,
        lastAccessed: Date.now(),
      });
    }

    const all = await store.allEpisodic();
    assert.equal(all.length, 3);
    // e0 should have been evicted
    const e0 = await store.retrieveEpisodic('e0');
    assert.equal(e0, null, 'e0 should have been evicted');
  });

  it('legacy store/retrieve works', async () => {
    const store = dualStoreBuilder().build();

    await store.store('key1', 'value1');
    const result = await store.retrieve('key1');
    assert.equal(result, 'value1');

    const missing = await store.retrieve('nonexistent');
    assert.equal(missing, null);
  });

  it('consolidation stub returns zero-value result', async () => {
    const store = dualStoreBuilder().build();

    const result = await store.consolidate({
      onlineDepth: 'shallow',
      offlineReplayCount: 20,
      offlineInterleaveRatio: 0.6,
      pruningThreshold: -1.0,
    });

    assert.equal(result.semanticUpdates, 0);
    assert.equal(result.conflictsDetected, 0);
    assert.equal(result.compressionRatio, 0);
    assert.equal(result.entriesPruned, 0);
    assert.equal(result.episodesReplayed, 0);
    assert.equal(result.durationMs, 0);
  });

  it('searchByActivation returns entries above threshold', async () => {
    const store = dualStoreBuilder()
      .withRetrievalThreshold(-10)  // Very permissive threshold
      .withNoiseAmplitude(0)         // No noise for deterministic test
      .withEpisodicEntry({ id: 'e1', content: 'test', context: ['ctx1'] })
      .withSemanticEntry({ id: 's1', pattern: 'test pattern', tags: ['ctx1'] })
      .build();

    const results = await store.searchByActivation(['ctx1'], 10);
    assert.ok(results.length >= 1, 'should find at least one entry');
  });

  it('returns this from all builder methods (fluent API)', () => {
    const builder = new DualStoreBuilder();
    const b1 = builder.withEpisodicCapacity(10);
    const b2 = b1.withSemanticCapacity(100);
    const b3 = b2.withReplayBatchSize(5);
    const b4 = b3.withInterleaveRatio(0.5);
    const b5 = b4.withSchemaConsistencyThreshold(0.7);
    const b6 = b5.withRetrievalThreshold(-1);
    const b7 = b6.withSpreadingWeight(0.5);
    const b8 = b7.withNoiseAmplitude(0.2);
    const b9 = b8.withMaxRetrievals(10);
    const b10 = b9.withEpisodicEntry({ id: 'e1', content: 'test' });
    const b11 = b10.withSemanticEntry({ id: 's1', pattern: 'test' });

    // All should be the same builder instance
    assert.equal(b1, builder);
    assert.equal(b2, builder);
    assert.equal(b3, builder);
    assert.equal(b4, builder);
    assert.equal(b5, builder);
    assert.equal(b6, builder);
    assert.equal(b7, builder);
    assert.equal(b8, builder);
    assert.equal(b9, builder);
    assert.equal(b10, builder);
    assert.equal(b11, builder);
  });
});
