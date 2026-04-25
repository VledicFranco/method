// SPDX-License-Identifier: Apache-2.0
/**
 * End-to-end integration test — PRD 058 C-4.
 *
 * Drives a real CognitiveCycle through tracingMiddleware → SqliteTraceStore
 * to verify the full trace pipeline: cycle.ts emits events, the store's
 * embedded TraceAssembler reconstructs them, the resulting CycleTrace is
 * persisted on cycle-end, and the read API surfaces it.
 *
 * Exercises:
 *   - C-1 (TraceAssembler — internal to SqliteTraceStore)
 *   - C-2 (cycle.ts emits CYCLE/PHASE events)
 *   - C-3 (tracingMiddleware emits OPERATION events) — out of scope for this
 *     test because cycle.ts uses traceSinks for module steps, not
 *     AgentProvider middleware. Tracing-middleware integration with
 *     AgentProvider is covered by tracing-middleware.test.ts in pacta.
 *   - C-4 (SqliteTraceStore persists the assembled cycle)
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SqliteTraceStore } from './sqlite-store.js';
import {
  createCognitiveCycle,
  moduleId,
  type CycleConfig,
  type CycleModules,
  type WorkspaceManager,
  type WorkspaceEntry,
  type WorkspaceReadPort,
  type WorkspaceWritePort,
  type ModuleId,
  type ControlPolicy,
  type CognitiveModule,
  type StepResult,
  type MonitoringSignal,
} from '@methodts/pacta';

// ── Test stubs (mirror pacta's cycle.test.ts shape, simplified) ──

interface StubConfig {
  id: string;
  output?: unknown;
  monitoring?: Partial<MonitoringSignal>;
}

function createStubModule(c: StubConfig): CognitiveModule<any, any, any, any, any> {
  const id = moduleId(c.id);
  return {
    id,
    initialState() {
      return { callCount: 0 };
    },
    async step(_input: any, state: any, _control: any): Promise<StepResult<any, any, any>> {
      const monitoring: MonitoringSignal = {
        source: id,
        timestamp: Date.now(),
        ...(c.monitoring ?? {}),
      };
      return {
        output: c.output ?? { result: `${c.id}-output` },
        state: { callCount: (state?.callCount ?? 0) + 1 },
        monitoring,
      };
    },
  } as CognitiveModule<any, any, any, any, any>;
}

function makeModules(): CycleModules {
  return {
    observer: createStubModule({ id: 'observer', monitoring: { type: 'observer' } as any }),
    memory: createStubModule({ id: 'memory', monitoring: { type: 'memory' } as any }),
    reasoner: createStubModule({ id: 'reasoner', monitoring: { type: 'reasoner', confidence: 0.85, conflictDetected: false, effortLevel: 'medium' } as any }),
    actor: createStubModule({ id: 'actor', output: { actionName: 'noop', result: { output: 'done' }, escalated: false }, monitoring: { type: 'actor', actionTaken: 'noop', success: true, unexpectedResult: false } as any }),
    monitor: createStubModule({ id: 'monitor', monitoring: { type: 'monitor', anomalyDetected: false } as any }),
    evaluator: createStubModule({ id: 'evaluator', monitoring: { type: 'evaluator', estimatedProgress: 0.5, diminishingReturns: false } as any }),
    planner: createStubModule({ id: 'planner', output: { directives: [], plan: 'p', subgoals: [] }, monitoring: { type: 'planner', planRevised: false, subgoalCount: 0 } as any }),
    reflector: createStubModule({ id: 'reflector', monitoring: { type: 'reflector', lessonsExtracted: 1 } as any }),
  };
}

function makeWorkspace(): WorkspaceManager {
  const entries: WorkspaceEntry[] = [];
  return {
    getReadPort(_mid: ModuleId): WorkspaceReadPort {
      return {
        read: () => [...entries],
        attend: (b: number) => entries.slice(0, b),
        snapshot: () => entries.map((e) => ({ ...e })),
      };
    },
    getWritePort(mid: ModuleId): WorkspaceWritePort {
      return {
        write(e: WorkspaceEntry) {
          entries.push({ ...e, source: mid });
        },
      };
    },
    resetCycleQuotas() {},
    getEvictions() {
      return [];
    },
    getWriteLog() {
      return [];
    },
    snapshot() {
      return entries.map((e) => ({ ...e }));
    },
    attend(b: number) {
      return entries.slice(0, b);
    },
  };
}

function makeConfig(): CycleConfig {
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

// ── Tests ────────────────────────────────────────────────────────

describe('Integration — cycle.ts → SqliteTraceStore round-trip', () => {
  it('persists an assembled CycleTrace from a real 6-phase cognitive cycle', async () => {
    const store = new SqliteTraceStore({ dbPath: ':memory:', retentionDays: 0 });
    await store.initialize();

    const cycle = createCognitiveCycle(makeModules(), makeConfig());
    const workspace = makeWorkspace();

    const result = await cycle.run('integration test input', workspace, [store]);
    assert.equal(result.aborted, undefined);
    assert.ok(result.phasesExecuted.length >= 4);

    // Give async sink writes a moment in case of microtask scheduling.
    // (better-sqlite3 is sync, but onEvent is async-typed.)
    await new Promise((r) => setTimeout(r, 10));

    // Recent cycles should include exactly one with our input.
    const recent = await store.getCycles({ limit: 10 });
    assert.equal(recent.length, 1, 'one CycleTrace persisted');

    const persisted = recent[0]!;
    assert.equal(persisted.inputText, 'integration test input');
    assert.ok(persisted.phases.length >= 4, 'all phases captured');
    // Phase names should match phasesExecuted (at least the common ones).
    const phaseNames = persisted.phases.map((p) => p.phase);
    assert.ok(phaseNames.includes('OBSERVE'));
    assert.ok(phaseNames.includes('ACT') || phaseNames.includes('REASON'));
    assert.ok(persisted.durationMs >= 0);

    await store.close();
  });

  it('round-trips through stats aggregation', async () => {
    const store = new SqliteTraceStore({ dbPath: ':memory:', retentionDays: 0 });
    await store.initialize();

    const cycle = createCognitiveCycle(makeModules(), makeConfig());
    const workspace = makeWorkspace();

    // Run 3 cycles.
    await cycle.run('one', workspace, [store]);
    await cycle.run('two', workspace, [store]);
    await cycle.run('three', workspace, [store]);
    await new Promise((r) => setTimeout(r, 10));

    const stats = await store.getStats({ windowCycles: 10 });
    assert.equal(stats.cycleCount, 3);
    assert.ok(stats.avgDurationMs >= 0);
    assert.ok(stats.phaseAvgDurations.size > 0, 'phase durations aggregated');

    await store.close();
  });
});
