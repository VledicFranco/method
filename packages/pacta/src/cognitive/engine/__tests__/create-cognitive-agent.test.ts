// SPDX-License-Identifier: Apache-2.0
/**
 * Unit tests for createCognitiveAgent (PRD 030, C-5).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createCognitiveAgent } from '../create-cognitive-agent.js';
import type { CreateCognitiveAgentOptions } from '../create-cognitive-agent.js';
import type { CycleModules, CycleConfig } from '../cycle.js';
import type {
  CognitiveModule,
  MonitoringSignal,
  ControlDirective,
  StepResult,
  ControlPolicy,
  CognitiveEvent,
  WorkspaceConfig,
} from '../../algebra/index.js';
import { moduleId, CompositionError } from '../../algebra/index.js';

// ── Stub Module Factory ──────────────────────────────────────────

function createStubModule(id: string, output?: unknown): CognitiveModule<any, any, any, any, any> {
  return {
    id: moduleId(id),
    initialState() {
      return { callCount: 0 };
    },
    async step(input: any, state: any, _control: any): Promise<StepResult<any, any, any>> {
      return {
        output: output ?? { result: `${id}-output` },
        state: { callCount: (state?.callCount ?? 0) + 1 },
        monitoring: {
          source: moduleId(id),
          timestamp: Date.now(),
        },
      };
    },
  };
}

// ── Default Modules ──────────────────────────────────────────────

function defaultModules(): CycleModules {
  return {
    observer: createStubModule('observer'),
    memory: createStubModule('memory'),
    reasoner: createStubModule('reasoner'),
    actor: createStubModule('actor', { actionName: 'test', result: { output: 'done' }, escalated: false }),
    monitor: createStubModule('monitor'),
    evaluator: createStubModule('evaluator'),
    planner: createStubModule('planner', { directives: [], plan: 'test', subgoals: [] }),
    reflector: createStubModule('reflector'),
  };
}

// ── Default Config ───────────────────────────────────────────────

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

describe('createCognitiveAgent', () => {
  it('1. returns CognitiveAgent with invoke()', () => {
    const agent = createCognitiveAgent({
      modules: defaultModules(),
      workspace: defaultWorkspaceConfig(),
      cycle: defaultCycleConfig(),
    });

    assert.ok(agent, 'Agent created');
    assert.equal(typeof agent.invoke, 'function', 'Has invoke method');
    assert.equal(typeof agent.traces, 'function', 'Has traces method');
    assert.ok(agent.config, 'Has config');
  });

  it('2. CognitiveAgent.invoke() runs cycle and returns CycleResult with traces', async () => {
    const agent = createCognitiveAgent({
      modules: defaultModules(),
      workspace: defaultWorkspaceConfig(),
      cycle: defaultCycleConfig(),
    });

    const result = await agent.invoke('test prompt');

    assert.ok(result, 'Result returned');
    assert.ok(result.cycleNumber > 0, 'Has cycle number');
    assert.ok(result.phasesExecuted.length > 0, 'Phases were executed');
    assert.ok(result.traces.length > 0, 'Traces collected');
    assert.equal(result.aborted, undefined, 'Not aborted');

    // Accumulated traces should be available
    const accumulated = agent.traces();
    assert.ok(accumulated.length > 0, 'Traces accumulated');
  });

  it('3. Invalid module config throws at composition time', () => {
    // Missing a required module
    const incompleteModules = {
      observer: createStubModule('observer'),
      memory: createStubModule('memory'),
      reasoner: createStubModule('reasoner'),
      actor: createStubModule('actor'),
      monitor: createStubModule('monitor'),
      evaluator: createStubModule('evaluator'),
      planner: createStubModule('planner'),
      // reflector missing!
    } as unknown as CycleModules;

    assert.throws(
      () => createCognitiveAgent({
        modules: incompleteModules,
        workspace: defaultWorkspaceConfig(),
        cycle: defaultCycleConfig(),
      }),
      (err: Error) => {
        assert.ok(err instanceof CompositionError);
        assert.ok(err.message.includes('reflector'));
        return true;
      },
    );

    // Module with missing step()
    const badModule = {
      id: moduleId('reflector'),
      initialState: () => ({}),
      // step missing
    } as unknown as CognitiveModule<any, any, any, any, any>;

    assert.throws(
      () => createCognitiveAgent({
        modules: { ...defaultModules(), reflector: badModule },
        workspace: defaultWorkspaceConfig(),
        cycle: defaultCycleConfig(),
      }),
      (err: Error) => {
        assert.ok(err instanceof CompositionError);
        assert.ok(err.message.includes('reflector'));
        return true;
      },
    );
  });

  it('4. ControlPolicy violation emits event and rejects directive', async () => {
    const events: CognitiveEvent[] = [];

    // Planner that produces a directive
    const planner = createStubModule('planner', {
      directives: [{ target: moduleId('reasoner'), timestamp: Date.now() }],
      plan: 'test',
      subgoals: [],
    });

    // Control policy that rejects all directives
    const controlPolicy: ControlPolicy = {
      allowedDirectiveTypes: [],
      validate: () => false,
    };

    const agent = createCognitiveAgent({
      modules: { ...defaultModules(), planner },
      workspace: defaultWorkspaceConfig(),
      cycle: {
        thresholds: { type: 'predicate', shouldIntervene: () => true },
        errorPolicy: { default: 'skip' },
        controlPolicy,
      },
      onEvent: (e) => events.push(e as CognitiveEvent),
    });

    await agent.invoke('test prompt');

    // Wait a tick for async events
    await new Promise((resolve) => setTimeout(resolve, 50));

    const violations = events.filter((e) => e.type === 'cognitive:control_policy_violation');
    assert.ok(violations.length > 0, 'Policy violation event emitted');
  });

  it('5. CycleBudget exceeded stops cycle gracefully', async () => {
    const events: CognitiveEvent[] = [];

    const agent = createCognitiveAgent({
      modules: defaultModules(),
      workspace: defaultWorkspaceConfig(),
      cycle: {
        thresholds: { type: 'predicate', shouldIntervene: () => false },
        errorPolicy: { default: 'skip' },
        controlPolicy: { allowedDirectiveTypes: ['any'], validate: () => true },
        cycleBudget: {
          maxProviderCallsPerCycle: 0, // Zero budget — should abort immediately after first trace
        },
      },
      onEvent: (e) => events.push(e as CognitiveEvent),
    });

    const result = await agent.invoke('test prompt');

    // The cycle should be aborted due to budget
    assert.ok(result.aborted, 'Cycle aborted due to budget');
    assert.ok(result.aborted!.reason.includes('budget') || result.aborted!.reason.includes('Budget'),
      'Abort reason mentions budget');
  });
});
