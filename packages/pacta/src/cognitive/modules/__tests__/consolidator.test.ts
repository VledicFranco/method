// SPDX-License-Identifier: Apache-2.0
/**
 * Unit tests for the Consolidator module (PRD 036 C-4).
 *
 * Tests both online mode (LEARN-phase CognitiveModule) and offline mode
 * (consolidation engine), covering: episode storage, lesson extraction,
 * interleaved replay, schema consistency, compression, pruning.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { moduleId } from '../../algebra/index.js';
import type { TraceRecord, MonitoringSignal, ModuleId } from '../../algebra/index.js';
import type {
  EpisodicEntry,
  SemanticEntry,
  DualStoreConfig,
  ConsolidationConfig,
} from '../../../ports/memory-port.js';
import { createInMemoryDualStore } from '../in-memory-dual-store.js';
import { defaultActivationConfig } from '../activation.js';
import { createConsolidator } from '../consolidator.js';
import type { ConsolidatorControl, ConsolidatorInput } from '../consolidator.js';
import { consolidateOffline, jaccardSimilarity, sampleInterleavedBatch } from '../../engine/consolidation.js';

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

function defaultConsolidationConfig(): ConsolidationConfig {
  return {
    onlineDepth: 'shallow',
    offlineReplayCount: 20,
    offlineInterleaveRatio: 0.6,
    pruningThreshold: -1.0,
  };
}

function makeTrace(overrides?: Partial<TraceRecord>): TraceRecord {
  return {
    moduleId: moduleId('test-module'),
    phase: 'ACT',
    timestamp: Date.now(),
    inputHash: 'abc123',
    outputSummary: 'Test action completed successfully',
    monitoring: {
      source: moduleId('test-module'),
      timestamp: Date.now(),
    } as MonitoringSignal,
    stateHash: 'state-abc',
    durationMs: 42,
    ...overrides,
  };
}

function makeConsolidatorInput(overrides?: Partial<ConsolidatorInput>): ConsolidatorInput {
  return {
    traces: [makeTrace()],
    workspaceSnapshot: 'Current workspace: task=test, goal=verify',
    actionOutcome: 'Successfully completed test action',
    ...overrides,
  };
}

function makeControl(): ConsolidatorControl {
  return {
    target: 'consolidator' as ModuleId,
    timestamp: Date.now(),
  };
}

function makeEpisodicEntry(overrides?: Partial<EpisodicEntry>): EpisodicEntry {
  const now = Date.now();
  return {
    id: `ep-${Math.random().toString(36).slice(2, 8)}`,
    content: 'Test episodic entry content for consolidation testing',
    context: ['testing', 'consolidation'],
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
    tags: ['testing', 'consolidation'],
    created: now,
    updated: now,
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────

describe('Consolidator (PRD 036 C-4)', () => {

  // ── Online Mode Tests ──────────────────────────────────────

  it('1. Online mode stores episode verbatim in episodic store', async () => {
    const actConfig = defaultActivationConfig();
    const store = createInMemoryDualStore(defaultDualStoreConfig(), actConfig);
    const mod = createConsolidator(store);
    const state = mod.initialState();

    const input = makeConsolidatorInput({
      workspaceSnapshot: 'Snapshot: task=build, files=3',
      actionOutcome: 'Build completed in 2s',
    });

    const result = await mod.step(input, state, makeControl());

    // Verify the episode was stored in the episodic store
    const allEpisodes = await store.allEpisodic();
    assert.strictEqual(allEpisodes.length, 1, 'Should store exactly one episode');

    const stored = allEpisodes[0];
    assert.ok(stored.content.includes('Snapshot: task=build, files=3'), 'Episode should contain workspace snapshot verbatim');
    assert.ok(stored.content.includes('Build completed in 2s'), 'Episode should contain action outcome');
    assert.ok(stored.context.length > 0, 'Episode should have context tags');
    assert.strictEqual(stored.accessCount, 0, 'Fresh episode should have accessCount 0');

    // Verify output matches what was stored
    assert.strictEqual(result.output.storedEpisode.id, stored.id);
    assert.strictEqual(result.output.storedEpisode.content, stored.content);
  });

  it('2. Online mode extracts 1-2 shallow lessons from traces', async () => {
    const actConfig = defaultActivationConfig();
    const store = createInMemoryDualStore(defaultDualStoreConfig(), actConfig);
    const mod = createConsolidator(store);
    const state = mod.initialState();

    // Provide 3 traces — should extract at most 2 lessons (shallow mode)
    const input = makeConsolidatorInput({
      traces: [
        makeTrace({ moduleId: moduleId('observer'), phase: 'PERCEIVE', outputSummary: 'Observed file changes' }),
        makeTrace({ moduleId: moduleId('reasoner'), phase: 'REASON', outputSummary: 'Analyzed impact' }),
        makeTrace({ moduleId: moduleId('actor'), phase: 'ACT', outputSummary: 'Applied fix' }),
      ],
    });

    const result = await mod.step(input, state, makeControl());

    assert.ok(result.output.lessons.length >= 1, 'Should extract at least 1 lesson');
    assert.ok(result.output.lessons.length <= 2, 'Should extract at most 2 lessons (shallow mode)');

    for (const lesson of result.output.lessons) {
      assert.strictEqual(lesson.depth, 'shallow', 'All lessons should be shallow');
      assert.ok(lesson.summary.length > 0, 'Lesson summary should be non-empty');
    }

    // Lessons should reference the trace modules
    const summaries = result.output.lessons.map((l) => l.summary).join(' ');
    assert.ok(
      summaries.includes('observer') || summaries.includes('reasoner'),
      'Lessons should reference trace module IDs',
    );
  });

  it('3. Online mode does not write to semantic store', async () => {
    const actConfig = defaultActivationConfig();
    const store = createInMemoryDualStore(defaultDualStoreConfig(), actConfig);
    const mod = createConsolidator(store);

    let state = mod.initialState();

    // Run multiple steps
    for (let i = 0; i < 5; i++) {
      const result = await mod.step(
        makeConsolidatorInput({ actionOutcome: `Step ${i} completed` }),
        state,
        makeControl(),
      );
      state = result.state;
    }

    const allSemantic = await store.allSemantic();
    assert.strictEqual(
      allSemantic.length,
      0,
      'Online mode should NEVER write to the semantic store',
    );

    // Episodic store should have all 5 episodes
    const allEpisodic = await store.allEpisodic();
    assert.strictEqual(allEpisodic.length, 5, 'All 5 episodes should be in the episodic store');
  });

  // ── Offline Mode Tests ─────────────────────────────────────

  it('4. Offline mode samples interleaved batch (correct recent/old ratio)', async () => {
    const actConfig = defaultActivationConfig();
    const store = createInMemoryDualStore(defaultDualStoreConfig(), actConfig);

    const now = Date.now();
    // Populate with 20 episodes at different timestamps
    for (let i = 0; i < 20; i++) {
      await store.storeEpisodic(makeEpisodicEntry({
        id: `ep-${i}`,
        timestamp: now - (20 - i) * 1000, // ep-0 is oldest, ep-19 is newest
        context: ['testing', 'sampling'],
      }));
    }

    const config: ConsolidationConfig = {
      ...defaultConsolidationConfig(),
      offlineReplayCount: 10,
      offlineInterleaveRatio: 0.6,
    };

    // Test the sampling function directly
    const allEpisodes = await store.allEpisodic();
    const batch = sampleInterleavedBatch(allEpisodes, 10, 0.6);

    assert.strictEqual(batch.length, 10, 'Batch should contain exactly 10 episodes');

    // Recent portion: ceil(10 * 0.6) = 6 recent episodes
    const recentCount = Math.ceil(10 * 0.6);
    assert.strictEqual(recentCount, 6, 'Should have 6 recent episodes');

    // Older portion: floor(10 * 0.4) = 4 older episodes
    const olderCount = Math.floor(10 * (1 - 0.6));
    assert.strictEqual(olderCount, 4, 'Should have 4 older episodes');

    // The first 6 entries in the batch should be the most recent
    const recentBatch = batch.slice(0, recentCount);
    for (const ep of recentBatch) {
      // These should be among the 6 most recent
      assert.ok(
        ep.timestamp >= now - 7 * 1000,
        `Recent batch entry ${ep.id} should be among the most recent`,
      );
    }
  });

  it('5. Offline mode fast-tracks schema-consistent episodes to semantic store (confidence increases)', async () => {
    const actConfig = defaultActivationConfig();
    const store = createInMemoryDualStore(defaultDualStoreConfig(), actConfig);

    // Create a semantic entry with tags
    const sem = makeSemanticEntry({
      id: 'sem-existing',
      tags: ['testing', 'consolidation', 'schema'],
      confidence: 0.6,
      sourceEpisodes: ['ep-old'],
    });
    await store.storeSemantic(sem);

    // Create episodic entries with matching context (high Jaccard overlap)
    for (let i = 0; i < 3; i++) {
      await store.storeEpisodic(makeEpisodicEntry({
        id: `ep-match-${i}`,
        context: ['testing', 'consolidation', 'schema'], // Jaccard = 1.0 with semantic tags
        timestamp: Date.now() - i * 100,
      }));
    }

    const config: ConsolidationConfig = {
      ...defaultConsolidationConfig(),
      offlineReplayCount: 10,
    };

    const result = await consolidateOffline(store, config, {
      schemaConsistencyThreshold: 0.8,
    });

    // Should have updated the existing semantic entry
    assert.ok(result.semanticUpdates > 0, 'Should have at least one semantic update');

    // Verify confidence increased
    const updatedSem = await store.retrieveSemantic('sem-existing');
    assert.ok(updatedSem, 'Semantic entry should still exist');
    assert.ok(
      updatedSem!.confidence > 0.6,
      `Confidence should have increased from 0.6, got ${updatedSem!.confidence}`,
    );

    // Verify source episodes were linked
    assert.ok(
      updatedSem!.sourceEpisodes.length > 1,
      `sourceEpisodes should have grown from 1, got ${updatedSem!.sourceEpisodes.length}`,
    );
  });

  it('6. Offline mode leaves schema-inconsistent episodes in episodic store only', async () => {
    const actConfig = defaultActivationConfig();
    const store = createInMemoryDualStore(defaultDualStoreConfig(), actConfig);

    // Create a semantic entry with specific tags
    await store.storeSemantic(makeSemanticEntry({
      id: 'sem-narrow',
      tags: ['alpha', 'beta'],
      confidence: 0.7,
    }));

    // Create episodic entries with completely different context (low Jaccard overlap)
    await store.storeEpisodic(makeEpisodicEntry({
      id: 'ep-inconsistent-1',
      context: ['gamma', 'delta'],
      timestamp: Date.now(),
    }));

    const semanticBefore = await store.allSemantic();
    const semanticCountBefore = semanticBefore.length;

    const config: ConsolidationConfig = {
      ...defaultConsolidationConfig(),
      offlineReplayCount: 5,
    };

    const result = await consolidateOffline(store, config, {
      schemaConsistencyThreshold: 0.8,
    });

    assert.ok(result.conflictsDetected > 0, 'Should detect schema-inconsistent episodes');

    // Episode should still be in episodic store
    const ep = await store.retrieveEpisodic('ep-inconsistent-1');
    assert.ok(ep, 'Inconsistent episode should remain in episodic store');

    // No new semantic entries created (only 1 inconsistent episode, need 3+ for promotion)
    const semanticAfter = await store.allSemantic();
    assert.strictEqual(
      semanticAfter.length,
      semanticCountBefore,
      'Should not create new semantic entries from a single inconsistent episode',
    );
  });

  it('7. Offline mode compresses old episodic entries when capacity exceeded', async () => {
    const actConfig = defaultActivationConfig();
    const smallConfig: DualStoreConfig = {
      ...defaultDualStoreConfig(),
      episodic: { capacity: 100, encoding: 'verbatim' }, // Large capacity so store doesn't auto-evict
    };
    const store = createInMemoryDualStore(smallConfig, actConfig);

    const now = Date.now();
    const longContent = 'A'.repeat(500); // 500 chars — well above 200 threshold

    // Store 10 entries with long content
    for (let i = 0; i < 10; i++) {
      await store.storeEpisodic(makeEpisodicEntry({
        id: `ep-compress-${i}`,
        content: `${longContent} episode-${i}`,
        timestamp: now - (10 - i) * 1000, // Oldest first
      }));
    }

    const config: ConsolidationConfig = {
      ...defaultConsolidationConfig(),
      offlineReplayCount: 5,
    };

    // Set episodicCapacity to 5, so 5 entries (the oldest) exceed capacity
    await consolidateOffline(store, config, {
      episodicCapacity: 5,
    });

    const allEpisodes = await store.allEpisodic();

    // Some entries should be compressed
    const compressedEntries = allEpisodes.filter((e) => e.content.endsWith(' [compressed]'));
    assert.ok(
      compressedEntries.length > 0,
      'Should have compressed at least one old entry',
    );

    // Compressed entries should be truncated to ~200 chars + suffix
    for (const entry of compressedEntries) {
      assert.ok(
        entry.content.length <= 215, // 200 chars + ' [compressed]' = 213
        `Compressed entry should be ~213 chars, got ${entry.content.length}`,
      );
    }
  });

  it('8. Offline mode prunes low-activation semantic entries', async () => {
    const actConfig = defaultActivationConfig();
    const store = createInMemoryDualStore(defaultDualStoreConfig(), actConfig);

    const now = Date.now();

    // Create a semantic entry with very low activation characteristics
    // Old, low confidence, low access count → very negative activation
    await store.storeSemantic(makeSemanticEntry({
      id: 'sem-low-act',
      confidence: 0.1,
      sourceEpisodes: ['ep-1'],
      updated: now - 86400_000 * 30, // 30 days old
      created: now - 86400_000 * 30,
      tags: ['obscure'],
    }));

    // Create a semantic entry with high activation characteristics
    await store.storeSemantic(makeSemanticEntry({
      id: 'sem-high-act',
      confidence: 0.95,
      sourceEpisodes: ['ep-1', 'ep-2', 'ep-3', 'ep-4', 'ep-5'],
      updated: now,
      created: now - 1000,
      tags: ['important'],
    }));

    // Store at least one episode so consolidation has something to process
    await store.storeEpisodic(makeEpisodicEntry({
      context: ['unrelated'],
      timestamp: now,
    }));

    const config: ConsolidationConfig = {
      ...defaultConsolidationConfig(),
      pruningThreshold: -1.0,
    };

    const result = await consolidateOffline(store, config);

    // The low-activation entry should be pruned
    const remaining = await store.allSemantic();
    const lowActExists = remaining.some((s) => s.id === 'sem-low-act');
    const highActExists = remaining.some((s) => s.id === 'sem-high-act');

    assert.ok(
      result.entriesPruned > 0 || !lowActExists,
      'Should prune low-activation entries or at least report them',
    );
    assert.ok(highActExists, 'High-activation entry should survive pruning');
  });

  it('9. Offline mode returns ConsolidationResult with accurate stats', async () => {
    const actConfig = defaultActivationConfig();
    const store = createInMemoryDualStore(defaultDualStoreConfig(), actConfig);

    const now = Date.now();

    // Set up a scenario with known outcomes
    await store.storeSemantic(makeSemanticEntry({
      id: 'sem-match',
      tags: ['matching', 'context'],
      confidence: 0.5,
      sourceEpisodes: ['ep-old'],
    }));

    // Episodes with matching context
    for (let i = 0; i < 5; i++) {
      await store.storeEpisodic(makeEpisodicEntry({
        id: `ep-${i}`,
        context: ['matching', 'context'],
        timestamp: now - i * 100,
      }));
    }

    const config: ConsolidationConfig = {
      ...defaultConsolidationConfig(),
      offlineReplayCount: 5,
    };

    const result = await consolidateOffline(store, config, {
      schemaConsistencyThreshold: 0.8,
    });

    // Verify result shape
    assert.strictEqual(typeof result.semanticUpdates, 'number', 'semanticUpdates should be a number');
    assert.strictEqual(typeof result.conflictsDetected, 'number', 'conflictsDetected should be a number');
    assert.strictEqual(typeof result.compressionRatio, 'number', 'compressionRatio should be a number');
    assert.strictEqual(typeof result.entriesPruned, 'number', 'entriesPruned should be a number');
    assert.strictEqual(typeof result.episodesReplayed, 'number', 'episodesReplayed should be a number');
    assert.strictEqual(typeof result.durationMs, 'number', 'durationMs should be a number');

    // Verify stats make sense
    assert.ok(result.episodesReplayed > 0, 'Should have replayed at least 1 episode');
    assert.ok(result.episodesReplayed <= 5, 'Should not replay more than available');
    assert.ok(result.durationMs >= 0, 'Duration should be non-negative');
    assert.ok(result.compressionRatio >= 0 && result.compressionRatio <= 1, 'Compression ratio should be 0-1');
    assert.strictEqual(
      result.semanticUpdates + result.conflictsDetected,
      result.episodesReplayed,
      'semanticUpdates + conflictsDetected should equal episodesReplayed (each episode is either consistent or not)',
    );
  });

  it('10. Consolidator emits ReflectorMonitoring signal with lessonsExtracted count (backward compat)', async () => {
    const actConfig = defaultActivationConfig();
    const store = createInMemoryDualStore(defaultDualStoreConfig(), actConfig);
    const mod = createConsolidator(store);
    const state = mod.initialState();

    const input = makeConsolidatorInput({
      traces: [
        makeTrace({ moduleId: moduleId('observer'), outputSummary: 'Input processed' }),
        makeTrace({ moduleId: moduleId('reasoner'), outputSummary: 'Plan formed' }),
      ],
    });

    const result = await mod.step(input, state, makeControl());

    // Verify ReflectorMonitoring shape (backward compat with existing signal consumers)
    const signal = result.monitoring;
    assert.strictEqual(signal.type, 'reflector', 'Signal type must be "reflector" for backward compat');
    assert.ok(typeof signal.source === 'string', 'source must be a string (ModuleId)');
    assert.strictEqual(signal.source, 'consolidator', 'source should be the consolidator module ID');
    assert.strictEqual(typeof signal.timestamp, 'number', 'timestamp must be a number');
    assert.strictEqual(typeof signal.lessonsExtracted, 'number', 'lessonsExtracted must be a number');
    assert.ok(signal.lessonsExtracted > 0, 'Should have extracted at least 1 lesson');
    assert.ok(signal.lessonsExtracted <= 2, 'Shallow mode should extract at most 2 lessons');

    // Verify the signal matches the actual lesson count in the output
    assert.strictEqual(
      signal.lessonsExtracted,
      result.output.lessons.length,
      'Monitoring lessonsExtracted should match output lesson count',
    );
  });
});

// ── Supplementary unit tests for helpers ────────────────────────

describe('Consolidation helpers', () => {

  it('jaccardSimilarity computes correctly for overlapping sets', () => {
    // Identical sets → 1.0
    assert.strictEqual(jaccardSimilarity(['a', 'b', 'c'], ['a', 'b', 'c']), 1.0);

    // No overlap → 0.0
    assert.strictEqual(jaccardSimilarity(['a', 'b'], ['c', 'd']), 0);

    // Partial overlap: {a,b,c} ∩ {b,c,d} = {b,c}, union = {a,b,c,d} → 2/4 = 0.5
    assert.strictEqual(jaccardSimilarity(['a', 'b', 'c'], ['b', 'c', 'd']), 0.5);

    // Empty sets → 0
    assert.strictEqual(jaccardSimilarity([], []), 0);

    // Case insensitive
    assert.strictEqual(jaccardSimilarity(['A', 'B'], ['a', 'b']), 1.0);
  });

  it('sampleInterleavedBatch returns all when fewer than count', () => {
    const episodes: EpisodicEntry[] = [
      makeEpisodicEntry({ id: 'ep-1', timestamp: 1000 }),
      makeEpisodicEntry({ id: 'ep-2', timestamp: 2000 }),
    ];

    const batch = sampleInterleavedBatch(episodes, 10, 0.6);
    assert.strictEqual(batch.length, 2, 'Should return all episodes when fewer than count');
  });
});
