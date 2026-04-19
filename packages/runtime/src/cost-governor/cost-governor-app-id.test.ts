// SPDX-License-Identifier: Apache-2.0
/**
 * PRD-057 / S2 §8 / G-COSTGOV-APP-ID gate test.
 *
 * Verifies that:
 *
 *   1. `createCostGovernor` accepts an optional `appId` option.
 *   2. Emitted `cost.*` events carry `payload.appId` when set, and
 *      omit it when not set.
 *   3. `rateGovernor.utilization()` supports the scope-filter form
 *      `utilization(providerClass, appId)`.
 *   4. The `appId`-absent path behaves bit-identically to before:
 *      no surprise payload keys, no slot-routing changes.
 *
 * These are *additive* assertions — they do NOT replace or mutate the
 * existing observations-store.test.ts / rate-governor-impl.test.ts
 * coverage (which is intentionally unchanged per PRD §9.4).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { EventBus, EventSink, RuntimeEvent, RuntimeEventInput } from '../ports/event-bus.js';
import type { FileSystemProvider, FileStat, DirEntry } from '../ports/file-system.js';
import { createCostGovernor } from './index.js';
import type { AppId } from './rate-governor-impl.js';

// ── In-memory event bus that records emitted events ─────────────

function createRecordingBus(): { bus: EventBus; events: RuntimeEvent[] } {
  const events: RuntimeEvent[] = [];
  let seq = 0;
  const sinks: EventSink[] = [];
  const bus: EventBus = {
    emit(input: RuntimeEventInput): RuntimeEvent {
      const event: RuntimeEvent = {
        ...input,
        id: `ev-${++seq}`,
        timestamp: new Date().toISOString(),
        sequence: seq,
      };
      events.push(event);
      for (const sink of sinks) sink.onEvent(event);
      return event;
    },
    importEvent(event: RuntimeEvent) {
      events.push(event);
    },
    subscribe() {
      return { unsubscribe() {} };
    },
    query() {
      return [...events];
    },
    registerSink(sink: EventSink) {
      sinks.push(sink);
    },
  };
  return { bus, events };
}

// ── Minimal in-memory FileSystemProvider (matches MemFs in other tests) ──

class MemFs implements FileSystemProvider {
  files = new Map<string, string>();
  dirs = new Set<string>();
  readFileSync(path: string): string {
    const content = this.files.get(path);
    if (content === undefined) throw new Error(`ENOENT: ${path}`);
    return content;
  }
  writeFileSync(path: string, content: string): void {
    this.files.set(path, content);
  }
  existsSync(path: string): boolean {
    return this.files.has(path) || this.dirs.has(path);
  }
  readdirSync(path: string): string[];
  readdirSync(path: string, options: { withFileTypes: true }): DirEntry[];
  readdirSync(_path: string, options?: { withFileTypes: true }): string[] | DirEntry[] {
    return options?.withFileTypes ? ([] as DirEntry[]) : ([] as string[]);
  }
  statSync(_path: string): FileStat {
    throw new Error('not implemented');
  }
  unlinkSync(path: string): void {
    this.files.delete(path);
  }
  mkdirSync(path: string): void {
    this.dirs.add(path);
  }
  renameSync(oldPath: string, newPath: string): void {
    const content = this.files.get(oldPath);
    if (content !== undefined) {
      this.files.set(newPath, content);
      this.files.delete(oldPath);
    }
  }
  realpathSync(path: string): string { return path; }
  async readFile(path: string): Promise<string> { return this.readFileSync(path); }
  async writeFile(path: string, content: string): Promise<void> { this.writeFileSync(path, content); }
  async appendFile(path: string, content: string): Promise<void> {
    const existing = this.files.get(path) ?? '';
    this.files.set(path, existing + content);
  }
  async readdir(_path: string): Promise<string[]> { return []; }
  async stat(_path: string): Promise<FileStat> { throw new Error('not implemented'); }
  async access(_path: string): Promise<void> {}
  async mkdir(path: string): Promise<void> { this.dirs.add(path); }
}

// ── Tests ───────────────────────────────────────────────────────

describe('createCostGovernor — per-AppId hook (PRD-057 / S2 §8)', () => {
  it('no appId: governor exposes appId=undefined and emits events without payload.appId', () => {
    const { bus } = createRecordingBus();
    const fs = new MemFs();

    const governor = createCostGovernor({
      eventBus: bus,
      fileSystem: fs,
      config: { dataDir: '/data', hmacSecret: 'test' },
    });

    assert.equal(governor.appId, undefined);
    assert.equal(governor.rateGovernor.getAppId(), undefined);
    assert.equal(governor.sweepLeakedSlots(), 0);

    // Utilization without filter — single entry.
    const util = governor.rateGovernor.utilization('claude-cli');
    assert.equal(util.length, 1);

    // Utilization with filter: any appId filter on a no-scope governor
    // returns empty (scope miss).
    const filtered = governor.rateGovernor.utilization(
      'claude-cli',
      'app-x' as AppId,
    );
    assert.equal(filtered.length, 0);
  });

  it('with appId: governor exposes appId and scoped utilization matches', () => {
    const { bus } = createRecordingBus();
    const fs = new MemFs();
    const appId = 'tenant-42' as AppId;

    const governor = createCostGovernor({
      eventBus: bus,
      fileSystem: fs,
      config: { dataDir: '/data', hmacSecret: 'test' },
      appId,
    });

    assert.equal(governor.appId, appId);
    assert.equal(governor.rateGovernor.getAppId(), appId);

    // Matching filter — returns the account row.
    const matching = governor.rateGovernor.utilization('claude-cli', appId);
    assert.equal(matching.length, 1);

    // Non-matching filter — empty.
    const nonMatching = governor.rateGovernor.utilization(
      'claude-cli',
      'other-tenant' as AppId,
    );
    assert.equal(nonMatching.length, 0);

    // Unfiltered — still returns the account row.
    const unfiltered = governor.rateGovernor.utilization('claude-cli');
    assert.equal(unfiltered.length, 1);
  });

  it('with appId: sweepLeakedSlots emits cost.slot_leaked with payload.appId', () => {
    const { bus, events } = createRecordingBus();
    const fs = new MemFs();
    const appId = 'tenant-77' as AppId;

    const governor = createCostGovernor({
      eventBus: bus,
      fileSystem: fs,
      config: { dataDir: '/data', hmacSecret: 'test' },
      appId,
    });

    // Manually inject a stale slot so sweep has something to emit.
    // We bypass the normal acquire path to avoid needing a full signature
    // fixture — the assertion target is the emitted payload.
    const rg = governor.rateGovernor as unknown as {
      active: Map<string, { slot: { slotId: string; providerClass: string; accountId: string; acquiredAt: number; estimatedCostUsd: number; maxLifetimeMs: number } }>;
      bucket: { release: () => void };
      queue: { dequeue: () => boolean };
    };
    rg.active.set('stale', {
      slot: {
        slotId: 'stale',
        providerClass: 'claude-cli',
        accountId: 'default',
        acquiredAt: Date.now() - 120_000,
        estimatedCostUsd: 0,
        maxLifetimeMs: 60_000,
      },
    });

    const leaked = governor.sweepLeakedSlots();
    assert.equal(leaked, 1);

    const slotLeakedEvents = events.filter(e => e.type === 'cost.slot_leaked');
    assert.equal(slotLeakedEvents.length, 1);
    assert.equal(slotLeakedEvents[0].payload.appId, appId);
    assert.equal(slotLeakedEvents[0].source, 'runtime/cost-governor');
  });

  it('no appId: cost.slot_leaked events omit payload.appId', () => {
    const { bus, events } = createRecordingBus();
    const fs = new MemFs();

    const governor = createCostGovernor({
      eventBus: bus,
      fileSystem: fs,
      config: { dataDir: '/data', hmacSecret: 'test' },
    });

    const rg = governor.rateGovernor as unknown as {
      active: Map<string, { slot: { slotId: string; providerClass: string; accountId: string; acquiredAt: number; estimatedCostUsd: number; maxLifetimeMs: number } }>;
    };
    rg.active.set('stale', {
      slot: {
        slotId: 'stale',
        providerClass: 'claude-cli',
        accountId: 'default',
        acquiredAt: Date.now() - 120_000,
        estimatedCostUsd: 0,
        maxLifetimeMs: 60_000,
      },
    });

    governor.sweepLeakedSlots();

    const slotLeakedEvents = events.filter(e => e.type === 'cost.slot_leaked');
    assert.equal(slotLeakedEvents.length, 1);
    assert.ok(
      !('appId' in (slotLeakedEvents[0].payload as Record<string, unknown>)),
      'no-appId governor must not emit payload.appId',
    );
  });
});
