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
