/**
 * Phase 4 — Baseline comparison script.
 *
 * Reads results from the integration benchmark (integration-eval.json)
 * and the Phase 1 baseline cost report (baseline-cost.json), then
 * computes final comparison metrics against the target gates.
 *
 * Targets:
 * - Token cost reduction on routine tasks: >= 30%
 * - Overall task success rate vs baseline:  >= baseline - 5%
 * - Spearman rho (escalation vs difficulty): >= 0.6
 * - Catastrophic failures:                   0
 *
 * Run: npx tsx experiments/exp-slm/phase-4-integration/scripts/compare-baseline.ts
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// ── Paths ──────────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = join(__dirname, '..', 'results');
const EVAL_PATH = join(RESULTS_DIR, 'integration-eval.json');
const BASELINE_PATH = join(__dirname, '..', '..', 'phase-1-llm-monitor', 'results', 'baseline-cost.json');
const OUTPUT_PATH = join(RESULTS_DIR, 'comparison.json');

// ── Types ──────────────────────────────────────────────────────

interface TaskResult {
  name: string;
  difficulty: number;
  category: 'routine' | 'novel';
  baseline: {
    success: boolean;
    totalTokens: number;
    costUsd: number;
    latencyMs: number;
  };
  slm: {
    success: boolean;
    totalTokens: number;
    costUsd: number;
    latencyMs: number;
    escalated: boolean;
    escalationReason?: string;
  };
}

interface IntegrationEval {
  timestamp: string;
  taskCount: number;
  routineCount: number;
  novelCount: number;
  escalationThreshold: number;
  results: TaskResult[];
  aggregate: {
    baselineSuccessRate: number;
    slmSuccessRate: number;
    routineTokenReductionPct: number;
    overallEscalationRate: number;
    escalationByDifficulty: Array<{ difficulty: number; escalated: number }>;
    spearmanRho: number;
    catastrophicFailures: number;
  };
}

interface BaselineCostReport {
  timestamp: string;
  pricingModel: string;
  inputCostPerToken: number;
  outputCostPerToken: number;
  systemPromptTokens: number;
  summary: {
    totalMeasurements: number;
    avgInputTokens: number;
    avgOutputTokens: number;
    avgTotalTokens: number;
    avgCostPerCallUsd: number;
    avgLatencyMs: number;
    minTotalTokens: number;
    maxTotalTokens: number;
    estimatedCostPer100Calls: number;
    estimatedCostPer1000Calls: number;
  };
}

// ── Main ───────────────────────────────────────────────────────

function main(): void {
  console.log('=== Phase 4 — Baseline Comparison ===\n');

  // Load data
  const evalData: IntegrationEval = JSON.parse(readFileSync(EVAL_PATH, 'utf-8'));
  const baselineData: BaselineCostReport = JSON.parse(readFileSync(BASELINE_PATH, 'utf-8'));

  const { results, aggregate } = evalData;
  const routineResults = results.filter(r => r.category === 'routine');
  // novelResults available via: results.filter(r => r.category === 'novel')

  // ── Cost Reduction on Routine Tasks ──

  const routineBaselineTotalTokens = routineResults.reduce((s, r) => s + r.baseline.totalTokens, 0);
  const routineSlmTotalTokens = routineResults.reduce((s, r) => s + r.slm.totalTokens, 0);
  const routineTokenReduction = routineBaselineTotalTokens > 0
    ? (1 - routineSlmTotalTokens / routineBaselineTotalTokens) * 100
    : 0;

  // Compare against Phase 1 baseline average
  const phase1AvgTokens = baselineData.summary.avgTotalTokens;
  const slmAvgRoutineTokens = routineResults.length > 0
    ? routineSlmTotalTokens / routineResults.length
    : 0;
  const vsPhase1Reduction = phase1AvgTokens > 0
    ? (1 - slmAvgRoutineTokens / phase1AvgTokens) * 100
    : 0;

  // ── Success Rate ──

  const baselineSuccessRate = aggregate.baselineSuccessRate;
  const slmSuccessRate = aggregate.slmSuccessRate;
  const successRateDelta = (slmSuccessRate - baselineSuccessRate) * 100;

  // ── Escalation by Difficulty Tier ──

  const tiers = [
    { name: 'easy (1-3)', tasks: results.filter(r => r.difficulty >= 1 && r.difficulty <= 3) },
    { name: 'medium (4-6)', tasks: results.filter(r => r.difficulty >= 4 && r.difficulty <= 6) },
    { name: 'hard (7-8)', tasks: results.filter(r => r.difficulty >= 7 && r.difficulty <= 8) },
    { name: 'extreme (9-10)', tasks: results.filter(r => r.difficulty >= 9 && r.difficulty <= 10) },
  ];

  const escalationByTier = tiers.map(tier => ({
    tier: tier.name,
    taskCount: tier.tasks.length,
    escalated: tier.tasks.filter(t => t.slm.escalated).length,
    rate: tier.tasks.length > 0
      ? tier.tasks.filter(t => t.slm.escalated).length / tier.tasks.length
      : 0,
  }));

  // ── Gate Checks ──

  const gates = {
    routineCostReduction: {
      target: '>=30%',
      actual: `${routineTokenReduction.toFixed(1)}%`,
      pass: routineTokenReduction >= 30,
    },
    successRateVsBaseline: {
      target: '>= baseline - 5%',
      actual: `${(slmSuccessRate * 100).toFixed(0)}% (baseline: ${(baselineSuccessRate * 100).toFixed(0)}%, delta: ${successRateDelta >= 0 ? '+' : ''}${successRateDelta.toFixed(0)}pp)`,
      pass: slmSuccessRate >= baselineSuccessRate - 0.05,
    },
    spearmanRho: {
      target: '>=0.6',
      actual: `${aggregate.spearmanRho.toFixed(3)}`,
      pass: aggregate.spearmanRho >= 0.6,
    },
    catastrophicFailures: {
      target: '0',
      actual: `${aggregate.catastrophicFailures}`,
      pass: aggregate.catastrophicFailures === 0,
    },
  };

  const allPass = Object.values(gates).every(g => g.pass);

  // ── Build Comparison Report ──

  const comparison = {
    timestamp: new Date().toISOString(),
    phase1Baseline: {
      avgTotalTokens: phase1AvgTokens,
      avgCostPerCall: baselineData.summary.avgCostPerCallUsd,
      tokenRange: `${baselineData.summary.minTotalTokens}-${baselineData.summary.maxTotalTokens}`,
    },
    phase4Results: {
      taskCount: evalData.taskCount,
      routineCount: evalData.routineCount,
      novelCount: evalData.novelCount,
      escalationThreshold: evalData.escalationThreshold,
      baselineSuccessRate: Math.round(baselineSuccessRate * 1000) / 1000,
      slmSuccessRate: Math.round(slmSuccessRate * 1000) / 1000,
      routineTokenReductionPct: Math.round(routineTokenReduction * 100) / 100,
      vsPhase1ReductionPct: Math.round(vsPhase1Reduction * 100) / 100,
      overallEscalationRate: aggregate.overallEscalationRate,
      spearmanRho: aggregate.spearmanRho,
      catastrophicFailures: aggregate.catastrophicFailures,
    },
    escalationByTier,
    gates,
    allGatesPass: allPass,
  };

  // Write
  mkdirSync(RESULTS_DIR, { recursive: true });
  writeFileSync(OUTPUT_PATH, JSON.stringify(comparison, null, 2) + '\n', 'utf-8');

  // ── Console Summary ──

  console.log('  Phase 1 Baseline:');
  console.log(`    Avg tokens/call:   ${phase1AvgTokens}`);
  console.log(`    Avg cost/call:     $${baselineData.summary.avgCostPerCallUsd.toFixed(6)}`);
  console.log(`    Token range:       ${baselineData.summary.minTotalTokens}-${baselineData.summary.maxTotalTokens}`);

  console.log('\n  Phase 4 Integration:');
  console.log(`    Tasks:             ${evalData.taskCount} (${evalData.routineCount} routine + ${evalData.novelCount} novel)`);
  console.log(`    Baseline success:  ${(baselineSuccessRate * 100).toFixed(0)}%`);
  console.log(`    SLM success:       ${(slmSuccessRate * 100).toFixed(0)}%`);
  console.log(`    Routine cost red:  ${routineTokenReduction.toFixed(1)}%`);
  console.log(`    vs Phase 1 red:    ${vsPhase1Reduction.toFixed(1)}%`);
  console.log(`    Escalation rate:   ${(aggregate.overallEscalationRate * 100).toFixed(0)}%`);
  console.log(`    Spearman rho:      ${aggregate.spearmanRho.toFixed(3)}`);
  console.log(`    Catastrophic:      ${aggregate.catastrophicFailures}`);

  console.log('\n  Escalation by Tier:');
  console.log('    +-----------------+-------+-----------+--------+');
  console.log('    | Tier            | Tasks | Escalated | Rate   |');
  console.log('    +-----------------+-------+-----------+--------+');
  for (const tier of escalationByTier) {
    const name = tier.tier.padEnd(15);
    const tasks = String(tier.taskCount).padStart(5);
    const esc = String(tier.escalated).padStart(9);
    const rate = `${(tier.rate * 100).toFixed(0)}%`.padStart(5);
    console.log(`    | ${name} | ${tasks} | ${esc} | ${rate}  |`);
  }
  console.log('    +-----------------+-------+-----------+--------+');

  console.log('\n  Gate Results:');
  for (const [gate, result] of Object.entries(gates)) {
    const status = result.pass ? 'PASS' : 'FAIL';
    console.log(`    [${status}] ${gate}: ${result.actual} (target: ${result.target})`);
  }
  console.log(`\n  Overall: ${allPass ? 'ALL GATES PASS' : 'SOME GATES FAILED'}`);
  console.log(`\n  Comparison written to: ${OUTPUT_PATH}`);
}

main();
