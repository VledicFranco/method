// SPDX-License-Identifier: Apache-2.0
/**
 * Router SLM Adapters — PRD 052 HTTP bridge + mock implementations.
 *
 * The Router SLM (Qwen2.5-0.5B-LoRA, 100% holdout accuracy) classifies
 * tasks as 'flat' or 'unified-memory' with a single word output.
 *
 * @see docs/prds/051-router-slm.md
 */

import type { RouterSLMPort, ArchitectureKind } from './router-types.js';

// ── HTTP Bridge Adapter ───────────────────────────────────────

export interface HttpRouterSLMConfig {
  /** Base URL of the Python HTTP server (e.g. "http://chobits.ts.net:8101"). */
  serverUrl: string;
  /** Model ID for telemetry. Default: 'router-slm-qwen25-05b-lora'. */
  modelId?: string;
  /** Timeout per classification in ms. Default: 5000. */
  timeoutMs?: number;
}

/**
 * Create an HTTP-bridge Router SLM that calls a Python server on chobits.
 *
 * Server contract (same as KPI Checker):
 *   POST /generate  { input: "<task>...</task>", max_length: 16 }
 *     → { output: "flat" | "unified-memory", confidence: number, ... }
 */
export function createHttpRouterSLM(config: HttpRouterSLMConfig): RouterSLMPort {
  const { serverUrl, modelId = 'router-slm-qwen25-05b-lora', timeoutMs = 5000 } = config;
  const baseUrl = serverUrl.replace(/\/+$/, '');

  return {
    model: modelId,

    async classify(taskDescription: string, objective: string): Promise<{
      architecture: ArchitectureKind;
      confidence: number;
    }> {
      // SLM trained on short task summaries. The full description has noise
      // ("Start by reading..." / "When done, signal..."). Use just objective
      // if it's non-trivial, otherwise fall back to truncated taskDescription.
      const summary = objective.length >= 30
        ? objective
        : taskDescription.split(/\n\n/)[0].slice(0, 500);
      const input = `<task>${summary}</task>`;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const resp = await fetch(`${baseUrl}/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ input, max_length: 16 }),
          signal: controller.signal,
        });
        clearTimeout(timer);

        if (!resp.ok) {
          return { architecture: 'flat', confidence: 0.5 }; // safe fallback
        }

        const data = (await resp.json()) as { output: string; confidence: number };
        const output = data.output.trim().toLowerCase();

        if (output === 'flat' || output === 'unified-memory') {
          return { architecture: output, confidence: data.confidence };
        }

        // Unparseable → safe fallback
        return { architecture: 'flat', confidence: 0.5 };
      } catch {
        return { architecture: 'flat', confidence: 0.5 };
      }
    },
  };
}

// ── Mock Adapter ──────────────────────────────────────────────

/**
 * Mock Router SLM with static responses for testing.
 * Maps task substrings → architecture labels.
 */
export function createMockRouterSLM(
  responses: Map<string, ArchitectureKind>,
): RouterSLMPort {
  return {
    model: 'mock-router-slm',

    async classify(taskDescription: string): Promise<{
      architecture: ArchitectureKind;
      confidence: number;
    }> {
      for (const [pattern, arch] of responses) {
        if (taskDescription.toLowerCase().includes(pattern.toLowerCase())) {
          return { architecture: arch, confidence: 0.95 };
        }
      }
      return { architecture: 'flat', confidence: 0.6 };
    },
  };
}
