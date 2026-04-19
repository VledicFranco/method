// SPDX-License-Identifier: Apache-2.0
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
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
    assert.ok(constraintEntries.length >= 1);
    assert.ok(String(constraintEntries[0].content).includes('must not import'));
  });

  it('routes goal entries to task partition', () => {
    const ps = createPartitionSystem();
    const adapter = createPartitionWriteAdapter(ps, moduleId('observer'));

    adapter.write(makeEntry('GOAL: implement the v2 handler'));

    const taskEntries = ps.getPartition('task').snapshot();
    assert.ok(taskEntries.length >= 1);
  });

  it('routes tool results to operational partition (D3 rule)', () => {
    const ps = createPartitionSystem();
    const adapter = createPartitionWriteAdapter(ps, moduleId('reasoner-actor'));

    adapter.write(makeEntry('[Read] file contents here'));

    // D3 rule: actor sources always route to operational
    const opEntries = ps.getPartition('operational').snapshot();
    assert.ok(opEntries.length >= 1);
  });

  it('tracks which partitions received writes', () => {
    const ps = createPartitionSystem();
    const adapter = createPartitionWriteAdapter(ps, moduleId('observer'));

    adapter.write(makeEntry('CONSTRAINT: no side effects'));

    const written = adapter.getWrittenPartitions();
    assert.strictEqual(written.has('constraint'), true);
  });

  it('resets tracking between cycles', () => {
    const ps = createPartitionSystem();
    const adapter = createPartitionWriteAdapter(ps, moduleId('observer'));

    adapter.write(makeEntry('CONSTRAINT: no imports'));
    assert.ok(adapter.getWrittenPartitions().size > 0);

    adapter.resetCycleTracking();
    assert.strictEqual(adapter.getWrittenPartitions().size, 0);
  });

  it('accumulates writes to multiple partitions', () => {
    const ps = createPartitionSystem();
    const adapter = createPartitionWriteAdapter(ps, moduleId('observer'));

    adapter.write(makeEntry('CONSTRAINT: preserve API'));
    adapter.write(makeEntry('GOAL: create v2 endpoint'));

    const written = adapter.getWrittenPartitions();
    assert.strictEqual(written.has('constraint'), true);
    assert.strictEqual(written.has('task'), true);
  });
});
