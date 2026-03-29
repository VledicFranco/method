/**
 * Fluent builders for cognitive composition test objects.
 *
 * Every builder has sensible defaults so tests only specify
 * the fields they care about.
 */

import type {
  ModuleId,
  MonitoringSignal,
  ControlDirective,
  StepResult,
  WorkspaceConfig,
  ControlPolicy,
  MonitorV2Config,
  ReasonerActorV2Config,
  PriorityAttendConfig,
  EVCConfig,
  EnrichedMonitoringSignal,
  ImpasseSignal,
  ImpasseType,
} from '@method/pacta';

import { moduleId } from '@method/pacta';

import type {
  CycleConfig,
  CycleErrorPolicy,
  ThresholdPolicy,
  CycleBudget,
  MemoryPortV3,
  MemoryEntry,
  EpisodicEntry,
  SemanticEntry,
  DualStoreConfig,
  ActivationConfig,
  ConsolidationConfig,
  ConsolidationResult,
} from '@method/pacta';

import { RecordingModule } from './recording-module.js';

// ── CognitiveModuleBuilder ─────────────────────────────────────

export class CognitiveModuleBuilder<
  I,
  O,
  S,
  Mu extends MonitoringSignal,
  Kappa extends ControlDirective,
> {
  private _id: ModuleId = moduleId('test-module');
  private _initialState!: S;
  private _responses: Array<StepResult<O, S, Mu>> = [];
  private _defaultResult: StepResult<O, S, Mu> | null = null;

  withId(id: string): this {
    this._id = moduleId(id);
    return this;
  }

  withInitialState(state: S): this {
    this._initialState = state;
    return this;
  }

  withResponse(result: StepResult<O, S, Mu>): this {
    this._responses.push(result);
    return this;
  }

  withDefaultResult(result: StepResult<O, S, Mu>): this {
    this._defaultResult = result;
    return this;
  }

  build(): RecordingModule<I, O, S, Mu, Kappa> {
    const mod = new RecordingModule<I, O, S, Mu, Kappa>(this._id, this._initialState);
    for (const r of this._responses) {
      mod.addStepResponse(r);
    }
    if (this._defaultResult) {
      mod.setDefaultResult(this._defaultResult);
    }
    return mod;
  }
}

/** Create a CognitiveModuleBuilder with sensible defaults. */
export function cognitiveModuleBuilder<
  I = unknown,
  O = unknown,
  S = unknown,
  Mu extends MonitoringSignal = MonitoringSignal,
  Kappa extends ControlDirective = ControlDirective,
>(): CognitiveModuleBuilder<I, O, S, Mu, Kappa> {
  return new CognitiveModuleBuilder<I, O, S, Mu, Kappa>();
}

// ── WorkspaceBuilder ───────────────────────────────────────────

export class WorkspaceBuilder {
  private _capacity = 10;
  private _writeQuotaPerModule?: number;
  private _defaultTtl?: number;

  withCapacity(capacity: number): this {
    this._capacity = capacity;
    return this;
  }

  withWriteQuotaPerModule(quota: number): this {
    this._writeQuotaPerModule = quota;
    return this;
  }

  withDefaultTtl(ttl: number): this {
    this._defaultTtl = ttl;
    return this;
  }

  build(): WorkspaceConfig {
    const config: WorkspaceConfig = {
      capacity: this._capacity,
    };
    if (this._writeQuotaPerModule !== undefined) config.writeQuotaPerModule = this._writeQuotaPerModule;
    if (this._defaultTtl !== undefined) config.defaultTtl = this._defaultTtl;
    return config;
  }
}

/** Create a WorkspaceBuilder with sensible defaults (capacity: 10). */
export function workspaceBuilder(): WorkspaceBuilder {
  return new WorkspaceBuilder();
}

// ── CycleConfigBuilder ─────────────────────────────────────────

/** A permissive ControlPolicy that allows everything — suitable for tests. */
function permissiveControlPolicy(): ControlPolicy {
  return {
    allowedDirectiveTypes: ['*'],
    validate: () => true,
  };
}

export class CycleConfigBuilder {
  private _thresholds: ThresholdPolicy = {
    type: 'predicate',
    shouldIntervene: () => true,
  };
  private _errorPolicy: CycleErrorPolicy = {
    default: 'abort',
  };
  private _controlPolicy: ControlPolicy = permissiveControlPolicy();
  private _cycleBudget?: CycleBudget;
  private _maxConsecutiveInterventions?: number;

  withThresholds(thresholds: ThresholdPolicy): this {
    this._thresholds = thresholds;
    return this;
  }

  withErrorPolicy(errorPolicy: CycleErrorPolicy): this {
    this._errorPolicy = errorPolicy;
    return this;
  }

  withControlPolicy(controlPolicy: ControlPolicy): this {
    this._controlPolicy = controlPolicy;
    return this;
  }

  withCycleBudget(budget: CycleBudget): this {
    this._cycleBudget = budget;
    return this;
  }

  withMaxConsecutiveInterventions(max: number): this {
    this._maxConsecutiveInterventions = max;
    return this;
  }

  build(): CycleConfig {
    const config: CycleConfig = {
      thresholds: this._thresholds,
      errorPolicy: this._errorPolicy,
      controlPolicy: this._controlPolicy,
    };
    if (this._cycleBudget !== undefined) config.cycleBudget = this._cycleBudget;
    if (this._maxConsecutiveInterventions !== undefined) {
      config.maxConsecutiveInterventions = this._maxConsecutiveInterventions;
    }
    return config;
  }
}

/** Create a CycleConfigBuilder with sensible test defaults. */
export function cycleConfigBuilder(): CycleConfigBuilder {
  return new CycleConfigBuilder();
}

// ── v2 Config Builders (PRD 035) ──────────────────────────────

/**
 * Build a MonitorV2Config with sensible test defaults.
 * All fields are optional in MonitorV2Config, so overrides are merged on top.
 *
 * Defaults: baseConfidenceThreshold 0.3, grattonDelta 0.05, thresholdFloor 0.1,
 * thresholdCeiling 0.6, predictionErrorThreshold 1.5, expectationAlpha 0.2,
 * stagnationThreshold 3.
 */
export function buildMonitorV2Config(overrides?: Partial<MonitorV2Config>): MonitorV2Config {
  return {
    baseConfidenceThreshold: 0.3,
    grattonDelta: 0.05,
    thresholdFloor: 0.1,
    thresholdCeiling: 0.6,
    predictionErrorThreshold: 1.5,
    expectationAlpha: 0.2,
    stagnationThreshold: 3,
    id: 'monitor-v2-test',
    ...overrides,
  };
}

// ── DualStoreBuilder ──────────────────────────────────────────

/**
 * Compute ACT-R activation for a memory chunk (testkit-local copy).
 *
 * Mirrors the production activation computation from
 * `@method/pacta/cognitive/modules/activation.ts` without requiring
 * a deep import into the pacta package (which is not exported from
 * the barrel). Testkit test doubles are intentionally self-contained.
 */
function computeTestActivation(
  chunk: EpisodicEntry | SemanticEntry,
  context: string[],
  now: number,
  config: ActivationConfig,
): number {
  const isEpisodic = 'lastAccessed' in chunk && 'accessCount' in chunk && 'context' in chunk;

  const lastAccessed = isEpisodic
    ? (chunk as EpisodicEntry).lastAccessed
    : (chunk as SemanticEntry).updated;
  const accessCount = isEpisodic
    ? (chunk as EpisodicEntry).accessCount
    : Math.max(1, (chunk as SemanticEntry).sourceEpisodes.length);
  const chunkTags = isEpisodic
    ? (chunk as EpisodicEntry).context
    : (chunk as SemanticEntry).tags;
  const confidence = isEpisodic ? 1.0 : (chunk as SemanticEntry).confidence;

  // 1. Base-level activation: log(accessCount / sqrt(age))
  const ageMs = now - lastAccessed;
  const ageSec = Math.max(1, ageMs / 1000);
  const baseLevelActivation = Math.log(accessCount / Math.sqrt(ageSec));

  // 2. Spreading activation: context/tag overlap * spreadingWeight
  let overlap = 0;
  for (const ctx of context) {
    if (chunkTags.includes(ctx)) {
      overlap++;
    }
  }
  const spreadingActivation = overlap * config.spreadingWeight;

  // 3. Partial match penalty: applied when confidence < 0.5
  const partialMatch = confidence < 0.5 ? config.partialMatchPenalty : 0;

  // 4. Noise: stochastic perturbation
  const noise = (Math.random() - 0.5) * config.noiseAmplitude;

  return baseLevelActivation + spreadingActivation + partialMatch + noise;
}

/**
 * Create an in-memory MemoryPortV3 test double.
 *
 * Self-contained implementation that mirrors `createInMemoryDualStore`
 * from `@method/pacta` without requiring a deep import. Follows the
 * testkit pattern where test doubles are fully owned by the testkit.
 */
function createTestDualStore(
  config: DualStoreConfig,
  activationConfig: ActivationConfig,
  seedEpisodic: EpisodicEntry[],
  seedSemantic: SemanticEntry[],
): MemoryPortV3 {
  const episodicStore: EpisodicEntry[] = [...seedEpisodic];
  const semanticStore: SemanticEntry[] = [...seedSemantic];
  const kvStore = new Map<string, string>();

  return {
    // Legacy MemoryPort methods
    async store(key: string, value: string): Promise<void> {
      kvStore.set(key, value);
    },
    async retrieve(key: string): Promise<string | null> {
      return kvStore.get(key) ?? null;
    },
    async search(query: string, limit?: number): Promise<MemoryEntry[]> {
      const results: MemoryEntry[] = [];
      const max = limit ?? 10;
      for (const [key, value] of kvStore) {
        if (value.includes(query) || key.includes(query)) {
          results.push({ key, value });
          if (results.length >= max) break;
        }
      }
      return results;
    },

    // Episodic Store
    async storeEpisodic(episode: EpisodicEntry): Promise<void> {
      if (episodicStore.length >= config.episodic.capacity) {
        episodicStore.shift();
      }
      episodicStore.push(episode);
    },
    async retrieveEpisodic(id: string): Promise<EpisodicEntry | null> {
      const entry = episodicStore.find((e) => e.id === id);
      if (!entry) return null;
      entry.accessCount++;
      entry.lastAccessed = Date.now();
      return entry;
    },
    async allEpisodic(): Promise<EpisodicEntry[]> {
      return [...episodicStore];
    },
    async expireEpisodic(id: string): Promise<void> {
      const idx = episodicStore.findIndex((e) => e.id === id);
      if (idx !== -1) episodicStore.splice(idx, 1);
    },

    // Semantic Store
    async storeSemantic(pattern: SemanticEntry): Promise<void> {
      if (semanticStore.length >= config.semantic.capacity) {
        const now = Date.now();
        let lowestIdx = 0;
        let lowestActivation = Infinity;
        for (let i = 0; i < semanticStore.length; i++) {
          const act = computeTestActivation(semanticStore[i], [], now, activationConfig);
          if (act < lowestActivation) {
            lowestActivation = act;
            lowestIdx = i;
          }
        }
        semanticStore.splice(lowestIdx, 1);
      }
      semanticStore.push(pattern);
    },
    async retrieveSemantic(id: string): Promise<SemanticEntry | null> {
      return semanticStore.find((e) => e.id === id) ?? null;
    },
    async allSemantic(): Promise<SemanticEntry[]> {
      return [...semanticStore];
    },
    async updateSemantic(
      id: string,
      updates: Partial<Pick<SemanticEntry, 'confidence' | 'activationBase' | 'tags' | 'pattern'>>,
    ): Promise<void> {
      const entry = semanticStore.find((e) => e.id === id);
      if (!entry) return;
      if (updates.confidence !== undefined) entry.confidence = updates.confidence;
      if (updates.activationBase !== undefined) entry.activationBase = updates.activationBase;
      if (updates.tags !== undefined) entry.tags = updates.tags;
      if (updates.pattern !== undefined) entry.pattern = updates.pattern;
      entry.updated = Date.now();
    },
    async expireSemantic(id: string): Promise<void> {
      const idx = semanticStore.findIndex((e) => e.id === id);
      if (idx !== -1) semanticStore.splice(idx, 1);
    },

    // Activation-Based Retrieval
    async searchByActivation(
      context: string[],
      limit: number,
    ): Promise<(EpisodicEntry | SemanticEntry)[]> {
      const now = Date.now();
      const scored: Array<{ entry: EpisodicEntry | SemanticEntry; activation: number }> = [];

      for (const entry of episodicStore) {
        const activation = computeTestActivation(entry, context, now, activationConfig);
        if (activation >= activationConfig.retrievalThreshold) {
          scored.push({ entry, activation });
        }
      }
      for (const entry of semanticStore) {
        const activation = computeTestActivation(entry, context, now, activationConfig);
        if (activation >= activationConfig.retrievalThreshold) {
          scored.push({ entry, activation });
        }
      }

      scored.sort((a, b) => b.activation - a.activation);
      const results = scored.slice(0, limit).map((s) => s.entry);

      for (const entry of results) {
        if ('accessCount' in entry && 'lastAccessed' in entry) {
          (entry as EpisodicEntry).accessCount++;
          (entry as EpisodicEntry).lastAccessed = now;
        }
      }

      return results;
    },

    // Consolidation Stub
    async consolidate(_config: ConsolidationConfig): Promise<ConsolidationResult> {
      return {
        semanticUpdates: 0,
        conflictsDetected: 0,
        compressionRatio: 0,
        entriesPruned: 0,
        episodesReplayed: 0,
        durationMs: 0,
      };
    },
  };
}

/**
 * Build a ReasonerActorV2Config with sensible test defaults.
 *
 * Defaults: stallEntropyThreshold 0.3, noChangeThreshold 2,
 * injectSubgoals true, subgoalSalience 0.9.
 */
export function buildReasonerActorV2Config(overrides?: Partial<ReasonerActorV2Config>): ReasonerActorV2Config {
  return {
    id: 'reasoner-actor-v2-test',
    stallEntropyThreshold: 0.3,
    noChangeThreshold: 2,
    injectSubgoals: true,
    subgoalSalience: 0.9,
    ...overrides,
  };
}

/**
 * Build a PriorityAttendConfig with sensible test defaults.
 *
 * Defaults: stimulusWeight 0.3, goalWeight 0.4, historyWeight 0.3,
 * suppressionFactor 0.2, maxHistoryEntries 100.
 */
export function buildPriorityAttendConfig(overrides?: Partial<PriorityAttendConfig>): PriorityAttendConfig {
  return {
    stimulusWeight: 0.3,
    goalWeight: 0.4,
    historyWeight: 0.3,
    suppressionFactor: 0.2,
    maxHistoryEntries: 100,
    ...overrides,
  };
}

/**
 * Build an EVCConfig with sensible test defaults.
 *
 * Defaults: payoffWeight 1.0, costWeight 1.0, minPredictionError 0.1, bias 0.0.
 */
export function buildEVCConfig(overrides?: Partial<EVCConfig>): EVCConfig {
  return {
    payoffWeight: 1.0,
    costWeight: 1.0,
    minPredictionError: 0.1,
    bias: 0.0,
    ...overrides,
  };
}

/**
 * Build a test EnrichedMonitoringSignal with sensible defaults.
 *
 * The base MonitoringSignal requires `source` and `timestamp`.
 * v2 enriched fields default to representative test values.
 */
export function buildEnrichedMonitoringSignal(
  overrides?: Partial<EnrichedMonitoringSignal>,
): EnrichedMonitoringSignal {
  return {
    source: moduleId('test-monitor'),
    timestamp: Date.now(),
    predictionError: 0.2,
    precision: 0.8,
    conflictEnergy: 0.0,
    eol: 0.5,
    jol: 0.6,
    rc: 0.7,
    ...overrides,
  };
}

/**
 * Build a test ImpasseSignal for a given impasse type.
 *
 * Each type pre-fills contextually appropriate defaults:
 * - tie: two dummy candidates
 * - no-change: no extra fields
 * - rejection: a failed tool name
 * - stall: stuck cycle count of 3
 *
 * @param type - The impasse type to build.
 * @param overrides - Optional overrides merged on top.
 */
export function buildImpasseSignal(
  type: ImpasseType,
  overrides?: Partial<ImpasseSignal>,
): ImpasseSignal {
  const base: ImpasseSignal = {
    type,
    autoSubgoal: `resolve-${type}-impasse`,
  };

  // Add type-specific sensible defaults
  switch (type) {
    case 'tie':
      base.candidates = ['option-a', 'option-b'];
      break;
    case 'rejection':
      base.failedTool = 'test-tool';
      break;
    case 'stall':
      base.stuckCycles = 3;
      break;
    case 'no-change':
      // No additional defaults needed
      break;
  }

  return { ...base, ...overrides };
}

/**
 * Fluent builder for creating pre-configured MemoryPortV3 test doubles.
 *
 * Produces a self-contained in-memory dual-store with ACT-R activation
 * retrieval. Supports config overrides and pre-seeded entries so tests
 * only specify the fields they care about.
 *
 * @example
 * ```typescript
 * const store = dualStoreBuilder()
 *   .withEpisodicCapacity(20)
 *   .withEpisodicEntry({ id: 'e1', content: 'observed X' })
 *   .build();
 * ```
 */
export class DualStoreBuilder {
  // DualStoreConfig fields
  private _episodicCapacity = 50;
  private _semanticCapacity = 500;
  private _replayBatchSize = 5;
  private _interleaveRatio = 0.6;
  private _schemaConsistencyThreshold = 0.8;

  // ActivationConfig fields
  private _retrievalThreshold = -0.5;
  private _spreadingWeight = 0.3;
  private _noiseAmplitude = 0.1;
  private _maxRetrievals = 5;

  // Pre-seeded entries
  private _episodicEntries: EpisodicEntry[] = [];
  private _semanticEntries: SemanticEntry[] = [];

  // ── DualStoreConfig setters ──────────────────────────────────

  withEpisodicCapacity(n: number): this {
    this._episodicCapacity = n;
    return this;
  }

  withSemanticCapacity(n: number): this {
    this._semanticCapacity = n;
    return this;
  }

  withReplayBatchSize(n: number): this {
    this._replayBatchSize = n;
    return this;
  }

  withInterleaveRatio(r: number): this {
    this._interleaveRatio = r;
    return this;
  }

  withSchemaConsistencyThreshold(t: number): this {
    this._schemaConsistencyThreshold = t;
    return this;
  }

  // ── ActivationConfig setters ─────────────────────────────────

  withRetrievalThreshold(t: number): this {
    this._retrievalThreshold = t;
    return this;
  }

  withSpreadingWeight(w: number): this {
    this._spreadingWeight = w;
    return this;
  }

  withNoiseAmplitude(a: number): this {
    this._noiseAmplitude = a;
    return this;
  }

  withMaxRetrievals(n: number): this {
    this._maxRetrievals = n;
    return this;
  }

  // ── Pre-seed entries ─────────────────────────────────────────

  /**
   * Pre-seed an episodic entry. Fills in sensible defaults for
   * optional fields: timestamp=Date.now(), accessCount=1,
   * lastAccessed=Date.now(), context=[].
   */
  withEpisodicEntry(entry: Partial<EpisodicEntry> & { id: string; content: string }): this {
    const now = Date.now();
    this._episodicEntries.push({
      context: [],
      timestamp: now,
      accessCount: 1,
      lastAccessed: now,
      ...entry,
    });
    return this;
  }

  /**
   * Pre-seed a semantic entry. Fills in sensible defaults for
   * optional fields: sourceEpisodes=[], confidence=0.5,
   * activationBase=0, tags=[], created=Date.now(), updated=Date.now().
   */
  withSemanticEntry(entry: Partial<SemanticEntry> & { id: string; pattern: string }): this {
    const now = Date.now();
    this._semanticEntries.push({
      sourceEpisodes: [],
      confidence: 0.5,
      activationBase: 0,
      tags: [],
      created: now,
      updated: now,
      ...entry,
    });
    return this;
  }

  // ── Build ────────────────────────────────────────────────────

  build(): MemoryPortV3 {
    const dualStoreConfig: DualStoreConfig = {
      episodic: {
        capacity: this._episodicCapacity,
        encoding: 'verbatim',
      },
      semantic: {
        capacity: this._semanticCapacity,
        encoding: 'extracted',
        updateRate: 'slow',
      },
      consolidation: {
        replayBatchSize: this._replayBatchSize,
        interleaveRatio: this._interleaveRatio,
        schemaConsistencyThreshold: this._schemaConsistencyThreshold,
      },
    };

    const activationConfig: ActivationConfig = {
      retrievalThreshold: this._retrievalThreshold,
      spreadingWeight: this._spreadingWeight,
      partialMatchPenalty: -0.2,
      noiseAmplitude: this._noiseAmplitude,
      maxRetrievals: this._maxRetrievals,
    };

    return createTestDualStore(
      dualStoreConfig,
      activationConfig,
      this._episodicEntries,
      this._semanticEntries,
    );
  }
}

/** Create a DualStoreBuilder with sensible test defaults. */
export function dualStoreBuilder(): DualStoreBuilder {
  return new DualStoreBuilder();
}
