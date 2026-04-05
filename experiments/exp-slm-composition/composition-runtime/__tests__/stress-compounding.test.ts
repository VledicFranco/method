/**
 * Error Compounding Stress Test
 *
 * Validates RFC 005's error compounding theory with a controllable-accuracy SLM.
 * Wraps B-1 v1 predictions with a noise injector that corrupts outputs at a
 * known rate, then measures gated vs ungated pipeline success.
 *
 * Theory (RFC 005 Part VI):
 *   Per-stage accuracy: a = 1 - p (where p = noise rate)
 *   Without gates: P(success) = a^N  (multiplicative compounding)
 *   With gates + retry(k): P(success) = (1 - p^(k+1))^N  (each stage retries)
 *
 * Example at p=0.25, N=2, retry(2):
 *   Ungated:  0.75^2 = 56.3%
 *   Gated:    (1 - 0.25^3)^2 = 96.8%
 *
 * This test demonstrates gates holding the error bound under real error rates.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import peggy from 'peggy';

import { executePipeline } from '../pipeline.js';
import { createPeggyCompileGate } from '../gates.js';
import { createSLMStage } from '../stages.js';
import { parseJsonlPredictions, type JsonlPrediction } from '../inference-adapters.js';
import { createAggregateCollector } from '../metrics.js';
import type { InferencePort, InferenceResult, PipelineDefinition } from '../types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = resolve(__dirname, '../../phase-1-schema-grammar/results');

// ── Noisy Inference Wrapper ─────────────────────────────────

/**
 * Wraps an InferencePort with controllable noise injection.
 * Each call is an independent sample — retries get fresh noise.
 *
 * Noise strategies for grammar corruption:
 *   - Delete random line (breaks rule references)
 *   - Truncate output (incomplete grammar)
 *   - Corrupt quote characters (syntax errors)
 *   - Swap type names (semantic errors that compile but fail parse)
 */
function createNoisyInference(
  baseInference: InferencePort,
  noiseRate: number,
): InferencePort {
  return {
    modelId: `noisy(${baseInference.modelId}, p=${noiseRate})`,
    async generate(input: string): Promise<InferenceResult> {
      const result = await baseInference.generate(input);

      if (Math.random() < noiseRate) {
        return {
          ...result,
          output: corruptGrammar(result.output),
        };
      }

      return result;
    },
  };
}

function corruptGrammar(grammar: string): string {
  // Guaranteed-to-break corruptions (always fail Peggy compile)
  const strategies = [
    // Append invalid syntax
    (g: string) => g + '\n\n{{{ INVALID GRAMMAR SYNTAX }}}',
    // Prepend invalid syntax
    (g: string) => '{{INVALID}}\n\n' + g,
    // Insert unclosed string
    (g: string) => g + '\nBROKEN = "unclosed',
    // Insert garbage in the middle
    (g: string) => {
      const lines = g.split('\n');
      const mid = Math.floor(lines.length / 2);
      lines.splice(mid, 0, '{{GARBAGE NOT VALID PEG}}');
      return lines.join('\n');
    },
    // Remove all rule definitions (just keep the first line)
    (g: string) => g.split('\n')[0] + '\nBROKEN SYNTAX HERE',
  ];

  const strategy = strategies[Math.floor(Math.random() * strategies.length)];
  return strategy(grammar);
}

// ── JsonlInference with independent samples per call ────────

function createJsonlInferenceMultisample(
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

// ── Build the stress test pipeline ──────────────────────────

function buildNoisyPipeline(
  pred: JsonlPrediction,
  noiseRate: number,
  gated: boolean,
  maxRetries: number,
): PipelineDefinition {
  const baseInference = createJsonlInferenceMultisample('b1-base', [pred]);
  const noisyInference = createNoisyInference(baseInference, noiseRate);

  const stages = [];
  stages.push({ type: 'stage' as const, stage: createSLMStage('b1-noisy', noisyInference) });

  if (gated) {
    // Single compile gate — retries the SLM stage on failure
    stages.push({
      type: 'gate' as const,
      gate: createPeggyCompileGate('peggy-compile', 'compiledParser'),
      onFail: { maxRetries, escalation: 'abort' as const },
    });
  }

  return { id: `stress-noisy-${gated ? 'gated' : 'ungated'}`, stages };
}

// ── Tests ────────────────────────────────────────────────────

describe('Error Compounding Stress Test', () => {
  // Load B-1 v1 predictions (100% accuracy baseline)
  const predictions = parseJsonlPredictions(
    readFileSync(resolve(RESULTS_DIR, 'predictions.jsonl'), 'utf-8'),
  );

  // Use a larger subset to reduce variance from random noise
  const testSet = predictions.slice(0, 50);

  const NOISE_RATES = [0.10, 0.25, 0.40];
  const MAX_RETRIES = 2; // 3 total attempts per stage

  // Run each condition multiple times to reduce variance
  const TRIALS = 5;

  for (const noiseRate of NOISE_RATES) {
    it(`validates RFC 005 theory at noise rate ${noiseRate}`, async () => {
      let totalGatedSuccess = 0;
      let totalUngatedSuccess = 0;
      const N = testSet.length;

      let totalRetries = 0;
      let totalEscalated = 0;

      for (let trial = 0; trial < TRIALS; trial++) {
        const gatedAgg = createAggregateCollector();
        let ungatedCount = 0;

        for (const pred of testSet) {
          // Gated pipeline
          const gatedPipeline = buildNoisyPipeline(pred, noiseRate, true, MAX_RETRIES);
          const gatedResult = await executePipeline(gatedPipeline, pred.input);
          gatedAgg.addRun(gatedResult.metrics);
          // Count retries
          for (const sm of gatedResult.metrics.stages) {
            totalRetries += sm.retryCount;
            if (sm.escalated) totalEscalated++;
          }

          // Ungated: one sample, accept raw output
          const noisyInf = createNoisyInference(
            createJsonlInferenceMultisample('base', [pred]),
            noiseRate,
          );
          const noisyOutput = await noisyInf.generate(pred.input);
          try {
            peggy.generate(noisyOutput.output);
            ungatedCount++;
          } catch {
            // compile fail
          }
        }

        const gatedMetrics = gatedAgg.getAggregate();
        totalGatedSuccess += Math.round(gatedMetrics.successRate * N);
        totalUngatedSuccess += ungatedCount;
      }

      const meanGated = totalGatedSuccess / (TRIALS * N);
      const meanUngated = totalUngatedSuccess / (TRIALS * N);

      // Theoretical predictions
      const a = 1 - noiseRate;
      const k = MAX_RETRIES;
      // P(at least 1 of k+1 calls succeeds) = 1 - p^(k+1)
      const expectedGated = 1 - Math.pow(noiseRate, k + 1);
      const expectedUngated = a;

      console.log(`\n=== Noise rate p=${noiseRate} (accuracy a=${a.toFixed(2)}) ===`);
      console.log(`Trials: ${TRIALS} × ${N} entries = ${TRIALS * N} runs each`);
      console.log(`Theory:`);
      console.log(`  Ungated expected: ${(expectedUngated * 100).toFixed(1)}% (single sample at a=${a.toFixed(2)})`);
      console.log(`  Gated expected:   ${(expectedGated * 100).toFixed(1)}% (1 - p^${k+1})`);
      console.log(`Actual:`);
      console.log(`  Ungated: ${totalUngatedSuccess}/${TRIALS * N} (${(meanUngated * 100).toFixed(1)}%)`);
      console.log(`  Gated:   ${totalGatedSuccess}/${TRIALS * N} (${(meanGated * 100).toFixed(1)}%)`);
      console.log(`  Lift:    +${((meanGated - meanUngated) * 100).toFixed(1)}pp`);
      console.log(`Diagnostic: ${totalRetries} retries, ${totalEscalated} escalations across ${TRIALS * N} runs`);

      // With enough trials, gated should exceed ungated at meaningful noise rates
      if (noiseRate >= 0.25) {
        assert.ok(
          meanGated > meanUngated,
          `Gated (${meanGated.toFixed(3)}) should exceed ungated (${meanUngated.toFixed(3)}) at p=${noiseRate}`,
        );
      }
      // Gated rate should be within 15pp of theoretical prediction
      assert.ok(
        Math.abs(meanGated - expectedGated) < 0.15,
        `Gated rate ${meanGated.toFixed(3)} should be within 0.15 of predicted ${expectedGated.toFixed(3)}`,
      );
    });
  }
});
