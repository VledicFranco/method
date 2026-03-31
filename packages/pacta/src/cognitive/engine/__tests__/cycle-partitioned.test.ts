/**
 * Partitioned Cycle Tests — PRD 044 C-3.
 *
 * Validates the opt-in partitioned context path in the cycle orchestrator.
 * The legacy path (no partitionSystem) is tested in cycle.test.ts.
 */

import { describe, it, expect, vi } from 'vitest';
import { createCognitiveCycle } from '../cycle.js';
import type { CycleConfig, CycleModules } from '../cycle.js';
import type {
  CognitiveModule,
  StepResult,
  ControlPolicy,
  WorkspaceManager,
  WorkspaceEntry,
  WorkspaceReadPort,
  WorkspaceWritePort,
  ReadonlyWorkspaceSnapshot,
  CognitiveEvent,
  TraceSink,
} from '../../algebra/index.js';
import { moduleId } from '../../algebra/module.js';
import { createPartitionSystem } from '../../partitions/partition-system.js';

// ── Helpers ─────────────────────────────────────────────────────

function createStubModule(id: string, output?: unknown): CognitiveModule<any, any, any, any, any> {
  return {
    id: moduleId(id),
    initialState: () => ({}),
    async step(_input: any, state: any, _control: any): Promise<StepResult<any, any, any>> {
      return {
        output: output ?? { result: `${id}-output` },
        state,
        monitoring: { source: moduleId(id), timestamp: Date.now() },
      };
    },
  };
}

function createStubModules(overrides?: Partial<CycleModules>): CycleModules {
  return {
    observer: createStubModule('observer'),
    memory: createStubModule('memory'),
    reasoner: createStubModule('reasoner'),
    actor: createStubModule('actor'),
    monitor: createStubModule('monitor'),
    evaluator: createStubModule('evaluator'),
    planner: createStubModule('planner'),
    reflector: createStubModule('reflector'),
    ...overrides,
  };
}

function createStubWorkspace(): WorkspaceManager {
  const entries: WorkspaceEntry[] = [];
  const readPort: WorkspaceReadPort = {
    read: () => [...entries],
    attend: () => [...entries],
    snapshot: () => [...entries] as ReadonlyWorkspaceSnapshot,
  };
  const writePort: WorkspaceWritePort = {
    write: (entry: WorkspaceEntry) => { entries.push(entry); },
  };
  return {
    getReadPort: () => readPort,
    getWritePort: () => writePort,
    resetCycleQuotas: () => {},
    getEvictions: () => [],
    getWriteLog: () => [],
    snapshot: () => [...entries] as ReadonlyWorkspaceSnapshot,
    attend: () => [...entries],
  } as unknown as WorkspaceManager;
}

function defaultConfig(overrides?: Partial<CycleConfig>): CycleConfig {
  const controlPolicy: ControlPolicy = {
    validate: () => true,
    allowedDirectiveTypes: ['restrict', 'replan'],
  };
  return {
    thresholds: { type: 'predicate', shouldIntervene: () => false },
    errorPolicy: { default: 'skip' },
    controlPolicy,
    ...overrides,
  };
}

const noopSink: TraceSink = { onTrace: () => {} };

// ── Tests ───────────────────────────────────────────────────────

describe('Cognitive Cycle — Partitioned Path (PRD 044)', () => {
  it('runs cycle with partitionSystem and completes all phases', async () => {
    const partitions = createPartitionSystem();
    const modules = createStubModules();
    const config = defaultConfig({ partitionSystem: partitions });
    const cycle = createCognitiveCycle(modules, config);
    const workspace = createStubWorkspace();

    const result = await cycle.run('test input', workspace, [noopSink]);

    expect(result.aborted).toBeUndefined();
    expect(result.phasesExecuted).toContain('OBSERVE');
    expect(result.phasesExecuted).toContain('ACT');
    expect(result.phasesExecuted).toContain('LEARN');
  });

  it('legacy path still works when partitionSystem is not provided', async () => {
    const modules = createStubModules();
    const config = defaultConfig(); // no partitionSystem
    const cycle = createCognitiveCycle(modules, config);
    const workspace = createStubWorkspace();

    const result = await cycle.run('test input', workspace, [noopSink]);

    expect(result.aborted).toBeUndefined();
    expect(result.phasesExecuted).toContain('OBSERVE');
    expect(result.phasesExecuted).toContain('ACT');
  });

  it('emits constraint violation event when partition monitor detects violation', async () => {
    const partitions = createPartitionSystem();

    // Write a constraint to the partition system
    partitions.write(
      {
        source: moduleId('observer'),
        content: 'must NOT import notifications',
        salience: 1,
        timestamp: Date.now(),
        pinned: true,
        contentType: 'constraint',
      },
      moduleId('observer'),
    );

    // Actor produces output that violates the constraint
    const modules = createStubModules({
      actor: createStubModule('actor', 'import { send } from notifications'),
    });

    const events: CognitiveEvent[] = [];
    const config = defaultConfig({ partitionSystem: partitions });
    const cycle = createCognitiveCycle(modules, config);
    const workspace = createStubWorkspace();

    await cycle.run('test input', workspace, [noopSink], (e) => events.push(e));

    const violations = events.filter(e => e.type === 'cognitive:constraint_violation');
    expect(violations.length).toBeGreaterThan(0);
  });

  it('no constraint violation event when actor output is clean', async () => {
    const partitions = createPartitionSystem();

    partitions.write(
      {
        source: moduleId('observer'),
        content: 'must NOT import notifications',
        salience: 1,
        timestamp: Date.now(),
        pinned: true,
        contentType: 'constraint',
      },
      moduleId('observer'),
    );

    const modules = createStubModules({
      actor: createStubModule('actor', 'const handler = createHandler()'),
    });

    const events: CognitiveEvent[] = [];
    const config = defaultConfig({ partitionSystem: partitions });
    const cycle = createCognitiveCycle(modules, config);
    const workspace = createStubWorkspace();

    await cycle.run('test input', workspace, [noopSink], (e) => events.push(e));

    const violations = events.filter(e => e.type === 'cognitive:constraint_violation');
    expect(violations.length).toBe(0);
  });

  it('injects partition-monitor signal into aggregated signals on critical violation', async () => {
    const partitions = createPartitionSystem();

    partitions.write(
      {
        source: moduleId('observer'),
        content: 'must NOT import notifications',
        salience: 1,
        timestamp: Date.now(),
        pinned: true,
        contentType: 'constraint',
      },
      moduleId('observer'),
    );

    const modules = createStubModules({
      actor: createStubModule('actor', 'import { x } from notifications'),
    });

    const config = defaultConfig({ partitionSystem: partitions });
    const cycle = createCognitiveCycle(modules, config);
    const workspace = createStubWorkspace();

    const result = await cycle.run('test input', workspace, [noopSink]);

    // The partition monitor should have injected a signal
    const pmSignal = result.signals.get(moduleId('partition-monitor') as any);
    expect(pmSignal).toBeDefined();
  });

  it('CycleConfig accepts optional partitionSystem and moduleSelectors', () => {
    const partitions = createPartitionSystem();
    const selectors = new Map();
    selectors.set(moduleId('reasoner'), {
      sources: ['task', 'constraint'],
      budget: 4096,
      strategy: 'salience' as const,
    });

    const config = defaultConfig({
      partitionSystem: partitions,
      moduleSelectors: selectors,
    });

    expect(config.partitionSystem).toBe(partitions);
    expect(config.moduleSelectors).toBe(selectors);
  });

  it('resetCycleQuotas is called on partition system', async () => {
    const partitions = createPartitionSystem();
    const resetSpy = vi.spyOn(partitions, 'resetCycleQuotas');

    const modules = createStubModules();
    const config = defaultConfig({ partitionSystem: partitions });
    const cycle = createCognitiveCycle(modules, config);
    const workspace = createStubWorkspace();

    await cycle.run('test input', workspace, [noopSink]);

    expect(resetSpy).toHaveBeenCalled();
  });
});
