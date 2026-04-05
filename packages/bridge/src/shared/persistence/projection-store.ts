/**
 * ProjectionStoreImpl — runtime for projection-based state persistence.
 *
 * Manages the lifecycle of registered projections:
 *   1. register()  — add a Projection<S> before start()
 *   2. start()     — load snapshot, replay events from its cursor, subscribe to live events
 *   3. onEvent()   — EventSink hook: apply live events to each projection, debounce-write snapshots
 *   4. get()       — consumers read current in-memory state
 *   5. maxSafeCutoff() — lowest persisted cursor, for EventRotator safety
 *
 * @see .method/sessions/fcd-plan-20260405-1400-persistence-projections/realize-plan.md
 * @see packages/bridge/src/ports/projection-store.ts (frozen port interface)
 */

import type {
  BridgeEvent,
  EventBus,
  EventSink,
} from '../../ports/event-bus.js';
import type { EventReader } from '../../ports/event-reader.js';
import type { FileSystemProvider } from '../../ports/file-system.js';
import type { Projection } from '../../ports/projection.js';
import type {
  ProjectionStore,
  StartResult,
} from '../../ports/projection-store.js';
import type { ProjectionSnapshot } from '../persistence/types.js';
import { loadSnapshot } from './snapshot-loader.js';
import { SnapshotWriter } from './snapshot-writer.js';

export interface ProjectionStoreImplOptions {
  eventReader: EventReader;
  eventBus: EventBus;
  fs: FileSystemProvider;
  /** Directory for snapshots. Default: '.method/projections' */
  snapshotDir?: string;
  /** Debounce ms for snapshot writes. Default: 500. */
  snapshotDebounceMs?: number;
  /** Optional logger override — defaults to console.warn. */
  warn?: (message: string) => void;
}

const DEFAULT_SNAPSHOT_DIR = '.method/projections';
const DEFAULT_DEBOUNCE_MS = 500;
const DEFAULT_SNAPSHOT_EVERY_N = 100;

/**
 * Per-projection runtime — wraps a Projection<S> with its live state, cursor,
 * and the bookkeeping needed to decide when to take a snapshot.
 */
interface ProjectionRuntime<S = unknown> {
  readonly projection: Projection<S>;
  readonly snapshotEveryN: number;
  /** Current in-memory state. */
  state: S;
  /** Highest event.sequence reduced into state (in-memory, may outrun disk). */
  cursor: number;
  /** Total successful reduces, lifetime. */
  eventCount: number;
  /** eventCount at the time the last schedule()d snapshot was requested. */
  lastScheduledAtEventCount: number;
  /** cursor value last persisted to disk (null if never snapshotted). */
  lastSnapshotCursor: number | null;
}

export class ProjectionStoreImpl implements ProjectionStore, EventSink {
  readonly name = 'projection-store';

  private readonly eventReader: EventReader;
  private readonly eventBus: EventBus;
  private readonly fs: FileSystemProvider;
  private readonly snapshotDir: string;
  private readonly warn: (message: string) => void;
  private readonly writer: SnapshotWriter;

  private readonly runtimes = new Map<string, ProjectionRuntime<unknown>>();
  private started = false;
  private starting = false;

  constructor(options: ProjectionStoreImplOptions) {
    this.eventReader = options.eventReader;
    this.eventBus = options.eventBus;
    this.fs = options.fs;
    this.snapshotDir = options.snapshotDir ?? DEFAULT_SNAPSHOT_DIR;
    this.warn = options.warn ?? ((msg: string) => console.warn(msg));
    this.writer = new SnapshotWriter({
      fs: this.fs,
      snapshotDir: this.snapshotDir,
      debounceMs: options.snapshotDebounceMs ?? DEFAULT_DEBOUNCE_MS,
      warn: this.warn,
    });
  }

  // ── ProjectionStore port surface ──────────────────────────────

  register<S>(projection: Projection<S>): void {
    if (this.started || this.starting) {
      throw new Error(
        `[projection-store] cannot register '${projection.domain}' after start() — ` +
          `registration must happen at composition root before the bridge warms up.`,
      );
    }
    if (this.runtimes.has(projection.domain)) {
      throw new Error(
        `[projection-store] domain '${projection.domain}' is already registered`,
      );
    }

    // Sanity: if serialize is set, deserialize must also be present.
    if (projection.serialize && !projection.deserialize) {
      throw new Error(
        `[projection-store] projection '${projection.domain}' has serialize but no deserialize`,
      );
    }

    const runtime: ProjectionRuntime<S> = {
      projection,
      snapshotEveryN: projection.snapshotEveryN ?? DEFAULT_SNAPSHOT_EVERY_N,
      state: projection.initialState(),
      cursor: 0,
      eventCount: 0,
      lastScheduledAtEventCount: 0,
      lastSnapshotCursor: null,
    };
    this.runtimes.set(projection.domain, runtime as ProjectionRuntime<unknown>);
  }

  async start(): Promise<StartResult> {
    if (this.started) {
      return {
        projectionsLoaded: this.runtimes.size,
        snapshotsRestored: 0,
        eventsReplayed: 0,
        skippedEvents: 0,
        durationMs: 0,
      };
    }
    this.starting = true;
    const startTime = Date.now();

    let snapshotsRestored = 0;
    let eventsReplayed = 0;
    let skippedEvents = 0;

    for (const runtime of this.runtimes.values()) {
      const restored = await this.tryRestoreSnapshot(runtime);
      if (restored) snapshotsRestored++;

      const replay = await this.replayFrom(runtime, runtime.cursor);
      eventsReplayed += replay.applied;
      skippedEvents += replay.skipped;
    }

    // Subscribe to live events. From now on, onEvent() is authoritative.
    this.eventBus.registerSink(this);

    this.started = true;
    this.starting = false;

    return {
      projectionsLoaded: this.runtimes.size,
      snapshotsRestored,
      eventsReplayed,
      skippedEvents,
      durationMs: Date.now() - startTime,
    };
  }

  get<S>(domain: string): S | null {
    if (!this.started) return null;
    const runtime = this.runtimes.get(domain);
    if (!runtime) return null;
    return runtime.state as S;
  }

  maxSafeCutoff(): number | null {
    if (this.runtimes.size === 0) return null;

    let min: number | null = null;
    for (const runtime of this.runtimes.values()) {
      // If the projection doesn't snapshot (replay-only), it holds no safe cursor —
      // archiving events would strand replay-only projections on their next boot.
      if (!runtime.projection.serialize) return null;
      if (runtime.lastSnapshotCursor === null) return null;
      if (min === null || runtime.lastSnapshotCursor < min) {
        min = runtime.lastSnapshotCursor;
      }
    }
    return min;
  }

  // ── EventSink hook — live event dispatch ──────────────────────

  onEvent(event: BridgeEvent): void {
    if (!this.started) return;

    for (const runtime of this.runtimes.values()) {
      this.applyEvent(runtime, event, /* replay */ false);
    }
  }

  /**
   * Test/diagnostic hook — cancel pending snapshot timers. Should be called
   * when the bridge is shutting down so timers don't hold the event loop open
   * (though SnapshotWriter already unrefs its timers).
   */
  dispose(): void {
    this.writer.dispose();
  }

  /**
   * Test/diagnostic hook — force-write all pending snapshots to disk.
   */
  async flushSnapshots(): Promise<void> {
    await this.writer.flush();
  }

  // ── Internal ──────────────────────────────────────────────────

  private async tryRestoreSnapshot(runtime: ProjectionRuntime): Promise<boolean> {
    const projection = runtime.projection;
    // Replay-only projections have no snapshot file.
    if (!projection.deserialize) return false;

    const path = this.snapshotPath(projection.domain);
    let snapshot: ProjectionSnapshot | null;
    try {
      snapshot = await loadSnapshot({
        fs: this.fs,
        path,
        expectedDomain: projection.domain,
        warn: this.warn,
      });
    } catch (err) {
      this.warn(
        `[projection-store] unexpected error loading snapshot for '${projection.domain}': ` +
          `${(err as Error).message}. Starting from initialState.`,
      );
      return false;
    }

    if (!snapshot) return false;

    try {
      runtime.state = projection.deserialize(snapshot.state);
    } catch (err) {
      this.warn(
        `[projection-store] deserialize failed for '${projection.domain}': ` +
          `${(err as Error).message}. Starting from initialState.`,
      );
      runtime.state = projection.initialState();
      runtime.cursor = 0;
      runtime.eventCount = 0;
      return false;
    }

    runtime.cursor = snapshot.cursor;
    runtime.eventCount = snapshot.eventCount;
    runtime.lastScheduledAtEventCount = snapshot.eventCount;
    runtime.lastSnapshotCursor = snapshot.cursor;
    return true;
  }

  private async replayFrom(
    runtime: ProjectionRuntime,
    sinceSeq: number,
  ): Promise<{ applied: number; skipped: number }> {
    let events: BridgeEvent[];
    try {
      events = await this.eventReader.readEventsSince(sinceSeq);
    } catch (err) {
      this.warn(
        `[projection-store] readEventsSince failed for '${runtime.projection.domain}' ` +
          `from seq ${sinceSeq}: ${(err as Error).message}. Continuing with current state.`,
      );
      return { applied: 0, skipped: 0 };
    }

    let applied = 0;
    let skipped = 0;
    for (const event of events) {
      const result = this.applyEvent(runtime, event, /* replay */ true);
      if (result === 'applied') applied++;
      else if (result === 'skipped') skipped++;
    }
    return { applied, skipped };
  }

  /**
   * Apply a single event to a runtime. Shared by replay and live dispatch.
   * On reducer throw: logs, leaves state unchanged, counts as skipped.
   * Never schedules a snapshot during replay.
   */
  private applyEvent(
    runtime: ProjectionRuntime,
    event: BridgeEvent,
    replay: boolean,
  ): 'applied' | 'skipped' | 'stale' {
    // Events at or below cursor were already reduced — ignore.
    if (event.sequence <= runtime.cursor) return 'stale';

    let nextState: unknown;
    try {
      nextState = runtime.projection.reduce(runtime.state, event);
    } catch (err) {
      this.warn(
        `[projection-store] reducer for '${runtime.projection.domain}' threw on ` +
          `event ${event.sequence} (type=${event.type}): ${(err as Error).message}. ` +
          `State unchanged.`,
      );
      // Advance cursor past the poison event so we don't re-feed it on future replays.
      runtime.cursor = event.sequence;
      return 'skipped';
    }

    runtime.state = nextState;
    runtime.cursor = event.sequence;
    runtime.eventCount++;

    if (!replay) {
      this.maybeScheduleSnapshot(runtime);
    }
    return 'applied';
  }

  private maybeScheduleSnapshot(runtime: ProjectionRuntime): void {
    // Replay-only projections never write snapshots.
    if (!runtime.projection.serialize) return;

    const delta = runtime.eventCount - runtime.lastScheduledAtEventCount;
    if (delta < runtime.snapshotEveryN) return;

    // Build the snapshot payload now so the serialized state reflects *current* state,
    // even if more events arrive before the debounce fires.
    let serialized: string;
    try {
      serialized = runtime.projection.serialize(runtime.state);
    } catch (err) {
      this.warn(
        `[projection-store] serialize for '${runtime.projection.domain}' threw: ` +
          `${(err as Error).message}. Skipping snapshot.`,
      );
      // Don't reset lastScheduledAtEventCount — we'll try again on the next threshold.
      return;
    }

    const snapshot: ProjectionSnapshot = {
      version: 1,
      domain: runtime.projection.domain,
      cursor: runtime.cursor,
      eventCount: runtime.eventCount,
      writtenAt: new Date().toISOString(),
      state: serialized,
    };

    runtime.lastScheduledAtEventCount = runtime.eventCount;

    this.writer.schedule(snapshot, (result) => {
      // Once the write lands on disk, update the last-persisted cursor.
      runtime.lastSnapshotCursor = result.cursor;
    });
  }

  private snapshotPath(domain: string): string {
    const dir = this.snapshotDir;
    const sep = dir.includes('\\') && !dir.includes('/') ? '\\' : '/';
    const trailing = dir.charAt(dir.length - 1);
    const needsSep = trailing !== '/' && trailing !== '\\';
    return `${dir}${needsSep ? sep : ''}${domain}.json`;
  }
}
