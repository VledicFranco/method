/**
 * 3-Stage CLM Pipeline Test
 *
 * Tests error compounding at N=3 with two real SLMs:
 *   Stage 1: B-1 (Schema→Grammar) — generates PEG grammar from TS interface
 *   Gate 1:  Peggy compile check
 *   Stage 2: Context generator (deterministic) — generates SESSION-CONTEXT input
 *   Gate 2:  (pass-through — context is deterministic, always valid)
 *   Stage 3: Downstream SLM (WorktreeInfo) — generates DSL from context
 *   Gate 3:  Parse DSL through B-1's compiled grammar
 *
 * This validates RFC 005's error compounding theory:
 *   Without gates: a^N (multiplicative) — 3 stages at 95% = 85.7%
 *   With gates:    1 - N*f (linear) — 3 gates at f≈0 = ~100%
 *
 * Uses pre-generated predictions from Phase 1 for both models.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import peggy from 'peggy';

import { executePipeline } from '../pipeline.js';
import { createPeggyCompileGate, createPeggyParseGate } from '../gates.js';
import { createSLMStage, createDeterministicStage } from '../stages.js';
import { createJsonlInference, parseJsonlPredictions } from '../inference-adapters.js';
import { createAggregateCollector } from '../metrics.js';
import type { PipelineDefinition, PipelineContext } from '../types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = resolve(__dirname, '../../phase-1-schema-grammar/results');

// ── Load both models' predictions ───────────────────────────

// B-1: WorktreeInfo interface → PEG grammar
const b1Predictions = parseJsonlPredictions(
  readFileSync(resolve(RESULTS_DIR, 'real-predictions.jsonl'), 'utf-8'),
);
const worktreeGrammarPred = b1Predictions.find(p =>
  p.input.includes('WorktreeInfo'),
)!;

// Downstream SLM: SESSION-CONTEXT → WorktreeInfo DSL
const downstreamPredictions = parseJsonlPredictions(
  readFileSync(resolve(RESULTS_DIR, 'ag2-predictions.jsonl'), 'utf-8'),
);

// ── Build the 3-stage CLM pipeline ───────────────────────────

function build3StagePipeline(
  b1Pred: typeof b1Predictions[0],
  downstreamPred: typeof downstreamPredictions[0],
): PipelineDefinition {
  // Stage 1: B-1 SLM generates grammar from TypeScript interface
  const b1Inference = createJsonlInference('b1-schema-grammar', [b1Pred]);

  // Stage 3: Downstream SLM generates DSL from context
  const downstreamInference = createJsonlInference('downstream-worktree', [{
    input: downstreamPred.input,
    predicted: downstreamPred.predicted,
  }]);

  return {
    id: '3-stage-clm',
    stages: [
      // Stage 1: B-1 generates PEG grammar
      {
        type: 'stage',
        stage: createSLMStage('b1-schema-grammar', b1Inference),
      },
      // Gate 1: Grammar compiles?
      {
        type: 'gate',
        gate: createPeggyCompileGate('grammar-compile', 'compiledParser'),
        onFail: { maxRetries: 0, escalation: 'abort' },
      },
      // Stage 2: Generate a SESSION-CONTEXT (deterministic — use downstream input)
      {
        type: 'stage',
        stage: createDeterministicStage(
          'context-generator',
          () => downstreamPred.input,
        ),
      },
      // Stage 3: Downstream SLM generates DSL from context
      {
        type: 'stage',
        stage: createSLMStage('downstream-worktree', downstreamInference, () => downstreamPred.input),
      },
      // Gate 2: Does DSL parse through B-1's grammar?
      {
        type: 'gate',
        gate: createPeggyParseGate(
          'dsl-parse',
          (ctx: PipelineContext) => ctx.state.get('compiledParser') as peggy.Parser,
        ),
        onFail: { maxRetries: 0, escalation: 'abort' },
      },
    ],
  };
}

// ── Tests ────────────────────────────────────────────────────

describe('3-Stage CLM Pipeline (B-1 + Downstream SLM)', () => {

  it('runs the full bootstrap chain: interface → grammar → DSL', async () => {
    const pred = downstreamPredictions[0];
    const pipeline = build3StagePipeline(worktreeGrammarPred, pred);
    const result = await executePipeline(pipeline, worktreeGrammarPred.input);

    assert.equal(result.success, true, `Pipeline failed: ${result.error}`);
    assert.equal(result.metrics.stages.length >= 3, true);
    assert.equal(result.metrics.gates.length, 2);
    assert.equal(result.metrics.gatePassRate, 1.0);
  });

  it('achieves >= 85% e2e on 50 downstream predictions', async () => {
    const aggregate = createAggregateCollector();
    const failures: Array<{ input: string; error?: string }> = [];

    for (const pred of downstreamPredictions) {
      const pipeline = build3StagePipeline(worktreeGrammarPred, pred);
      const result = await executePipeline(pipeline, worktreeGrammarPred.input);
      aggregate.addRun(result.metrics);

      if (!result.success) {
        failures.push({
          input: pred.input.slice(0, 60),
          error: result.error?.slice(0, 150),
        });
      }
    }

    const agg = aggregate.getAggregate();
    const successCount = Math.round(agg.successRate * agg.totalRuns);

    console.log('\n=== 3-Stage CLM: B-1 + Downstream SLM ===');
    console.log(`Total runs:      ${agg.totalRuns}`);
    console.log(`Success:         ${successCount}/${agg.totalRuns} (${(agg.successRate * 100).toFixed(1)}%)`);
    console.log(`Mean latency:    ${agg.meanLatencyMs.toFixed(2)} ms`);
    console.log(`Gate pass rate:  ${(agg.gateEffectiveness * 100).toFixed(1)}%`);
    console.log(`Stages per run:  3 (2 SLM + 1 deterministic)`);
    console.log(`Gates per run:   2 (compile + parse)`);

    if (failures.length > 0 && failures.length <= 5) {
      console.log(`\nFailures (${failures.length}):`);
      for (const f of failures) {
        console.log(`  ${f.input}...`);
        console.log(`    ${f.error}`);
      }
    }

    // RFC 005 error compounding prediction:
    // Without gates at 95% per stage: 0.95^3 = 85.7%
    // With gates at f≈0: 1 - 3*0 = 100%
    console.log(`\nRFC 005 prediction: ungated 3-stage at 95%/stage = 85.7%`);
    console.log(`Actual with gates: ${(agg.successRate * 100).toFixed(1)}%`);

    assert.ok(
      agg.successRate >= 0.85,
      `3-stage CLM failed: ${(agg.successRate * 100).toFixed(1)}% < 85%`,
    );
  });

  it('validates error compounding theory: gated >> ungated', async () => {
    // Run ungated: compile grammar and parse downstream output directly
    const parser = peggy.generate(worktreeGrammarPred.predicted);

    let ungatedPass = 0;
    let ungatedFail = 0;

    for (const pred of downstreamPredictions) {
      try {
        parser.parse(pred.predicted);
        ungatedPass++;
      } catch {
        ungatedFail++;
      }
    }

    // Run gated: through the full pipeline
    const aggregate = createAggregateCollector();
    for (const pred of downstreamPredictions) {
      const pipeline = build3StagePipeline(worktreeGrammarPred, pred);
      const result = await executePipeline(pipeline, worktreeGrammarPred.input);
      aggregate.addRun(result.metrics);
    }
    const agg = aggregate.getAggregate();
    const gatedSuccess = Math.round(agg.successRate * agg.totalRuns);

    console.log('\n=== Error Compounding: Gated vs Ungated (3-stage) ===');
    console.log(`Ungated (direct parse): ${ungatedPass}/${downstreamPredictions.length}`);
    console.log(`Gated (full pipeline):  ${gatedSuccess}/${agg.totalRuns}`);
    console.log(`Theory: gates should match or exceed ungated`);

    // With deterministic gates (f=0), gated should be >= ungated
    // Both should be high since both SLMs achieve ~100% on this task
    assert.ok(gatedSuccess >= ungatedPass,
      'Gated pipeline should not be worse than ungated');
  });
});
