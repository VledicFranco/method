/**
 * Cognitive Scenario — declarative scenario builder for cognitive agents.
 *
 * Extends the playground's scenario DSL for cognitive composition evaluation.
 * Creates recording modules for unspecified slots, runs the cognitive cycle,
 * and checks assertions against the CycleResult.
 *
 * Usage:
 *   cognitiveScenario('basic reasoning')
 *     .given({ capacity: 50 })
 *     .when('Analyze this problem')
 *     .then(cyclePhaseOrder(['OBSERVE', 'ATTEND', 'REMEMBER', 'REASON', 'ACT', 'LEARN']))
 *     .then(workspaceSize(size => size < 100))
 *     .run()
 */

import type {
  CognitiveModule,
  MonitoringSignal,
  ControlDirective,
  StepResult,
  ModuleId,
  WorkspaceConfig,
  CycleModules,
  CycleConfig,
  CycleResult,
  CognitiveEvent,
} from '@method/pacta';
import {
  moduleId,
  createCognitiveAgent,
  InMemoryTraceSink,
} from '@method/pacta';

// ── Recording Module ──────────────────────────────────────────────

/** A recording module that captures step invocations and returns scripted results. */
export class RecordingModule implements CognitiveModule<unknown, unknown, unknown, MonitoringSignal, ControlDirective> {
  readonly id: ModuleId;
  private readonly _recordings: Array<{
    input: unknown;
    state: unknown;
    control: ControlDirective;
    result: StepResult<unknown, unknown, MonitoringSignal>;
  }> = [];
  private _stepCount = 0;
  private readonly _defaultOutput: unknown;
  private readonly _defaultMonitoring: MonitoringSignal;

  constructor(name: string, options?: {
    defaultOutput?: unknown;
    monitoring?: Partial<MonitoringSignal>;
  }) {
    this.id = moduleId(name);
    this._defaultOutput = options?.defaultOutput ?? `${name}-output`;
    this._defaultMonitoring = {
      source: this.id,
      timestamp: Date.now(),
      ...(options?.monitoring ?? {}),
    };
  }

  async step(
    input: unknown,
    state: unknown,
    control: ControlDirective,
  ): Promise<StepResult<unknown, unknown, MonitoringSignal>> {
    this._stepCount++;
    const result: StepResult<unknown, unknown, MonitoringSignal> = {
      output: this._defaultOutput,
      state: { ...((state as Record<string, unknown>) ?? {}), stepCount: this._stepCount },
      monitoring: { ...this._defaultMonitoring, timestamp: Date.now() },
    };
    this._recordings.push({ input, state, control, result });
    return result;
  }

  initialState(): unknown {
    return { stepCount: 0 };
  }

  /** Get all recorded step invocations. */
  get recordings(): ReadonlyArray<{
    input: unknown;
    state: unknown;
    control: ControlDirective;
    result: StepResult<unknown, unknown, MonitoringSignal>;
  }> {
    return this._recordings;
  }

  /** Get the number of times step() was called. */
  get stepCount(): number {
    return this._stepCount;
  }
}

// ── Cognitive Assertion Types ─────────────────────────────────────

export interface CognitiveAssertion {
  type: string;
  check(result: CognitiveScenarioResult): CognitiveAssertionResult;
}

export interface CognitiveAssertionResult {
  passed: boolean;
  message: string;
}

// ── Cognitive Scenario Result ─────────────────────────────────────

export interface CognitiveScenarioResult {
  name: string;
  cycleResult: CycleResult;
  modules: CycleModules;
  events: CognitiveEvent[];
  assertions: CognitiveAssertionResult[];
  passed: boolean;
}

// ── Assertion Factories ──────────────────────────────────────────

/** Assert that cycle phases executed in the expected order. */
export function cyclePhaseOrder(phases: string[]): CognitiveAssertion {
  return {
    type: 'cycle_phase_order',
    check(result: CognitiveScenarioResult): CognitiveAssertionResult {
      const actual = result.cycleResult.phasesExecuted;
      const matches = phases.every((phase, i) => actual[i] === phase);
      return {
        passed: matches,
        message: matches
          ? `Phase order matches: [${phases.join(', ')}]`
          : `Phase order mismatch: expected [${phases.join(', ')}], got [${actual.join(', ')}]`,
      };
    },
  };
}

/** Assert that the monitor intervened (MONITOR phase was executed). */
export function monitorIntervened(): CognitiveAssertion {
  return {
    type: 'monitor_intervened',
    check(result: CognitiveScenarioResult): CognitiveAssertionResult {
      const hasMonitor = result.cycleResult.phasesExecuted.includes('MONITOR');
      const hasControl = result.cycleResult.phasesExecuted.includes('CONTROL');
      const intervened = hasMonitor && hasControl;
      return {
        passed: intervened,
        message: intervened
          ? 'Monitor intervention detected (MONITOR + CONTROL phases executed)'
          : `No monitor intervention: phases were [${result.cycleResult.phasesExecuted.join(', ')}]`,
      };
    },
  };
}

/** Assert workspace entry count using a predicate. */
export function workspaceSize(predicate: (size: number) => boolean): CognitiveAssertion {
  return {
    type: 'workspace_size',
    check(result: CognitiveScenarioResult): CognitiveAssertionResult {
      // Count workspace write events
      const writeEvents = result.events.filter(
        e => e.type === 'cognitive:workspace_write',
      );
      const size = writeEvents.length;
      const passed = predicate(size);
      return {
        passed,
        message: passed
          ? `Workspace size ${size} satisfies predicate`
          : `Workspace size ${size} does not satisfy predicate`,
      };
    },
  };
}

/** Assert that a specific module's step was called a given number of times. */
export function moduleStepCount(moduleIdStr: string, count: number): CognitiveAssertion {
  return {
    type: 'module_step_count',
    check(result: CognitiveScenarioResult): CognitiveAssertionResult {
      // Find the module in the cycle modules
      const mod = Object.values(result.modules).find(
        m => (m as RecordingModule).id === moduleIdStr || (m as RecordingModule).id === moduleId(moduleIdStr),
      );
      if (!mod) {
        return {
          passed: false,
          message: `Module "${moduleIdStr}" not found in cycle modules`,
        };
      }
      const recording = mod as RecordingModule;
      const actualCount = recording.stepCount ?? 0;
      const passed = actualCount === count;
      return {
        passed,
        message: passed
          ? `Module "${moduleIdStr}" step count matches: ${count}`
          : `Module "${moduleIdStr}" step count mismatch: expected ${count}, got ${actualCount}`,
      };
    },
  };
}

// ── Default Module Factories ─────────────────────────────────────

function createDefaultModules(): CycleModules {
  return {
    observer: new RecordingModule('observer', {
      monitoring: { type: 'observer', inputProcessed: true, noveltyScore: 0.5 } as unknown as MonitoringSignal,
    }),
    memory: new RecordingModule('memory', {
      monitoring: { type: 'memory', retrievalCount: 1, relevanceScore: 0.7 } as unknown as MonitoringSignal,
    }),
    reasoner: new RecordingModule('reasoner', {
      monitoring: { type: 'reasoner', confidence: 0.8, conflictDetected: false, effortLevel: 'medium' } as unknown as MonitoringSignal,
    }),
    actor: new RecordingModule('actor', {
      defaultOutput: 'action-result',
      monitoring: { type: 'actor', actionTaken: 'respond', success: true, unexpectedResult: false } as unknown as MonitoringSignal,
    }),
    monitor: new RecordingModule('monitor', {
      monitoring: { type: 'monitor', anomalyDetected: false } as unknown as MonitoringSignal,
    }),
    evaluator: new RecordingModule('evaluator', {
      monitoring: { type: 'evaluator', estimatedProgress: 0.5, diminishingReturns: false } as unknown as MonitoringSignal,
    }),
    planner: new RecordingModule('planner', {
      monitoring: { type: 'planner', planRevised: false, subgoalCount: 1 } as unknown as MonitoringSignal,
    }),
    reflector: new RecordingModule('reflector', {
      monitoring: { type: 'reflector', lessonsExtracted: 1 } as unknown as MonitoringSignal,
    }),
  };
}

function createDefaultCycleConfig(): CycleConfig {
  return {
    thresholds: {
      type: 'predicate',
      shouldIntervene: () => false,
    },
    errorPolicy: {
      default: 'skip',
    },
    controlPolicy: {
      allowedDirectiveTypes: ['*'],
      validate: () => true,
    },
  };
}

function createDefaultWorkspaceConfig(): WorkspaceConfig {
  return {
    capacity: 100,
    writeQuotaPerModule: 20,
    defaultTtl: 60_000,
  };
}

// ── Cognitive Scenario Builder ───────────────────────────────────

export class CognitiveScenarioBuilder {
  private _name: string;
  private _workspace: WorkspaceConfig = createDefaultWorkspaceConfig();
  private _modules: Partial<CycleModules> = {};
  private _cycleConfig: Partial<CycleConfig> = {};
  private _prompt: string = '';
  private _assertions: CognitiveAssertion[] = [];

  constructor(name: string) {
    this._name = name;
  }

  /** Configure the workspace. */
  given(workspace: Partial<WorkspaceConfig>): this {
    this._workspace = { ...this._workspace, ...workspace };
    return this;
  }

  /** Provide custom modules (unspecified slots get recording stubs). */
  withModules(modules: Partial<CycleModules>): this {
    this._modules = { ...this._modules, ...modules };
    return this;
  }

  /** Override cycle configuration. */
  withCycleConfig(config: Partial<CycleConfig>): this {
    this._cycleConfig = { ...this._cycleConfig, ...config };
    return this;
  }

  /** Set the input prompt for the cognitive cycle. */
  when(prompt: string): this {
    this._prompt = prompt;
    return this;
  }

  /** Add an assertion to check against the cycle result. */
  then(assertion: CognitiveAssertion): this {
    this._assertions.push(assertion);
    return this;
  }

  /** Run the scenario: create agent, invoke cycle, check assertions. */
  async run(): Promise<CognitiveScenarioResult> {
    // Merge provided modules with defaults
    const defaults = createDefaultModules();
    const modules: CycleModules = {
      observer: this._modules.observer ?? defaults.observer,
      memory: this._modules.memory ?? defaults.memory,
      reasoner: this._modules.reasoner ?? defaults.reasoner,
      actor: this._modules.actor ?? defaults.actor,
      monitor: this._modules.monitor ?? defaults.monitor,
      evaluator: this._modules.evaluator ?? defaults.evaluator,
      planner: this._modules.planner ?? defaults.planner,
      reflector: this._modules.reflector ?? defaults.reflector,
    };

    // Merge cycle config with defaults
    const defaultConfig = createDefaultCycleConfig();
    const cycleConfig: CycleConfig = {
      thresholds: this._cycleConfig.thresholds ?? defaultConfig.thresholds,
      errorPolicy: this._cycleConfig.errorPolicy ?? defaultConfig.errorPolicy,
      controlPolicy: this._cycleConfig.controlPolicy ?? defaultConfig.controlPolicy,
      cycleBudget: this._cycleConfig.cycleBudget ?? defaultConfig.cycleBudget,
      maxConsecutiveInterventions: this._cycleConfig.maxConsecutiveInterventions ?? defaultConfig.maxConsecutiveInterventions,
    };

    // Collect events
    const events: CognitiveEvent[] = [];

    // Create the cognitive agent
    const traceSink = new InMemoryTraceSink();
    const agent = createCognitiveAgent({
      modules,
      workspace: this._workspace,
      cycle: cycleConfig,
      traceSinks: [traceSink],
      onEvent: (event) => {
        events.push(event as CognitiveEvent);
      },
    });

    // Run the cycle
    const cycleResult = await agent.invoke(this._prompt || 'test prompt');

    // Build the result (before assertions)
    const scenarioResult: CognitiveScenarioResult = {
      name: this._name,
      cycleResult,
      modules,
      events,
      assertions: [],
      passed: true,
    };

    // Run assertions
    for (const assertion of this._assertions) {
      const assertionResult = assertion.check(scenarioResult);
      scenarioResult.assertions.push(assertionResult);
      if (!assertionResult.passed) {
        scenarioResult.passed = false;
      }
    }

    return scenarioResult;
  }
}

// ── Entry Point ─────────────────────────────────────────────────

/** Create a new cognitive scenario builder. */
export function cognitiveScenario(name: string): CognitiveScenarioBuilder {
  return new CognitiveScenarioBuilder(name);
}
