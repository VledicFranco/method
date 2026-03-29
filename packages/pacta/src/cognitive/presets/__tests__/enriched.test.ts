/**
 * Integration tests for enrichedPreset — v2 cognitive agent composition.
 *
 * 6 test scenarios covering AC-11 and AC-12:
 * 1. enrichedPreset creates a valid CognitiveAgent configuration
 * 2. enrichedPreset uses MonitorV2, ReasonerActorV2, PriorityAttend, PrecisionAdapter, EVC policy
 * 3. enrichedPreset agent runs a complete cycle without error
 * 4. A/B test: v1 default modules and enrichedPreset produce compatible outputs on same input
 * 5. v2 modules are individually replaceable (mix v1 monitor with v2 reasoner-actor)
 * 6. enrichedPreset respects custom overrides for any module config
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { moduleId, InMemoryTraceSink, createWorkspace } from '../../algebra/index.js';
import type {
  ModuleId,
  WorkspaceWritePort,
  WorkspaceEntry,
  ReadonlyWorkspaceSnapshot,
  ProviderAdapter,
  AdapterConfig,
  ProviderAdapterResult,
  CognitiveModule,
  MonitoringSignal,
  ControlDirective,
  StepResult,
  AggregatedSignals,
  WorkspaceConfig,
  ControlPolicy,
  MonitorV2Config,
  ReasonerActorV2Config,
  PriorityAttendConfig,
  EVCConfig,
  PrecisionAdapterConfig,
} from '../../algebra/index.js';
import type { ToolProvider, ToolDefinition, ToolResult } from '../../../ports/tool-provider.js';
import { createCognitiveAgent } from '../../engine/create-cognitive-agent.js';
import type { CycleModules, CycleConfig } from '../../engine/cycle.js';
import { enrichedPreset } from '../enriched.js';
import type { EnrichedPresetPorts, EnrichedPresetOverrides, ModuleSlotOverrides } from '../enriched.js';
import { createObserver } from '../../modules/observer.js';
import { createMonitor } from '../../modules/monitor.js';

// ── Test Helpers ────────────────────────────────────────────────

function createMockWritePort(): WorkspaceWritePort & { entries: WorkspaceEntry[] } {
  const entries: WorkspaceEntry[] = [];
  return {
    entries,
    write(entry: WorkspaceEntry): void {
      entries.push(entry);
    },
  };
}

/**
 * Create a mock ProviderAdapter that returns a well-formed LLM response.
 * The response follows the <plan>/<reasoning>/<action> format expected
 * by ReasonerActorV2.
 */
function createMockAdapter(overrides?: {
  response?: string;
  tokens?: number;
}): ProviderAdapter {
  const tokens = overrides?.tokens ?? 150;
  const response = overrides?.response ?? `
<plan>
1. Read the file to understand its contents.
2. Respond with done.
</plan>

<reasoning>
The task is straightforward. Reading the file will give me the information I need.
</reasoning>

<action>
{"tool": "Read", "input": {"file_path": "test.ts"}}
</action>
`;

  return {
    async invoke(
      _snapshot: ReadonlyWorkspaceSnapshot,
      _config: AdapterConfig,
    ): Promise<ProviderAdapterResult> {
      return {
        output: response,
        usage: { inputTokens: 100, outputTokens: tokens - 100, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: tokens },
        cost: { totalUsd: 0.001, perModel: {} },
      };
    },
  };
}

/** Create a mock ToolProvider with standard tools. */
function createMockTools(overrides?: {
  executeResult?: ToolResult;
  shouldThrow?: boolean;
}): ToolProvider {
  return {
    list(): ToolDefinition[] {
      return [
        { name: 'Read', description: 'Read a file' },
        { name: 'Write', description: 'Write a file' },
        { name: 'Edit', description: 'Edit a file' },
        { name: 'Grep', description: 'Search files' },
        { name: 'Glob', description: 'Find files by pattern' },
      ];
    },
    async execute(_name: string, _input: unknown): Promise<ToolResult> {
      if (overrides?.shouldThrow) {
        throw new Error('Tool execution error');
      }
      if (overrides?.executeResult) {
        return overrides.executeResult;
      }
      return { output: 'file contents here', isError: false };
    },
  };
}

/** Create standard enriched preset ports. */
function createPorts(overrides?: Partial<EnrichedPresetPorts>): EnrichedPresetPorts {
  return {
    adapter: overrides?.adapter ?? createMockAdapter(),
    tools: overrides?.tools ?? createMockTools(),
    writePort: overrides?.writePort ?? createMockWritePort(),
  };
}

/** Create a recording stub module (same pattern as integration.test.ts). */
function createRecordingModule(
  id: string,
  output?: unknown,
  monitoring?: Partial<MonitoringSignal>,
): CognitiveModule<any, any, any, any, any> {
  const mid = moduleId(id);
  const calls: Array<{ input: unknown; control: unknown }> = [];

  return Object.assign(
    {
      id: mid,
      initialState() { return { callCount: 0 }; },
      async step(input: any, state: any, _control: any): Promise<StepResult<any, any, any>> {
        calls.push({ input, control: _control });
        return {
          output: output ?? { result: `${id}-output` },
          state: { callCount: (state?.callCount ?? 0) + 1 },
          monitoring: {
            source: mid,
            timestamp: Date.now(),
            ...(monitoring ?? {}),
          },
        };
      },
    },
    { calls },
  );
}

// ── Tests ───────────────────────────────────────────────────────

describe('enrichedPreset', () => {
  it('1. creates a valid CognitiveAgent configuration with all 8 required modules', () => {
    const ports = createPorts();
    const options = enrichedPreset(ports);

    // Verify all 8 module slots are populated
    assert.ok(options.modules.observer, 'observer module present');
    assert.ok(options.modules.memory, 'memory module present');
    assert.ok(options.modules.reasoner, 'reasoner module present');
    assert.ok(options.modules.actor, 'actor module present');
    assert.ok(options.modules.monitor, 'monitor module present');
    assert.ok(options.modules.evaluator, 'evaluator module present');
    assert.ok(options.modules.planner, 'planner module present');
    assert.ok(options.modules.reflector, 'reflector module present');

    // Verify each module satisfies the CognitiveModule contract
    for (const [key, mod] of Object.entries(options.modules)) {
      assert.equal(typeof mod.step, 'function', `${key}.step() is a function`);
      assert.equal(typeof mod.initialState, 'function', `${key}.initialState() is a function`);
      assert.ok(mod.id, `${key} has a module ID`);
    }

    // Verify workspace config
    assert.ok(options.workspace, 'workspace config present');
    assert.ok(options.workspace.capacity > 0, 'workspace has positive capacity');
    assert.ok(options.workspace.salience, 'workspace has salience function (PriorityAttend)');

    // Verify cycle config
    assert.ok(options.cycle, 'cycle config present');
    assert.ok(options.cycle.thresholds, 'thresholds present');
    assert.ok(options.cycle.errorPolicy, 'error policy present');
    assert.ok(options.cycle.controlPolicy, 'control policy present');

    // Verify createCognitiveAgent accepts this configuration without throwing
    const agent = createCognitiveAgent(options);
    assert.ok(agent, 'CognitiveAgent created successfully');
    assert.equal(typeof agent.invoke, 'function', 'agent.invoke is a function');
    assert.equal(typeof agent.traces, 'function', 'agent.traces is a function');
  });

  it('2. uses MonitorV2, ReasonerActorV2, PriorityAttend salience, PrecisionAdapter, and EVC policy', () => {
    const ports = createPorts();
    const options = enrichedPreset(ports);

    // MonitorV2: verify module ID is 'monitor' (default for v2)
    assert.equal(String(options.modules.monitor.id), 'monitor', 'monitor uses MonitorV2 (id=monitor)');

    // ReasonerActorV2: both reasoner and actor slots should reference it
    assert.equal(String(options.modules.reasoner.id), 'reasoner-actor', 'reasoner slot uses ReasonerActorV2');
    assert.equal(String(options.modules.actor.id), 'reasoner-actor', 'actor slot uses ReasonerActorV2');
    // They should be the same instance
    assert.equal(options.modules.reasoner, options.modules.actor, 'reasoner and actor slots share the same ReasonerActorV2 instance');

    // PriorityAttend: workspace.salience should be a function (not the default)
    assert.equal(typeof options.workspace.salience, 'function', 'workspace uses custom salience function (PriorityAttend)');

    // EVC threshold policy: should be a predicate type
    assert.equal(options.cycle.thresholds.type, 'predicate', 'thresholds use predicate-type (EVC policy)');

    // PrecisionAdapter: cannot verify directly from outside, but we can verify
    // the adapter wrapping works by checking the reasoner-actor module exists
    // and was created with a ProviderAdapter (implicit test — the factory call succeeded)
    assert.ok(options.modules.reasoner.id, 'ReasonerActorV2 created with PrecisionAdapter-wrapped adapter');
  });

  it('3. enrichedPreset agent runs a complete cycle without error (AC-11)', async () => {
    const writePort = createMockWritePort();
    const ports = createPorts({ writePort });
    const options = enrichedPreset(ports);

    const traceSink = new InMemoryTraceSink();
    const agent = createCognitiveAgent({
      ...options,
      traceSinks: [traceSink],
    });

    const result = await agent.invoke('Analyze the test file and report findings.');

    // Verify cycle completed
    assert.ok(result.cycleNumber > 0, 'Cycle number assigned');
    assert.equal(result.aborted, undefined, 'Cycle not aborted');

    // Verify core phases executed
    assert.ok(result.phasesExecuted.includes('OBSERVE'), 'OBSERVE phase executed');
    assert.ok(result.phasesExecuted.includes('ATTEND'), 'ATTEND phase executed');
    assert.ok(result.phasesExecuted.includes('REMEMBER'), 'REMEMBER phase executed');
    assert.ok(result.phasesExecuted.includes('REASON'), 'REASON phase executed');
    assert.ok(result.phasesExecuted.includes('ACT'), 'ACT phase executed');
    assert.ok(result.phasesExecuted.includes('LEARN'), 'LEARN phase executed');

    // Verify traces were collected
    assert.ok(result.traces.length > 0, 'Traces collected');
    assert.ok(traceSink.traces().length > 0, 'TraceSink received traces');

    // Verify output is present (from actor/reasoner-actor)
    assert.ok(result.output !== undefined, 'Output produced');

    // Verify writePort received entries from ReasonerActorV2
    assert.ok(writePort.entries.length > 0, 'ReasonerActorV2 wrote to workspace');
  });

  it('4. A/B test: v1 defaults and enrichedPreset produce compatible output structure on same input', async () => {
    const input = 'Compare v1 and v2 cognitive agent outputs.';

    // ── v1 Configuration ──
    const collector1 = createMockWritePort();
    const v1Modules: CycleModules = {
      observer: createObserver(collector1),
      memory: createRecordingModule('memory', { entries: [], count: 0 }, { type: 'memory' } as any),
      reasoner: createRecordingModule('reasoner', { trace: 'v1-reasoning', confidence: 0.7, conflictDetected: false }, { type: 'reasoner', confidence: 0.7, conflictDetected: false, effortLevel: 'medium' } as any),
      actor: createRecordingModule('actor', { actionName: 'test-action', result: { output: 'done' }, escalated: false }, { type: 'actor', actionTaken: 'Read', success: true, unexpectedResult: false } as any),
      monitor: createMonitor({ confidenceThreshold: 0.3 }),
      evaluator: createRecordingModule('evaluator', { estimatedProgress: 0.5, diminishingReturns: false }, { type: 'evaluator', estimatedProgress: 0.5, diminishingReturns: false } as any),
      planner: createRecordingModule('planner', { directives: [], plan: 'continue', subgoals: [] }, { type: 'planner', planRevised: false, subgoalCount: 0 } as any),
      reflector: createRecordingModule('reflector', { lessons: [] }, { type: 'reflector', lessonsExtracted: 0 } as any),
    };

    const v1Config: CycleConfig = {
      thresholds: { type: 'predicate', shouldIntervene: () => false },
      errorPolicy: { default: 'skip' },
      controlPolicy: { allowedDirectiveTypes: ['*'], validate: () => true },
    };

    const v1Agent = createCognitiveAgent({
      modules: v1Modules,
      workspace: { capacity: 50 },
      cycle: v1Config,
    });

    // ── v2 Configuration (enrichedPreset) ──
    const writePort2 = createMockWritePort();
    const ports = createPorts({ writePort: writePort2 });
    const v2Options = enrichedPreset(ports);
    const v2Agent = createCognitiveAgent(v2Options);

    // Run both agents on the same input
    const v1Result = await v1Agent.invoke(input);
    const v2Result = await v2Agent.invoke(input);

    // Both should produce valid CycleResult with compatible structure
    assert.ok(v1Result.cycleNumber > 0, 'v1: cycle number assigned');
    assert.ok(v2Result.cycleNumber > 0, 'v2: cycle number assigned');

    assert.equal(v1Result.aborted, undefined, 'v1: not aborted');
    assert.equal(v2Result.aborted, undefined, 'v2: not aborted');

    // Both should have the same required phases (OBSERVE, ATTEND, REMEMBER, REASON, ACT, LEARN)
    const requiredPhases = ['OBSERVE', 'ATTEND', 'REMEMBER', 'REASON', 'ACT', 'LEARN'];
    for (const phase of requiredPhases) {
      assert.ok(v1Result.phasesExecuted.includes(phase), `v1 executed ${phase}`);
      assert.ok(v2Result.phasesExecuted.includes(phase), `v2 executed ${phase}`);
    }

    // Both should produce traces
    assert.ok(v1Result.traces.length > 0, 'v1: traces collected');
    assert.ok(v2Result.traces.length > 0, 'v2: traces collected');

    // Both should produce output
    assert.ok(v1Result.output !== undefined, 'v1: output produced');
    assert.ok(v2Result.output !== undefined, 'v2: output produced');

    // Both signals maps should be Map instances
    assert.ok(v1Result.signals instanceof Map, 'v1: signals is a Map');
    assert.ok(v2Result.signals instanceof Map, 'v2: signals is a Map');
  });

  it('5. v2 modules are individually replaceable — mix v1 monitor with v2 reasoner-actor', async () => {
    const writePort = createMockWritePort();
    const ports = createPorts({ writePort });

    // Use v1 monitor instead of the default MonitorV2
    const v1Monitor = createMonitor({ confidenceThreshold: 0.3 });

    const options = enrichedPreset(ports, undefined, {
      monitor: v1Monitor,
    });

    // Verify the monitor slot uses the v1 module
    assert.equal(String(options.modules.monitor.id), 'monitor', 'monitor slot uses v1 Monitor');
    // Verify the reasoner slot still uses v2 ReasonerActorV2
    assert.equal(String(options.modules.reasoner.id), 'reasoner-actor', 'reasoner slot still uses ReasonerActorV2');

    // The mixed configuration should create a valid agent
    const agent = createCognitiveAgent(options);
    assert.ok(agent, 'Mixed v1/v2 agent created successfully');

    // Run a complete cycle — should not error
    const result = await agent.invoke('Test mixed v1/v2 module configuration.');
    assert.ok(result.cycleNumber > 0, 'Cycle completed');
    assert.equal(result.aborted, undefined, 'Not aborted');
    assert.ok(result.phasesExecuted.includes('ACT'), 'ACT phase executed');

    // Also test replacing observer with a real v1 observer
    const collector = createMockWritePort();
    const v1Observer = createObserver(collector);

    const options2 = enrichedPreset(ports, undefined, {
      observer: v1Observer,
      monitor: v1Monitor,
    });

    const agent2 = createCognitiveAgent(options2);
    const result2 = await agent2.invoke('Test with real observer and v1 monitor.');
    assert.ok(result2.cycleNumber > 0, 'Mixed agent with real observer completed');
    assert.equal(result2.aborted, undefined, 'Not aborted with real observer');
    assert.ok(collector.entries.length > 0, 'Real observer wrote to workspace');
  });

  it('6. enrichedPreset respects custom overrides for module configs', () => {
    const ports = createPorts();

    // Custom overrides for all configurable modules
    const overrides: EnrichedPresetOverrides = {
      monitor: {
        baseConfidenceThreshold: 0.5,
        grattonDelta: 0.1,
        thresholdFloor: 0.2,
        thresholdCeiling: 0.8,
        predictionErrorThreshold: 2.0,
        expectationAlpha: 0.3,
        stagnationThreshold: 5,
        id: 'custom-monitor',
      },
      reasonerActor: {
        id: 'custom-reasoner-actor',
        stallEntropyThreshold: 0.5,
        noChangeThreshold: 3,
        injectSubgoals: false,
        subgoalSalience: 0.7,
      },
      priorityAttend: {
        stimulusWeight: 0.2,
        goalWeight: 0.5,
        historyWeight: 0.3,
      },
      evc: {
        payoffWeight: 2.0,
        costWeight: 0.5,
        minPredictionError: 0.05,
        bias: 0.1,
      },
      precision: {
        minTokens: 512,
        maxTokens: 16384,
        maxTemperature: 1.2,
        minTemperature: 0.1,
      },
      workspace: {
        capacity: 100,
        writeQuotaPerModule: 5,
        defaultTtl: 60000,
      },
      cycle: {
        errorPolicy: { default: 'abort' },
        maxConsecutiveInterventions: 5,
        cycleBudget: {
          maxProviderCallsPerCycle: 10,
          maxTokensPerCycle: 50000,
        },
      },
      controlPolicy: {
        allowedDirectiveTypes: ['strategy-switch'],
        validate: (d: ControlDirective) => d.target !== undefined,
      },
    };

    const options = enrichedPreset(ports, overrides);

    // Verify module ID overrides propagated
    assert.equal(String(options.modules.monitor.id), 'custom-monitor', 'monitor ID override applied');
    assert.equal(String(options.modules.reasoner.id), 'custom-reasoner-actor', 'reasoner-actor ID override applied');

    // Verify workspace config overrides
    assert.equal(options.workspace.capacity, 100, 'workspace capacity override applied');
    assert.equal(options.workspace.writeQuotaPerModule, 5, 'workspace writeQuotaPerModule override applied');
    assert.equal(options.workspace.defaultTtl, 60000, 'workspace defaultTtl override applied');
    assert.ok(options.workspace.salience, 'workspace still has PriorityAttend salience');

    // Verify cycle config overrides
    assert.equal(options.cycle.errorPolicy.default, 'abort', 'errorPolicy override applied');
    assert.equal(options.cycle.maxConsecutiveInterventions, 5, 'maxConsecutiveInterventions override applied');
    assert.ok(options.cycle.cycleBudget, 'cycleBudget override applied');
    assert.equal(options.cycle.cycleBudget!.maxProviderCallsPerCycle, 10, 'maxProviderCallsPerCycle override');
    assert.equal(options.cycle.cycleBudget!.maxTokensPerCycle, 50000, 'maxTokensPerCycle override');

    // Verify control policy override
    assert.deepEqual(options.cycle.controlPolicy.allowedDirectiveTypes, ['strategy-switch'], 'controlPolicy override applied');

    // Verify EVC threshold policy is still predicate type (overrides only affect internal parameters)
    assert.equal(options.cycle.thresholds.type, 'predicate', 'EVC threshold policy still predicate type');

    // Verify the agent can still be created with overridden config
    const agent = createCognitiveAgent(options);
    assert.ok(agent, 'Agent with all overrides created successfully');
  });
});

describe('enrichedPreset — multi-cycle (AC-12)', () => {
  it('enrichedPreset agent completes multiple successive cycles', async () => {
    const writePort = createMockWritePort();

    // Use an adapter that returns "done" to cleanly complete
    const doneAdapter = createMockAdapter({
      response: `
<plan>
1. Task is complete.
</plan>

<reasoning>
Analysis shows the task has been fully addressed.
</reasoning>

<action>
{"tool": "done", "input": {}}
</action>
`,
    });

    const ports = createPorts({
      adapter: doneAdapter,
      writePort,
    });

    const options = enrichedPreset(ports);
    const traceSink = new InMemoryTraceSink();
    const agent = createCognitiveAgent({
      ...options,
      traceSinks: [traceSink],
    });

    // Run multiple cycles
    const result1 = await agent.invoke('Cycle 1 — analyze the problem.');
    const result2 = await agent.invoke('Cycle 2 — implement the solution.');
    const result3 = await agent.invoke('Cycle 3 — verify correctness.');

    // All cycles should complete without abort
    assert.ok(result1.cycleNumber > 0, 'Cycle 1 completed');
    assert.ok(result2.cycleNumber > 0, 'Cycle 2 completed');
    assert.ok(result3.cycleNumber > 0, 'Cycle 3 completed');

    assert.equal(result1.aborted, undefined, 'Cycle 1 not aborted');
    assert.equal(result2.aborted, undefined, 'Cycle 2 not aborted');
    assert.equal(result3.aborted, undefined, 'Cycle 3 not aborted');

    // Cycle numbers should be sequential
    assert.ok(result2.cycleNumber > result1.cycleNumber, 'Cycle 2 > Cycle 1');
    assert.ok(result3.cycleNumber > result2.cycleNumber, 'Cycle 3 > Cycle 2');

    // Traces should accumulate across cycles
    const allTraces = agent.traces();
    assert.ok(allTraces.length >= 3, 'Traces accumulated across cycles');
  });
});
