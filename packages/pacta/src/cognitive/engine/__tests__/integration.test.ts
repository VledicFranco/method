// SPDX-License-Identifier: Apache-2.0
/**
 * Integration tests for cognitive engine (PRD 030, C-5).
 *
 * Uses real module factories from ../../modules/ to test end-to-end flows.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createCognitiveAgent } from '../create-cognitive-agent.js';
import { asFlatAgent } from '../as-flat-agent.js';
import type { CycleModules, CycleConfig } from '../cycle.js';
import type {
  CognitiveModule,
  StepResult,
  ControlPolicy,
  ControlDirective,
  MonitoringSignal,
  AggregatedSignals,
  WorkspaceConfig,
  CognitiveEvent,
  ModuleId,
  ReadonlyWorkspaceSnapshot,
} from '../../algebra/index.js';
import { moduleId, InMemoryTraceSink } from '../../algebra/index.js';
import { createObserver } from '../../modules/observer.js';
import { createMonitor } from '../../modules/monitor.js';
import { createEvaluator } from '../../modules/evaluator.js';
import type { Agent } from '../../../engine/create-agent.js';

// ── Stub Helpers for Modules That Need External Ports ────────────

/**
 * Minimal stub for modules that need ports (memory, reasoner, actor, planner, reflector).
 * These can't use real factories without real MemoryPort/ProviderAdapter/ToolProvider,
 * so we use recording stubs that behave realistically.
 */
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
      async step(input: any, state: any, control: any): Promise<StepResult<any, any, any>> {
        calls.push({ input, control });
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

// ── Workspace-Aware Module Stubs ─────────────────────────────────

/**
 * Creates a stub workspace write port for modules that need one.
 * Collects written entries for assertion.
 */
function createCollectorWritePort() {
  const written: unknown[] = [];
  return {
    port: {
      write(entry: unknown) { written.push(entry); },
    },
    written,
  };
}

// ── Default Config Helpers ───────────────────────────────────────

function defaultControlPolicy(): ControlPolicy {
  return {
    allowedDirectiveTypes: ['any'],
    validate: () => true,
  };
}

function defaultWorkspaceConfig(): WorkspaceConfig {
  return { capacity: 100 };
}

// ── Tests ────────────────────────────────────────────────────────

describe('integration', () => {
  it('1. Full CognitiveAgent with stub modules: prompt -> cycle -> result end-to-end', async () => {
    // Use real observer with a stub write port
    const collector = createCollectorWritePort();
    const observer = createObserver(collector.port);

    const modules: CycleModules = {
      observer,
      memory: createRecordingModule('memory', { entries: [], count: 0 }, { type: 'memory' } as any),
      reasoner: createRecordingModule('reasoner', { trace: 'reasoning output', confidence: 0.7, conflictDetected: false }, { type: 'reasoner', confidence: 0.7, conflictDetected: false, effortLevel: 'medium' } as any),
      actor: createRecordingModule('actor', { actionName: 'test-action', result: { output: 'done' }, escalated: false }, { type: 'actor', actionTaken: 'test', success: true, unexpectedResult: false } as any),
      monitor: createRecordingModule('monitor', { anomalies: [], escalation: undefined }, { type: 'monitor', anomalyDetected: false } as any),
      evaluator: createRecordingModule('evaluator', { estimatedProgress: 0.5, diminishingReturns: false }, { type: 'evaluator', estimatedProgress: 0.5, diminishingReturns: false } as any),
      planner: createRecordingModule('planner', { directives: [], plan: 'continue', subgoals: [] }, { type: 'planner', planRevised: false, subgoalCount: 0 } as any),
      reflector: createRecordingModule('reflector', { lessons: [] }, { type: 'reflector', lessonsExtracted: 0 } as any),
    };

    const config: CycleConfig = {
      thresholds: { type: 'predicate', shouldIntervene: () => false },
      errorPolicy: { default: 'skip' },
      controlPolicy: defaultControlPolicy(),
    };

    const traceSink = new InMemoryTraceSink();
    const agent = createCognitiveAgent({
      modules,
      workspace: defaultWorkspaceConfig(),
      cycle: config,
      traceSinks: [traceSink],
    });

    const result = await agent.invoke('Hello, cognitive agent!');

    // Verify end-to-end flow
    assert.ok(result.cycleNumber > 0, 'Cycle number assigned');
    assert.ok(result.phasesExecuted.includes('OBSERVE'), 'Observer ran');
    assert.ok(result.phasesExecuted.includes('ACT'), 'Actor ran');
    assert.equal(result.aborted, undefined, 'Not aborted');
    assert.ok(result.traces.length > 0, 'Traces were collected');

    // Observer should have written to workspace (via the collector)
    assert.ok(collector.written.length > 0, 'Observer wrote to workspace');

    // Trace sink should have received traces
    assert.ok(traceSink.traces().length > 0, 'TraceSink received traces');
  });

  it('2. Monitor intervenes mid-cycle, resulting in control directives being produced', async () => {
    const events: CognitiveEvent[] = [];

    // Use real monitor module
    const monitor = createMonitor({ confidenceThreshold: 0.3 });
    // Use real evaluator module
    const evaluator = createEvaluator({ diminishingReturnsWindow: 3 });

    // Planner that produces control directives
    const planner = createRecordingModule(
      'planner',
      {
        directives: [
          { target: moduleId('reasoner'), timestamp: Date.now(), strategy: 'think' },
        ],
        plan: 'switch to think strategy',
        subgoals: [{ description: 'improve reasoning', status: 'active' }],
      },
      { type: 'planner', planRevised: true, subgoalCount: 1 } as any,
    );

    // Reasoner with low confidence -> will trigger monitor
    const reasoner = createRecordingModule(
      'reasoner',
      { trace: 'uncertain reasoning', confidence: 0.2, conflictDetected: true },
      { type: 'reasoner', confidence: 0.2, conflictDetected: true, effortLevel: 'medium' } as any,
    );

    const collector = createCollectorWritePort();
    const modules: CycleModules = {
      observer: createObserver(collector.port),
      memory: createRecordingModule('memory', { entries: [], count: 0 }),
      reasoner,
      actor: createRecordingModule('actor', { actionName: 'test', result: { output: 'ok' }, escalated: false }),
      monitor,
      evaluator,
      planner,
      reflector: createRecordingModule('reflector', { lessons: [] }),
    };

    const config: CycleConfig = {
      thresholds: {
        type: 'field',
        rules: [
          { source: moduleId('reasoner'), field: 'confidence', operator: '<', value: 0.5 },
        ],
      },
      errorPolicy: { default: 'skip' },
      controlPolicy: defaultControlPolicy(),
    };

    const agent = createCognitiveAgent({
      modules,
      workspace: defaultWorkspaceConfig(),
      cycle: config,
      onEvent: (e) => events.push(e as CognitiveEvent),
    });

    const result = await agent.invoke('Reason about this uncertain situation');

    // Monitor and Control should have fired
    assert.ok(result.phasesExecuted.includes('MONITOR'), 'MONITOR phase executed');
    assert.ok(result.phasesExecuted.includes('CONTROL'), 'CONTROL phase executed');

    // Control directive events should have been emitted
    const directiveEvents = events.filter((e) => e.type === 'cognitive:control_directive');
    assert.ok(directiveEvents.length > 0, 'Control directive events emitted');
  });

  it('3. asFlatAgent() used where Agent is expected — full round-trip', async () => {
    const collector = createCollectorWritePort();
    const modules: CycleModules = {
      observer: createObserver(collector.port),
      memory: createRecordingModule('memory', { entries: [], count: 0 }),
      reasoner: createRecordingModule('reasoner', { trace: 'ok', confidence: 0.9, conflictDetected: false }),
      actor: createRecordingModule('actor', { actionName: 'respond', result: { output: 'Final answer' }, escalated: false }),
      monitor: createRecordingModule('monitor'),
      evaluator: createRecordingModule('evaluator'),
      planner: createRecordingModule('planner', { directives: [], plan: 'ok', subgoals: [] }),
      reflector: createRecordingModule('reflector', { lessons: [] }),
    };

    const config: CycleConfig = {
      thresholds: { type: 'predicate', shouldIntervene: () => false },
      errorPolicy: { default: 'skip' },
      controlPolicy: defaultControlPolicy(),
    };

    const cognitive = createCognitiveAgent({
      modules,
      workspace: defaultWorkspaceConfig(),
      cycle: config,
    });

    // Adapt to flat Agent interface
    const agent: Agent = asFlatAgent(cognitive, {
      pact: { mode: { type: 'oneshot' } },
    });

    // Use as a regular Agent
    assert.ok(agent.pact, 'Has pact');
    assert.equal(agent.pact.mode.type, 'oneshot', 'Pact mode is oneshot');

    const result = await agent.invoke({ prompt: 'What is 2+2?' });

    assert.ok(result.completed, 'Completed');
    assert.equal(result.stopReason, 'complete', 'Complete stop reason');
    assert.equal(result.turns, 1, 'One turn per cognitive cycle');
    assert.ok(result.sessionId, 'Has session ID');
    assert.ok(result.usage, 'Has usage');
    assert.ok(result.cost, 'Has cost');
    assert.ok(result.durationMs >= 0, 'Has duration');

    // Agent state should reflect the invocation
    assert.equal(agent.state.invocationCount, 1, 'One invocation');
    assert.equal(agent.state.turnsExecuted, 1, 'One turn');
  });
});
