/**
 * usePromptStream — SSE-based streaming prompt hook.
 *
 * Sends a prompt to POST /sessions/:id/prompt/stream and parses
 * the Server-Sent Events response, accumulating text chunks into
 * streamingText and throttling updates to ~60fps via requestAnimationFrame.
 */

import { useState, useCallback, useRef } from 'react';
import type { PromptMetadata, CognitiveTurnData, CognitiveCycleData, MemoryCard } from './types';

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
  /** Accumulated cognitive cycle data (null until first cognitive event) */
  cognitiveData: CognitiveTurnData | null;
  /** Send a streaming prompt. Resolves with the final result on completion. */
  send: (prompt: string) => Promise<StreamDoneResult>;
  /** Abort the current stream */
  abort: () => void;
}

export function usePromptStream(sessionId: string | null): UsePromptStreamResult {
  const [streamingText, setStreamingText] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [cognitiveData, setCognitiveData] = useState<CognitiveTurnData | null>(null);

  // Buffer for accumulating text between animation frames
  const bufferRef = useRef('');
  const rafRef = useRef<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Mutable ref for cognitive data accumulation (avoids stale closures)
  const cognitiveRef = useRef<CognitiveTurnData | null>(null);
  const cognitiveRafRef = useRef<number | null>(null);

  const flushCognitive = useCallback(() => {
    cognitiveRafRef.current = null;
    if (cognitiveRef.current) {
      // Shallow-copy to trigger re-render
      setCognitiveData({ ...cognitiveRef.current });
    }
  }, []);

  const scheduleCognitiveFlush = useCallback(() => {
    if (cognitiveRafRef.current === null) {
      cognitiveRafRef.current = requestAnimationFrame(flushCognitive);
    }
  }, [flushCognitive]);

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
    if (cognitiveRafRef.current !== null) {
      cancelAnimationFrame(cognitiveRafRef.current);
      cognitiveRafRef.current = null;
    }
    setIsStreaming(false);
  }, []);

  const send = useCallback(
    async (prompt: string): Promise<StreamDoneResult> => {
      if (!sessionId) throw new Error('No active session');

      // Reset state
      bufferRef.current = '';
      cognitiveRef.current = null;
      setStreamingText('');
      setCognitiveData(null);
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

            let event: {
              type: string;
              content?: string;
              output?: string;
              metadata?: PromptMetadata | null;
              timed_out?: boolean;
              error?: string;
              // Cognitive event fields
              cycle?: number;
              action?: string;
              confidence?: number;
              tokens?: number;
              intervention?: string;
              restricted?: string[];
              label?: string;
              valence?: number;
              arousal?: number;
              retrieved?: number;
              stored?: number;
              totalCards?: number;
              cards?: MemoryCard[];
              lessons?: string[];
              profile?: string;
            };
            try {
              event = JSON.parse(dataMatch[1]);
            } catch {
              continue;
            }

            if (event.type === 'text' && event.content) {
              bufferRef.current += event.content;
              scheduleFlush();
            } else if (event.type === 'done') {
              // Map cognitive metadata to the standard PromptMetadata shape.
              // Cognitive provider sends: { totalTokens, totalCycles, monitorInterventions, costUsd, inputTokens, outputTokens, workdir }
              // Standard provider sends:  { cost_usd, num_turns, duration_ms, stop_reason, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens }
              const rawMeta = event.metadata as Record<string, unknown> | null;
              const mappedMeta: PromptMetadata | null = rawMeta ? {
                cost_usd: (rawMeta.cost_usd as number) ?? (rawMeta.costUsd as number) ?? 0,
                num_turns: (rawMeta.num_turns as number) ?? (rawMeta.totalCycles as number) ?? 0,
                duration_ms: (rawMeta.duration_ms as number) ?? 0,
                stop_reason: (rawMeta.stop_reason as string) ?? (rawMeta.totalCycles ? 'cognitive_done' : null),
                input_tokens: (rawMeta.input_tokens as number) ?? (rawMeta.inputTokens as number) ?? (rawMeta.totalTokens as number) ?? 0,
                output_tokens: (rawMeta.output_tokens as number) ?? (rawMeta.outputTokens as number) ?? 0,
                cache_read_tokens: (rawMeta.cache_read_tokens as number) ?? 0,
                cache_write_tokens: (rawMeta.cache_write_tokens as number) ?? 0,
              } : null;
              doneResult = {
                output: event.output ?? bufferRef.current,
                metadata: mappedMeta,
                timed_out: event.timed_out ?? false,
              };
            } else if (event.type === 'error') {
              throw new Error(event.error ?? 'Stream error');

            // ── Cognitive cycle events ─────────────────────
            } else if (event.type === 'cycle-start') {
              // Initialize cognitive data if this is the first cognitive event
              if (!cognitiveRef.current) {
                cognitiveRef.current = { cycles: [] };
              }
              // cycle-start may carry a profile name
              if (event.profile) {
                cognitiveRef.current.profile = event.profile;
              }
              scheduleCognitiveFlush();

            } else if (event.type === 'cycle-action') {
              if (!cognitiveRef.current) {
                cognitiveRef.current = { cycles: [] };
              }
              const cycle: CognitiveCycleData = {
                number: event.cycle ?? cognitiveRef.current.cycles.length + 1,
                action: event.action ?? 'unknown',
                confidence: event.confidence ?? 0,
                tokens: event.tokens ?? 0,
              };
              cognitiveRef.current.cycles.push(cycle);
              scheduleCognitiveFlush();

            } else if (event.type === 'monitor') {
              if (cognitiveRef.current && cognitiveRef.current.cycles.length > 0) {
                const currentCycle = cognitiveRef.current.cycles[cognitiveRef.current.cycles.length - 1];
                currentCycle.monitor = {
                  intervention: event.intervention ?? 'unknown',
                  restricted: event.restricted,
                };
                scheduleCognitiveFlush();
              }

            } else if (event.type === 'affect') {
              if (cognitiveRef.current && cognitiveRef.current.cycles.length > 0) {
                const currentCycle = cognitiveRef.current.cycles[cognitiveRef.current.cycles.length - 1];
                currentCycle.affect = {
                  label: event.label ?? 'neutral',
                  valence: event.valence ?? 0,
                  arousal: event.arousal ?? 0,
                };
                scheduleCognitiveFlush();
              }

            } else if (event.type === 'memory') {
              if (!cognitiveRef.current) {
                cognitiveRef.current = { cycles: [] };
              }
              cognitiveRef.current.memory = {
                retrieved: event.retrieved ?? 0,
                stored: event.stored ?? 0,
                totalCards: event.totalCards ?? 0,
                cards: event.cards ?? cognitiveRef.current.memory?.cards,
              };
              scheduleCognitiveFlush();

            } else if (event.type === 'reflection') {
              if (!cognitiveRef.current) {
                cognitiveRef.current = { cycles: [] };
              }
              cognitiveRef.current.reflection = {
                lessons: event.lessons ?? [],
              };
              scheduleCognitiveFlush();
            }
          }
        }

        // Final flush
        if (rafRef.current !== null) {
          cancelAnimationFrame(rafRef.current);
          rafRef.current = null;
        }
        setStreamingText(bufferRef.current);

        // Final cognitive flush
        if (cognitiveRafRef.current !== null) {
          cancelAnimationFrame(cognitiveRafRef.current);
          cognitiveRafRef.current = null;
        }
        if (cognitiveRef.current) {
          setCognitiveData({ ...cognitiveRef.current });
        }

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
        if (cognitiveRafRef.current !== null) {
          cancelAnimationFrame(cognitiveRafRef.current);
          cognitiveRafRef.current = null;
        }
        setIsStreaming(false);
      }
    },
    [sessionId, scheduleFlush, scheduleCognitiveFlush],
  );

  return { streamingText, isStreaming, cognitiveData, send, abort };
}
