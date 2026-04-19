// SPDX-License-Identifier: Apache-2.0
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SnapshotWriter } from './snapshot-writer.js';
import type { ProjectionSnapshot } from './types.js';
import type {
  FileSystemProvider,
  FileStat,
  DirEntry,
} from '../../ports/file-system.js';

// ── In-memory FileSystemProvider for tests ──────────────────────

interface MemFsOptions {
  /** If set, writeFile will throw the first N times it's called. */
  writeFailures?: number;
  /** Track the order of operations for atomicity checks. */
  traceOps?: boolean;
}

class MemFs implements FileSystemProvider {
  readonly files = new Map<string, string>();
  readonly dirs = new Set<string>();
  readonly ops: string[] = [];
  writeFailures: number;
  traceOps: boolean;

  constructor(options: MemFsOptions = {}) {
    this.writeFailures = options.writeFailures ?? 0;
    this.traceOps = options.traceOps ?? false;
  }

  readFileSync(path: string): string {
    const c = this.files.get(path);
    if (c === undefined) throw new Error(`ENOENT: ${path}`);
    return c;
  }
  writeFileSync(path: string, content: string): void {
    this.files.set(path, content);
  }
  existsSync(path: string): boolean {
    return this.files.has(path) || this.dirs.has(path);
  }
  readdirSync(_path: string): string[];
  readdirSync(_path: string, options: { withFileTypes: true }): DirEntry[];
  readdirSync(_path: string, options?: { withFileTypes: true }): string[] | DirEntry[] {
    return options?.withFileTypes ? ([] as DirEntry[]) : ([] as string[]);
  }
  statSync(_path: string): FileStat { throw new Error('nyi'); }
  unlinkSync(path: string): void {
    if (this.traceOps) this.ops.push(`unlink:${path}`);
    this.files.delete(path);
  }
  mkdirSync(path: string): void { this.dirs.add(path); }
  renameSync(oldPath: string, newPath: string): void {
    if (this.traceOps) this.ops.push(`rename:${oldPath}->${newPath}`);
    const content = this.files.get(oldPath);
    if (content === undefined) throw new Error(`ENOENT rename source: ${oldPath}`);
    this.files.set(newPath, content);
    this.files.delete(oldPath);
  }
  realpathSync(p: string): string { return p; }

  async readFile(path: string): Promise<string> {
    const c = this.files.get(path);
    if (c === undefined) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    return c;
  }
  async writeFile(path: string, content: string): Promise<void> {
    if (this.writeFailures > 0) {
      this.writeFailures--;
      throw new Error('simulated disk failure');
    }
    if (this.traceOps) this.ops.push(`writeFile:${path}`);
    this.files.set(path, content);
  }
  async appendFile(path: string, content: string): Promise<void> {
    this.files.set(path, (this.files.get(path) ?? '') + content);
  }
  async readdir(_path: string): Promise<string[]> { return []; }
  async stat(_path: string): Promise<FileStat> { throw new Error('nyi'); }
  async access(path: string): Promise<void> {
    if (!this.files.has(path)) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
  }
  async mkdir(path: string): Promise<void> {
    if (this.traceOps) this.ops.push(`mkdir:${path}`);
    this.dirs.add(path);
  }
}

// ── Helpers ─────────────────────────────────────────────────────

const makeSnapshot = (domain: string, cursor: number): ProjectionSnapshot => ({
  version: 1,
  domain,
  cursor,
  eventCount: cursor,
  writtenAt: new Date(2026, 0, 1, 0, 0, cursor).toISOString(),
  state: JSON.stringify({ value: cursor }),
});

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ── Tests ───────────────────────────────────────────────────────

describe('SnapshotWriter — debounced atomic writes', () => {
  it('debounces writes: rapid schedule() calls collapse to a single write', async () => {
    const fs = new MemFs();
    const writer = new SnapshotWriter({ fs, snapshotDir: '/snap', debounceMs: 30 });

    let completions = 0;
    for (let i = 1; i <= 5; i++) {
      writer.schedule(makeSnapshot('alpha', i), () => completions++);
    }

    // Before the debounce expires, no write yet.
    assert.equal(fs.files.has('/snap/alpha.json'), false);

    await wait(80);

    assert.equal(completions, 1, 'expected exactly one debounced completion');
    const stored = fs.files.get('/snap/alpha.json');
    assert.ok(stored);
    const parsed = JSON.parse(stored!) as ProjectionSnapshot;
    assert.equal(parsed.cursor, 5, 'latest scheduled snapshot should win');
    writer.dispose();
  });

  it('uses tmp + rename for atomicity: never leaves a partial final file', async () => {
    const fs = new MemFs({ traceOps: true });
    const writer = new SnapshotWriter({ fs, snapshotDir: '/snap', debounceMs: 10 });

    writer.schedule(makeSnapshot('beta', 42));
    await wait(50);

    // Final file must exist, tmp file must have been cleaned up by the rename.
    assert.equal(fs.files.has('/snap/beta.json'), true);
    assert.equal(fs.files.has('/snap/beta.json.tmp'), false);

    // Verify the op order: writeFile to tmp, then rename to final.
    const writeIdx = fs.ops.findIndex((op) => op === 'writeFile:/snap/beta.json.tmp');
    const renameIdx = fs.ops.findIndex((op) => op === 'rename:/snap/beta.json.tmp->/snap/beta.json');
    assert.notEqual(writeIdx, -1, 'expected a writeFile to tmp path');
    assert.notEqual(renameIdx, -1, 'expected a rename from tmp to final');
    assert.ok(writeIdx < renameIdx, 'writeFile must happen before rename');
    writer.dispose();
  });

  it('creates the snapshot dir on first write (recursive mkdir)', async () => {
    const fs = new MemFs({ traceOps: true });
    const writer = new SnapshotWriter({ fs, snapshotDir: '/nested/snap', debounceMs: 10 });

    writer.schedule(makeSnapshot('gamma', 1));
    await wait(40);

    assert.equal(fs.dirs.has('/nested/snap'), true);
    const mkdirOps = fs.ops.filter((op) => op.startsWith('mkdir:'));
    assert.ok(mkdirOps.length >= 1);
    writer.dispose();
  });

  it('schedules per-domain independently (two domains → two files)', async () => {
    const fs = new MemFs();
    const writer = new SnapshotWriter({ fs, snapshotDir: '/snap', debounceMs: 10 });

    writer.schedule(makeSnapshot('d1', 10));
    writer.schedule(makeSnapshot('d2', 20));

    await wait(40);

    assert.equal(fs.files.has('/snap/d1.json'), true);
    assert.equal(fs.files.has('/snap/d2.json'), true);

    const s1 = JSON.parse(fs.files.get('/snap/d1.json')!) as ProjectionSnapshot;
    const s2 = JSON.parse(fs.files.get('/snap/d2.json')!) as ProjectionSnapshot;
    assert.equal(s1.cursor, 10);
    assert.equal(s2.cursor, 20);
    writer.dispose();
  });

  it('flush() forces all pending writes immediately', async () => {
    const fs = new MemFs();
    const writer = new SnapshotWriter({ fs, snapshotDir: '/snap', debounceMs: 10_000 });

    writer.schedule(makeSnapshot('d1', 1));
    writer.schedule(makeSnapshot('d2', 2));

    // Without flush, nothing would happen for 10s.
    assert.equal(fs.files.has('/snap/d1.json'), false);

    await writer.flush();

    assert.equal(fs.files.has('/snap/d1.json'), true);
    assert.equal(fs.files.has('/snap/d2.json'), true);
    writer.dispose();
  });

  it('dispose() cancels pending writes (no side effects)', async () => {
    const fs = new MemFs();
    const writer = new SnapshotWriter({ fs, snapshotDir: '/snap', debounceMs: 30 });

    writer.schedule(makeSnapshot('d1', 1));
    writer.dispose();

    await wait(80);

    assert.equal(fs.files.has('/snap/d1.json'), false);
    // After dispose, schedule() is a no-op.
    writer.schedule(makeSnapshot('d1', 2));
    await wait(60);
    assert.equal(fs.files.has('/snap/d1.json'), false);
  });

  it('write failures are logged, callback not fired, tmp is cleaned up', async () => {
    const fs = new MemFs({ writeFailures: 1 });
    const warnings: string[] = [];
    const writer = new SnapshotWriter({
      fs,
      snapshotDir: '/snap',
      debounceMs: 10,
      warn: (m) => warnings.push(m),
    });

    let completions = 0;
    writer.schedule(makeSnapshot('d1', 1), () => completions++);
    await wait(50);

    assert.equal(completions, 0, 'callback must not fire on failed write');
    assert.equal(fs.files.has('/snap/d1.json'), false);
    assert.ok(warnings.some((w) => w.includes("failed to write snapshot for domain 'd1'")));
    writer.dispose();
  });

  it('onComplete callback receives cursor + writtenAt from the snapshot', async () => {
    const fs = new MemFs();
    const writer = new SnapshotWriter({ fs, snapshotDir: '/snap', debounceMs: 10 });

    const snap = makeSnapshot('d1', 77);
    const seen: Array<{ domain: string; cursor: number; writtenAt: string }> = [];
    writer.schedule(snap, (result) => seen.push(result));

    await wait(40);

    assert.equal(seen.length, 1);
    assert.equal(seen[0].domain, 'd1');
    assert.equal(seen[0].cursor, 77);
    assert.equal(seen[0].writtenAt, snap.writtenAt);
    writer.dispose();
  });

  it('hasPending reflects armed state', async () => {
    const fs = new MemFs();
    const writer = new SnapshotWriter({ fs, snapshotDir: '/snap', debounceMs: 30 });

    assert.equal(writer.hasPending('d1'), false);
    writer.schedule(makeSnapshot('d1', 1));
    assert.equal(writer.hasPending('d1'), true);

    await wait(70);
    assert.equal(writer.hasPending('d1'), false);
    writer.dispose();
  });
});
