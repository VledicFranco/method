/**
 * Unit tests for PersistenceSink (PRD 026 Phase 3).
 * Uses in-memory FileSystemProvider mock — no real I/O.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { PersistenceSink } from './persistence-sink.js';
import type { BridgeEvent } from '../../ports/event-bus.js';
import type { FileSystemProvider, FileStat } from '../../ports/file-system.js';

// ── In-memory FileSystem mock ──────────────────────────────────

function createMemoryFs(): FileSystemProvider & { files: Map<string, string> } {
  const files = new Map<string, string>();
  const dirs = new Set<string>();

  const norm = (p: string) => p.replace(/\\/g, '/');

  return {
    files,
    readFileSync(path: string, _encoding: BufferEncoding): string {
      const content = files.get(norm(path));
      if (content === undefined) throw new Error(`ENOENT: no such file: ${path}`);
      return content;
    },
    writeFileSync(path: string, content: string): void {
      files.set(norm(path), content);
    },
    existsSync(path: string): boolean {
      return files.has(norm(path)) || dirs.has(norm(path));
    },
    readdirSync(_path: string, _options?: { withFileTypes: true }): any {
      return [];
    },
    statSync(_path: string): FileStat {
      return { mtimeMs: 0, mtime: new Date(), size: 0, isFile: () => true, isDirectory: () => false };
    },
    unlinkSync(path: string): void {
      files.delete(norm(path));
    },
    mkdirSync(path: string): void {
      dirs.add(norm(path));
    },
    renameSync(oldPath: string, newPath: string): void {
      const content = files.get(norm(oldPath));
      if (content !== undefined) {
        files.set(norm(newPath), content);
        files.delete(norm(oldPath));
      }
    },
    realpathSync(path: string): string {
      return path;
    },
    async readFile(path: string, encoding: BufferEncoding): Promise<string> {
      return this.readFileSync(path, encoding);
    },
    async writeFile(path: string, content: string): Promise<void> {
      this.writeFileSync(path, content);
    },
    async appendFile(path: string, content: string): Promise<void> {
      const existing = files.get(norm(path)) ?? '';
      files.set(norm(path), existing + content);
    },
    async readdir(path: string): Promise<string[]> {
      return this.readdirSync(path) as string[];
    },
    async stat(path: string): Promise<FileStat> {
      return this.statSync(path);
    },
    async access(): Promise<void> {},
    async mkdir(path: string, opts?: { recursive?: boolean }): Promise<void> {
      this.mkdirSync(path, opts);
    },
  };
}

// ── Test helpers ───────────────────────────────────────────────

function makeEvent(seq: number, overrides: Partial<BridgeEvent> = {}): BridgeEvent {
  return {
    id: `evt-${seq}`,
    version: 1,
    timestamp: new Date().toISOString(),
    sequence: seq,
    domain: 'session',
    type: 'session.spawned',
    severity: 'info',
    payload: { test: true },
    source: 'test',
    ...overrides,
  };
}

// ── Tests ──────────────────────────────────────────────────────

describe('PersistenceSink', () => {
  let fs: ReturnType<typeof createMemoryFs>;
  let sink: PersistenceSink;
  const logPath = '.method/events.jsonl';
  const cursorsPath = '.method/events-cursors.json';

  beforeEach(async () => {
    fs = createMemoryFs();
    sink = new PersistenceSink({
      fs,
      logPath,
      cursorsPath,
      flushIntervalMs: 50, // fast for testing
      flushBatchSize: 3,
    });
    await sink.init();
  });

  describe('onEvent + flush', () => {
    it('buffers events and flushes at batch size', async () => {
      sink.onEvent(makeEvent(1));
      sink.onEvent(makeEvent(2));

      // Not yet flushed (batch size is 3)
      assert.equal(fs.files.has(logPath), false);

      sink.onEvent(makeEvent(3));

      // Allow async flush to complete
      await new Promise(r => setTimeout(r, 20));

      const content = fs.files.get(logPath)!;
      assert.ok(content, 'JSONL file should exist after flush');

      const lines = content.trim().split('\n');
      assert.equal(lines.length, 3, 'should have 3 JSON lines');

      const parsed = JSON.parse(lines[0]);
      assert.equal(parsed.id, 'evt-1');
    });

    it('flushes on timer when batch size not reached', async () => {
      sink.onEvent(makeEvent(1));

      // Wait for timer flush (50ms configured)
      await new Promise(r => setTimeout(r, 100));

      const content = fs.files.get(logPath)!;
      assert.ok(content);

      const lines = content.trim().split('\n');
      assert.equal(lines.length, 1);
    });

    it('appends to existing JSONL file', async () => {
      fs.files.set(logPath, '{"id":"old","version":1,"sequence":0}\n');

      sink.onEvent(makeEvent(1));
      await sink.flush();

      const content = fs.files.get(logPath)!;
      const lines = content.trim().split('\n');
      assert.equal(lines.length, 2, 'should append, not overwrite');
      assert.ok(lines[0].includes('"old"'));
      assert.ok(lines[1].includes('"evt-1"'));
    });
  });

  describe('cursor recovery', () => {
    it('skips events at or below last cursor', async () => {
      // Simulate prior cursor state
      fs.files.set(cursorsPath, JSON.stringify({ persistence: 5 }));

      const sinkWithCursor = new PersistenceSink({
        fs,
        logPath,
        cursorsPath,
        flushBatchSize: 1,
      });
      await sinkWithCursor.init();

      // Events 1-5 should be skipped
      sinkWithCursor.onEvent(makeEvent(3));
      sinkWithCursor.onEvent(makeEvent(5));
      await new Promise(r => setTimeout(r, 20));

      assert.equal(fs.files.has(logPath), false, 'no events should be written');

      // Event 6 should be persisted
      sinkWithCursor.onEvent(makeEvent(6));
      await new Promise(r => setTimeout(r, 20));

      const content = fs.files.get(logPath)!;
      assert.ok(content.includes('"evt-6"'));
    });

    it('saves cursor after flush', async () => {
      sink.onEvent(makeEvent(1));
      sink.onEvent(makeEvent(2));
      sink.onEvent(makeEvent(3));
      await new Promise(r => setTimeout(r, 20));

      const cursors = JSON.parse(fs.files.get(cursorsPath)!);
      assert.equal(cursors.persistence, 3);
    });

    it('returns empty cursors when file missing', async () => {
      const cursors = await sink.loadCursors();
      assert.deepEqual(cursors, {});
    });
  });

  describe('replay', () => {
    it('reads events from JSONL file', async () => {
      const events = [makeEvent(1), makeEvent(2), makeEvent(3)];
      fs.files.set(logPath, events.map(e => JSON.stringify(e)).join('\n') + '\n');

      const replayed = await sink.replay();
      assert.equal(replayed.length, 3);
      assert.equal(replayed[0].id, 'evt-1');
      assert.equal(replayed[2].id, 'evt-3');
    });

    it('filters by replay window', async () => {
      const oldEvent = makeEvent(1, {
        timestamp: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(), // 48h ago
      });
      const recentEvent = makeEvent(2, {
        timestamp: new Date().toISOString(),
      });

      fs.files.set(logPath, [oldEvent, recentEvent].map(e => JSON.stringify(e)).join('\n') + '\n');

      const replayed = await sink.replay();
      assert.equal(replayed.length, 1, 'only recent event within 24h window');
      assert.equal(replayed[0].id, 'evt-2');
    });

    it('skips corrupt JSONL lines gracefully', async () => {
      const goodEvent = makeEvent(1);
      fs.files.set(logPath, `${JSON.stringify(goodEvent)}\n{corrupt json\n${JSON.stringify(makeEvent(2))}\n`);

      const replayed = await sink.replay();
      assert.equal(replayed.length, 2, 'should skip corrupt line and parse the rest');
    });

    it('returns empty array when file missing', async () => {
      const replayed = await sink.replay();
      assert.deepEqual(replayed, []);
    });

    it('returns empty array for empty file', async () => {
      fs.files.set(logPath, '');
      const replayed = await sink.replay();
      assert.deepEqual(replayed, []);
    });
  });

  describe('readEventsSince', () => {
    it('returns events with sequence > sinceSeq', async () => {
      const events = [makeEvent(1), makeEvent(2), makeEvent(3), makeEvent(4), makeEvent(5)];
      fs.files.set(logPath, events.map(e => JSON.stringify(e)).join('\n') + '\n');

      const result = await sink.readEventsSince(2);
      assert.equal(result.length, 3, 'should return events 3, 4, 5');
      assert.deepEqual(result.map(e => e.sequence), [3, 4, 5]);
    });

    it('returns empty array when sinceSeq >= max sequence', async () => {
      const events = [makeEvent(1), makeEvent(2), makeEvent(3)];
      fs.files.set(logPath, events.map(e => JSON.stringify(e)).join('\n') + '\n');

      const result = await sink.readEventsSince(99);
      assert.deepEqual(result, []);
    });

    it('returns empty array when log file missing', async () => {
      const result = await sink.readEventsSince(0);
      assert.deepEqual(result, []);
    });

    it('skips corrupt JSONL lines gracefully', async () => {
      const goodEvent1 = makeEvent(1);
      const goodEvent2 = makeEvent(2);
      fs.files.set(
        logPath,
        `${JSON.stringify(goodEvent1)}\n{this is not valid json\n${JSON.stringify(goodEvent2)}\n`,
      );

      const result = await sink.readEventsSince(0);
      assert.equal(result.length, 2, 'should skip corrupt line and return the rest');
      assert.deepEqual(result.map(e => e.sequence), [1, 2]);
    });

    it('returns events in append (monotonic) order', async () => {
      const events = [makeEvent(1), makeEvent(2), makeEvent(3), makeEvent(4), makeEvent(5)];
      fs.files.set(logPath, events.map(e => JSON.stringify(e)).join('\n') + '\n');

      const result = await sink.readEventsSince(0);
      assert.equal(result.length, 5);
      for (let i = 1; i < result.length; i++) {
        assert.ok(
          result[i].sequence > result[i - 1].sequence,
          'sequences should be monotonically increasing',
        );
      }
    });

    it('sinceSeq=0 returns all events', async () => {
      const events = [makeEvent(1), makeEvent(2), makeEvent(3)];
      fs.files.set(logPath, events.map(e => JSON.stringify(e)).join('\n') + '\n');

      const result = await sink.readEventsSince(0);
      assert.equal(result.length, 3);
      assert.deepEqual(result.map(e => e.sequence), [1, 2, 3]);
    });

    it('returns empty array for empty file', async () => {
      fs.files.set(logPath, '');
      const result = await sink.readEventsSince(0);
      assert.deepEqual(result, []);
    });

    it('ignores replay window (returns old events outside 24h)', async () => {
      // readEventsSince uses cursor filter, NOT time window — so old events should be included.
      const oldEvent = makeEvent(1, {
        timestamp: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(),
      });
      const recentEvent = makeEvent(2, {
        timestamp: new Date().toISOString(),
      });
      fs.files.set(logPath, [oldEvent, recentEvent].map(e => JSON.stringify(e)).join('\n') + '\n');

      const result = await sink.readEventsSince(0);
      assert.equal(result.length, 2, 'cursor-based replay should not filter by time');
    });
  });

  describe('flush failure', () => {
    it('emits overflow callback on write error', async () => {
      const overflows: string[] = [];
      sink.setOverflowCallback(msg => overflows.push(msg));

      // Make appendFile throw
      fs.appendFile = async () => { throw new Error('disk full'); };

      sink.onEvent(makeEvent(1));
      sink.onEvent(makeEvent(2));
      sink.onEvent(makeEvent(3));

      // Wait for flush attempt
      await new Promise(r => setTimeout(r, 20));

      assert.equal(overflows.length, 1);
      assert.ok(overflows[0].includes('disk full'));
    });

    it('retains events in buffer after flush failure', async () => {
      // Make appendFile throw once, then succeed
      let callCount = 0;
      const originalAppend = fs.appendFile.bind(fs);
      fs.appendFile = async (path: string, content: string, encoding: BufferEncoding) => {
        callCount++;
        if (callCount === 1) throw new Error('transient');
        return originalAppend(path, content, encoding);
      };

      sink.onEvent(makeEvent(1));
      sink.onEvent(makeEvent(2));
      sink.onEvent(makeEvent(3));
      await new Promise(r => setTimeout(r, 20));

      // Events should still be in buffer after first failure
      // Trigger another flush
      await sink.flush();

      const content = fs.files.get(logPath);
      assert.ok(content, 'events should be written on retry');
      assert.equal(content!.trim().split('\n').length, 3);
    });
  });

  describe('dispose', () => {
    it('flushes remaining buffer on dispose', async () => {
      sink.onEvent(makeEvent(1));
      // Don't wait for timer — dispose should flush immediately
      await sink.dispose();

      const content = fs.files.get(logPath)!;
      assert.ok(content);
      assert.equal(content.trim().split('\n').length, 1);
    });
  });
});
