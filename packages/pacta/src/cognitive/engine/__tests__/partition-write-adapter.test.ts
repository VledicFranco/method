import { describe, it, expect } from 'vitest';
import { createPartitionWriteAdapter } from '../partition-write-adapter.js';
import { createPartitionSystem } from '../../partitions/partition-system.js';
import { moduleId } from '../../algebra/module.js';
import type { WorkspaceEntry } from '../../algebra/workspace-types.js';

function makeEntry(content: string, overrides?: Partial<WorkspaceEntry>): WorkspaceEntry {
  return {
    source: moduleId('test'),
    content,
    salience: 0.5,
    timestamp: Date.now(),
    ...overrides,
  } as WorkspaceEntry;
}

describe('PartitionWriteAdapter', () => {
  it('routes writes through the partition system', () => {
    const ps = createPartitionSystem();
    const adapter = createPartitionWriteAdapter(ps, moduleId('observer'));

    // Write a constraint-bearing entry (should route to constraint partition)
    adapter.write(makeEntry('CONSTRAINT: must not import notifications'));

    // Verify it landed in the constraint partition
    const constraintEntries = ps.getPartition('constraint').snapshot();
    expect(constraintEntries.length).toBeGreaterThanOrEqual(1);
    expect(String(constraintEntries[0].content)).toContain('must not import');
  });

  it('routes goal entries to task partition', () => {
    const ps = createPartitionSystem();
    const adapter = createPartitionWriteAdapter(ps, moduleId('observer'));

    adapter.write(makeEntry('GOAL: implement the v2 handler'));

    const taskEntries = ps.getPartition('task').snapshot();
    expect(taskEntries.length).toBeGreaterThanOrEqual(1);
  });

  it('routes tool results to operational partition (D3 rule)', () => {
    const ps = createPartitionSystem();
    const adapter = createPartitionWriteAdapter(ps, moduleId('reasoner-actor'));

    adapter.write(makeEntry('[Read] file contents here'));

    // D3 rule: actor sources always route to operational
    const opEntries = ps.getPartition('operational').snapshot();
    expect(opEntries.length).toBeGreaterThanOrEqual(1);
  });

  it('tracks which partitions received writes', () => {
    const ps = createPartitionSystem();
    const adapter = createPartitionWriteAdapter(ps, moduleId('observer'));

    adapter.write(makeEntry('CONSTRAINT: no side effects'));

    const written = adapter.getWrittenPartitions();
    expect(written.has('constraint')).toBe(true);
  });

  it('resets tracking between cycles', () => {
    const ps = createPartitionSystem();
    const adapter = createPartitionWriteAdapter(ps, moduleId('observer'));

    adapter.write(makeEntry('CONSTRAINT: no imports'));
    expect(adapter.getWrittenPartitions().size).toBeGreaterThan(0);

    adapter.resetCycleTracking();
    expect(adapter.getWrittenPartitions().size).toBe(0);
  });

  it('accumulates writes to multiple partitions', () => {
    const ps = createPartitionSystem();
    const adapter = createPartitionWriteAdapter(ps, moduleId('observer'));

    adapter.write(makeEntry('CONSTRAINT: preserve API'));
    adapter.write(makeEntry('GOAL: create v2 endpoint'));

    const written = adapter.getWrittenPartitions();
    expect(written.has('constraint')).toBe(true);
    expect(written.has('task')).toBe(true);
  });
});
