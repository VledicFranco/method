/**
 * InferencePort implementations — mock, JSONL (pre-generated predictions),
 * and adapter for the existing SLMInference interface.
 */

import type { InferencePort, InferenceResult } from './types.js';

// ── Mock Inference (for unit tests) ──────────────────────────

/**
 * Create a mock inference port. Looks up responses by exact input match.
 * Returns low-confidence garbage for unknown inputs (triggers gate failure).
 */
export function createMockInference(
  modelId: string,
  responses: Map<string, { output: string; confidence: number }>,
): InferencePort {
  return {
    modelId,
    async generate(input: string): Promise<InferenceResult> {
      const match = responses.get(input);
      if (match) {
        return { output: match.output, confidence: match.confidence, latencyMs: 1 };
      }
      return { output: '<<GARBAGE>>', confidence: 0.05, latencyMs: 1 };
    },
  };
}

// ── JSONL Inference (pre-generated predictions) ──────────────

export interface JsonlPrediction {
  input: string;
  predicted: string;
  expected?: string;
}

/**
 * Create an inference port that looks up pre-generated predictions.
 * Used for reproducible evaluation without a running model server.
 */
export function createJsonlInference(
  modelId: string,
  predictions: readonly JsonlPrediction[],
): InferencePort {
  const lookup = new Map<string, JsonlPrediction>();
  for (const p of predictions) {
    lookup.set(p.input, p);
  }

  return {
    modelId,
    async generate(input: string): Promise<InferenceResult> {
      const match = lookup.get(input);
      if (match) {
        return { output: match.predicted, confidence: 0.95, latencyMs: 0 };
      }
      return { output: '<<NO_PREDICTION>>', confidence: 0.0, latencyMs: 0 };
    },
  };
}

/**
 * Load predictions from a JSONL string (one JSON object per line).
 */
export function parseJsonlPredictions(jsonl: string): JsonlPrediction[] {
  return jsonl
    .trim()
    .split('\n')
    .filter(line => line.length > 0)
    .map(line => JSON.parse(line) as JsonlPrediction);
}

// ── SLMInference Adapter ─────────────────────────────────────

/**
 * Wraps the existing SLMInference interface (from exp-slm/phase-4-integration)
 * into an InferencePort. Import SLMInference separately to avoid cross-experiment
 * import dependencies.
 */
export interface SLMInferenceLike {
  readonly modelId: string;
  generate(input: string): Promise<{
    tokens: string;
    confidence: number;
    latencyMs: number;
  }>;
}

export function createSLMInferenceAdapter(slm: SLMInferenceLike): InferencePort {
  return {
    modelId: slm.modelId,
    async generate(input: string): Promise<InferenceResult> {
      const result = await slm.generate(input);
      return {
        output: result.tokens,
        confidence: result.confidence,
        latencyMs: result.latencyMs,
      };
    },
  };
}
