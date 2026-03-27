/**
 * pairTurns — Maps flat API transcript turns to ChatTurn[] of kind 'historical'.
 *
 * The backend returns alternating user/assistant turns from a JSONL session log.
 * This function pairs each user turn with the following assistant turn and emits
 * one ChatTurn per user message.
 */

import type { ChatTurn } from './types';

// ── Local API type ───────────────────────────────────────────────────────────
// Matches the shape returned by GET /api/transcript/:id → { turns: ApiTranscriptTurn[] }

export interface ApiTranscriptTurn {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

// ── pairTurns ────────────────────────────────────────────────────────────────

/**
 * Pair flat alternating transcript turns into ChatTurn[] of kind 'historical'.
 *
 * Algorithm:
 * 1. Skip any leading assistant turns that have no preceding user turn.
 * 2. For each user turn, find the next assistant turn after it.
 *    - If found: emit { kind: 'historical', prompt, output: assistant.content, timestamp }
 *    - If not found (interrupted): emit { kind: 'historical', prompt, output: '', timestamp }
 * 3. Result: one ChatTurn per user message in the transcript.
 */
export function pairTurns(turns: ApiTranscriptTurn[]): ChatTurn[] {
  const result: ChatTurn[] = [];

  let i = 0;

  // Skip leading assistant turns
  while (i < turns.length && turns[i].role === 'assistant') {
    i++;
  }

  while (i < turns.length) {
    const current = turns[i];

    if (current.role !== 'user') {
      // Skip unexpected assistant turns (shouldn't happen after pairing, but be safe)
      i++;
      continue;
    }

    // Find the next assistant turn after this user turn
    let j = i + 1;
    while (j < turns.length && turns[j].role !== 'assistant') {
      j++;
    }

    const assistantTurn = j < turns.length ? turns[j] : null;

    result.push({
      kind: 'historical',
      prompt: current.content,
      output: assistantTurn?.content ?? '',
      timestamp: current.timestamp,
    });

    // Advance past the assistant turn (or just the user turn if no assistant found)
    i = assistantTurn !== null ? j + 1 : i + 1;
  }

  return result;
}
