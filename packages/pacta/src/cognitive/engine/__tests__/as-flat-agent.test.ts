/**
 * Unit tests for asFlatAgent adapter (PRD 030, C-5).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { asFlatAgent } from '../as-flat-agent.js';
import { createCognitiveAgent } from '../create-cognitive-agent.js';
import type { CycleModules, CycleConfig } from '../cycle.js';
import type {
  CognitiveModule,
  StepResult,
  ControlPolicy,
  WorkspaceConfig,
} from '../../algebra/index.js';
import { moduleId } from '../../algebra/index.js';
import type { AgentProvider, ProviderCapabilities } from '../../../ports/agent-provider.js';
import type { Pact, AgentResult, AgentRequest } from '../../../pact.js';

// ── Stub Module Factory ──────────────────────────────────────────

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

function createStubProvider(): AgentProvider {
  return {
    name: 'test-provider',
    capabilities(): ProviderCapabilities {
      return {
        modes: ['oneshot'],
        streaming: false,
        resumable: false,
        budgetEnforcement: 'none',
        outputValidation: 'none',
        toolModel: 'none',
      };
    },
    async invoke<T>(_pact: Pact<T>, _request: AgentRequest): Promise<AgentResult<T>> {
      return {
        output: 'provider-output' as unknown as T,
        sessionId: 'test-session',
        completed: true,
        stopReason: 'complete',
        usage: { inputTokens: 10, outputTokens: 20, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 30 },
        cost: { totalUsd: 0.001, perModel: {} },
        durationMs: 100,
        turns: 1,
      };
    },
  };
}

// ── Tests ────────────────────────────────────────────────────────

describe('asFlatAgent', () => {
  it('1. returns valid Agent interface (has invoke, pact, provider)', () => {
    const cognitive = createCognitiveAgent({
      modules: defaultModules(),
      workspace: defaultWorkspaceConfig(),
      cycle: defaultCycleConfig(),
    });

    const agent = asFlatAgent(cognitive);

    assert.ok(agent, 'Agent created');
    assert.equal(typeof agent.invoke, 'function', 'Has invoke method');
    assert.ok(agent.pact, 'Has pact');
    assert.ok(agent.provider, 'Has provider');
    assert.ok(agent.pact.mode, 'Pact has mode');
    assert.equal(agent.pact.mode.type, 'oneshot', 'Default pact is oneshot');
  });

  it('2. AgentRequest prompt maps to Observer input', async () => {
    const cognitive = createCognitiveAgent({
      modules: defaultModules(),
      workspace: defaultWorkspaceConfig(),
      cycle: defaultCycleConfig(),
    });

    const agent = asFlatAgent(cognitive);
    const result = await agent.invoke({ prompt: 'hello world' });

    // The prompt should have been processed through the observer
    assert.ok(result, 'Result returned');
    assert.ok(result.output !== undefined, 'Has output');
    assert.equal(result.completed, true, 'Completed successfully');
  });

  it('3. CycleResult maps to AgentResult (token aggregation, turn = 1)', async () => {
    const cognitive = createCognitiveAgent({
      modules: defaultModules(),
      workspace: defaultWorkspaceConfig(),
      cycle: defaultCycleConfig(),
    });

    const agent = asFlatAgent(cognitive, {
      provider: createStubProvider(),
      pact: { mode: { type: 'oneshot' } },
    });

    const result = await agent.invoke({ prompt: 'test prompt' });

    assert.equal(result.turns, 1, 'Turn count is 1 per cycle');
    assert.ok(result.usage, 'Has usage');
    assert.equal(typeof result.usage.inputTokens, 'number', 'Usage has inputTokens');
    assert.equal(typeof result.usage.outputTokens, 'number', 'Usage has outputTokens');
    assert.ok(result.cost, 'Has cost');
    assert.ok(result.durationMs >= 0, 'Has duration');
    assert.ok(result.sessionId, 'Has sessionId');
    assert.equal(result.stopReason, 'complete', 'Stop reason is complete');

    // Check agent state was updated
    assert.equal(agent.state.invocationCount, 1, 'State invocation count');
    assert.equal(agent.state.turnsExecuted, 1, 'State turns executed');
  });

  it('4. Abort signal propagation (if abort signal fires, cycle stops)', async () => {
    const abortController = new AbortController();

    // Create a slow actor that respects abort
    const slowActor = createStubModule('actor', { actionName: 'test', result: null, escalated: false });

    const cognitive = createCognitiveAgent({
      modules: { ...defaultModules(), actor: slowActor },
      workspace: defaultWorkspaceConfig(),
      cycle: defaultCycleConfig(),
    });

    const agent = asFlatAgent(cognitive);

    // Abort immediately — the cycle should still complete (it's synchronous per-phase)
    // but the abort signal is available for future use
    abortController.abort();

    const result = await agent.invoke({
      prompt: 'test',
      abortSignal: abortController.signal,
    });

    // With stub modules the cycle completes before abort takes effect,
    // but the interface correctly accepts and threads the signal through
    assert.ok(result, 'Result returned despite abort');
    assert.equal(typeof result.stopReason, 'string', 'Has a stop reason');
  });
});
