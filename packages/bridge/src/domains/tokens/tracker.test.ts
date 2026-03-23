import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createTokenTracker, deriveProjectDirName } from './tracker.js';
import { mkdirSync, rmSync, writeFileSync, readFileSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import os from 'node:os';

// ── Helpers ──────────────────────────────────────────────────────

const FIXTURE_PATH = join(import.meta.dirname!, '..', '..', '__tests__', 'fixtures', 'session.jsonl');

function makeTmpDir(): string {
  return join(os.tmpdir(), `token-tracker-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
}

function writeJsonlFile(dir: string, filename: string, lines: object[]): string {
  const filepath = join(dir, filename);
  writeFileSync(filepath, lines.map(l => JSON.stringify(l)).join('\n') + '\n', 'utf-8');
  return filepath;
}

// ── Tests ────────────────────────────────────────────────────────

describe('deriveProjectDirName (PRD 013)', () => {
  it('converts Windows absolute path', () => {
    // On Windows, resolve('C:\\Users\\user\\project') → C:\Users\user\project
    // → C--Users-user-project
    const result = deriveProjectDirName('C:\\Users\\user\\project');
    assert.equal(result, 'C--Users-user-project');
  });

  it('handles paths with trailing separators', () => {
    const withSlash = deriveProjectDirName('C:\\Users\\user\\project\\');
    const without = deriveProjectDirName('C:\\Users\\user\\project');
    assert.equal(withSlash, without);
  });

  it('produces consistent results for same path', () => {
    const a = deriveProjectDirName('C:\\Users\\test\\repo');
    const b = deriveProjectDirName('C:\\Users\\test\\repo');
    assert.equal(a, b);
  });
});

describe('TokenTracker (PRD 013)', () => {
  let tmpDir: string;
  let sessionsDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    sessionsDir = join(tmpDir, 'sessions');
    mkdirSync(sessionsDir, { recursive: true });
  });

  afterEach(() => {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best effort */ }
  });

  // ── Registration ──────────────────────────────────────────────

  describe('registerSession + getUsage', () => {
    it('returns null for unregistered session', () => {
      const tracker = createTokenTracker({ sessionsDir });
      assert.equal(tracker.getUsage('nonexistent'), null);
    });

    it('returns null cached value before refreshUsage', () => {
      const tracker = createTokenTracker({ sessionsDir });
      tracker.registerSession('sess-1', 'C:\\Users\\test\\project', new Date());
      assert.equal(tracker.getUsage('sess-1'), null);
    });
  });

  // ── Aggregate ─────────────────────────────────────────────────

  describe('getAggregate', () => {
    it('returns zeroes when no sessions registered', () => {
      const tracker = createTokenTracker({ sessionsDir });
      const agg = tracker.getAggregate();
      assert.equal(agg.totalTokens, 0);
      assert.equal(agg.inputTokens, 0);
      assert.equal(agg.outputTokens, 0);
      assert.equal(agg.cacheReadTokens, 0);
      assert.equal(agg.cacheWriteTokens, 0);
      assert.equal(agg.cacheHitRate, 0);
      assert.equal(agg.sessionCount, 0);
    });

    it('returns zeroes when sessions have no cached usage', () => {
      const tracker = createTokenTracker({ sessionsDir });
      tracker.registerSession('s1', 'C:\\Users\\test\\a', new Date());
      tracker.registerSession('s2', 'C:\\Users\\test\\b', new Date());
      const agg = tracker.getAggregate();
      assert.equal(agg.sessionCount, 0); // no cached data yet
      assert.equal(agg.totalTokens, 0);
    });

    it('aggregates usage across multiple sessions', () => {
      // Set up two workdirs with JSONL data
      const workdir1 = join(tmpDir, 'project1');
      const workdir2 = join(tmpDir, 'project2');
      mkdirSync(workdir1, { recursive: true });
      mkdirSync(workdir2, { recursive: true });

      const derived1 = deriveProjectDirName(workdir1);
      const derived2 = deriveProjectDirName(workdir2);
      const projDir1 = join(sessionsDir, derived1);
      const projDir2 = join(sessionsDir, derived2);
      mkdirSync(projDir1, { recursive: true });
      mkdirSync(projDir2, { recursive: true });

      writeJsonlFile(projDir1, 'session-a.jsonl', [
        { type: 'assistant', message: { role: 'assistant', content: 'hi', usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 80, cache_creation_input_tokens: 10 } } },
      ]);
      writeJsonlFile(projDir2, 'session-b.jsonl', [
        { type: 'assistant', message: { role: 'assistant', content: 'hi', usage: { input_tokens: 200, output_tokens: 100, cache_read_input_tokens: 150, cache_creation_input_tokens: 20 } } },
      ]);

      const tracker = createTokenTracker({ sessionsDir });
      tracker.registerSession('s1', workdir1, new Date());
      tracker.registerSession('s2', workdir2, new Date());
      tracker.refreshUsage('s1');
      tracker.refreshUsage('s2');

      const agg = tracker.getAggregate();
      assert.equal(agg.sessionCount, 2);
      assert.equal(agg.inputTokens, 300);
      assert.equal(agg.outputTokens, 150);
      assert.equal(agg.cacheReadTokens, 230);
      assert.equal(agg.cacheWriteTokens, 30);
      assert.equal(agg.totalTokens, 710);
    });

    it('computes cache hit rate correctly', () => {
      const workdir = join(tmpDir, 'proj');
      mkdirSync(workdir, { recursive: true });
      const derived = deriveProjectDirName(workdir);
      const projDir = join(sessionsDir, derived);
      mkdirSync(projDir, { recursive: true });

      writeJsonlFile(projDir, 'session.jsonl', [
        { type: 'assistant', message: { role: 'assistant', content: 'x', usage: { input_tokens: 200, output_tokens: 50, cache_read_input_tokens: 800, cache_creation_input_tokens: 0 } } },
      ]);

      const tracker = createTokenTracker({ sessionsDir });
      tracker.registerSession('s1', workdir, new Date());
      tracker.refreshUsage('s1');

      const agg = tracker.getAggregate();
      // cacheHitRate = 800 / (200 + 800) * 100 = 80
      assert.equal(agg.cacheHitRate, 80);
    });
  });

  // ── refreshUsage ──────────────────────────────────────────────

  describe('refreshUsage', () => {
    it('returns null for unregistered session', () => {
      const tracker = createTokenTracker({ sessionsDir });
      assert.equal(tracker.refreshUsage('nonexistent'), null);
    });

    it('returns null when project dir not found', () => {
      const tracker = createTokenTracker({ sessionsDir });
      tracker.registerSession('s1', 'C:\\nonexistent\\path', new Date());
      assert.equal(tracker.refreshUsage('s1'), null);
    });

    it('parses usage from JSONL with message.usage format', () => {
      const workdir = join(tmpDir, 'msg-format');
      mkdirSync(workdir, { recursive: true });
      const derived = deriveProjectDirName(workdir);
      const projDir = join(sessionsDir, derived);
      mkdirSync(projDir, { recursive: true });

      writeJsonlFile(projDir, 'session.jsonl', [
        { type: 'assistant', message: { role: 'assistant', content: 'hi', usage: { input_tokens: 1000, output_tokens: 200, cache_read_input_tokens: 800, cache_creation_input_tokens: 50 } } },
        { type: 'result', message: { role: 'assistant', content: 'done', usage: { input_tokens: 500, output_tokens: 100, cache_read_input_tokens: 400, cache_creation_input_tokens: 25 } } },
      ]);

      const tracker = createTokenTracker({ sessionsDir });
      tracker.registerSession('s1', workdir, new Date());
      const usage = tracker.refreshUsage('s1');

      assert.ok(usage);
      assert.equal(usage!.inputTokens, 1500);
      assert.equal(usage!.outputTokens, 300);
      assert.equal(usage!.cacheReadTokens, 1200);
      assert.equal(usage!.cacheWriteTokens, 75);
      assert.equal(usage!.totalTokens, 3075);
    });

    it('parses usage from JSONL with top-level usage format', () => {
      const workdir = join(tmpDir, 'top-level');
      mkdirSync(workdir, { recursive: true });
      const derived = deriveProjectDirName(workdir);
      const projDir = join(sessionsDir, derived);
      mkdirSync(projDir, { recursive: true });

      writeJsonlFile(projDir, 'session.jsonl', [
        { type: 'assistant', usage: { input_tokens: 300, output_tokens: 150, cache_read_input_tokens: 200, cache_creation_input_tokens: 10 } },
      ]);

      const tracker = createTokenTracker({ sessionsDir });
      tracker.registerSession('s1', workdir, new Date());
      const usage = tracker.refreshUsage('s1');

      assert.ok(usage);
      assert.equal(usage!.inputTokens, 300);
      assert.equal(usage!.outputTokens, 150);
      assert.equal(usage!.cacheReadTokens, 200);
      assert.equal(usage!.cacheWriteTokens, 10);
    });

    it('skips malformed JSONL lines gracefully', () => {
      const workdir = join(tmpDir, 'malformed');
      mkdirSync(workdir, { recursive: true });
      const derived = deriveProjectDirName(workdir);
      const projDir = join(sessionsDir, derived);
      mkdirSync(projDir, { recursive: true });

      // Write raw file with some bad lines
      const content = [
        '{"type":"assistant","message":{"role":"assistant","content":"hi","usage":{"input_tokens":100,"output_tokens":50}}}',
        'THIS IS NOT JSON',
        '{"broken json',
        '{"type":"assistant","message":{"role":"assistant","content":"done","usage":{"input_tokens":200,"output_tokens":100}}}',
      ].join('\n') + '\n';
      writeFileSync(join(projDir, 'session.jsonl'), content, 'utf-8');

      const tracker = createTokenTracker({ sessionsDir });
      tracker.registerSession('s1', workdir, new Date());
      const usage = tracker.refreshUsage('s1');

      assert.ok(usage);
      assert.equal(usage!.inputTokens, 300);
      assert.equal(usage!.outputTokens, 150);
    });

    it('caches result for subsequent getUsage calls', () => {
      const workdir = join(tmpDir, 'cache-test');
      mkdirSync(workdir, { recursive: true });
      const derived = deriveProjectDirName(workdir);
      const projDir = join(sessionsDir, derived);
      mkdirSync(projDir, { recursive: true });

      writeJsonlFile(projDir, 'session.jsonl', [
        { type: 'assistant', message: { role: 'assistant', content: 'x', usage: { input_tokens: 500, output_tokens: 200 } } },
      ]);

      const tracker = createTokenTracker({ sessionsDir });
      tracker.registerSession('s1', workdir, new Date());

      // Before refresh, getUsage returns null
      assert.equal(tracker.getUsage('s1'), null);

      // After refresh, getUsage returns cached data
      tracker.refreshUsage('s1');
      const usage = tracker.getUsage('s1');
      assert.ok(usage);
      assert.equal(usage!.inputTokens, 500);
    });

    it('handles events with no usage data', () => {
      const workdir = join(tmpDir, 'no-usage');
      mkdirSync(workdir, { recursive: true });
      const derived = deriveProjectDirName(workdir);
      const projDir = join(sessionsDir, derived);
      mkdirSync(projDir, { recursive: true });

      writeJsonlFile(projDir, 'session.jsonl', [
        { type: 'system', subtype: 'init', cwd: '/project' },
        { type: 'human', message: { role: 'user', content: 'hello' } },
      ]);

      const tracker = createTokenTracker({ sessionsDir });
      tracker.registerSession('s1', workdir, new Date());
      const usage = tracker.refreshUsage('s1');

      assert.ok(usage);
      assert.equal(usage!.totalTokens, 0);
      assert.equal(usage!.cacheHitRate, 0);
    });

    it('uses fixture file for realistic JSONL parsing', () => {
      // Read the fixture and copy into a temp project dir
      const workdir = join(tmpDir, 'fixture-test');
      mkdirSync(workdir, { recursive: true });
      const derived = deriveProjectDirName(workdir);
      const projDir = join(sessionsDir, derived);
      mkdirSync(projDir, { recursive: true });

      const fixtureContent = readFileSync(FIXTURE_PATH, 'utf-8');
      writeFileSync(join(projDir, 'fixture-session.jsonl'), fixtureContent, 'utf-8');

      const tracker = createTokenTracker({ sessionsDir });
      tracker.registerSession('s1', workdir, new Date());
      const usage = tracker.refreshUsage('s1');

      assert.ok(usage);
      // From fixture: 1000+500+300 = 1800 input, 200+100+150 = 450 output
      // 800+400+200 = 1400 cacheRead, 50+25+10 = 85 cacheWrite
      assert.equal(usage!.inputTokens, 1800);
      assert.equal(usage!.outputTokens, 450);
      assert.equal(usage!.cacheReadTokens, 1400);
      assert.equal(usage!.cacheWriteTokens, 85);
      assert.equal(usage!.totalTokens, 3735);
      // cacheHitRate = 1400 / (1800 + 1400) * 100 = 43.75
      assert.ok(Math.abs(usage!.cacheHitRate - 43.75) < 0.01);
    });
  });

  // ── Edge cases ────────────────────────────────────────────────

  describe('edge cases', () => {
    it('handles missing sessionsDir gracefully', () => {
      const tracker = createTokenTracker({ sessionsDir: '/nonexistent/sessions' });
      tracker.registerSession('s1', 'C:\\project', new Date());
      assert.equal(tracker.refreshUsage('s1'), null);
    });

    it('handles empty JSONL file', () => {
      const workdir = join(tmpDir, 'empty-jsonl');
      mkdirSync(workdir, { recursive: true });
      const derived = deriveProjectDirName(workdir);
      const projDir = join(sessionsDir, derived);
      mkdirSync(projDir, { recursive: true });

      writeFileSync(join(projDir, 'empty.jsonl'), '', 'utf-8');

      const tracker = createTokenTracker({ sessionsDir });
      tracker.registerSession('s1', workdir, new Date());
      const usage = tracker.refreshUsage('s1');

      assert.ok(usage);
      assert.equal(usage!.totalTokens, 0);
    });

    it('finds most recent JSONL when multiple exist', () => {
      const workdir = join(tmpDir, 'multi-jsonl');
      mkdirSync(workdir, { recursive: true });
      const derived = deriveProjectDirName(workdir);
      const projDir = join(sessionsDir, derived);
      mkdirSync(projDir, { recursive: true });

      // Write older file first
      writeJsonlFile(projDir, 'old-session.jsonl', [
        { type: 'assistant', message: { role: 'assistant', content: 'old', usage: { input_tokens: 100, output_tokens: 50 } } },
      ]);

      // Small delay to ensure different mtime, then write newer file
      const newerPath = writeJsonlFile(projDir, 'new-session.jsonl', [
        { type: 'assistant', message: { role: 'assistant', content: 'new', usage: { input_tokens: 999, output_tokens: 999 } } },
      ]);

      // Touch the newer file to ensure it has a later mtime
      const now = new Date();
      utimesSync(newerPath, now, now);

      const tracker = createTokenTracker({ sessionsDir });
      tracker.registerSession('s1', workdir, new Date());
      const usage = tracker.refreshUsage('s1');

      assert.ok(usage);
      // Should read from the newer file
      assert.equal(usage!.inputTokens, 999);
    });
  });
});
