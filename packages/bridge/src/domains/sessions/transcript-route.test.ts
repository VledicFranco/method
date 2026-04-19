// SPDX-License-Identifier: Apache-2.0
/**
 * Transcript route tests (PRD 013 Phase 2).
 *
 * Tests for GET /api/transcript/:id and GET /transcripts.
 * Uses Fastify inject() with stub SessionPool and TranscriptReader.
 */

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import Fastify, { type FastifyInstance } from 'fastify';
import { registerTranscriptRoutes } from './transcript-route.js';
import type { SessionPool } from '@methodts/runtime/sessions';
import type { TranscriptReader, SessionSummary, TranscriptTurn } from './transcript-reader.js';

// ── Stubs ─────────────────────────────────────────────────────

type StatusMap = Map<string, { workdir: string }>;
type ListEntry = { workdir: string };

/**
 * Minimal SessionPool stub — only status() and list() are used by transcript routes.
 */
function stubPool(statuses: StatusMap, listEntries: ListEntry[]): SessionPool {
  return {
    status(id: string) {
      const entry = statuses.get(id);
      if (!entry) throw new Error(`Session not found: ${id}`);
      return { workdir: entry.workdir } as ReturnType<SessionPool['status']>;
    },
    list() {
      return listEntries.map(e => ({ workdir: e.workdir })) as ReturnType<SessionPool['list']>;
    },
  } as unknown as SessionPool;
}

type SessionsMap = Map<string, SessionSummary[]>;
type TranscriptsMap = Map<string, TranscriptTurn[]>;

/**
 * Minimal TranscriptReader stub.
 */
function stubReader(sessions: SessionsMap, transcripts: TranscriptsMap): TranscriptReader {
  return {
    listSessions(workdir: string): SessionSummary[] {
      return sessions.get(workdir) ?? [];
    },
    getTranscript(sessionFile: string): TranscriptTurn[] {
      return transcripts.get(sessionFile) ?? [];
    },
  };
}

// ── Helpers ───────────────────────────────────────────────────

function buildApp(pool: SessionPool, reader: TranscriptReader): FastifyInstance {
  const app = Fastify({ logger: false });
  registerTranscriptRoutes(app, pool, reader);
  return app;
}

function makeTurn(role: 'user' | 'assistant', content: string): TranscriptTurn {
  return { role, content, timestamp: new Date().toISOString() };
}

// ── Tests ─────────────────────────────────────────────────────

describe('GET /api/transcript/:id', () => {
  let app: FastifyInstance;

  afterEach(async () => {
    if (app) await app.close();
  });

  it('returns 404 when session does not exist in pool', async () => {
    const pool = stubPool(new Map(), []);
    const reader = stubReader(new Map(), new Map());
    app = buildApp(pool, reader);
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/api/transcript/nonexistent-id' });
    assert.equal(res.statusCode, 404);
    const body = JSON.parse(res.body);
    assert.ok(body.error.includes('nonexistent-id'));
  });

  it('returns empty turns when no JSONL sessions exist for workdir', async () => {
    const statuses: StatusMap = new Map([['sess-1', { workdir: '/tmp/proj' }]]);
    const pool = stubPool(statuses, []);
    // No sessions at all for this workdir
    const reader = stubReader(new Map(), new Map());
    app = buildApp(pool, reader);
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/api/transcript/sess-1' });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.deepEqual(body.turns, []);
    assert.equal(body.session_id, 'sess-1');
  });

  it('returns empty turns when JSONL file for session ID is not found (no exact match)', async () => {
    const statuses: StatusMap = new Map([['sess-1', { workdir: '/tmp/proj' }]]);
    const pool = stubPool(statuses, []);
    // Session exists in workdir but with a different filename
    const sessionsMap: SessionsMap = new Map([
      ['/tmp/proj', [{ file: '/logs/other-session.jsonl', modifiedAt: '2026-01-01', sizeBytes: 100 }]],
    ]);
    const reader = stubReader(sessionsMap, new Map());
    app = buildApp(pool, reader);
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/api/transcript/sess-1' });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.deepEqual(body.turns, []);
    assert.equal(body.session_id, 'sess-1');
  });

  it('returns collapsed turns when exact JSONL match exists', async () => {
    const statuses: StatusMap = new Map([['sess-abc', { workdir: '/tmp/proj' }]]);
    const pool = stubPool(statuses, []);

    const sessionsMap: SessionsMap = new Map([
      ['/tmp/proj', [{ file: '/logs/sess-abc.jsonl', modifiedAt: '2026-01-01', sizeBytes: 512 }]],
    ]);
    const transcriptsMap: TranscriptsMap = new Map([
      ['/logs/sess-abc.jsonl', [
        makeTurn('user', 'Hello agent'),
        makeTurn('assistant', 'Hello! How can I help?'),
      ]],
    ]);

    const reader = stubReader(sessionsMap, transcriptsMap);
    app = buildApp(pool, reader);
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/api/transcript/sess-abc' });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.session_id, 'sess-abc');
    assert.equal(body.count, 2);
    assert.equal(body.turns.length, 2);
    assert.equal(body.turns[0].role, 'user');
    assert.equal(body.turns[0].content, 'Hello agent');
    assert.equal(body.turns[1].role, 'assistant');
    assert.equal(body.turns[1].content, 'Hello! How can I help?');
  });

  it('collapses tool rounds in returned turns', async () => {
    const statuses: StatusMap = new Map([['sess-tools', { workdir: '/tmp/proj' }]]);
    const pool = stubPool(statuses, []);

    const sessionsMap: SessionsMap = new Map([
      ['/tmp/proj', [{ file: '/logs/sess-tools.jsonl', modifiedAt: '2026-01-01', sizeBytes: 1024 }]],
    ]);
    // Simulate tool-use round: user prompt, assistant with tool call, tool_result, final assistant
    const transcriptsMap: TranscriptsMap = new Map([
      ['/logs/sess-tools.jsonl', [
        makeTurn('user', 'Read the file'),
        { role: 'assistant', content: '', toolCalls: [{ name: 'Read', input: '/tmp/foo.ts' }], timestamp: new Date().toISOString() },
        makeTurn('user', '[tool result: Read]'),
        makeTurn('assistant', 'The file contains 42 lines.'),
      ]],
    ]);

    const reader = stubReader(sessionsMap, transcriptsMap);
    app = buildApp(pool, reader);
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/api/transcript/sess-tools' });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    // collapseToolRounds should collapse the tool round into prompt + response
    // The user prompt "Read the file" stays, the tool_result user turn is filtered,
    // and the final assistant response is kept.
    assert.equal(body.count, 2);
    assert.equal(body.turns[0].role, 'user');
    assert.equal(body.turns[0].content, 'Read the file');
    assert.equal(body.turns[1].role, 'assistant');
    assert.equal(body.turns[1].content, 'The file contains 42 lines.');
  });

  it('handles empty transcript (exact match with 0 turns)', async () => {
    const statuses: StatusMap = new Map([['sess-empty', { workdir: '/tmp/proj' }]]);
    const pool = stubPool(statuses, []);

    const sessionsMap: SessionsMap = new Map([
      ['/tmp/proj', [{ file: '/logs/sess-empty.jsonl', modifiedAt: '2026-01-01', sizeBytes: 0 }]],
    ]);
    const transcriptsMap: TranscriptsMap = new Map([
      ['/logs/sess-empty.jsonl', []],
    ]);

    const reader = stubReader(sessionsMap, transcriptsMap);
    app = buildApp(pool, reader);
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/api/transcript/sess-empty' });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.session_id, 'sess-empty');
    assert.deepEqual(body.turns, []);
    assert.equal(body.count, 0);
  });

  it('handles long transcript content', async () => {
    const longContent = 'x'.repeat(100_000);
    const statuses: StatusMap = new Map([['sess-long', { workdir: '/tmp/proj' }]]);
    const pool = stubPool(statuses, []);

    const sessionsMap: SessionsMap = new Map([
      ['/tmp/proj', [{ file: '/logs/sess-long.jsonl', modifiedAt: '2026-01-01', sizeBytes: 100_000 }]],
    ]);
    const transcriptsMap: TranscriptsMap = new Map([
      ['/logs/sess-long.jsonl', [
        makeTurn('user', longContent),
        makeTurn('assistant', longContent),
      ]],
    ]);

    const reader = stubReader(sessionsMap, transcriptsMap);
    app = buildApp(pool, reader);
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/api/transcript/sess-long' });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.count, 2);
    assert.equal(body.turns[0].content.length, 100_000);
    assert.equal(body.turns[1].content.length, 100_000);
  });

  it('matches session ID at the end of the file path', async () => {
    // Ensure the match logic checks file.endsWith(`${id}.jsonl`)
    const statuses: StatusMap = new Map([['abc-123', { workdir: '/tmp/proj' }]]);
    const pool = stubPool(statuses, []);

    const sessionsMap: SessionsMap = new Map([
      ['/tmp/proj', [
        { file: '/deep/nested/path/abc-123.jsonl', modifiedAt: '2026-01-01', sizeBytes: 50 },
        { file: '/logs/not-abc-123.jsonl', modifiedAt: '2026-01-01', sizeBytes: 50 },
      ]],
    ]);
    const transcriptsMap: TranscriptsMap = new Map([
      ['/deep/nested/path/abc-123.jsonl', [
        makeTurn('user', 'matched'),
        makeTurn('assistant', 'correct'),
      ]],
    ]);

    const reader = stubReader(sessionsMap, transcriptsMap);
    app = buildApp(pool, reader);
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/api/transcript/abc-123' });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.count, 2);
    assert.equal(body.turns[0].content, 'matched');
  });
});

describe('GET /transcripts', () => {
  let app: FastifyInstance;

  afterEach(async () => {
    if (app) await app.close();
  });

  it('returns empty list when no sessions exist', async () => {
    const pool = stubPool(new Map(), []);
    const reader = stubReader(new Map(), new Map());
    app = buildApp(pool, reader);
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/transcripts' });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.deepEqual(body.transcripts, []);
    assert.equal(body.count, 0);
  });

  it('aggregates transcripts from multiple workdirs', async () => {
    const statuses: StatusMap = new Map();
    const listEntries: ListEntry[] = [
      { workdir: '/tmp/proj-a' },
      { workdir: '/tmp/proj-b' },
    ];
    const pool = stubPool(statuses, listEntries);

    const sessionsMap: SessionsMap = new Map([
      ['/tmp/proj-a', [
        { file: '/logs/a1.jsonl', modifiedAt: '2026-01-01', sizeBytes: 100 },
      ]],
      ['/tmp/proj-b', [
        { file: '/logs/b1.jsonl', modifiedAt: '2026-01-02', sizeBytes: 200 },
        { file: '/logs/b2.jsonl', modifiedAt: '2026-01-03', sizeBytes: 300 },
      ]],
    ]);
    const reader = stubReader(sessionsMap, new Map());
    app = buildApp(pool, reader);
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/transcripts' });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.equal(body.count, 3);
    assert.equal(body.transcripts.length, 3);

    // Verify each transcript includes workdir
    const workdirs = body.transcripts.map((t: { workdir: string }) => t.workdir);
    assert.ok(workdirs.includes('/tmp/proj-a'));
    assert.ok(workdirs.includes('/tmp/proj-b'));

    // Verify fields from SessionSummary are present
    const a1 = body.transcripts.find((t: { file: string }) => t.file === '/logs/a1.jsonl');
    assert.ok(a1);
    assert.equal(a1.workdir, '/tmp/proj-a');
    assert.equal(a1.modifiedAt, '2026-01-01');
    assert.equal(a1.sizeBytes, 100);
  });

  it('deduplicates workdirs from multiple sessions in same directory', async () => {
    const statuses: StatusMap = new Map();
    // Two sessions sharing the same workdir
    const listEntries: ListEntry[] = [
      { workdir: '/tmp/same' },
      { workdir: '/tmp/same' },
    ];
    const pool = stubPool(statuses, listEntries);

    const sessionsMap: SessionsMap = new Map([
      ['/tmp/same', [
        { file: '/logs/s1.jsonl', modifiedAt: '2026-01-01', sizeBytes: 50 },
      ]],
    ]);
    const reader = stubReader(sessionsMap, new Map());
    app = buildApp(pool, reader);
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/transcripts' });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    // workdirs go into a Set, so listSessions is called once per unique workdir
    assert.equal(body.count, 1);
    assert.equal(body.transcripts.length, 1);
  });

  it('returns empty transcripts when workdirs have no JSONL files', async () => {
    const statuses: StatusMap = new Map();
    const listEntries: ListEntry[] = [{ workdir: '/tmp/empty-proj' }];
    const pool = stubPool(statuses, listEntries);

    // Workdir exists but has no sessions
    const sessionsMap: SessionsMap = new Map([
      ['/tmp/empty-proj', []],
    ]);
    const reader = stubReader(sessionsMap, new Map());
    app = buildApp(pool, reader);
    await app.ready();

    const res = await app.inject({ method: 'GET', url: '/transcripts' });
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.deepEqual(body.transcripts, []);
    assert.equal(body.count, 0);
  });
});
