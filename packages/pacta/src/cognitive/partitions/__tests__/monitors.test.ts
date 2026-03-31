/**
 * Partition Monitor Tests — PRD 044 C-2.
 *
 * Validates the three per-partition monitors: constraint violation detection,
 * operational stagnation detection, and task goal staleness detection.
 */

import { describe, it, expect } from 'vitest';
import { ConstraintPartitionMonitor } from '../constraint/monitor.js';
import { OperationalPartitionMonitor } from '../operational/monitor.js';
import { TaskPartitionMonitor } from '../task/monitor.js';
import type { PartitionMonitorContext } from '../../algebra/partition-types.js';
import type { WorkspaceEntry } from '../../algebra/workspace-types.js';
import { moduleId } from '../../algebra/module.js';

// ── Helpers ─────────────────────────────────────────────────────

const MOD = moduleId('test-mod');

function makeEntry(
  content: string,
  overrides?: Partial<WorkspaceEntry>,
): WorkspaceEntry {
  return {
    source: MOD,
    content,
    salience: 0.5,
    timestamp: Date.now(),
    pinned: false,
    contentType: 'constraint',
    ...overrides,
  };
}

function makeContext(overrides?: Partial<PartitionMonitorContext>): PartitionMonitorContext {
  return {
    cycleNumber: 10,
    lastWriteCycle: new Map([
      ['constraint', 10],
      ['operational', 10],
      ['task', 10],
    ]),
    ...overrides,
  };
}

// ── Constraint Monitor ──────────────────────────────────────────

describe('ConstraintPartitionMonitor', () => {
  const monitor = new ConstraintPartitionMonitor(10);

  it('detects violation in actorOutput', () => {
    const entries = [
      makeEntry('You must not import lodash or underscore', { pinned: true }),
    ];
    const context = makeContext({ actorOutput: 'I will import lodash to handle arrays.' });

    const signals = monitor.check(entries, context);
    expect(signals.length).toBeGreaterThanOrEqual(1);

    const violation = signals.find((s) => s.type === 'constraint-violation');
    expect(violation).toBeDefined();
    expect(violation!.severity).toBe('critical');
    expect(violation!.partition).toBe('constraint');
  });

  it('returns empty when no violations', () => {
    const entries = [
      makeEntry('You must not import lodash', { pinned: true }),
    ];
    const context = makeContext({ actorOutput: 'I will use native array methods.' });

    const signals = monitor.check(entries, context);
    const violations = signals.filter((s) => s.type === 'constraint-violation');
    expect(violations).toHaveLength(0);
  });

  it('returns empty when no actorOutput', () => {
    const entries = [
      makeEntry('You must not import lodash', { pinned: true }),
    ];
    const context = makeContext(); // no actorOutput

    const signals = monitor.check(entries, context);
    const violations = signals.filter((s) => s.type === 'constraint-violation');
    expect(violations).toHaveLength(0);
  });

  it('emits capacity warning at >= 80%', () => {
    // 8 entries in a capacity-10 partition = 80%.
    const entries = Array.from({ length: 8 }, (_, i) =>
      makeEntry(`constraint ${i}`, { pinned: true }),
    );
    const context = makeContext();

    const signals = monitor.check(entries, context);
    const capacityWarning = signals.find((s) => s.type === 'capacity-warning');
    expect(capacityWarning).toBeDefined();
    expect(capacityWarning!.severity).toBe('low');
  });

  it('does not emit capacity warning below 80%', () => {
    // 7 entries in a capacity-10 partition = 70%.
    const entries = Array.from({ length: 7 }, (_, i) =>
      makeEntry(`constraint ${i}`, { pinned: true }),
    );
    const context = makeContext();

    const signals = monitor.check(entries, context);
    const capacityWarning = signals.find((s) => s.type === 'capacity-warning');
    expect(capacityWarning).toBeUndefined();
  });
});

// ── Operational Monitor ─────────────────────────────────────────

describe('OperationalPartitionMonitor', () => {
  const monitor = new OperationalPartitionMonitor();

  it('detects stagnation (no write for 3+ cycles)', () => {
    const entries = [makeEntry('some observation', { contentType: 'operational' })];
    const context = makeContext({
      cycleNumber: 10,
      lastWriteCycle: new Map([
        ['constraint', 10],
        ['operational', 7], // 10 - 7 = 3 cycles since last write
        ['task', 10],
      ]),
    });

    const signals = monitor.check(entries, context);
    expect(signals).toHaveLength(1);
    expect(signals[0].type).toBe('stagnation');
    expect(signals[0].severity).toBe('high');
    expect(signals[0].partition).toBe('operational');
  });

  it('returns empty when recent write', () => {
    const entries = [makeEntry('some observation', { contentType: 'operational' })];
    const context = makeContext({
      cycleNumber: 10,
      lastWriteCycle: new Map([
        ['constraint', 10],
        ['operational', 9], // 10 - 9 = 1 cycle since last write
        ['task', 10],
      ]),
    });

    const signals = monitor.check(entries, context);
    expect(signals).toHaveLength(0);
  });

  it('detects stagnation at exactly threshold boundary', () => {
    const entries: WorkspaceEntry[] = [];
    const context = makeContext({
      cycleNumber: 10,
      lastWriteCycle: new Map([
        ['constraint', 10],
        ['operational', 7], // exactly 3 cycles
        ['task', 10],
      ]),
    });

    const signals = monitor.check(entries, context);
    expect(signals).toHaveLength(1);
    expect(signals[0].type).toBe('stagnation');
  });

  it('returns empty when operational partition has no lastWriteCycle entry', () => {
    const entries: WorkspaceEntry[] = [];
    const context = makeContext({
      cycleNumber: 10,
      lastWriteCycle: new Map([
        ['constraint', 10],
        ['task', 10],
        // no 'operational' entry
      ]),
    });

    const signals = monitor.check(entries, context);
    expect(signals).toHaveLength(0);
  });
});

// ── Task Monitor ────────────────────────────────────────────────

describe('TaskPartitionMonitor', () => {
  const monitor = new TaskPartitionMonitor();

  it('detects goal staleness (no write for 5+ cycles)', () => {
    const entries = [makeEntry('Complete the MVP', { contentType: 'goal' })];
    const context = makeContext({
      cycleNumber: 15,
      lastWriteCycle: new Map([
        ['constraint', 15],
        ['operational', 15],
        ['task', 10], // 15 - 10 = 5 cycles since last write
      ]),
    });

    const signals = monitor.check(entries, context);
    expect(signals).toHaveLength(1);
    expect(signals[0].type).toBe('goal-stale');
    expect(signals[0].severity).toBe('medium');
    expect(signals[0].partition).toBe('task');
  });

  it('returns empty when recent write', () => {
    const entries = [makeEntry('Complete the MVP', { contentType: 'goal' })];
    const context = makeContext({
      cycleNumber: 10,
      lastWriteCycle: new Map([
        ['constraint', 10],
        ['operational', 10],
        ['task', 8], // 10 - 8 = 2 cycles since last write
      ]),
    });

    const signals = monitor.check(entries, context);
    expect(signals).toHaveLength(0);
  });

  it('detects staleness at exactly threshold boundary', () => {
    const entries = [makeEntry('Some goal', { contentType: 'goal' })];
    const context = makeContext({
      cycleNumber: 15,
      lastWriteCycle: new Map([
        ['constraint', 15],
        ['operational', 15],
        ['task', 10], // exactly 5 cycles
      ]),
    });

    const signals = monitor.check(entries, context);
    expect(signals).toHaveLength(1);
    expect(signals[0].type).toBe('goal-stale');
  });

  it('returns empty when task partition has no lastWriteCycle entry', () => {
    const entries = [makeEntry('Some goal', { contentType: 'goal' })];
    const context = makeContext({
      cycleNumber: 15,
      lastWriteCycle: new Map([
        ['constraint', 15],
        ['operational', 15],
        // no 'task' entry
      ]),
    });

    const signals = monitor.check(entries, context);
    expect(signals).toHaveLength(0);
  });
});
