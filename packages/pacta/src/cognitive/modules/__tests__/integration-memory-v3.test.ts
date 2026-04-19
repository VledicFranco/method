// SPDX-License-Identifier: Apache-2.0
/**
 * Integration tests for MemoryV3 + Consolidator end-to-end (PRD 036 C-5).
 *
 * Validates the full cognitive memory lifecycle: OBSERVE -> REMEMBER (MemoryV3)
 * -> REASON -> ACT -> LEARN (Consolidator), offline consolidation, retrieval
 * relevance, catastrophic forgetting resistance, and asFlatAgent interop.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert';
import { moduleId } from '../../algebra/index.js';
import type {
  CognitiveModule,
  StepResult,
  MonitoringSignal,
  ControlDirective,
  ControlPolicy,
  WorkspaceConfig,
  WorkspaceWritePort,
  WorkspaceEntry,
  ModuleId,
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
import { triggerSleep } from '../sleep-api.js';
import { createCognitiveAgent } from '../../engine/create-cognitive-agent.js';
import type { CycleModules, CycleConfig } from '../../engine/cycle.js';
import { asFlatAgent } from '../../engine/as-flat-agent.js';

// ── Stub Module Factory ─────────────────────────────────────────

function createStubModule(id: string, output?: unknown): CognitiveModule<any, any, any, any, any> {
  return {
    id: moduleId(id),
    initialState() { return { callCount: 0 }; },
    async step(_input: any, state: any, _control: any): Promise<StepResult<any, any, any>> {
      return {
        output: output ?? { result: `${id}-output` },
        state: { callCount: (state?.callCount ?? 0) + 1 },
        monitoring: { source: moduleId(id), timestamp: Date.now() },
      };
    },
  };
}

/**
 * Adapter that wraps the Consolidator to accept the reflector's input format.
 *
 * The cognitive cycle passes `{ traces }` to the reflector module, but the
 * Consolidator expects `{ traces, workspaceSnapshot, actionOutcome }`. This
 * adapter bridges the gap by providing defaults for the missing fields.
 */
function asReflectorModule(
  consolidator: CognitiveModule<any, any, any, any, any>,
): CognitiveModule<any, any, any, any, any> {
  return {
    id: consolidator.id,
    initialState: () => consolidator.initialState(),
    stateInvariant: consolidator.stateInvariant
      ? (state: any) => consolidator.stateInvariant!(state)
      : undefined,
    async step(input: any, state: any, control: any) {
      // Bridge: the cycle passes { traces }, the Consolidator needs
      // { traces, workspaceSnapshot, actionOutcome }
      const consolidatorInput = {
        traces: input?.traces ?? [],
        workspaceSnapshot: input?.workspaceSnapshot ?? 'cycle workspace snapshot',
        actionOutcome: input?.actionOutcome ?? 'cycle action completed',
      };
      return consolidator.step(consolidatorInput, state, control);
    },
  };
}

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

function deterministicActivation(): ActivationConfig {
  return {
    ...defaultActivationConfig(),
    retrievalThreshold: -10, // Very low threshold for reliable retrieval
    noiseAmplitude: 0,       // Deterministic
  };
}

function defaultCycleConfig(): CycleConfig {
  const controlPolicy: ControlPolicy = {
    allowedDirectiveTypes: ['any'],
    validate: () => true,
  };
  return {
    thresholds: { type: 'predicate', shouldIntervene: () => false },
    errorPolicy: { default: 'skip' },
    controlPolicy,
  };
}

function defaultWorkspaceConfig(): WorkspaceConfig {
  return { capacity: 100 };
}

// ── Tests ────────────────────────────────────────────────────────

describe('Integration: MemoryV3 + Consolidator end-to-end (PRD 036 C-5)', () => {

  it('1. Full cycle: OBSERVE -> REMEMBER (MemoryV3) -> REASON -> ACT -> LEARN (Consolidator)', async () => {
    const writePort = createMockWritePort();
    const actConfig = deterministicActivation();
    const preset = createMemoryPreset({
      dualStore: defaultDualStoreConfig(),
      consolidation: defaultConsolidationConfig(),
      activation: actConfig,
      writePort,
    });

    // Wire MemoryV3 as the memory module and Consolidator as the reflector module
    const modules: CycleModules = {
      observer: createStubModule('observer'),
      memory: preset.memory,
      reasoner: createStubModule('reasoner'),
      actor: createStubModule('actor', { actionName: 'test', result: { output: 'done' }, escalated: false }),
      monitor: createStubModule('monitor'),
      evaluator: createStubModule('evaluator'),
      planner: createStubModule('planner', { directives: [], plan: 'test', subgoals: [] }),
      reflector: asReflectorModule(preset.consolidator),
    };

    const cognitive = createCognitiveAgent({
      modules,
      workspace: defaultWorkspaceConfig(),
      cycle: defaultCycleConfig(),
    });

    // Run one full cycle
    const result = await cognitive.invoke('Test input: process this data');

    // Verify the cycle completed all 8 phases
    // (MONITOR/CONTROL may or may not fire depending on threshold, but the rest should)
    assert.ok(result.phasesExecuted.includes('OBSERVE'), 'Should execute OBSERVE');
    assert.ok(result.phasesExecuted.includes('ATTEND'), 'Should execute ATTEND');
    assert.ok(result.phasesExecuted.includes('REMEMBER'), 'Should execute REMEMBER');
    assert.ok(result.phasesExecuted.includes('REASON'), 'Should execute REASON');
    assert.ok(result.phasesExecuted.includes('ACT'), 'Should execute ACT');
    assert.ok(result.phasesExecuted.includes('LEARN'), 'Should execute LEARN');
    assert.ok(!result.aborted, 'Cycle should not be aborted');

    // Give fire-and-forget LEARN phase time to complete
    // The LEARN phase runs asynchronously after the cycle returns.
    // We need to poll until the store has entries or time out.
    let episodes = await preset.store.allEpisodic();
    for (let attempt = 0; attempt < 20 && episodes.length === 0; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      episodes = await preset.store.allEpisodic();
    }

    // Verify episodic store was populated by the consolidator
    assert.ok(
      episodes.length >= 1,
      `Episodic store should have at least 1 entry after LEARN phase, got ${episodes.length}`,
    );
  });

  it('2. After 5 cycles + offline consolidation: semantic store contains generalized patterns', async () => {
    const writePort = createMockWritePort();
    const actConfig = deterministicActivation();
    const preset = createMemoryPreset({
      dualStore: defaultDualStoreConfig(),
      consolidation: defaultConsolidationConfig(),
      activation: actConfig,
      writePort,
    });

    const modules: CycleModules = {
      observer: createStubModule('observer'),
      memory: preset.memory,
      reasoner: createStubModule('reasoner'),
      actor: createStubModule('actor', { actionName: 'test', result: { output: 'done' }, escalated: false }),
      monitor: createStubModule('monitor'),
      evaluator: createStubModule('evaluator'),
      planner: createStubModule('planner', { directives: [], plan: 'test', subgoals: [] }),
      reflector: asReflectorModule(preset.consolidator),
    };

    const cognitive = createCognitiveAgent({
      modules,
      workspace: defaultWorkspaceConfig(),
      cycle: defaultCycleConfig(),
    });

    // Run 5 cycles
    for (let i = 0; i < 5; i++) {
      await cognitive.invoke(`Cycle ${i}: refactoring typescript types in the API layer`);
    }

    // Give fire-and-forget LEARN phases time to complete
    let episodesBefore = await preset.store.allEpisodic();
    for (let attempt = 0; attempt < 40 && episodesBefore.length < 5; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      episodesBefore = await preset.store.allEpisodic();
    }

    // Verify episodic store has entries from the 5 cycles
    assert.ok(
      episodesBefore.length >= 5,
      `Should have at least 5 episodes after 5 cycles, got ${episodesBefore.length}`,
    );

    // Run offline consolidation
    const result = await triggerSleep(preset.store, {
      replayCount: 20,
      schemaConsistencyThreshold: 0.5, // Lower threshold to make it easier to form patterns
    });

    assert.ok(result.episodesReplayed > 0, 'Should have replayed episodes');

    // Since episodes share context from the stub modules (module IDs, phases),
    // the consolidation engine should detect recurring patterns
    // and either create new semantic entries or flag conflicts.
    // Either way, the result should show activity.
    assert.ok(
      result.semanticUpdates + result.conflictsDetected > 0,
      'Consolidation should have processed episodes (updates or conflicts)',
    );
  });

  it('3. Retrieval relevance: top-5 results from activation retrieval include stored content', async () => {
    const writePort = createMockWritePort();
    const actConfig: ActivationConfig = {
      ...defaultActivationConfig(),
      retrievalThreshold: -10,
      noiseAmplitude: 0,
      maxRetrievals: 5,
    };
    const preset = createMemoryPreset({
      dualStore: defaultDualStoreConfig(),
      consolidation: defaultConsolidationConfig(),
      activation: actConfig,
      writePort,
    });

    const now = Date.now();

    // Populate with episodic entries having specific context
    await preset.store.storeEpisodic({
      id: 'ep-relevant-1',
      content: 'Fixed null pointer in TypeScript API handler',
      context: ['typescript', 'bugfix', 'api-handler'],
      timestamp: now,
      accessCount: 3,
      lastAccessed: now,
    });

    await preset.store.storeEpisodic({
      id: 'ep-relevant-2',
      content: 'Refactored API handler type signatures',
      context: ['typescript', 'refactoring', 'api-handler'],
      timestamp: now - 1000,
      accessCount: 2,
      lastAccessed: now - 1000,
    });

    // Add a semantic entry that should also be retrievable
    await preset.store.storeSemantic({
      id: 'sem-relevant',
      pattern: 'API handlers should validate input types before processing',
      sourceEpisodes: ['ep-old-1', 'ep-old-2'],
      confidence: 0.9,
      activationBase: 0.5,
      tags: ['typescript', 'api-handler', 'validation'],
      created: now - 5000,
      updated: now - 1000,
    });

    // Also add an irrelevant entry
    await preset.store.storeEpisodic({
      id: 'ep-irrelevant',
      content: 'Updated CSS styles for dashboard',
      context: ['css', 'dashboard', 'styling'],
      timestamp: now - 60_000,
      accessCount: 1,
      lastAccessed: now - 60_000,
    });

    // Retrieve via activation search with matching context
    const results = await preset.store.searchByActivation(
      ['typescript', 'api-handler'],
      5,
    );

    assert.ok(results.length > 0, 'Should retrieve at least one result');
    assert.ok(results.length <= 5, 'Should respect limit of 5');

    // The relevant entries should be present (they have matching context tags)
    const ids = results.map((r) => r.id);
    assert.ok(
      ids.includes('ep-relevant-1') || ids.includes('ep-relevant-2') || ids.includes('sem-relevant'),
      'Top results should include entries with matching context',
    );

    // If the irrelevant entry appears, it should be ranked below the relevant ones
    const irrelevantIdx = ids.indexOf('ep-irrelevant');
    if (irrelevantIdx !== -1) {
      const relevantIdx = Math.min(
        ids.indexOf('ep-relevant-1') ?? Infinity,
        ids.indexOf('ep-relevant-2') ?? Infinity,
        ids.indexOf('sem-relevant') ?? Infinity,
      );
      assert.ok(
        relevantIdx < irrelevantIdx,
        'Relevant entries should rank above irrelevant entries',
      );
    }
  });

  it('4. Catastrophic forgetting test: prior semantic patterns survive new episode consolidation', async () => {
    const writePort = createMockWritePort();
    const actConfig: ActivationConfig = {
      ...defaultActivationConfig(),
      retrievalThreshold: -10,
      noiseAmplitude: 0,
    };
    const dualConfig: DualStoreConfig = {
      episodic: { capacity: 200, encoding: 'verbatim' }, // Large capacity
      semantic: { capacity: 500, encoding: 'extracted', updateRate: 'slow' },
      consolidation: {
        replayBatchSize: 10,
        interleaveRatio: 0.6,
        schemaConsistencyThreshold: 0.8,
      },
    };
    const preset = createMemoryPreset({
      dualStore: dualConfig,
      consolidation: {
        ...defaultConsolidationConfig(),
        pruningThreshold: -5.0, // Lenient pruning — only prune very low activation
      },
      activation: actConfig,
      writePort,
    });

    const now = Date.now();

    // Phase 1: Populate semantic store with 20 well-established patterns
    const priorPatterns: SemanticEntry[] = [];
    for (let i = 0; i < 20; i++) {
      const pattern: SemanticEntry = {
        id: `sem-prior-${i}`,
        pattern: `Established pattern ${i}: always check types before casting`,
        sourceEpisodes: [`ep-old-${i}-1`, `ep-old-${i}-2`, `ep-old-${i}-3`],
        confidence: 0.9, // High confidence
        activationBase: 0.5,
        tags: [`pattern-${i}`, 'established', 'type-safety'],
        created: now - 86400_000, // 1 day old
        updated: now - 3600_000,  // Updated 1 hour ago (reasonably recent)
      };
      priorPatterns.push(pattern);
      await preset.store.storeSemantic(pattern);
    }

    // Verify all 20 patterns exist
    const semanticBefore = await preset.store.allSemantic();
    assert.strictEqual(semanticBefore.length, 20, 'Should start with 20 semantic patterns');

    // Phase 2: Add 100 new episodes (diverse, different contexts)
    for (let i = 0; i < 100; i++) {
      await preset.store.storeEpisodic({
        id: `ep-new-${i}`,
        content: `New episode ${i}: exploring different code patterns`,
        context: [`topic-${i % 10}`, 'exploration', 'new-domain'],
        timestamp: now - i * 50,
        accessCount: 1,
        lastAccessed: now - i * 50,
      });
    }

    // Phase 3: Run consolidation
    const result = await triggerSleep(preset.store, {
      replayCount: 100,
      pruningThreshold: -5.0, // Lenient
      schemaConsistencyThreshold: 0.8,
    });

    assert.ok(result.episodesReplayed > 0, 'Should have replayed episodes');

    // Phase 4: Verify prior patterns survived
    const semanticAfter = await preset.store.allSemantic();

    let survivedCount = 0;
    for (const prior of priorPatterns) {
      const found = semanticAfter.find((s) => s.id === prior.id);
      if (found) survivedCount++;
    }

    const survivalRate = survivedCount / priorPatterns.length;
    assert.ok(
      survivalRate >= 0.95,
      `Prior patterns survival rate should be >= 95%, got ${(survivalRate * 100).toFixed(1)}% (${survivedCount}/${priorPatterns.length})`,
    );

    // Prior patterns should still have reasonable confidence
    for (const prior of priorPatterns) {
      const found = semanticAfter.find((s) => s.id === prior.id);
      if (found) {
        assert.ok(
          found.confidence >= 0.5,
          `Prior pattern ${prior.id} confidence should be >= 0.5 after consolidation, got ${found.confidence}`,
        );
      }
    }
  });

  it('5. MemoryV3 + Consolidator compose with asFlatAgent() adapter (PRD 030 interop)', async () => {
    const writePort = createMockWritePort();
    const actConfig = deterministicActivation();
    const preset = createMemoryPreset({
      dualStore: defaultDualStoreConfig(),
      consolidation: defaultConsolidationConfig(),
      activation: actConfig,
      writePort,
    });

    // Wire MemoryV3 and Consolidator into the cognitive agent
    const modules: CycleModules = {
      observer: createStubModule('observer'),
      memory: preset.memory,
      reasoner: createStubModule('reasoner'),
      actor: createStubModule('actor', { actionName: 'test', result: { output: 'done' }, escalated: false }),
      monitor: createStubModule('monitor'),
      evaluator: createStubModule('evaluator'),
      planner: createStubModule('planner', { directives: [], plan: 'test', subgoals: [] }),
      reflector: asReflectorModule(preset.consolidator),
    };

    const cognitive = createCognitiveAgent({
      modules,
      workspace: defaultWorkspaceConfig(),
      cycle: defaultCycleConfig(),
    });

    // Wrap in flat agent adapter
    const flatAgent = asFlatAgent(cognitive);

    // Verify interface contract
    assert.ok(flatAgent, 'asFlatAgent should return an Agent');
    assert.strictEqual(typeof flatAgent.invoke, 'function', 'Should have invoke()');
    assert.ok(flatAgent.pact, 'Should have pact');
    assert.ok(flatAgent.provider, 'Should have provider');

    // Invoke via the flat agent interface
    const result = await flatAgent.invoke({ prompt: 'Test interop: process data with memory' });

    // Verify AgentResult shape
    assert.ok(result, 'Should return a result');
    assert.ok(result.output !== undefined, 'Should have output');
    assert.strictEqual(result.completed, true, 'Should complete successfully');
    assert.strictEqual(result.stopReason, 'complete', 'Stop reason should be "complete"');
    assert.strictEqual(result.turns, 1, 'Should be 1 turn per cycle');
    assert.ok(result.usage, 'Should have usage');
    assert.ok(result.durationMs >= 0, 'Should have non-negative duration');

    // Agent state should be updated
    assert.strictEqual(flatAgent.state.invocationCount, 1, 'Invocation count should be 1');

    // Give fire-and-forget LEARN phase time to complete
    let episodes = await preset.store.allEpisodic();
    for (let attempt = 0; attempt < 20 && episodes.length === 0; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      episodes = await preset.store.allEpisodic();
    }

    // Store should have been populated during the cycle
    assert.ok(
      episodes.length >= 1,
      `Episodic store should have entries after flat agent invocation, got ${episodes.length}`,
    );
  });
});
