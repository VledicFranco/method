// SPDX-License-Identifier: Apache-2.0
/**
 * Unit tests for ReasonerActorV2 — impasse detection + auto-subgoaling.
 *
 * Tests: SOAR-style impasse detection (Laird, Newell, Rosenbloom 1987),
 * four impasse types (tie, no-change, rejection, stall), auto-subgoal
 * generation and workspace injection, CognitiveModule interface compliance.
 *
 * 12 test scenarios covering AC-07 and AC-08.
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import { moduleId } from '../../algebra/index.js';
import type {
  ModuleId,
  WorkspaceWritePort,
  WorkspaceEntry,
  ReadonlyWorkspaceSnapshot,
  ProviderAdapter,
  AdapterConfig,
  ProviderAdapterResult,
  CognitiveModule,
  ReasonerActorMonitoring,
  ControlDirective,
} from '../../algebra/index.js';
import type { ToolProvider, ToolDefinition, ToolResult } from '../../../ports/tool-provider.js';
import { createReasonerActorV2 } from '../reasoner-actor-v2.js';
import type {
  ReasonerActorV2Input,
  ReasonerActorV2Output,
  ReasonerActorV2State,
  ReasonerActorV2Control,
  ReasonerActorV2Monitoring,
} from '../reasoner-actor-v2.js';

// ── Test Helpers ─────────────────────────────────────────────────

function createMockWritePort(): WorkspaceWritePort & { entries: WorkspaceEntry[] } {
  const entries: WorkspaceEntry[] = [];
  return {
    entries,
    write(entry: WorkspaceEntry): void {
      entries.push(entry);
    },
  };
}

function createMockAdapter(response: string): ProviderAdapter {
  return {
    async invoke(
      _snapshot: ReadonlyWorkspaceSnapshot,
      _config: AdapterConfig,
    ): Promise<ProviderAdapterResult> {
      return {
        output: response,
        usage: { inputTokens: 100, outputTokens: 50, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 150 },
        cost: { totalUsd: 0.001, perModel: {} },
      };
    },
  };
}

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

function makeSnapshot(contents: string[]): ReadonlyWorkspaceSnapshot {
  return contents.map((content, i) => ({
    source: moduleId('test'),
    content,
    salience: 0.5,
    timestamp: Date.now() - i * 100,
  }));
}

function makeControl(overrides?: Partial<ReasonerActorV2Control>): ReasonerActorV2Control {
  return {
    target: 'reasoner-actor' as ModuleId,
    timestamp: Date.now(),
    strategy: 'cot',
    effort: 'medium',
    ...overrides,
  };
}

/** Build a well-formed LLM response with plan/reasoning/action sections. */
function buildResponse(opts: {
  plan?: string;
  reasoning?: string;
  tool?: string;
  input?: Record<string, unknown>;
  extraText?: string;
}): string {
  const plan = opts.plan ?? 'Read the file to understand the problem.';
  const reasoning = opts.reasoning ?? 'The file needs to be analyzed.';
  const tool = opts.tool ?? 'Read';
  const input = opts.input ?? { file_path: 'src/main.ts' };
  const extra = opts.extraText ? `\n${opts.extraText}` : '';

  return `<plan>\n${plan}\n</plan>\n\n<reasoning>\n${reasoning}${extra}\n</reasoning>\n\n<action>\n${JSON.stringify({ tool, input })}\n</action>`;
}

/** Build a response with hedging language indicating a tie impasse. */
function buildHedgingResponse(): string {
  return `<plan>
Analyze the issue to determine the best approach.
</plan>

<reasoning>
I could either use a regex-based approach or a parser-based approach. On the other hand, the parser approach might be more reliable. It's hard to decide between them. Both regex and parser approaches seem equally viable.
</reasoning>

<action>
{"tool": "Read", "input": {"file_path": "src/parser.ts"}}
</action>`;
}

/** Build a response with multiple actions in the action block (tie). */
function buildMultiActionResponse(): string {
  return `<plan>
Try one of two approaches.
</plan>

<reasoning>
There are two viable paths.
</reasoning>

<action>
{"tool": "Read", "input": {"file_path": "a.ts"}}
{"tool": "Write", "input": {"file_path": "b.ts", "content": "x"}}
</action>`;
}

// ── Tests ────────────────────────────────────────────────────────

describe('ReasonerActorV2', () => {

  // ── Scenario 1: Tie impasse detected when LLM hedges ──────────

  it('detects tie impasse when LLM hedges between alternatives', async () => {
    const writePort = createMockWritePort();
    const adapter = createMockAdapter(buildHedgingResponse());
    const tools = createMockTools();
    const module = createReasonerActorV2(adapter, tools, writePort);

    const state = module.initialState();
    const snapshot = makeSnapshot(['Fix the parsing bug']);
    const result = await module.step({ snapshot }, state, makeControl());

    assert.ok(result.monitoring.impasse, 'Should detect a tie impasse');
    assert.strictEqual(result.monitoring.impasse!.type, 'tie');
    assert.ok(result.monitoring.impasse!.candidates, 'Should have candidates');
    assert.ok(result.monitoring.impasse!.candidates!.length >= 2, 'Should have at least 2 candidates');
  });

  // ── Scenario 2: Tie impasse generates comparison subgoal ──────

  it('generates comparison subgoal on tie impasse', async () => {
    const writePort = createMockWritePort();
    const adapter = createMockAdapter(buildMultiActionResponse());
    const tools = createMockTools();
    const module = createReasonerActorV2(adapter, tools, writePort);

    const state = module.initialState();
    const snapshot = makeSnapshot(['Fix the parsing bug']);
    const result = await module.step({ snapshot }, state, makeControl());

    assert.ok(result.monitoring.impasse, 'Should detect a tie impasse');
    assert.strictEqual(result.monitoring.impasse!.type, 'tie');
    assert.ok(
      result.monitoring.impasse!.autoSubgoal.includes('Compare'),
      'Subgoal should instruct comparison of approaches',
    );
  });

  // ── Scenario 3: No-change impasse detected on repeated action ─

  it('detects no-change impasse when action repeats from previous cycle', async () => {
    const writePort = createMockWritePort();
    const response = buildResponse({ tool: 'Read', input: { file_path: 'src/main.ts' } });
    const adapter = createMockAdapter(response);
    const tools = createMockTools();
    const module = createReasonerActorV2(adapter, tools, writePort);

    // First cycle — establishes lastActionName and lastToolInput
    const state0 = module.initialState();
    const snapshot = makeSnapshot(['Analyze the code']);
    const result1 = await module.step({ snapshot }, state0, makeControl());

    // No impasse on first cycle (no previous action to compare with)
    assert.strictEqual(result1.monitoring.impasse?.type === 'no-change', false, 'First cycle should not detect no-change');

    // Second cycle — same action + same input → no-change impasse
    const result2 = await module.step({ snapshot }, result1.state, makeControl());

    assert.ok(result2.monitoring.impasse, 'Should detect impasse on repeated action');
    assert.strictEqual(result2.monitoring.impasse!.type, 'no-change');
  });

  // ── Scenario 4: No-change impasse generates alternative-listing subgoal ──

  it('generates alternative-listing subgoal on no-change impasse', async () => {
    const writePort = createMockWritePort();
    const response = buildResponse({ tool: 'Read', input: { file_path: 'src/main.ts' } });
    const adapter = createMockAdapter(response);
    const tools = createMockTools();
    const module = createReasonerActorV2(adapter, tools, writePort);

    // Run two identical cycles
    const state0 = module.initialState();
    const snapshot = makeSnapshot(['Analyze the code']);
    const result1 = await module.step({ snapshot }, state0, makeControl());
    const result2 = await module.step({ snapshot }, result1.state, makeControl());

    assert.ok(result2.monitoring.impasse, 'Should detect no-change impasse');
    assert.ok(
      result2.monitoring.impasse!.autoSubgoal.includes('alternative'),
      'Subgoal should instruct listing alternatives',
    );
    assert.ok(
      result2.monitoring.impasse!.autoSubgoal.includes('3'),
      'Subgoal should mention listing 3 alternatives',
    );
  });

  // ── Scenario 5: Rejection impasse detected on tool failure ────

  it('detects rejection impasse on tool failure with no alternative proposed', async () => {
    const writePort = createMockWritePort();
    const response = buildResponse({
      tool: 'Grep',
      input: { pattern: 'foo', path: '/invalid' },
      reasoning: 'Searching for the pattern in the codebase.',
    });
    const adapter = createMockAdapter(response);
    const tools = createMockTools({
      executeResult: { output: 'Permission denied: /invalid', isError: true },
    });
    const module = createReasonerActorV2(adapter, tools, writePort);

    const state = module.initialState();
    const snapshot = makeSnapshot(['Find all usages of foo']);
    const result = await module.step({ snapshot }, state, makeControl());

    assert.ok(result.monitoring.impasse, 'Should detect rejection impasse');
    assert.strictEqual(result.monitoring.impasse!.type, 'rejection');
    assert.strictEqual(result.monitoring.impasse!.failedTool, 'Grep');
  });

  // ── Scenario 6: Rejection impasse generates tool-alternative subgoal ──

  it('generates tool-alternative subgoal on rejection impasse', async () => {
    const writePort = createMockWritePort();
    const response = buildResponse({
      tool: 'Write',
      input: { file_path: '/readonly/file.ts', content: 'new content' },
      reasoning: 'Writing the fix to the file.',
    });
    const adapter = createMockAdapter(response);
    const tools = createMockTools({
      executeResult: { output: 'EACCES: permission denied', isError: true },
    });
    const module = createReasonerActorV2(adapter, tools, writePort);

    const state = module.initialState();
    const snapshot = makeSnapshot(['Apply the fix']);
    const result = await module.step({ snapshot }, state, makeControl());

    assert.ok(result.monitoring.impasse, 'Should detect rejection impasse');
    assert.ok(
      result.monitoring.impasse!.autoSubgoal.includes('Write'),
      'Subgoal should mention the failed tool name',
    );
    assert.ok(
      result.monitoring.impasse!.autoSubgoal.includes('EACCES'),
      'Subgoal should include the error message',
    );
    assert.ok(
      result.monitoring.impasse!.autoSubgoal.includes('other tools'),
      'Subgoal should suggest other tools or approaches',
    );
  });

  // ── Scenario 7: Stall impasse detected on low action entropy ──

  it('detects stall impasse when action entropy drops below threshold', async () => {
    const writePort = createMockWritePort();
    const response = buildResponse({ tool: 'Read', input: { file_path: 'a.ts' } });
    const adapter = createMockAdapter(response);
    const tools = createMockTools();

    // Use a low stall threshold and pre-populate state with repeated actions
    const module = createReasonerActorV2(adapter, tools, writePort, {
      stallEntropyThreshold: 0.5,
    });

    // Build state with all-same recent actions to guarantee low entropy
    const state: ReasonerActorV2State = {
      cycleCount: 5,
      totalTokensUsed: 750,
      lastActionName: 'Glob',  // different from 'Read' so no-change won't fire first
      lastToolInput: '{"pattern":"*.ts"}',
      successRate: 1,
      recentActions: ['Read', 'Read', 'Read', 'Read', 'Read'],  // zero entropy
    };

    const snapshot = makeSnapshot(['Do something']);
    const result = await module.step({ snapshot }, state, makeControl());

    assert.ok(result.monitoring.impasse, 'Should detect stall impasse');
    assert.strictEqual(result.monitoring.impasse!.type, 'stall');
    assert.ok(
      typeof result.monitoring.impasse!.stuckCycles === 'number',
      'Should report stuck cycles',
    );
  });

  // ── Scenario 8: Stall impasse generates problem-restatement subgoal ──

  it('generates problem-restatement subgoal on stall impasse', async () => {
    const writePort = createMockWritePort();
    const response = buildResponse({ tool: 'Read', input: { file_path: 'b.ts' } });
    const adapter = createMockAdapter(response);
    const tools = createMockTools();
    const module = createReasonerActorV2(adapter, tools, writePort, {
      stallEntropyThreshold: 0.5,
    });

    const state: ReasonerActorV2State = {
      cycleCount: 5,
      totalTokensUsed: 750,
      lastActionName: 'Glob',
      lastToolInput: '{"pattern":"*.ts"}',
      successRate: 1,
      recentActions: ['Read', 'Read', 'Read', 'Read', 'Read'],
    };

    const snapshot = makeSnapshot(['Investigate']);
    const result = await module.step({ snapshot }, state, makeControl());

    assert.ok(result.monitoring.impasse, 'Should detect stall impasse');
    assert.ok(
      result.monitoring.impasse!.autoSubgoal.includes('Step back'),
      'Subgoal should instruct stepping back',
    );
    assert.ok(
      result.monitoring.impasse!.autoSubgoal.includes('assumptions'),
      'Subgoal should question assumptions',
    );
  });

  // ── Scenario 9: Auto-subgoal injected into workspace with high salience ──

  it('injects auto-subgoal into workspace with high salience', async () => {
    const writePort = createMockWritePort();
    // Use hedging to trigger a tie impasse
    const adapter = createMockAdapter(buildHedgingResponse());
    const tools = createMockTools();
    const module = createReasonerActorV2(adapter, tools, writePort, {
      subgoalSalience: 0.95,
    });

    const state = module.initialState();
    const snapshot = makeSnapshot(['Choose an approach']);
    await module.step({ snapshot }, state, makeControl());

    // Should have 2 writes: one for tool result, one for subgoal
    const subgoalEntries = writePort.entries.filter(
      e => typeof e.content === 'string' && (e.content as string).startsWith('[SUBGOAL]'),
    );
    assert.strictEqual(subgoalEntries.length, 1, 'Should inject exactly one subgoal');
    assert.ok(subgoalEntries[0].salience >= 0.9, 'Subgoal salience should be >= 0.9');
    assert.strictEqual(subgoalEntries[0].salience, 0.95, 'Subgoal salience should match config');
  });

  // ── Scenario 10: ImpasseSignal included in ReasonerActorV2Monitoring ──

  it('includes ImpasseSignal in ReasonerActorV2Monitoring', async () => {
    const writePort = createMockWritePort();
    const adapter = createMockAdapter(buildHedgingResponse());
    const tools = createMockTools();
    const module = createReasonerActorV2(adapter, tools, writePort);

    const state = module.initialState();
    const snapshot = makeSnapshot(['Decide on approach']);
    const result = await module.step({ snapshot }, state, makeControl());

    const monitoring = result.monitoring;

    // Should have all standard ReasonerActorMonitoring fields
    assert.strictEqual(monitoring.type, 'reasoner-actor');
    assert.strictEqual(typeof monitoring.actionTaken, 'string');
    assert.strictEqual(typeof monitoring.success, 'boolean');
    assert.strictEqual(typeof monitoring.unexpectedResult, 'boolean');
    assert.strictEqual(typeof monitoring.tokensThisStep, 'number');
    assert.strictEqual(typeof monitoring.confidence, 'number');
    assert.strictEqual(typeof monitoring.declaredPlanAction, 'string');

    // Should also have the impasse field
    assert.ok(monitoring.impasse, 'Monitoring should include impasse signal');
    assert.strictEqual(typeof monitoring.impasse!.type, 'string');
    assert.strictEqual(typeof monitoring.impasse!.autoSubgoal, 'string');
  });

  // ── Scenario 11: Non-impasse cycles produce standard monitoring ──

  it('produces standard ReasonerActorMonitoring without impasse on clean cycles', async () => {
    const writePort = createMockWritePort();
    // Clean response — no hedging, unique action, successful tool
    const response = buildResponse({
      plan: 'Read the configuration file.',
      reasoning: 'Need to check the config values.',
      tool: 'Read',
      input: { file_path: 'config.json' },
    });
    const adapter = createMockAdapter(response);
    const tools = createMockTools();
    const module = createReasonerActorV2(adapter, tools, writePort);

    const state = module.initialState();
    const snapshot = makeSnapshot(['Check configuration']);
    const result = await module.step({ snapshot }, state, makeControl());

    // Should have standard fields
    assert.strictEqual(result.monitoring.type, 'reasoner-actor');
    assert.strictEqual(result.monitoring.success, true);
    assert.strictEqual(typeof result.monitoring.confidence, 'number');

    // Should NOT have impasse field
    assert.strictEqual(result.monitoring.impasse, undefined, 'Clean cycle should not have impasse');
  });

  // ── Scenario 12: CognitiveModule interface — assignable to v1 slot ──

  it('implements CognitiveModule interface — assignable to v1 ReasonerActor slot', async () => {
    const writePort = createMockWritePort();
    const response = buildResponse({});
    const adapter = createMockAdapter(response);
    const tools = createMockTools();
    const module = createReasonerActorV2(adapter, tools, writePort);

    // Type-level check: the module has the CognitiveModule shape
    assert.strictEqual(typeof module.id, 'string', 'Should have id');
    assert.strictEqual(typeof module.step, 'function', 'Should have step method');
    assert.strictEqual(typeof module.initialState, 'function', 'Should have initialState method');

    // The monitoring output type extends ReasonerActorMonitoring
    const state = module.initialState();
    const snapshot = makeSnapshot(['test']);
    const result = await module.step({ snapshot }, state, makeControl());

    // ReasonerActorV2Monitoring should be structurally assignable to ReasonerActorMonitoring
    const v1Monitoring: ReasonerActorMonitoring = result.monitoring;
    assert.strictEqual(v1Monitoring.type, 'reasoner-actor');
    assert.strictEqual(typeof v1Monitoring.actionTaken, 'string');
    assert.strictEqual(typeof v1Monitoring.success, 'boolean');
    assert.strictEqual(typeof v1Monitoring.tokensThisStep, 'number');
    assert.strictEqual(typeof v1Monitoring.confidence, 'number');
    assert.strictEqual(typeof v1Monitoring.declaredPlanAction, 'string');

    // Module default ID should match v1 default
    assert.strictEqual(module.id, 'reasoner-actor');

    // initialState returns valid state
    const initState = module.initialState();
    assert.strictEqual(initState.cycleCount, 0);
    assert.strictEqual(initState.lastActionName, null);
    assert.strictEqual(initState.lastToolInput, null);
    assert.deepStrictEqual(initState.recentActions, []);
  });
});
