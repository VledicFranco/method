/**
 * Phase 4 — Integration benchmark.
 *
 * Creates 10 benchmark tasks (5 routine + 5 novel), runs each through BOTH
 * the LLM Monitor v2 baseline and the SLM Monitor v2 (decorator), then
 * records per-task results and computes aggregate statistics.
 *
 * Uses MOCKS throughout — no running model server or LLM required.
 *
 * Run: npx tsx experiments/exp-slm/phase-4-integration/scripts/run-benchmark.ts
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSLMProviderAdapter } from '../src/slm-provider-adapter.js';
import { createMockSLMInference } from '../src/slm-inference.js';
import type { SLMResult } from '../src/slm-inference.js';
import { createLlmMonitor } from '../../phase-1-llm-monitor/src/llm-monitor.js';
import { buildMonitorUserPrompt } from '../../phase-1-llm-monitor/src/llm-monitor-prompt.js';
import type {
  ProviderAdapter,
  ProviderAdapterResult,
  AggregatedSignals,
  MonitoringSignal,
  MonitorReport,
  NoControl,
  TokenUsage,
} from '../../phase-1-llm-monitor/src/types.js';
import { moduleId } from '../../phase-1-llm-monitor/src/types.js';

// ── Paths ──────────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = join(__dirname, '..', 'results');
const OUTPUT_PATH = join(RESULTS_DIR, 'integration-eval.json');

// ── Token Estimation ───────────────────────────────────────────

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

// ── Benchmark Tasks ────────────────────────────────────────────

export interface BenchmarkTask {
  name: string;
  difficulty: number;          // 1-10 (routine=1-5, novel=6-10)
  category: 'routine' | 'novel';
  signals: AggregatedSignals;
  /** The "correct" expected report for this task. */
  expectedReport: MonitorReport;
}

export function buildBenchmarkTasks(): BenchmarkTask[] {
  const tasks: BenchmarkTask[] = [];

  // ── 5 Routine Tasks (difficulty 1-5) ──

  // R1: All normal, high confidence — simplest possible
  const r1signals: AggregatedSignals = new Map();
  r1signals.set(moduleId('reasoner'), {
    type: 'reasoner', source: moduleId('reasoner'), timestamp: Date.now(),
    confidence: 0.92, conflictDetected: false, effortLevel: 'low',
  } as unknown as MonitoringSignal);
  r1signals.set(moduleId('actor'), {
    type: 'actor', source: moduleId('actor'), timestamp: Date.now(),
    actionTaken: 'Edit', success: true, unexpectedResult: false,
  } as unknown as MonitoringSignal);
  tasks.push({
    name: 'routine-normal-high-conf',
    difficulty: 1,
    category: 'routine',
    signals: r1signals,
    expectedReport: { anomalies: [], escalation: undefined, restrictedActions: [], forceReplan: false },
  });

  // R2: Empty signals — no modules reporting
  tasks.push({
    name: 'routine-empty-signals',
    difficulty: 2,
    category: 'routine',
    signals: new Map(),
    expectedReport: { anomalies: [], escalation: undefined, restrictedActions: [], forceReplan: false },
  });

  // R3: Single low-confidence reasoner — clear anomaly
  const r3signals: AggregatedSignals = new Map();
  r3signals.set(moduleId('reasoner'), {
    type: 'reasoner', source: moduleId('reasoner'), timestamp: Date.now(),
    confidence: 0.15, conflictDetected: false, effortLevel: 'high',
  } as unknown as MonitoringSignal);
  tasks.push({
    name: 'routine-low-confidence',
    difficulty: 3,
    category: 'routine',
    signals: r3signals,
    expectedReport: {
      anomalies: [{ moduleId: moduleId('reasoner'), type: 'low-confidence', detail: 'Confidence 0.15 below threshold 0.3' }],
      escalation: undefined,
      restrictedActions: [],
      forceReplan: false,
    },
  });

  // R4: Single unexpected actor result
  const r4signals: AggregatedSignals = new Map();
  r4signals.set(moduleId('actor'), {
    type: 'actor', source: moduleId('actor'), timestamp: Date.now(),
    actionTaken: 'Bash', success: false, unexpectedResult: true,
  } as unknown as MonitoringSignal);
  tasks.push({
    name: 'routine-unexpected-result',
    difficulty: 4,
    category: 'routine',
    signals: r4signals,
    expectedReport: {
      anomalies: [{ moduleId: moduleId('actor'), type: 'unexpected-result', detail: 'Action Bash failed unexpectedly' }],
      escalation: undefined,
      restrictedActions: [],
      forceReplan: false,
    },
  });

  // R5: Medium confidence, normal — borderline but clear
  const r5signals: AggregatedSignals = new Map();
  r5signals.set(moduleId('reasoner'), {
    type: 'reasoner', source: moduleId('reasoner'), timestamp: Date.now(),
    confidence: 0.55, conflictDetected: false, effortLevel: 'medium',
  } as unknown as MonitoringSignal);
  r5signals.set(moduleId('actor'), {
    type: 'actor', source: moduleId('actor'), timestamp: Date.now(),
    actionTaken: 'Read', success: true, unexpectedResult: false,
  } as unknown as MonitoringSignal);
  tasks.push({
    name: 'routine-medium-confidence',
    difficulty: 5,
    category: 'routine',
    signals: r5signals,
    expectedReport: { anomalies: [], escalation: undefined, restrictedActions: [], forceReplan: false },
  });

  // ── 5 Novel Tasks (difficulty 6-10) ──

  // N1: Borderline confidence (exactly at threshold boundary)
  const n1signals: AggregatedSignals = new Map();
  n1signals.set(moduleId('reasoner'), {
    type: 'reasoner', source: moduleId('reasoner'), timestamp: Date.now(),
    confidence: 0.31, conflictDetected: false, effortLevel: 'high',
  } as unknown as MonitoringSignal);
  n1signals.set(moduleId('actor'), {
    type: 'actor', source: moduleId('actor'), timestamp: Date.now(),
    actionTaken: 'Grep', success: true, unexpectedResult: false,
  } as unknown as MonitoringSignal);
  tasks.push({
    name: 'novel-borderline-confidence',
    difficulty: 6,
    category: 'novel',
    signals: n1signals,
    expectedReport: { anomalies: [], escalation: undefined, restrictedActions: [], forceReplan: false },
  });

  // N2: Conflicting signals — reasoner high confidence but actor failure
  const n2signals: AggregatedSignals = new Map();
  n2signals.set(moduleId('reasoner'), {
    type: 'reasoner', source: moduleId('reasoner'), timestamp: Date.now(),
    confidence: 0.85, conflictDetected: true, effortLevel: 'medium',
  } as unknown as MonitoringSignal);
  n2signals.set(moduleId('actor'), {
    type: 'actor', source: moduleId('actor'), timestamp: Date.now(),
    actionTaken: 'Edit', success: false, unexpectedResult: true,
  } as unknown as MonitoringSignal);
  tasks.push({
    name: 'novel-conflicting-signals',
    difficulty: 7,
    category: 'novel',
    signals: n2signals,
    expectedReport: {
      anomalies: [{ moduleId: moduleId('actor'), type: 'unexpected-result', detail: 'Action Edit failed unexpectedly' }],
      escalation: undefined,
      restrictedActions: [],
      forceReplan: false,
    },
  });

  // N3: Many modules with mixed signals
  const n3signals: AggregatedSignals = new Map();
  n3signals.set(moduleId('observer'), {
    type: 'observer', source: moduleId('observer'), timestamp: Date.now(),
    inputProcessed: true, noveltyScore: 0.2,
  } as unknown as MonitoringSignal);
  n3signals.set(moduleId('memory'), {
    type: 'memory', source: moduleId('memory'), timestamp: Date.now(),
    retrievalCount: 0, relevanceScore: 0.1,
  } as unknown as MonitoringSignal);
  n3signals.set(moduleId('reasoner'), {
    type: 'reasoner', source: moduleId('reasoner'), timestamp: Date.now(),
    confidence: 0.25, conflictDetected: true, effortLevel: 'high',
  } as unknown as MonitoringSignal);
  n3signals.set(moduleId('actor'), {
    type: 'actor', source: moduleId('actor'), timestamp: Date.now(),
    actionTaken: 'Read', success: true, unexpectedResult: false,
  } as unknown as MonitoringSignal);
  tasks.push({
    name: 'novel-mixed-many-modules',
    difficulty: 8,
    category: 'novel',
    signals: n3signals,
    expectedReport: {
      anomalies: [{ moduleId: moduleId('reasoner'), type: 'low-confidence', detail: 'Confidence 0.25 below threshold' }],
      escalation: undefined,
      restrictedActions: [],
      forceReplan: false,
    },
  });

  // N4: Compound anomaly — requires detecting both conditions
  const n4signals: AggregatedSignals = new Map();
  n4signals.set(moduleId('reasoner'), {
    type: 'reasoner', source: moduleId('reasoner'), timestamp: Date.now(),
    confidence: 0.08, conflictDetected: true, effortLevel: 'high',
  } as unknown as MonitoringSignal);
  n4signals.set(moduleId('actor'), {
    type: 'actor', source: moduleId('actor'), timestamp: Date.now(),
    actionTaken: 'Read', success: false, unexpectedResult: true,
  } as unknown as MonitoringSignal);
  tasks.push({
    name: 'novel-compound-anomaly',
    difficulty: 9,
    category: 'novel',
    signals: n4signals,
    expectedReport: {
      anomalies: [
        { moduleId: moduleId('reasoner'), type: 'low-confidence', detail: 'Confidence 0.08 below threshold' },
        { moduleId: moduleId('actor'), type: 'unexpected-result', detail: 'Action Read failed unexpectedly' },
        { moduleId: moduleId('llm-monitor'), type: 'compound', detail: 'Compound anomaly: low confidence + unexpected result' },
      ],
      escalation: 'Compound anomaly: low confidence + unexpected result',
      restrictedActions: ['Read'],
      forceReplan: true,
    },
  });

  // N5: Extreme edge case — 6 modules, stagnation pattern, highest difficulty
  const n5signals: AggregatedSignals = new Map();
  n5signals.set(moduleId('observer'), {
    type: 'observer', source: moduleId('observer'), timestamp: Date.now(),
    inputProcessed: false, noveltyScore: 0.0,
  } as unknown as MonitoringSignal);
  n5signals.set(moduleId('memory'), {
    type: 'memory', source: moduleId('memory'), timestamp: Date.now(),
    retrievalCount: 5, relevanceScore: 0.95,
  } as unknown as MonitoringSignal);
  n5signals.set(moduleId('reasoner'), {
    type: 'reasoner', source: moduleId('reasoner'), timestamp: Date.now(),
    confidence: 0.12, conflictDetected: true, effortLevel: 'high', tokensThisStep: 800,
  } as unknown as MonitoringSignal);
  n5signals.set(moduleId('actor'), {
    type: 'actor', source: moduleId('actor'), timestamp: Date.now(),
    actionTaken: 'Read', success: true, unexpectedResult: false,
  } as unknown as MonitoringSignal);
  n5signals.set(moduleId('evaluator'), {
    type: 'evaluator', source: moduleId('evaluator'), timestamp: Date.now(),
    estimatedProgress: 0.05, diminishingReturns: true,
  } as unknown as MonitoringSignal);
  n5signals.set(moduleId('planner'), {
    type: 'planner', source: moduleId('planner'), timestamp: Date.now(),
    planRevised: false, subgoalCount: 3,
  } as unknown as MonitoringSignal);
  tasks.push({
    name: 'novel-stagnation-edge-case',
    difficulty: 10,
    category: 'novel',
    signals: n5signals,
    expectedReport: {
      anomalies: [
        { moduleId: moduleId('reasoner'), type: 'low-confidence', detail: 'Confidence 0.12 below threshold, stagnation detected' },
      ],
      escalation: 'Stagnation detected with low confidence',
      restrictedActions: ['Read'],
      forceReplan: true,
    },
  });

  return tasks;
}

// ── Mock LLM Provider (Baseline) ───────────────────────────────

/**
 * Creates a mock ProviderAdapter that simulates the frontier LLM baseline.
 * Uses the full user prompt content as key for exact matching — this avoids
 * collisions when multiple tasks share similar module names.
 */
function createBaselineMockAdapter(
  expectedReports: Map<string, MonitorReport>,
): ProviderAdapter {
  return {
    async invoke(snapshot, config): Promise<ProviderAdapterResult> {
      const content = snapshot[0]?.content as string ?? '';
      // Exact match on full content
      const report: MonitorReport = expectedReports.get(content) ?? {
        anomalies: [],
        escalation: undefined,
        restrictedActions: [],
        forceReplan: false,
      };

      const systemTokens = estimateTokens(config?.systemPrompt ?? '');
      const userTokens = estimateTokens(content);
      const inputTokens = systemTokens + userTokens;
      const responseStr = JSON.stringify({ ...report, escalation: report.escalation ?? null });
      const outputTokens = estimateTokens(responseStr);

      const usage: TokenUsage = {
        inputTokens,
        outputTokens,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: inputTokens + outputTokens,
      };

      return {
        output: responseStr,
        usage,
        cost: {
          totalUsd: inputTokens * 0.00000025 + outputTokens * 0.00000125,
          perModel: {
            'claude-3-haiku': { tokens: usage, costUsd: inputTokens * 0.00000025 + outputTokens * 0.00000125 },
          },
        },
      };
    },
  };
}

// ── Mock SLM Responses ─────────────────────────────────────────

/**
 * Build mock SLM responses that simulate realistic behavior:
 * - Routine: correct output, high confidence (0.8+)
 * - Novel easy: correct but lower confidence (0.6-0.7)
 * - Novel hard: partially correct or low confidence (0.3-0.5) -> escalate
 * - Novel hardest: garbage DSL -> parse failure -> automatic escalation
 */
function buildMockSlmResponses(tasks: BenchmarkTask[]): Map<string, SLMResult> {
  const responses = new Map<string, SLMResult>();

  for (const task of tasks) {
    const inputText = buildMonitorUserPrompt(task.signals);

    if (task.category === 'routine') {
      // Routine: SLM produces correct JSON with high confidence
      responses.set(inputText, {
        tokens: JSON.stringify(task.expectedReport),
        confidence: 0.80 + (5 - task.difficulty) * 0.04, // 0.96 for d=1, 0.80 for d=5
        inputTokenCount: estimateTokens(inputText),
        outputTokenCount: estimateTokens(JSON.stringify(task.expectedReport)),
        latencyMs: 10 + task.difficulty * 2,
      });
    } else if (task.difficulty <= 7) {
      // Novel (easy-medium): correct output but lower confidence
      const conf = 0.75 - (task.difficulty - 6) * 0.10; // 0.75 for d=6, 0.65 for d=7
      responses.set(inputText, {
        tokens: JSON.stringify(task.expectedReport),
        confidence: conf,
        inputTokenCount: estimateTokens(inputText),
        outputTokenCount: estimateTokens(JSON.stringify(task.expectedReport)),
        latencyMs: 15 + task.difficulty * 3,
      });
    } else if (task.difficulty === 8) {
      // Novel (hard): valid DSL but low confidence -> escalation
      responses.set(inputText, {
        tokens: JSON.stringify(task.expectedReport),
        confidence: 0.45,
        inputTokenCount: estimateTokens(inputText),
        outputTokenCount: estimateTokens(JSON.stringify(task.expectedReport)),
        latencyMs: 25,
      });
    } else if (task.difficulty === 9) {
      // Novel (very hard): produces invalid DSL -> parse failure
      responses.set(inputText, {
        tokens: '{"anomalies": [BROKEN JSON',
        confidence: 0.35,
        inputTokenCount: estimateTokens(inputText),
        outputTokenCount: 10,
        latencyMs: 20,
      });
    } else {
      // Novel (extreme): garbage output -> parse failure
      responses.set(inputText, {
        tokens: '<<<STAGNATION_OVERFLOW>>>',
        confidence: 0.15,
        inputTokenCount: estimateTokens(inputText),
        outputTokenCount: 5,
        latencyMs: 30,
      });
    }
  }

  return responses;
}

// ── Report Comparison ──────────────────────────────────────────

/** Check if a produced report is "correct" relative to the expected one. */
export function isReportCorrect(produced: MonitorReport, expected: MonitorReport): boolean {
  // For clean-state tasks (0 expected anomalies), model must not hallucinate any
  if (expected.anomalies.length === 0) {
    if (produced.anomalies.length !== 0) return false;
  } else {
    // For anomaly tasks: all expected anomalies must be present (superset ok)
    for (const expAnomaly of expected.anomalies) {
      const match = produced.anomalies.find(
        a => a.type === expAnomaly.type && a.moduleId === expAnomaly.moduleId,
      );
      if (!match) return false;
    }
  }

  // Escalation: both present or both absent
  if ((produced.escalation !== undefined) !== (expected.escalation !== undefined)) return false;

  // ForceReplan must match
  if (produced.forceReplan !== expected.forceReplan) return false;

  return true;
}

// ── Per-Task Result ────────────────────────────────────────────

export interface TaskResult {
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
    escalationReason?: 'parse-failure' | 'low-confidence' | 'slm-error';
  };
}

// ── Spearman Rank Correlation ──────────────────────────────────

export function spearmanCorrelation(x: number[], y: number[]): number {
  const n = x.length;
  if (n < 2) return 0;

  function rank(values: number[]): number[] {
    const indexed = values.map((v, i) => ({ v, i }));
    indexed.sort((a, b) => a.v - b.v);
    const ranks = new Array<number>(n);
    let i = 0;
    while (i < n) {
      let j = i;
      while (j < n - 1 && indexed[j + 1].v === indexed[j].v) j++;
      const avgRank = (i + j) / 2 + 1;
      for (let k = i; k <= j; k++) {
        ranks[indexed[k].i] = avgRank;
      }
      i = j + 1;
    }
    return ranks;
  }

  const rx = rank(x);
  const ry = rank(y);
  let sumD2 = 0;
  for (let i = 0; i < n; i++) {
    const d = rx[i] - ry[i];
    sumD2 += d * d;
  }
  return 1 - (6 * sumD2) / (n * (n * n - 1));
}

// ── Main ───────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('=== Phase 4 — Integration Benchmark ===\n');

  const tasks = buildBenchmarkTasks();
  console.log(`  Tasks: ${tasks.length} (${tasks.filter(t => t.category === 'routine').length} routine + ${tasks.filter(t => t.category === 'novel').length} novel)`);

  // ── Build expected report lookup for the baseline mock ──
  // Key is the full user prompt content (what ends up in the workspace snapshot).
  const expectedReports = new Map<string, MonitorReport>();
  for (const task of tasks) {
    const userPrompt = buildMonitorUserPrompt(task.signals);
    expectedReports.set(userPrompt, task.expectedReport);
  }

  // ── Baseline: LLM Monitor v2 ──
  console.log('\n  --- Baseline (LLM Monitor v2) ---');
  const baselineAdapter = createBaselineMockAdapter(expectedReports);
  const baselineMonitor = createLlmMonitor(baselineAdapter);
  const noControl = { target: moduleId('llm-monitor'), timestamp: Date.now() } as NoControl;

  const results: TaskResult[] = [];

  for (const task of tasks) {
    const state = baselineMonitor.initialState();
    const startTime = performance.now();
    const stepResult = await baselineMonitor.step(task.signals, state, noControl);
    const latencyMs = performance.now() - startTime;

    const baselineSuccess = isReportCorrect(stepResult.output, task.expectedReport);
    const baselineTotalTokens = stepResult.state.totalTokens;

    console.log(`    ${task.name} (d=${task.difficulty}): ${baselineTotalTokens} tokens, ${baselineSuccess ? 'PASS' : 'FAIL'}`);

    // Store baseline result (we'll add SLM result next)
    results.push({
      name: task.name,
      difficulty: task.difficulty,
      category: task.category,
      baseline: {
        success: baselineSuccess,
        totalTokens: baselineTotalTokens,
        costUsd: baselineTotalTokens * 0.00000075, // blended average
        latencyMs: Math.round(latencyMs * 100) / 100,
      },
      slm: {
        success: false,
        totalTokens: 0,
        costUsd: 0,
        latencyMs: 0,
        escalated: false,
      },
    });
  }

  // ── SLM Monitor v2 ──
  console.log('\n  --- SLM Monitor v2 (Decorator) ---');
  const slmResponses = buildMockSlmResponses(tasks);
  const mockSlm = createMockSLMInference(slmResponses);
  await mockSlm.init();

  // The SLM adapter wraps the same baseline adapter as fallback
  const fallbackAdapter = createBaselineMockAdapter(expectedReports);

  // Use a simple JSON parse as the DSL parser for the mock benchmark
  function benchParseDsl(dsl: string): MonitorReport | null {
    try {
      const p = JSON.parse(dsl);
      if (p && typeof p === 'object' && Array.isArray(p.anomalies)) {
        return p as MonitorReport;
      }
      return null;
    } catch {
      return null;
    }
  }

  const slmAdapter = createSLMProviderAdapter({
    slm: mockSlm,
    fallback: fallbackAdapter,
    parseDsl: benchParseDsl,
    encodeDsl: (r: MonitorReport) => JSON.stringify(r),
    escalationThreshold: 0.6,
  });

  // Run SLM Monitor using the SLM adapter as the ProviderAdapter
  const slmMonitor = createLlmMonitor(slmAdapter);

  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i];
    const state = slmMonitor.initialState();
    const startTime = performance.now();
    const stepResult = await slmMonitor.step(task.signals, state, noControl);
    const latencyMs = performance.now() - startTime;

    const slmSuccess = isReportCorrect(stepResult.output, task.expectedReport);

    // Determine if the SLM escalated by checking the adapter metrics delta
    const metrics = slmAdapter.getMetrics();
    // Track escalation: for the i-th call, check if fallback was involved
    const prevFallback = i > 0 ? results.slice(0, i).filter(r => r.slm.escalated).length : 0;
    const escalated = metrics.fallbackCalls > prevFallback;

    let escalationReason: 'parse-failure' | 'low-confidence' | 'slm-error' | undefined;
    if (escalated) {
      // Determine reason from cumulative metrics
      const prevParse = i > 0 ? results.slice(0, i).filter(r => r.slm.escalationReason === 'parse-failure').length : 0;
      if (metrics.parseFailures > prevParse) {
        escalationReason = 'parse-failure';
      } else {
        escalationReason = 'low-confidence';
      }
    }

    // For SLM cost: 0 if handled by SLM, baseline cost if escalated
    const slmCost = escalated ? stepResult.state.totalTokens * 0.00000075 : 0;

    results[i].slm = {
      success: slmSuccess,
      totalTokens: stepResult.state.totalTokens,
      costUsd: slmCost,
      latencyMs: Math.round(latencyMs * 100) / 100,
      escalated,
      escalationReason,
    };

    console.log(
      `    ${task.name} (d=${task.difficulty}): ${stepResult.state.totalTokens} tokens, ` +
      `${slmSuccess ? 'PASS' : 'FAIL'}${escalated ? ` [escalated: ${escalationReason}]` : ' [SLM]'}`,
    );
  }

  // ── Aggregate Statistics ─────────────────────────────────────

  const routineResults = results.filter(r => r.category === 'routine');
  const novelResults = results.filter(r => r.category === 'novel');

  // Task success rates
  const baselineSuccessRate = results.filter(r => r.baseline.success).length / results.length;
  const slmSuccessRate = results.filter(r => r.slm.success).length / results.length;

  // Token cost reduction on routine tasks
  const routineBaselineTokens = routineResults.reduce((s, r) => s + r.baseline.totalTokens, 0);
  const routineSlmTokens = routineResults.reduce((s, r) => s + r.slm.totalTokens, 0);
  const routineCostReduction = routineBaselineTokens > 0
    ? (1 - routineSlmTokens / routineBaselineTokens) * 100
    : 0;

  // Escalation rate by difficulty
  const escalationByDifficulty = results.map(r => ({
    difficulty: r.difficulty,
    escalated: r.slm.escalated ? 1 : 0,
  }));

  // Spearman rho between escalation rate and difficulty
  const difficulties = results.map(r => r.difficulty);
  const escalations = results.map(r => r.slm.escalated ? 1 : 0);
  const spearmanRho = spearmanCorrelation(difficulties, escalations);

  // Catastrophic failures (both baseline success + SLM failure, or baseline failure different from SLM)
  const catastrophicFailures = results.filter(
    r => r.baseline.success && !r.slm.success,
  ).length;

  // Overall escalation rate
  const overallEscalationRate = results.filter(r => r.slm.escalated).length / results.length;

  const report = {
    timestamp: new Date().toISOString(),
    taskCount: results.length,
    routineCount: routineResults.length,
    novelCount: novelResults.length,
    escalationThreshold: 0.6,
    results,
    aggregate: {
      baselineSuccessRate,
      slmSuccessRate,
      routineTokenReductionPct: Math.round(routineCostReduction * 100) / 100,
      overallEscalationRate: Math.round(overallEscalationRate * 1000) / 1000,
      escalationByDifficulty,
      spearmanRho: Math.round(spearmanRho * 1000) / 1000,
      catastrophicFailures,
    },
  };

  // Write results
  mkdirSync(RESULTS_DIR, { recursive: true });
  writeFileSync(OUTPUT_PATH, JSON.stringify(report, null, 2) + '\n', 'utf-8');

  console.log('\n--- Aggregate ---');
  console.log(`  Baseline success rate:  ${(baselineSuccessRate * 100).toFixed(0)}%`);
  console.log(`  SLM success rate:       ${(slmSuccessRate * 100).toFixed(0)}%`);
  console.log(`  Routine token reduction: ${routineCostReduction.toFixed(1)}%`);
  console.log(`  Overall escalation rate: ${(overallEscalationRate * 100).toFixed(0)}%`);
  console.log(`  Spearman rho:           ${spearmanRho.toFixed(3)}`);
  console.log(`  Catastrophic failures:  ${catastrophicFailures}`);
  console.log(`\n  Results written to: ${OUTPUT_PATH}`);
}

// Only run when executed directly, not when imported
const isMainModule = process.argv[1]?.replace(/\\/g, '/').includes('run-benchmark.ts')
  || process.argv[1]?.replace(/\\/g, '/').includes('run-benchmark.js');
if (isMainModule) {
  main().catch((err) => {
    console.error('Unhandled error:', err);
    process.exit(1);
  });
}
