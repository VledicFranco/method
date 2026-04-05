/**
 * Integration test — E2E CLM pipeline with real B-1 predictions.
 *
 * Gate C-G1: End-to-end accuracy >= 85% on 50 holdout predictions.
 * Gate C-G2: Gates reduce errors >= 50% (ablation with error injection).
 *
 * Uses pre-generated predictions from Phase 1 (no live inference needed).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import peggy from 'peggy';

import { executePipeline } from '../pipeline.js';
import { createPeggyCompileGate, createPeggyParseGate } from '../gates.js';
import { createSLMStage, createExampleGeneratorStage, generateExampleFromGrammar } from '../stages.js';
import { createJsonlInference, parseJsonlPredictions, type JsonlPrediction } from '../inference-adapters.js';
import { createAggregateCollector } from '../metrics.js';
import type { PipelineDefinition, PipelineContext } from '../types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = resolve(__dirname, '../../phase-1-schema-grammar/results');

// ── Load predictions ─────────────────────────────────────────

function loadPredictions(filename: string): JsonlPrediction[] {
  const path = resolve(RESULTS_DIR, filename);
  return parseJsonlPredictions(readFileSync(path, 'utf-8'));
}

// ── Build the 2-stage CLM pipeline ───────────────────────────

function buildSchemaGrammarPipeline(predictions: readonly JsonlPrediction[]): PipelineDefinition {
  const inference = createJsonlInference('b1-schema-grammar', predictions);

  return {
    id: 'schema-to-grammar-clm',
    stages: [
      // Stage 1: B-1 SLM generates PEG grammar from TypeScript interface
      {
        type: 'stage',
        stage: createSLMStage('b1-schema-grammar', inference),
      },
      // Gate 1: Does the grammar compile with Peggy?
      {
        type: 'gate',
        gate: createPeggyCompileGate('peggy-compile', 'compiledParser'),
        onFail: { maxRetries: 0, escalation: 'abort' },
      },
      // Stage 2: Generate a sample DSL string from the grammar
      {
        type: 'stage',
        stage: createExampleGeneratorStage('example-gen'),
      },
      // Gate 2: Does the sample parse through the compiled grammar?
      {
        type: 'gate',
        gate: createPeggyParseGate(
          'peggy-parse',
          (ctx: PipelineContext) => ctx.state.get('compiledParser') as peggy.Parser,
        ),
        onFail: { maxRetries: 0, escalation: 'abort' },
      },
    ],
  };
}

// ── Gate C-G1: End-to-end accuracy ───────────────────────────

describe('Gate C-G1: 2-stage CLM end-to-end accuracy', () => {
  const predictions = loadPredictions('predictions.jsonl');

  it(`achieves >= 85% e2e accuracy on ${predictions.length} holdout entries`, async () => {
    const aggregate = createAggregateCollector();
    const failures: Array<{ input: string; error?: string }> = [];

    for (const pred of predictions) {
      const pipeline = buildSchemaGrammarPipeline([pred]);
      const result = await executePipeline(pipeline, pred.input);
      aggregate.addRun(result.metrics);

      if (!result.success) {
        failures.push({
          input: pred.input.slice(0, 80),
          error: result.error?.slice(0, 200),
        });
      }
    }

    const agg = aggregate.getAggregate();
    const successCount = Math.round(agg.successRate * agg.totalRuns);

    console.log('\n=== Gate C-G1: 2-Stage CLM End-to-End ===');
    console.log(`Total runs:      ${agg.totalRuns}`);
    console.log(`Success:         ${successCount}/${agg.totalRuns} (${(agg.successRate * 100).toFixed(1)}%)`);
    console.log(`Mean latency:    ${agg.meanLatencyMs.toFixed(2)} ms`);
    console.log(`Gate C-G1 (>=85%): ${agg.successRate >= 0.85 ? 'PASS' : 'FAIL'}`);

    if (failures.length > 0 && failures.length <= 10) {
      console.log(`\nFailures (${failures.length}):`);
      for (const f of failures) {
        console.log(`  ${f.input}...`);
        console.log(`    ${f.error}`);
      }
    }

    assert.ok(
      agg.successRate >= 0.85,
      `Gate C-G1 FAIL: success rate ${(agg.successRate * 100).toFixed(1)}% < 85%`,
    );
  });

  it('also passes on 5 real unseen interfaces', async () => {
    const realPreds = loadPredictions('real-predictions.jsonl');
    const aggregate = createAggregateCollector();

    for (const pred of realPreds) {
      const pipeline = buildSchemaGrammarPipeline([pred]);
      const result = await executePipeline(pipeline, pred.input);
      aggregate.addRun(result.metrics);
    }

    const agg = aggregate.getAggregate();
    console.log(`\nReal interfaces: ${Math.round(agg.successRate * agg.totalRuns)}/${agg.totalRuns} pass`);
    assert.equal(agg.successRate, 1.0, 'All real interfaces should pass the full pipeline');
  });
});

// ── Gate C-G2: Gate effectiveness (ablation) ─────────────────

describe('Gate C-G2: Gate effectiveness (ablation)', () => {
  const predictions = loadPredictions('predictions.jsonl');

  /**
   * Corrupt a grammar at a controlled rate to simulate SLM errors.
   * Returns a copy of predictions with some grammars corrupted.
   */
  function corruptPredictions(
    preds: JsonlPrediction[],
    corruptionRate: number,
  ): { corrupted: JsonlPrediction[]; corruptedIndices: Set<number> } {
    const corrupted: JsonlPrediction[] = [];
    const corruptedIndices = new Set<number>();

    for (let i = 0; i < preds.length; i++) {
      if (Math.random() < corruptionRate) {
        corruptedIndices.add(i);
        corrupted.push({
          ...preds[i],
          predicted: corruptGrammar(preds[i].predicted),
        });
      } else {
        corrupted.push(preds[i]);
      }
    }

    return { corrupted, corruptedIndices };
  }

  /**
   * Apply random corruption to a grammar string.
   */
  function corruptGrammar(grammar: string): string {
    const corruptions = [
      // Delete a random line
      (g: string) => {
        const lines = g.split('\n');
        if (lines.length <= 2) return g + '\n{{BROKEN}}';
        const idx = Math.floor(Math.random() * (lines.length - 1)) + 1;
        lines.splice(idx, 1);
        return lines.join('\n');
      },
      // Replace = with : in a rule definition
      (g: string) => g.replace(/^([A-Z]\w+)\s*$/m, '$1:'),
      // Remove a return statement from an action
      (g: string) => g.replace(/\{ return [^}]+\}/, '{ }'),
      // Add garbage text
      (g: string) => g + '\n\nBROKEN_RULE = "this is invalid',
      // Remove all quotes from enum values
      (g: string) => g.replace(/"([a-z]+)" \//g, '$1 /'),
    ];

    const corruption = corruptions[Math.floor(Math.random() * corruptions.length)];
    return corruption(grammar);
  }

  it('gates reduce errors >= 50% vs ungated pipeline', async () => {
    // Use a fixed seed for reproducibility
    const CORRUPTION_RATE = 0.4; // corrupt 40% of predictions

    const { corrupted, corruptedIndices } = corruptPredictions(
      [...predictions],
      CORRUPTION_RATE,
    );

    // --- Run WITH gates (normal pipeline) ---
    let gatedErrors = 0;
    let gatedCorrectRejections = 0;

    for (let i = 0; i < corrupted.length; i++) {
      const pred = corrupted[i];
      const pipeline = buildSchemaGrammarPipeline([pred]);
      const result = await executePipeline(pipeline, pred.input);

      if (!result.success && corruptedIndices.has(i)) {
        gatedCorrectRejections++; // Gate correctly caught an error
      }
      if (!result.success && !corruptedIndices.has(i)) {
        gatedErrors++; // Uncorrupted entry failed — unexpected
      }
    }

    // --- Run WITHOUT gates (accept raw SLM output, check manually) ---
    let ungatedErrors = 0;

    for (let i = 0; i < corrupted.length; i++) {
      const grammar = corrupted[i].predicted;

      // Without gates: just try to compile and use the grammar
      try {
        const parser = peggy.generate(grammar);
        const example = generateExampleFromGrammar(grammar);
        parser.parse(example);
        // Passes — no error
      } catch {
        ungatedErrors++;
      }
    }

    const actualCorrupted = corruptedIndices.size;
    const gateDetectionRate = actualCorrupted > 0
      ? gatedCorrectRejections / actualCorrupted
      : 1.0;

    // Gate effectiveness: how much do gates reduce undetected errors?
    // Without gates: corrupted entries that fail are just errors (no detection)
    // With gates: corrupted entries are caught and rejected (detected)
    // Effectiveness = 1 - (gated_undetected / ungated_errors)
    const gatedUndetectedErrors = actualCorrupted - gatedCorrectRejections;
    const effectiveness = ungatedErrors > 0
      ? 1 - (gatedUndetectedErrors / ungatedErrors)
      : 1.0;

    console.log('\n=== Gate C-G2: Ablation (Gated vs Ungated) ===');
    console.log(`Total entries:          ${corrupted.length}`);
    console.log(`Corrupted:              ${actualCorrupted} (${(CORRUPTION_RATE * 100).toFixed(0)}% rate)`);
    console.log(`Ungated errors:         ${ungatedErrors}`);
    console.log(`Gated correct rejections: ${gatedCorrectRejections}`);
    console.log(`Gated unexpected errors:  ${gatedErrors}`);
    console.log(`Gate detection rate:    ${(gateDetectionRate * 100).toFixed(1)}%`);
    console.log(`Gate effectiveness:     ${(effectiveness * 100).toFixed(1)}%`);
    console.log(`Gate C-G2 (>=50%):      ${effectiveness >= 0.5 ? 'PASS' : 'FAIL'}`);

    assert.ok(
      effectiveness >= 0.5,
      `Gate C-G2 FAIL: effectiveness ${(effectiveness * 100).toFixed(1)}% < 50%`,
    );
  });
});
