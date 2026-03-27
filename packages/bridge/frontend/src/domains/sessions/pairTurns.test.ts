/**
 * pairTurns unit tests.
 *
 * Pure function tests — no React, no browser APIs.
 * Run with: npx tsx --test packages/bridge/frontend/src/domains/sessions/pairTurns.test.ts
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { pairTurns } from './pairTurns.js';
import type { ApiTranscriptTurn } from './pairTurns.js';

// ── Helpers ──────────────────────────────────────────────────────────────────

function turn(role: 'user' | 'assistant', content: string, timestamp = '2024-01-01T00:00:00.000Z'): ApiTranscriptTurn {
  return { role, content, timestamp };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('pairTurns', () => {
  it('returns [] for empty input', () => {
    assert.deepEqual(pairTurns([]), []);
  });

  it('returns [] when all turns are assistant', () => {
    const turns = [
      turn('assistant', 'Hello'),
      turn('assistant', 'World'),
    ];
    assert.deepEqual(pairTurns(turns), []);
  });

  it('pairs even alternating turns into ChatTurns', () => {
    const turns = [
      turn('user', 'First question', '2024-01-01T00:00:00.000Z'),
      turn('assistant', 'First answer', '2024-01-01T00:00:01.000Z'),
      turn('user', 'Second question', '2024-01-01T00:00:02.000Z'),
      turn('assistant', 'Second answer', '2024-01-01T00:00:03.000Z'),
    ];

    const result = pairTurns(turns);

    assert.equal(result.length, 2);

    assert.deepEqual(result[0], {
      kind: 'historical',
      prompt: 'First question',
      output: 'First answer',
      timestamp: '2024-01-01T00:00:00.000Z',
    });

    assert.deepEqual(result[1], {
      kind: 'historical',
      prompt: 'Second question',
      output: 'Second answer',
      timestamp: '2024-01-01T00:00:02.000Z',
    });
  });

  it('emits output="" for a user turn with no following assistant (interrupted session)', () => {
    const turns = [
      turn('user', 'First question', '2024-01-01T00:00:00.000Z'),
      turn('assistant', 'First answer', '2024-01-01T00:00:01.000Z'),
      turn('user', 'Interrupted question', '2024-01-01T00:00:02.000Z'),
      // No assistant turn follows
    ];

    const result = pairTurns(turns);

    assert.equal(result.length, 2);
    assert.deepEqual(result[1], {
      kind: 'historical',
      prompt: 'Interrupted question',
      output: '',
      timestamp: '2024-01-01T00:00:02.000Z',
    });
  });

  it('skips a leading assistant turn before the first user turn', () => {
    const turns = [
      turn('assistant', 'System preamble', '2024-01-01T00:00:00.000Z'), // leading — skip
      turn('user', 'User question', '2024-01-01T00:00:01.000Z'),
      turn('assistant', 'User answer', '2024-01-01T00:00:02.000Z'),
    ];

    const result = pairTurns(turns);

    assert.equal(result.length, 1);
    assert.deepEqual(result[0], {
      kind: 'historical',
      prompt: 'User question',
      output: 'User answer',
      timestamp: '2024-01-01T00:00:01.000Z',
    });
  });

  it('handles a single user turn with no assistant response', () => {
    const turns = [turn('user', 'Only message', '2024-01-01T00:00:00.000Z')];

    const result = pairTurns(turns);

    assert.equal(result.length, 1);
    assert.deepEqual(result[0], {
      kind: 'historical',
      prompt: 'Only message',
      output: '',
      timestamp: '2024-01-01T00:00:00.000Z',
    });
  });
});
