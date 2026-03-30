/**
 * Tests for affect-explore presets (PRD 037).
 *
 * 8 test scenarios covering:
 * 1. affectivePreset produces valid config with affect module in evaluator slot
 * 2. exploratoryPreset produces valid config with curiosity module in planner slot
 * 3. fullPreset includes both affect and curiosity
 * 4. Override support works (enriched overrides propagate)
 * 5. Module slot overrides take priority over preset defaults
 * 6. Each preset creates a valid CognitiveAgent (no throw)
 * 7. affectivePreset still has core v2 modules (MonitorV2, ReasonerActorV2)
 * 8. fullPreset override for affect/curiosity config propagates
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { moduleId } from '../../algebra/index.js';
import type {
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
} from '../../algebra/index.js';
import type { ToolProvider, ToolDefinition, ToolResult } from '../../../ports/tool-provider.js';
import { createCognitiveAgent } from '../../engine/create-cognitive-agent.js';
import type { EnrichedPresetPorts } from '../enriched.js';
import {
  affectivePreset,
  exploratoryPreset,
  fullPreset,
} from '../affect-explore.js';
import type { AffectExploreOverrides } from '../affect-explore.js';

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

function createMockAdapter(): ProviderAdapter {
  return {
    async invoke(
      _snapshot: ReadonlyWorkspaceSnapshot,
      _config: AdapterConfig,
    ): Promise<ProviderAdapterResult> {
      return {
        output: `
<plan>
1. Read the file.
</plan>

<reasoning>
Straightforward task.
</reasoning>

<action>
{"tool": "Read", "input": {"file_path": "test.ts"}}
</action>
`,
        usage: { inputTokens: 100, outputTokens: 50, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 150 },
        cost: { totalUsd: 0.001, perModel: {} },
      };
    },
  };
}

function createMockTools(): ToolProvider {
  return {
    list(): ToolDefinition[] {
      return [
        { name: 'Read', description: 'Read a file' },
        { name: 'Write', description: 'Write a file' },
        { name: 'Grep', description: 'Search files' },
      ];
    },
    async execute(_name: string, _input: unknown): Promise<ToolResult> {
      return { output: 'file contents', isError: false };
    },
  };
}

function createPorts(): EnrichedPresetPorts {
  return {
    adapter: createMockAdapter(),
    tools: createMockTools(),
    writePort: createMockWritePort(),
  };
}

/** Create a recording stub module for override testing. */
function createStubModule(
  id: string,
): CognitiveModule<any, any, any, any, any> {
  const mid = moduleId(id);
  return {
    id: mid,
    initialState() { return { callCount: 0 }; },
    async step(_input: any, state: any, _control: any): Promise<StepResult<any, any, any>> {
      return {
        output: { result: `${id}-output` },
        state: { callCount: (state?.callCount ?? 0) + 1 },
        monitoring: { source: mid, timestamp: Date.now() },
      };
    },
  };
}

// ── Tests ───────────────────────────────────────────────────────

describe('affectivePreset', () => {
  it('1. produces valid config with affect module in evaluator slot', () => {
    const ports = createPorts();
    const options = affectivePreset(ports);

    // Evaluator slot should be the affect module
    assert.equal(String(options.modules.evaluator.id), 'affect', 'evaluator slot is affect module');

    // All 8 module slots should be populated
    assert.ok(options.modules.observer, 'observer present');
    assert.ok(options.modules.memory, 'memory present');
    assert.ok(options.modules.reasoner, 'reasoner present');
    assert.ok(options.modules.actor, 'actor present');
    assert.ok(options.modules.monitor, 'monitor present');
    assert.ok(options.modules.evaluator, 'evaluator present');
    assert.ok(options.modules.planner, 'planner present');
    assert.ok(options.modules.reflector, 'reflector present');
  });

  it('7. still has core v2 modules (MonitorV2, ReasonerActorV2)', () => {
    const ports = createPorts();
    const options = affectivePreset(ports);

    assert.equal(String(options.modules.monitor.id), 'monitor', 'MonitorV2 present');
    assert.equal(String(options.modules.reasoner.id), 'reasoner-actor', 'ReasonerActorV2 in reasoner slot');
    assert.equal(String(options.modules.actor.id), 'reasoner-actor', 'ReasonerActorV2 in actor slot');
    assert.equal(options.cycle.thresholds.type, 'predicate', 'EVC policy present');
  });
});

describe('exploratoryPreset', () => {
  it('2. produces valid config with curiosity module in planner slot', () => {
    const ports = createPorts();
    const options = exploratoryPreset(ports);

    // Planner slot should be the curiosity module
    assert.equal(String(options.modules.planner.id), 'curiosity', 'planner slot is curiosity module');

    // All 8 module slots should be populated
    for (const [key, mod] of Object.entries(options.modules)) {
      assert.ok(mod, `${key} module present`);
      assert.ok(mod.id, `${key} has module ID`);
      assert.equal(typeof mod.step, 'function', `${key}.step is function`);
      assert.equal(typeof mod.initialState, 'function', `${key}.initialState is function`);
    }
  });
});

describe('fullPreset', () => {
  it('3. includes both affect (evaluator) and curiosity (planner)', () => {
    const ports = createPorts();
    const options = fullPreset(ports);

    assert.equal(String(options.modules.evaluator.id), 'affect', 'evaluator is affect');
    assert.equal(String(options.modules.planner.id), 'curiosity', 'planner is curiosity');
    assert.equal(String(options.modules.monitor.id), 'monitor', 'monitor is MonitorV2');
    assert.equal(String(options.modules.reasoner.id), 'reasoner-actor', 'reasoner is ReasonerActorV2');
  });

  it('8. affect/curiosity config overrides propagate', () => {
    const ports = createPorts();
    const overrides: AffectExploreOverrides = {
      affect: {
        id: 'custom-affect',
        confidentSuccessThreshold: 4,
        frustratedWriteThreshold: 5,
      },
      curiosity: {
        windowSize: 20,
        noiseFloor: 0.1,
        explorationBudgetMax: 10,
      },
    };

    const options = fullPreset(ports, overrides);

    // Affect module should have the custom ID
    assert.equal(String(options.modules.evaluator.id), 'custom-affect', 'affect ID override applied');

    // Curiosity module should be present (ID is always 'curiosity' from factory)
    assert.equal(String(options.modules.planner.id), 'curiosity', 'curiosity module present');

    // Verify curiosity config propagated by checking initial state
    const curiosityState = options.modules.planner.initialState();
    assert.equal(curiosityState.explorationBudget, 10, 'explorationBudgetMax override applied');
  });
});

describe('preset overrides', () => {
  it('4. enriched overrides propagate through affect/explore presets', () => {
    const ports = createPorts();
    const overrides: AffectExploreOverrides = {
      workspace: { capacity: 200 },
      cycle: { maxConsecutiveInterventions: 10 },
    };

    const options = fullPreset(ports, overrides);

    assert.equal(options.workspace.capacity, 200, 'workspace capacity override propagated');
    assert.equal(options.cycle.maxConsecutiveInterventions, 10, 'cycle override propagated');
  });

  it('5. module slot overrides take priority over preset defaults', () => {
    const ports = createPorts();
    const customEvaluator = createStubModule('my-evaluator');
    const customPlanner = createStubModule('my-planner');

    // Full preset sets evaluator=affect, planner=curiosity,
    // but explicit module overrides should take priority
    const options = fullPreset(ports, undefined, {
      evaluator: customEvaluator,
      planner: customPlanner,
    });

    assert.equal(
      String(options.modules.evaluator.id),
      'my-evaluator',
      'Custom evaluator override took priority over affect',
    );
    assert.equal(
      String(options.modules.planner.id),
      'my-planner',
      'Custom planner override took priority over curiosity',
    );
  });
});

describe('preset agent creation', () => {
  it('6. each preset creates a valid CognitiveAgent without throwing', () => {
    const ports = createPorts();

    const affective = affectivePreset(ports);
    const exploratory = exploratoryPreset(ports);
    const full = fullPreset(ports);

    // All should create valid agents
    const agent1 = createCognitiveAgent(affective);
    assert.ok(agent1, 'affectivePreset agent created');
    assert.equal(typeof agent1.invoke, 'function', 'agent1.invoke is function');

    const agent2 = createCognitiveAgent(exploratory);
    assert.ok(agent2, 'exploratoryPreset agent created');
    assert.equal(typeof agent2.invoke, 'function', 'agent2.invoke is function');

    const agent3 = createCognitiveAgent(full);
    assert.ok(agent3, 'fullPreset agent created');
    assert.equal(typeof agent3.invoke, 'function', 'agent3.invoke is function');
  });
});
