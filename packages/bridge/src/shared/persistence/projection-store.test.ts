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
import type { ProjectionSnapshot } from './types.js';

// ── In-memory fakes ─────────────────────────────────────────────

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

class FakeEventBus implements EventBus {
  readonly sinks: EventSink[] = [];
  private seq = 0;
  emit(input: BridgeEventInput): BridgeEvent {
    const event: BridgeEvent = {
      ...input,
      id: `id-${++this.seq}`,
      version: 1,
      timestamp: new Date().toISOString(),
      sequence: this.seq,
    };
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
  constructor(private readonly events: BridgeEvent[]) {}
  async readEventsSince(sinceSeq: number): Promise<BridgeEvent[]> {
    return this.events.filter((e) => e.sequence > sinceSeq);
  }
  /** Test helper: expose events array for mutation. */
  push(event: BridgeEvent): void { this.events.push(event); }
}

// ── Event + projection fixtures ─────────────────────────────────

const mkEvent = (seq: number, type = 'counter.incremented', payload: Record<string, unknown> = {}): BridgeEvent => ({
  id: `id-${seq}`,
  version: 1,
  timestamp: `2026-04-05T00:00:${String(seq).padStart(2, '0')}.000Z`,
  sequence: seq,
  domain: 'test',
  type,
  severity: 'info',
  source: 'test',
  payload,
});

interface CounterState {
  count: number;
  lastType: string | null;
}

const counterProjection: Projection<CounterState> = {
  domain: 'counter',
  initialState: () => ({ count: 0, lastType: null }),
  reduce: (state, event) => ({
    count: state.count + 1,
    lastType: event.type,
  }),
  serialize: (state) => JSON.stringify(state),
  deserialize: (raw) => JSON.parse(raw) as CounterState,
  snapshotEveryN: 3,
};

// Projection that throws for certain event types.
const makePoisonProjection = (poisonType: string): Projection<CounterState> => ({
  domain: 'poison',
  initialState: () => ({ count: 0, lastType: null }),
  reduce: (state, event) => {
    if (event.type === poisonType) throw new Error('boom');
    return { count: state.count + 1, lastType: event.type };
  },
  serialize: (state) => JSON.stringify(state),
  deserialize: (raw) => JSON.parse(raw) as CounterState,
  snapshotEveryN: 100,
});

// Projection with no serialize (replay-only).
const replayOnlyProjection: Projection<CounterState> = {
  domain: 'ephemeral',
  initialState: () => ({ count: 0, lastType: null }),
  reduce: (state, event) => ({ count: state.count + 1, lastType: event.type }),
  snapshotEveryN: 5,
};

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ── Tests ───────────────────────────────────────────────────────

describe('ProjectionStoreImpl — lifecycle', () => {
  it('register → start replays from sequence 0 when no snapshot exists', async () => {
    const fs = new MemFs();
    const reader = new FakeEventReader([
      mkEvent(1),
      mkEvent(2),
      mkEvent(3, 'counter.reset'),
    ]);
    const bus = new FakeEventBus();
    const store = new ProjectionStoreImpl({
      eventReader: reader,
      eventBus: bus,
      fs,
      snapshotDir: '/snap',
      snapshotDebounceMs: 10,
    });

    store.register(counterProjection);
    const result = await store.start();

    assert.equal(result.projectionsLoaded, 1);
    assert.equal(result.snapshotsRestored, 0);
    assert.equal(result.eventsReplayed, 3);
    assert.equal(result.skippedEvents, 0);
    assert.ok(result.durationMs >= 0);

    const state = store.get<CounterState>('counter');
    assert.deepEqual(state, { count: 3, lastType: 'counter.reset' });

    // registered itself as a sink
    assert.equal(bus.sinks.length, 1);
    assert.equal(bus.sinks[0].name, 'projection-store');
    store.dispose();
  });

  it('restores state from snapshot + replays only events after the cursor', async () => {
    const fs = new MemFs();
    // Plant a snapshot at cursor=2 with count=2.
    const snap: ProjectionSnapshot = {
      version: 1,
      domain: 'counter',
      cursor: 2,
      eventCount: 2,
      writtenAt: '2026-04-05T00:00:00Z',
      state: JSON.stringify({ count: 2, lastType: 'counter.incremented' } satisfies CounterState),
    };
    fs.files.set('/snap/counter.json', JSON.stringify(snap));

    const reader = new FakeEventReader([
      mkEvent(1),
      mkEvent(2),
      mkEvent(3, 'counter.reset'),
      mkEvent(4, 'counter.incremented'),
    ]);
    const bus = new FakeEventBus();
    const store = new ProjectionStoreImpl({
      eventReader: reader,
      eventBus: bus,
      fs,
      snapshotDir: '/snap',
      snapshotDebounceMs: 10,
    });

    store.register(counterProjection);
    const result = await store.start();

    assert.equal(result.snapshotsRestored, 1);
    assert.equal(result.eventsReplayed, 2, 'only events 3 and 4 should replay');

    const state = store.get<CounterState>('counter');
    assert.deepEqual(state, { count: 4, lastType: 'counter.incremented' });
    store.dispose();
  });

  it('corrupt snapshot is logged + discarded + replays from 0', async () => {
    const fs = new MemFs();
    fs.files.set('/snap/counter.json', '{this is not json');

    const warnings: string[] = [];
    const reader = new FakeEventReader([mkEvent(1), mkEvent(2)]);
    const bus = new FakeEventBus();
    const store = new ProjectionStoreImpl({
      eventReader: reader,
      eventBus: bus,
      fs,
      snapshotDir: '/snap',
      snapshotDebounceMs: 10,
      warn: (m) => warnings.push(m),
    });

    store.register(counterProjection);
    const result = await store.start();

    assert.equal(result.snapshotsRestored, 0);
    assert.equal(result.eventsReplayed, 2);
    assert.ok(warnings.some((w) => w.includes('corrupt snapshot') && w.includes('invalid JSON')));

    const state = store.get<CounterState>('counter');
    assert.deepEqual(state, { count: 2, lastType: 'counter.incremented' });
    store.dispose();
  });

  it('snapshot with wrong version is discarded', async () => {
    const fs = new MemFs();
    fs.files.set(
      '/snap/counter.json',
      JSON.stringify({ version: 2, domain: 'counter', cursor: 5, eventCount: 5, writtenAt: '', state: '{}' }),
    );
    const warnings: string[] = [];
    const store = new ProjectionStoreImpl({
      eventReader: new FakeEventReader([]),
      eventBus: new FakeEventBus(),
      fs,
      snapshotDir: '/snap',
      warn: (m) => warnings.push(m),
    });
    store.register(counterProjection);
    const result = await store.start();
    assert.equal(result.snapshotsRestored, 0);
    assert.ok(warnings.some((w) => w.includes('unsupported version')));
    store.dispose();
  });

  it('snapshot with wrong domain is discarded', async () => {
    const fs = new MemFs();
    const bad: ProjectionSnapshot = {
      version: 1,
      domain: 'not-counter',
      cursor: 5,
      eventCount: 5,
      writtenAt: '2026-01-01T00:00:00Z',
      state: JSON.stringify({ count: 5, lastType: 'x' }),
    };
    fs.files.set('/snap/counter.json', JSON.stringify(bad));
    const warnings: string[] = [];
    const store = new ProjectionStoreImpl({
      eventReader: new FakeEventReader([]),
      eventBus: new FakeEventBus(),
      fs,
      snapshotDir: '/snap',
      warn: (m) => warnings.push(m),
    });
    store.register(counterProjection);
    const result = await store.start();
    assert.equal(result.snapshotsRestored, 0);
    assert.ok(warnings.some((w) => w.includes('domain mismatch')));
    store.dispose();
  });

  it('reducer throws during replay: event is skipped, counter advances, store keeps going', async () => {
    const fs = new MemFs();
    const warnings: string[] = [];
    const reader = new FakeEventReader([
      mkEvent(1, 'normal'),
      mkEvent(2, 'poison'),
      mkEvent(3, 'normal'),
    ]);
    const store = new ProjectionStoreImpl({
      eventReader: reader,
      eventBus: new FakeEventBus(),
      fs,
      snapshotDir: '/snap',
      warn: (m) => warnings.push(m),
    });
    store.register(makePoisonProjection('poison'));
    const result = await store.start();

    assert.equal(result.eventsReplayed, 2);
    assert.equal(result.skippedEvents, 1);
    const state = store.get<CounterState>('poison');
    assert.deepEqual(state, { count: 2, lastType: 'normal' });
    assert.ok(warnings.some((w) => w.includes("reducer for 'poison' threw")));
    store.dispose();
  });

  it('reducer throws on live event: state unchanged, no crash', async () => {
    const fs = new MemFs();
    const warnings: string[] = [];
    const bus = new FakeEventBus();
    const store = new ProjectionStoreImpl({
      eventReader: new FakeEventReader([]),
      eventBus: bus,
      fs,
      snapshotDir: '/snap',
      warn: (m) => warnings.push(m),
    });
    store.register(makePoisonProjection('poison'));
    await store.start();

    // Emit good → poison → good; state should advance twice.
    bus.emit({ version: 1, domain: 'test', type: 'normal', severity: 'info', source: 't', payload: {} });
    bus.emit({ version: 1, domain: 'test', type: 'poison', severity: 'info', source: 't', payload: {} });
    bus.emit({ version: 1, domain: 'test', type: 'normal', severity: 'info', source: 't', payload: {} });

    const state = store.get<CounterState>('poison');
    assert.deepEqual(state, { count: 2, lastType: 'normal' });
    assert.ok(warnings.some((w) => w.includes("reducer for 'poison' threw")));
    store.dispose();
  });

  it('get() returns null before start()', async () => {
    const store = new ProjectionStoreImpl({
      eventReader: new FakeEventReader([]),
      eventBus: new FakeEventBus(),
      fs: new MemFs(),
    });
    store.register(counterProjection);
    assert.equal(store.get<CounterState>('counter'), null);
    store.dispose();
  });

  it('get() returns null for unregistered domain', async () => {
    const store = new ProjectionStoreImpl({
      eventReader: new FakeEventReader([]),
      eventBus: new FakeEventBus(),
      fs: new MemFs(),
    });
    store.register(counterProjection);
    await store.start();
    assert.equal(store.get('nonexistent'), null);
    store.dispose();
  });

  it('register() rejects duplicate domain', async () => {
    const store = new ProjectionStoreImpl({
      eventReader: new FakeEventReader([]),
      eventBus: new FakeEventBus(),
      fs: new MemFs(),
    });
    store.register(counterProjection);
    assert.throws(() => store.register(counterProjection), /already registered/);
    store.dispose();
  });

  it('register() rejects after start()', async () => {
    const store = new ProjectionStoreImpl({
      eventReader: new FakeEventReader([]),
      eventBus: new FakeEventBus(),
      fs: new MemFs(),
    });
    await store.start();
    assert.throws(() => store.register(counterProjection), /cannot register.*after start/);
    store.dispose();
  });

  it('start() is idempotent: second call is a no-op', async () => {
    const reader = new FakeEventReader([mkEvent(1), mkEvent(2)]);
    const bus = new FakeEventBus();
    const store = new ProjectionStoreImpl({
      eventReader: reader,
      eventBus: bus,
      fs: new MemFs(),
    });
    store.register(counterProjection);
    const first = await store.start();
    assert.equal(first.eventsReplayed, 2);

    const second = await store.start();
    assert.equal(second.eventsReplayed, 0, 'second start replays nothing');
    assert.equal(bus.sinks.length, 1, 'only one sink registration');
    store.dispose();
  });
});

describe('ProjectionStoreImpl — live events', () => {
  it('onEvent is a no-op before start()', () => {
    const store = new ProjectionStoreImpl({
      eventReader: new FakeEventReader([]),
      eventBus: new FakeEventBus(),
      fs: new MemFs(),
    });
    store.register(counterProjection);
    // Calling onEvent directly (not via bus) — should be ignored.
    store.onEvent(mkEvent(5));
    assert.equal(store.get<CounterState>('counter'), null);
    store.dispose();
  });

  it('reduces live events after start() and updates cursor', async () => {
    const bus = new FakeEventBus();
    const store = new ProjectionStoreImpl({
      eventReader: new FakeEventReader([]),
      eventBus: bus,
      fs: new MemFs(),
      snapshotDir: '/snap',
      snapshotDebounceMs: 10,
    });
    store.register(counterProjection);
    await store.start();

    bus.emit({ version: 1, domain: 'test', type: 'counter.incremented', severity: 'info', source: 't', payload: {} });
    bus.emit({ version: 1, domain: 'test', type: 'counter.incremented', severity: 'info', source: 't', payload: {} });

    const state = store.get<CounterState>('counter');
    assert.deepEqual(state, { count: 2, lastType: 'counter.incremented' });
    store.dispose();
  });

  it('stale events (seq <= cursor) are ignored', async () => {
    const fs = new MemFs();
    const reader = new FakeEventReader([mkEvent(1), mkEvent(2), mkEvent(3)]);
    const store = new ProjectionStoreImpl({
      eventReader: reader,
      eventBus: new FakeEventBus(),
      fs,
      snapshotDir: '/snap',
    });
    store.register(counterProjection);
    await store.start();

    const before = store.get<CounterState>('counter');
    assert.deepEqual(before, { count: 3, lastType: 'counter.incremented' });

    // Replay a stale event directly.
    store.onEvent(mkEvent(2, 'already.seen'));
    const after = store.get<CounterState>('counter');
    assert.deepEqual(after, before, 'stale event should not mutate state');
    store.dispose();
  });
});

describe('ProjectionStoreImpl — snapshot writing + maxSafeCutoff', () => {
  it('writes a snapshot when eventCount threshold is reached (with debounce)', async () => {
    const fs = new MemFs();
    const bus = new FakeEventBus();
    const store = new ProjectionStoreImpl({
      eventReader: new FakeEventReader([]),
      eventBus: bus,
      fs,
      snapshotDir: '/snap',
      snapshotDebounceMs: 20,
    });
    store.register(counterProjection); // snapshotEveryN = 3
    await store.start();

    assert.equal(store.maxSafeCutoff(), null, 'no snapshot yet → null cutoff');

    for (let i = 0; i < 3; i++) {
      bus.emit({ version: 1, domain: 'test', type: 'counter.incremented', severity: 'info', source: 't', payload: {} });
    }

    // Before debounce fires, no file.
    assert.equal(fs.files.has('/snap/counter.json'), false);

    await wait(70);

    assert.equal(fs.files.has('/snap/counter.json'), true);
    const parsed = JSON.parse(fs.files.get('/snap/counter.json')!) as ProjectionSnapshot;
    assert.equal(parsed.cursor, 3);
    assert.equal(parsed.eventCount, 3);
    assert.equal(parsed.domain, 'counter');

    // Now maxSafeCutoff reflects the persisted cursor.
    assert.equal(store.maxSafeCutoff(), 3);
    store.dispose();
  });

  it('maxSafeCutoff returns null if any projection has no snapshot yet', async () => {
    const fs = new MemFs();
    const bus = new FakeEventBus();
    // Plant a snapshot for counter only.
    const plantedSnap: ProjectionSnapshot = {
      version: 1,
      domain: 'counter',
      cursor: 10,
      eventCount: 10,
      writtenAt: '2026-04-05T00:00:00Z',
      state: JSON.stringify({ count: 10, lastType: 'x' }),
    };
    fs.files.set('/snap/counter.json', JSON.stringify(plantedSnap));

    const store = new ProjectionStoreImpl({
      eventReader: new FakeEventReader([]),
      eventBus: bus,
      fs,
      snapshotDir: '/snap',
      snapshotDebounceMs: 10,
    });
    store.register(counterProjection);
    store.register({
      ...counterProjection,
      domain: 'other',
    });
    await store.start();

    assert.equal(store.maxSafeCutoff(), null, 'other projection has no snapshot');
    store.dispose();
  });

  it('maxSafeCutoff returns min(lastSnapshotCursor) across projections', async () => {
    const fs = new MemFs();
    // Plant two snapshots at different cursors.
    const snap = (domain: string, cursor: number): ProjectionSnapshot => ({
      version: 1,
      domain,
      cursor,
      eventCount: cursor,
      writtenAt: '2026-04-05T00:00:00Z',
      state: JSON.stringify({ count: cursor, lastType: 'x' }),
    });
    fs.files.set('/snap/counter.json', JSON.stringify(snap('counter', 42)));
    fs.files.set('/snap/other.json', JSON.stringify(snap('other', 17)));

    const store = new ProjectionStoreImpl({
      eventReader: new FakeEventReader([]),
      eventBus: new FakeEventBus(),
      fs,
      snapshotDir: '/snap',
    });
    store.register(counterProjection);
    store.register({ ...counterProjection, domain: 'other' });
    await store.start();

    assert.equal(store.maxSafeCutoff(), 17, 'min of 42 and 17');
    store.dispose();
  });

  it('maxSafeCutoff returns null if no projections registered', async () => {
    const store = new ProjectionStoreImpl({
      eventReader: new FakeEventReader([]),
      eventBus: new FakeEventBus(),
      fs: new MemFs(),
    });
    await store.start();
    assert.equal(store.maxSafeCutoff(), null);
    store.dispose();
  });

  it('maxSafeCutoff tracks on-disk cursor, not in-memory cursor', async () => {
    const fs = new MemFs();
    const bus = new FakeEventBus();
    const store = new ProjectionStoreImpl({
      eventReader: new FakeEventReader([]),
      eventBus: bus,
      fs,
      snapshotDir: '/snap',
      snapshotDebounceMs: 20,
    });
    store.register(counterProjection); // snapshotEveryN = 3
    await store.start();

    // Emit 3 events → snapshot will be debounced.
    for (let i = 0; i < 3; i++) {
      bus.emit({ version: 1, domain: 'test', type: 'counter.incremented', severity: 'info', source: 't', payload: {} });
    }

    // Emit 2 more before the debounce fires → in-memory cursor is 5, but no snapshot yet.
    bus.emit({ version: 1, domain: 'test', type: 'counter.incremented', severity: 'info', source: 't', payload: {} });
    bus.emit({ version: 1, domain: 'test', type: 'counter.incremented', severity: 'info', source: 't', payload: {} });

    // Right after emit, no debounce fired yet → maxSafeCutoff still null.
    assert.equal(store.maxSafeCutoff(), null);

    // Let the first debounce fire.
    await wait(70);

    // The snapshot we scheduled was built at cursor=3 (when threshold hit).
    // lastSnapshotCursor reflects THAT, not the in-memory cursor of 5.
    const persistedCutoff = store.maxSafeCutoff();
    assert.equal(persistedCutoff, 3, 'persisted cutoff reflects snapshot time, not current cursor');
    store.dispose();
  });

  it('replay-only projection (no serialize): maxSafeCutoff returns null', async () => {
    const store = new ProjectionStoreImpl({
      eventReader: new FakeEventReader([]),
      eventBus: new FakeEventBus(),
      fs: new MemFs(),
    });
    store.register(replayOnlyProjection);
    await store.start();
    assert.equal(store.maxSafeCutoff(), null, 'replay-only projections never have a safe cutoff');
    store.dispose();
  });

  it('replay-only projection: no snapshot file ever written', async () => {
    const fs = new MemFs();
    const bus = new FakeEventBus();
    const store = new ProjectionStoreImpl({
      eventReader: new FakeEventReader([]),
      eventBus: bus,
      fs,
      snapshotDir: '/snap',
      snapshotDebounceMs: 10,
    });
    store.register(replayOnlyProjection); // snapshotEveryN = 5
    await store.start();

    for (let i = 0; i < 10; i++) {
      bus.emit({ version: 1, domain: 'test', type: 'x', severity: 'info', source: 't', payload: {} });
    }
    await wait(50);

    assert.equal(fs.files.has('/snap/ephemeral.json'), false);
    assert.equal(fs.files.size, 0);
    store.dispose();
  });

  it('rejects projection with serialize but no deserialize', () => {
    const bad: Projection<CounterState> = {
      domain: 'bad',
      initialState: () => ({ count: 0, lastType: null }),
      reduce: (s) => s,
      serialize: (s) => JSON.stringify(s),
    };
    const store = new ProjectionStoreImpl({
      eventReader: new FakeEventReader([]),
      eventBus: new FakeEventBus(),
      fs: new MemFs(),
    });
    assert.throws(() => store.register(bad), /serialize but no deserialize/);
    store.dispose();
  });
});
