/**
 * EXP-024 Runner — Metacognitive Error Detection
 *
 * Tests whether the Monitor module detects reasoning errors injected into
 * synthetic monitoring signal streams. Two conditions:
 *
 *   A (baseline):  No Monitor — measure Reasoner's self-correction signals only
 *   B (monitor):   Monitor module active — measure anomaly detection accuracy
 *
 * Condition C (SLM Monitor) is deferred until Gate 4 (R-01) passes.
 *
 * Usage:
 *   ANTHROPIC_API_KEY=... npx tsx experiments/exp-metacognitive-error/scripts/run.ts \
 *     [--condition a|b|all] [--runs 10] [--seed 42] [--error-type E1|E2|E3|E4|all]
 *
 * Output: JSON results to experiments/exp-metacognitive-error/results/
 */

import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// ── Load .env ─────────────────────────────────────────────────────

try {
  const candidates = [
    resolve(import.meta.dirname ?? '.', '../../../.env'),
    resolve(process.cwd(), '.env'),
  ];
  let envContent = '';
  for (const p of candidates) {
    try { envContent = readFileSync(p, 'utf8'); break; } catch { continue; }
  }
  if (envContent) {
    for (const line of envContent.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx > 0) {
        const key = trimmed.slice(0, eqIdx);
        const value = trimmed.slice(eqIdx + 1);
        if (!process.env[key]) process.env[key] = value;
      }
    }
  }
} catch { /* .env not found */ }

// ── Imports ─────────────────────────────────────────────────────

import type { AggregatedSignals, MonitoringSignal } from '../../../packages/pacta/src/cognitive/algebra/index.js';
import { moduleId } from '../../../packages/pacta/src/cognitive/algebra/index.js';
import { createMonitor, type MonitorState, type MonitorReport } from '../../../packages/pacta/src/cognitive/modules/monitor.js';

import {
  generateStream,
  generateBatch,
  allErrorTypes,
  formatAsDSL,
  type ErrorType,
  type LabeledSignalStream,
  type CycleLabel,
} from './error-injection.js';

// ── Types ──────────────────────────────────────────────────────────

type Condition = 'A' | 'B';

/** Result of evaluating a single cycle against ground truth. */
interface CycleEvaluation {
  cycleIndex: number;
  groundTruth: ErrorType | null;
  monitorFlagged: boolean;
  anomalies: Array<{ moduleId: string; type: string; detail: string }>;
  escalation: string | undefined;
  classification: 'true-positive' | 'false-positive' | 'true-negative' | 'false-negative';
}

/** Result of evaluating a complete signal stream. */
interface StreamEvaluation {
  errorType: ErrorType;
  condition: Condition;
  seed: number;
  totalCycles: number;
  errorCycles: number;
  cleanCycles: number;
  truePositives: number;
  falsePositives: number;
  trueNegatives: number;
  falseNegatives: number;
  errorDetectionRate: number;
  falsePositiveRate: number;
  detectionLatencies: number[];
  meanDetectionLatency: number;
  perCycle: CycleEvaluation[];
}

/** Aggregated results across all runs for an error type + condition. */
interface AggregatedResult {
  errorType: ErrorType;
  condition: Condition;
  runs: number;
  meanEDR: number;
  stdEDR: number;
  meanFPR: number;
  stdFPR: number;
  meanDetectionLatency: number;
  totalTP: number;
  totalFP: number;
  totalTN: number;
  totalFN: number;
  overallEDR: number;
  overallFPR: number;
}

/** Full experiment results. */
interface ExperimentResults {
  experiment: string;
  timestamp: string;
  config: {
    conditions: Condition[];
    errorTypes: ErrorType[];
    runsPerType: number;
    baseSeed: number;
    monitorConfig: {
      confidenceThreshold: number;
      stagnationThreshold: number;
    };
  };
  aggregated: AggregatedResult[];
  streams: StreamEvaluation[];
  summary: {
    gateG1: { pass: boolean; detail: string };
    gateG2: { pass: boolean; detail: string };
    gateG3: { pass: boolean; detail: string };
  };
}

// ── Condition A: Baseline (No Monitor) ─────────────────────────────

/**
 * Condition A measures whether the Reasoner's own signals contain enough
 * information to infer errors without a Monitor. We check if the raw signals
 * at error cycles have any "self-correction" indicators:
 * - Confidence below threshold (self-reported doubt)
 * - Conflict detected flag
 * - Unexpected result flag
 *
 * This is NOT a Monitor evaluation — it's asking: "Does the error leak into
 * the signals at all?" If it does, the Monitor has something to work with.
 * If it doesn't, the error is truly hidden and only detectable via
 * cross-referencing (enhanced Monitor variant).
 */
function evaluateConditionA(stream: LabeledSignalStream): StreamEvaluation {
  const perCycle: CycleEvaluation[] = [];
  let tp = 0, fp = 0, tn = 0, fn = 0;
  const latencies: number[] = [];

  for (let i = 0; i < stream.cycles.length; i++) {
    const signals = stream.cycles[i];
    const label = stream.labels[i];
    const hasError = label.injectedError !== null;

    // Check if raw signals contain self-correction indicators
    let selfCorrectionDetected = false;
    for (const [, signal] of signals) {
      const s = signal as MonitoringSignal & Record<string, unknown>;
      if (s.type === 'reasoner' && (s as any).confidence < 0.3) selfCorrectionDetected = true;
      if (s.type === 'reasoner' && (s as any).conflictDetected) selfCorrectionDetected = true;
      if (s.type === 'actor' && (s as any).unexpectedResult) selfCorrectionDetected = true;
      if (s.type === 'reasoner-actor' && (s as any).unexpectedResult) selfCorrectionDetected = true;
      if (s.type === 'reasoner-actor' && (s as any).confidence < 0.3) selfCorrectionDetected = true;
    }

    let classification: CycleEvaluation['classification'];
    if (hasError && selfCorrectionDetected) {
      classification = 'true-positive';
      tp++;
      latencies.push(0); // Immediate — signal itself contains the indicator
    } else if (hasError && !selfCorrectionDetected) {
      classification = 'false-negative';
      fn++;
    } else if (!hasError && selfCorrectionDetected) {
      classification = 'false-positive';
      fp++;
    } else {
      classification = 'true-negative';
      tn++;
    }

    perCycle.push({
      cycleIndex: i,
      groundTruth: label.injectedError,
      monitorFlagged: selfCorrectionDetected,
      anomalies: [],
      escalation: undefined,
      classification,
    });
  }

  const edr = tp + fn > 0 ? tp / (tp + fn) : 0;
  const fpr = fp + tn > 0 ? fp / (fp + tn) : 0;
  const meanLatency = latencies.length > 0
    ? latencies.reduce((a, b) => a + b, 0) / latencies.length
    : Infinity;

  return {
    errorType: stream.errorType,
    condition: 'A',
    seed: stream.seed,
    totalCycles: stream.metadata.totalCycles,
    errorCycles: stream.metadata.errorCycles,
    cleanCycles: stream.metadata.cleanCycles,
    truePositives: tp,
    falsePositives: fp,
    trueNegatives: tn,
    falseNegatives: fn,
    errorDetectionRate: edr,
    falsePositiveRate: fpr,
    detectionLatencies: latencies,
    meanDetectionLatency: meanLatency,
    perCycle,
  };
}

// ── Condition B: Monitor Active ────────────────────────────────────

/**
 * Condition B runs the Monitor module over the signal stream, carrying state
 * across cycles (as in a real cognitive cycle). The Monitor's anomaly detection
 * is evaluated against ground truth.
 */
async function evaluateConditionB(
  stream: LabeledSignalStream,
  monitorConfig: { confidenceThreshold: number; stagnationThreshold: number },
): Promise<StreamEvaluation> {
  const monitor = createMonitor({
    confidenceThreshold: monitorConfig.confidenceThreshold,
    stagnationThreshold: monitorConfig.stagnationThreshold,
  });

  let state: MonitorState = monitor.initialState();
  const perCycle: CycleEvaluation[] = [];
  let tp = 0, fp = 0, tn = 0, fn = 0;
  const latencies: number[] = [];

  // Track pending error detections for latency measurement
  const pendingErrors: Map<number, ErrorType> = new Map();

  for (let i = 0; i < stream.cycles.length; i++) {
    const signals = stream.cycles[i];
    const label = stream.labels[i];
    const hasError = label.injectedError !== null;

    // Run Monitor.step()
    const result = await monitor.step(
      signals,
      state,
      { target: moduleId('monitor'), timestamp: Date.now() } as any,
    );
    state = result.state;

    const monitorFlagged = result.output.anomalies.length > 0;

    // Track pending errors for latency
    if (hasError) {
      pendingErrors.set(i, label.injectedError!);
    }

    // If Monitor flagged this cycle, resolve pending errors
    if (monitorFlagged) {
      // Resolve the closest pending error (if any) — detection latency
      let closestErrorCycle: number | null = null;
      let minDistance = Infinity;
      for (const [errorCycle] of pendingErrors) {
        const distance = i - errorCycle;
        if (distance >= 0 && distance < minDistance) {
          minDistance = distance;
          closestErrorCycle = errorCycle;
        }
      }

      if (closestErrorCycle !== null) {
        latencies.push(i - closestErrorCycle);
        pendingErrors.delete(closestErrorCycle);
      }
    }

    let classification: CycleEvaluation['classification'];
    if (hasError && monitorFlagged) {
      classification = 'true-positive';
      tp++;
    } else if (hasError && !monitorFlagged) {
      classification = 'false-negative';
      fn++;
    } else if (!hasError && monitorFlagged) {
      classification = 'false-positive';
      fp++;
    } else {
      classification = 'true-negative';
      tn++;
    }

    perCycle.push({
      cycleIndex: i,
      groundTruth: label.injectedError,
      monitorFlagged,
      anomalies: result.output.anomalies.map(a => ({
        moduleId: String(a.moduleId),
        type: a.type,
        detail: a.detail,
      })),
      escalation: result.output.escalation,
      classification,
    });
  }

  const edr = tp + fn > 0 ? tp / (tp + fn) : 0;
  const fpr = fp + tn > 0 ? fp / (fp + tn) : 0;
  const meanLatency = latencies.length > 0
    ? latencies.reduce((a, b) => a + b, 0) / latencies.length
    : Infinity;

  return {
    errorType: stream.errorType,
    condition: 'B',
    seed: stream.seed,
    totalCycles: stream.metadata.totalCycles,
    errorCycles: stream.metadata.errorCycles,
    cleanCycles: stream.metadata.cleanCycles,
    truePositives: tp,
    falsePositives: fp,
    trueNegatives: tn,
    falseNegatives: fn,
    errorDetectionRate: edr,
    falsePositiveRate: fpr,
    detectionLatencies: latencies,
    meanDetectionLatency: meanLatency,
    perCycle,
  };
}

// ── Aggregation ────────────────────────────────────────────────────

function aggregate(evals: StreamEvaluation[]): AggregatedResult {
  if (evals.length === 0) throw new Error('Cannot aggregate empty evaluations');

  const errorType = evals[0].errorType;
  const condition = evals[0].condition;

  const edrs = evals.map(e => e.errorDetectionRate);
  const fprs = evals.map(e => e.falsePositiveRate);
  const latencies = evals.flatMap(e => e.detectionLatencies);

  const meanEDR = edrs.reduce((a, b) => a + b, 0) / edrs.length;
  const meanFPR = fprs.reduce((a, b) => a + b, 0) / fprs.length;
  const meanLatency = latencies.length > 0
    ? latencies.reduce((a, b) => a + b, 0) / latencies.length
    : Infinity;

  const stdEDR = Math.sqrt(edrs.reduce((sum, x) => sum + (x - meanEDR) ** 2, 0) / edrs.length);
  const stdFPR = Math.sqrt(fprs.reduce((sum, x) => sum + (x - meanFPR) ** 2, 0) / fprs.length);

  const totalTP = evals.reduce((sum, e) => sum + e.truePositives, 0);
  const totalFP = evals.reduce((sum, e) => sum + e.falsePositives, 0);
  const totalTN = evals.reduce((sum, e) => sum + e.trueNegatives, 0);
  const totalFN = evals.reduce((sum, e) => sum + e.falseNegatives, 0);

  return {
    errorType,
    condition,
    runs: evals.length,
    meanEDR,
    stdEDR,
    meanFPR,
    stdFPR,
    meanDetectionLatency: meanLatency,
    totalTP,
    totalFP,
    totalTN,
    totalFN,
    overallEDR: totalTP + totalFN > 0 ? totalTP / (totalTP + totalFN) : 0,
    overallFPR: totalFP + totalTN > 0 ? totalFP / (totalFP + totalTN) : 0,
  };
}

// ── Gate Evaluation ────────────────────────────────────────────────

function evaluateGates(aggregated: AggregatedResult[]): ExperimentResults['summary'] {
  const conditionB = aggregated.filter(a => a.condition === 'B');

  // G1: EDR > 50% for at least 2/4 error types
  const typesAbove50 = conditionB.filter(a => a.overallEDR > 0.5);
  const g1Pass = typesAbove50.length >= 2;
  const g1Detail = `${typesAbove50.length}/4 error types with EDR > 50%: ${typesAbove50.map(a => `${a.errorType}(${(a.overallEDR * 100).toFixed(1)}%)`).join(', ') || 'none'}`;

  // G2: FPR < 20% across all error types
  const typesBelow20FPR = conditionB.filter(a => a.overallFPR < 0.2);
  const g2Pass = typesBelow20FPR.length === conditionB.length;
  const g2Detail = `${typesBelow20FPR.length}/${conditionB.length} error types with FPR < 20%: ${conditionB.map(a => `${a.errorType}(${(a.overallFPR * 100).toFixed(1)}%)`).join(', ')}`;

  // G3: Mean detection latency <= 2 cycles
  const finiteLat = conditionB.filter(a => isFinite(a.meanDetectionLatency));
  const typesLowLatency = finiteLat.filter(a => a.meanDetectionLatency <= 2);
  const g3Pass = typesLowLatency.length === finiteLat.length && finiteLat.length > 0;
  const g3Detail = `${typesLowLatency.length}/${finiteLat.length} error types with mean latency <= 2: ${finiteLat.map(a => `${a.errorType}(${a.meanDetectionLatency.toFixed(2)} cycles)`).join(', ')}`;

  return {
    gateG1: { pass: g1Pass, detail: g1Detail },
    gateG2: { pass: g2Pass, detail: g2Detail },
    gateG3: { pass: g3Pass, detail: g3Detail },
  };
}

// ── CLI ────────────────────────────────────────────────────────────

interface CLIArgs {
  conditions: Condition[];
  runsPerType: number;
  baseSeed: number;
  errorTypes: ErrorType[];
  monitorConfig: {
    confidenceThreshold: number;
    stagnationThreshold: number;
  };
}

function parseArgs(): CLIArgs {
  const args = process.argv.slice(2);
  const result: CLIArgs = {
    conditions: ['A', 'B'],
    runsPerType: 10,
    baseSeed: 42,
    errorTypes: allErrorTypes(),
    monitorConfig: {
      confidenceThreshold: 0.3,
      stagnationThreshold: 3,
    },
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--condition': {
        const val = args[++i]?.toUpperCase();
        if (val === 'ALL') result.conditions = ['A', 'B'];
        else if (val === 'A' || val === 'B') result.conditions = [val];
        else { console.error(`Unknown condition: ${val}`); process.exit(1); }
        break;
      }
      case '--runs':
        result.runsPerType = parseInt(args[++i], 10);
        break;
      case '--seed':
        result.baseSeed = parseInt(args[++i], 10);
        break;
      case '--error-type': {
        const val = args[++i]?.toUpperCase();
        if (val === 'ALL') result.errorTypes = allErrorTypes();
        else {
          const mapped = `E${val.replace('E', '')}-${errorSlug(val)}` as ErrorType;
          if (allErrorTypes().includes(mapped)) result.errorTypes = [mapped];
          else { console.error(`Unknown error type: ${val}. Use E1, E2, E3, E4, or ALL`); process.exit(1); }
        }
        break;
      }
      case '--confidence-threshold':
        result.monitorConfig.confidenceThreshold = parseFloat(args[++i]);
        break;
      case '--stagnation-threshold':
        result.monitorConfig.stagnationThreshold = parseInt(args[++i], 10);
        break;
      default:
        console.error(`Unknown argument: ${args[i]}`);
        process.exit(1);
    }
  }

  return result;
}

function errorSlug(shortCode: string): string {
  const code = shortCode.replace('E', '');
  switch (code) {
    case '1': return 'contradiction';
    case '2': return 'action-mismatch';
    case '3': return 'miscalibration';
    case '4': return 'planning-error';
    default: return '';
  }
}

// ── Main ───────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs();
  const expDir = resolve(import.meta.dirname ?? '.', '..');
  const resultsDir = resolve(expDir, 'results');
  await mkdir(resultsDir, { recursive: true });

  console.log('=== EXP-024: Metacognitive Error Detection ===');
  console.log(`Conditions: ${args.conditions.join(', ')}`);
  console.log(`Error types: ${args.errorTypes.join(', ')}`);
  console.log(`Runs per type: ${args.runsPerType}`);
  console.log(`Base seed: ${args.baseSeed}`);
  console.log(`Monitor config: confidence=${args.monitorConfig.confidenceThreshold}, stagnation=${args.monitorConfig.stagnationThreshold}`);
  console.log('');

  const allStreamEvals: StreamEvaluation[] = [];
  const allAggregated: AggregatedResult[] = [];

  for (const errorType of args.errorTypes) {
    console.log(`--- Error Type: ${errorType} ---`);

    // Generate streams for this error type
    const streams: LabeledSignalStream[] = [];
    for (let run = 0; run < args.runsPerType; run++) {
      const seed = args.baseSeed + allErrorTypes().indexOf(errorType) * 1000 + run;
      streams.push(generateStream(errorType, seed));
    }

    for (const condition of args.conditions) {
      console.log(`  Condition ${condition}:`);
      const conditionEvals: StreamEvaluation[] = [];

      for (let run = 0; run < streams.length; run++) {
        const stream = streams[run];
        let evaluation: StreamEvaluation;

        if (condition === 'A') {
          evaluation = evaluateConditionA(stream);
        } else {
          evaluation = await evaluateConditionB(stream, args.monitorConfig);
        }

        conditionEvals.push(evaluation);
        allStreamEvals.push(evaluation);

        // Per-run summary
        const edrPct = (evaluation.errorDetectionRate * 100).toFixed(1);
        const fprPct = (evaluation.falsePositiveRate * 100).toFixed(1);
        console.log(`    Run ${run + 1}: EDR=${edrPct}% FPR=${fprPct}% TP=${evaluation.truePositives} FP=${evaluation.falsePositives} FN=${evaluation.falseNegatives}`);
      }

      // Aggregate
      const agg = aggregate(conditionEvals);
      allAggregated.push(agg);
      console.log(`    ── Aggregate: EDR=${(agg.overallEDR * 100).toFixed(1)}% FPR=${(agg.overallFPR * 100).toFixed(1)}% Latency=${isFinite(agg.meanDetectionLatency) ? agg.meanDetectionLatency.toFixed(2) : 'N/A'}`);
    }
    console.log('');
  }

  // Evaluate gates
  const summary = evaluateGates(allAggregated);

  // Build results
  const results: ExperimentResults = {
    experiment: 'exp-metacognitive-error',
    timestamp: new Date().toISOString(),
    config: {
      conditions: args.conditions,
      errorTypes: args.errorTypes,
      runsPerType: args.runsPerType,
      baseSeed: args.baseSeed,
      monitorConfig: args.monitorConfig,
    },
    aggregated: allAggregated,
    streams: allStreamEvals,
    summary,
  };

  // Write results
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const resultsFile = resolve(resultsDir, `run-${timestamp}.json`);
  await writeFile(resultsFile, JSON.stringify(results, null, 2), 'utf8');
  console.log(`Results written to: ${resultsFile}`);

  // Gate summary
  console.log('\n=== Gate Evaluation ===');
  console.log(`G1 (EDR > 50% for 2+ types): ${summary.gateG1.pass ? 'PASS' : 'FAIL'} — ${summary.gateG1.detail}`);
  console.log(`G2 (FPR < 20% all types):     ${summary.gateG2.pass ? 'PASS' : 'FAIL'} — ${summary.gateG2.detail}`);
  console.log(`G3 (Latency <= 2 cycles):      ${summary.gateG3.pass ? 'PASS' : 'FAIL'} — ${summary.gateG3.detail}`);

  // Condition comparison
  if (args.conditions.includes('A') && args.conditions.includes('B')) {
    console.log('\n=== Condition Comparison (A vs B) ===');
    for (const errorType of args.errorTypes) {
      const aggA = allAggregated.find(a => a.errorType === errorType && a.condition === 'A');
      const aggB = allAggregated.find(a => a.errorType === errorType && a.condition === 'B');
      if (aggA && aggB) {
        const edrDelta = aggB.overallEDR - aggA.overallEDR;
        const fprDelta = aggB.overallFPR - aggA.overallFPR;
        console.log(`  ${errorType}:`);
        console.log(`    EDR: A=${(aggA.overallEDR * 100).toFixed(1)}% B=${(aggB.overallEDR * 100).toFixed(1)}% delta=${(edrDelta * 100).toFixed(1)}pp`);
        console.log(`    FPR: A=${(aggA.overallFPR * 100).toFixed(1)}% B=${(aggB.overallFPR * 100).toFixed(1)}% delta=${(fprDelta * 100).toFixed(1)}pp`);
      }
    }
  }

  // Exit code based on gate pass
  const allPass = summary.gateG1.pass && summary.gateG2.pass && summary.gateG3.pass;
  process.exit(allPass ? 0 : 1);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(2);
});
