/**
 * Unit tests for Planner meta-level cognitive module.
 *
 * Tests: ProviderAdapter invocation, replan trigger handling,
 * strategy-change directive production, directive structure validation.
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { moduleId } from '../../algebra/index.js';
import type {
  ProviderAdapter,
  AdapterConfig,
  ProviderAdapterResult,
  ReadonlyWorkspaceSnapshot,
  ControlDirective,
} from '../../algebra/index.js';
import { createPlanner } from '../planner.js';
import type { PlannerControl, PlannerInput } from '../planner.js';

// ── Stub ProviderAdapter ─────────────────────────────────────────────

function makeStubAdapter(output: string): ProviderAdapter {
  return {
    async invoke(
      _snapshot: ReadonlyWorkspaceSnapshot,
      _config: AdapterConfig,
    ): Promise<ProviderAdapterResult> {
      return {
        output,
        usage: {
          inputTokens: 100,
          outputTokens: 50,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          totalTokens: 150,
        },
        cost: {
          totalUsd: 0.001,
          perModel: {},
        },
      };
    },
  };
}

function makeFailingAdapter(errorMessage: string): ProviderAdapter {
  return {
    async invoke(): Promise<ProviderAdapterResult> {
      throw new Error(errorMessage);
    },
  };
}

// ── Helpers ──────────────────────────────────────────────────────────

function makeControl(replanTrigger?: string): PlannerControl {
  return {
    target: moduleId('planner'),
    timestamp: Date.now(),
    replanTrigger,
  };
}

function makeInput(): PlannerInput {
  return {
    workspace: [
      {
        source: moduleId('observer-1'),
        content: 'User wants to analyze a file',
        salience: 0.8,
        timestamp: Date.now(),
      },
    ],
  };
}

// ── Tests ────────────────────────────────────────────────────────────

describe('Planner module', () => {
  it('invokes ProviderAdapter and produces control directives', async () => {
    const planOutput = JSON.stringify({
      plan: 'Read the file, analyze contents, produce summary',
      subgoals: [
        { description: 'Read file', status: 'pending' },
        { description: 'Analyze contents', status: 'pending' },
      ],
      directives: [
        { target: 'reasoner-1', directiveType: 'strategy_shift', payload: { strategy: 'cot' } },
        { target: 'actor-1', directiveType: 'action_whitelist', payload: { actions: ['read_file'] } },
      ],
    });

    const adapter = makeStubAdapter(planOutput);
    const planner = createPlanner(adapter);
    const state = planner.initialState();

    const result = await planner.step(makeInput(), state, makeControl());

    assert.equal(result.output.plan, 'Read the file, analyze contents, produce summary');
    assert.equal(result.output.subgoals.length, 2);
    assert.equal(result.output.directives.length, 2);
    assert.equal(result.monitoring.type, 'planner');
    assert.equal(result.monitoring.subgoalCount, 2);

    // Verify directive structure
    const directive = result.output.directives[0] as ControlDirective & { directiveType: string };
    assert.equal(directive.target, moduleId('reasoner-1'));
    assert.ok(directive.timestamp > 0);
    assert.equal(directive.directiveType, 'strategy_shift');
  });

  it('triggers replan when replanTrigger control is set', async () => {
    const adapter = makeStubAdapter(JSON.stringify({
      plan: 'New plan after replan trigger',
      subgoals: [{ description: 'New goal', status: 'pending' }],
      directives: [],
    }));

    const planner = createPlanner(adapter);

    // First step: establish initial plan
    const state1 = planner.initialState();
    const r1 = await planner.step(
      makeInput(),
      state1,
      makeControl(),
    );

    // Second step: same adapter output but with replanTrigger
    const adapter2 = makeStubAdapter(JSON.stringify({
      plan: 'Revised plan due to anomaly',
      subgoals: [{ description: 'Address anomaly', status: 'active' }],
      directives: [{ target: 'reasoner-1', directiveType: 'effort_change' }],
    }));

    const planner2 = createPlanner(adapter2);
    const r2 = await planner2.step(
      makeInput(),
      r1.state,
      makeControl('anomaly detected — low confidence'),
    );

    assert.equal(r2.monitoring.planRevised, true);
    assert.equal(r2.output.plan, 'Revised plan due to anomaly');
    assert.ok(r2.state.revisionCount > r1.state.revisionCount);
  });

  it('issues strategy-change directive targeting reasoner', async () => {
    const planOutput = JSON.stringify({
      plan: 'Switch reasoner to chain-of-thought',
      subgoals: [],
      directives: [
        {
          target: 'reasoner-1',
          directiveType: 'strategy_shift',
          payload: { strategy: 'chain-of-thought' },
        },
      ],
    });

    const adapter = makeStubAdapter(planOutput);
    const planner = createPlanner(adapter);
    const state = planner.initialState();

    const result = await planner.step(makeInput(), state, makeControl());

    assert.equal(result.output.directives.length, 1);
    const directive = result.output.directives[0] as ControlDirective & {
      directiveType: string;
      payload: { strategy: string };
    };
    assert.equal(directive.target, moduleId('reasoner-1'));
    assert.equal(directive.directiveType, 'strategy_shift');
    assert.equal(directive.payload.strategy, 'chain-of-thought');
  });

  it('directive structure has target and timestamp (policy validation is the cycle orchestrator job)', async () => {
    const planOutput = JSON.stringify({
      plan: 'Produce directives',
      subgoals: [],
      directives: [
        { target: 'actor-1', directiveType: 'spawn_subagent' },
      ],
    });

    const adapter = makeStubAdapter(planOutput);
    const planner = createPlanner(adapter);
    const state = planner.initialState();

    const result = await planner.step(makeInput(), state, makeControl());

    // Planner produces the directive without validating against policy
    // (that's the cycle orchestrator's job)
    assert.equal(result.output.directives.length, 1);
    const directive = result.output.directives[0];

    // Every ControlDirective has target and timestamp
    assert.ok(directive.target);
    assert.ok(directive.timestamp > 0);

    // The directive type 'spawn_subagent' would be rejected by a policy that
    // doesn't allow it, but Planner doesn't validate — it just produces
    const typed = directive as ControlDirective & { directiveType: string };
    assert.equal(typed.directiveType, 'spawn_subagent');
  });
});
