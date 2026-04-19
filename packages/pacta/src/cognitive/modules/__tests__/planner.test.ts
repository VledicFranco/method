// SPDX-License-Identifier: Apache-2.0
/**
 * Unit tests for Planner cognitive module.
 *
 * Tests: TaskAssessment production at cycle 0, re-plan trigger handling,
 * working memory persistence, directive production, fallback on LLM failure,
 * state invariant validation.
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { moduleId } from '../../algebra/index.js';
import type {
  ProviderAdapter,
  AdapterConfig,
  ProviderAdapterResult,
  ReadonlyWorkspaceSnapshot,
  GoalRepresentation,
  ControlDirective,
} from '../../algebra/index.js';
import { createPlanner, parseChecksBlock, buildCheckableKPIs } from '../planner.js';
import type { PlannerControl, PlannerInput, PlannerState, ParsedCheck } from '../planner.js';
import type { VerificationState } from '../../algebra/index.js';

// ── Stub ProviderAdapter ─────────────────────────────────────────────

/**
 * Creates a stub adapter that returns a predictable assessment XML response.
 * Mirrors the format expected by assessTaskWithLLM()'s parser.
 */
function makeAssessmentAdapter(overrides?: {
  difficulty?: string;
  estimatedCycles?: number;
  solvability?: number;
}): ProviderAdapter {
  const difficulty = overrides?.difficulty ?? 'medium';
  const cycles = overrides?.estimatedCycles ?? 8;
  const solvability = overrides?.solvability ?? 0.75;

  const output = `<assessment>
<difficulty>${difficulty}</difficulty>
<estimated_cycles>${cycles}</estimated_cycles>
<solvability>${solvability}</solvability>
<phases>
<phase name="explore" start="1" end="3">reading files to understand the problem</phase>
<phase name="execute" start="4" end="6">creating and modifying files</phase>
<phase name="verify" start="7" end="${cycles}">checking work</phase>
</phases>
<kpis>
<kpi>target file created</kpi>
<kpi>tests pass</kpi>
</kpis>
</assessment>`;

  return {
    async invoke(
      _snapshot: ReadonlyWorkspaceSnapshot,
      _config: AdapterConfig,
    ): Promise<ProviderAdapterResult> {
      return {
        output,
        usage: {
          inputTokens: 200,
          outputTokens: 100,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          totalTokens: 300,
        },
        cost: { totalUsd: 0.002, perModel: {} },
      };
    },
  };
}

/**
 * Creates a stub adapter that returns a JSON replan response.
 */
function makeReplanAdapter(planOutput: {
  plan: string;
  subgoals?: Array<{ description: string; status?: string }>;
  directives?: Array<{ target: string; directiveType: string; payload?: unknown }>;
}): ProviderAdapter {
  let callCount = 0;
  return {
    async invoke(
      _snapshot: ReadonlyWorkspaceSnapshot,
      _config: AdapterConfig,
    ): Promise<ProviderAdapterResult> {
      callCount++;
      // First call is for cycle 0 assessment — return assessment XML
      if (callCount === 1) {
        return {
          output: `<assessment>
<difficulty>medium</difficulty>
<estimated_cycles>10</estimated_cycles>
<solvability>0.70</solvability>
<phases>
<phase name="explore" start="1" end="4">reading files</phase>
<phase name="execute" start="5" end="8">writing code</phase>
<phase name="verify" start="9" end="10">checking</phase>
</phases>
<kpis>
<kpi>code written</kpi>
</kpis>
</assessment>`,
          usage: {
            inputTokens: 200,
            outputTokens: 100,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            totalTokens: 300,
          },
          cost: { totalUsd: 0.002, perModel: {} },
        };
      }
      // Subsequent calls are replan requests — return JSON
      return {
        output: JSON.stringify(planOutput),
        usage: {
          inputTokens: 150,
          outputTokens: 80,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          totalTokens: 230,
        },
        cost: { totalUsd: 0.001, perModel: {} },
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

function makeGoal(overrides?: Partial<GoalRepresentation>): GoalRepresentation {
  return {
    objective: 'Implement the Planner module with typed algebra surfaces',
    constraints: ['Do not modify existing files', 'Use node:test for testing'],
    subgoals: [
      { description: 'Create planner.ts', satisfied: false },
      { description: 'Create planner.test.ts', satisfied: false },
    ],
    aspiration: 0.80,
    ...overrides,
  };
}

function makeControl(replanTrigger?: string): PlannerControl {
  return {
    target: moduleId('planner'),
    timestamp: Date.now(),
    replanTrigger,
  };
}

function makeInput(goal?: GoalRepresentation): PlannerInput {
  return {
    workspace: [
      {
        source: moduleId('observer-1'),
        content: 'User wants to implement a new cognitive module',
        salience: 0.8,
        timestamp: Date.now(),
      },
    ],
    goal,
  };
}

// ── Tests ────────────────────────────────────────────────────────────

describe('Planner module', () => {

  describe('cycle 0 — TaskAssessment production', () => {

    it('produces a TaskAssessment at cycle 0 from goal representation', async () => {
      const adapter = makeAssessmentAdapter();
      const planner = createPlanner(adapter);
      const state = planner.initialState();
      const goal = makeGoal();

      const result = await planner.step(makeInput(goal), state, makeControl());

      // Assessment should be present
      assert.ok(result.output.assessment, 'assessment should be produced');
      assert.equal(result.output.assessment!.difficulty, 'medium');
      assert.equal(result.output.assessment!.estimatedCycles, 8);
      assert.equal(result.output.assessment!.solvabilityPrior, 0.75);
      assert.equal(result.output.assessment!.phases.length, 3);
      assert.equal(result.output.assessment!.kpis.length, 2);

      // Plan should be derived from assessment
      assert.ok(result.output.plan.length > 0, 'plan should be non-empty');
      assert.ok(result.output.plan.includes('medium'), 'plan should mention difficulty');

      // Monitoring signal
      assert.equal(result.monitoring.type, 'planner');
      assert.equal(result.monitoring.planRevised, true);
      assert.ok(result.monitoring.subgoalCount > 0);

      // Tokens consumed
      assert.ok(result.output.tokensUsed > 0, 'should report tokens used');

      // State updated
      assert.ok(result.state.assessment, 'assessment persisted in state');
      assert.equal(result.state.cycleCount, 1);
      assert.equal(result.state.revisionCount, 1);
      assert.ok(result.state.goal, 'goal persisted in state');
    });

    it('produces default assessment when no goal is provided', async () => {
      const adapter = makeAssessmentAdapter();
      const planner = createPlanner(adapter, { maxCycles: 12 });
      const state = planner.initialState();

      const result = await planner.step(makeInput(), state, makeControl());

      assert.ok(result.output.assessment, 'should fall back to default assessment');
      assert.equal(result.output.assessment!.difficulty, 'medium');
      assert.equal(result.output.assessment!.estimatedCycles, 12);
      assert.equal(result.output.planRevised, true);
    });

    it('uses assessment phases to derive subgoals from goal + KPIs', async () => {
      const adapter = makeAssessmentAdapter();
      const planner = createPlanner(adapter);
      const state = planner.initialState();
      const goal = makeGoal({
        subgoals: [
          { description: 'Create planner.ts', satisfied: false },
          { description: 'Write tests', satisfied: true },
        ],
      });

      const result = await planner.step(makeInput(goal), state, makeControl());

      // Subgoals = goal's subgoals + assessment KPIs
      const subgoals = result.output.subgoals;
      assert.ok(subgoals.length >= 3, `expected >= 3 subgoals, got ${subgoals.length}`);

      // Goal subgoal statuses should be preserved
      const createPlanner_sg = subgoals.find(s => s.description === 'Create planner.ts');
      assert.ok(createPlanner_sg, 'should include goal subgoal');
      assert.equal(createPlanner_sg!.status, 'pending');

      const writeTests_sg = subgoals.find(s => s.description === 'Write tests');
      assert.ok(writeTests_sg, 'should include completed goal subgoal');
      assert.equal(writeTests_sg!.status, 'completed');

      // KPI subgoals should be pending
      const kpiSubgoal = subgoals.find(s => s.description === 'target file created');
      assert.ok(kpiSubgoal, 'should include KPI as subgoal');
      assert.equal(kpiSubgoal!.status, 'pending');
    });
  });

  describe('re-planning', () => {

    it('triggers replan when replanTrigger control is set', async () => {
      const adapter = makeReplanAdapter({
        plan: 'Revised plan due to anomaly',
        subgoals: [{ description: 'Address anomaly', status: 'active' }],
        directives: [{ target: 'reasoner-1', directiveType: 'effort_change' }],
      });

      const planner = createPlanner(adapter);

      // Cycle 0: establish initial plan
      const state0 = planner.initialState();
      const r0 = await planner.step(makeInput(makeGoal()), state0, makeControl());
      assert.equal(r0.monitoring.planRevised, true);
      assert.ok(r0.state.assessment, 'cycle 0 should produce assessment');

      // Cycle 1: replan triggered
      const r1 = await planner.step(
        makeInput(makeGoal()),
        r0.state,
        makeControl('anomaly detected — low confidence'),
      );

      assert.equal(r1.monitoring.planRevised, true);
      assert.equal(r1.output.plan, 'Revised plan due to anomaly');
      assert.equal(r1.output.directives.length, 1);
      assert.ok(r1.state.revisionCount > r0.state.revisionCount);
    });

    it('preserves assessment during replan (assessment is stable)', async () => {
      const adapter = makeReplanAdapter({
        plan: 'New plan',
        subgoals: [],
        directives: [],
      });

      const planner = createPlanner(adapter);
      const state0 = planner.initialState();

      // Cycle 0
      const r0 = await planner.step(makeInput(makeGoal()), state0, makeControl());
      const originalAssessment = r0.state.assessment;
      assert.ok(originalAssessment);

      // Cycle 1 with replan
      const r1 = await planner.step(
        makeInput(makeGoal()),
        r0.state,
        makeControl('stagnation detected'),
      );

      // Assessment should remain unchanged — re-planning changes the plan, not the assessment
      assert.deepStrictEqual(r1.state.assessment, originalAssessment);
    });
  });

  describe('control directives', () => {

    it('produces control directives targeting downstream modules', async () => {
      const adapter = makeReplanAdapter({
        plan: 'Switch reasoner strategy',
        subgoals: [],
        directives: [
          {
            target: 'reasoner-1',
            directiveType: 'strategy_shift',
            payload: { strategy: 'chain-of-thought' },
          },
          {
            target: 'actor-1',
            directiveType: 'action_whitelist',
            payload: { actions: ['read_file'] },
          },
        ],
      });

      const planner = createPlanner(adapter);

      // Cycle 0
      const r0 = await planner.step(makeInput(makeGoal()), planner.initialState(), makeControl());

      // Cycle 1 with replan to get directives
      const r1 = await planner.step(makeInput(makeGoal()), r0.state, makeControl('impasse'));

      assert.equal(r1.output.directives.length, 2);

      const d0 = r1.output.directives[0] as ControlDirective & { directiveType: string; payload: unknown };
      assert.equal(d0.target, moduleId('reasoner-1'));
      assert.ok(d0.timestamp > 0);
      assert.equal(d0.directiveType, 'strategy_shift');

      const d1 = r1.output.directives[1] as ControlDirective & { directiveType: string };
      assert.equal(d1.target, moduleId('actor-1'));
      assert.equal(d1.directiveType, 'action_whitelist');
    });
  });

  describe('working memory', () => {

    it('persists plan context in working memory across cycles', async () => {
      const adapter = makeAssessmentAdapter();
      const planner = createPlanner(adapter, {
        workingMemoryConfig: { capacity: 3, includeInContext: true },
      });

      const state0 = planner.initialState();
      assert.ok(state0.workingMemory, 'initial state should have working memory');
      assert.equal(state0.workingMemory!.entries.length, 0, 'working memory starts empty');

      // Cycle 0: should populate working memory
      const r0 = await planner.step(makeInput(makeGoal()), state0, makeControl());
      assert.ok(r0.state.workingMemory, 'state should retain working memory');
      assert.ok(r0.state.workingMemory!.entries.length > 0, 'working memory should be populated');

      // Working memory entry should contain plan context
      const wmContent = r0.state.workingMemory!.entries[0].content as string;
      assert.ok(wmContent.includes('PLANNER STATE'), 'WM should contain planner state header');
      assert.ok(wmContent.includes('medium'), 'WM should mention difficulty');
    });

    it('working memory respects capacity limits', async () => {
      const adapter = makeAssessmentAdapter();
      const planner = createPlanner(adapter, {
        workingMemoryConfig: { capacity: 1, includeInContext: true },
      });

      const state0 = planner.initialState();
      const r0 = await planner.step(makeInput(makeGoal()), state0, makeControl());

      // Only 1 entry should be kept (capacity = 1)
      assert.equal(r0.state.workingMemory!.entries.length, 1);
    });

    it('does not create working memory when config is absent', async () => {
      const adapter = makeAssessmentAdapter();
      const planner = createPlanner(adapter); // no workingMemoryConfig

      const state0 = planner.initialState();
      assert.equal(state0.workingMemory, undefined);

      const r0 = await planner.step(makeInput(makeGoal()), state0, makeControl());
      assert.equal(r0.state.workingMemory, undefined);
    });
  });

  describe('error handling', () => {

    it('falls back to default assessment when LLM fails at cycle 0', async () => {
      const adapter = makeFailingAdapter('LLM timeout');
      const planner = createPlanner(adapter, { maxCycles: 10 });
      const state = planner.initialState();

      // assessTaskWithLLM catches errors and returns defaultAssessment,
      // so the planner should still produce an assessment
      const result = await planner.step(makeInput(makeGoal()), state, makeControl());

      // Should have an assessment (either from assessTaskWithLLM fallback or planner error path)
      assert.ok(result.output.assessment, 'should produce fallback assessment');
      assert.equal(result.output.assessment!.difficulty, 'medium');
    });

    it('returns current state plan when replan fails', async () => {
      // Use a counter to let cycle 0 succeed but cycle 1 fail
      let callCount = 0;
      const adapter: ProviderAdapter = {
        async invoke(
          _snapshot: ReadonlyWorkspaceSnapshot,
          _config: AdapterConfig,
        ): Promise<ProviderAdapterResult> {
          callCount++;
          if (callCount === 1) {
            // Cycle 0 assessment — return valid XML
            return {
              output: `<assessment><difficulty>low</difficulty><estimated_cycles>5</estimated_cycles><solvability>0.90</solvability><phases><phase name="execute" start="1" end="5">writing code</phase></phases><kpis><kpi>done</kpi></kpis></assessment>`,
              usage: { inputTokens: 100, outputTokens: 50, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 150 },
              cost: { totalUsd: 0.001, perModel: {} },
            };
          }
          // Replan fails
          throw new Error('Replan LLM failure');
        },
      };

      const planner = createPlanner(adapter);
      const state0 = planner.initialState();

      // Cycle 0 succeeds
      const r0 = await planner.step(makeInput(makeGoal()), state0, makeControl());
      assert.ok(r0.state.assessment);
      const plan0 = r0.output.plan;

      // Cycle 1 replan fails — should return previous plan
      const r1 = await planner.step(
        makeInput(makeGoal()),
        r0.state,
        makeControl('anomaly'),
      );

      assert.ok(r1.error, 'should have error');
      assert.equal(r1.error!.recoverable, true);
      assert.equal(r1.output.plan, plan0, 'should preserve previous plan');
      assert.equal(r1.monitoring.planRevised, false);
    });
  });

  describe('state management', () => {

    it('persists goal in state across cycles', async () => {
      const adapter = makeAssessmentAdapter();
      const planner = createPlanner(adapter);
      const goal = makeGoal();

      // Cycle 0: goal provided in input
      const r0 = await planner.step(makeInput(goal), planner.initialState(), makeControl());
      assert.deepStrictEqual(r0.state.goal, goal);

      // Cycle 1: no goal in input — should use persisted goal
      const r1 = await planner.step(makeInput(), r0.state, makeControl());
      assert.deepStrictEqual(r1.state.goal, goal);
    });

    it('increments cycleCount and tracks revisionCount correctly', async () => {
      const adapter = makeAssessmentAdapter();
      const planner = createPlanner(adapter);

      const r0 = await planner.step(makeInput(makeGoal()), planner.initialState(), makeControl());
      assert.equal(r0.state.cycleCount, 1);
      assert.equal(r0.state.revisionCount, 1); // plan revised at cycle 0

      // Cycle 1: no replan — revision count should not change
      const r1 = await planner.step(makeInput(), r0.state, makeControl());
      assert.equal(r1.state.cycleCount, 2);
      assert.equal(r1.state.revisionCount, 1); // no revision
    });

    it('state invariant holds for valid states', () => {
      const adapter = makeAssessmentAdapter();
      const planner = createPlanner(adapter);

      const state = planner.initialState();
      assert.ok(planner.stateInvariant!(state));

      const advancedState: PlannerState = {
        currentPlan: 'some plan',
        subgoals: [{ description: 'test', status: 'pending' }],
        revisionCount: 3,
        cycleCount: 5,
        assessment: null,
        goal: null,
      };
      assert.ok(planner.stateInvariant!(advancedState));
    });
  });

  describe('module identity', () => {

    it('uses default module ID "planner"', () => {
      const adapter = makeAssessmentAdapter();
      const planner = createPlanner(adapter);
      assert.equal(planner.id, moduleId('planner'));
    });

    it('respects custom module ID', () => {
      const adapter = makeAssessmentAdapter();
      const planner = createPlanner(adapter, { id: 'planner-v2' });
      assert.equal(planner.id, moduleId('planner-v2'));
    });

    it('has default context binding for goal + constraint types', () => {
      const adapter = makeAssessmentAdapter();
      const planner = createPlanner(adapter);
      assert.ok(planner.contextBinding);
      assert.deepStrictEqual(planner.contextBinding!.types, ['goal', 'constraint']);
    });
  });

  describe('CheckableKPI generation (PRD 048)', () => {

    // ── Unit tests for parseChecksBlock ──

    it('parseChecksBlock: parses valid <checks> block with all primitives', () => {
      const text = `Some preamble text.
<checks>
<check kpi="config file exists">file_exists('src/config.ts')</check>
<check kpi="handler contains function">file_contains('src/handler.ts', 'handleOrder')</check>
<check kpi="handler exports symbol">file_exports('src/handler.ts', 'handleOrder')</check>
</checks>
Some trailing text.`;

      const parsed = parseChecksBlock(text);
      assert.equal(parsed.length, 3);

      assert.equal(parsed[0].kpiDescription, 'config file exists');
      assert.equal(parsed[0].primitive, 'file_exists');
      assert.deepStrictEqual(parsed[0].args, ['src/config.ts']);

      assert.equal(parsed[1].kpiDescription, 'handler contains function');
      assert.equal(parsed[1].primitive, 'file_contains');
      assert.deepStrictEqual(parsed[1].args, ['src/handler.ts', 'handleOrder']);

      assert.equal(parsed[2].kpiDescription, 'handler exports symbol');
      assert.equal(parsed[2].primitive, 'file_exports');
      assert.deepStrictEqual(parsed[2].args, ['src/handler.ts', 'handleOrder']);
    });

    it('parseChecksBlock: returns [] when no <checks> block is present', () => {
      const text = 'Just some text without any checks block.';
      const parsed = parseChecksBlock(text);
      assert.equal(parsed.length, 0);
    });

    it('parseChecksBlock: malformed DSL produces description-only entries', () => {
      const text = `<checks>
<check kpi="some kpi">unknown_primitive('foo')</check>
<check kpi="another kpi">file_exists(no_quotes)</check>
<check kpi="valid one">file_exists('valid.ts')</check>
</checks>`;

      const parsed = parseChecksBlock(text);
      assert.equal(parsed.length, 3);

      // First: unknown primitive → empty primitive
      assert.equal(parsed[0].kpiDescription, 'some kpi');
      assert.equal(parsed[0].primitive, '');
      assert.deepStrictEqual(parsed[0].args, []);

      // Second: no quotes → empty primitive (arity mismatch — no args extracted)
      assert.equal(parsed[1].kpiDescription, 'another kpi');
      assert.equal(parsed[1].primitive, '');

      // Third: valid
      assert.equal(parsed[2].kpiDescription, 'valid one');
      assert.equal(parsed[2].primitive, 'file_exists');
      assert.deepStrictEqual(parsed[2].args, ['valid.ts']);
    });

    it('parseChecksBlock: wrong arity produces description-only entry', () => {
      const text = `<checks>
<check kpi="too many args">file_exists('a.ts', 'extra')</check>
<check kpi="too few args">file_contains('a.ts')</check>
</checks>`;

      const parsed = parseChecksBlock(text);
      assert.equal(parsed.length, 2);

      // file_exists with 2 args → malformed
      assert.equal(parsed[0].primitive, '');
      // file_contains with 1 arg → malformed
      assert.equal(parsed[1].primitive, '');
    });

    // ── Unit tests for buildCheckableKPIs ──

    it('buildCheckableKPIs: builds check functions from valid parsed checks', () => {
      const parsedChecks: ParsedCheck[] = [
        { kpiDescription: 'file created', primitive: 'file_exists', args: ['src/foo.ts'] },
        { kpiDescription: 'has export', primitive: 'file_exports', args: ['src/foo.ts', 'myFunc'] },
      ];

      const kpis = buildCheckableKPIs(['file created', 'has export'], parsedChecks);
      assert.equal(kpis.length, 2);

      // Both should have check functions
      assert.ok(kpis[0].check, 'file_exists check should have a check function');
      assert.ok(kpis[1].check, 'file_exports check should have a check function');
      assert.equal(kpis[0].description, 'file created');
      assert.equal(kpis[1].description, 'has export');
      assert.equal(kpis[0].met, false);
      assert.equal(kpis[1].met, false);
    });

    it('buildCheckableKPIs: description-only when parsed check has empty primitive', () => {
      const parsedChecks: ParsedCheck[] = [
        { kpiDescription: 'unknown check', primitive: '', args: [] },
      ];

      const kpis = buildCheckableKPIs(['unknown check'], parsedChecks);
      assert.equal(kpis.length, 1);
      assert.equal(kpis[0].description, 'unknown check');
      assert.equal(kpis[0].check, undefined, 'should NOT have check function');
    });

    it('buildCheckableKPIs: falls back to assessment KPIs when no parsed checks', () => {
      const kpis = buildCheckableKPIs(['target file created', 'tests pass'], []);
      assert.equal(kpis.length, 2);
      assert.equal(kpis[0].description, 'target file created');
      assert.equal(kpis[1].description, 'tests pass');
      assert.equal(kpis[0].check, undefined);
      assert.equal(kpis[1].check, undefined);
    });

    // ── Check function execution tests ──

    it('file_exists check function runs correctly against VerificationState', () => {
      const parsedChecks: ParsedCheck[] = [
        { kpiDescription: 'config exists', primitive: 'file_exists', args: ['src/config.ts'] },
      ];

      const kpis = buildCheckableKPIs(['config exists'], parsedChecks);
      assert.ok(kpis[0].check);

      const state: VerificationState = {
        files: new Map([['src/config.ts', 'export const x = 1;']]),
        lastAction: { tool: 'write_file', input: {}, result: {} },
        actionHistory: [],
      };

      const result = kpis[0].check!(state);
      assert.equal(result.met, true);
      assert.ok(result.evidence.includes('exists'));
    });

    it('file_contains check function runs correctly against VerificationState', () => {
      const parsedChecks: ParsedCheck[] = [
        { kpiDescription: 'has handler', primitive: 'file_contains', args: ['src/handler.ts', 'handleOrder'] },
      ];

      const kpis = buildCheckableKPIs(['has handler'], parsedChecks);
      assert.ok(kpis[0].check);

      // Positive case
      const stateMatch: VerificationState = {
        files: new Map([['src/handler.ts', 'export function handleOrder() {}']]),
        lastAction: { tool: 'write_file', input: {}, result: {} },
        actionHistory: [],
      };
      assert.equal(kpis[0].check!(stateMatch).met, true);

      // Negative case
      const stateMiss: VerificationState = {
        files: new Map([['src/handler.ts', 'export function otherFn() {}']]),
        lastAction: { tool: 'write_file', input: {}, result: {} },
        actionHistory: [],
      };
      assert.equal(kpis[0].check!(stateMiss).met, false);
    });

    it('file_exports check function runs correctly against VerificationState', () => {
      const parsedChecks: ParsedCheck[] = [
        { kpiDescription: 'exports handler', primitive: 'file_exports', args: ['src/handler.ts', 'handleOrder'] },
      ];

      const kpis = buildCheckableKPIs(['exports handler'], parsedChecks);
      assert.ok(kpis[0].check);

      const state: VerificationState = {
        files: new Map([['src/handler.ts', 'export function handleOrder() { return 42; }']]),
        lastAction: { tool: 'write_file', input: {}, result: {} },
        actionHistory: [],
      };

      const result = kpis[0].check!(state);
      assert.equal(result.met, true);
      assert.ok(result.evidence.includes('exports'));
    });

    // ── Integration: checkableKpis in planner output ──

    it('populates checkableKpis in planner output when LLM produces <checks> block', async () => {
      let callCount = 0;
      const adapter: ProviderAdapter = {
        async invoke(
          _snapshot: ReadonlyWorkspaceSnapshot,
          _config: AdapterConfig,
        ): Promise<ProviderAdapterResult> {
          callCount++;
          if (callCount === 1) {
            // Assessment call
            return {
              output: `<assessment><difficulty>medium</difficulty><estimated_cycles>8</estimated_cycles><solvability>0.80</solvability><phases><phase name="execute" start="1" end="8">work</phase></phases><kpis><kpi>handler created</kpi><kpi>tests pass</kpi></kpis></assessment>`,
              usage: { inputTokens: 200, outputTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 300 },
              cost: { totalUsd: 0.002, perModel: {} },
            };
          }
          // Checks call
          return {
            output: `<checks>\n<check kpi="handler created">file_exists('src/handler.ts')</check>\n<check kpi="tests pass">file_contains('src/handler.test.ts', 'test')</check>\n</checks>`,
            usage: { inputTokens: 100, outputTokens: 50, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 150 },
            cost: { totalUsd: 0.001, perModel: {} },
          };
        },
      };

      const planner = createPlanner(adapter);
      const result = await planner.step(
        makeInput(makeGoal()),
        planner.initialState(),
        makeControl(),
      );

      assert.equal(result.output.checkableKpis.length, 2);
      assert.equal(result.output.checkableKpis[0].description, 'handler created');
      assert.ok(result.output.checkableKpis[0].check, 'should have check function');
      assert.equal(result.output.checkableKpis[1].description, 'tests pass');
      assert.ok(result.output.checkableKpis[1].check, 'should have check function');
    });

    it('returns description-only KPIs when LLM does not produce <checks> block', async () => {
      let callCount = 0;
      const adapter: ProviderAdapter = {
        async invoke(
          _snapshot: ReadonlyWorkspaceSnapshot,
          _config: AdapterConfig,
        ): Promise<ProviderAdapterResult> {
          callCount++;
          if (callCount === 1) {
            return {
              output: `<assessment><difficulty>low</difficulty><estimated_cycles>5</estimated_cycles><solvability>0.90</solvability><phases><phase name="execute" start="1" end="5">work</phase></phases><kpis><kpi>done</kpi></kpis></assessment>`,
              usage: { inputTokens: 100, outputTokens: 50, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 150 },
              cost: { totalUsd: 0.001, perModel: {} },
            };
          }
          // Checks call returns no <checks> block
          return {
            output: 'I cannot produce checks for this task.',
            usage: { inputTokens: 50, outputTokens: 20, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 70 },
            cost: { totalUsd: 0.0005, perModel: {} },
          };
        },
      };

      const planner = createPlanner(adapter);
      const result = await planner.step(
        makeInput(makeGoal()),
        planner.initialState(),
        makeControl(),
      );

      // Should fall back to description-only KPIs from the assessment
      assert.equal(result.output.checkableKpis.length, 1);
      assert.equal(result.output.checkableKpis[0].description, 'done');
      assert.equal(result.output.checkableKpis[0].check, undefined, 'should NOT have check function');
    });

    it('returns description-only KPIs when checks LLM call fails', async () => {
      let callCount = 0;
      const adapter: ProviderAdapter = {
        async invoke(
          _snapshot: ReadonlyWorkspaceSnapshot,
          _config: AdapterConfig,
        ): Promise<ProviderAdapterResult> {
          callCount++;
          if (callCount === 1) {
            return {
              output: `<assessment><difficulty>high</difficulty><estimated_cycles>12</estimated_cycles><solvability>0.60</solvability><phases><phase name="explore" start="1" end="4">reading</phase><phase name="execute" start="5" end="10">writing</phase><phase name="verify" start="11" end="12">checking</phase></phases><kpis><kpi>API endpoint created</kpi><kpi>tests pass</kpi></kpis></assessment>`,
              usage: { inputTokens: 200, outputTokens: 100, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 300 },
              cost: { totalUsd: 0.002, perModel: {} },
            };
          }
          // Checks call throws
          throw new Error('LLM timeout during checks call');
        },
      };

      const planner = createPlanner(adapter);
      const result = await planner.step(
        makeInput(makeGoal()),
        planner.initialState(),
        makeControl(),
      );

      // Should gracefully degrade to description-only KPIs
      assert.equal(result.output.checkableKpis.length, 2);
      assert.equal(result.output.checkableKpis[0].description, 'API endpoint created');
      assert.equal(result.output.checkableKpis[0].check, undefined);
      assert.equal(result.output.checkableKpis[1].description, 'tests pass');
      assert.equal(result.output.checkableKpis[1].check, undefined);

      // Assessment should still be produced (checks failure doesn't crash planner)
      assert.ok(result.output.assessment);
      assert.equal(result.output.assessment!.difficulty, 'high');
    });

    it('returns empty checkableKpis when assessment has no KPIs', async () => {
      const adapter: ProviderAdapter = {
        async invoke(): Promise<ProviderAdapterResult> {
          return {
            output: `<assessment><difficulty>low</difficulty><estimated_cycles>3</estimated_cycles><solvability>0.95</solvability><phases><phase name="execute" start="1" end="3">work</phase></phases><kpis></kpis></assessment>`,
            usage: { inputTokens: 50, outputTokens: 30, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 80 },
            cost: { totalUsd: 0.0005, perModel: {} },
          };
        },
      };

      const planner = createPlanner(adapter);
      const result = await planner.step(
        makeInput(makeGoal()),
        planner.initialState(),
        makeControl(),
      );

      // No KPIs → no checks call → empty checkableKpis
      assert.equal(result.output.checkableKpis.length, 0);
    });
  });

  describe('pass-through on non-cycle-0 without replan', () => {

    it('does not invoke LLM on non-cycle-0 steps without replanTrigger', async () => {
      let invocationCount = 0;
      const adapter: ProviderAdapter = {
        async invoke(
          _snapshot: ReadonlyWorkspaceSnapshot,
          _config: AdapterConfig,
        ): Promise<ProviderAdapterResult> {
          invocationCount++;
          return {
            output: `<assessment><difficulty>low</difficulty><estimated_cycles>5</estimated_cycles><solvability>0.90</solvability><phases><phase name="execute" start="1" end="5">work</phase></phases><kpis><kpi>done</kpi></kpis></assessment>`,
            usage: { inputTokens: 100, outputTokens: 50, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 150 },
            cost: { totalUsd: 0.001, perModel: {} },
          };
        },
      };

      const planner = createPlanner(adapter);

      // Cycle 0: should invoke (assessment + checks = 2 calls)
      const r0 = await planner.step(makeInput(makeGoal()), planner.initialState(), makeControl());
      assert.equal(invocationCount, 2, 'should invoke LLM twice at cycle 0 (assessment + checks)');

      // Cycle 1: no replanTrigger — should NOT invoke
      const r1 = await planner.step(makeInput(), r0.state, makeControl());
      assert.equal(invocationCount, 2, 'should NOT invoke LLM on cycle 1 without replan');

      // Output should carry forward the assessment
      assert.ok(r1.output.assessment, 'assessment should be carried forward');
      assert.equal(r1.output.planRevised, false);
      assert.equal(r1.output.tokensUsed, 0);
    });
  });
});
