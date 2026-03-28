/**
 * usePromptStream — SSE-based streaming prompt hook.
 *
 * Sends a prompt to POST /sessions/:id/prompt/stream and parses
 * the Server-Sent Events response, accumulating text chunks into
 * streamingText and throttling updates to ~60fps via requestAnimationFrame.
 */

import { useState, useCallback, useRef } from 'react';
import type { PromptMetadata } from './types';

export interface StreamDoneResult {
  output: string;
  metadata: PromptMetadata | null;
  timed_out: boolean;
}

export interface UsePromptStreamResult {
  /** Accumulated text so far (updated at ~60fps during streaming) */
  streamingText: string;
  /** Whether a streaming prompt is currently in flight */
  isStreaming: boolean;
  /** Send a streaming prompt. Resolves with the final result on completion. */
  send: (prompt: string) => Promise<StreamDoneResult>;
  /** Abort the current stream */
  abort: () => void;
}

export function usePromptStream(sessionId: string | null): UsePromptStreamResult {
  const [streamingText, setStreamingText] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);

  // Buffer for accumulating text between animation frames
  const bufferRef = useRef('');
  const rafRef = useRef<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const flushBuffer = useCallback(() => {
    rafRef.current = null;
    setStreamingText(bufferRef.current);
  }, []);

  const scheduleFlush = useCallback(() => {
    if (rafRef.current === null) {
      rafRef.current = requestAnimationFrame(flushBuffer);
    }
  }, [flushBuffer]);

  const abort = useCallback(() => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    setIsStreaming(false);
  }, []);

  const send = useCallback(
    async (prompt: string): Promise<StreamDoneResult> => {
      if (!sessionId) throw new Error('No active session');

      // Reset state
      bufferRef.current = '';
      setStreamingText('');
      setIsStreaming(true);

      const controller = new AbortController();
      abortRef.current = controller;

      const baseUrl = import.meta.env.VITE_API_BASE_URL ?? '';

      try {
        const response = await fetch(
          `${baseUrl}/sessions/${sessionId}/prompt/stream`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt, timeout_ms: 300_000 }),
            signal: controller.signal,
          },
        );

        if (!response.ok) {
          const errorBody = await response.text();
          let errorMessage = `HTTP ${response.status}`;
          try {
            const parsed = JSON.parse(errorBody);
            errorMessage = parsed.error ?? errorMessage;
          } catch { /* not JSON */ }
          throw new Error(errorMessage);
        }

        const reader = response.body!.getReader();
        const decoder = new TextDecoder();
        let sseBuffer = '';
        let doneResult: StreamDoneResult | null = null;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          sseBuffer += decoder.decode(value, { stream: true });

          // Parse SSE events: split on double newline
          const parts = sseBuffer.split('\n\n');
          // Last part may be incomplete — keep it in buffer
          sseBuffer = parts.pop()!;

          for (const part of parts) {
            // Skip heartbeat comments
            if (part.startsWith(':')) continue;

            const dataMatch = part.match(/^data: (.+)$/m);
            if (!dataMatch) continue;

            let event: { type: string; content?: string; output?: string; metadata?: PromptMetadata | null; timed_out?: boolean; error?: string };
            try {
              event = JSON.parse(dataMatch[1]);
            } catch {
              continue;
            }

            if (event.type === 'text' && event.content) {
              bufferRef.current += event.content;
              scheduleFlush();
            } else if (event.type === 'done') {
              doneResult = {
                output: event.output ?? bufferRef.current,
                metadata: event.metadata ?? null,
                timed_out: event.timed_out ?? false,
              };
            } else if (event.type === 'error') {
              throw new Error(event.error ?? 'Stream error');
            }
          }
        }

        // Final flush
        if (rafRef.current !== null) {
          cancelAnimationFrame(rafRef.current);
          rafRef.current = null;
        }
        setStreamingText(bufferRef.current);

        if (!doneResult) {
          // Stream ended without a done event — construct from buffer
          doneResult = {
            output: bufferRef.current,
            metadata: null,
            timed_out: false,
          };
        }

        return doneResult;
      } finally {
        abortRef.current = null;
        if (rafRef.current !== null) {
          cancelAnimationFrame(rafRef.current);
          rafRef.current = null;
        }
        setIsStreaming(false);
      }
    },
    [sessionId, scheduleFlush],
  );

  return { streamingText, isStreaming, send, abort };
}
