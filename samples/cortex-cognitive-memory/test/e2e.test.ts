/**
 * Memory cognitive tenant app — E2E smoke test (PRD-068 Wave 1 Skeleton).
 *
 * Covers:
 *   - composition + handshake (module_online as memory, role + version)
 *   - heartbeat (30s) + consolidation (5min) schedules registered
 *   - handleMemoryQuery returns matching entries, emits memory_recalled
 *   - lazy shadow hydration from ctx.storage on first query for a trace
 *   - reactToWorkspaceState promotes high-activation episodic → semantic,
 *     emits memory_consolidated
 *   - consolidate() path ditto (explicit API)
 *   - bounded store enforces the MAX_ENTRIES_PER_KIND cap
 *   - dispose emits module_offline with reason=graceful
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { composeMemoryTenantApp, MEMORY_MODULE_VERSION } from '../src/agent.js';
import type { MemoryEntry } from '../src/pact.js';
import { createMockCtx } from './mock-ctx.js';

describe('cortex-cognitive-memory — composition + handshake', () => {
  it('emits module_online as role=memory with our version', async () => {
    const { ctx, eventsFor } = createMockCtx({
      includeEvents: true,
      includeSchedule: true,
    });
    const handle = await composeMemoryTenantApp(ctx);
    const joins = eventsFor('method.cortex.workspace.module_online');
    assert.ok(joins.length >= 1, 'at least one module_online published');
    assert.equal(joins[0].moduleRole, 'memory');
    assert.equal(joins[0].version, MEMORY_MODULE_VERSION);
    assert.equal(joins[0].appId, 'cortex-cognitive-memory');
    await handle.dispose();
  });

  it('registers heartbeat (30s) and consolidation (5min) schedules', async () => {
    const { ctx, spies } = createMockCtx({
      includeEvents: true,
      includeSchedule: true,
    });
    const handle = await composeMemoryTenantApp(ctx);
    assert.ok(
      spies.scheduleRegister.callCount() >= 2,
      `expected ≥2 schedule.register calls, got ${spies.scheduleRegister.callCount()}`,
    );
    const crons = spies.scheduleRegister.calls.map(([cron]) => cron);
    assert.ok(crons.includes('*/30 * * * * *'), 'heartbeat cron registered');
    assert.ok(crons.includes('*/5 * * * *'), 'consolidation cron registered');
    await handle.dispose();
  });

  it('tolerates missing ctx.schedule (persistent pact still composes)', async () => {
    const { ctx } = createMockCtx({
      includeEvents: true,
      includeSchedule: false,
    });
    const handle = await composeMemoryTenantApp(ctx);
    assert.ok(handle);
    await handle.dispose();
  });
});

describe('cortex-cognitive-memory — handleMemoryQuery', () => {
  it('returns matching entries and emits memory_recalled on episodic query', async () => {
    const { ctx, eventsFor } = createMockCtx({
      includeEvents: true,
      includeSchedule: true,
    });
    const handle = await composeMemoryTenantApp(ctx);

    // Seed the in-memory store via the test-only helper.
    handle.recordEpisodic({
      key: 'constraint-violation:C-3',
      kind: 'episodic',
      content: 'step 3 violated C-3 on trace-prior; repaired via pin-flag',
      activation: 0.72,
    });
    handle.recordEpisodic({
      key: 'nominal-step',
      kind: 'episodic',
      content: 'step 4 executed cleanly',
      activation: 0.2,
    });

    const entries = await handle.handleMemoryQuery('trace-42', {
      queryKind: 'episodic',
      key: 'C-3',
      k: 5,
    });
    assert.equal(entries.length, 1);
    assert.equal(entries[0].key, 'constraint-violation:C-3');

    const recalls = eventsFor('method.cortex.workspace.memory_recalled');
    assert.equal(recalls.length, 1);
    assert.equal(recalls[0].traceId, 'trace-42');
    assert.equal(recalls[0].queryKind, 'episodic');
    assert.ok(Array.isArray(recalls[0].entries));
    assert.equal((recalls[0].entries as unknown[]).length, 1);

    await handle.dispose();
  });

  it('lazily hydrates the shadow from ctx.storage on first query', async () => {
    // Pre-seed storage under the key Memory reads from on cold start.
    const seedKey = 'cortex-cognitive-memory/seed/episodic/trace-cold';
    const { ctx, eventsFor, spies } = createMockCtx({
      includeEvents: true,
      includeSchedule: true,
      storageSeed: {
        [seedKey]: {
          entries: [
            {
              key: 'prior-episode/trace-cold',
              kind: 'episodic',
              content: 'prior recovery via re-planning',
              activation: 0.9,
            } satisfies MemoryEntry,
          ],
        },
      },
    });
    const handle = await composeMemoryTenantApp(ctx);

    const entries = await handle.handleMemoryQuery('trace-cold', {
      queryKind: 'episodic',
      key: 'prior',
      k: 5,
    });
    assert.equal(entries.length, 1);
    assert.equal(entries[0].key, 'prior-episode/trace-cold');
    assert.ok(
      spies.storageGet.calls.some(([k]) => k === seedKey),
      'ctx.storage.get was invoked on the seed key',
    );

    const recalls = eventsFor('method.cortex.workspace.memory_recalled');
    assert.equal(recalls.length, 1);
    assert.equal(recalls[0].traceId, 'trace-cold');

    // Second query on the same (trace, kind) should not trigger another
    // storage.get — the shadow hydrates at most once per pair.
    const before = spies.storageGet.callCount();
    await handle.handleMemoryQuery('trace-cold', {
      queryKind: 'episodic',
      key: 'prior',
      k: 5,
    });
    assert.equal(
      spies.storageGet.callCount(),
      before,
      'shadow hydration is cached — no extra storage reads',
    );

    await handle.dispose();
  });
});

describe('cortex-cognitive-memory — consolidation', () => {
  it('reactToWorkspaceState promotes high-activation episodic to semantic and emits memory_consolidated', async () => {
    const { ctx, eventsFor } = createMockCtx({
      includeEvents: true,
      includeSchedule: true,
    });
    const handle = await composeMemoryTenantApp(ctx);

    handle.recordEpisodic({
      key: 'strong-episode',
      kind: 'episodic',
      content: 'high activation — should promote',
      activation: 0.8,
    });
    handle.recordEpisodic({
      key: 'weak-episode',
      kind: 'episodic',
      content: 'low activation — should NOT promote',
      activation: 0.1,
    });

    const before = handle.snapshot();
    assert.equal(before.semantic.length, 0);
    assert.equal(before.episodic.length, 2);

    const result = await handle.reactToWorkspaceState('trace-5', {
      stateSnapshot: { step: 7, status: 'checkpoint' },
    });
    assert.equal(result.writtenCount, 1);

    const after = handle.snapshot();
    assert.equal(after.semantic.length, 1);
    assert.equal(after.semantic[0].key, 'strong-episode');
    assert.equal(after.semantic[0].kind, 'semantic');

    const consolidated = eventsFor('method.cortex.workspace.memory_consolidated');
    assert.equal(consolidated.length, 1);
    assert.equal(consolidated[0].traceId, 'trace-5');
    assert.equal(consolidated[0].consolidationKind, 'episodic-to-semantic');
    assert.equal(consolidated[0].writtenCount, 1);

    await handle.dispose();
  });

  it('explicit consolidate() path emits memory_consolidated (writtenCount=0 when nothing qualifies)', async () => {
    const { ctx, eventsFor } = createMockCtx({
      includeEvents: true,
      includeSchedule: true,
    });
    const handle = await composeMemoryTenantApp(ctx);

    const result = await handle.consolidate('trace-empty');
    assert.equal(result.writtenCount, 0);

    const consolidated = eventsFor('method.cortex.workspace.memory_consolidated');
    assert.equal(consolidated.length, 1);
    assert.equal(consolidated[0].traceId, 'trace-empty');
    assert.equal(consolidated[0].writtenCount, 0);

    await handle.dispose();
  });

  it('bounded store enforces MAX_ENTRIES_PER_KIND cap (FIFO eviction)', async () => {
    const { ctx } = createMockCtx({
      includeEvents: true,
      includeSchedule: true,
    });
    const handle = await composeMemoryTenantApp(ctx);

    // Push 100 episodic entries — cap is 64, so we expect the oldest 36
    // to be evicted and the newest 64 to survive.
    for (let i = 0; i < 100; i++) {
      handle.recordEpisodic({
        key: `episode-${i}`,
        kind: 'episodic',
        content: `content-${i}`,
        activation: 0.3,
      });
    }
    const snap = handle.snapshot();
    assert.equal(snap.episodic.length, 64);
    assert.equal(snap.episodic[0].key, 'episode-36');
    assert.equal(snap.episodic[63].key, 'episode-99');

    await handle.dispose();
  });
});

describe('cortex-cognitive-memory — dispose leaves gracefully', () => {
  it('emits module_offline with reason=graceful', async () => {
    const { ctx, eventsFor } = createMockCtx({
      includeEvents: true,
      includeSchedule: true,
    });
    const handle = await composeMemoryTenantApp(ctx);
    await handle.dispose();
    const leaves = eventsFor('method.cortex.workspace.module_offline');
    assert.equal(leaves.length, 1);
    assert.equal(leaves[0].moduleRole, 'memory');
    assert.equal(leaves[0].reason, 'graceful');
  });
});
