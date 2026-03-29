/**
 * EXP-027 Analysis Script — Statistical analysis of experiment results.
 *
 * Reads JSON results from results/ directory, computes:
 *   1. Per-condition pass rates with Fisher's exact test vs control
 *   2. Token/cycle distributions with Mann-Whitney U test vs control
 *   3. Affect signal distributions per condition
 *   4. Cross-task transfer analysis (T08 Phase 1 vs Phase 2)
 *   5. Summary report with tables
 *
 * Usage:
 *   npx tsx experiments/exp-advanced-patterns/scripts/analyze.ts [--results-dir=path]
 */

import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// ── Types ─────────────────────────────────────────────────────

interface RunResult {
  condition: string;
  task: string;
  run: number;
  success: boolean;
  reason: string;
  tokensUsed: number;
  providerCalls: number;
  durationMs: number;
  cycles: number;
  monitorInterventions: number;
  affectSignals: Array<{ cycle: number; label: string; valence: number; arousal: number }>;
  conflictResolutions: Array<{ resolution: string; cycle: number }>;
  reflectionLessons: number;
  memoryRetrievals: number;
  configUsed: string;
}

// ── Fisher's Exact Test (2x2) ─────────────────────────────────
//
// For small sample sizes, Fisher's exact test is more appropriate
// than chi-squared. Computes exact p-value for a 2x2 contingency table.

function logFactorial(n: number): number {
  let sum = 0;
  for (let i = 2; i <= n; i++) sum += Math.log(i);
  return sum;
}

function hypergeometricPmf(a: number, b: number, c: number, d: number): number {
  const n = a + b + c + d;
  return Math.exp(
    logFactorial(a + b) + logFactorial(c + d) +
    logFactorial(a + c) + logFactorial(b + d) -
    logFactorial(n) -
    logFactorial(a) - logFactorial(b) -
    logFactorial(c) - logFactorial(d),
  );
}

/**
 * Fisher's exact test (two-sided) for 2x2 contingency table:
 *
 *              Success  Failure
 * Condition:     a        b
 * Control:       c        d
 *
 * Returns p-value.
 */
function fisherExact(a: number, b: number, c: number, d: number): number {
  const observed = hypergeometricPmf(a, b, c, d);
  const rowA = a + b;
  const rowC = c + d;
  const colSuccess = a + c;

  let pValue = 0;
  const minA = Math.max(0, colSuccess - rowC);
  const maxA = Math.min(rowA, colSuccess);

  for (let i = minA; i <= maxA; i++) {
    const j = rowA - i;
    const k = colSuccess - i;
    const l = rowC - k;
    if (j < 0 || k < 0 || l < 0) continue;
    const p = hypergeometricPmf(i, j, k, l);
    if (p <= observed + 1e-10) {
      pValue += p;
    }
  }

  return Math.min(pValue, 1);
}

// ── Mann-Whitney U Test ───────────────────────────────────────
//
// Non-parametric test for comparing two independent samples.
// Returns U statistic and approximate p-value (normal approximation for N>8).

function mannWhitneyU(
  sample1: number[],
  sample2: number[],
): { u: number; z: number; pValue: number } {
  const n1 = sample1.length;
  const n2 = sample2.length;

  if (n1 === 0 || n2 === 0) return { u: 0, z: 0, pValue: 1 };

  // Assign ranks
  const combined = [
    ...sample1.map(v => ({ value: v, group: 1 })),
    ...sample2.map(v => ({ value: v, group: 2 })),
  ].sort((a, b) => a.value - b.value);

  // Handle ties with average ranks
  const ranks: number[] = new Array(combined.length);
  let i = 0;
  while (i < combined.length) {
    let j = i;
    while (j < combined.length && combined[j].value === combined[i].value) j++;
    const avgRank = (i + 1 + j) / 2; // 1-indexed average
    for (let k = i; k < j; k++) ranks[k] = avgRank;
    i = j;
  }

  // Sum ranks for group 1
  let r1 = 0;
  for (let k = 0; k < combined.length; k++) {
    if (combined[k].group === 1) r1 += ranks[k];
  }

  const u1 = r1 - (n1 * (n1 + 1)) / 2;
  const u2 = n1 * n2 - u1;
  const u = Math.min(u1, u2);

  // Normal approximation
  const mu = (n1 * n2) / 2;
  const sigma = Math.sqrt((n1 * n2 * (n1 + n2 + 1)) / 12);
  const z = sigma > 0 ? (u - mu) / sigma : 0;
  const pValue = 2 * (1 - normalCdf(Math.abs(z)));

  return { u, z, pValue };
}

// Standard normal CDF approximation (Abramowitz and Stegun)
function normalCdf(x: number): number {
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x) / Math.SQRT2;

  const t = 1.0 / (1.0 + p * x);
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);

  return 0.5 * (1.0 + sign * y);
}

// ── Result Loading ────────────────────────────────────────────

async function loadResults(resultsDir: string): Promise<RunResult[]> {
  const results: RunResult[] = [];

  let taskDirs: string[];
  try {
    taskDirs = await readdir(resultsDir);
  } catch {
    console.error(`Results directory not found: ${resultsDir}`);
    return [];
  }

  for (const taskDir of taskDirs) {
    const taskPath = resolve(resultsDir, taskDir);
    let files: string[];
    try {
      files = await readdir(taskPath);
    } catch {
      continue;
    }

    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      try {
        const content = await readFile(resolve(taskPath, file), 'utf8');
        results.push(JSON.parse(content));
      } catch (err) {
        console.warn(`Failed to load ${file}: ${err}`);
      }
    }
  }

  return results;
}

// ── Analysis ──────────────────────────────────────────────────

function analyzeResults(results: RunResult[]): void {
  const conditions = ['A', 'B', 'C', 'D', 'E'];
  const tasks = [...new Set(results.map(r => r.task))].sort();

  console.log('=== EXP-027 Analysis: Advanced Cognitive Patterns ===\n');
  console.log(`Total runs: ${results.length}`);
  console.log(`Tasks: ${tasks.join(', ')}`);
  console.log(`Conditions: ${conditions.filter(c => results.some(r => r.condition === c)).join(', ')}`);

  // ── 1. Pass Rates ────────────────────────────────────────────

  console.log('\n--- 1. Task Success Rates ---\n');
  console.log('Task'.padEnd(40) + conditions.map(c => c.padStart(8)).join(''));

  for (const task of tasks) {
    const row = [task.padEnd(40)];
    for (const cond of conditions) {
      const condResults = results.filter(r => r.condition === cond && r.task === task);
      if (condResults.length === 0) {
        row.push('   -   ');
        continue;
      }
      const passes = condResults.filter(r => r.success).length;
      row.push(`${passes}/${condResults.length}`.padStart(8));
    }
    console.log(row.join(''));
  }

  // Overall
  const overallRow = ['OVERALL'.padEnd(40)];
  for (const cond of conditions) {
    const condResults = results.filter(r => r.condition === cond);
    if (condResults.length === 0) { overallRow.push('   -   '); continue; }
    const passes = condResults.filter(r => r.success).length;
    const rate = (passes / condResults.length * 100).toFixed(0);
    overallRow.push(`${passes}/${condResults.length} (${rate}%)`.padStart(8));
  }
  console.log(overallRow.join(''));

  // ── 2. Fisher's Exact Tests (vs Control) ──────────────────────

  console.log('\n--- 2. Fisher\'s Exact Test: Each Condition vs Control (A) ---\n');
  console.log('Task'.padEnd(40) + ['B vs A', 'C vs A', 'D vs A', 'E vs A'].map(s => s.padStart(12)).join(''));

  const alpha = 0.05 / 4; // Bonferroni correction for 4 comparisons

  for (const task of tasks) {
    const controlResults = results.filter(r => r.condition === 'A' && r.task === task);
    if (controlResults.length === 0) continue;

    const controlPass = controlResults.filter(r => r.success).length;
    const controlFail = controlResults.length - controlPass;

    const row = [task.padEnd(40)];
    for (const cond of ['B', 'C', 'D', 'E']) {
      const condResults = results.filter(r => r.condition === cond && r.task === task);
      if (condResults.length === 0) { row.push('      -     '); continue; }

      const condPass = condResults.filter(r => r.success).length;
      const condFail = condResults.length - condPass;

      const p = fisherExact(condPass, condFail, controlPass, controlFail);
      const sig = p < alpha ? '*' : ' ';
      row.push(`p=${p.toFixed(3)}${sig}`.padStart(12));
    }
    console.log(row.join(''));
  }
  console.log(`\n  * = significant at Bonferroni-corrected alpha = ${alpha.toFixed(4)}`);

  // ── 3. Token Usage Comparison ─────────────────────────────────

  console.log('\n--- 3. Token Usage (Mean +/- SD) ---\n');
  console.log('Condition'.padEnd(12) + 'Mean Tokens'.padStart(14) + 'SD'.padStart(10) + 'vs A'.padStart(12));

  const controlTokens = results.filter(r => r.condition === 'A').map(r => r.tokensUsed);
  const controlMean = controlTokens.length > 0
    ? controlTokens.reduce((a, b) => a + b, 0) / controlTokens.length
    : 0;

  for (const cond of conditions) {
    const tokens = results.filter(r => r.condition === cond).map(r => r.tokensUsed);
    if (tokens.length === 0) continue;

    const mean = tokens.reduce((a, b) => a + b, 0) / tokens.length;
    const sd = Math.sqrt(tokens.reduce((sum, t) => sum + (t - mean) ** 2, 0) / Math.max(tokens.length - 1, 1));
    const ratio = controlMean > 0 ? (mean / controlMean).toFixed(2) + 'x' : '-';

    console.log(
      cond.padEnd(12) +
      Math.round(mean).toString().padStart(14) +
      Math.round(sd).toString().padStart(10) +
      ratio.padStart(12),
    );
  }

  // Mann-Whitney U for token usage
  if (controlTokens.length >= 2) {
    console.log('\n  Mann-Whitney U (tokens vs control A):');
    for (const cond of ['B', 'C', 'D', 'E']) {
      const tokens = results.filter(r => r.condition === cond).map(r => r.tokensUsed);
      if (tokens.length < 2) continue;
      const { u, z, pValue } = mannWhitneyU(tokens, controlTokens);
      console.log(`    ${cond} vs A: U=${u.toFixed(0)}, z=${z.toFixed(2)}, p=${pValue.toFixed(3)}`);
    }
  }

  // ── 4. Cycles to Completion ───────────────────────────────────

  console.log('\n--- 4. Cycles to Completion (Mean) ---\n');
  console.log('Condition'.padEnd(12) + 'Mean Cycles'.padStart(14) + 'Mean Interventions'.padStart(20));

  for (const cond of conditions) {
    const condResults = results.filter(r => r.condition === cond);
    if (condResults.length === 0) continue;

    const meanCycles = condResults.reduce((s, r) => s + r.cycles, 0) / condResults.length;
    const meanInterventions = condResults.reduce((s, r) => s + r.monitorInterventions, 0) / condResults.length;

    console.log(
      cond.padEnd(12) +
      meanCycles.toFixed(1).padStart(14) +
      meanInterventions.toFixed(1).padStart(20),
    );
  }

  // ── 5. Affect Signal Distribution ─────────────────────────────

  const affectConditions = results.filter(r => r.affectSignals && r.affectSignals.length > 0);
  if (affectConditions.length > 0) {
    console.log('\n--- 5. Affect Signal Distribution ---\n');
    const labels = ['confident', 'anxious', 'frustrated', 'curious', 'neutral'];

    for (const cond of conditions) {
      const condResults = results.filter(r => r.condition === cond);
      const allSignals = condResults.flatMap(r => r.affectSignals ?? []);
      if (allSignals.length === 0) continue;

      console.log(`  Condition ${cond} (${allSignals.length} signals):`);
      for (const label of labels) {
        const count = allSignals.filter(s => s.label === label).length;
        const pct = ((count / allSignals.length) * 100).toFixed(1);
        console.log(`    ${label.padEnd(12)} ${count} (${pct}%)`);
      }
    }
  }

  // ── 6. Reflection & Memory Analysis ───────────────────────────

  const reflectConditions = results.filter(r => r.reflectionLessons > 0 || r.memoryRetrievals > 0);
  if (reflectConditions.length > 0) {
    console.log('\n--- 6. Reflection & Memory ---\n');
    for (const cond of conditions) {
      const condResults = results.filter(r => r.condition === cond);
      if (condResults.length === 0) continue;

      const totalLessons = condResults.reduce((s, r) => s + r.reflectionLessons, 0);
      const totalRetrievals = condResults.reduce((s, r) => s + r.memoryRetrievals, 0);
      if (totalLessons === 0 && totalRetrievals === 0) continue;

      console.log(`  Condition ${cond}: ${totalLessons} lessons produced, ${totalRetrievals} memory retrievals`);
    }
  }

  // ── 7. T08 Cross-Task Transfer ────────────────────────────────

  const t08Phase1 = results.filter(r => r.task === 'cross-task-transfer-phase1');
  const t08Phase2 = results.filter(r => r.task === 'cross-task-transfer-phase2');

  if (t08Phase1.length > 0 && t08Phase2.length > 0) {
    console.log('\n--- 7. T08 Cross-Task Transfer ---\n');

    for (const cond of conditions) {
      const p1 = t08Phase1.filter(r => r.condition === cond);
      const p2 = t08Phase2.filter(r => r.condition === cond);
      if (p1.length === 0 || p2.length === 0) continue;

      const p1Pass = p1.filter(r => r.success).length;
      const p2Pass = p2.filter(r => r.success).length;
      const p2Retrievals = p2.reduce((s, r) => s + r.memoryRetrievals, 0);

      console.log(`  Condition ${cond}:`);
      console.log(`    Phase 1 (5-cycle budget): ${p1Pass}/${p1.length} PASS`);
      console.log(`    Phase 2 (15-cycle, same memory): ${p2Pass}/${p2.length} PASS`);
      console.log(`    Phase 2 memory retrievals: ${p2Retrievals}`);
    }
  }

  // ── Estimated Cost ────────────────────────────────────────────

  const totalTokens = results.reduce((s, r) => s + r.tokensUsed, 0);
  const estCost = (totalTokens / 1_000_000) * 5.4;
  console.log(`\n--- Cost ---`);
  console.log(`  Total tokens: ${Math.round(totalTokens / 1000)}K`);
  console.log(`  Estimated cost: $${estCost.toFixed(2)}`);
}

// ── Main ──────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const resultsDir = args.find(a => a.startsWith('--results-dir='))?.split('=')[1]
    ?? resolve(import.meta.dirname ?? '.', '../results');

  const results = await loadResults(resultsDir);

  if (results.length === 0) {
    console.log('No results found. Run the experiment first:');
    console.log('  npx tsx experiments/exp-advanced-patterns/scripts/run.ts');
    return;
  }

  analyzeResults(results);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
