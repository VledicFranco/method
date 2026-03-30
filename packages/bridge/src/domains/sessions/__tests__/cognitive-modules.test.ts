/**
 * Tests for cognitive-modules.ts — BridgeReasonerActorModule and BridgeMonitorModule.
 *
 * PRD 042 Phase 1-4: CognitiveModule implementations extracted from the
 * monolithic cognitive-provider.ts inline loop, plus manual composition integration.
 *
 * 12 test scenarios covering AC-1 through AC-7 and AC-11.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type {
  CognitiveModule,
  MonitoringSignal,
  ControlDirective,
  ProviderAdapter,
  ToolProvider,
  ToolResult,
  WorkspaceManager,
  WorkspaceReadPort,
  WorkspaceWritePort,
  SalienceContext,
} from '@method/pacta';
import { moduleId, createWorkspace } from '@method/pacta';
import {
  createBridgeReasonerActorModule,
  createBridgeMonitorModule,
  defaultBridgeMonitorControl,
  READ_ONLY_ACTIONS,
} from '../cognitive-modules.js';
import type {
  BridgeReasonerActorMonitoring,
  BridgeReasonerActorState,
  BridgeMonitorControl,
  BridgeMonitorState,
  BridgeReasonerActorModuleType,
  BridgeMonitorModuleType,
} from '../cognitive-modules.js';
import type { StreamEvent } from '../pool.js';

// ── Test Helpers ───────────────────────────────────────────────

/** Build an LLM response in the expected XML format. */
function buildResponse(plan: string, reasoning: string, action: { tool: string; input?: Record<string, unknown> }): string {
  return `<plan>${plan}</plan>\n<reasoning>${reasoning}</reasoning>\n<action>${JSON.stringify(action)}</action>`;
}

/** Create a mock adapter that returns responses from a queue. */
function createMockAdapter(responses: string[]): ProviderAdapter {
  let callIndex = 0;
  return {
    async invoke() {
      const idx = callIndex++;
      const output = idx < responses.length ? responses[idx] : responses[responses.length - 1];
      return {
        output,
        usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150, cacheReadTokens: 0, cacheWriteTokens: 0 },
        cost: { totalUsd: 0.001, perModel: {} },
      };
    },
  };
}

/** Create a mock tool provider with configurable results. */
function createMockTools(resultMap?: Record<string, ToolResult>): ToolProvider & { _executed: Array<{ name: string; input: unknown }> } {
  const executedTools: Array<{ name: string; input: unknown }> = [];
  return {
    list: () => [
      { name: 'Read', description: 'Read a file by path. Input: { path: string }' },
      { name: 'Write', description: 'Write content to a file. Input: { path: string, content: string }' },
      { name: 'Glob', description: 'Find files matching a glob pattern. Input: { pattern: string }' },
      { name: 'Grep', description: 'Search file contents with a regex. Input: { pattern: string, path?: string }' },
      { name: 'Bash', description: 'Execute a shell command. Input: { command: string }' },
    ],
    async execute(name: string, input: unknown): Promise<ToolResult> {
      executedTools.push({ name, input });
      if (resultMap && name in resultMap) {
        return resultMap[name];
      }
      return { output: `Mock result for ${name}` };
    },
    get _executed() { return executedTools; },
  };
}

/** Collect events from onEvent callback. */
function createEventCollector(): { events: StreamEvent[]; onEvent: (e: StreamEvent) => void } {
  const events: StreamEvent[] = [];
  return {
    events,
    onEvent: (e: StreamEvent) => events.push(e),
  };
}

/** Create a workspace with standard test config. */
function createTestWorkspace(capacity = 8): {
  ws: WorkspaceManager;
  obsPort: WorkspaceWritePort;
  raWritePort: WorkspaceWritePort;
  raReadPort: WorkspaceReadPort;
  monitorPort: WorkspaceWritePort;
} {
  const salienceCtx: SalienceContext = {
    now: Date.now(),
    goals: ['complete the task'],
    sourcePriorities: new Map([
      [moduleId('reasoner-actor'), 0.9],
      [moduleId('observer'), 0.6],
      [moduleId('monitor'), 0.7],
    ]),
  };
  const ws = createWorkspace({ capacity }, salienceCtx);
  return {
    ws,
    obsPort: ws.getWritePort(moduleId('observer')),
    raWritePort: ws.getWritePort(moduleId('reasoner-actor')),
    raReadPort: ws.getReadPort(moduleId('reasoner-actor')),
    monitorPort: ws.getWritePort(moduleId('monitor')),
  };
}

// ── Tests ─────────────────────────────────────────────────────

describe('cognitive-modules (PRD 042 Phase 1-3)', () => {

  // ── Scenario 1: AC-1 — RA module satisfies CognitiveModule interface ──

  it('RA module satisfies CognitiveModule interface (TypeScript compile gate)', () => {
    const { ws, obsPort, raWritePort, raReadPort } = createTestWorkspace();
    const { onEvent } = createEventCollector();
    const adapter = createMockAdapter([buildResponse('done', 'done', { tool: 'done', input: { result: 'ok' } })]);
    const tools = createMockTools();

    const raModule = createBridgeReasonerActorModule(
      adapter, tools, ws, raWritePort, raReadPort, obsPort,
      { maxToolsPerCycle: 5, maxOutputTokens: 8192, wsCapacity: 8, cycleNumber: 1, maxCycles: 15 },
      onEvent,
    );

    // TypeScript compile gate: the variable type is CognitiveModule<...>
    const _typeCheck: CognitiveModule<string, BridgeReasonerActorMonitoring, BridgeReasonerActorState, BridgeReasonerActorMonitoring, BridgeMonitorControl> = raModule;
    assert.ok(_typeCheck); // suppress unused variable warning

    // Interface shape checks
    assert.equal(typeof raModule.step, 'function');
    assert.equal(typeof raModule.initialState, 'function');
    assert.equal(typeof raModule.id, 'string');
    assert.equal(raModule.id, moduleId('reasoner-actor'));
  });

  // ── Scenario 2: AC-1 — Monitor module satisfies CognitiveModule interface ──

  it('Monitor module satisfies CognitiveModule interface (TypeScript compile gate)', () => {
    const { ws, monitorPort } = createTestWorkspace();
    const { onEvent } = createEventCollector();

    const monModule = createBridgeMonitorModule(
      ws, monitorPort, 8,
      { confThreshold: 0.3, stagThreshold: 2, intBudget: 5 },
      onEvent,
    );

    // TypeScript compile gate
    const _typeCheck: CognitiveModule<BridgeReasonerActorMonitoring | null, BridgeMonitorControl, BridgeMonitorState, MonitoringSignal, ControlDirective> = monModule;
    assert.ok(_typeCheck);

    assert.equal(typeof monModule.step, 'function');
    assert.equal(typeof monModule.initialState, 'function');
    assert.equal(typeof monModule.id, 'string');
    assert.equal(monModule.id, moduleId('monitor'));
  });

  // ── Scenario 3: AC-2 — RA step() with mock adapter returning done ──

  it('RA step() with mock adapter returning done -> monitoring.cycleDone === true', async () => {
    const { ws, obsPort, raWritePort, raReadPort } = createTestWorkspace();
    const { onEvent } = createEventCollector();
    const adapter = createMockAdapter([
      buildResponse('Complete task', 'Task is done', { tool: 'done', input: { result: 'completed successfully' } }),
    ]);
    const tools = createMockTools();

    const raModule = createBridgeReasonerActorModule(
      adapter, tools, ws, raWritePort, raReadPort, obsPort,
      { maxToolsPerCycle: 5, maxOutputTokens: 8192, wsCapacity: 8, cycleNumber: 1, maxCycles: 15 },
      onEvent,
    );

    const state = raModule.initialState();
    const control = defaultBridgeMonitorControl();
    const result = await raModule.step('Do the task', state, control);

    assert.equal(result.monitoring.cycleDone, true);
    assert.equal(result.monitoring.lastOutput, 'completed successfully');
    assert.equal(result.output.cycleDone, true);
  });

  // ── Scenario 4: RA step() write-completion hint fires after successful Write ──

  it('RA step() write-completion hint fires after successful Write', async () => {
    const { ws, obsPort, raWritePort, raReadPort } = createTestWorkspace();
    const { onEvent } = createEventCollector();
    const adapter = createMockAdapter([
      buildResponse('Write file', 'Writing output', { tool: 'Write', input: { path: 'out.md', content: 'hello' } }),
      buildResponse('Done', 'Complete', { tool: 'done', input: { result: 'wrote out.md' } }),
    ]);
    const tools = createMockTools({
      Write: { output: 'Written successfully' },
    });

    const raModule = createBridgeReasonerActorModule(
      adapter, tools, ws, raWritePort, raReadPort, obsPort,
      { maxToolsPerCycle: 5, maxOutputTokens: 8192, wsCapacity: 8, cycleNumber: 1, maxCycles: 15 },
      onEvent,
    );

    // Seed workspace (Observer would normally do this)
    obsPort.write({ source: moduleId('observer'), content: 'Write a file', salience: 0.95, timestamp: Date.now() });

    const state = raModule.initialState();
    const control = defaultBridgeMonitorControl();
    const result = await raModule.step('Write a file', state, control);

    // After Write, the module should have written a deliverable hint to workspace
    const snapshot = ws.snapshot();
    const deliverableHint = snapshot.find(e =>
      typeof e.content === 'string' && e.content.includes('DELIVERABLE WRITTEN'));
    assert.ok(deliverableHint, 'Write-completion hint should be written to workspace');
    // Note: the workspace engine recomputes salience via its salience function,
    // so the raw 1.0 value written may differ. We verify the content is present.

    // Write gate counters should update
    assert.equal(result.state.promptSuccessfulWrites, 1);
  });

  // ── Scenario 5: AC-5 — RA step() impasse detection ──

  it('RA step() impasse detection: consecutive identical action -> impasse in workspace', async () => {
    const { ws, obsPort, raWritePort, raReadPort } = createTestWorkspace();
    const { events, onEvent } = createEventCollector();
    // Two identical Read calls, then done
    const adapter = createMockAdapter([
      buildResponse('Read file', 'Reading', { tool: 'Read', input: { path: 'file.ts' } }),
      buildResponse('Read file', 'Reading again', { tool: 'Read', input: { path: 'file.ts' } }),
      buildResponse('Done', 'Complete', { tool: 'done', input: { result: 'ok' } }),
    ]);
    const tools = createMockTools();

    const raModule = createBridgeReasonerActorModule(
      adapter, tools, ws, raWritePort, raReadPort, obsPort,
      { maxToolsPerCycle: 5, maxOutputTokens: 8192, wsCapacity: 8, cycleNumber: 1, maxCycles: 15 },
      onEvent,
    );

    obsPort.write({ source: moduleId('observer'), content: 'Task', salience: 0.95, timestamp: Date.now() });

    const state = raModule.initialState();
    const control = defaultBridgeMonitorControl();
    await raModule.step('Read file.ts', state, control);

    // Check that impasse-detected event was emitted
    const impasseEvent = events.find(e => e.type === 'monitor' && e.intervention === 'impasse-detected');
    assert.ok(impasseEvent, 'Impasse detection event should be emitted');

    // Check workspace for impasse intervention
    const snapshot = ws.snapshot();
    const impasseEntry = snapshot.find(e =>
      typeof e.content === 'string' && e.content.includes('IMPASSE'));
    assert.ok(impasseEntry, 'Impasse intervention should be written to workspace');
  });

  // ── Scenario 6: RA step() circuit-breaker: 3 consecutive parse failures ──

  it('RA step() circuit-breaker: 3 consecutive parse failures -> cycleDone true + diagnostic lastOutput', async () => {
    const { ws, obsPort, raWritePort, raReadPort } = createTestWorkspace();
    const { onEvent } = createEventCollector();
    // Return invalid responses (no valid JSON in <action>)
    const adapter = createMockAdapter([
      '<plan>Plan</plan>\n<reasoning>Trying</reasoning>\n<action>not valid json</action>',
      '<plan>Plan</plan>\n<reasoning>Still trying</reasoning>\n<action>also not json</action>',
      '<plan>Plan</plan>\n<reasoning>Third attempt</reasoning>\n<action>nope</action>',
    ]);
    const tools = createMockTools();

    const raModule = createBridgeReasonerActorModule(
      adapter, tools, ws, raWritePort, raReadPort, obsPort,
      { maxToolsPerCycle: 5, maxOutputTokens: 8192, wsCapacity: 8, cycleNumber: 1, maxCycles: 15 },
      onEvent,
    );

    obsPort.write({ source: moduleId('observer'), content: 'Task', salience: 0.95, timestamp: Date.now() });

    const state = raModule.initialState();
    const control = defaultBridgeMonitorControl();
    const result = await raModule.step('Do something', state, control);

    // Circuit-breaker should fire on the 3rd parse failure
    assert.equal(result.monitoring.cycleDone, true, 'Circuit-breaker should set cycleDone');
    assert.ok(result.monitoring.lastOutput.length > 0, 'lastOutput should contain diagnostic string');
  });

  // ── Scenario 7: Monitor step() with low-confidence -> forceReplan: true ──

  it('Monitor step() with low-confidence -> forceReplan: true', async () => {
    const { ws, monitorPort } = createTestWorkspace();
    const { onEvent } = createEventCollector();

    const monModule = createBridgeMonitorModule(
      ws, monitorPort, 8,
      { confThreshold: 0.3, stagThreshold: 2, intBudget: 5 },
      onEvent,
    );

    const state = monModule.initialState();
    const monitoring: BridgeReasonerActorMonitoring = {
      source: moduleId('reasoner-actor'),
      timestamp: Date.now(),
      type: 'bridge-reasoner-actor',
      prevConf: 0.1,                  // below confThreshold (0.3)
      prevAction: 'Read',
      consecutiveFailedParses: 0,
      wsUtilization: 0.3,
      promptInputTokens: 500,
      promptOutputTokens: 200,
      writeGateFired: false,
      promptSuccessfulReads: 1,
      promptSuccessfulWrites: 0,
      cycleDone: false,
      lastOutput: '',
    };

    const noControl: ControlDirective = { target: moduleId('monitor'), timestamp: Date.now() };
    const result = await monModule.step(monitoring, state, noControl);

    assert.equal(result.output.forceReplan, true, 'Low confidence should trigger forceReplan');
  });

  // ── Scenario 8: AC-3 — Monitor step() with write gate condition ──

  it('Monitor step() with write gate condition (>=3 reads, 0 writes, !fired) -> restricted contains read tools', async () => {
    const { ws, monitorPort } = createTestWorkspace();
    const { onEvent } = createEventCollector();

    const monModule = createBridgeMonitorModule(
      ws, monitorPort, 8,
      { confThreshold: 0.3, stagThreshold: 2, intBudget: 5 },
      onEvent,
    );

    const state = monModule.initialState();
    const monitoring: BridgeReasonerActorMonitoring = {
      source: moduleId('reasoner-actor'),
      timestamp: Date.now(),
      type: 'bridge-reasoner-actor',
      prevConf: 0.7,                  // above threshold — no anomaly
      prevAction: 'Read',
      consecutiveFailedParses: 0,
      wsUtilization: 0.3,
      promptInputTokens: 500,
      promptOutputTokens: 200,
      writeGateFired: false,
      promptSuccessfulReads: 3,       // >= 3 reads
      promptSuccessfulWrites: 0,      // 0 writes
      cycleDone: false,
      lastOutput: '',
    };

    const noControl: ControlDirective = { target: moduleId('monitor'), timestamp: Date.now() };
    const result = await monModule.step(monitoring, state, noControl);

    // Write gate should fire: restricted should contain all READ_ONLY_ACTIONS
    for (const tool of READ_ONLY_ACTIONS) {
      assert.ok(result.output.restricted.includes(tool), `restricted should contain ${tool}`);
    }
    assert.equal(result.output.forceReplan, true, 'Write gate should set forceReplan');
  });

  // ── Scenario 9: AC-4 — Monitor step() with writeGateFired: true -> gate does NOT re-fire ──

  it('Monitor step() with writeGateFired: true -> gate does NOT re-fire', async () => {
    const { ws, monitorPort } = createTestWorkspace();
    const { onEvent } = createEventCollector();

    const monModule = createBridgeMonitorModule(
      ws, monitorPort, 8,
      { confThreshold: 0.3, stagThreshold: 2, intBudget: 5 },
      onEvent,
    );

    const state = monModule.initialState();
    const monitoring: BridgeReasonerActorMonitoring = {
      source: moduleId('reasoner-actor'),
      timestamp: Date.now(),
      type: 'bridge-reasoner-actor',
      prevConf: 0.7,                  // above threshold
      prevAction: 'Read',
      consecutiveFailedParses: 0,
      wsUtilization: 0.3,
      promptInputTokens: 500,
      promptOutputTokens: 200,
      writeGateFired: true,           // already fired
      promptSuccessfulReads: 5,       // many reads
      promptSuccessfulWrites: 0,      // still 0 writes
      cycleDone: false,
      lastOutput: '',
    };

    const noControl: ControlDirective = { target: moduleId('monitor'), timestamp: Date.now() };
    const result = await monModule.step(monitoring, state, noControl);

    // Gate already fired — should NOT add read-only tools to restricted
    const hasReadOnlyRestriction = result.output.restricted.some(r => READ_ONLY_ACTIONS.has(r));
    assert.equal(hasReadOnlyRestriction, false, 'Write gate should NOT re-fire when writeGateFired is true');
  });

  // ── Scenario 10: AC-11 — Monitor initialState() returns fresh state ──

  it('Monitor initialState() returns fresh state (interventions=0, readOnlyRun=0, accumulatedInputTokens=0)', () => {
    const { ws, monitorPort } = createTestWorkspace();
    const { onEvent } = createEventCollector();

    const monModule = createBridgeMonitorModule(
      ws, monitorPort, 8,
      { confThreshold: 0.3, stagThreshold: 2, intBudget: 5 },
      onEvent,
    );

    const state = monModule.initialState();

    assert.equal(state.interventions, 0);
    assert.equal(state.readOnlyRun, 0);
    assert.equal(state.accumulatedInputTokens, 0);
  });

  // ── Scenario 11: AC-6 — Manual loop with monitor + raModule produces 'done' ──

  it('Manual composition loop: monitor + raModule produces done when adapter returns done action', async () => {
    const { ws, obsPort, raWritePort, raReadPort, monitorPort } = createTestWorkspace();
    const { events, onEvent } = createEventCollector();
    const adapter = createMockAdapter([
      buildResponse('Complete task', 'Task is done', { tool: 'done', input: { result: 'completed successfully' } }),
    ]);
    const tools = createMockTools();

    const raConfig = { maxToolsPerCycle: 5, maxOutputTokens: 8192, wsCapacity: 8, cycleNumber: 1, maxCycles: 3 };
    const raModule = createBridgeReasonerActorModule(
      adapter, tools, ws, raWritePort, raReadPort, obsPort, raConfig, onEvent,
    );
    const monModule = createBridgeMonitorModule(
      ws, monitorPort, 8,
      { confThreshold: 0.3, stagThreshold: 2, intBudget: 5 },
      onEvent,
    );

    // Seed workspace (Observer seeds)
    obsPort.write({ source: moduleId('observer'), content: 'Do the task', salience: 0.95, timestamp: Date.now() });

    let raState = raModule.initialState();
    let monState = monModule.initialState();
    let lastRAMonitoring: BridgeReasonerActorMonitoring | null = null;
    let lastOutput = '';
    let actualCycles = 0;

    for (let c = 0; c < 3; c++) {
      actualCycles = c + 1;
      raConfig.cycleNumber = c + 1;

      // Monitor FIRST
      const monResult = await monModule.step(
        lastRAMonitoring,
        monState,
        { target: moduleId('monitor'), timestamp: Date.now() },
      );
      monState = monResult.state;
      const control: BridgeMonitorControl = monResult.output;

      // RA SECOND
      const raResult = await raModule.step('Do the task', raState, control);
      raState = raResult.state;
      lastRAMonitoring = raResult.monitoring;

      if (raResult.monitoring.cycleDone) {
        lastOutput = raResult.monitoring.lastOutput;
        break;
      }
    }

    assert.equal(lastOutput, 'completed successfully');
    assert.equal(actualCycles, 1, 'Should complete in cycle 1');
    // Verify both modules ran (cycle-action 'done' event present)
    const doneEvent = events.find(e => e.type === 'cycle-action' && e.action === 'done');
    assert.ok(doneEvent, 'done action event should be emitted');
  });

  // ── Scenario 12: AC-7 — Monitor fires anomaly intervention in cycle 2 ──

  it('Manual composition loop: monitor fires anomaly in cycle 2 when cycle 1 has low confidence', async () => {
    const { ws, obsPort, raWritePort, raReadPort, monitorPort } = createTestWorkspace();
    const { events, onEvent } = createEventCollector();
    // Cycle 1: empty response → prevConf 0.1 (low confidence)
    // Cycle 2 (after monitor intervention with forceReplan): done
    const adapter = createMockAdapter([
      // Cycle 1: empty response → prevConf 0.1
      '   ',
      // Cycle 2 (after monitor intervention): done
      buildResponse('Done', 'Complete', { tool: 'done', input: { result: 'recovered' } }),
    ]);
    const tools = createMockTools();

    const raConfig = { maxToolsPerCycle: 5, maxOutputTokens: 8192, wsCapacity: 8, cycleNumber: 1, maxCycles: 5 };
    const raModule = createBridgeReasonerActorModule(
      adapter, tools, ws, raWritePort, raReadPort, obsPort, raConfig, onEvent,
    );
    const monModule = createBridgeMonitorModule(
      ws, monitorPort, 8,
      { confThreshold: 0.3, stagThreshold: 2, intBudget: 5 },
      onEvent,
    );

    obsPort.write({ source: moduleId('observer'), content: 'Task', salience: 0.95, timestamp: Date.now() });

    let raState = raModule.initialState();
    let monState = monModule.initialState();
    let lastRAMonitoring: BridgeReasonerActorMonitoring | null = null;
    let lastOutput = '';
    let cycle2Control: BridgeMonitorControl | null = null;

    for (let c = 0; c < 5; c++) {
      raConfig.cycleNumber = c + 1;

      // Monitor FIRST
      const monResult = await monModule.step(
        lastRAMonitoring,
        monState,
        { target: moduleId('monitor'), timestamp: Date.now() },
      );
      monState = monResult.state;
      const control: BridgeMonitorControl = monResult.output;

      if (c === 1) {
        cycle2Control = control;
      }

      // RA SECOND
      const raResult = await raModule.step('Task', raState, control);
      raState = raResult.state;
      lastRAMonitoring = raResult.monitoring;

      if (raResult.monitoring.cycleDone) {
        lastOutput = raResult.monitoring.lastOutput;
        break;
      }
    }

    // Verify: cycle 1 produced low-confidence monitoring (empty response → prevConf 0.1)
    // Monitor in cycle 2 should have detected anomaly and set forceReplan
    assert.ok(cycle2Control, 'Cycle 2 control should exist');
    assert.equal(cycle2Control!.forceReplan, true, 'Monitor should set forceReplan in cycle 2 due to low confidence from cycle 1');
    // Verify a monitor event was emitted for the anomaly
    const monitorEvent = events.find(e => e.type === 'monitor' && (e.intervention === 'constrain' || e.intervention === 'reframe'));
    assert.ok(monitorEvent, 'Monitor anomaly event should be emitted in cycle 2');
    assert.equal(lastOutput, 'recovered', 'Session should complete with recovered output');
  });
});
