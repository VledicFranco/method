/**
 * Snapshot writer — debounced atomic writes of projection snapshots to disk.
 *
 * Each domain has an independent debounce timer. Calls to `schedule(domain, …)`
 * clear any pending timer for that domain and start a new one. When the timer
 * fires, the snapshot is written to `{path}.tmp` and then renamed to `{path}` —
 * an atomic replace on POSIX and modern Windows filesystems. Readers will
 * never observe a half-written file.
 *
 * Writes are async-sequenced per domain: if a write is in-flight when a new
 * schedule() call arrives, the newly scheduled write will begin after the
 * prior write resolves (whether success or error). This prevents interleaved
 * writes to the same path.
 *
 * @see .method/sessions/fcd-plan-20260405-1400-persistence-projections/realize-plan.md
 */

import type { FileSystemProvider } from '../../ports/file-system.js';
import type { ProjectionSnapshot } from '../persistence/types.js';

export interface SnapshotWriterOptions {
  fs: FileSystemProvider;
  /** Directory where `{domain}.json` snapshots live. Created on first write. */
  snapshotDir: string;
  /** Debounce window in ms. Default 500. */
  debounceMs?: number;
  /** Optional logger override — defaults to console.warn. */
  warn?: (message: string) => void;
}

export interface WriteCompletion {
  readonly domain: string;
  readonly cursor: number;
  readonly writtenAt: string;
}

/**
 * Debounced atomic snapshot writer. One instance per ProjectionStore.
 *
 * Usage:
 *   writer.schedule(snapshot, onComplete) — schedule a write after debounceMs
 *   writer.flush()                        — force-write all pending snapshots now
 *   writer.dispose()                      — cancel pending timers (no writes)
 */
export class SnapshotWriter {
  private readonly fs: FileSystemProvider;
  private readonly snapshotDir: string;
  private readonly debounceMs: number;
  private readonly warn: (message: string) => void;

  private readonly timers = new Map<string, NodeJS.Timeout>();
  private readonly pending = new Map<string, ProjectionSnapshot>();
  private readonly callbacks = new Map<string, (result: WriteCompletion) => void>();
  /** Chains per-domain writes so we never have two in-flight for one file. */
  private readonly chains = new Map<string, Promise<void>>();

  private dirEnsured = false;
  private disposed = false;

  constructor(options: SnapshotWriterOptions) {
    this.fs = options.fs;
    this.snapshotDir = options.snapshotDir;
    this.debounceMs = options.debounceMs ?? 500;
    this.warn = options.warn ?? ((msg: string) => console.warn(msg));
  }

  /**
   * Schedule an atomic snapshot write for the given domain. If a write was
   * already pending for this domain, its timer is reset and the newer snapshot
   * replaces the older one.
   */
  schedule(
    snapshot: ProjectionSnapshot,
    onComplete?: (result: WriteCompletion) => void,
  ): void {
    if (this.disposed) return;

    const { domain } = snapshot;
    const existing = this.timers.get(domain);
    if (existing) clearTimeout(existing);

    this.pending.set(domain, snapshot);
    if (onComplete) this.callbacks.set(domain, onComplete);

    const timer = setTimeout(() => {
      void this.doWrite(domain);
    }, this.debounceMs);

    // Prevent the Node event loop from being held open just for snapshot timers.
    if (typeof timer.unref === 'function') timer.unref();

    this.timers.set(domain, timer);
  }

  /**
   * Force-write all pending snapshots immediately. Awaits completion.
   */
  async flush(): Promise<void> {
    const domains = Array.from(this.pending.keys());
    for (const domain of domains) {
      const timer = this.timers.get(domain);
      if (timer) {
        clearTimeout(timer);
        this.timers.delete(domain);
      }
    }
    await Promise.all(domains.map((d) => this.doWrite(d)));
    // Also await any chains that were already mid-flight.
    await Promise.all(Array.from(this.chains.values()));
  }

  /**
   * Cancel all pending writes and prevent new ones.
   */
  dispose(): void {
    this.disposed = true;
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
    this.pending.clear();
    this.callbacks.clear();
  }

  /** True if the writer has a timer armed for this domain. */
  hasPending(domain: string): boolean {
    return this.timers.has(domain) || this.pending.has(domain);
  }

  // ── Internal ──────────────────────────────────────────────────

  private async ensureDir(): Promise<void> {
    if (this.dirEnsured) return;
    await this.fs.mkdir(this.snapshotDir, { recursive: true });
    this.dirEnsured = true;
  }

  private async doWrite(domain: string): Promise<void> {
    if (this.disposed) return;

    // Pop pending snapshot + callback atomically.
    const snapshot = this.pending.get(domain);
    if (!snapshot) return;
    this.pending.delete(domain);
    this.timers.delete(domain);
    const callback = this.callbacks.get(domain);
    this.callbacks.delete(domain);

    // Chain this write after any prior in-flight write for the same domain.
    const prior = this.chains.get(domain) ?? Promise.resolve();
    const next = prior
      .catch(() => undefined) // prior errors already logged
      .then(() => this.performAtomicWrite(snapshot, callback));
    this.chains.set(domain, next);

    try {
      await next;
    } finally {
      // If the chain we stored is still the latest, clear it.
      if (this.chains.get(domain) === next) this.chains.delete(domain);
    }
  }

  private async performAtomicWrite(
    snapshot: ProjectionSnapshot,
    callback: ((result: WriteCompletion) => void) | undefined,
  ): Promise<void> {
    const finalPath = joinPath(this.snapshotDir, `${snapshot.domain}.json`);
    const tmpPath = `${finalPath}.tmp`;

    try {
      await this.ensureDir();
      const serialized = JSON.stringify(snapshot);
      await this.fs.writeFile(tmpPath, serialized, 'utf8');
      this.fs.renameSync(tmpPath, finalPath);
    } catch (err) {
      this.warn(
        `[projection-store] failed to write snapshot for domain '${snapshot.domain}' ` +
          `to ${finalPath}: ${(err as Error).message}`,
      );
      // Attempt to clean up the tmp file — best effort.
      try {
        if (this.fs.existsSync(tmpPath)) this.fs.unlinkSync(tmpPath);
      } catch {
        /* ignore */
      }
      return;
    }

    if (callback) {
      try {
        callback({
          domain: snapshot.domain,
          cursor: snapshot.cursor,
          writtenAt: snapshot.writtenAt,
        });
      } catch (err) {
        this.warn(
          `[projection-store] snapshot onComplete callback for '${snapshot.domain}' threw: ` +
            `${(err as Error).message}`,
        );
      }
    }
  }
}

// ── Path helper (no node:path import — keep the module tiny + port-only) ──

function joinPath(dir: string, file: string): string {
  if (dir.length === 0) return file;
  const last = dir.charAt(dir.length - 1);
  if (last === '/' || last === '\\') return `${dir}${file}`;
  // Preserve the caller's path style: if the directory uses backslashes, keep them.
  const sep = dir.includes('\\') && !dir.includes('/') ? '\\' : '/';
  return `${dir}${sep}${file}`;
}
