/**
 * Partition Workspace Tests — PRD 044 C-1.
 *
 * Validates the generic PartitionWorkspace: write/read round-trip,
 * eviction behavior, selection strategies, budget truncation, and
 * type filtering.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { PartitionWorkspace } from '../partition-workspace.js';
import {
  NoEvictionPolicy,
  RecencyEvictionPolicy,
  GoalSalienceEvictionPolicy,
} from '../eviction-policies.js';
import type { WorkspaceEntry } from '../../algebra/workspace-types.js';
import type { ModuleId } from '../../algebra/module.js';

// ── Test Helpers ────────────────────────────────────────────────

const MOD = 'test-mod' as ModuleId;

function makeEntry(
  timestamp: number,
  overrides?: Partial<WorkspaceEntry>,
): WorkspaceEntry {
  return {
    source: MOD,
    content: `entry-${timestamp}`,
    salience: 0.5,
    timestamp,
    ...overrides,
  };
}

// ── Write + Read Round-Trip ────────────────────────────────────

describe('PartitionWorkspace', () => {
  it('write + read round-trip', () => {
    const ws = new PartitionWorkspace({
      id: 'operational',
      capacity: 10,
      policy: new RecencyEvictionPolicy(),
    });

    const entry = makeEntry(100);
    ws.write(entry);

    const result = ws.select();
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0], entry);
  });

  // ── Capacity + Eviction ────────────────────────────────────

  it('capacity eviction with RecencyEviction', () => {
    const ws = new PartitionWorkspace({
      id: 'operational',
      capacity: 3,
      policy: new RecencyEvictionPolicy(),
    });

    ws.write(makeEntry(100));
    ws.write(makeEntry(200));
    ws.write(makeEntry(300));
    assert.strictEqual(ws.count(), 3);

    // Writing a 4th entry should evict the oldest (ts=100).
    ws.write(makeEntry(400));
    assert.strictEqual(ws.count(), 3);

    const entries = ws.snapshot();
    const timestamps = entries.map((e) => e.timestamp);
    assert.deepStrictEqual(timestamps, [200, 300, 400]);
  });

  it('NoEviction with safety valve at capacity evicts oldest', () => {
    const ws = new PartitionWorkspace({
      id: 'constraint',
      capacity: 2,
      policy: new NoEvictionPolicy(),
      safetyValve: true,
    });

    ws.write(makeEntry(100));
    ws.write(makeEntry(200));
    ws.write(makeEntry(300)); // safety valve kicks in → evicts ts=100

    assert.strictEqual(ws.count(), 2);
    const timestamps = ws.snapshot().map((e) => e.timestamp);
    assert.deepStrictEqual(timestamps, [200, 300]);
  });

  it('NoEviction without safety valve rejects write at capacity', () => {
    const ws = new PartitionWorkspace({
      id: 'constraint',
      capacity: 2,
      policy: new NoEvictionPolicy(),
      safetyValve: false,
    });

    ws.write(makeEntry(100));
    ws.write(makeEntry(200));
    ws.write(makeEntry(300)); // rejected — no eviction, no safety valve

    assert.strictEqual(ws.count(), 2);
    const timestamps = ws.snapshot().map((e) => e.timestamp);
    assert.deepStrictEqual(timestamps, [100, 200]);
  });

  it('GoalSalience preserves goals over operational entries', () => {
    const ws = new PartitionWorkspace({
      id: 'task',
      capacity: 3,
      policy: new GoalSalienceEvictionPolicy(),
    });

    ws.write(makeEntry(100, { contentType: 'goal' }));
    ws.write(makeEntry(200, { contentType: 'operational' }));
    ws.write(makeEntry(300, { contentType: 'goal' }));

    // At capacity. Writing another entry should evict the operational entry (index 1).
    ws.write(makeEntry(400, { contentType: 'goal' }));

    assert.strictEqual(ws.count(), 3);
    const entries = ws.snapshot();
    assert.strictEqual(entries.every((e) => e.contentType === 'goal'), true);
    const timestamps = entries.map((e) => e.timestamp);
    assert.deepStrictEqual(timestamps, [100, 300, 400]);
  });

  // ── Selection Strategies ───────────────────────────────────

  it('select() with strategy all returns everything', () => {
    const ws = new PartitionWorkspace({
      id: 'operational',
      capacity: 10,
      policy: new RecencyEvictionPolicy(),
    });

    ws.write(makeEntry(300, { salience: 0.1 }));
    ws.write(makeEntry(100, { salience: 0.9 }));
    ws.write(makeEntry(200, { salience: 0.5 }));

    const result = ws.select({ strategy: 'all' });
    assert.strictEqual(result.length, 3);
    // Insertion order preserved.
    assert.deepStrictEqual(result.map((e) => e.timestamp), [300, 100, 200]);
  });

  it('select() with strategy recency returns newest first', () => {
    const ws = new PartitionWorkspace({
      id: 'operational',
      capacity: 10,
      policy: new RecencyEvictionPolicy(),
    });

    ws.write(makeEntry(300));
    ws.write(makeEntry(100));
    ws.write(makeEntry(200));

    const result = ws.select({ strategy: 'recency' });
    assert.deepStrictEqual(result.map((e) => e.timestamp), [300, 200, 100]);
  });

  it('select() with strategy salience returns highest salience first', () => {
    const ws = new PartitionWorkspace({
      id: 'operational',
      capacity: 10,
      policy: new RecencyEvictionPolicy(),
    });

    ws.write(makeEntry(100, { salience: 0.3 }));
    ws.write(makeEntry(200, { salience: 0.9 }));
    ws.write(makeEntry(300, { salience: 0.6 }));

    const result = ws.select({ strategy: 'salience' });
    assert.deepStrictEqual(result.map((e) => e.salience), [0.9, 0.6, 0.3]);
  });

  // ── Budget Truncation ──────────────────────────────────────

  it('select() with budget truncation', () => {
    const ws = new PartitionWorkspace({
      id: 'operational',
      capacity: 10,
      policy: new RecencyEvictionPolicy(),
    });

    // Each string "entry-NNN" is 9 chars → ~3 tokens (ceil(9/4) = 3).
    ws.write(makeEntry(100));
    ws.write(makeEntry(200));
    ws.write(makeEntry(300));

    // Budget of 5 tokens: fits entry 1 (3 tokens), fits entry 2 (3+3=6 > 5 → stop).
    // But the first entry is always included, so we get at least 1.
    const result = ws.select({ budget: 5 });
    assert.strictEqual(result.length, 1);

    // Budget of 6: fits 2 entries (3+3=6).
    const result2 = ws.select({ budget: 6 });
    assert.strictEqual(result2.length, 2);
  });

  // ── Type Filtering ─────────────────────────────────────────

  it('select() with types filter', () => {
    const ws = new PartitionWorkspace({
      id: 'task',
      capacity: 10,
      policy: new RecencyEvictionPolicy(),
    });

    ws.write(makeEntry(100, { contentType: 'goal' }));
    ws.write(makeEntry(200, { contentType: 'operational' }));
    ws.write(makeEntry(300, { contentType: 'constraint' }));
    ws.write(makeEntry(400, { contentType: 'goal' }));

    const goals = ws.select({ types: ['goal'] });
    assert.strictEqual(goals.length, 2);
    assert.strictEqual(goals.every((e) => e.contentType === 'goal'), true);

    const mixed = ws.select({ types: ['goal', 'constraint'] });
    assert.strictEqual(mixed.length, 3);
  });

  it('select() with types filter excludes entries without contentType', () => {
    const ws = new PartitionWorkspace({
      id: 'task',
      capacity: 10,
      policy: new RecencyEvictionPolicy(),
    });

    ws.write(makeEntry(100)); // no contentType
    ws.write(makeEntry(200, { contentType: 'goal' }));

    const goals = ws.select({ types: ['goal'] });
    assert.strictEqual(goals.length, 1);
    assert.strictEqual(goals[0].contentType, 'goal');
  });

  // ── count() and snapshot() ─────────────────────────────────

  it('count() reflects current entry count', () => {
    const ws = new PartitionWorkspace({
      id: 'operational',
      capacity: 10,
      policy: new RecencyEvictionPolicy(),
    });

    assert.strictEqual(ws.count(), 0);
    ws.write(makeEntry(100));
    assert.strictEqual(ws.count(), 1);
    ws.write(makeEntry(200));
    assert.strictEqual(ws.count(), 2);
  });

  it('snapshot() returns a copy of entries', () => {
    const ws = new PartitionWorkspace({
      id: 'operational',
      capacity: 10,
      policy: new RecencyEvictionPolicy(),
    });

    ws.write(makeEntry(100));
    ws.write(makeEntry(200));

    const snap = ws.snapshot();
    assert.strictEqual(snap.length, 2);

    // Snapshot is a copy — mutating it does not affect the workspace.
    (snap as WorkspaceEntry[]).length = 0;
    assert.strictEqual(ws.count(), 2);
  });

  // ── resetCycleQuotas ───────────────────────────────────────

  it('resetCycleQuotas does not throw', () => {
    const ws = new PartitionWorkspace({
      id: 'operational',
      capacity: 10,
      policy: new RecencyEvictionPolicy(),
    });

    assert.doesNotThrow(() => ws.resetCycleQuotas());
  });
});
