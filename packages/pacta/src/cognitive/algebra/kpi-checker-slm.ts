/**
 * HTTP SLM-backed KPIChecker — implements KPICheckerPort via a Python
 * HTTP bridge serving the trained Qwen2.5-0.5B-LoRA KPI Checker SLM.
 *
 * Per PRD 049 Gate 1+2 (validated 2026-04-05): 100% parse accuracy,
 * 100% semantic match on 600-example holdout set.
 *
 * Model is served on chobits: see experiments/exp-slm-composition/
 * phase-2-bootstrap/kpi-checker/models/kpi-checker-qwen25-05b-lora/
 *
 * @see docs/prds/049-kpi-checker-slm.md
 */

import type { CheckableKPI } from './verification.js';
import type { KPICheckerPort, KPICheckerInput } from './kpi-checker-port.js';
import { buildCheckableKPIFromDSL } from './kpi-checker-port.js';

// ── HTTP Client (matches slm-inference.ts contract) ──────────

export interface HttpKPICheckerConfig {
  /** Base URL of the Python HTTP server (e.g. "http://chobits.ts.net:8100"). */
  serverUrl: string;
  /** Model identifier for telemetry. Default: 'kpi-checker-qwen25-05b-lora'. */
  modelId?: string;
  /** Request timeout per-KPI in ms. Default: 10000. */
  timeoutMs?: number;
  /** Version tag. Default: 'v1'. */
  version?: string;
}

/**
 * Create an SLM-backed KPIChecker that calls a Python HTTP server.
 *
 * Server contract (from experiments/exp-slm/phase-4-integration/serve-model.py):
 *   POST /generate  { input: string, max_length: number }
 *     → { output: string, confidence: number, input_tokens: number,
 *         output_tokens: number, latency_ms: number }
 *   GET  /health    → { status: "ok" }
 *
 * The server wraps the KPI input with <kpi>...</kpi> if the agent isn't
 * already passing the tag. We send plain description; server adds framing.
 */
export function createHttpKPIChecker(config: HttpKPICheckerConfig): KPICheckerPort {
  const { serverUrl, modelId = 'kpi-checker-qwen25-05b-lora', timeoutMs = 10_000, version = 'v1' } = config;
  const baseUrl = serverUrl.replace(/\/+$/, '');

  return {
    model: modelId,
    version,

    async generateChecks(inputs: KPICheckerInput[]): Promise<CheckableKPI[]> {
      const results: CheckableKPI[] = [];

      // Batch: one HTTP call per KPI (server doesn't batch by contract).
      // Could be parallelized with Promise.all but sequential is safer for
      // the free-tier server.
      for (const input of inputs) {
        const promptText = `<kpi>${input.kpi}</kpi>`;
        try {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), timeoutMs);
          const resp = await fetch(`${baseUrl}/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ input: promptText, max_length: 256 }),
            signal: controller.signal,
          });
          clearTimeout(timer);

          if (!resp.ok) {
            results.push({ description: input.kpi, met: false, evidence: '' });
            continue;
          }

          const data = (await resp.json()) as { output: string };
          const dsl = data.output.trim();
          results.push(buildCheckableKPIFromDSL(input.kpi, dsl));
        } catch {
          // Network/timeout error → description-only fallback
          results.push({ description: input.kpi, met: false, evidence: '' });
        }
      }

      return results;
    },
  };
}

// ── Mock Implementation (for testing) ─────────────────────────

/**
 * Create a mock KPIChecker with static responses for testing.
 * Maps KPI description → DSL string. Unmapped inputs return description-only.
 */
export function createMockKPIChecker(responses: Map<string, string>): KPICheckerPort {
  return {
    model: 'mock-kpi-checker',
    version: 'test',

    async generateChecks(inputs: KPICheckerInput[]): Promise<CheckableKPI[]> {
      return inputs.map(input => {
        const dsl = responses.get(input.kpi);
        if (dsl) return buildCheckableKPIFromDSL(input.kpi, dsl);
        return { description: input.kpi, met: false, evidence: '' };
      });
    },
  };
}
