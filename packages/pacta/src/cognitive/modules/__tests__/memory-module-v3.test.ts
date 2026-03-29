import { describe, it } from 'node:test';
import assert from 'node:assert';
import { createMemoryV3 } from '../memory-module-v3.js';
import type { MemoryV3Control } from '../memory-module-v3.js';
import { createInMemoryDualStore } from '../in-memory-dual-store.js';
import { defaultActivationConfig } from '../activation.js';
import type {
  WorkspaceWritePort,
  WorkspaceEntry,
  ModuleId,
  ReadonlyWorkspaceSnapshot,
} from '../../algebra/index.js';
import { moduleId } from '../../algebra/index.js';
import type {
  MemoryPortV3,
  EpisodicEntry,
  SemanticEntry,
  DualStoreConfig,
  ActivationConfig,
} from '../../../ports/memory-port.js';

// ── Test Helpers ─────────────────────────────────────────────────

function createMockWritePort(): WorkspaceWritePort & { entries: WorkspaceEntry[] } {
  const entries: WorkspaceEntry[] = [];
  return {
    entries,
    write(entry: WorkspaceEntry): void {
      entries.push(entry);
    },
  };
}

function makeSnapshot(contents: string[]): ReadonlyWorkspaceSnapshot {
  return contents.map((content, i) => ({
    source: moduleId('test'),
    content,
    salience: 0.5,
    timestamp: Date.now() - i * 100,
  }));
}

function makeControl(): MemoryV3Control {
  return {
    target: 'memory-v3' as ModuleId,
    timestamp: Date.now(),
  };
}

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
    context: ['testing', 'memory'],
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
    tags: ['testing', 'memory'],
    created: now,
    updated: now,
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────

describe('Memory Module v3 (CLS Dual-Store)', () => {
  it('1. retrieves from both episodic and semantic stores', async () => {
    const actConfig = defaultActivationConfig();
    const store = createInMemoryDualStore(defaultDualStoreConfig(), actConfig);
    const writePort = createMockWritePort();

    // Populate both stores
    const ep = makeEpisodicEntry({ context: ['testing'] });
    const sem = makeSemanticEntry({ tags: ['testing'] });
    await store.storeEpisodic(ep);
    await store.storeSemantic(sem);

    const mod = createMemoryV3(store, writePort, actConfig);
    const state = mod.initialState();
    const result = await mod.step(
      { snapshot: makeSnapshot(['testing memory retrieval']) },
      state,
      makeControl(),
    );

    // Should retrieve from both stores
    assert.ok(result.output.count > 0, 'Should retrieve at least one entry');
    const hasEpisodic = result.output.retrieved.some((e) => 'content' in e && 'accessCount' in e);
    const hasSemantic = result.output.retrieved.some((e) => 'pattern' in e && 'confidence' in e);
    assert.ok(hasEpisodic, 'Should retrieve episodic entries');
    assert.ok(hasSemantic, 'Should retrieve semantic entries');
  });

  it('2. episodic entries sorted by recency + context activation', async () => {
    const actConfig = defaultActivationConfig();
    const store = createInMemoryDualStore(defaultDualStoreConfig(), actConfig);
    const writePort = createMockWritePort();

    // Store two episodic entries: one recent with context overlap, one old without
    const now = Date.now();
    const recentRelevant = makeEpisodicEntry({
      id: 'ep-recent',
      content: 'Recent relevant episode',
      context: ['testing', 'retrieval'],
      timestamp: now,
      lastAccessed: now,
      accessCount: 3,
    });
    const oldIrrelevant = makeEpisodicEntry({
      id: 'ep-old',
      content: 'Old irrelevant episode',
      context: ['unrelated', 'other'],
      timestamp: now - 600_000, // 10 minutes old
      lastAccessed: now - 600_000,
      accessCount: 1,
    });

    await store.storeEpisodic(recentRelevant);
    await store.storeEpisodic(oldIrrelevant);

    const mod = createMemoryV3(store, writePort, actConfig);
    const result = await mod.step(
      { snapshot: makeSnapshot(['testing retrieval mechanism']) },
      mod.initialState(),
      makeControl(),
    );

    // At least the recent relevant one should be retrieved
    assert.ok(result.output.count >= 1, 'Should retrieve at least one entry');

    // If both are retrieved, recent+relevant should come first
    if (result.output.count >= 2) {
      const first = result.output.retrieved[0];
      assert.ok('content' in first && 'accessCount' in first, 'First result should be episodic');
      assert.strictEqual((first as EpisodicEntry).id, 'ep-recent', 'Recent relevant should rank first');
    }
  });

  it('3. semantic entries sorted by ACT-R activation', async () => {
    const actConfig = defaultActivationConfig();
    const store = createInMemoryDualStore(defaultDualStoreConfig(), actConfig);
    const writePort = createMockWritePort();

    const now = Date.now();
    const highActivation = makeSemanticEntry({
      id: 'sem-high',
      pattern: 'High activation pattern',
      tags: ['testing', 'memory'],
      confidence: 0.9,
      sourceEpisodes: ['ep-1', 'ep-2', 'ep-3'], // Higher access count proxy
      updated: now,
    });
    const lowActivation = makeSemanticEntry({
      id: 'sem-low',
      pattern: 'Low activation pattern',
      tags: ['unrelated'],
      confidence: 0.3, // Below 0.5 triggers partial match penalty
      sourceEpisodes: ['ep-1'],
      updated: now - 300_000,
    });

    await store.storeSemantic(highActivation);
    await store.storeSemantic(lowActivation);

    const mod = createMemoryV3(store, writePort, actConfig);
    const result = await mod.step(
      { snapshot: makeSnapshot(['testing memory patterns']) },
      mod.initialState(),
      makeControl(),
    );

    // High activation semantic entry should be retrieved
    const semanticResults = result.output.retrieved.filter(
      (e) => 'pattern' in e && 'confidence' in e,
    ) as SemanticEntry[];

    if (semanticResults.length >= 2) {
      assert.strictEqual(
        semanticResults[0].id,
        'sem-high',
        'Higher activation semantic entry should rank first',
      );
    }
  });

  it('4. merged results written to workspace as high-salience entries', async () => {
    const actConfig = defaultActivationConfig();
    const store = createInMemoryDualStore(defaultDualStoreConfig(), actConfig);
    const writePort = createMockWritePort();

    await store.storeEpisodic(makeEpisodicEntry({ context: ['testing'] }));
    await store.storeSemantic(makeSemanticEntry({ tags: ['testing'] }));

    const mod = createMemoryV3(store, writePort, actConfig);
    const result = await mod.step(
      { snapshot: makeSnapshot(['testing workspace writing']) },
      mod.initialState(),
      makeControl(),
    );

    // All retrieved entries should be written to workspace
    assert.strictEqual(
      writePort.entries.length,
      result.output.count,
      'Should write one workspace entry per retrieved memory',
    );

    // All workspace entries should have high salience
    for (const wsEntry of writePort.entries) {
      assert.ok(wsEntry.salience >= 0.8, `Workspace entry salience (${wsEntry.salience}) should be high (>= 0.8)`);
    }

    // Entries should contain episodic or semantic labels
    const hasEpisodicLabel = writePort.entries.some(
      (e) => typeof e.content === 'string' && e.content.includes('[EPISODIC]'),
    );
    const hasSemanticLabel = writePort.entries.some(
      (e) => typeof e.content === 'string' && e.content.includes('[SEMANTIC]'),
    );
    assert.ok(
      hasEpisodicLabel || hasSemanticLabel,
      'Workspace entries should be labeled with store type',
    );
  });

  it('5. respects maxRetrievals limit', async () => {
    const actConfig: ActivationConfig = {
      ...defaultActivationConfig(),
      maxRetrievals: 2,
      retrievalThreshold: -10, // Very low threshold to ensure all entries pass
    };
    const store = createInMemoryDualStore(defaultDualStoreConfig(), actConfig);
    const writePort = createMockWritePort();

    // Store 5 episodic entries
    for (let i = 0; i < 5; i++) {
      await store.storeEpisodic(
        makeEpisodicEntry({
          id: `ep-${i}`,
          context: ['testing'],
          accessCount: 5 - i,
        }),
      );
    }

    const mod = createMemoryV3(store, writePort, actConfig);
    const result = await mod.step(
      { snapshot: makeSnapshot(['testing limit']) },
      mod.initialState(),
      makeControl(),
    );

    assert.ok(
      result.output.count <= 2,
      `Should respect maxRetrievals=2, got ${result.output.count}`,
    );
  });

  it('6. emits MemoryMonitoring signal with retrieval count and relevance', async () => {
    const actConfig = defaultActivationConfig();
    const store = createInMemoryDualStore(defaultDualStoreConfig(), actConfig);
    const writePort = createMockWritePort();

    await store.storeEpisodic(makeEpisodicEntry({ context: ['testing'] }));

    const mod = createMemoryV3(store, writePort, actConfig);
    const result = await mod.step(
      { snapshot: makeSnapshot(['testing monitoring signals']) },
      mod.initialState(),
      makeControl(),
    );

    // Verify MemoryMonitoring shape
    assert.strictEqual(result.monitoring.type, 'memory');
    assert.strictEqual(result.monitoring.source, 'memory-v3');
    assert.strictEqual(typeof result.monitoring.timestamp, 'number');
    assert.strictEqual(typeof result.monitoring.retrievalCount, 'number');
    assert.strictEqual(typeof result.monitoring.relevanceScore, 'number');
    assert.ok(result.monitoring.retrievalCount > 0, 'Should have non-zero retrieval count');
    assert.ok(result.monitoring.relevanceScore >= 0, 'Relevance should be >= 0');
    assert.ok(result.monitoring.relevanceScore <= 1, 'Relevance should be <= 1');
  });

  it('7. episodic store enforces FIFO capacity — oldest evicted first', async () => {
    const actConfig = defaultActivationConfig();
    const smallConfig: DualStoreConfig = {
      ...defaultDualStoreConfig(),
      episodic: { capacity: 3, encoding: 'verbatim' },
    };
    const store = createInMemoryDualStore(smallConfig, actConfig);

    // Store 3 entries (at capacity)
    for (let i = 0; i < 3; i++) {
      await store.storeEpisodic(
        makeEpisodicEntry({ id: `ep-${i}`, content: `Episode ${i}` }),
      );
    }

    // Store a 4th — should evict ep-0 (oldest, FIFO)
    await store.storeEpisodic(
      makeEpisodicEntry({ id: 'ep-3', content: 'Episode 3' }),
    );

    const all = await store.allEpisodic();
    assert.strictEqual(all.length, 3, 'Should enforce capacity of 3');
    assert.ok(
      !all.some((e) => e.id === 'ep-0'),
      'Oldest entry (ep-0) should have been evicted',
    );
    assert.ok(
      all.some((e) => e.id === 'ep-3'),
      'Newest entry (ep-3) should be present',
    );
  });

  it('8. semantic store is never written to directly by MemoryV3', async () => {
    const actConfig = defaultActivationConfig();
    const store = createInMemoryDualStore(defaultDualStoreConfig(), actConfig);
    const writePort = createMockWritePort();

    // Pre-populate stores
    await store.storeEpisodic(makeEpisodicEntry({ context: ['testing'] }));
    const sem = makeSemanticEntry({ tags: ['testing'] });
    await store.storeSemantic(sem);

    const semanticBefore = await store.allSemantic();

    const mod = createMemoryV3(store, writePort, actConfig);
    // Run multiple steps
    let state = mod.initialState();
    for (let i = 0; i < 3; i++) {
      const result = await mod.step(
        { snapshot: makeSnapshot([`step ${i} testing`]) },
        state,
        makeControl(),
      );
      state = result.state;
    }

    const semanticAfter = await store.allSemantic();
    assert.strictEqual(
      semanticAfter.length,
      semanticBefore.length,
      'MemoryV3 should never add entries to the semantic store',
    );

    // Verify no semantic entry was modified (content-wise)
    for (const before of semanticBefore) {
      const after = semanticAfter.find((s) => s.id === before.id);
      assert.ok(after, `Semantic entry ${before.id} should still exist`);
      assert.strictEqual(after!.pattern, before.pattern, 'Semantic pattern should be unchanged');
      assert.strictEqual(after!.confidence, before.confidence, 'Semantic confidence should be unchanged');
    }
  });

  it('9. episodic entry accessCount incremented on retrieval', async () => {
    const actConfig: ActivationConfig = {
      ...defaultActivationConfig(),
      retrievalThreshold: -10, // Ensure retrieval
    };
    const store = createInMemoryDualStore(defaultDualStoreConfig(), actConfig);
    const writePort = createMockWritePort();

    const ep = makeEpisodicEntry({
      id: 'ep-track',
      context: ['testing'],
      accessCount: 1,
    });
    await store.storeEpisodic(ep);

    const mod = createMemoryV3(store, writePort, actConfig);
    await mod.step(
      { snapshot: makeSnapshot(['testing access tracking']) },
      mod.initialState(),
      makeControl(),
    );

    // searchByActivation increments accessCount for returned episodic entries
    const updated = await store.retrieveEpisodic('ep-track');
    assert.ok(updated, 'Entry should still exist');
    // searchByActivation increments by 1, then retrieveEpisodic also increments by 1
    // So from initial accessCount=1: +1 (searchByActivation) +1 (retrieveEpisodic) = 3
    assert.ok(
      updated!.accessCount > 1,
      `accessCount should be incremented from initial 1, got ${updated!.accessCount}`,
    );
  });

  it('10. episodic entry lastAccessed updated on retrieval', async () => {
    const actConfig: ActivationConfig = {
      ...defaultActivationConfig(),
      retrievalThreshold: -10,
    };
    const store = createInMemoryDualStore(defaultDualStoreConfig(), actConfig);
    const writePort = createMockWritePort();

    const oldTimestamp = Date.now() - 60_000; // 1 minute ago
    const ep = makeEpisodicEntry({
      id: 'ep-time',
      context: ['testing'],
      lastAccessed: oldTimestamp,
    });
    await store.storeEpisodic(ep);

    const beforeStep = Date.now();
    const mod = createMemoryV3(store, writePort, actConfig);
    await mod.step(
      { snapshot: makeSnapshot(['testing lastAccessed update']) },
      mod.initialState(),
      makeControl(),
    );

    // retrieveEpisodic also updates lastAccessed, but searchByActivation does it first
    const updated = await store.retrieveEpisodic('ep-time');
    assert.ok(updated, 'Entry should still exist');
    assert.ok(
      updated!.lastAccessed >= beforeStep,
      `lastAccessed should be updated to recent time, got ${updated!.lastAccessed} (expected >= ${beforeStep})`,
    );
  });

  it('11. empty stores produce zero retrievals without error', async () => {
    const actConfig = defaultActivationConfig();
    const store = createInMemoryDualStore(defaultDualStoreConfig(), actConfig);
    const writePort = createMockWritePort();

    const mod = createMemoryV3(store, writePort, actConfig);
    const result = await mod.step(
      { snapshot: makeSnapshot(['testing empty stores']) },
      mod.initialState(),
      makeControl(),
    );

    assert.strictEqual(result.output.count, 0, 'Should retrieve nothing from empty stores');
    assert.strictEqual(result.output.retrieved.length, 0);
    assert.strictEqual(writePort.entries.length, 0, 'Should write nothing to workspace');
    assert.strictEqual(result.monitoring.retrievalCount, 0);
    assert.strictEqual(result.monitoring.relevanceScore, 0);
    assert.ok(!result.error, 'Should not produce an error');
  });

  it('12. module composes with v1 Monitor — emits correct MemoryMonitoring signal shape', async () => {
    const actConfig = defaultActivationConfig();
    const store = createInMemoryDualStore(defaultDualStoreConfig(), actConfig);
    const writePort = createMockWritePort();

    await store.storeEpisodic(makeEpisodicEntry({ context: ['compose'] }));

    const mod = createMemoryV3(store, writePort, actConfig);
    const result = await mod.step(
      { snapshot: makeSnapshot(['compose with v1 monitor']) },
      mod.initialState(),
      makeControl(),
    );

    // v1 Monitor consumes MemoryMonitoring via { type, source, timestamp, retrievalCount, relevanceScore }
    const signal = result.monitoring;
    assert.strictEqual(signal.type, 'memory', 'Signal type must be "memory" for Monitor v1');
    assert.ok(typeof signal.source === 'string', 'source must be a string (ModuleId)');
    assert.ok(typeof signal.timestamp === 'number', 'timestamp must be a number');
    assert.ok(typeof signal.retrievalCount === 'number', 'retrievalCount must be a number');
    assert.ok(typeof signal.relevanceScore === 'number', 'relevanceScore must be a number');
    // These are the only fields on MemoryMonitoring — no extra fields
    const keys = Object.keys(signal).sort();
    assert.deepStrictEqual(
      keys,
      ['relevanceScore', 'retrievalCount', 'source', 'timestamp', 'type'],
      'MemoryMonitoring should have exactly the expected fields',
    );
  });

  it('13. module composes with v2 Monitor — enriched signal consumption', async () => {
    const actConfig = defaultActivationConfig();
    const store = createInMemoryDualStore(defaultDualStoreConfig(), actConfig);
    const writePort = createMockWritePort();

    await store.storeEpisodic(makeEpisodicEntry({ context: ['compose'] }));
    await store.storeSemantic(makeSemanticEntry({ tags: ['compose'] }));

    const mod = createMemoryV3(store, writePort, actConfig);

    // Run two steps to accumulate state
    let state = mod.initialState();
    const result1 = await mod.step(
      { snapshot: makeSnapshot(['first step compose']) },
      state,
      makeControl(),
    );
    state = result1.state;

    const result2 = await mod.step(
      { snapshot: makeSnapshot(['second step compose']) },
      state,
      makeControl(),
    );

    // v2 Monitor enriches signals with metacognitive judgment.
    // The signal must be a valid MemoryMonitoring that a v2 Monitor can wrap.
    const signal = result2.monitoring;
    assert.strictEqual(signal.type, 'memory');
    assert.ok(signal.retrievalCount >= 0);
    assert.ok(signal.relevanceScore >= 0 && signal.relevanceScore <= 1);

    // State should accumulate across steps
    assert.ok(
      result2.state.retrievalCount >= result1.state.retrievalCount,
      'State should accumulate retrieval count across steps',
    );
    assert.ok(
      result2.state.accumulatedRelevance >= 0,
      'Accumulated relevance should be non-negative',
    );
  });

  it('14. step() rejection on MemoryPortV3 failure produces recoverable StepError', async () => {
    // Create a store that throws on searchByActivation
    const failingStore: MemoryPortV3 = {
      store: async () => {},
      retrieve: async () => null,
      storeEpisodic: async () => {},
      storeSemantic: async () => {},
      retrieveEpisodic: async () => null,
      retrieveSemantic: async () => null,
      searchByActivation: async () => {
        throw new Error('Dual-store search failed: disk error');
      },
      consolidate: async () => ({
        semanticUpdates: 0,
        conflictsDetected: 0,
        compressionRatio: 0,
        entriesPruned: 0,
        episodesReplayed: 0,
        durationMs: 0,
      }),
      allEpisodic: async () => [],
      allSemantic: async () => [],
      updateSemantic: async () => {},
      expireSemantic: async () => {},
      expireEpisodic: async () => {},
    };

    const writePort = createMockWritePort();
    const mod = createMemoryV3(failingStore, writePort);
    const state = mod.initialState();

    const result = await mod.step(
      { snapshot: makeSnapshot(['trigger failure']) },
      state,
      makeControl(),
    );

    // Should produce error, not throw
    assert.ok(result.error, 'Should have StepError');
    assert.strictEqual(result.error.recoverable, true);
    assert.strictEqual(result.error.moduleId, 'memory-v3');
    assert.ok(result.error.message.includes('Dual-store search failed'));

    // State should remain unchanged
    assert.strictEqual(result.state.retrievalCount, 0);

    // Nothing written to workspace
    assert.strictEqual(writePort.entries.length, 0);

    // Monitoring still emitted with zeroes
    assert.strictEqual(result.monitoring.type, 'memory');
    assert.strictEqual(result.monitoring.retrievalCount, 0);
    assert.strictEqual(result.monitoring.relevanceScore, 0);
  });

  it('15. module ID defaults to "memory-v3", overridable via config', async () => {
    const actConfig = defaultActivationConfig();
    const store = createInMemoryDualStore(defaultDualStoreConfig(), actConfig);
    const writePort = createMockWritePort();

    // Default ID
    const defaultMod = createMemoryV3(store, writePort, actConfig);
    assert.strictEqual(defaultMod.id, 'memory-v3');

    // Custom ID
    const customMod = createMemoryV3(store, writePort, actConfig, { id: 'custom-memory' });
    assert.strictEqual(customMod.id, 'custom-memory');

    // Custom ID appears in monitoring signals
    const result = await customMod.step(
      { snapshot: makeSnapshot(['test custom id']) },
      customMod.initialState(),
      makeControl(),
    );
    assert.strictEqual(result.monitoring.source, 'custom-memory');
  });
});
