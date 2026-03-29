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
