// SPDX-License-Identifier: Apache-2.0
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ProjectionStoreImpl } from './projection-store.js';
import type {
  BridgeEvent,
  BridgeEventInput,
  EventBus,
  EventFilter,
  EventSink,
  EventSubscription,
} from '../../ports/event-bus.js';
import type { EventReader } from '../../ports/event-reader.js';
import type { Projection } from '../../ports/projection.js';
import type {
  FileSystemProvider,
  FileStat,
  DirEntry,
} from '../../ports/file-system.js';

// ── Shared in-memory filesystem (survives "restart") ────────────

class MemFs implements FileSystemProvider {
  readonly files = new Map<string, string>();
  readonly dirs = new Set<string>();

  readFileSync(path: string): string {
    const c = this.files.get(path);
    if (c === undefined) throw new Error(`ENOENT: ${path}`);
    return c;
  }
  writeFileSync(path: string, content: string): void { this.files.set(path, content); }
  existsSync(path: string): boolean { return this.files.has(path) || this.dirs.has(path); }
  readdirSync(_path: string): string[];
  readdirSync(_path: string, options: { withFileTypes: true }): DirEntry[];
  readdirSync(_path: string, options?: { withFileTypes: true }): string[] | DirEntry[] {
    return options?.withFileTypes ? ([] as DirEntry[]) : ([] as string[]);
  }
  statSync(_path: string): FileStat { throw new Error('nyi'); }
  unlinkSync(path: string): void { this.files.delete(path); }
  mkdirSync(path: string): void { this.dirs.add(path); }
  renameSync(oldPath: string, newPath: string): void {
    const c = this.files.get(oldPath);
    if (c === undefined) throw new Error(`ENOENT: ${oldPath}`);
    this.files.set(newPath, c);
    this.files.delete(oldPath);
  }
  realpathSync(p: string): string { return p; }
  async readFile(path: string): Promise<string> {
    const c = this.files.get(path);
    if (c === undefined) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    return c;
  }
  async writeFile(path: string, content: string): Promise<void> { this.files.set(path, content); }
  async appendFile(path: string, content: string): Promise<void> {
    this.files.set(path, (this.files.get(path) ?? '') + content);
  }
  async readdir(_path: string): Promise<string[]> { return []; }
  async stat(_path: string): Promise<FileStat> { throw new Error('nyi'); }
  async access(path: string): Promise<void> {
    if (!this.files.has(path)) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
  }
  async mkdir(path: string): Promise<void> { this.dirs.add(path); }
}

// ── Shared "persistent log" — survives across bus instances ─────

class PersistentEventLog {
  readonly events: BridgeEvent[] = [];
  private seq = 0;
  append(input: BridgeEventInput): BridgeEvent {
    const event: BridgeEvent = {
      ...input,
      id: `id-${++this.seq}`,
      version: 1,
      timestamp: new Date().toISOString(),
      sequence: this.seq,
    };
    this.events.push(event);
    return event;
  }
}

class FakeEventBus implements EventBus {
  readonly sinks: EventSink[] = [];
  constructor(private readonly log: PersistentEventLog) {}
  emit(input: BridgeEventInput): BridgeEvent {
    const event = this.log.append(input);
    for (const s of this.sinks) s.onEvent(event);
    return event;
  }
  importEvent(_event: BridgeEvent): void {}
  subscribe(_filter: EventFilter, _handler: (e: BridgeEvent) => void): EventSubscription {
    return { unsubscribe: () => {} };
  }
  query(_filter: EventFilter): BridgeEvent[] { return []; }
  registerSink(sink: EventSink): void { this.sinks.push(sink); }
}

class FakeEventReader implements EventReader {
  constructor(private readonly log: PersistentEventLog) {}
  async readEventsSince(sinceSeq: number): Promise<BridgeEvent[]> {
    return this.log.events.filter((e) => e.sequence > sinceSeq);
  }
}

// ── Domain projection: order book ───────────────────────────────

interface OrderBookState {
  orders: Record<string, { id: string; amount: number; status: string }>;
  totalOrders: number;
  totalAmount: number;
}

const orderBookProjection: Projection<OrderBookState> = {
  domain: 'orderbook',
  initialState: () => ({ orders: {}, totalOrders: 0, totalAmount: 0 }),
  reduce: (state, event) => {
    if (event.type === 'order.placed') {
      const { id, amount } = event.payload as { id: string; amount: number };
      return {
        orders: { ...state.orders, [id]: { id, amount, status: 'placed' } },
        totalOrders: state.totalOrders + 1,
        totalAmount: state.totalAmount + amount,
      };
    }
    if (event.type === 'order.completed') {
      const { id } = event.payload as { id: string };
      const existing = state.orders[id];
      if (!existing) return state;
      return {
        ...state,
        orders: { ...state.orders, [id]: { ...existing, status: 'completed' } },
      };
    }
    return state;
  },
  serialize: (state) => JSON.stringify(state),
  deserialize: (raw) => JSON.parse(raw) as OrderBookState,
  snapshotEveryN: 5,
};

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ── Integration: full lifecycle ─────────────────────────────────

describe('ProjectionStore integration — start → replay → snapshot → restart → state matches', () => {
  it('survives a simulated restart with identical state', async () => {
    const log = new PersistentEventLog();
    const fs = new MemFs();

    // ── Phase 1: cold boot, no snapshot, emit 12 events ─────────
    {
      const bus = new FakeEventBus(log);
      const reader = new FakeEventReader(log);
      const store = new ProjectionStoreImpl({
        eventReader: reader,
        eventBus: bus,
        fs,
        snapshotDir: '/snap',
        snapshotDebounceMs: 15,
      });
      store.register(orderBookProjection); // snapshotEveryN = 5

      const result = await store.start();
      assert.equal(result.snapshotsRestored, 0);
      assert.equal(result.eventsReplayed, 0);

      for (let i = 1; i <= 12; i++) {
        const type = i % 3 === 0 ? 'order.completed' : 'order.placed';
        const id = `order-${i % 3 === 0 ? i - 2 : i}`;
        const payload = i % 3 === 0 ? { id } : { id, amount: i * 10 };
        bus.emit({ version: 1, domain: 'orders', type, severity: 'info', source: 't', payload });
      }

      // Let snapshot debounces fire.
      await wait(80);

      const state1 = store.get<OrderBookState>('orderbook')!;
      assert.ok(state1);
      assert.equal(state1.totalOrders, 8, '8 placements across 12 events');

      // A snapshot should exist on disk now (threshold of 5 crossed at least once).
      assert.equal(fs.files.has('/snap/orderbook.json'), true);

      // Record the state for later comparison.
      const snapshotJson = fs.files.get('/snap/orderbook.json')!;
      assert.ok(snapshotJson.length > 0);

      // Explicitly flush to ensure the latest snapshot is persisted too.
      await store.flushSnapshots();
      store.dispose();
    }

    // ── Phase 2: simulate restart — new bus, new store, same fs + log ──
    const phase1Events = log.events.length;
    assert.equal(phase1Events, 12);

    // Emit a few more events BEFORE the "restart" to ensure replay picks them up.
    log.append({
      version: 1,
      domain: 'orders',
      type: 'order.placed',
      severity: 'info',
      source: 't',
      payload: { id: 'order-99', amount: 999 },
    });
    log.append({
      version: 1,
      domain: 'orders',
      type: 'order.completed',
      severity: 'info',
      source: 't',
      payload: { id: 'order-99' },
    });

    {
      const bus = new FakeEventBus(log);
      const reader = new FakeEventReader(log);
      const store = new ProjectionStoreImpl({
        eventReader: reader,
        eventBus: bus,
        fs, // same fs → snapshot survives
        snapshotDir: '/snap',
        snapshotDebounceMs: 15,
      });
      store.register(orderBookProjection);

      const result = await store.start();
      assert.equal(result.snapshotsRestored, 1, 'snapshot from phase 1 is restored');
      // Events replayed = events after snapshot cursor. Don't pin an exact number —
      // it depends on which debounced snapshot wrote last — but assert it's >= 2
      // (for the two phase-2 events) and <= 14 (total events in the log).
      assert.ok(result.eventsReplayed >= 2, 'at least the 2 phase-2 events replay');
      assert.ok(result.eventsReplayed <= 14);
      assert.equal(result.skippedEvents, 0);

      const state2 = store.get<OrderBookState>('orderbook')!;
      assert.ok(state2);
      // 9 placements (8 from phase 1 + order-99 from phase 2)
      assert.equal(state2.totalOrders, 9);
      // order-99 should be completed
      assert.equal(state2.orders['order-99'].status, 'completed');
      store.dispose();
    }
  });

  it('three projections with independent snapshot cadences all rehydrate correctly', async () => {
    const log = new PersistentEventLog();
    const fs = new MemFs();

    const counterA: Projection<number> = {
      domain: 'count-a',
      initialState: () => 0,
      reduce: (s, e) => (e.type === 'a.inc' ? s + 1 : s),
      serialize: (s) => JSON.stringify(s),
      deserialize: (raw) => JSON.parse(raw) as number,
      snapshotEveryN: 2,
    };
    const counterB: Projection<number> = {
      domain: 'count-b',
      initialState: () => 0,
      reduce: (s, e) => (e.type === 'b.inc' ? s + 1 : s),
      serialize: (s) => JSON.stringify(s),
      deserialize: (raw) => JSON.parse(raw) as number,
      snapshotEveryN: 3,
    };
    const sumAll: Projection<number> = {
      domain: 'sum',
      initialState: () => 0,
      reduce: (s, e) => {
        if (e.type === 'a.inc' || e.type === 'b.inc') return s + 1;
        return s;
      },
      serialize: (s) => JSON.stringify(s),
      deserialize: (raw) => JSON.parse(raw) as number,
      snapshotEveryN: 4,
    };

    {
      const bus = new FakeEventBus(log);
      const store = new ProjectionStoreImpl({
        eventReader: new FakeEventReader(log),
        eventBus: bus,
        fs,
        snapshotDir: '/snap',
        snapshotDebounceMs: 15,
      });
      store.register(counterA);
      store.register(counterB);
      store.register(sumAll);
      await store.start();

      // Interleaved a / b events: 6 of each
      for (let i = 0; i < 12; i++) {
        const type = i % 2 === 0 ? 'a.inc' : 'b.inc';
        bus.emit({ version: 1, domain: 'test', type, severity: 'info', source: 't', payload: {} });
      }
      await store.flushSnapshots();

      assert.equal(store.get<number>('count-a'), 6);
      assert.equal(store.get<number>('count-b'), 6);
      assert.equal(store.get<number>('sum'), 12);
      store.dispose();
    }

    // Restart.
    {
      const bus = new FakeEventBus(log);
      const store = new ProjectionStoreImpl({
        eventReader: new FakeEventReader(log),
        eventBus: bus,
        fs,
        snapshotDir: '/snap',
        snapshotDebounceMs: 15,
      });
      store.register(counterA);
      store.register(counterB);
      store.register(sumAll);
      const result = await store.start();

      assert.equal(result.projectionsLoaded, 3);
      assert.equal(result.snapshotsRestored, 3, 'all 3 snapshots restored');

      // Final state matches.
      assert.equal(store.get<number>('count-a'), 6);
      assert.equal(store.get<number>('count-b'), 6);
      assert.equal(store.get<number>('sum'), 12);
      store.dispose();
    }
  });

  it('snapshot files use tmp+rename (atomicity)', async () => {
    const log = new PersistentEventLog();
    const fs = new MemFs();

    const proj: Projection<number> = {
      domain: 'atom',
      initialState: () => 0,
      reduce: (s) => s + 1,
      serialize: (s) => JSON.stringify(s),
      deserialize: (raw) => JSON.parse(raw) as number,
      snapshotEveryN: 2,
    };

    const bus = new FakeEventBus(log);
    const store = new ProjectionStoreImpl({
      eventReader: new FakeEventReader(log),
      eventBus: bus,
      fs,
      snapshotDir: '/snap',
      snapshotDebounceMs: 10,
    });
    store.register(proj);
    await store.start();

    for (let i = 0; i < 4; i++) {
      bus.emit({ version: 1, domain: 't', type: 'tick', severity: 'info', source: 't', payload: {} });
    }
    await store.flushSnapshots();

    // Final file exists; tmp does not.
    assert.equal(fs.files.has('/snap/atom.json'), true);
    assert.equal(fs.files.has('/snap/atom.json.tmp'), false);
    store.dispose();
  });
});
