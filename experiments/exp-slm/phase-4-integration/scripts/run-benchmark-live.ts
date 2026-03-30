/**
 * Phase 4 — Live integration benchmark.
 *
 * Same 10-task benchmark as run-benchmark.ts, but uses REAL inference:
 *   - Baseline: Ollama (qwen3-coder:30b) on chobits via Tailscale
 *   - SLM:      ONNX model served by serve-model.py (localhost:8100)
 *   - Fallback: Same Ollama instance (when SLM escalates)
 *
 * The SLM path uses compact signal encoding + DSL parsing (matching training
 * format). The baseline uses verbose prompts + JSON parsing (matching LLM
 * Monitor v2 protocol). Fallback on escalation goes through the baseline path.
 *
 * Prerequisites:
 *   1. Ollama running on chobits:11434 with qwen3-coder:30b
 *   2. python phase-4-integration/scripts/serve-model.py  (localhost:8100)
 *
 * Run: npx tsx experiments/exp-slm/phase-4-integration/scripts/run-benchmark-live.ts
 */

import { writeFileSync, mkdirSync, appendFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildBenchmarkTasks,
  isReportCorrect,
  spearmanCorrelation,
  type TaskResult,
} from './run-benchmark.js';
import { createOllamaAdapter } from '../src/ollama-adapter.js';
import { createHttpSLMInference } from '../src/slm-inference.js';
import { encodeSignals, parseDsl } from '../src/dsl-codec.js';
import { createLlmMonitor } from '../../phase-1-llm-monitor/src/llm-monitor.js';
import type {
  MonitorReport,
  NoControl,
} from '../../phase-1-llm-monitor/src/types.js';
import { moduleId } from '../../phase-1-llm-monitor/src/types.js';

// ── Config ────────────────────────────────────────────────────

const OLLAMA_URL = process.env.OLLAMA_URL ?? 'http://chobits:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? 'qwen3-coder:30b';
const SLM_URL = process.env.SLM_URL ?? 'http://localhost:8100';
const ESCALATION_THRESHOLD = 0.6;

const __dirname = dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = join(__dirname, '..', 'results');
const OUTPUT_PATH = join(RESULTS_DIR, 'integration-eval-live.json');
const TRACES_PATH = join(RESULTS_DIR, 'live-traces.jsonl');

// ── Preflight ─────────────────────────────────────────────────

async function preflight(): Promise<void> {
  console.log('  Preflight checks...');

  // Check Ollama
  try {
    const resp = await fetch(`${OLLAMA_URL}/api/tags`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = (await resp.json()) as { models: Array<{ name: string }> };
    const models = data.models.map((m) => m.name);
    console.log(`    Ollama @ ${OLLAMA_URL}: ${models.join(', ')}`);
    if (!models.includes(OLLAMA_MODEL)) {
      throw new Error(`Model ${OLLAMA_MODEL} not found. Available: ${models.join(', ')}`);
    }
  } catch (err) {
    throw new Error(`Ollama unreachable at ${OLLAMA_URL}: ${err}`);
  }

  // Check SLM server
  try {
    const resp = await fetch(`${SLM_URL}/health`, {
      signal: AbortSignal.timeout(5_000),
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = (await resp.json()) as { status: string; model_loaded: boolean; model_path: string };
    if (!data.model_loaded) {
      throw new Error(`SLM server running but model not loaded: ${data.model_path}`);
    }
    console.log(`    SLM   @ ${SLM_URL}: ${data.status}, model loaded`);
  } catch (err) {
    throw new Error(`SLM server unreachable at ${SLM_URL}: ${err}`);
  }
}

// ── Warmup ────────────────────────────────────────────────────

async function warmup(
  ollamaAdapter: ReturnType<typeof createOllamaAdapter>,
  slmUrl: string,
): Promise<void> {
  console.log('  Warming up models...');

  // Warmup Ollama (triggers model load into VRAM)
  const ollamaStart = performance.now();
  await ollamaAdapter.invoke(
    [{ source: moduleId('warmup'), content: 'Return: {"status":"ok"}', salience: 1, timestamp: Date.now() }],
    { pactTemplate: {}, systemPrompt: 'Return only the JSON requested.' },
  );
  console.log(`    Ollama warm: ${Math.round(performance.now() - ollamaStart)}ms`);

  // Warmup SLM server
  const slmStart = performance.now();
  await fetch(`${slmUrl}/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ input: 'SIGNALS:\n[reasoner:reasoner] conf=0.9 effort=low', max_length: 64 }),
    signal: AbortSignal.timeout(30_000),
  });
  console.log(`    SLM warm:    ${Math.round(performance.now() - slmStart)}ms`);
}

// ── Trace Logger ──────────────────────────────────────────────

function logTrace(entry: Record<string, unknown>): void {
  appendFileSync(TRACES_PATH, JSON.stringify(entry) + '\n', 'utf-8');
}

// ── Main ──────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('=== Phase 4 — Live Integration Benchmark ===\n');
  console.log(`  Ollama: ${OLLAMA_URL} (${OLLAMA_MODEL})`);
  console.log(`  SLM:    ${SLM_URL}`);
  console.log(`  Escalation threshold: ${ESCALATION_THRESHOLD}\n`);

  await preflight();

  const ollamaAdapter = createOllamaAdapter({
    baseUrl: OLLAMA_URL,
    model: OLLAMA_MODEL,
    maxTokens: 512,
    temperature: 0.1,
    timeoutMs: 120_000,
  });

  await warmup(ollamaAdapter, SLM_URL);

  const tasks = buildBenchmarkTasks();
  console.log(`\n  Tasks: ${tasks.length} (${tasks.filter((t) => t.category === 'routine').length} routine + ${tasks.filter((t) => t.category === 'novel').length} novel)`);

  // Reset traces file
  mkdirSync(RESULTS_DIR, { recursive: true });
  writeFileSync(TRACES_PATH, '', 'utf-8');

  // ── Baseline: Ollama as LLM Monitor ─────────────────────────

  console.log('\n  --- Baseline (Ollama LLM Monitor) ---');
  const baselineMonitor = createLlmMonitor(ollamaAdapter);
  const noControl = { target: moduleId('llm-monitor'), timestamp: Date.now() } as NoControl;

  const results: TaskResult[] = [];

  for (const task of tasks) {
    const state = baselineMonitor.initialState();
    const startTime = performance.now();
    const stepResult = await baselineMonitor.step(task.signals, state, noControl);
    const latencyMs = performance.now() - startTime;

    const baselineSuccess = isReportCorrect(stepResult.output, task.expectedReport);
    const baselineTotalTokens = stepResult.state.totalTokens;

    logTrace({
      name: task.name, difficulty: task.difficulty, side: 'baseline',
      rawOutput: JSON.stringify(stepResult.output),
      parsedReport: stepResult.output, expectedReport: task.expectedReport,
      success: baselineSuccess, latencyMs: Math.round(latencyMs), tokens: baselineTotalTokens,
    });

    const status = baselineSuccess ? 'PASS' : 'FAIL';
    console.log(`    ${task.name} (d=${task.difficulty}): ${baselineTotalTokens} tok, ${Math.round(latencyMs)}ms, ${status}`);

    results.push({
      name: task.name,
      difficulty: task.difficulty,
      category: task.category,
      baseline: {
        success: baselineSuccess,
        totalTokens: baselineTotalTokens,
        costUsd: 0,
        latencyMs: Math.round(latencyMs * 100) / 100,
      },
      slm: { success: false, totalTokens: 0, costUsd: 0, latencyMs: 0, escalated: false },
    });
  }

  // ── SLM Monitor (direct: compact signals → DSL → parse) ────

  console.log('\n  --- SLM Monitor (ONNX + Ollama fallback) ---');

  const slm = createHttpSLMInference({
    modelId: 'smollm2-135m-onnx',
    serverUrl: SLM_URL,
    timeoutMs: 30_000,
  });
  await slm.init();

  // Metrics
  let slmHandled = 0;
  let fallbackCalls = 0;
  let parseFailures = 0;
  let lowConfEscalations = 0;

  // Use baseline monitor for fallback (Ollama with verbose prompts)
  const fallbackMonitor = createLlmMonitor(ollamaAdapter);

  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i];
    const compactInput = encodeSignals(task.signals);
    const startTime = performance.now();

    let report: MonitorReport;
    let totalTokens: number;
    let escalated = false;
    let escalationReason: 'parse-failure' | 'low-confidence' | 'slm-error' | undefined;
    let rawSlmOutput = '';

    try {
      const slmResult = await slm.generate(compactInput);
      rawSlmOutput = slmResult.tokens;
      totalTokens = slmResult.inputTokenCount + slmResult.outputTokenCount;

      // Defense line 1: DSL parse
      const parsed = parseDsl(slmResult.tokens);
      if (parsed === null) {
        parseFailures++;
        fallbackCalls++;
        escalated = true;
        escalationReason = 'parse-failure';
        const state = fallbackMonitor.initialState();
        const step = await fallbackMonitor.step(task.signals, state, noControl);
        report = step.output;
        totalTokens = step.state.totalTokens;
      } else if (slmResult.confidence < ESCALATION_THRESHOLD) {
        // Defense line 2: low confidence
        lowConfEscalations++;
        fallbackCalls++;
        escalated = true;
        escalationReason = 'low-confidence';
        const state = fallbackMonitor.initialState();
        const step = await fallbackMonitor.step(task.signals, state, noControl);
        report = step.output;
        totalTokens = step.state.totalTokens;
      } else {
        // SLM success
        slmHandled++;
        report = parsed;
      }
    } catch (err) {
      fallbackCalls++;
      escalated = true;
      escalationReason = 'slm-error';
      rawSlmOutput = `ERROR: ${err}`;
      const state = fallbackMonitor.initialState();
      const step = await fallbackMonitor.step(task.signals, state, noControl);
      report = step.output;
      totalTokens = step.state.totalTokens;
    }

    const latencyMs = performance.now() - startTime;
    const slmSuccess = isReportCorrect(report, task.expectedReport);

    logTrace({
      name: task.name, difficulty: task.difficulty, side: 'slm',
      compactInput, rawSlmOutput,
      parsedReport: report, expectedReport: task.expectedReport,
      success: slmSuccess, escalated, escalationReason,
      latencyMs: Math.round(latencyMs), tokens: totalTokens,
    });

    results[i].slm = {
      success: slmSuccess,
      totalTokens: totalTokens,
      costUsd: 0,
      latencyMs: Math.round(latencyMs * 100) / 100,
      escalated,
      escalationReason,
    };

    const status = slmSuccess ? 'PASS' : 'FAIL';
    const route = escalated ? `[escalated: ${escalationReason}]` : '[SLM]';
    console.log(
      `    ${task.name} (d=${task.difficulty}): ${totalTokens} tok, ${Math.round(latencyMs)}ms, ${status} ${route}`,
    );
  }

  await slm.dispose();

  // ── Aggregate Statistics ────────────────────────────────────

  const routineResults = results.filter((r) => r.category === 'routine');

  const baselineSuccessRate = results.filter((r) => r.baseline.success).length / results.length;
  const slmSuccessRate = results.filter((r) => r.slm.success).length / results.length;

  const routineBaselineTokens = routineResults.reduce((s, r) => s + r.baseline.totalTokens, 0);
  const routineSlmTokens = routineResults.reduce((s, r) => s + r.slm.totalTokens, 0);
  const routineCostReduction = routineBaselineTokens > 0
    ? (1 - routineSlmTokens / routineBaselineTokens) * 100
    : 0;

  const escalationByDifficulty = results.map((r) => ({
    difficulty: r.difficulty,
    escalated: r.slm.escalated ? 1 : 0,
  }));

  const difficulties = results.map((r) => r.difficulty);
  // R-10: Redesigned Spearman gate — measures difficulty→failure correlation.
  // Old gate (difficulty→escalation) was undefined at 0% escalation rate.
  // New gate: does difficulty predict failure? Target: rho <= 0.3 (model
  // doesn't degrade badly on harder tasks). At 100% accuracy, failures = all
  // zeros → tied ranks → rho = 0.5 (mathematical artifact). Handle explicitly:
  // 0 failures means perfect accuracy → gate vacuously passes.
  const failures = results.map((r) => (r.slm.success ? 0 : 1));
  const failureCount = failures.filter(f => f === 1).length;
  const spearmanRho = failureCount === 0 ? 0 : spearmanCorrelation(difficulties, failures);

  const catastrophicFailures = results.filter(
    (r) => r.baseline.success && !r.slm.success,
  ).length;

  const overallEscalationRate = results.filter((r) => r.slm.escalated).length / results.length;

  const adapterMetrics = {
    totalCalls: tasks.length,
    slmHandled,
    fallbackCalls,
    parseFailures,
    lowConfidenceEscalations: lowConfEscalations,
    escalationRate: fallbackCalls / tasks.length,
  };

  const report = {
    timestamp: new Date().toISOString(),
    mode: 'live',
    infrastructure: {
      ollama: { url: OLLAMA_URL, model: OLLAMA_MODEL },
      slm: { url: SLM_URL, model: 'smollm2-135m-onnx' },
    },
    taskCount: results.length,
    routineCount: routineResults.length,
    novelCount: results.length - routineResults.length,
    escalationThreshold: ESCALATION_THRESHOLD,
    results,
    aggregate: {
      baselineSuccessRate,
      slmSuccessRate,
      routineTokenReductionPct: Math.round(routineCostReduction * 100) / 100,
      overallEscalationRate: Math.round(overallEscalationRate * 1000) / 1000,
      escalationByDifficulty,
      spearmanRhoDifficultyFailure: Math.round(spearmanRho * 1000) / 1000,
      spearmanGate: { metric: 'difficulty→failure', target: '<=0.3', actual: Math.round(spearmanRho * 1000) / 1000, verdict: spearmanRho <= 0.3 ? 'pass' : 'fail' },
      catastrophicFailures,
    },
    adapterMetrics,
  };

  writeFileSync(OUTPUT_PATH, JSON.stringify(report, null, 2) + '\n', 'utf-8');

  // ── Console Summary ─────────────────────────────────────────

  console.log('\n--- Aggregate ---');
  console.log(`  Baseline success rate:  ${(baselineSuccessRate * 100).toFixed(0)}%`);
  console.log(`  SLM success rate:       ${(slmSuccessRate * 100).toFixed(0)}%`);
  console.log(`  Routine token reduction: ${routineCostReduction.toFixed(1)}%`);
  console.log(`  Overall escalation rate: ${(overallEscalationRate * 100).toFixed(0)}%`);
  console.log(`  Spearman rho (d→fail):  ${spearmanRho.toFixed(3)} (target <=0.3, ${spearmanRho <= 0.3 ? 'PASS' : 'FAIL'})`);
  console.log(`  Catastrophic failures:  ${catastrophicFailures}`);
  console.log(`\n--- SLM Adapter Metrics ---`);
  console.log(`  Total calls:     ${adapterMetrics.totalCalls}`);
  console.log(`  SLM handled:     ${adapterMetrics.slmHandled}`);
  console.log(`  Fallback calls:  ${adapterMetrics.fallbackCalls}`);
  console.log(`  Parse failures:  ${adapterMetrics.parseFailures}`);
  console.log(`  Low-conf escal:  ${adapterMetrics.lowConfidenceEscalations}`);
  console.log(`  Escalation rate: ${(adapterMetrics.escalationRate * 100).toFixed(0)}%`);
  console.log(`\n  Results:  ${OUTPUT_PATH}`);
  console.log(`  Traces:   ${TRACES_PATH}`);
}

main().catch((err) => {
  console.error('Unhandled error:', err);
  process.exit(1);
});
