/**
 * Unit tests for workspace engine (PRD 030, C-2).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createWorkspace,
  defaultSalienceFunction,
  recencyScore,
  sourcePriority,
  goalOverlap,
} from '../workspace.js';
import type { WorkspaceManager } from '../workspace.js';
import type { WorkspaceEntry, SalienceContext } from '../workspace-types.js';
import { moduleId } from '../module.js';
import type { ModuleId } from '../module.js';

// ── Test Helpers ────────────────────────────────────────────────

const MOD_A = moduleId('mod-a');
const MOD_B = moduleId('mod-b');

function makeContext(overrides?: Partial<SalienceContext>): SalienceContext {
  return {
    now: Date.now(),
    goals: ['test', 'workspace'],
    sourcePriorities: new Map<ModuleId, number>([
      [MOD_A, 0.8],
      [MOD_B, 0.3],
    ]),
    ...overrides,
  };
}

function makeEntry(
  source: ModuleId,
  content: unknown,
  overrides?: Partial<WorkspaceEntry>,
): WorkspaceEntry {
  return {
    source,
    content,
    salience: 0, // will be computed by workspace
    timestamp: Date.now(),
    ...overrides,
  };
}

// ── Tests ───────────────────────────────────────────────────────

describe('workspace', () => {
  it('1. write via WritePort adds entry with computed salience', () => {
    const ctx = makeContext();
    const ws = createWorkspace({ capacity: 10 }, ctx);

    const writePort = ws.getWritePort(MOD_A);
    const readPort = ws.getReadPort(MOD_A);

    writePort.write(makeEntry(MOD_A, 'hello workspace'));

    const entries = readPort.read();
    assert.strictEqual(entries.length, 1);
    assert.strictEqual(entries[0].source, MOD_A);
    // Salience should have been computed (not the default 0)
    assert.ok(entries[0].salience > 0, `Expected salience > 0, got ${entries[0].salience}`);
  });

  it('2. at-capacity write evicts lowest-salience entry', () => {
    const ctx = makeContext();
    const ws = createWorkspace({ capacity: 2 }, ctx);

    const writeA = ws.getWritePort(MOD_A);
    const writeB = ws.getWritePort(MOD_B);

    // MOD_A has higher priority (0.8) than MOD_B (0.3)
    writeB.write(makeEntry(MOD_B, 'low priority'));
    writeA.write(makeEntry(MOD_A, 'high priority'));

    // At capacity (2). Writing another should evict the lowest-salience entry.
    writeA.write(makeEntry(MOD_A, 'another high'));

    const snapshot = ws.snapshot();
    assert.strictEqual(snapshot.length, 2);

    const evictions = ws.getEvictions();
    assert.ok(evictions.length >= 1);
    assert.strictEqual(evictions[0].reason, 'capacity');
  });

  it('3. read via ReadPort returns only matching entries', () => {
    const ctx = makeContext();
    const ws = createWorkspace({ capacity: 10 }, ctx);

    ws.getWritePort(MOD_A).write(makeEntry(MOD_A, 'from A'));
    ws.getWritePort(MOD_B).write(makeEntry(MOD_B, 'from B'));

    const readPort = ws.getReadPort(MOD_A);

    // Filter by source
    const aEntries = readPort.read({ source: MOD_A });
    assert.strictEqual(aEntries.length, 1);
    assert.strictEqual(aEntries[0].source, MOD_A);

    // No filter — returns all
    const allEntries = readPort.read();
    assert.strictEqual(allEntries.length, 2);
  });

  it('4. attend returns top-N by salience within budget', () => {
    const ctx = makeContext();
    const ws = createWorkspace({ capacity: 10 }, ctx);

    // Write several entries. MOD_A has higher priority so its entries should rank higher.
    ws.getWritePort(MOD_A).write(makeEntry(MOD_A, 'high test'));
    ws.getWritePort(MOD_B).write(makeEntry(MOD_B, 'low stuff'));
    ws.getWritePort(MOD_A).write(makeEntry(MOD_A, 'another workspace test'));

    const attended = ws.attend(2);
    assert.strictEqual(attended.length, 2);
    // The top 2 by salience should be returned
    assert.ok(attended[0].salience >= attended[1].salience);
  });

  it('5. TTL expiry removes entries automatically', async () => {
    const now = Date.now();
    const ctx = makeContext({ now });
    const ws = createWorkspace({ capacity: 10, defaultTtl: 50 }, ctx);

    ws.getWritePort(MOD_A).write(makeEntry(MOD_A, 'ephemeral', { timestamp: now - 100 }));
    ws.getWritePort(MOD_A).write(makeEntry(MOD_A, 'recent', { timestamp: now }));

    // The first entry should be expired (timestamp + 50 < now)
    const readPort = ws.getReadPort(MOD_A);
    const entries = readPort.read();

    // The ephemeral entry (timestamp now-100, ttl 50) expired at now-50 which is before now
    assert.strictEqual(entries.length, 1);
    assert.strictEqual(entries[0].content, 'recent');

    const evictions = ws.getEvictions();
    const ttlEvictions = evictions.filter((e) => e.reason === 'ttl');
    assert.ok(ttlEvictions.length >= 1);
  });

  it('6. snapshot returns immutable copy', () => {
    const ctx = makeContext();
    const ws = createWorkspace({ capacity: 10 }, ctx);

    ws.getWritePort(MOD_A).write(makeEntry(MOD_A, 'data'));

    const snap1 = ws.snapshot();
    assert.strictEqual(snap1.length, 1);

    // Write another entry
    ws.getWritePort(MOD_A).write(makeEntry(MOD_A, 'more data'));

    // Original snapshot should be unchanged
    assert.strictEqual(snap1.length, 1);

    const snap2 = ws.snapshot();
    assert.strictEqual(snap2.length, 2);
  });

  it('7. write log records all operations', () => {
    const ctx = makeContext();
    const ws = createWorkspace({ capacity: 10 }, ctx);

    ws.getWritePort(MOD_A).write(makeEntry(MOD_A, 'first'));
    ws.getWritePort(MOD_B).write(makeEntry(MOD_B, 'second'));
    ws.getWritePort(MOD_A).write(makeEntry(MOD_A, 'third'));

    const log = ws.getWriteLog();
    assert.strictEqual(log.length, 3);
    assert.strictEqual(log[0].moduleId, MOD_A);
    assert.strictEqual(log[1].moduleId, MOD_B);
    assert.strictEqual(log[2].moduleId, MOD_A);
  });

  it('8. per-module write quota enforced (excess writes rejected)', () => {
    const ctx = makeContext();
    const ws = createWorkspace({ capacity: 10, writeQuotaPerModule: 2 }, ctx);

    const writeA = ws.getWritePort(MOD_A);
    writeA.write(makeEntry(MOD_A, 'first'));
    writeA.write(makeEntry(MOD_A, 'second'));

    // Third write should be rejected
    assert.throws(
      () => writeA.write(makeEntry(MOD_A, 'third')),
      (err: Error) => {
        assert.ok(err.message.includes('exceeded write quota'));
        return true;
      },
    );

    // Reset quotas and write again
    ws.resetCycleQuotas();
    writeA.write(makeEntry(MOD_A, 'third after reset'));

    const entries = ws.getReadPort(MOD_A).read({ source: MOD_A });
    assert.strictEqual(entries.length, 3);
  });

  it('9. uniform-salience eviction uses FIFO deterministically', () => {
    // Use a custom salience function that returns uniform scores
    const ctx = makeContext();
    const ws = createWorkspace(
      {
        capacity: 2,
        salience: () => 0.5, // uniform salience
      },
      ctx,
    );

    const now = Date.now();
    const writeA = ws.getWritePort(MOD_A);

    // Write 3 entries with distinct timestamps — oldest should be evicted
    writeA.write(makeEntry(MOD_A, 'oldest', { timestamp: now - 200 }));
    writeA.write(makeEntry(MOD_A, 'middle', { timestamp: now - 100 }));

    // Now at capacity (2). Write a third.
    writeA.write(makeEntry(MOD_A, 'newest', { timestamp: now }));

    const evictions = ws.getEvictions();
    assert.strictEqual(evictions.length, 1);
    assert.strictEqual(evictions[0].entry.content, 'oldest');
    assert.strictEqual(evictions[0].reason, 'capacity');
  });

  it('10. eviction info includes eviction reason and salience delta', () => {
    const ctx = makeContext();
    const ws = createWorkspace({ capacity: 1 }, ctx);

    const writeA = ws.getWritePort(MOD_A);
    const writeB = ws.getWritePort(MOD_B);

    writeB.write(makeEntry(MOD_B, 'low priority entry'));
    // Writing a second entry should evict the first (capacity=1)
    writeA.write(makeEntry(MOD_A, 'high priority entry'));

    const evictions = ws.getEvictions();
    assert.strictEqual(evictions.length, 1);
    assert.strictEqual(evictions[0].reason, 'capacity');
    assert.ok(typeof evictions[0].salience === 'number');
    assert.ok(typeof evictions[0].salienceDelta === 'number');
    assert.ok(evictions[0].timestamp > 0);
  });

  // ── PRD 043: Constraint Pinning Tests ──────────────────────────

  it('11. pinned entry survives eviction', () => {
    const ctx = makeContext();
    const ws = createWorkspace(
      { capacity: 3, salience: () => 0.5 },
      ctx,
    );

    const now = Date.now();
    const writeA = ws.getWritePort(MOD_A);

    // Write 3 entries: one pinned, two non-pinned
    writeA.write(makeEntry(MOD_A, 'pinned-constraint', { pinned: true, timestamp: now - 300 }));
    writeA.write(makeEntry(MOD_A, 'normal-1', { timestamp: now - 200 }));
    writeA.write(makeEntry(MOD_A, 'normal-2', { timestamp: now - 100 }));

    // At capacity (3). Writing a 4th triggers eviction.
    writeA.write(makeEntry(MOD_A, 'newcomer', { timestamp: now }));

    const snapshot = ws.snapshot();
    assert.strictEqual(snapshot.length, 3);

    // The pinned entry must survive
    const pinnedEntries = snapshot.filter(e => e.content === 'pinned-constraint');
    assert.strictEqual(pinnedEntries.length, 1, 'Pinned entry should survive eviction');

    // A non-pinned entry should have been evicted
    const evictions = ws.getEvictions();
    const capacityEvictions = evictions.filter(e => e.reason === 'capacity');
    assert.ok(capacityEvictions.length >= 1);
    assert.ok(!capacityEvictions[0].entry.pinned, 'Evicted entry should not be pinned');
  });

  it('12. non-pinned evicted normally (lowest salience among non-pinned)', () => {
    const ctx = makeContext();
    // MOD_A has priority 0.8, MOD_B has priority 0.3
    const ws = createWorkspace({ capacity: 2 }, ctx);

    const writeA = ws.getWritePort(MOD_A);
    const writeB = ws.getWritePort(MOD_B);

    // MOD_B entry has lower salience (priority 0.3 vs 0.8)
    writeB.write(makeEntry(MOD_B, 'low priority'));
    writeA.write(makeEntry(MOD_A, 'high priority'));

    // At capacity. Writing another triggers eviction of lowest-salience non-pinned.
    writeA.write(makeEntry(MOD_A, 'another high'));

    const snapshot = ws.snapshot();
    assert.strictEqual(snapshot.length, 2);

    const evictions = ws.getEvictions();
    assert.ok(evictions.length >= 1);
    // The low-priority (MOD_B) entry should be evicted
    assert.strictEqual(evictions[0].entry.source, MOD_B);
  });

  it('13. multiple pinned entries survive eviction', () => {
    const ctx = makeContext();
    const ws = createWorkspace(
      { capacity: 3, salience: () => 0.5 },
      ctx,
    );

    const now = Date.now();
    const writeA = ws.getWritePort(MOD_A);

    // Write 3 entries: 2 pinned, 1 non-pinned
    writeA.write(makeEntry(MOD_A, 'pinned-1', { pinned: true, timestamp: now - 300 }));
    writeA.write(makeEntry(MOD_A, 'pinned-2', { pinned: true, timestamp: now - 200 }));
    writeA.write(makeEntry(MOD_A, 'normal', { timestamp: now - 100 }));

    // At capacity. Writing a 4th triggers eviction.
    writeA.write(makeEntry(MOD_A, 'newcomer', { timestamp: now }));

    const snapshot = ws.snapshot();
    assert.strictEqual(snapshot.length, 3);

    // Both pinned entries must survive
    const pinnedEntries = snapshot.filter(e =>
      e.content === 'pinned-1' || e.content === 'pinned-2',
    );
    assert.strictEqual(pinnedEntries.length, 2, 'Both pinned entries should survive');

    // The non-pinned entry was evicted
    const normalEntries = snapshot.filter(e => e.content === 'normal');
    assert.strictEqual(normalEntries.length, 0, 'Non-pinned entry should be evicted');
  });

  it('14. all-pinned below cap allows overflow', () => {
    const ctx = makeContext();
    const ws = createWorkspace(
      { capacity: 2, maxPinnedEntries: 5, salience: () => 0.5 },
      ctx,
    );

    const now = Date.now();
    const writeA = ws.getWritePort(MOD_A);

    // Write 2 pinned entries — at capacity
    writeA.write(makeEntry(MOD_A, 'pinned-1', { pinned: true, timestamp: now - 200 }));
    writeA.write(makeEntry(MOD_A, 'pinned-2', { pinned: true, timestamp: now - 100 }));

    // Write a 3rd pinned entry — pinned count (3) < maxPinnedEntries (5), should overflow
    writeA.write(makeEntry(MOD_A, 'pinned-3', { pinned: true, timestamp: now }));

    const snapshot = ws.snapshot();
    assert.strictEqual(snapshot.length, 3, 'Capacity should be exceeded (overflow by 1)');

    // All 3 entries should be present
    const contents = snapshot.map(e => e.content).sort();
    assert.deepStrictEqual(contents, ['pinned-1', 'pinned-2', 'pinned-3']);
  });

  it('15. maxPinnedEntries cap evicts oldest pinned', () => {
    const ctx = makeContext();
    const ws = createWorkspace(
      { capacity: 3, maxPinnedEntries: 2, salience: () => 0.5 },
      ctx,
    );

    const now = Date.now();
    const writeA = ws.getWritePort(MOD_A);

    // Write 2 pinned entries with distinct timestamps
    writeA.write(makeEntry(MOD_A, 'oldest-pinned', { pinned: true, timestamp: now - 200 }));
    writeA.write(makeEntry(MOD_A, 'newer-pinned', { pinned: true, timestamp: now - 100 }));

    // Write a 3rd pinned entry — hits cap, one non-pinned slot remains empty.
    // But all entries are pinned, so we must write the 3rd to fill capacity first.
    // Actually let's fill capacity with all pinned and trigger safety valve.
    writeA.write(makeEntry(MOD_A, 'filler-pinned', { pinned: true, timestamp: now - 50 }));

    // Now at capacity=3, all pinned, pinned count=3 >= maxPinnedEntries=2.
    // Writing a 4th pinned entry should evict the oldest pinned.
    writeA.write(makeEntry(MOD_A, 'newest-pinned', { pinned: true, timestamp: now }));

    const snapshot = ws.snapshot();
    assert.strictEqual(snapshot.length, 3, 'Should stay at capacity');

    // The oldest pinned (timestamp t1) should be evicted
    const contents = snapshot.map(e => e.content);
    assert.ok(!contents.includes('oldest-pinned'), 'Oldest pinned entry should be evicted');
    assert.ok(contents.includes('newest-pinned'), 'Newest pinned entry should be present');

    const evictions = ws.getEvictions();
    const capacityEvictions = evictions.filter(e => e.reason === 'capacity');
    assert.ok(capacityEvictions.length >= 1);
    assert.strictEqual(capacityEvictions[0].entry.content, 'oldest-pinned');
  });

  it('16. write preserves pinned and contentType fields', () => {
    const ctx = makeContext();
    const ws = createWorkspace({ capacity: 10 }, ctx);

    const writeA = ws.getWritePort(MOD_A);
    const readA = ws.getReadPort(MOD_A);

    writeA.write(makeEntry(MOD_A, 'constraint entry', {
      pinned: true,
      contentType: 'constraint',
    }));

    const entries = readA.read();
    assert.strictEqual(entries.length, 1);
    assert.strictEqual(entries[0].pinned, true, 'pinned field should be preserved');
    assert.strictEqual(entries[0].contentType, 'constraint', 'contentType field should be preserved');
  });
});

// ── Salience Component Tests ────────────────────────────────────

describe('salience components', () => {
  it('recencyScore decays with age', () => {
    const now = Date.now();
    const recent = recencyScore({ source: MOD_A, content: '', salience: 0, timestamp: now }, now);
    const old = recencyScore({ source: MOD_A, content: '', salience: 0, timestamp: now - 120000 }, now);
    assert.ok(recent > old, `recent ${recent} should be > old ${old}`);
    assert.ok(recent <= 1.01); // near 1 for fresh
    assert.ok(old < 0.5); // decayed for 2-minute-old
  });

  it('sourcePriority returns configured priority or default', () => {
    const priorities = new Map<ModuleId, number>([[MOD_A, 0.9]]);
    const entry = makeEntry(MOD_A, '');
    assert.strictEqual(sourcePriority(entry, priorities), 0.9);

    const unknown = makeEntry(moduleId('unknown'), '');
    assert.strictEqual(sourcePriority(unknown, priorities), 0.5);
  });

  it('goalOverlap computes word overlap', () => {
    const entry = makeEntry(MOD_A, 'test workspace engine');
    const overlap = goalOverlap(entry, ['test', 'workspace']);
    assert.ok(overlap > 0, `expected overlap > 0, got ${overlap}`);

    const noOverlap = goalOverlap(makeEntry(MOD_A, 'xyz abc'), ['test', 'workspace']);
    assert.strictEqual(noOverlap, 0);
  });
});
