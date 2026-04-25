// SPDX-License-Identifier: Apache-2.0
/**
 * Unit tests for SqliteTraceStore — PRD 058 C-4.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SqliteTraceStore } from './sqlite-store.js';
import type { CycleTrace } from '@methodts/pacta';

const T0 = 1_700_000_000_000;

function mkCycle(overrides?: Partial<CycleTrace>): CycleTrace {
  return {
    cycleId: 'c-1',
    cycleNumber: 1,
    startedAt: T0,
    endedAt: T0 + 100,
    durationMs: 100,
    inputText: 'hello',
    outputText: 'world',
    phases: [
      {
        phase: 'observe',
        startedAt: T0,
        endedAt: T0 + 30,
        durationMs: 30,
        inputSummary: 'in',
        outputSummary: 'out',
        operations: [
          {
            operation: 'llm-complete',
            startedAt: T0 + 5,
            durationMs: 20,
            metadata: { inputTokens: 100, outputTokens: 50, model: 'sonnet-4.6' },
          },
        ],
        signals: [],
      },
    ],
    signals: [],
    tokenUsage: {
      inputTokens: 100,
      outputTokens: 50,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      totalTokens: 150,
    },
    ...overrides,
  };
}

describe('SqliteTraceStore', () => {
  it('AC-3: storeCycle + getCycle round-trip preserves all CycleTrace fields', async () => {
    const store = new SqliteTraceStore({ dbPath: ':memory:' });
    await store.initialize();
    const original = mkCycle();
    await store.storeCycle(original);
    const got = await store.getCycle(original.cycleId);
    assert.notEqual(got, null);
    if (!got) return;
    assert.equal(got.cycleId, original.cycleId);
    assert.equal(got.cycleNumber, original.cycleNumber);
    assert.equal(got.startedAt, original.startedAt);
    assert.equal(got.endedAt, original.endedAt);
    assert.equal(got.durationMs, original.durationMs);
    assert.equal(got.inputText, original.inputText);
    assert.equal(got.outputText, original.outputText);
    assert.equal(got.phases.length, 1);
    assert.equal(got.phases[0]!.phase, 'observe');
    assert.equal(got.phases[0]!.operations.length, 1);
    assert.equal(got.phases[0]!.operations[0]!.operation, 'llm-complete');
    assert.deepEqual(got.tokenUsage, original.tokenUsage);
    await store.close();
  });

  it('getCycle returns null for unknown id', async () => {
    const store = new SqliteTraceStore({ dbPath: ':memory:' });
    await store.initialize();
    const got = await store.getCycle('nope');
    assert.equal(got, null);
    await store.close();
  });

  it('storeCycle is idempotent on cycleId (REPLACE semantics)', async () => {
    const store = new SqliteTraceStore({ dbPath: ':memory:' });
    await store.initialize();
    await store.storeCycle(mkCycle({ cycleId: 'dup', inputText: 'first' }));
    await store.storeCycle(mkCycle({ cycleId: 'dup', inputText: 'second' }));
    const got = await store.getCycle('dup');
    assert.equal(got?.inputText, 'second');
    await store.close();
  });

  it('AC-3 query: getCycles({since, before, limit}) returns expected slice', async () => {
    const store = new SqliteTraceStore({ dbPath: ':memory:' });
    await store.initialize();
    for (let i = 0; i < 12; i++) {
      await store.storeCycle(
        mkCycle({
          cycleId: `c-${i}`,
          cycleNumber: i,
          startedAt: T0 + i * 1000,
          endedAt: T0 + i * 1000 + 100,
        }),
      );
    }
    // Default: all 12, newest first.
    const all = await store.getCycles({ limit: 100 });
    assert.equal(all.length, 12);
    assert.equal(all[0]!.cycleNumber, 11);

    // since/before window: cycles 5..9 (since inclusive, before exclusive).
    const window = await store.getCycles({
      since: T0 + 5 * 1000,
      before: T0 + 10 * 1000,
      limit: 100,
    });
    assert.equal(window.length, 5);
    assert.deepEqual(
      window.map((c) => c.cycleNumber).sort((a, b) => a - b),
      [5, 6, 7, 8, 9],
    );

    // Limit caps the slice (newest first).
    const limited = await store.getCycles({ limit: 3 });
    assert.equal(limited.length, 3);
    assert.deepEqual(
      limited.map((c) => c.cycleNumber),
      [11, 10, 9],
    );
    await store.close();
  });

  it('AC-3 retention: cycles older than retentionDays deleted on initialize()', async () => {
    // Use a unique on-disk path so retention runs against actual rows.
    const tempPath = `${process.platform === 'win32' ? process.env.TEMP : '/tmp'}/sqlite-trace-retention-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.db`;
    const old = mkCycle({
      cycleId: 'old',
      cycleNumber: 1,
      startedAt: Date.now() - 30 * 24 * 60 * 60 * 1000,
      endedAt: Date.now() - 30 * 24 * 60 * 60 * 1000 + 100,
    });
    const fresh = mkCycle({
      cycleId: 'fresh',
      cycleNumber: 2,
      startedAt: Date.now() - 1000,
      endedAt: Date.now() - 900,
    });

    // First open: write both cycles.
    {
      const s = new SqliteTraceStore({ dbPath: tempPath, retentionDays: 7 });
      await s.initialize();
      await s.storeCycle(old);
      await s.storeCycle(fresh);
      await s.close();
    }
    // Reopen: retention cleanup runs, old cycle should be gone.
    {
      const s = new SqliteTraceStore({ dbPath: tempPath, retentionDays: 7 });
      await s.initialize();
      assert.equal(await s.getCycle('old'), null);
      assert.notEqual(await s.getCycle('fresh'), null);
      await s.close();
    }
    // Cleanup: remove the temp file.
    try {
      const { unlinkSync } = await import('node:fs');
      unlinkSync(tempPath);
    } catch {
      /* ignore */
    }
  });

  it('AC-3 stats: getStats returns correct aggregate over a 12-cycle dataset', async () => {
    const store = new SqliteTraceStore({ dbPath: ':memory:' });
    await store.initialize();
    for (let i = 0; i < 12; i++) {
      await store.storeCycle(
        mkCycle({
          cycleId: `c-${i}`,
          cycleNumber: i,
          startedAt: T0 + i * 1000,
          endedAt: T0 + i * 1000 + (100 + i * 10),
          durationMs: 100 + i * 10,
        }),
      );
    }
    const stats = await store.getStats({ windowCycles: 10 });
    assert.equal(stats.cycleCount, 10);
    // Window: cycles 2..11 (newest 10), durations 120..210
    // avg = (120 + 130 + ... + 210) / 10 = 165
    assert.equal(stats.avgDurationMs, 165);
    assert.equal(stats.avgInputTokens, 100);
    assert.equal(stats.avgOutputTokens, 50);
    // Phase 'observe' appears in every cycle.
    assert.ok(stats.phaseAvgDurations.has('observe'));
    await store.close();
  });

  it('throws when used without initialize()', async () => {
    const store = new SqliteTraceStore({ dbPath: ':memory:' });
    await assert.rejects(() => store.storeCycle(mkCycle()), /initialize/);
    await assert.rejects(() => store.getCycle('x'), /initialize/);
    await assert.rejects(() => store.getCycles(), /initialize/);
  });

  it('onEvent assembles + persists when cycle-end arrives', async () => {
    const store = new SqliteTraceStore({ dbPath: ':memory:' });
    await store.initialize();
    const cid = 'live-1';
    await store.onEvent({
      eventId: 'e1', cycleId: cid, kind: 'cycle-start', name: 'cycle-1',
      timestamp: T0, data: { inputText: 'in', cycleNumber: 1 },
    });
    await store.onEvent({
      eventId: 'e2', cycleId: cid, kind: 'phase-start', name: 'reason',
      phase: 'reason', timestamp: T0 + 1,
    });
    await store.onEvent({
      eventId: 'e3', cycleId: cid, kind: 'phase-end', name: 'reason',
      phase: 'reason', timestamp: T0 + 50, durationMs: 49,
    });
    await store.onEvent({
      eventId: 'e4', cycleId: cid, kind: 'cycle-end', name: 'cycle-1',
      timestamp: T0 + 60, durationMs: 60, data: { outputText: 'out' },
    });
    const got = await store.getCycle(cid);
    assert.notEqual(got, null);
    assert.equal(got?.inputText, 'in');
    assert.equal(got?.outputText, 'out');
    assert.equal(got?.phases.length, 1);
    assert.equal(got?.phases[0]!.phase, 'reason');
    await store.close();
  });
});
