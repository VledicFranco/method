/**
 * EXP-025 Analysis Script — Statistical analysis of workspace efficiency results.
 *
 * Reads JSON result batches from experiments/exp-workspace-efficiency/results/
 * and produces:
 *   1. Token efficiency summary table (mean, median, IQR per condition)
 *   2. Success rate comparison with Fisher's exact test (2x2)
 *   3. Token savings paired comparison with Wilcoxon signed-rank test
 *   4. Eviction quality analysis (salience of evicted entries)
 *   5. Per-task breakdown
 *   6. CSV export for further analysis
 *
 * Usage:
 *   npx tsx experiments/exp-workspace-efficiency/scripts/analyze.ts [results-file.json]
 *
 * If no file specified, reads all batch-*.json files from results/.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

// ── Types ─────────────────────────────────────────────────────────

interface RunResult {
  experiment: string;
  condition: string;
  conditionName: string;
  task: string;
  taskIndex: number;
  run: number;
  success: boolean;
  reason: string;
  tokensUsed: number;
  providerCalls: number;
  durationMs: number;
  cyclesCompleted: number;
  evictionCount: number;
  evictionSalienceMean: number;
  evictionSalienceMax: number;
  monitorInterventions: number;
  workspaceEntriesAtEnd: number;
  timestamp: string;
}

// ── Load Results ──────────────────────────────────────────────────

function loadResults(args: string[]): RunResult[] {
  const resultsDir = resolve(import.meta.dirname ?? '.', '../results');

  if (args.length > 0) {
    // Specific file
    const filePath = resolve(args[0]);
    const content = readFileSync(filePath, 'utf8');
    return JSON.parse(content) as RunResult[];
  }

  // Load all batch files
  const files = readdirSync(resultsDir)
    .filter(f => f.startsWith('batch-') && f.endsWith('.json'))
    .sort();

  if (files.length === 0) {
    console.error('No result files found in', resultsDir);
    process.exit(1);
  }

  const allResults: RunResult[] = [];
  for (const file of files) {
    const content = readFileSync(resolve(resultsDir, file), 'utf8');
    const batch = JSON.parse(content) as RunResult[];
    allResults.push(...batch);
    console.log(`Loaded ${batch.length} results from ${file}`);
  }

  return allResults;
}

// ── Statistical Helpers ───────────────────────────────────────────

function mean(arr: number[]): number {
  return arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
}

function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function stddev(arr: number[]): number {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  const variance = arr.reduce((sum, x) => sum + (x - m) ** 2, 0) / (arr.length - 1);
  return Math.sqrt(variance);
}

function iqr(arr: number[]): { q1: number; q3: number; iqr: number } {
  const sorted = [...arr].sort((a, b) => a - b);
  const q1Idx = Math.floor(sorted.length * 0.25);
  const q3Idx = Math.floor(sorted.length * 0.75);
  const q1 = sorted[q1Idx] ?? 0;
  const q3 = sorted[q3Idx] ?? 0;
  return { q1, q3, iqr: q3 - q1 };
}

/**
 * Wilcoxon signed-rank test (approximate, for paired samples).
 *
 * Tests whether the median difference between paired observations is zero.
 * Returns Z-statistic and approximate p-value.
 *
 * Simplified implementation — for N >= 10, uses normal approximation.
 * For production use, consider a stats library.
 */
function wilcoxonSignedRank(
  x: number[],
  y: number[],
): { z: number; p: number; n: number } {
  if (x.length !== y.length) throw new Error('Arrays must be same length');

  const diffs = x.map((xi, i) => xi - y[i]).filter(d => d !== 0);
  const n = diffs.length;

  if (n === 0) return { z: 0, p: 1, n: 0 };

  // Rank absolute differences
  const absDiffs = diffs.map((d, i) => ({ abs: Math.abs(d), sign: d > 0 ? 1 : -1, idx: i }));
  absDiffs.sort((a, b) => a.abs - b.abs);

  // Assign ranks (average ties)
  let rank = 1;
  let i = 0;
  while (i < absDiffs.length) {
    let j = i;
    while (j < absDiffs.length && absDiffs[j].abs === absDiffs[i].abs) j++;
    const avgRank = (rank + rank + (j - i - 1)) / 2;
    for (let k = i; k < j; k++) {
      (absDiffs[k] as any).rank = avgRank;
    }
    rank += j - i;
    i = j;
  }

  // Sum of positive ranks
  const wPlus = absDiffs
    .filter(d => d.sign > 0)
    .reduce((sum, d) => sum + ((d as any).rank as number), 0);

  // Normal approximation
  const expectedW = n * (n + 1) / 4;
  const varW = n * (n + 1) * (2 * n + 1) / 24;
  const z = (wPlus - expectedW) / Math.sqrt(varW);
  const p = 2 * (1 - normalCDF(Math.abs(z)));

  return { z, p, n };
}

/**
 * Standard normal CDF approximation (Abramowitz & Stegun).
 */
function normalCDF(z: number): number {
  if (z < -8) return 0;
  if (z > 8) return 1;

  const b1 = 0.319381530;
  const b2 = -0.356563782;
  const b3 = 1.781477937;
  const b4 = -1.821255978;
  const b5 = 1.330274429;
  const p = 0.2316419;

  const t = 1 / (1 + p * Math.abs(z));
  const pdf = Math.exp(-z * z / 2) / Math.sqrt(2 * Math.PI);
  const cdf = 1 - pdf * (b1 * t + b2 * t ** 2 + b3 * t ** 3 + b4 * t ** 4 + b5 * t ** 5);

  return z >= 0 ? cdf : 1 - cdf;
}

/**
 * Fisher's exact test (2x2, two-sided) — approximate via chi-squared for larger N.
 */
function fisherExact(
  a: number, b: number, c: number, d: number,
): { chiSq: number; p: number } {
  const n = a + b + c + d;
  if (n === 0) return { chiSq: 0, p: 1 };

  // Yates-corrected chi-squared
  const numerator = n * (Math.abs(a * d - b * c) - n / 2) ** 2;
  const denom = (a + b) * (c + d) * (a + c) * (b + d);
  if (denom === 0) return { chiSq: 0, p: 1 };

  const chiSq = numerator / denom;
  // Approximate p-value from chi-squared with 1 df
  const p = 1 - chiSquaredCDF(chiSq, 1);

  return { chiSq, p };
}

/**
 * Chi-squared CDF approximation (1 df) via standard normal.
 */
function chiSquaredCDF(x: number, df: number): number {
  if (df !== 1) throw new Error('Only df=1 supported');
  if (x <= 0) return 0;
  return 2 * normalCDF(Math.sqrt(x)) - 1;
}

/**
 * Cohen's d effect size for two independent samples.
 */
function cohensD(group1: number[], group2: number[]): number {
  const m1 = mean(group1);
  const m2 = mean(group2);
  const s1 = stddev(group1);
  const s2 = stddev(group2);
  const pooledStd = Math.sqrt(((group1.length - 1) * s1 ** 2 + (group2.length - 1) * s2 ** 2) /
    (group1.length + group2.length - 2));
  return pooledStd > 0 ? (m1 - m2) / pooledStd : 0;
}

// ── Analysis ──────────────────────────────────────────────────────

function analyze(results: RunResult[]): void {
  const conditions = [...new Set(results.map(r => r.condition))].sort();
  const tasks = [...new Set(results.map(r => r.task))];

  console.log(`\n${'='.repeat(80)}`);
  console.log(`  EXP-025: Workspace Efficiency Analysis`);
  console.log(`  ${results.length} results across ${conditions.length} conditions, ${tasks.length} tasks`);
  console.log(`${'='.repeat(80)}\n`);

  // ── 1. Token Efficiency Table ─────────────────────────────────

  console.log('1. TOKEN EFFICIENCY BY CONDITION\n');

  const conditionGroups = new Map<string, RunResult[]>();
  for (const r of results) {
    const list = conditionGroups.get(r.condition) || [];
    list.push(r);
    conditionGroups.set(r.condition, list);
  }

  const baselineTokens = conditionGroups.get('A')?.map(r => r.tokensUsed) ?? [];
  const baselineMedian = median(baselineTokens);

  console.log(
    'Cond'.padEnd(6) +
    'Name'.padEnd(20) +
    'N'.padStart(5) +
    'Mean'.padStart(10) +
    'Median'.padStart(10) +
    'SD'.padStart(10) +
    'IQR'.padStart(12) +
    'Savings'.padStart(10) +
    'Success'.padStart(10)
  );
  console.log('-'.repeat(93));

  for (const cond of conditions) {
    const runs = conditionGroups.get(cond) ?? [];
    const tokens = runs.map(r => r.tokensUsed);
    const successes = runs.filter(r => r.success).length;
    const { q1, q3 } = iqr(tokens);
    const med = median(tokens);
    const savings = baselineMedian > 0
      ? ((1 - med / baselineMedian) * 100).toFixed(1) + '%'
      : 'n/a';

    const name = runs[0]?.conditionName ?? '?';
    console.log(
      cond.padEnd(6) +
      name.padEnd(20) +
      String(runs.length).padStart(5) +
      mean(tokens).toFixed(0).padStart(10) +
      med.toFixed(0).padStart(10) +
      stddev(tokens).toFixed(0).padStart(10) +
      `${q1.toFixed(0)}-${q3.toFixed(0)}`.padStart(12) +
      savings.padStart(10) +
      `${successes}/${runs.length}`.padStart(10)
    );
  }

  // ── 2. Pairwise Token Comparison vs A (Wilcoxon) ──────────────

  console.log('\n\n2. PAIRWISE TOKEN COMPARISON vs CONDITION A (Wilcoxon signed-rank)\n');

  const baselineA = conditionGroups.get('A') ?? [];
  const bonferroniAlpha = 0.05 / (conditions.length - 1);

  for (const cond of conditions) {
    if (cond === 'A') continue;
    const condRuns = conditionGroups.get(cond) ?? [];

    // Pair by task+run number
    const pairs: { a: number; b: number }[] = [];
    for (const bRun of condRuns) {
      const aRun = baselineA.find(
        r => r.task === bRun.task && r.run === bRun.run
      );
      if (aRun) {
        pairs.push({ a: aRun.tokensUsed, b: bRun.tokensUsed });
      }
    }

    if (pairs.length < 5) {
      console.log(`  ${cond}: Insufficient paired data (${pairs.length} pairs)`);
      continue;
    }

    const result = wilcoxonSignedRank(
      pairs.map(p => p.a),
      pairs.map(p => p.b),
    );
    const d = cohensD(
      pairs.map(p => p.a),
      pairs.map(p => p.b),
    );
    const sig = result.p < bonferroniAlpha ? '*' : '';

    console.log(
      `  A vs ${cond}: Z=${result.z.toFixed(3)}, p=${result.p.toFixed(4)}${sig}, ` +
      `d=${d.toFixed(3)}, n=${result.n} pairs` +
      (sig ? ` (significant at Bonferroni-adjusted alpha=${bonferroniAlpha.toFixed(4)})` : '')
    );
  }

  // ── 3. Success Rate Comparison ────────────────────────────────

  console.log('\n\n3. SUCCESS RATE COMPARISON (Fisher exact / chi-squared)\n');

  const baselineSuccesses = baselineA.filter(r => r.success).length;
  const baselineFailures = baselineA.length - baselineSuccesses;

  for (const cond of conditions) {
    if (cond === 'A') continue;
    const condRuns = conditionGroups.get(cond) ?? [];
    const condSuccesses = condRuns.filter(r => r.success).length;
    const condFailures = condRuns.length - condSuccesses;

    const test = fisherExact(
      baselineSuccesses, baselineFailures,
      condSuccesses, condFailures,
    );
    const sig = test.p < bonferroniAlpha ? '*' : '';

    const baselineRate = baselineA.length > 0 ? (baselineSuccesses / baselineA.length * 100).toFixed(1) : '?';
    const condRate = condRuns.length > 0 ? (condSuccesses / condRuns.length * 100).toFixed(1) : '?';

    console.log(
      `  A (${baselineRate}%) vs ${cond} (${condRate}%): ` +
      `chi2=${test.chiSq.toFixed(3)}, p=${test.p.toFixed(4)}${sig}`
    );
  }

  // ── 4. Eviction Analysis ──────────────────────────────────────

  console.log('\n\n4. EVICTION ANALYSIS\n');
  console.log(
    'Cond'.padEnd(6) +
    'Evictions(mean)'.padStart(17) +
    'Evict.Sal(mean)'.padStart(17) +
    'Evict.Sal(max)'.padStart(16) +
    'WS.Entries(end)'.padStart(17)
  );
  console.log('-'.repeat(73));

  for (const cond of conditions) {
    const runs = conditionGroups.get(cond) ?? [];
    console.log(
      cond.padEnd(6) +
      mean(runs.map(r => r.evictionCount)).toFixed(1).padStart(17) +
      mean(runs.map(r => r.evictionSalienceMean)).toFixed(3).padStart(17) +
      mean(runs.map(r => r.evictionSalienceMax)).toFixed(3).padStart(16) +
      mean(runs.map(r => r.workspaceEntriesAtEnd)).toFixed(1).padStart(17)
    );
  }

  // ── 5. Per-Task Breakdown ─────────────────────────────────────

  console.log('\n\n5. PER-TASK TOKEN USAGE (median)\n');

  const header = 'Task'.padEnd(30) + conditions.map(c => c.padStart(10)).join('');
  console.log(header);
  console.log('-'.repeat(30 + conditions.length * 10));

  for (const task of tasks) {
    let row = task.padEnd(30);
    for (const cond of conditions) {
      const taskRuns = conditionGroups.get(cond)?.filter(r => r.task === task) ?? [];
      const med = taskRuns.length > 0 ? median(taskRuns.map(r => r.tokensUsed)) : 0;
      row += med.toFixed(0).padStart(10);
    }
    console.log(row);
  }

  console.log('\n\n5b. PER-TASK SUCCESS RATE\n');

  const header2 = 'Task'.padEnd(30) + conditions.map(c => c.padStart(10)).join('');
  console.log(header2);
  console.log('-'.repeat(30 + conditions.length * 10));

  for (const task of tasks) {
    let row = task.padEnd(30);
    for (const cond of conditions) {
      const taskRuns = conditionGroups.get(cond)?.filter(r => r.task === task) ?? [];
      const successes = taskRuns.filter(r => r.success).length;
      const rate = taskRuns.length > 0 ? `${successes}/${taskRuns.length}` : 'n/a';
      row += rate.padStart(10);
    }
    console.log(row);
  }

  // ── 6. CSV Export ─────────────────────────────────────────────

  const csvPath = resolve(import.meta.dirname ?? '.', '../results/analysis.csv');
  const csvHeader = [
    'condition', 'conditionName', 'task', 'run', 'success', 'tokensUsed',
    'providerCalls', 'durationMs', 'cyclesCompleted', 'evictionCount',
    'evictionSalienceMean', 'evictionSalienceMax', 'monitorInterventions',
    'workspaceEntriesAtEnd',
  ].join(',');

  const csvRows = results.map(r => [
    r.condition, r.conditionName, r.task, r.run, r.success ? 1 : 0, r.tokensUsed,
    r.providerCalls, r.durationMs, r.cyclesCompleted, r.evictionCount,
    r.evictionSalienceMean.toFixed(4), r.evictionSalienceMax.toFixed(4),
    r.monitorInterventions, r.workspaceEntriesAtEnd,
  ].join(','));

  writeFileSync(csvPath, [csvHeader, ...csvRows].join('\n'), 'utf8');
  console.log(`\nCSV exported to: ${csvPath}`);
}

// ── Main ──────────────────────────────────────────────────────────

const results = loadResults(process.argv.slice(2));
analyze(results);
