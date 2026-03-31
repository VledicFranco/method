/**
 * Partition System Tests — PRD 044 C-2.
 *
 * Validates the partition system aggregate: creation, routing, context
 * building, budget enforcement, monitor execution, snapshots, and quotas.
 */

import { describe, it, expect } from 'vitest';
import { createPartitionSystem } from '../partition-system.js';
import { moduleId } from '../../algebra/module.js';
import type { WorkspaceEntry } from '../../algebra/workspace-types.js';
import type { PartitionMonitorContext } from '../../algebra/partition-types.js';

// ── Helpers ─────────────────────────────────────────────────────

const MOD_OBSERVER = moduleId('observer');
const MOD_ACTOR = moduleId('actor');

function makeEntry(
  content: string,
  overrides?: Partial<WorkspaceEntry>,
): WorkspaceEntry {
  return {
    source: MOD_OBSERVER,
    content,
    salience: 0.5,
    timestamp: Date.now(),
    ...overrides,
  };
}

// ── Creation ────────────────────────────────────────────────────

describe('createPartitionSystem', () => {
  it('creates system with default config', () => {
    const system = createPartitionSystem();

    expect(system.getPartition('constraint')).toBeDefined();
    expect(system.getPartition('operational')).toBeDefined();
    expect(system.getPartition('task')).toBeDefined();
  });

  it('creates system with custom capacities', () => {
    const system = createPartitionSystem({
      constraintCapacity: 5,
      operationalCapacity: 8,
      taskCapacity: 3,
    });

    expect(system.getPartition('constraint')).toBeDefined();
    expect(system.getPartition('operational')).toBeDefined();
    expect(system.getPartition('task')).toBeDefined();
  });

  it('throws for unknown partition id', () => {
    const system = createPartitionSystem();
    expect(() => system.getPartition('unknown' as any)).toThrow('Unknown partition');
  });
});

// ── Write + Routing ─────────────────────────────────────────────

describe('write()', () => {
  it('routes constraint text to constraint partition', () => {
    const system = createPartitionSystem();
    const entry = makeEntry('You must not import lodash.', {
      pinned: true,
      contentType: 'constraint',
    });

    system.write(entry, MOD_OBSERVER);

    expect(system.getPartition('constraint').count()).toBe(1);
    expect(system.getPartition('operational').count()).toBe(0);
    expect(system.getPartition('task').count()).toBe(0);
  });

  it('routes tool result to operational partition', () => {
    const system = createPartitionSystem();
    const entry = makeEntry('File contents: const x = 42;', {
      contentType: 'operational',
    });

    system.write(entry, MOD_ACTOR);

    expect(system.getPartition('operational').count()).toBe(1);
    expect(system.getPartition('constraint').count()).toBe(0);
    expect(system.getPartition('task').count()).toBe(0);
  });

  it('routes goal text to task partition', () => {
    const system = createPartitionSystem();
    const entry = makeEntry('Your task is to implement the partition system.', {
      contentType: 'goal',
    });

    system.write(entry, MOD_OBSERVER);

    expect(system.getPartition('task').count()).toBe(1);
    expect(system.getPartition('constraint').count()).toBe(0);
    expect(system.getPartition('operational').count()).toBe(0);
  });

  it('routes actor source to operational regardless of content', () => {
    const system = createPartitionSystem();
    const entry = makeEntry('Constraint: never modify registry files.', {
      contentType: 'constraint',
    });

    // Actor source overrides content classification.
    system.write(entry, MOD_ACTOR);

    expect(system.getPartition('operational').count()).toBe(1);
    expect(system.getPartition('constraint').count()).toBe(0);
  });
});

// ── buildContext() ───────────────────────────────────────────────

describe('buildContext()', () => {
  it('returns entries from specified sources only', () => {
    const system = createPartitionSystem();

    system.write(makeEntry('You must not import lodash.'), MOD_OBSERVER);
    system.write(makeEntry('File result: OK'), MOD_ACTOR);
    system.write(makeEntry('Your task is to build tests.'), MOD_OBSERVER);

    const context = system.buildContext({
      sources: ['constraint'],
      budget: 1000,
      strategy: 'all',
    });

    expect(context.length).toBe(1);
    expect(String(context[0].content)).toContain('must not import');
  });

  it('returns entries from multiple sources', () => {
    const system = createPartitionSystem();

    system.write(makeEntry('You must not import lodash.'), MOD_OBSERVER);
    system.write(makeEntry('File result: OK'), MOD_ACTOR);
    system.write(makeEntry('Your task is to build tests.'), MOD_OBSERVER);

    const context = system.buildContext({
      sources: ['constraint', 'task'],
      budget: 1000,
      strategy: 'all',
    });

    expect(context.length).toBe(2);
  });

  it('respects budget', () => {
    const system = createPartitionSystem();

    // Each entry is ~10-15 chars → ~3-4 tokens.
    system.write(makeEntry('File result 1'), MOD_ACTOR);
    system.write(makeEntry('File result 2'), MOD_ACTOR);
    system.write(makeEntry('File result 3'), MOD_ACTOR);
    system.write(makeEntry('File result 4'), MOD_ACTOR);

    // Very small budget: should not return all entries.
    const context = system.buildContext({
      sources: ['operational'],
      budget: 5,
      strategy: 'all',
    });

    // With budget 5, each entry ~4 tokens (ceil(13/4)=4). Only 1 fits.
    expect(context.length).toBeLessThan(4);
  });

  it('with all strategy from constraint partition gets everything', () => {
    const system = createPartitionSystem();

    system.write(makeEntry('You must not import lodash.'), MOD_OBSERVER);
    system.write(makeEntry('You shall not use eval.'), MOD_OBSERVER);
    system.write(makeEntry('Never call process.exit.'), MOD_OBSERVER);

    const context = system.buildContext({
      sources: ['constraint'],
      budget: 10000,
      strategy: 'all',
    });

    expect(context.length).toBe(3);
  });

  it('returns empty for empty sources array', () => {
    const system = createPartitionSystem();
    system.write(makeEntry('Something'), MOD_ACTOR);

    const context = system.buildContext({
      sources: [],
      budget: 1000,
      strategy: 'all',
    });

    expect(context).toHaveLength(0);
  });
});

// ── snapshot() ──────────────────────────────────────────────────

describe('snapshot()', () => {
  it('returns all entries across all partitions', () => {
    const system = createPartitionSystem();

    system.write(makeEntry('You must not import lodash.'), MOD_OBSERVER);
    system.write(makeEntry('File result: OK'), MOD_ACTOR);
    system.write(makeEntry('Your task is to build tests.'), MOD_OBSERVER);

    const snap = system.snapshot();
    expect(snap.length).toBe(3);
  });

  it('returns empty when no entries', () => {
    const system = createPartitionSystem();
    expect(system.snapshot()).toHaveLength(0);
  });
});

// ── checkPartitions() ───────────────────────────────────────────

describe('checkPartitions()', () => {
  it('returns signals from all monitors', () => {
    const system = createPartitionSystem();

    // Add a constraint so the monitor has something to check against.
    system.write(
      makeEntry('You must not import lodash', { pinned: true, contentType: 'constraint' }),
      MOD_OBSERVER,
    );

    const context: PartitionMonitorContext = {
      cycleNumber: 20,
      lastWriteCycle: new Map([
        ['constraint', 20],
        ['operational', 10], // stagnation: 20-10=10 >= 3
        ['task', 10],        // goal-stale: 20-10=10 >= 5
      ]),
      actorOutput: 'I will import lodash to handle this.', // constraint violation
    };

    const signals = system.checkPartitions(context);

    // Should have at least: violation + stagnation + goal-stale.
    const types = signals.map((s) => s.type);
    expect(types).toContain('constraint-violation');
    expect(types).toContain('stagnation');
    expect(types).toContain('goal-stale');
  });

  it('returns empty signals when everything is healthy', () => {
    const system = createPartitionSystem();

    const context: PartitionMonitorContext = {
      cycleNumber: 5,
      lastWriteCycle: new Map([
        ['constraint', 5],
        ['operational', 5],
        ['task', 5],
      ]),
    };

    const signals = system.checkPartitions(context);
    expect(signals).toHaveLength(0);
  });
});

// ── resetCycleQuotas() ──────────────────────────────────────────

describe('resetCycleQuotas()', () => {
  it('does not throw', () => {
    const system = createPartitionSystem();
    expect(() => system.resetCycleQuotas()).not.toThrow();
  });
});
