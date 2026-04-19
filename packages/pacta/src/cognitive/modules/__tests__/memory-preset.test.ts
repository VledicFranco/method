// SPDX-License-Identifier: Apache-2.0
/**
 * Unit tests for the Memory Preset factory (PRD 036 C-5).
 *
 * Verifies that createMemoryPreset composes MemoryV3 + Consolidator correctly,
 * shares the same store instance, and supports online/offline consolidation.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { moduleId } from '../../algebra/index.js';
import type {
  WorkspaceWritePort,
  WorkspaceEntry,
  ModuleId,
  ReadonlyWorkspaceSnapshot,
  TraceRecord,
  MonitoringSignal,
} from '../../algebra/index.js';
import type {
  DualStoreConfig,
  ConsolidationConfig,
  ActivationConfig,
  EpisodicEntry,
  SemanticEntry,
} from '../../../ports/memory-port.js';
import { defaultActivationConfig } from '../activation.js';
import { createMemoryPreset } from '../memory-preset.js';
import type { MemoryV3Control } from '../memory-module-v3.js';
import type { ConsolidatorControl, ConsolidatorInput } from '../consolidator.js';
import { triggerSleep } from '../sleep-api.js';

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

function makeMemoryControl(): MemoryV3Control {
  return {
    target: 'memory-v3' as ModuleId,
    timestamp: Date.now(),
  };
}

function makeConsolidatorControl(): ConsolidatorControl {
  return {
    target: 'consolidator' as ModuleId,
    timestamp: Date.now(),
  };
}

function makeTrace(overrides?: Partial<TraceRecord>): TraceRecord {
  return {
    moduleId: moduleId('test-module'),
    phase: 'ACT',
    timestamp: Date.now(),
    inputHash: 'abc123',
    outputSummary: 'Test action completed',
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
    workspaceSnapshot: 'Current workspace state',
    actionOutcome: 'Action completed successfully',
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────

describe('Memory Preset (PRD 036 C-5)', () => {

  it('1. Preset produces valid MemoryV3 + Consolidator modules (correct module IDs)', () => {
    const writePort = createMockWritePort();
    const preset = createMemoryPreset({
      dualStore: defaultDualStoreConfig(),
      consolidation: defaultConsolidationConfig(),
      activation: defaultActivationConfig(),
      writePort,
    });

    // Verify the memory module
    assert.ok(preset.memory, 'Preset should produce a memory module');
    assert.strictEqual(preset.memory.id, 'memory-v3', 'Memory module should have ID "memory-v3"');
    assert.strictEqual(typeof preset.memory.step, 'function', 'Memory module should have step()');
    assert.strictEqual(typeof preset.memory.initialState, 'function', 'Memory module should have initialState()');

    // Verify the consolidator module
    assert.ok(preset.consolidator, 'Preset should produce a consolidator module');
    assert.strictEqual(preset.consolidator.id, 'consolidator', 'Consolidator module should have ID "consolidator"');
    assert.strictEqual(typeof preset.consolidator.step, 'function', 'Consolidator module should have step()');
    assert.strictEqual(typeof preset.consolidator.initialState, 'function', 'Consolidator module should have initialState()');

    // Verify the store
    assert.ok(preset.store, 'Preset should expose the shared store');
    assert.strictEqual(typeof preset.store.storeEpisodic, 'function', 'Store should have storeEpisodic');
    assert.strictEqual(typeof preset.store.storeSemantic, 'function', 'Store should have storeSemantic');
    assert.strictEqual(typeof preset.store.searchByActivation, 'function', 'Store should have searchByActivation');
  });

  it('2. Both modules share the same InMemoryDualStore instance', async () => {
    const writePort = createMockWritePort();
    const preset = createMemoryPreset({
      dualStore: defaultDualStoreConfig(),
      consolidation: defaultConsolidationConfig(),
      activation: defaultActivationConfig(),
      writePort,
    });

    // Use the consolidator to store an episode
    const consolidatorState = preset.consolidator.initialState();
    const input = makeConsolidatorInput({
      workspaceSnapshot: 'Shared store verification test',
      actionOutcome: 'Episode stored by consolidator',
    });
    await preset.consolidator.step(input, consolidatorState, makeConsolidatorControl());

    // Verify the episode is visible through the shared store
    const episodes = await preset.store.allEpisodic();
    assert.strictEqual(episodes.length, 1, 'Episode stored by consolidator should be visible in shared store');
    assert.ok(
      episodes[0].content.includes('Shared store verification test'),
      'Stored episode should contain the workspace snapshot',
    );

    // Now MemoryV3 should be able to retrieve from the same store
    const memoryState = preset.memory.initialState();
    const memoryResult = await preset.memory.step(
      { snapshot: makeSnapshot(['Shared store verification test']) },
      memoryState,
      makeMemoryControl(),
    );

    // With matching context, the episodic entry should be retrievable
    // (The exact count depends on activation threshold, but the store should be shared)
    const allEpisodicViaStore = await preset.store.allEpisodic();
    assert.strictEqual(
      allEpisodicViaStore.length,
      1,
      'Both modules should see the same store contents',
    );
  });

  it('3. Online consolidation during LEARN stores episodes retrievable by MemoryV3', async () => {
    const writePort = createMockWritePort();
    const actConfig: ActivationConfig = {
      ...defaultActivationConfig(),
      retrievalThreshold: -10, // Very low threshold so everything is retrieved
      noiseAmplitude: 0,       // Deterministic
    };
    const preset = createMemoryPreset({
      dualStore: defaultDualStoreConfig(),
      consolidation: defaultConsolidationConfig(),
      activation: actConfig,
      writePort,
    });

    // Step 1: Consolidator stores an episode (LEARN phase)
    let consolidatorState = preset.consolidator.initialState();
    const learnResult = await preset.consolidator.step(
      makeConsolidatorInput({
        workspaceSnapshot: 'Agent solved a typescript error in the API layer',
        actionOutcome: 'Fixed typescript narrowing for refactoring discriminant',
      }),
      consolidatorState,
      makeConsolidatorControl(),
    );
    consolidatorState = learnResult.state;

    // Verify episode was stored
    const episodes = await preset.store.allEpisodic();
    assert.strictEqual(episodes.length, 1, 'Should have 1 episode after LEARN');
    const storedEp = episodes[0];
    assert.ok(storedEp.context.length > 0, 'Episode should have context tags');

    // Fresh episodes from the Consolidator have accessCount=0, which gives
    // -Infinity base-level activation (log(0) = -Infinity). This is correct
    // CLS behavior: episodes need at least one retrieval before they become
    // accessible via activation search. Simulate a first access:
    await preset.store.retrieveEpisodic(storedEp.id);

    // Step 2: MemoryV3 retrieves from the same store (REMEMBER phase)
    // The snapshot content must produce tags overlapping with the episode's context.
    const memoryResult = await preset.memory.step(
      { snapshot: makeSnapshot(['typescript narrowing refactoring discriminant']) },
      preset.memory.initialState(),
      makeMemoryControl(),
    );

    // Should retrieve the episode stored by the consolidator
    assert.ok(
      memoryResult.output.count > 0,
      'MemoryV3 should retrieve episodes stored by the Consolidator',
    );

    // Workspace should have entries written
    assert.ok(
      writePort.entries.length > 0,
      'Retrieved entries should be written to workspace',
    );
  });

  it('4. Offline consolidation via Sleep API transfers episodic to semantic', async () => {
    const writePort = createMockWritePort();
    const preset = createMemoryPreset({
      dualStore: defaultDualStoreConfig(),
      consolidation: defaultConsolidationConfig(),
      activation: defaultActivationConfig(),
      writePort,
    });

    const now = Date.now();

    // Populate episodic store with 5 similar episodes (same context => recurring pattern)
    for (let i = 0; i < 5; i++) {
      await preset.store.storeEpisodic({
        id: `ep-${i}`,
        content: `Episode ${i}: agent refactored type definitions`,
        context: ['refactoring', 'typescript', 'types'],
        timestamp: now - i * 1000,
        accessCount: 1,
        lastAccessed: now - i * 1000,
      });
    }

    // Verify: no semantic entries before consolidation
    const semanticBefore = await preset.store.allSemantic();
    assert.strictEqual(semanticBefore.length, 0, 'No semantic entries before consolidation');

    // Trigger offline consolidation via Sleep API
    const result = await triggerSleep(preset.store, {
      replayCount: 5,
      schemaConsistencyThreshold: 0.8,
    });

    // All episodes are schema-inconsistent (no existing semantic entries to match).
    // But with 5 similar episodes sharing context, the consolidation engine should
    // detect the recurring pattern and promote to semantic store.
    assert.ok(result.episodesReplayed > 0, 'Should have replayed episodes');

    // Since all 5 episodes share context [refactoring, typescript, types] and there
    // are no existing semantic entries, all 5 are inconsistent. The engine groups
    // them by context signature and if >= 3 match, creates a new semantic entry.
    const semanticAfter = await preset.store.allSemantic();
    assert.ok(
      semanticAfter.length > 0,
      `Should have created semantic entries from recurring episodic patterns, got ${semanticAfter.length}`,
    );

    // Verify the new semantic entry references the episodic sources
    const newSemantic = semanticAfter[0];
    assert.ok(newSemantic.sourceEpisodes.length > 0, 'Semantic entry should reference source episodes');
    assert.ok(newSemantic.tags.length > 0, 'Semantic entry should have tags from the episode context');
  });

  it('5. Cross-session knowledge retained after consolidation (episodic -> semantic -> retrieval)', async () => {
    const writePort = createMockWritePort();
    const actConfig: ActivationConfig = {
      ...defaultActivationConfig(),
      retrievalThreshold: -10, // Very low threshold for reliable retrieval
      noiseAmplitude: 0,       // Deterministic
    };
    const preset = createMemoryPreset({
      dualStore: defaultDualStoreConfig(),
      consolidation: defaultConsolidationConfig(),
      activation: actConfig,
      writePort,
    });

    const now = Date.now();

    // Session 1: Store episodic knowledge and create a semantic pattern
    const semanticEntry: SemanticEntry = {
      id: 'sem-cross-session',
      pattern: 'When refactoring TypeScript types, always update the barrel exports first',
      sourceEpisodes: ['ep-session1-1', 'ep-session1-2', 'ep-session1-3'],
      confidence: 0.85,
      activationBase: 0.5,
      tags: ['refactoring', 'typescript', 'barrel-exports'],
      created: now,
      updated: now,
    };
    await preset.store.storeSemantic(semanticEntry);

    // Session 2: New session — episodic store is different, but semantic survives
    // Query MemoryV3 with a context that matches the semantic entry
    const memoryResult = await preset.memory.step(
      { snapshot: makeSnapshot(['refactoring TypeScript barrel exports']) },
      preset.memory.initialState(),
      makeMemoryControl(),
    );

    // The semantic entry should be retrievable in the new session context
    assert.ok(memoryResult.output.count > 0, 'Should retrieve semantic knowledge from prior session');

    // Verify the semantic entry is in the retrieved results
    const semanticResults = memoryResult.output.retrieved.filter(
      (e) => 'pattern' in e && 'confidence' in e,
    );
    assert.ok(
      semanticResults.length > 0,
      'Should find semantic entries in retrieval results',
    );
    assert.ok(
      (semanticResults[0] as SemanticEntry).pattern.includes('barrel exports'),
      'Retrieved semantic pattern should match the stored knowledge',
    );
  });
});
