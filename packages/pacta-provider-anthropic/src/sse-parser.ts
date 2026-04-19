// SPDX-License-Identifier: Apache-2.0
/**
 * SSE Parser — parses text/event-stream format into typed events.
 *
 * Handles the Server-Sent Events wire format:
 *   event: <type>\n
 *   data: <json>\n
 *   \n
 *
 * Used by the streaming path to parse Anthropic's streaming response.
 */

import type { AnthropicStreamEvent } from './types.js';

/**
 * Parse an SSE text chunk into individual events.
 *
 * Handles partial buffers — call with accumulated text and
 * the parser will extract complete events, returning any
 * incomplete trailing data.
 */
export interface SseParseResult {
  events: AnthropicStreamEvent[];
  remainder: string;
}

export function parseSseChunk(buffer: string): SseParseResult {
  const events: AnthropicStreamEvent[] = [];

  // Split on double newlines (event boundaries)
  const blocks = buffer.split(/\n\n/);

  // The last block may be incomplete — keep it as remainder
  const remainder = blocks.pop() ?? '';

  for (const block of blocks) {
    const trimmed = block.trim();
    if (!trimmed) continue;

    let data = '';
    for (const line of trimmed.split('\n')) {
      if (line.startsWith('data: ')) {
        data += line.slice(6);
      }
      // Ignore event:, id:, retry: lines — we only need data
    }

    if (!data) continue;

    try {
      const parsed = JSON.parse(data) as AnthropicStreamEvent;
      events.push(parsed);
    } catch {
      // Skip malformed JSON — defensive against partial chunks
    }
  }

  return { events, remainder };
}

/**
 * Async generator that reads a ReadableStream (from fetch Response.body)
 * and yields parsed SSE events.
 */
export async function* streamSseEvents(
  body: ReadableStream<Uint8Array>,
): AsyncIterable<AnthropicStreamEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const { events, remainder } = parseSseChunk(buffer);
      buffer = remainder;

      for (const event of events) {
        yield event;
      }
    }

    // Process any remaining buffer
    if (buffer.trim()) {
      const { events } = parseSseChunk(buffer + '\n\n');
      for (const event of events) {
        yield event;
      }
    }
  } finally {
    reader.releaseLock();
  }
}
