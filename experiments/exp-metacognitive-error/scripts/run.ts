/**
 * EXP-024 Runner — Metacognitive Error Detection
 *
 * Tests whether the Monitor module detects reasoning errors injected into
 * synthetic monitoring signal streams. Three conditions:
 *
 *   A (baseline):    No Monitor — measure Reasoner's self-correction signals only
 *   B (v1-monitor):  v1 Monitor module active — measure anomaly detection accuracy
 *   C (v2-monitor):  v2 MonitorV2 with prediction-error tracking, adaptive thresholds
 *
 * Usage:
 *   ANTHROPIC_API_KEY=... npx tsx experiments/exp-metacognitive-error/scripts/run.ts \
 *     [--condition a|b|c|all] [--runs 10] [--seed 42] [--error-type E1|E2|E3|E4|all]
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
import { createMonitorV2 } from '../../../packages/pacta/src/cognitive/modules/monitor-v2.js';
import type { MonitorV2State, MonitorV2Config } from '../../../packages/pacta/src/cognitive/algebra/enriched-signals.js';

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

type Condition = 'A' | 'B' | 'C';

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
  dPrime: number;
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
  meanDPrime: number;
  stdDPrime: number;
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
    monitorV2Config: MonitorV2Config;
  };
  aggregated: AggregatedResult[];
  streams: StreamEvaluation[];
  summary: {
    gateG1: { pass: boolean; detail: string };
    gateG2: { pass: boolean; detail: string };
    gateG3: { pass: boolean; detail: string };
  };
}

// ── d' (d-prime) — Signal Detection Theory ───────────────────────────

/**
 * Approximate inverse normal CDF (probit function) using Abramowitz & Stegun
 * rational approximation (formula 26.2.23). Accurate to ~4.5e-4.
 *
 * Used for computing d' = Z(hit rate) - Z(false alarm rate).
 */
function inverseNormalCDF(p: number): number {
  // Handle boundary — clamp should prevent this, but be safe
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;

  // Use symmetry: for p > 0.5, compute -Z(1-p)
  const sign = p < 0.5 ? -1 : 1;
  const q = p < 0.5 ? p : 1 - p;

  // Rational approximation constants (Abramowitz & Stegun 26.2.23)
  const t = Math.sqrt(-2 * Math.log(q));
  const c0 = 2.515517;
  const c1 = 0.802853;
  const c2 = 0.010328;
  const d1 = 1.432788;
  const d2 = 0.189269;
  const d3 = 0.001308;

  const numerator = c0 + c1 * t + c2 * t * t;
  const denominator = 1 + d1 * t + d2 * t * t + d3 * t * t * t;

  return sign * (t - numerator / denominator);
}

/**
 * Compute d' (d-prime) — metacognitive sensitivity metric from signal detection theory.
 *
 * d' = Z(hit rate) - Z(false alarm rate)
 *
 * Higher d' indicates better discrimination between error and clean cycles.
 * d' = 0 means no discrimination; d' > 1 indicates meaningful sensitivity.
 *
 * Rates are clamped to [0.01, 0.99] to avoid infinite Z-scores.
 */
function computeDPrime(hitRate: number, falseAlarmRate: number): number {
  const hr = Math.min(Math.max(hitRate, 0.01), 0.99);
  const far = Math.min(Math.max(falseAlarmRate, 0.01), 0.99);
  return inverseNormalCDF(hr) - inverseNormalCDF(far);
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
  const dPrime = computeDPrime(edr, fpr);
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
    dPrime,
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
  const dPrime = computeDPrime(edr, fpr);
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
    dPrime,
    detectionLatencies: latencies,
    meanDetectionLatency: meanLatency,
    perCycle,
  };
}

// ── Condition C: MonitorV2 (Prediction-Error Tracking) ───────────────

/**
 * Condition C runs the MonitorV2 module over the signal stream. MonitorV2 is a
 * drop-in replacement for v1 Monitor, adding:
 *   - Prediction-error tracking (Friston 2009) — per-module expectation models
 *   - Precision weighting (Da Costa 2024) — inverse-variance reliability weights
 *   - Adaptive thresholds (Botvinick 2001) — Gratton effect on confidence threshold
 *   - Metacognitive taxonomy (Nelson & Narens 1990) — EOL, JOL, FOK, RC
 *
 * Produces the same MonitorReport output as v1 for direct comparison.
 */
async function evaluateConditionC(
  stream: LabeledSignalStream,
  v2Config: MonitorV2Config,
): Promise<StreamEvaluation> {
  const monitor = createMonitorV2(v2Config);

  let state: MonitorV2State = monitor.initialState();
  const perCycle: CycleEvaluation[] = [];
  let tp = 0, fp = 0, tn = 0, fn = 0;
  const latencies: number[] = [];

  // Track pending error detections for latency measurement
  const pendingErrors: Map<number, ErrorType> = new Map();

  for (let i = 0; i < stream.cycles.length; i++) {
    const signals = stream.cycles[i];
    const label = stream.labels[i];
    const hasError = label.injectedError !== null;

    // Run MonitorV2.step() — same interface as v1
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
  const dPrime = computeDPrime(edr, fpr);
  const meanLatency = latencies.length > 0
    ? latencies.reduce((a, b) => a + b, 0) / latencies.length
    : Infinity;

  return {
    errorType: stream.errorType,
    condition: 'C',
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
    dPrime,
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
  const dPrimes = evals.map(e => e.dPrime);
  const latencies = evals.flatMap(e => e.detectionLatencies);

  const meanEDR = edrs.reduce((a, b) => a + b, 0) / edrs.length;
  const meanFPR = fprs.reduce((a, b) => a + b, 0) / fprs.length;
  const meanDPrime = dPrimes.reduce((a, b) => a + b, 0) / dPrimes.length;
  const meanLatency = latencies.length > 0
    ? latencies.reduce((a, b) => a + b, 0) / latencies.length
    : Infinity;

  const stdEDR = Math.sqrt(edrs.reduce((sum, x) => sum + (x - meanEDR) ** 2, 0) / edrs.length);
  const stdFPR = Math.sqrt(fprs.reduce((sum, x) => sum + (x - meanFPR) ** 2, 0) / fprs.length);
  const stdDPrime = Math.sqrt(dPrimes.reduce((sum, x) => sum + (x - meanDPrime) ** 2, 0) / dPrimes.length);

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
    meanDPrime,
    stdDPrime,
  };
}

// ── Gate Evaluation ────────────────────────────────────────────────

function evaluateGates(aggregated: AggregatedResult[]): ExperimentResults['summary'] {
  // Evaluate gates against the best monitor condition present (prefer C over B)
  const conditionC = aggregated.filter(a => a.condition === 'C');
  const conditionB = aggregated.filter(a => a.condition === 'B');
  const monitorResults = conditionC.length > 0 ? conditionC : conditionB;
  const monitorLabel = conditionC.length > 0 ? 'C (v2)' : 'B (v1)';

  // G1: EDR > 50% for at least 2/4 error types
  const typesAbove50 = monitorResults.filter(a => a.overallEDR > 0.5);
  const g1Pass = typesAbove50.length >= 2;
  const g1Detail = `[${monitorLabel}] ${typesAbove50.length}/4 error types with EDR > 50%: ${typesAbove50.map(a => `${a.errorType}(${(a.overallEDR * 100).toFixed(1)}%)`).join(', ') || 'none'}`;

  // G2: FPR < 20% across all error types
  const typesBelow20FPR = monitorResults.filter(a => a.overallFPR < 0.2);
  const g2Pass = typesBelow20FPR.length === monitorResults.length;
  const g2Detail = `[${monitorLabel}] ${typesBelow20FPR.length}/${monitorResults.length} error types with FPR < 20%: ${monitorResults.map(a => `${a.errorType}(${(a.overallFPR * 100).toFixed(1)}%)`).join(', ')}`;

  // G3: Mean detection latency <= 2 cycles
  const finiteLat = monitorResults.filter(a => isFinite(a.meanDetectionLatency));
  const typesLowLatency = finiteLat.filter(a => a.meanDetectionLatency <= 2);
  const g3Pass = typesLowLatency.length === finiteLat.length && finiteLat.length > 0;
  const g3Detail = `[${monitorLabel}] ${typesLowLatency.length}/${finiteLat.length} error types with mean latency <= 2: ${finiteLat.map(a => `${a.errorType}(${a.meanDetectionLatency.toFixed(2)} cycles)`).join(', ')}`;

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
  monitorV2Config: MonitorV2Config;
}

function parseArgs(): CLIArgs {
  const args = process.argv.slice(2);
  const result: CLIArgs = {
    conditions: ['A', 'B', 'C'],
    runsPerType: 10,
    baseSeed: 42,
    errorTypes: allErrorTypes(),
    monitorConfig: {
      confidenceThreshold: 0.3,
      stagnationThreshold: 3,
    },
    monitorV2Config: {
      baseConfidenceThreshold: 0.3,
      stagnationThreshold: 3,
      predictionErrorThreshold: 1.5,
      expectationAlpha: 0.2,
      grattonDelta: 0.05,
      thresholdFloor: 0.1,
      thresholdCeiling: 0.6,
    },
  };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--condition': {
        const val = args[++i]?.toUpperCase();
        if (val === 'ALL') result.conditions = ['A', 'B', 'C'];
        else if (val === 'A' || val === 'B' || val === 'C') result.conditions = [val];
        else { console.error(`Unknown condition: ${val}. Use A, B, C, or ALL`); process.exit(1); }
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
  console.log(`Monitor v1 config: confidence=${args.monitorConfig.confidenceThreshold}, stagnation=${args.monitorConfig.stagnationThreshold}`);
  console.log(`Monitor v2 config: baseThreshold=${args.monitorV2Config.baseConfidenceThreshold}, predErrorThreshold=${args.monitorV2Config.predictionErrorThreshold}, alpha=${args.monitorV2Config.expectationAlpha}, grattonDelta=${args.monitorV2Config.grattonDelta}`);
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
        } else if (condition === 'B') {
          evaluation = await evaluateConditionB(stream, args.monitorConfig);
        } else {
          evaluation = await evaluateConditionC(stream, args.monitorV2Config);
        }

        conditionEvals.push(evaluation);
        allStreamEvals.push(evaluation);

        // Per-run summary
        const edrPct = (evaluation.errorDetectionRate * 100).toFixed(1);
        const fprPct = (evaluation.falsePositiveRate * 100).toFixed(1);
        const dp = evaluation.dPrime.toFixed(2);
        console.log(`    Run ${run + 1}: EDR=${edrPct}% FPR=${fprPct}% d'=${dp} TP=${evaluation.truePositives} FP=${evaluation.falsePositives} FN=${evaluation.falseNegatives}`);
      }

      // Aggregate
      const agg = aggregate(conditionEvals);
      allAggregated.push(agg);
      console.log(`    ── Aggregate: EDR=${(agg.overallEDR * 100).toFixed(1)}% FPR=${(agg.overallFPR * 100).toFixed(1)}% d'=${agg.meanDPrime.toFixed(2)}(±${agg.stdDPrime.toFixed(2)}) Latency=${isFinite(agg.meanDetectionLatency) ? agg.meanDetectionLatency.toFixed(2) : 'N/A'}`);
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
      monitorV2Config: args.monitorV2Config,
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
  const presentConditions = args.conditions.filter(c => allAggregated.some(a => a.condition === c));
  if (presentConditions.length >= 2) {
    console.log(`\n=== Condition Comparison (${presentConditions.join(' vs ')}) ===`);
    for (const errorType of args.errorTypes) {
      const byCondition = new Map<Condition, AggregatedResult>();
      for (const c of presentConditions) {
        const agg = allAggregated.find(a => a.errorType === errorType && a.condition === c);
        if (agg) byCondition.set(c, agg);
      }

      if (byCondition.size >= 2) {
        console.log(`  ${errorType}:`);
        const condLabels = [...byCondition.keys()];
        const edrLine = condLabels.map(c => `${c}=${(byCondition.get(c)!.overallEDR * 100).toFixed(1)}%`).join(' ');
        const fprLine = condLabels.map(c => `${c}=${(byCondition.get(c)!.overallFPR * 100).toFixed(1)}%`).join(' ');
        const dpLine = condLabels.map(c => `${c}=${byCondition.get(c)!.meanDPrime.toFixed(2)}`).join(' ');
        console.log(`    EDR: ${edrLine}`);
        console.log(`    FPR: ${fprLine}`);
        console.log(`    d':  ${dpLine}`);

        // Show B->C delta if both present
        if (byCondition.has('B') && byCondition.has('C')) {
          const aggB = byCondition.get('B')!;
          const aggC = byCondition.get('C')!;
          const edrDelta = aggC.overallEDR - aggB.overallEDR;
          const fprDelta = aggC.overallFPR - aggB.overallFPR;
          const dpDelta = aggC.meanDPrime - aggB.meanDPrime;
          console.log(`    v2 delta: EDR=${(edrDelta * 100).toFixed(1)}pp FPR=${(fprDelta * 100).toFixed(1)}pp d'=${dpDelta.toFixed(2)}`);
        }
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
