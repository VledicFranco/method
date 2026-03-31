/**
 * Phase 4 — Multi-module SLM benchmark.
 *
 * Tests all 3 compiled cognitive modules (Monitor, Observer, Evaluator) against
 * their respective holdout scenarios. Each module's ONNX model is served via
 * a separate serve-model.py instance.
 *
 * Prerequisites:
 *   1. Monitor SLM:   SLM_MODEL_DIR=.../monitor-stagnation/onnx python serve-model.py  (port 8100)
 *   2. Observer SLM:  SLM_MODEL_DIR=.../observer-v2/onnx PORT=8101 python serve-model.py  (port 8101)
 *   3. Evaluator SLM: SLM_MODEL_DIR=.../evaluator-v2/onnx PORT=8102 python serve-model.py  (port 8102)
 *
 * Run: npx tsx experiments/exp-slm/phase-4-integration/scripts/run-benchmark-multimodule.ts
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createHttpSLMInference } from '../src/slm-inference.js';
import { encodeSignals, parseDsl } from '../src/dsl-codec.js';
import { encodeObserverSignals, parseObserverDsl } from '../src/observer-dsl-codec.js';
import { encodeEvaluatorSignals, parseEvaluatorDsl } from '../src/evaluator-dsl-codec.js';

import type { MonitorReport, AggregatedSignals, MonitoringSignal } from '../../phase-1-llm-monitor/src/types.js';
import { moduleId } from '../../phase-1-llm-monitor/src/types.js';
import type { ObserverReport, ObserverSignalInput } from '../src/observer-types.js';
import type { EvaluatorReport, EvaluatorSignalInput } from '../src/evaluator-types.js';

// ── Config ────────────────────────────────────────────────────

const MONITOR_URL = process.env.MONITOR_URL ?? 'http://localhost:8100';
const OBSERVER_URL = process.env.OBSERVER_URL ?? 'http://localhost:8101';
const EVALUATOR_URL = process.env.EVALUATOR_URL ?? 'http://localhost:8102';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RESULTS_DIR = join(__dirname, '..', 'results');
const OUTPUT_PATH = join(RESULTS_DIR, 'multimodule-eval.json');

// ── Scenario Types ────────────────────────────────────────────

interface MultiModuleScenario {
  name: string;
  category: 'routine' | 'stagnation' | 'novel' | 'diverging' | 'compound';
  monitorSignals: AggregatedSignals;
  observerSignals: ObserverSignalInput[];
  evaluatorSignals: EvaluatorSignalInput[];
  expected: {
    monitor: MonitorReport;
    observer: ObserverReport;
    evaluator: EvaluatorReport;
  };
}

interface ModuleResult {
  parsed: boolean;
  semanticMatch: boolean;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  confidence: number;
  rawOutput: string;
}

interface ScenarioResult {
  name: string;
  category: string;
  monitor: ModuleResult;
  observer: ModuleResult;
  evaluator: ModuleResult;
  allCorrect: boolean;
}

// ── Semantic Matching ─────────────────────────────────────────

function monitorMatch(produced: MonitorReport, expected: MonitorReport): boolean {
  if (expected.anomalies.length === 0) {
    if (produced.anomalies.length !== 0) return false;
  } else {
    for (const exp of expected.anomalies) {
      if (!produced.anomalies.find(a => a.type === exp.type && a.moduleId === exp.moduleId)) return false;
    }
  }
  if ((produced.escalation !== undefined) !== (expected.escalation !== undefined)) return false;
  if (produced.forceReplan !== expected.forceReplan) return false;
  return true;
}

function observerMatch(produced: ObserverReport, expected: ObserverReport): boolean {
  if (produced.priority !== expected.priority) return false;
  if (JSON.stringify(produced.focus.sort()) !== JSON.stringify(expected.focus.sort())) return false;
  return true;
}

function evaluatorMatch(produced: EvaluatorReport, expected: EvaluatorReport): boolean {
  if (produced.progress !== expected.progress) return false;
  if (produced.action !== expected.action) return false;
  return true;
}

// ── Benchmark Scenarios ───────────────────────────────────────

function buildScenarios(): MultiModuleScenario[] {
  const scenarios: MultiModuleScenario[] = [];

  // ── S1: All healthy — routine cycle, no issues
  scenarios.push({
    name: 'routine-healthy',
    category: 'routine',
    monitorSignals: new Map([
      [moduleId('reasoner'), { type: 'reasoner', source: moduleId('reasoner'), timestamp: Date.now(), confidence: 0.92, conflictDetected: false, effortLevel: 'low' } as unknown as MonitoringSignal],
      [moduleId('actor'), { type: 'actor', source: moduleId('actor'), timestamp: Date.now(), actionTaken: 'Edit', success: true, unexpectedResult: false } as unknown as MonitoringSignal],
    ]),
    observerSignals: [
      { id: 'main', novelty: 0.12, processed: true, content: 'text' },
      { id: 'ctx', novelty: 0.08, processed: true, content: 'tool-output' },
    ],
    evaluatorSignals: [
      { id: 'main', progress: 0.65, diminishing: false, steps: 5, clarity: 'high' },
    ],
    expected: {
      monitor: { anomalies: [], escalation: undefined, restrictedActions: [], forceReplan: false },
      observer: { priority: 'low', focus: [], novelty: 0.12, note: null },
      evaluator: { progress: 'on-track', confidence: 0.79, action: 'continue', note: null },
    },
  });

  // ── S2: Low confidence reasoner
  scenarios.push({
    name: 'low-confidence',
    category: 'routine',
    monitorSignals: new Map([
      [moduleId('reasoner'), { type: 'reasoner', source: moduleId('reasoner'), timestamp: Date.now(), confidence: 0.15, conflictDetected: false, effortLevel: 'high' } as unknown as MonitoringSignal],
    ]),
    observerSignals: [
      { id: 'main', novelty: 0.30, processed: true, content: 'text' },
    ],
    evaluatorSignals: [
      { id: 'main', progress: 0.40, diminishing: false, steps: 8, clarity: 'medium' },
    ],
    expected: {
      monitor: { anomalies: [{ moduleId: moduleId('reasoner'), type: 'low-confidence', detail: '' }], escalation: undefined, restrictedActions: [], forceReplan: false },
      observer: { priority: 'low', focus: [], novelty: 0.30, note: null },
      evaluator: { progress: 'on-track', confidence: 0.44, action: 'continue', note: null },
    },
  });

  // ── S3: Stagnation — diminishing returns
  scenarios.push({
    name: 'stagnation-diminishing',
    category: 'stagnation',
    monitorSignals: new Map([
      [moduleId('reasoner'), { type: 'reasoner', source: moduleId('reasoner'), timestamp: Date.now(), confidence: 0.45, conflictDetected: false, effortLevel: 'medium' } as unknown as MonitoringSignal],
      [moduleId('actor'), { type: 'actor', source: moduleId('actor'), timestamp: Date.now(), actionTaken: 'Read', success: true, unexpectedResult: false } as unknown as MonitoringSignal],
      [moduleId('evaluator'), { type: 'evaluator', source: moduleId('evaluator'), timestamp: Date.now(), estimatedProgress: 0.35, diminishingReturns: true } as unknown as MonitoringSignal],
    ]),
    observerSignals: [
      { id: 'main', novelty: 0.15, processed: true, content: 'tool-output' },
    ],
    evaluatorSignals: [
      { id: 'main', progress: 0.35, diminishing: true, steps: 12, clarity: 'medium' },
    ],
    expected: {
      monitor: { anomalies: [{ moduleId: moduleId('evaluator'), type: 'low-confidence', detail: '' }], escalation: undefined, restrictedActions: [], forceReplan: false },
      observer: { priority: 'low', focus: [], novelty: 0.15, note: null },
      evaluator: { progress: 'stagnant', confidence: 0.26, action: 'replan', note: null },
    },
  });

  // ── S4: Novel input — high novelty observation
  scenarios.push({
    name: 'novel-high-novelty',
    category: 'novel',
    monitorSignals: new Map([
      [moduleId('reasoner'), { type: 'reasoner', source: moduleId('reasoner'), timestamp: Date.now(), confidence: 0.78, conflictDetected: false, effortLevel: 'medium' } as unknown as MonitoringSignal],
      [moduleId('actor'), { type: 'actor', source: moduleId('actor'), timestamp: Date.now(), actionTaken: 'Glob', success: true, unexpectedResult: false } as unknown as MonitoringSignal],
    ]),
    observerSignals: [
      { id: 'main', novelty: 0.85, processed: false, content: 'code' },
      { id: 'ctx', novelty: 0.22, processed: true, content: 'text' },
    ],
    evaluatorSignals: [
      { id: 'main', progress: 0.55, diminishing: false, steps: 6, clarity: 'high' },
    ],
    expected: {
      monitor: { anomalies: [], escalation: undefined, restrictedActions: [], forceReplan: false },
      observer: { priority: 'high', focus: ['planner', 'reasoner', 'reflector'], novelty: 0.85, note: null },
      evaluator: { progress: 'on-track', confidence: 0.73, action: 'continue', note: null },
    },
  });

  // ── S5: Diverging — negative progress, escalation needed
  scenarios.push({
    name: 'diverging-escalation',
    category: 'diverging',
    monitorSignals: new Map([
      [moduleId('reasoner'), { type: 'reasoner', source: moduleId('reasoner'), timestamp: Date.now(), confidence: 0.20, conflictDetected: true, effortLevel: 'high' } as unknown as MonitoringSignal],
      [moduleId('actor'), { type: 'actor', source: moduleId('actor'), timestamp: Date.now(), actionTaken: 'Write', success: false, unexpectedResult: true } as unknown as MonitoringSignal],
    ]),
    observerSignals: [
      { id: 'main', novelty: 0.70, processed: false, content: 'error' },
    ],
    evaluatorSignals: [
      { id: 'main', progress: -0.15, diminishing: false, steps: 22, clarity: 'low' },
    ],
    expected: {
      monitor: { anomalies: [{ moduleId: moduleId('reasoner'), type: 'low-confidence', detail: '' }, { moduleId: moduleId('actor'), type: 'unexpected-result', detail: '' }], escalation: undefined, restrictedActions: [], forceReplan: false },
      observer: { priority: 'high', focus: ['planner', 'reasoner'], novelty: 0.70, note: null },
      evaluator: { progress: 'diverging', confidence: 0.10, action: 'escalate', note: null },
    },
  });

  // ── S6: Compound — stagnation + unexpected + high novelty
  scenarios.push({
    name: 'compound-multi-anomaly',
    category: 'compound',
    monitorSignals: new Map([
      [moduleId('reasoner'), { type: 'reasoner', source: moduleId('reasoner'), timestamp: Date.now(), confidence: 0.25, conflictDetected: true, effortLevel: 'high' } as unknown as MonitoringSignal],
      [moduleId('actor'), { type: 'actor', source: moduleId('actor'), timestamp: Date.now(), actionTaken: 'Bash', success: false, unexpectedResult: true } as unknown as MonitoringSignal],
      [moduleId('evaluator'), { type: 'evaluator', source: moduleId('evaluator'), timestamp: Date.now(), estimatedProgress: 0.20, diminishingReturns: true } as unknown as MonitoringSignal],
    ]),
    observerSignals: [
      { id: 'main', novelty: 0.92, processed: false, content: 'error' },
      { id: 'secondary', novelty: 0.45, processed: true, content: 'tool-output' },
    ],
    evaluatorSignals: [
      { id: 'main', progress: 0.20, diminishing: true, steps: 18, clarity: 'low' },
    ],
    expected: {
      monitor: { anomalies: [{ moduleId: moduleId('reasoner'), type: 'low-confidence', detail: '' }, { moduleId: moduleId('actor'), type: 'unexpected-result', detail: '' }], escalation: undefined, restrictedActions: [], forceReplan: false },
      observer: { priority: 'high', focus: ['planner', 'reasoner', 'reflector'], novelty: 0.92, note: null },
      evaluator: { progress: 'stagnant', confidence: 0.10, action: 'replan', note: null },
    },
  });

  // ── S7: Strong progress
  scenarios.push({
    name: 'strong-progress',
    category: 'routine',
    monitorSignals: new Map([
      [moduleId('reasoner'), { type: 'reasoner', source: moduleId('reasoner'), timestamp: Date.now(), confidence: 0.95, conflictDetected: false, effortLevel: 'low' } as unknown as MonitoringSignal],
      [moduleId('actor'), { type: 'actor', source: moduleId('actor'), timestamp: Date.now(), actionTaken: 'Write', success: true, unexpectedResult: false } as unknown as MonitoringSignal],
    ]),
    observerSignals: [
      { id: 'main', novelty: 0.05, processed: true, content: 'tool-output' },
    ],
    evaluatorSignals: [
      { id: 'main', progress: 0.85, diminishing: false, steps: 3, clarity: 'high' },
    ],
    expected: {
      monitor: { anomalies: [], escalation: undefined, restrictedActions: [], forceReplan: false },
      observer: { priority: 'low', focus: [], novelty: 0.05, note: null },
      evaluator: { progress: 'on-track', confidence: 0.91, action: 'continue', note: null },
    },
  });

  // ── S8: Medium novelty observation
  scenarios.push({
    name: 'medium-novelty',
    category: 'novel',
    monitorSignals: new Map([
      [moduleId('reasoner'), { type: 'reasoner', source: moduleId('reasoner'), timestamp: Date.now(), confidence: 0.68, conflictDetected: false, effortLevel: 'medium' } as unknown as MonitoringSignal],
    ]),
    observerSignals: [
      { id: 'main', novelty: 0.55, processed: true, content: 'code' },
    ],
    evaluatorSignals: [
      { id: 'main', progress: 0.50, diminishing: false, steps: 7, clarity: 'medium' },
    ],
    expected: {
      monitor: { anomalies: [], escalation: undefined, restrictedActions: [], forceReplan: false },
      observer: { priority: 'medium', focus: ['planner', 'reasoner'], novelty: 0.55, note: null },
      evaluator: { progress: 'on-track', confidence: 0.50, action: 'continue', note: null },
    },
  });

  // ── S9: Stagnation plateau — low progress, many steps
  scenarios.push({
    name: 'stagnation-plateau',
    category: 'stagnation',
    monitorSignals: new Map([
      [moduleId('reasoner'), { type: 'reasoner', source: moduleId('reasoner'), timestamp: Date.now(), confidence: 0.55, conflictDetected: false, effortLevel: 'medium' } as unknown as MonitoringSignal],
      [moduleId('actor'), { type: 'actor', source: moduleId('actor'), timestamp: Date.now(), actionTaken: 'Read', success: true, unexpectedResult: false } as unknown as MonitoringSignal],
    ]),
    observerSignals: [
      { id: 'main', novelty: 0.10, processed: true, content: 'text' },
    ],
    evaluatorSignals: [
      { id: 'main', progress: 0.22, diminishing: false, steps: 14, clarity: 'medium' },
    ],
    expected: {
      monitor: { anomalies: [], escalation: undefined, restrictedActions: [], forceReplan: false },
      observer: { priority: 'low', focus: [], novelty: 0.10, note: null },
      evaluator: { progress: 'stagnant', confidence: 0.33, action: 'replan', note: null },
    },
  });

  // ── S10: Diverging with low clarity
  scenarios.push({
    name: 'diverging-low-clarity',
    category: 'diverging',
    monitorSignals: new Map([
      [moduleId('reasoner'), { type: 'reasoner', source: moduleId('reasoner'), timestamp: Date.now(), confidence: 0.30, conflictDetected: false, effortLevel: 'high' } as unknown as MonitoringSignal],
      [moduleId('actor'), { type: 'actor', source: moduleId('actor'), timestamp: Date.now(), actionTaken: 'Edit', success: true, unexpectedResult: false } as unknown as MonitoringSignal],
    ]),
    observerSignals: [
      { id: 'main', novelty: 0.40, processed: true, content: 'text' },
      { id: 'ctx', novelty: 0.15, processed: true, content: 'tool-output' },
    ],
    evaluatorSignals: [
      { id: 'main', progress: 0.15, diminishing: false, steps: 12, clarity: 'low' },
    ],
    expected: {
      monitor: { anomalies: [], escalation: undefined, restrictedActions: [], forceReplan: false },
      observer: { priority: 'low', focus: [], novelty: 0.40, note: null },
      evaluator: { progress: 'diverging', confidence: 0.17, action: 'replan', note: null },
    },
  });

  return scenarios;
}

// ── Preflight ─────────────────────────────────────────────────

async function preflight(): Promise<void> {
  const servers = [
    { name: 'Monitor', url: MONITOR_URL },
    { name: 'Observer', url: OBSERVER_URL },
    { name: 'Evaluator', url: EVALUATOR_URL },
  ];

  for (const { name, url } of servers) {
    try {
      const resp = await fetch(`${url}/health`, { signal: AbortSignal.timeout(5_000) });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json() as { status: string; model_loaded: boolean };
      if (!data.model_loaded) throw new Error('Model not loaded');
      console.log(`  ${name} SLM @ ${url}: OK`);
    } catch (err) {
      throw new Error(`${name} SLM unreachable at ${url}: ${err}`);
    }
  }
}

// ── Main ──────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('\n=== Multi-Module SLM Benchmark ===\n');

  // Preflight
  console.log('Preflight checks...');
  await preflight();

  // Create SLM clients
  const monitorSlm = createHttpSLMInference({ modelId: 'monitor-stagnation', serverUrl: MONITOR_URL, timeoutMs: 30_000 });
  const observerSlm = createHttpSLMInference({ modelId: 'observer-v2', serverUrl: OBSERVER_URL, timeoutMs: 30_000 });
  const evaluatorSlm = createHttpSLMInference({ modelId: 'evaluator-v2', serverUrl: EVALUATOR_URL, timeoutMs: 30_000 });

  await Promise.all([monitorSlm.init(), observerSlm.init(), evaluatorSlm.init()]);
  console.log('  All SLM clients initialized.\n');

  // Build scenarios
  const scenarios = buildScenarios();
  console.log(`Running ${scenarios.length} scenarios...\n`);

  const results: ScenarioResult[] = [];

  for (const scenario of scenarios) {
    // Encode inputs
    const monitorInput = encodeSignals(scenario.monitorSignals);
    const observerInput = encodeObserverSignals(scenario.observerSignals);
    const evaluatorInput = encodeEvaluatorSignals(scenario.evaluatorSignals);

    // Run all 3 modules in parallel
    const [monitorRes, observerRes, evaluatorRes] = await Promise.all([
      monitorSlm.generate(monitorInput),
      observerSlm.generate(observerInput),
      evaluatorSlm.generate(evaluatorInput),
    ]);

    // Parse outputs
    const monitorParsed = parseDsl(monitorRes.tokens);
    const observerParsed = parseObserverDsl(observerRes.tokens);
    const evaluatorParsed = parseEvaluatorDsl(evaluatorRes.tokens);

    // Semantic matching
    const monitorSemantic = monitorParsed !== null && monitorMatch(monitorParsed, scenario.expected.monitor);
    const observerSemantic = observerParsed !== null && observerMatch(observerParsed, scenario.expected.observer);
    const evaluatorSemantic = evaluatorParsed !== null && evaluatorMatch(evaluatorParsed, scenario.expected.evaluator);

    const result: ScenarioResult = {
      name: scenario.name,
      category: scenario.category,
      monitor: {
        parsed: monitorParsed !== null,
        semanticMatch: monitorSemantic,
        latencyMs: monitorRes.latencyMs,
        inputTokens: monitorRes.inputTokenCount,
        outputTokens: monitorRes.outputTokenCount,
        confidence: monitorRes.confidence,
        rawOutput: monitorRes.tokens,
      },
      observer: {
        parsed: observerParsed !== null,
        semanticMatch: observerSemantic,
        latencyMs: observerRes.latencyMs,
        inputTokens: observerRes.inputTokenCount,
        outputTokens: observerRes.outputTokenCount,
        confidence: observerRes.confidence,
        rawOutput: observerRes.tokens,
      },
      evaluator: {
        parsed: evaluatorParsed !== null,
        semanticMatch: evaluatorSemantic,
        latencyMs: evaluatorRes.latencyMs,
        inputTokens: evaluatorRes.inputTokenCount,
        outputTokens: evaluatorRes.outputTokenCount,
        confidence: evaluatorRes.confidence,
        rawOutput: evaluatorRes.tokens,
      },
      allCorrect: monitorSemantic && observerSemantic && evaluatorSemantic,
    };

    results.push(result);

    const status = result.allCorrect ? 'ALL OK' : 'MISS';
    const details = [
      `M:${monitorSemantic ? 'ok' : 'FAIL'}`,
      `O:${observerSemantic ? 'ok' : 'FAIL'}`,
      `E:${evaluatorSemantic ? 'ok' : 'FAIL'}`,
    ].join(' ');
    console.log(`  [${status}] ${scenario.name} (${scenario.category}) — ${details}`);
  }

  // ── Aggregate Metrics ────────────────────────────────────────

  console.log('\n--- Aggregate Results ---\n');

  const modules = ['monitor', 'observer', 'evaluator'] as const;
  const moduleStats: Record<string, { parse: number; semantic: number; totalLatencyMs: number; totalTokens: number }> = {};

  for (const mod of modules) {
    const parseCount = results.filter(r => r[mod].parsed).length;
    const semanticCount = results.filter(r => r[mod].semanticMatch).length;
    const totalLat = results.reduce((sum, r) => sum + r[mod].latencyMs, 0);
    const totalTok = results.reduce((sum, r) => sum + r[mod].inputTokens + r[mod].outputTokens, 0);

    moduleStats[mod] = { parse: parseCount, semantic: semanticCount, totalLatencyMs: totalLat, totalTokens: totalTok };

    console.log(`  ${mod.padEnd(10)} parse: ${parseCount}/${results.length} (${(parseCount / results.length * 100).toFixed(0)}%)  semantic: ${semanticCount}/${results.length} (${(semanticCount / results.length * 100).toFixed(0)}%)  avg latency: ${(totalLat / results.length).toFixed(0)}ms  total tokens: ${totalTok}`);
  }

  const allCorrectCount = results.filter(r => r.allCorrect).length;
  const totalLatencyMs = results.reduce((sum, r) => sum + r.monitor.latencyMs + r.observer.latencyMs + r.evaluator.latencyMs, 0);

  console.log(`\n  All-3-correct: ${allCorrectCount}/${results.length} (${(allCorrectCount / results.length * 100).toFixed(0)}%)`);
  console.log(`  Total 3-module latency: ${(totalLatencyMs / 1000).toFixed(1)}s (avg ${(totalLatencyMs / results.length / 1000).toFixed(2)}s per scenario)`);

  // ── Gates ────────────────────────────────────────────────────

  console.log('\n--- Gates ---\n');

  const gates = {
    monitorParse: (moduleStats['monitor'].parse / results.length) >= 0.95,
    monitorSemantic: (moduleStats['monitor'].semantic / results.length) >= 0.85,
    observerParse: (moduleStats['observer'].parse / results.length) >= 0.95,
    observerSemantic: (moduleStats['observer'].semantic / results.length) >= 0.85,
    evaluatorParse: (moduleStats['evaluator'].parse / results.length) >= 0.95,
    evaluatorSemantic: (moduleStats['evaluator'].semantic / results.length) >= 0.85,
    allCorrectRate: (allCorrectCount / results.length) >= 0.70,
  };

  for (const [gate, pass] of Object.entries(gates)) {
    console.log(`  [${pass ? 'PASS' : 'FAIL'}] ${gate}`);
  }

  const allPass = Object.values(gates).every(Boolean);
  console.log(`\n  Overall: ${allPass ? 'ALL GATES PASS' : 'SOME GATES FAILED'}`);

  // ── Write Results ────────────────────────────────────────────

  mkdirSync(RESULTS_DIR, { recursive: true });

  const output = {
    timestamp: new Date().toISOString(),
    scenarios: results.length,
    moduleStats,
    allCorrectRate: allCorrectCount / results.length,
    gates,
    allPass,
    results,
  };

  writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2) + '\n');
  console.log(`\nResults written to ${OUTPUT_PATH}`);

  // Cleanup
  await Promise.all([monitorSlm.dispose(), observerSlm.dispose(), evaluatorSlm.dispose()]);

  process.exit(allPass ? 0 : 1);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
