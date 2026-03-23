import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createTranscriptReader, deriveProjectDirName } from './transcript-reader.js';
import type { TranscriptTurn } from './transcript-reader.js';
import { mkdirSync, rmSync, writeFileSync, readFileSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import os from 'node:os';

// ── Helpers ──────────────────────────────────────────────────────

const FIXTURE_PATH = join(import.meta.dirname!, '..', '..', 'shared', 'test-fixtures', 'transcript.jsonl');

function makeTmpDir(): string {
  return join(os.tmpdir(), `transcript-reader-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
}

function writeJsonlFile(dir: string, filename: string, lines: object[]): string {
  const filepath = join(dir, filename);
  writeFileSync(filepath, lines.map(l => JSON.stringify(l)).join('\n') + '\n', 'utf-8');
  return filepath;
}

/** Set up a project dir inside sessionsDir that maps to the given workdir */
function setupProjectDir(sessionsDir: string, workdir: string): string {
  const derived = deriveProjectDirName(workdir);
  const projDir = join(sessionsDir, derived);
  mkdirSync(projDir, { recursive: true });
  return projDir;
}

// ── Tests ────────────────────────────────────────────────────────

describe('deriveProjectDirName — transcript-reader (PRD 013)', () => {
  it('converts Windows absolute path', () => {
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

describe('TranscriptReader — getTranscript (PRD 013)', () => {
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

  // ── User message (string content) ──────────────────────────────

  it('parses user message with string content', () => {
    const workdir = join(tmpDir, 'str-content');
    mkdirSync(workdir, { recursive: true });
    const projDir = setupProjectDir(sessionsDir, workdir);
    const filepath = writeJsonlFile(projDir, 'session.jsonl', [
      { type: 'human', message: { role: 'user', content: 'Hello world' }, timestamp: '2026-03-15T10:00:00.000Z' },
    ]);

    const reader = createTranscriptReader({ sessionsDir });
    const turns = reader.getTranscript(filepath);

    assert.equal(turns.length, 1);
    assert.equal(turns[0].role, 'user');
    assert.equal(turns[0].content, 'Hello world');
    assert.equal(turns[0].timestamp, '2026-03-15T10:00:00.000Z');
    assert.equal(turns[0].toolCalls, undefined);
    assert.equal(turns[0].tokens, undefined);
  });

  // ── Assistant message (string content) ─────────────────────────

  it('parses assistant message with string content', () => {
    const workdir = join(tmpDir, 'asst-str');
    mkdirSync(workdir, { recursive: true });
    const projDir = setupProjectDir(sessionsDir, workdir);
    const filepath = writeJsonlFile(projDir, 'session.jsonl', [
      {
        type: 'assistant',
        message: { role: 'assistant', content: 'Here is the answer.' },
        usage: { input_tokens: 500, output_tokens: 80, cache_read_input_tokens: 300 },
        timestamp: '2026-03-15T10:00:05.000Z',
      },
    ]);

    const reader = createTranscriptReader({ sessionsDir });
    const turns = reader.getTranscript(filepath);

    assert.equal(turns.length, 1);
    assert.equal(turns[0].role, 'assistant');
    assert.equal(turns[0].content, 'Here is the answer.');
    assert.equal(turns[0].tokens!.input, 500);
    assert.equal(turns[0].tokens!.output, 80);
    assert.equal(turns[0].tokens!.cacheRead, 300);
  });

  // ── Assistant message with array content and tool_use ──────────

  it('parses assistant message with text + tool_use blocks', () => {
    const workdir = join(tmpDir, 'tool-use');
    mkdirSync(workdir, { recursive: true });
    const projDir = setupProjectDir(sessionsDir, workdir);
    const filepath = writeJsonlFile(projDir, 'session.jsonl', [
      {
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [
            { type: 'text', text: 'I will read that file.' },
            { type: 'tool_use', id: 'toolu_01', name: 'Read', input: { file_path: '/src/index.ts' } },
          ],
          usage: { input_tokens: 1000, output_tokens: 60, cache_read_input_tokens: 800 },
        },
        timestamp: '2026-03-15T10:00:10.000Z',
      },
    ]);

    const reader = createTranscriptReader({ sessionsDir });
    const turns = reader.getTranscript(filepath);

    assert.equal(turns.length, 1);
    assert.equal(turns[0].role, 'assistant');
    assert.equal(turns[0].content, 'I will read that file.');
    assert.ok(turns[0].toolCalls);
    assert.equal(turns[0].toolCalls!.length, 1);
    assert.equal(turns[0].toolCalls![0].name, 'Read');
    assert.ok(turns[0].toolCalls![0].input.includes('file_path'));
  });

  // ── Multiple tool_use blocks in one assistant message ──────────

  it('parses multiple tool_use blocks in a single message', () => {
    const workdir = join(tmpDir, 'multi-tool');
    mkdirSync(workdir, { recursive: true });
    const projDir = setupProjectDir(sessionsDir, workdir);
    const filepath = writeJsonlFile(projDir, 'session.jsonl', [
      {
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [
            { type: 'text', text: 'Running both.' },
            { type: 'tool_use', id: 'toolu_A', name: 'Edit', input: { file_path: '/a.ts', old_string: 'x', new_string: 'y' } },
            { type: 'tool_use', id: 'toolu_B', name: 'Bash', input: { command: 'npm test' } },
          ],
        },
        timestamp: '2026-03-15T10:01:00.000Z',
      },
    ]);

    const reader = createTranscriptReader({ sessionsDir });
    const turns = reader.getTranscript(filepath);

    assert.equal(turns.length, 1);
    assert.equal(turns[0].toolCalls!.length, 2);
    assert.equal(turns[0].toolCalls![0].name, 'Edit');
    assert.equal(turns[0].toolCalls![1].name, 'Bash');
  });

  // ── tool_result blocks (string content) ────────────────────────

  it('parses tool_result blocks with string content in user message', () => {
    const workdir = join(tmpDir, 'tool-result-str');
    mkdirSync(workdir, { recursive: true });
    const projDir = setupProjectDir(sessionsDir, workdir);
    const filepath = writeJsonlFile(projDir, 'session.jsonl', [
      {
        type: 'human',
        message: {
          role: 'user',
          content: [
            { type: 'tool_result', tool_use_id: 'toolu_01', content: 'File contents here' },
          ],
        },
        timestamp: '2026-03-15T10:00:12.000Z',
      },
    ]);

    const reader = createTranscriptReader({ sessionsDir });
    const turns = reader.getTranscript(filepath);

    assert.equal(turns.length, 1);
    assert.equal(turns[0].role, 'user');
    assert.ok(turns[0].content.includes('[tool result: File contents here]'));
  });

  // ── tool_result blocks (array content) ─────────────────────────

  it('parses tool_result blocks with array content in user message', () => {
    const workdir = join(tmpDir, 'tool-result-arr');
    mkdirSync(workdir, { recursive: true });
    const projDir = setupProjectDir(sessionsDir, workdir);
    const filepath = writeJsonlFile(projDir, 'session.jsonl', [
      {
        type: 'human',
        message: {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'toolu_02',
              content: [{ type: 'text', text: 'Build succeeded in 1.2s' }],
            },
          ],
        },
        timestamp: '2026-03-15T10:00:15.000Z',
      },
    ]);

    const reader = createTranscriptReader({ sessionsDir });
    const turns = reader.getTranscript(filepath);

    assert.equal(turns.length, 1);
    assert.equal(turns[0].role, 'user');
    assert.ok(turns[0].content.includes('[tool result: Build succeeded in 1.2s]'));
  });

  // ── Missing fields (no message) ───────────────────────────────

  it('skips events with no message field', () => {
    const workdir = join(tmpDir, 'no-msg');
    mkdirSync(workdir, { recursive: true });
    const projDir = setupProjectDir(sessionsDir, workdir);
    const filepath = writeJsonlFile(projDir, 'session.jsonl', [
      { type: 'system', subtype: 'init', cwd: '/project' },
      { type: 'human', message: { role: 'user', content: 'hi' }, timestamp: '2026-03-15T10:00:00.000Z' },
    ]);

    const reader = createTranscriptReader({ sessionsDir });
    const turns = reader.getTranscript(filepath);

    assert.equal(turns.length, 1);
    assert.equal(turns[0].content, 'hi');
  });

  // ── Missing fields (role is not user/assistant) ────────────────

  it('skips events with unrecognized role', () => {
    const workdir = join(tmpDir, 'bad-role');
    mkdirSync(workdir, { recursive: true });
    const projDir = setupProjectDir(sessionsDir, workdir);
    const filepath = writeJsonlFile(projDir, 'session.jsonl', [
      { type: 'system', message: { role: 'system', content: 'init' }, timestamp: '2026-03-15T10:00:00.000Z' },
      { type: 'human', message: { role: 'user', content: 'real message' }, timestamp: '2026-03-15T10:00:01.000Z' },
    ]);

    const reader = createTranscriptReader({ sessionsDir });
    const turns = reader.getTranscript(filepath);

    assert.equal(turns.length, 1);
    assert.equal(turns[0].content, 'real message');
  });

  // ── Malformed JSONL lines are skipped ──────────────────────────

  it('skips malformed JSON lines gracefully', () => {
    const workdir = join(tmpDir, 'malformed');
    mkdirSync(workdir, { recursive: true });
    const projDir = setupProjectDir(sessionsDir, workdir);
    const content = [
      '{"type":"human","message":{"role":"user","content":"first"},"timestamp":"2026-03-15T10:00:00.000Z"}',
      'NOT VALID JSON — this line should be skipped',
      '{"broken json',
      '',
      '{"type":"assistant","message":{"role":"assistant","content":"second"},"timestamp":"2026-03-15T10:00:05.000Z"}',
    ].join('\n') + '\n';
    writeFileSync(join(projDir, 'session.jsonl'), content, 'utf-8');

    const reader = createTranscriptReader({ sessionsDir });
    const turns = reader.getTranscript(join(projDir, 'session.jsonl'));

    assert.equal(turns.length, 2);
    assert.equal(turns[0].content, 'first');
    assert.equal(turns[1].content, 'second');
  });

  // ── Token extraction (message.usage) ───────────────────────────

  it('extracts tokens from message.usage', () => {
    const workdir = join(tmpDir, 'msg-usage');
    mkdirSync(workdir, { recursive: true });
    const projDir = setupProjectDir(sessionsDir, workdir);
    const filepath = writeJsonlFile(projDir, 'session.jsonl', [
      {
        type: 'assistant',
        message: {
          role: 'assistant',
          content: 'response',
          usage: { input_tokens: 1200, output_tokens: 85, cache_read_input_tokens: 950 },
        },
        timestamp: '2026-03-15T10:00:05.000Z',
      },
    ]);

    const reader = createTranscriptReader({ sessionsDir });
    const turns = reader.getTranscript(filepath);

    assert.equal(turns.length, 1);
    assert.ok(turns[0].tokens);
    assert.equal(turns[0].tokens!.input, 1200);
    assert.equal(turns[0].tokens!.output, 85);
    assert.equal(turns[0].tokens!.cacheRead, 950);
  });

  // ── Token extraction (top-level usage) ─────────────────────────

  it('extracts tokens from top-level usage (event.usage)', () => {
    const workdir = join(tmpDir, 'top-usage');
    mkdirSync(workdir, { recursive: true });
    const projDir = setupProjectDir(sessionsDir, workdir);
    const filepath = writeJsonlFile(projDir, 'session.jsonl', [
      {
        type: 'assistant',
        message: { role: 'assistant', content: 'response' },
        usage: { input_tokens: 800, output_tokens: 120, cache_read_input_tokens: 600 },
        timestamp: '2026-03-15T10:00:10.000Z',
      },
    ]);

    const reader = createTranscriptReader({ sessionsDir });
    const turns = reader.getTranscript(filepath);

    assert.equal(turns.length, 1);
    assert.ok(turns[0].tokens);
    assert.equal(turns[0].tokens!.input, 800);
    assert.equal(turns[0].tokens!.output, 120);
    assert.equal(turns[0].tokens!.cacheRead, 600);
  });

  // ── No usage data → tokens is undefined ────────────────────────

  it('returns undefined tokens when no usage data present', () => {
    const workdir = join(tmpDir, 'no-usage');
    mkdirSync(workdir, { recursive: true });
    const projDir = setupProjectDir(sessionsDir, workdir);
    const filepath = writeJsonlFile(projDir, 'session.jsonl', [
      { type: 'human', message: { role: 'user', content: 'no tokens here' }, timestamp: '2026-03-15T10:00:00.000Z' },
    ]);

    const reader = createTranscriptReader({ sessionsDir });
    const turns = reader.getTranscript(filepath);

    assert.equal(turns.length, 1);
    assert.equal(turns[0].tokens, undefined);
  });

  // ── Empty content with tool calls → fallback content ───────────

  it('uses fallback content when text is empty but tool calls exist', () => {
    const workdir = join(tmpDir, 'no-text-tools');
    mkdirSync(workdir, { recursive: true });
    const projDir = setupProjectDir(sessionsDir, workdir);
    const filepath = writeJsonlFile(projDir, 'session.jsonl', [
      {
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [
            { type: 'tool_use', id: 'toolu_X', name: 'Grep', input: { pattern: 'foo' } },
          ],
        },
        timestamp: '2026-03-15T10:00:00.000Z',
      },
    ]);

    const reader = createTranscriptReader({ sessionsDir });
    const turns = reader.getTranscript(filepath);

    assert.equal(turns.length, 1);
    assert.equal(turns[0].content, '[1 tool call(s)]');
    assert.equal(turns[0].toolCalls!.length, 1);
    assert.equal(turns[0].toolCalls![0].name, 'Grep');
  });

  // ── Empty content without tool calls → [empty] ────────────────

  it('uses [empty] fallback when no text and no tool calls', () => {
    const workdir = join(tmpDir, 'empty-msg');
    mkdirSync(workdir, { recursive: true });
    const projDir = setupProjectDir(sessionsDir, workdir);
    const filepath = writeJsonlFile(projDir, 'session.jsonl', [
      {
        type: 'assistant',
        message: { role: 'assistant', content: [] },
        timestamp: '2026-03-15T10:00:00.000Z',
      },
    ]);

    const reader = createTranscriptReader({ sessionsDir });
    const turns = reader.getTranscript(filepath);

    assert.equal(turns.length, 1);
    assert.equal(turns[0].content, '[empty]');
  });

  // ── File not found → empty array ───────────────────────────────

  it('returns empty array for nonexistent file', () => {
    const reader = createTranscriptReader({ sessionsDir });
    const turns = reader.getTranscript('/nonexistent/path/session.jsonl');
    assert.deepEqual(turns, []);
  });

  // ── Empty file → empty array ───────────────────────────────────

  it('returns empty array for empty JSONL file', () => {
    const workdir = join(tmpDir, 'empty-file');
    mkdirSync(workdir, { recursive: true });
    const projDir = setupProjectDir(sessionsDir, workdir);
    const filepath = join(projDir, 'empty.jsonl');
    writeFileSync(filepath, '', 'utf-8');

    const reader = createTranscriptReader({ sessionsDir });
    const turns = reader.getTranscript(filepath);
    assert.deepEqual(turns, []);
  });

  // ── Timestamp fallback ─────────────────────────────────────────

  it('uses current timestamp when event has no timestamp field', () => {
    const workdir = join(tmpDir, 'no-ts');
    mkdirSync(workdir, { recursive: true });
    const projDir = setupProjectDir(sessionsDir, workdir);
    const filepath = writeJsonlFile(projDir, 'session.jsonl', [
      { type: 'human', message: { role: 'user', content: 'no timestamp' } },
    ]);

    const before = new Date().toISOString();
    const reader = createTranscriptReader({ sessionsDir });
    const turns = reader.getTranscript(filepath);
    const after = new Date().toISOString();

    assert.equal(turns.length, 1);
    // Timestamp should be between before and after (current time fallback)
    assert.ok(turns[0].timestamp >= before);
    assert.ok(turns[0].timestamp <= after);
  });

  // ── Fixture file integration test ──────────────────────────────

  it('parses the realistic transcript.jsonl fixture correctly', () => {
    const reader = createTranscriptReader({ sessionsDir });
    const turns = reader.getTranscript(FIXTURE_PATH);

    // The fixture has:
    // Line 1: system init → skipped (no role user/assistant)
    // Line 2: human message (string content) → turn
    // Line 3: assistant message (array: text + tool_use Read) → turn
    // Line 4: human message (array: tool_result string) → turn
    // Line 5: assistant message (string content) → turn
    // Line 6: human message (string content) → turn
    // Line 7: assistant message (array: text + 2 tool_use Edit,Bash) → turn
    // Line 8: human message (array: 2 tool_results, one string one array) → turn
    // Line 9: assistant message (string content) → turn
    // Line 10: malformed line → skipped
    // Line 11: broken JSON → skipped
    // Line 12: assistant message (array: tool_use only, no text) → turn
    // Line 13: human message (array: tool_result array) → turn
    // Line 14: result assistant message (string content) → turn
    assert.equal(turns.length, 11);

    // Turn 0: user message with string content
    assert.equal(turns[0].role, 'user');
    assert.equal(turns[0].content, 'Read the file at packages/core/src/index.ts and tell me what it exports.');
    assert.equal(turns[0].tokens, undefined);

    // Turn 1: assistant with text + tool_use (Read)
    assert.equal(turns[1].role, 'assistant');
    assert.ok(turns[1].content.includes('read that file'));
    assert.equal(turns[1].toolCalls!.length, 1);
    assert.equal(turns[1].toolCalls![0].name, 'Read');
    assert.equal(turns[1].tokens!.input, 1200);
    assert.equal(turns[1].tokens!.output, 85);
    assert.equal(turns[1].tokens!.cacheRead, 950);

    // Turn 2: user with tool_result (string content)
    assert.equal(turns[2].role, 'user');
    assert.ok(turns[2].content.includes('[tool result:'));
    assert.ok(turns[2].content.includes('createSession'));

    // Turn 3: assistant with string content + tokens
    assert.equal(turns[3].role, 'assistant');
    assert.ok(turns[3].content.includes('exports three things'));
    assert.equal(turns[3].tokens!.input, 800);
    assert.equal(turns[3].tokens!.output, 120);
    assert.equal(turns[3].tokens!.cacheRead, 600);

    // Turn 4: user string content
    assert.equal(turns[4].role, 'user');
    assert.ok(turns[4].content.includes('edit the file'));

    // Turn 5: assistant with text + 2 tool_use (Edit, Bash)
    assert.equal(turns[5].role, 'assistant');
    assert.equal(turns[5].toolCalls!.length, 2);
    assert.equal(turns[5].toolCalls![0].name, 'Edit');
    assert.equal(turns[5].toolCalls![1].name, 'Bash');
    assert.equal(turns[5].tokens!.input, 1500);
    assert.equal(turns[5].tokens!.output, 200);
    assert.equal(turns[5].tokens!.cacheRead, 1100);

    // Turn 6: user with 2 tool_results (string + array)
    assert.equal(turns[6].role, 'user');
    assert.ok(turns[6].content.includes('[tool result: File edited successfully'));
    assert.ok(turns[6].content.includes('[tool result: Build completed successfully'));

    // Turn 7: assistant string content
    assert.equal(turns[7].role, 'assistant');
    assert.ok(turns[7].content.includes('createRegistry'));
    assert.equal(turns[7].tokens!.input, 900);

    // Turn 8: assistant with only tool_use, no text → fallback content
    assert.equal(turns[8].role, 'assistant');
    assert.equal(turns[8].content, '[1 tool call(s)]');
    assert.equal(turns[8].toolCalls!.length, 1);
    assert.equal(turns[8].toolCalls![0].name, 'Grep');
    assert.equal(turns[8].tokens!.input, 600);

    // Turn 9: user with tool_result array content
    assert.equal(turns[9].role, 'user');
    assert.ok(turns[9].content.includes('[tool result:'));

    // Turn 10: result type assistant message
    assert.equal(turns[10].role, 'assistant');
    assert.equal(turns[10].content, 'Session complete.');
    assert.equal(turns[10].tokens!.input, 400);
    assert.equal(turns[10].tokens!.output, 25);
    assert.equal(turns[10].tokens!.cacheRead, 300);
  });
});

describe('TranscriptReader — listSessions (PRD 013)', () => {
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

  // ── Empty / nonexistent dir ────────────────────────────────────

  it('returns empty array when sessions dir does not exist', () => {
    const reader = createTranscriptReader({ sessionsDir: '/nonexistent/sessions' });
    const sessions = reader.listSessions('C:\\Users\\test\\project');
    assert.deepEqual(sessions, []);
  });

  it('returns empty array when project dir does not exist', () => {
    const reader = createTranscriptReader({ sessionsDir });
    // No project dir created for this workdir
    const sessions = reader.listSessions(join(tmpDir, 'no-project'));
    assert.deepEqual(sessions, []);
  });

  it('returns empty array when project dir has no JSONL files', () => {
    const workdir = join(tmpDir, 'empty-proj');
    mkdirSync(workdir, { recursive: true });
    const projDir = setupProjectDir(sessionsDir, workdir);
    // Write a non-JSONL file
    writeFileSync(join(projDir, 'notes.txt'), 'not a jsonl', 'utf-8');

    const reader = createTranscriptReader({ sessionsDir });
    const sessions = reader.listSessions(workdir);
    assert.deepEqual(sessions, []);
  });

  // ── Single JSONL file ──────────────────────────────────────────

  it('lists a single JSONL file with correct metadata', () => {
    const workdir = join(tmpDir, 'single');
    mkdirSync(workdir, { recursive: true });
    const projDir = setupProjectDir(sessionsDir, workdir);
    writeJsonlFile(projDir, 'session-001.jsonl', [
      { type: 'human', message: { role: 'user', content: 'hello' } },
    ]);

    const reader = createTranscriptReader({ sessionsDir });
    const sessions = reader.listSessions(workdir);

    assert.equal(sessions.length, 1);
    assert.ok(sessions[0].file.endsWith('session-001.jsonl'));
    assert.ok(sessions[0].sizeBytes > 0);
    assert.ok(sessions[0].modifiedAt); // ISO string
  });

  // ── Multiple JSONL files sorted by mtime (newest first) ────────

  it('lists multiple JSONL files sorted by mtime descending', () => {
    const workdir = join(tmpDir, 'multi');
    mkdirSync(workdir, { recursive: true });
    const projDir = setupProjectDir(sessionsDir, workdir);

    // Write older file
    const olderPath = writeJsonlFile(projDir, 'session-old.jsonl', [
      { type: 'human', message: { role: 'user', content: 'old' } },
    ]);
    // Set mtime to the past
    const past = new Date('2026-01-01T00:00:00.000Z');
    utimesSync(olderPath, past, past);

    // Write newer file
    const newerPath = writeJsonlFile(projDir, 'session-new.jsonl', [
      { type: 'human', message: { role: 'user', content: 'new' } },
    ]);
    // Set mtime to a more recent time
    const recent = new Date('2026-03-15T12:00:00.000Z');
    utimesSync(newerPath, recent, recent);

    const reader = createTranscriptReader({ sessionsDir });
    const sessions = reader.listSessions(workdir);

    assert.equal(sessions.length, 2);
    // Newer file should be first (sorted by mtime descending)
    assert.ok(sessions[0].file.includes('session-new.jsonl'));
    assert.ok(sessions[1].file.includes('session-old.jsonl'));
    // modifiedAt of first should be later than second
    assert.ok(sessions[0].modifiedAt > sessions[1].modifiedAt);
  });

  // ── Only .jsonl files are listed ───────────────────────────────

  it('filters out non-JSONL files', () => {
    const workdir = join(tmpDir, 'mixed');
    mkdirSync(workdir, { recursive: true });
    const projDir = setupProjectDir(sessionsDir, workdir);

    writeJsonlFile(projDir, 'session.jsonl', [
      { type: 'human', message: { role: 'user', content: 'hi' } },
    ]);
    writeFileSync(join(projDir, 'notes.txt'), 'not a session', 'utf-8');
    writeFileSync(join(projDir, 'data.json'), '{}', 'utf-8');

    const reader = createTranscriptReader({ sessionsDir });
    const sessions = reader.listSessions(workdir);

    assert.equal(sessions.length, 1);
    assert.ok(sessions[0].file.endsWith('.jsonl'));
  });
});
