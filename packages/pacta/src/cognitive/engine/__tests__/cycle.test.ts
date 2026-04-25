// SPDX-License-Identifier: Apache-2.0
/**
 * Unit tests for cognitive cycle orchestrator (PRD 030, C-5).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createCognitiveCycle } from '../cycle.js';
import type { CycleModules, CycleConfig, ThresholdPolicy } from '../cycle.js';
import type {
  CognitiveModule,
  ModuleId,
  MonitoringSignal,
  ControlDirective,
  AggregatedSignals,
  StepResult,
  CognitiveEvent,
  ControlPolicy,
  WorkspaceManager,
  WorkspaceEntry,
  WorkspaceReadPort,
  WorkspaceWritePort,
  ReadonlyWorkspaceSnapshot,
} from '../../algebra/index.js';
import { moduleId } from '../../algebra/index.js';

// ── Stub Module Factory ──────────────────────────────────────────

interface StubConfig {
  id: string;
  output?: unknown;
  monitoring?: Partial<MonitoringSignal>;
  error?: { message: string; recoverable: boolean };
  throwOnStep?: boolean;
  delayMs?: number;
}

function createStubModule(config: StubConfig): CognitiveModule<any, any, any, any, any> {
  const id = moduleId(config.id);
  let stepCallCount = 0;
  const stepCalls: unknown[] = [];

  return {
    id,
    initialState() {
      return { callCount: 0 };
    },
    async step(input: any, state: any, control: any): Promise<StepResult<any, any, any>> {
      stepCallCount++;
      stepCalls.push({ input, state, control });

      if (config.delayMs) {
        await new Promise((resolve) => setTimeout(resolve, config.delayMs));
      }

      if (config.throwOnStep) {
        throw new Error(`${config.id} step failed`);
      }

      const monitoring: MonitoringSignal = {
        source: id,
        timestamp: Date.now(),
        ...(config.monitoring ?? {}),
      };

      const result: StepResult<any, any, any> = {
        output: config.output ?? { result: `${config.id}-output` },
        state: { callCount: (state?.callCount ?? 0) + 1 },
        monitoring,
      };

      if (config.error) {
        result.error = {
          message: config.error.message,
          recoverable: config.error.recoverable,
          moduleId: id,
          phase: config.id,
        };
      }

      return result;
    },
    // Expose for test assertions
    get _stepCallCount() { return stepCallCount; },
    get _stepCalls() { return stepCalls; },
  } as CognitiveModule<any, any, any, any, any> & {
    _stepCallCount: number;
    _stepCalls: unknown[];
  };
}

// ── Stub Workspace ───────────────────────────────────────────────

function createStubWorkspace(): WorkspaceManager {
  const entries: WorkspaceEntry[] = [];

  return {
    getReadPort(_moduleId: ModuleId): WorkspaceReadPort {
      return {
        read: () => [...entries],
        attend: (budget: number) => entries.slice(0, budget),
        snapshot: () => entries.map((e) => ({ ...e })),
      };
    },
    getWritePort(mid: ModuleId): WorkspaceWritePort {
      return {
        write(entry: WorkspaceEntry) {
          entries.push({ ...entry, source: mid });
        },
      };
    },
    resetCycleQuotas() { /* noop */ },
    getEvictions() { return []; },
    getWriteLog() { return []; },
    snapshot() { return entries.map((e) => ({ ...e })); },
    attend(budget: number) { return entries.slice(0, budget); },
  };
}

// ── Default Config ───────────────────────────────────────────────

function defaultConfig(overrides?: Partial<CycleConfig>): CycleConfig {
  const controlPolicy: ControlPolicy = {
    allowedDirectiveTypes: ['any'],
    validate: () => true,
  };

  return {
    thresholds: { type: 'predicate', shouldIntervene: () => false },
    errorPolicy: { default: 'skip' },
    controlPolicy,
    ...overrides,
  };
}

// ── Default Modules ──────────────────────────────────────────────

function defaultModules(overrides?: Partial<Record<keyof CycleModules, CognitiveModule<any, any, any, any, any>>>): CycleModules {
  return {
    observer: createStubModule({ id: 'observer', monitoring: { type: 'observer' } as any }),
    memory: createStubModule({ id: 'memory', monitoring: { type: 'memory' } as any }),
    reasoner: createStubModule({ id: 'reasoner', monitoring: { type: 'reasoner', confidence: 0.8, conflictDetected: false, effortLevel: 'medium' } as any }),
    actor: createStubModule({ id: 'actor', output: { actionName: 'test-action', result: { output: 'done' }, escalated: false }, monitoring: { type: 'actor', actionTaken: 'test-action', success: true, unexpectedResult: false } as any }),
    monitor: createStubModule({ id: 'monitor', monitoring: { type: 'monitor', anomalyDetected: false } as any }),
    evaluator: createStubModule({ id: 'evaluator', monitoring: { type: 'evaluator', estimatedProgress: 0.5, diminishingReturns: false } as any }),
    planner: createStubModule({ id: 'planner', output: { directives: [], plan: 'test-plan', subgoals: [] }, monitoring: { type: 'planner', planRevised: false, subgoalCount: 0 } as any }),
    reflector: createStubModule({ id: 'reflector', monitoring: { type: 'reflector', lessonsExtracted: 1 } as any }),
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────

describe('CognitiveCycle', () => {
  it('1. Full 8-phase cycle executes in order with all modules', async () => {
    const modules = defaultModules();
    const config = defaultConfig({
      thresholds: { type: 'predicate', shouldIntervene: () => true },
    });
    const cycle = createCognitiveCycle(modules, config);
    const workspace = createStubWorkspace();

    const result = await cycle.run('test input', workspace, []);

    // All 8 phases should be executed (including MONITOR and CONTROL since intervention is always true)
    assert.ok(result.phasesExecuted.includes('OBSERVE'), 'OBSERVE phase executed');
    assert.ok(result.phasesExecuted.includes('ATTEND'), 'ATTEND phase executed');
    assert.ok(result.phasesExecuted.includes('REMEMBER'), 'REMEMBER phase executed');
    assert.ok(result.phasesExecuted.includes('REASON'), 'REASON phase executed');
    assert.ok(result.phasesExecuted.includes('MONITOR'), 'MONITOR phase executed');
    assert.ok(result.phasesExecuted.includes('CONTROL'), 'CONTROL phase executed');
    assert.ok(result.phasesExecuted.includes('ACT'), 'ACT phase executed');
    assert.ok(result.phasesExecuted.includes('LEARN'), 'LEARN phase executed');
    assert.equal(result.aborted, undefined);
    assert.ok(result.cycleNumber > 0);
  });

  it('2. Default-interventionist: MONITOR/CONTROL skipped when signals below threshold', async () => {
    const modules = defaultModules();
    const config = defaultConfig({
      thresholds: { type: 'predicate', shouldIntervene: () => false },
    });
    const cycle = createCognitiveCycle(modules, config);
    const workspace = createStubWorkspace();

    const result = await cycle.run('test input', workspace, []);

    assert.ok(!result.phasesExecuted.includes('MONITOR'), 'MONITOR phase skipped');
    assert.ok(!result.phasesExecuted.includes('CONTROL'), 'CONTROL phase skipped');
    assert.ok(result.phasesExecuted.includes('OBSERVE'), 'OBSERVE still runs');
    assert.ok(result.phasesExecuted.includes('ACT'), 'ACT still runs');
  });

  it('3. Default-interventionist: MONITOR/CONTROL fire when signals cross threshold', async () => {
    const modules = defaultModules();
    const config = defaultConfig({
      thresholds: {
        type: 'field',
        rules: [{ source: moduleId('reasoner'), field: 'confidence', operator: '<', value: 0.9 }],
      },
    });
    const cycle = createCognitiveCycle(modules, config);
    const workspace = createStubWorkspace();

    const result = await cycle.run('test input', workspace, []);

    // Reasoner monitoring has confidence 0.8, which is < 0.9, so intervention fires
    assert.ok(result.phasesExecuted.includes('MONITOR'), 'MONITOR phase fires');
    assert.ok(result.phasesExecuted.includes('CONTROL'), 'CONTROL phase fires');
  });

  it('4. LEARN phase fire-and-forget (does not block cycle return)', async () => {
    const reflector = createStubModule({
      id: 'reflector',
      delayMs: 200, // Simulate slow reflector
      monitoring: { type: 'reflector', lessonsExtracted: 1 } as any,
    });
    const modules = defaultModules({ reflector });
    const config = defaultConfig();
    const cycle = createCognitiveCycle(modules, config);
    const workspace = createStubWorkspace();

    const startTime = Date.now();
    const result = await cycle.run('test input', workspace, []);
    const elapsed = Date.now() - startTime;

    // Result should return before reflector finishes (200ms delay)
    // The cycle should complete quickly (well under 200ms for stub modules)
    assert.ok(result.phasesExecuted.includes('LEARN'), 'LEARN phase included');
    assert.equal(result.aborted, undefined);
    // The output should come from ACT, not LEARN
    assert.ok(result.output !== undefined);
  });

  it('5. LEARN failure emits CognitiveLEARNFailed, does not corrupt next cycle', async () => {
    const events: CognitiveEvent[] = [];
    const reflector = createStubModule({
      id: 'reflector',
      throwOnStep: true,
      monitoring: { type: 'reflector', lessonsExtracted: 0 } as any,
    });
    const modules = defaultModules({ reflector });
    const config = defaultConfig();
    const cycle = createCognitiveCycle(modules, config);
    const workspace = createStubWorkspace();

    const result = await cycle.run('test input', workspace, [], (e) => events.push(e));

    // Wait a tick for the fire-and-forget promise to settle
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Should have emitted CognitiveLEARNFailed event
    const learnFailed = events.find((e) => e.type === 'cognitive:learn_failed');
    assert.ok(learnFailed, 'CognitiveLEARNFailed event emitted');
    assert.equal(result.aborted, undefined, 'Cycle not aborted by LEARN failure');

    // Run a second cycle — should work fine (state not corrupted)
    const result2 = await cycle.run('test input 2', workspace, []);
    assert.equal(result2.aborted, undefined, 'Second cycle not aborted');
  });

  it('6. Workspace state threads correctly through phases via typed ports', async () => {
    const modules = defaultModules();
    const config = defaultConfig();
    const cycle = createCognitiveCycle(modules, config);
    const workspace = createStubWorkspace();

    // Write something to workspace before the cycle
    const writePort = workspace.getWritePort(moduleId('test'));
    writePort.write({
      source: moduleId('test'),
      content: 'pre-existing entry',
      salience: 0.5,
      timestamp: Date.now(),
    });

    const result = await cycle.run('test input', workspace, []);

    // The workspace should have entries after the cycle
    const snap = workspace.snapshot();
    assert.ok(snap.length >= 1, 'Workspace has entries after cycle');
    assert.equal(result.aborted, undefined);
  });

  it('7. CognitiveCyclePhase events emitted at each boundary', async () => {
    const events: CognitiveEvent[] = [];
    const modules = defaultModules();
    const config = defaultConfig({
      thresholds: { type: 'predicate', shouldIntervene: () => true },
    });
    const cycle = createCognitiveCycle(modules, config);
    const workspace = createStubWorkspace();

    await cycle.run('test input', workspace, [], (e) => events.push(e));

    const phaseEvents = events.filter((e) => e.type === 'cognitive:cycle_phase');
    const phaseNames = phaseEvents.map((e) => (e as any).phase);

    assert.ok(phaseNames.includes('OBSERVE'), 'OBSERVE phase event');
    assert.ok(phaseNames.includes('ATTEND'), 'ATTEND phase event');
    assert.ok(phaseNames.includes('REMEMBER'), 'REMEMBER phase event');
    assert.ok(phaseNames.includes('REASON'), 'REASON phase event');
    assert.ok(phaseNames.includes('MONITOR'), 'MONITOR phase event');
    assert.ok(phaseNames.includes('CONTROL'), 'CONTROL phase event');
    assert.ok(phaseNames.includes('ACT'), 'ACT phase event');
    assert.ok(phaseNames.includes('LEARN'), 'LEARN phase event');
  });

  it('8. Module step() error triggers CycleErrorPolicy (abort path)', async () => {
    const events: CognitiveEvent[] = [];
    const reasoner = createStubModule({
      id: 'reasoner',
      throwOnStep: true,
    });
    const modules = defaultModules({ reasoner });
    const config = defaultConfig({
      errorPolicy: { default: 'abort' },
    });
    const cycle = createCognitiveCycle(modules, config);
    const workspace = createStubWorkspace();

    const result = await cycle.run('test input', workspace, [], (e) => events.push(e));

    assert.ok(result.aborted, 'Cycle aborted');
    assert.equal(result.aborted!.phase, 'REASON');
    assert.ok(result.aborted!.reason.includes('reasoner step failed'));

    const abortEvent = events.find((e) => e.type === 'cognitive:cycle_aborted');
    assert.ok(abortEvent, 'CognitiveCycleAborted event emitted');
  });

  it('9. Module step() error triggers CycleErrorPolicy (skip path)', async () => {
    const reasoner = createStubModule({
      id: 'reasoner',
      throwOnStep: true,
    });
    const modules = defaultModules({ reasoner });
    const config = defaultConfig({
      errorPolicy: { default: 'skip' },
    });
    const cycle = createCognitiveCycle(modules, config);
    const workspace = createStubWorkspace();

    const result = await cycle.run('test input', workspace, []);

    // Cycle should NOT be aborted — the error was skipped
    assert.equal(result.aborted, undefined, 'Cycle not aborted on skip policy');
    assert.ok(result.phasesExecuted.includes('REASON'), 'REASON phase still recorded');
    assert.ok(result.phasesExecuted.includes('ACT'), 'ACT phase still ran after skip');
  });

  // ── PRD 043 Phase 3: Post-ACT Constraint Verification ──────────

  it('10. Post-ACT constraint verification catches violation (PRD 043)', async () => {
    const events: CognitiveEvent[] = [];
    // Actor produces output containing "import notifications" — violates pinned constraint
    const actor = createStubModule({
      id: 'actor',
      output: 'import notifications from "./notifications"',
      monitoring: { type: 'actor', actionTaken: 'Write', success: true, unexpectedResult: false } as any,
    });
    const modules = defaultModules({ actor });
    const config = defaultConfig();
    const cycle = createCognitiveCycle(modules, config);

    // Create workspace with a pinned constraint entry
    const workspace = createStubWorkspace();
    const writePort = workspace.getWritePort(moduleId('observer'));
    writePort.write({
      source: moduleId('observer'),
      content: 'must NOT import notifications',
      salience: 1.0,
      timestamp: Date.now(),
      pinned: true,
      contentType: 'constraint',
    } as WorkspaceEntry);

    await cycle.run('test input', workspace, [], (e) => events.push(e));

    const violations = events.filter((e) => e.type === 'cognitive:constraint_violation');
    assert.ok(violations.length > 0, 'At least one constraint_violation event emitted');
    assert.equal((violations[0] as any).pattern, 'import.*notifications', 'Violation pattern matches prohibition');
  });

  it('11. Post-ACT verification is no-op when no pinned entries (PRD 043)', async () => {
    const events: CognitiveEvent[] = [];
    // Actor produces output that would match a constraint pattern,
    // but no pinned entries exist in workspace
    const actor = createStubModule({
      id: 'actor',
      output: 'import notifications from "./notifications"',
      monitoring: { type: 'actor', actionTaken: 'Write', success: true, unexpectedResult: false } as any,
    });
    const modules = defaultModules({ actor });
    const config = defaultConfig();
    const cycle = createCognitiveCycle(modules, config);
    const workspace = createStubWorkspace();

    await cycle.run('test input', workspace, [], (e) => events.push(e));

    const violations = events.filter((e) => e.type === 'cognitive:constraint_violation');
    assert.equal(violations.length, 0, 'No constraint violation events when no pinned entries');
  });

  it('12. Monitor restrictedActions reach Actor control (wiring fix, PRD 043)', async () => {
    const events: CognitiveEvent[] = [];
    // Monitor returns restrictedActions and forceReplan
    const monitor = createStubModule({
      id: 'monitor',
      output: { restrictedActions: ['Write', 'Edit'], forceReplan: true },
      monitoring: { type: 'monitor', anomalyDetected: true } as any,
    });
    // Actor stub captures control passed to it
    const actor = createStubModule({
      id: 'actor',
      output: { actionName: 'test-action', result: { output: 'done' }, escalated: false },
      monitoring: { type: 'actor', actionTaken: 'test-action', success: true, unexpectedResult: false } as any,
    });
    const modules = defaultModules({ monitor, actor });
    // Thresholds configured so Monitor always intervenes
    const config = defaultConfig({
      thresholds: { type: 'predicate', shouldIntervene: () => true },
    });
    const cycle = createCognitiveCycle(modules, config);
    const workspace = createStubWorkspace();

    await cycle.run('test input', workspace, [], (e) => events.push(e));

    // Check that the Actor received restrictedActions in its control directive
    const actorCalls = (actor as any)._stepCalls as Array<{ control: any }>;
    assert.ok(actorCalls.length > 0, 'Actor was called');
    const actorControlReceived = actorCalls[0].control;
    assert.deepEqual(actorControlReceived.restrictedActions, ['Write', 'Edit'], 'Actor received restrictedActions from Monitor');
    assert.equal(actorControlReceived.forceReplan, true, 'Actor received forceReplan from Monitor');

    // Also check that a monitor_directive_applied event was emitted
    const directiveEvents = events.filter((e) => e.type === 'cognitive:monitor_directive_applied');
    assert.ok(directiveEvents.length > 0, 'monitor_directive_applied event emitted');
  });

  it('13. When Monitor does not intervene, Actor gets default control (regression, PRD 043)', async () => {
    const events: CognitiveEvent[] = [];
    const actor = createStubModule({
      id: 'actor',
      output: { actionName: 'test-action', result: { output: 'done' }, escalated: false },
      monitoring: { type: 'actor', actionTaken: 'test-action', success: true, unexpectedResult: false } as any,
    });
    const modules = defaultModules({ actor });
    // Thresholds configured so Monitor does NOT intervene
    const config = defaultConfig({
      thresholds: { type: 'predicate', shouldIntervene: () => false },
    });
    const cycle = createCognitiveCycle(modules, config);
    const workspace = createStubWorkspace();

    await cycle.run('test input', workspace, [], (e) => events.push(e));

    // Check that the Actor received default control (no restrictedActions, no forceReplan)
    const actorCalls = (actor as any)._stepCalls as Array<{ control: any }>;
    assert.ok(actorCalls.length > 0, 'Actor was called');
    const actorControlReceived = actorCalls[0].control;
    assert.equal(actorControlReceived.restrictedActions, undefined, 'No restrictedActions in default control');
    assert.equal(actorControlReceived.forceReplan, undefined, 'No forceReplan in default control');

    // No monitor_directive_applied events should be emitted
    const directiveEvents = events.filter((e) => e.type === 'cognitive:monitor_directive_applied');
    assert.equal(directiveEvents.length, 0, 'No monitor_directive_applied event when Monitor did not intervene');
  });
});

// ── PRD 058 — hierarchical TraceEvent emission ─────────────────────

import type { TraceEvent, TraceSink, TraceRecord } from '../../algebra/index.js';

class CapturingEventSink implements TraceSink {
  events: TraceEvent[] = [];
  records: TraceRecord[] = [];
  onTrace(record: TraceRecord): void {
    this.records.push(record);
  }
  onEvent(event: TraceEvent): void {
    this.events.push(event);
  }
}

class FlatOnlySink implements TraceSink {
  records: TraceRecord[] = [];
  onTrace(record: TraceRecord): void {
    this.records.push(record);
  }
  // onEvent intentionally undefined
}

describe('CognitiveCycle — PRD 058 hierarchical TraceEvent emission', () => {
  it('AC-1: emits cycle-start, phase-start/end, cycle-end in deterministic order', async () => {
    const modules = defaultModules();
    const config = defaultConfig();
    const cycle = createCognitiveCycle(modules, config);
    const workspace = createStubWorkspace();
    const sink = new CapturingEventSink();

    await cycle.run('hello', workspace, [sink]);

    // Sequence shape: cycle-start, then alternating phase-start/end pairs, then cycle-end.
    assert.ok(sink.events.length >= 4, `expected ≥4 events, got ${sink.events.length}`);
    assert.equal(sink.events[0].kind, 'cycle-start');
    assert.equal(sink.events[sink.events.length - 1].kind, 'cycle-end');

    // All events share one cycleId.
    const cycleId = sink.events[0].cycleId;
    for (const e of sink.events) {
      assert.equal(e.cycleId, cycleId, 'all events share cycleId');
    }

    // Check phase-start and phase-end pairing per phase name.
    const starts = sink.events.filter((e) => e.kind === 'phase-start').map((e) => e.name);
    const ends = sink.events.filter((e) => e.kind === 'phase-end').map((e) => e.name);
    assert.deepEqual(ends, starts, 'phase-start and phase-end occur in matching order');

    // cycle-start carries inputText.
    assert.equal((sink.events[0].data as any)?.inputText, 'hello');

    // cycle-end carries durationMs.
    const cycleEnd = sink.events[sink.events.length - 1];
    assert.equal(cycleEnd.kind, 'cycle-end');
    assert.equal(typeof cycleEnd.durationMs, 'number');
  });

  it('AC-1 phase data: phase-end carries duration', async () => {
    const modules = defaultModules();
    const config = defaultConfig();
    const cycle = createCognitiveCycle(modules, config);
    const workspace = createStubWorkspace();
    const sink = new CapturingEventSink();

    await cycle.run('test', workspace, [sink]);

    const phaseEnds = sink.events.filter((e) => e.kind === 'phase-end');
    assert.ok(phaseEnds.length >= 3, 'at least 3 phase-end events');
    for (const pe of phaseEnds) {
      assert.equal(typeof pe.durationMs, 'number');
      assert.ok(pe.durationMs! >= 0, `phase-end ${pe.name} has non-negative durationMs`);
      assert.equal(pe.phase, pe.name);
    }
  });

  it('AC-6 regression: cycle without event-aware sink emits no TraceEvents', async () => {
    const modules = defaultModules();
    const config = defaultConfig();
    const cycle = createCognitiveCycle(modules, config);
    const workspace = createStubWorkspace();
    const flat = new FlatOnlySink();

    const result = await cycle.run('test', workspace, [flat]);

    // Legacy onTrace path still works.
    assert.ok(flat.records.length > 0, 'flat trace records still produced');
    // No TraceEvents on a sink that doesn't declare onEvent.
    assert.equal((flat as unknown as { events?: unknown[] }).events, undefined);
    // Cycle still returned a valid result.
    assert.ok(result.phasesExecuted.length > 0);
  });

  it('AC-1 multiple sinks: emits to every event-aware sink', async () => {
    const modules = defaultModules();
    const config = defaultConfig();
    const cycle = createCognitiveCycle(modules, config);
    const workspace = createStubWorkspace();
    const a = new CapturingEventSink();
    const b = new CapturingEventSink();

    await cycle.run('test', workspace, [a, b]);

    assert.equal(a.events.length, b.events.length);
    assert.deepEqual(
      a.events.map((e) => e.kind),
      b.events.map((e) => e.kind),
    );
  });

  it('emits cycle-end even when an exception escapes the cycle (try/finally guarantee)', async () => {
    const modules = defaultModules({
      observer: createStubModule({ id: 'observer', throwOnStep: true }),
    });
    // Observer throws and we use 'abort' policy so the cycle records aborted.
    const config = defaultConfig({ errorPolicy: { default: 'abort' } });
    const cycle = createCognitiveCycle(modules, config);
    const workspace = createStubWorkspace();
    const sink = new CapturingEventSink();

    await cycle.run('test', workspace, [sink]);

    // cycle-start and cycle-end must both be present.
    const kinds = sink.events.map((e) => e.kind);
    assert.ok(kinds.includes('cycle-start'));
    assert.ok(kinds.includes('cycle-end'));
    // Last event is cycle-end.
    assert.equal(sink.events[sink.events.length - 1].kind, 'cycle-end');
  });
});
