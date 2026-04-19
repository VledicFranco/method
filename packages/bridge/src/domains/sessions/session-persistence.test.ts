// SPDX-License-Identifier: Apache-2.0
/**
 * WS-3: Unit tests for session persistence store.
 * Tests core logic paths: save, loadAll, loadById, markDead, cross-platform paths.
 * Uses in-memory FileSystemProvider mock (no real I/O). DR-14 compliance.
 */

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createSessionPersistenceStore, type PersistedSession } from './session-persistence.js';
import type { FileSystemProvider, DirEntry, FileStat } from '../../ports/file-system.js';

// ── In-memory FileSystem mock ──

function createMemoryFs(): FileSystemProvider {
  const files = new Map<string, string>();
  const dirs = new Set<string>();

  const norm = (p: string) => p.replace(/\\/g, '/');

  return {
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

function makeSession(overrides: Partial<PersistedSession> = {}): PersistedSession {
  return {
    session_id: 'test-' + Math.random().toString(36).slice(2, 8),
    workdir: '/project/alpha',
    nickname: 'alpha-1',
    purpose: 'Test session',
    mode: 'print',
    status: 'running',
    created_at: new Date().toISOString(),
    last_activity_at: new Date().toISOString(),
    prompt_count: 5,
    depth: 0,
    parent_session_id: null,
    isolation: 'shared',
    ...overrides,
  };
}

describe('SessionPersistenceStore', () => {
  let fs: FileSystemProvider;

  beforeEach(() => {
    fs = createMemoryFs();
  });

  it('saves and loads a session', async () => {
    const store = createSessionPersistenceStore('/base', fs);
    const session = makeSession({ session_id: 'abc-123' });

    await store.save(session);
    await store.flush();

    const loaded = await store.loadById('abc-123');
    assert.ok(loaded);
    assert.equal(loaded.session_id, 'abc-123');
    assert.equal(loaded.nickname, 'alpha-1');
    assert.equal(loaded.workdir, '/project/alpha');
  });

  it('filters sessions by workdir', async () => {
    const store = createSessionPersistenceStore('/base', fs);

    await store.save(makeSession({ session_id: 'a', workdir: '/project/alpha' }));
    await store.save(makeSession({ session_id: 'b', workdir: '/project/beta' }));
    await store.save(makeSession({ session_id: 'c', workdir: '/project/alpha' }));

    const alphaOnly = await store.loadAll('/project/alpha');
    assert.equal(alphaOnly.length, 2);
    assert.ok(alphaOnly.every((s) => s.workdir === '/project/alpha'));

    const all = await store.loadAll();
    assert.equal(all.length, 3);
  });

  it('marks a session as dead', async () => {
    const store = createSessionPersistenceStore('/base', fs);
    const session = makeSession({ session_id: 'xyz', status: 'running' });

    await store.save(session);
    await store.markDead('xyz');
    await store.flush();

    const loaded = await store.loadById('xyz');
    assert.ok(loaded);
    assert.equal(loaded.status, 'dead');
  });

  it('handles cross-platform path normalization (DR-06)', async () => {
    const store = createSessionPersistenceStore('/base', fs);

    await store.save(makeSession({
      session_id: 'win-path',
      workdir: 'C:\\Users\\dev\\project',
    }));

    // Query with forward slashes should match
    const results = await store.loadAll('C:/Users/dev/project');
    assert.equal(results.length, 1);
    assert.equal(results[0].session_id, 'win-path');
  });

  it('returns null for unknown session ID', async () => {
    const store = createSessionPersistenceStore('/base', fs);
    const result = await store.loadById('nonexistent');
    assert.equal(result, null);
  });

  it('persists to disk and recovers across instances', async () => {
    const store1 = createSessionPersistenceStore('/base', fs);
    await store1.save(makeSession({ session_id: 'persist-test', nickname: 'persisted' }));
    await store1.flush();

    // Create a new store instance (simulates bridge restart)
    const store2 = createSessionPersistenceStore('/base', fs);
    const loaded = await store2.loadById('persist-test');
    assert.ok(loaded);
    assert.equal(loaded.nickname, 'persisted');
  });

  it('stores large transcripts in separate files', async () => {
    const store = createSessionPersistenceStore('/base', fs);
    const longTranscript = 'x'.repeat(2000);

    await store.save(makeSession({
      session_id: 'transcript-test',
      transcript: longTranscript,
    }));
    await store.flush();

    const loaded = await store.loadById('transcript-test');
    assert.ok(loaded);
    assert.equal(loaded.transcript, longTranscript);
  });

  it('sorts results by last_activity_at descending', async () => {
    const store = createSessionPersistenceStore('/base', fs);
    const now = Date.now();

    await store.save(makeSession({
      session_id: 'old',
      last_activity_at: new Date(now - 60_000).toISOString(),
    }));
    await store.save(makeSession({
      session_id: 'new',
      last_activity_at: new Date(now).toISOString(),
    }));
    await store.save(makeSession({
      session_id: 'mid',
      last_activity_at: new Date(now - 30_000).toISOString(),
    }));

    const results = await store.loadAll();
    assert.equal(results[0].session_id, 'new');
    assert.equal(results[1].session_id, 'mid');
    assert.equal(results[2].session_id, 'old');
  });
});
