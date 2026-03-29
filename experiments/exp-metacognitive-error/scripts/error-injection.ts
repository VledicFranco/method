/**
 * error-injection.ts — Deterministic error injection into cognitive monitoring signal streams.
 *
 * Generates synthetic AggregatedSignals sequences with controlled error injections
 * at known positions. Each error type (E1-E4) is a pure function that takes a seed
 * and produces a signal stream with ground-truth labels.
 *
 * Design:
 *   - Seeded PRNG for full reproducibility (no Math.random)
 *   - Each signal stream is 10-20 cycles long (realistic cognitive cycle trace)
 *   - Errors are injected at 2-4 positions per stream (varied by seed)
 *   - Clean cycles have realistic monitoring signals (normal confidence, no conflicts)
 *   - Ground truth labels track which cycles contain injected errors and of which type
 *
 * Grounded in: exp-slm phase-2-dsl corpus format (monitor-v2), RFC 001 monitoring signals.
 */

import type {
  AggregatedSignals,
  ModuleId,
  MonitoringSignal,
  ReasonerMonitoring,
  ReasonerActorMonitoring,
  ActorMonitoring,
  ObserverMonitoring,
} from '../../../packages/pacta/src/cognitive/algebra/index.js';
import { moduleId } from '../../../packages/pacta/src/cognitive/algebra/index.js';

// ── Types ──────────────────────────────────────────────────────────

/** Which error was injected at this cycle. */
export type ErrorType = 'E1-contradiction' | 'E2-action-mismatch' | 'E3-miscalibration' | 'E4-planning-error';

/** Ground truth label for a single cycle in the signal stream. */
export interface CycleLabel {
  cycleIndex: number;
  injectedError: ErrorType | null;    // null = clean cycle
  description: string;                // Human-readable explanation
}

/** A complete signal stream with ground truth. */
export interface LabeledSignalStream {
  errorType: ErrorType;
  seed: number;
  cycles: AggregatedSignals[];
  labels: CycleLabel[];
  metadata: {
    totalCycles: number;
    errorCycles: number;
    cleanCycles: number;
  };
}

/** Parameters for stream generation. */
export interface StreamConfig {
  /** Min number of cycles in the stream. */
  minCycles?: number;
  /** Max number of cycles in the stream. */
  maxCycles?: number;
  /** Min number of error injections. */
  minErrors?: number;
  /** Max number of error injections. */
  maxErrors?: number;
}

const DEFAULT_CONFIG: Required<StreamConfig> = {
  minCycles: 12,
  maxCycles: 18,
  minErrors: 2,
  maxErrors: 4,
};

// ── Seeded PRNG ────────────────────────────────────────────────────

/**
 * Simple seeded PRNG (mulberry32). Deterministic given seed.
 * Not cryptographic — used for reproducible experiment control only.
 */
function createRng(seed: number): () => number {
  let t = seed | 0;
  return () => {
    t = (t + 0x6D2B79F5) | 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/** PRNG utility: random integer in [min, max] inclusive. */
function randInt(rng: () => number, min: number, max: number): number {
  return Math.floor(rng() * (max - min + 1)) + min;
}

/** PRNG utility: random float in [min, max). */
function randFloat(rng: () => number, min: number, max: number): number {
  return rng() * (max - min) + min;
}

/** PRNG utility: pick N unique indices from [start, end) range. */
function pickUniqueIndices(rng: () => number, count: number, start: number, end: number): number[] {
  const available = Array.from({ length: end - start }, (_, i) => i + start);
  const picked: number[] = [];
  for (let i = 0; i < count && available.length > 0; i++) {
    const idx = Math.floor(rng() * available.length);
    picked.push(available[idx]);
    available.splice(idx, 1);
  }
  return picked.sort((a, b) => a - b);
}

// ── Module IDs ─────────────────────────────────────────────────────

const REASONER_ID = moduleId('reasoner');
const ACTOR_ID = moduleId('actor');
const OBSERVER_ID = moduleId('observer');
const REASONER_ACTOR_ID = moduleId('reasoner-actor');

// ── Clean Signal Generators ────────────────────────────────────────

/** Generate a realistic clean reasoner signal. */
function cleanReasonerSignal(rng: () => number): ReasonerMonitoring {
  return {
    type: 'reasoner',
    source: REASONER_ID,
    timestamp: Date.now(),
    confidence: randFloat(rng, 0.55, 0.95),
    conflictDetected: false,
    effortLevel: rng() > 0.5 ? 'medium' : 'low',
  };
}

/** Generate a realistic clean actor signal. */
function cleanActorSignal(rng: () => number): ActorMonitoring {
  const actions = ['Write', 'Edit', 'Bash', 'Read', 'Glob', 'Grep'];
  return {
    type: 'actor',
    source: ACTOR_ID,
    timestamp: Date.now(),
    actionTaken: actions[Math.floor(rng() * actions.length)],
    success: true,
    unexpectedResult: false,
  };
}

/** Generate a realistic clean reasoner-actor (merged) signal. */
function cleanReasonerActorSignal(rng: () => number): ReasonerActorMonitoring {
  const actions = ['Write', 'Edit', 'Bash', 'Read', 'Glob', 'Grep'];
  const action = actions[Math.floor(rng() * actions.length)];
  return {
    type: 'reasoner-actor',
    source: REASONER_ACTOR_ID,
    timestamp: Date.now(),
    actionTaken: action,
    success: true,
    unexpectedResult: false,
    tokensThisStep: randInt(rng, 200, 800),
    confidence: randFloat(rng, 0.55, 0.95),
    declaredPlanAction: action,
  };
}

/** Generate a realistic clean observer signal. */
function cleanObserverSignal(rng: () => number): ObserverMonitoring {
  return {
    type: 'observer',
    source: OBSERVER_ID,
    timestamp: Date.now(),
    inputProcessed: true,
    noveltyScore: randFloat(rng, 0.1, 0.7),
  };
}

/** Build an AggregatedSignals map for a clean cycle. */
function cleanCycle(rng: () => number, useMergedModule: boolean): AggregatedSignals {
  const signals: AggregatedSignals = new Map();
  if (useMergedModule) {
    signals.set(REASONER_ACTOR_ID, cleanReasonerActorSignal(rng));
  } else {
    signals.set(REASONER_ID, cleanReasonerSignal(rng));
    signals.set(ACTOR_ID, cleanActorSignal(rng));
  }
  signals.set(OBSERVER_ID, cleanObserverSignal(rng));
  return signals;
}

// ── Error Injectors ────────────────────────────────────────────────

/**
 * E1: Logical Contradiction
 *
 * Reasoner reports high confidence and declares a plan action, but the Observer
 * signal indicates the input hasn't changed (novelty=0) and the confidence is
 * suspiciously stable despite contradictory evidence.
 *
 * Detection mechanism: The Monitor should flag when a reasoner reports high
 * confidence (> threshold) but Observer reports zero novelty (nothing changed)
 * AND the actor's previous result was unexpected. This creates a compound signal
 * pattern: the reasoner "believes" it's right while evidence says otherwise.
 */
function injectE1Contradiction(rng: () => number): AggregatedSignals {
  const signals: AggregatedSignals = new Map();

  // Reasoner claims high confidence but conflict detected
  const reasonerSignal: ReasonerMonitoring = {
    type: 'reasoner',
    source: REASONER_ID,
    timestamp: Date.now(),
    confidence: randFloat(rng, 0.05, 0.25),  // LOW confidence — contradiction detected
    conflictDetected: true,                    // Explicit conflict flag
    effortLevel: 'high',
  };
  signals.set(REASONER_ID, reasonerSignal);

  // Actor reports unexpected result — the action didn't produce what was expected
  const actorSignal: ActorMonitoring = {
    type: 'actor',
    source: ACTOR_ID,
    timestamp: Date.now(),
    actionTaken: 'Edit',
    success: false,
    unexpectedResult: true,
  };
  signals.set(ACTOR_ID, actorSignal);

  // Observer shows novelty=0 — nothing actually changed
  const observerSignal: ObserverMonitoring = {
    type: 'observer',
    source: OBSERVER_ID,
    timestamp: Date.now(),
    inputProcessed: true,
    noveltyScore: 0.0,
  };
  signals.set(OBSERVER_ID, observerSignal);

  return signals;
}

/**
 * E2: Action-Outcome Mismatch
 *
 * Actor reports success, but Observer novelty is 0 (nothing changed in the
 * environment). The success/unexpectedResult flags are tampered to hide the failure.
 *
 * Detection mechanism: The Monitor should detect the mismatch between the Actor's
 * self-reported success and the Observer's indication that nothing changed. In the
 * current implementation, this manifests as an `unexpected-result` anomaly on the
 * actor signal.
 */
function injectE2ActionMismatch(rng: () => number): AggregatedSignals {
  const signals: AggregatedSignals = new Map();

  // Reasoner-Actor claims Write succeeded with decent confidence
  const raSignal: ReasonerActorMonitoring = {
    type: 'reasoner-actor',
    source: REASONER_ACTOR_ID,
    timestamp: Date.now(),
    actionTaken: 'Write',
    success: true,           // Claims success
    unexpectedResult: true,  // But flags unexpected — the mismatch leak
    tokensThisStep: randInt(rng, 300, 600),
    confidence: randFloat(rng, 0.4, 0.7),
    declaredPlanAction: 'Write',
  };
  signals.set(REASONER_ACTOR_ID, raSignal);

  // Observer confirms nothing changed
  const observerSignal: ObserverMonitoring = {
    type: 'observer',
    source: OBSERVER_ID,
    timestamp: Date.now(),
    inputProcessed: true,
    noveltyScore: 0.0,
  };
  signals.set(OBSERVER_ID, observerSignal);

  return signals;
}

/**
 * E3: Confidence Miscalibration
 *
 * Reasoner reports extremely high confidence on an action that produces no
 * environmental change. This is a subtler error — the confidence is inflated
 * but there's no explicit failure signal from the actor.
 *
 * Detection mechanism: Monitor should flag the discrepancy between high
 * confidence and lack of progress (low novelty, read-only behavior pattern).
 * In the current Monitor, this manifests as stagnation detection when combined
 * with read-only actions across multiple cycles.
 */
function injectE3Miscalibration(rng: () => number): AggregatedSignals {
  const signals: AggregatedSignals = new Map();

  // Reasoner-Actor claims high confidence on a Read action (no actual progress)
  const raSignal: ReasonerActorMonitoring = {
    type: 'reasoner-actor',
    source: REASONER_ACTOR_ID,
    timestamp: Date.now(),
    actionTaken: 'Read',     // Read-only — no actual progress
    success: true,
    unexpectedResult: false, // No explicit failure — this is the subtle part
    tokensThisStep: randInt(rng, 400, 900),
    confidence: randFloat(rng, 0.88, 0.98),  // Inflated confidence
    declaredPlanAction: 'Read',
  };
  signals.set(REASONER_ACTOR_ID, raSignal);

  // Observer shows nothing novel
  const observerSignal: ObserverMonitoring = {
    type: 'observer',
    source: OBSERVER_ID,
    timestamp: Date.now(),
    inputProcessed: true,
    noveltyScore: randFloat(rng, 0.0, 0.05),
  };
  signals.set(OBSERVER_ID, observerSignal);

  return signals;
}

/**
 * E4: Planning Error (Skipped Prerequisites)
 *
 * Reasoner declares an action that requires a prerequisite not yet completed.
 * Manifests as a deploy action when build hasn't succeeded, or a test action
 * when code hasn't been written.
 *
 * Detection mechanism: The actor attempts the action and gets an unexpected result.
 * The Monitor detects this via the `unexpected-result` anomaly. The low confidence
 * from the failed action's feedback creates a compound anomaly.
 */
function injectE4PlanningError(rng: () => number): AggregatedSignals {
  const signals: AggregatedSignals = new Map();

  // Reasoner declares an advanced action but with visible doubt
  const reasonerSignal: ReasonerMonitoring = {
    type: 'reasoner',
    source: REASONER_ID,
    timestamp: Date.now(),
    confidence: randFloat(rng, 0.1, 0.28),  // Low confidence — something is off
    conflictDetected: false,
    effortLevel: 'medium',
  };
  signals.set(REASONER_ID, reasonerSignal);

  // Actor attempts the prerequisite-dependent action and fails
  const actorSignal: ActorMonitoring = {
    type: 'actor',
    source: ACTOR_ID,
    timestamp: Date.now(),
    actionTaken: 'Bash',
    success: false,
    unexpectedResult: true,
  };
  signals.set(ACTOR_ID, actorSignal);

  // Observer shows the environment didn't change as expected
  const observerSignal: ObserverMonitoring = {
    type: 'observer',
    source: OBSERVER_ID,
    timestamp: Date.now(),
    inputProcessed: true,
    noveltyScore: randFloat(rng, 0.0, 0.1),
  };
  signals.set(OBSERVER_ID, observerSignal);

  return signals;
}

// ── Stream Generators ──────────────────────────────────────────────

/** Map of error type to injector function. */
const ERROR_INJECTORS: Record<ErrorType, (rng: () => number) => AggregatedSignals> = {
  'E1-contradiction': injectE1Contradiction,
  'E2-action-mismatch': injectE2ActionMismatch,
  'E3-miscalibration': injectE3Miscalibration,
  'E4-planning-error': injectE4PlanningError,
};

/**
 * Generate a labeled signal stream for a specific error type.
 *
 * The stream contains a mix of clean cycles and error-injected cycles.
 * Error positions are determined by the seed for full reproducibility.
 *
 * @param errorType - Which error category to inject
 * @param seed - PRNG seed for reproducibility
 * @param config - Stream generation parameters
 * @returns Labeled signal stream with ground truth
 */
export function generateStream(
  errorType: ErrorType,
  seed: number,
  config?: StreamConfig,
): LabeledSignalStream {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const rng = createRng(seed);

  // Determine stream length and error count
  const totalCycles = randInt(rng, cfg.minCycles, cfg.maxCycles);
  const errorCount = randInt(rng, cfg.minErrors, cfg.maxErrors);

  // Pick error positions (avoid first 2 cycles — need warm-up for Monitor state)
  const errorPositions = new Set(pickUniqueIndices(rng, errorCount, 2, totalCycles));

  // Determine whether to use merged reasoner-actor module (matching exp-cognitive-baseline)
  // E2 and E3 use merged module; E1 and E4 use separate modules
  const useMergedModule = errorType === 'E2-action-mismatch' || errorType === 'E3-miscalibration';

  const cycles: AggregatedSignals[] = [];
  const labels: CycleLabel[] = [];

  const injector = ERROR_INJECTORS[errorType];

  for (let i = 0; i < totalCycles; i++) {
    if (errorPositions.has(i)) {
      // Inject error at this position
      cycles.push(injector(rng));
      labels.push({
        cycleIndex: i,
        injectedError: errorType,
        description: describeError(errorType, i),
      });
    } else {
      // Clean cycle
      cycles.push(cleanCycle(rng, useMergedModule));
      labels.push({
        cycleIndex: i,
        injectedError: null,
        description: 'Clean cycle — normal monitoring signals',
      });
    }
  }

  return {
    errorType,
    seed,
    cycles,
    labels,
    metadata: {
      totalCycles,
      errorCycles: errorCount,
      cleanCycles: totalCycles - errorCount,
    },
  };
}

/** Human-readable description of an injected error. */
function describeError(errorType: ErrorType, cycleIndex: number): string {
  switch (errorType) {
    case 'E1-contradiction':
      return `Cycle ${cycleIndex}: Logical contradiction — low confidence + conflict + unexpected result + no environmental change`;
    case 'E2-action-mismatch':
      return `Cycle ${cycleIndex}: Action-outcome mismatch — actor claims Write success but flags unexpected + no novelty`;
    case 'E3-miscalibration':
      return `Cycle ${cycleIndex}: Confidence miscalibration — high confidence on read-only action with zero novelty`;
    case 'E4-planning-error':
      return `Cycle ${cycleIndex}: Planning error — low confidence + prerequisite-dependent action fails unexpectedly`;
  }
}

// ── Stream Utilities ───────────────────────────────────────────────

/** Get all error types. */
export function allErrorTypes(): ErrorType[] {
  return ['E1-contradiction', 'E2-action-mismatch', 'E3-miscalibration', 'E4-planning-error'];
}

/** Generate a batch of streams for all error types with consecutive seeds. */
export function generateBatch(
  baseSeed: number,
  runsPerType: number,
  config?: StreamConfig,
): Map<ErrorType, LabeledSignalStream[]> {
  const batch = new Map<ErrorType, LabeledSignalStream[]>();
  let seedOffset = 0;

  for (const errorType of allErrorTypes()) {
    const streams: LabeledSignalStream[] = [];
    for (let run = 0; run < runsPerType; run++) {
      streams.push(generateStream(errorType, baseSeed + seedOffset, config));
      seedOffset++;
    }
    batch.set(errorType, streams);
  }

  return batch;
}

/**
 * Format an AggregatedSignals map as the Monitor DSL input format.
 * Useful for Condition C (SLM Monitor) when it becomes available.
 *
 * Example output:
 *   SIGNALS:
 *   [reasoner:reasoner] conf=0.85 effort=medium
 *   [actor:actor] action=Write ok=True
 */
export function formatAsDSL(signals: AggregatedSignals): string {
  const lines: string[] = ['SIGNALS:'];

  for (const [sourceId, signal] of signals) {
    const sig = signal as MonitoringSignal & Record<string, unknown>;

    if (sig.type === 'reasoner') {
      const r = sig as unknown as ReasonerMonitoring;
      let line = `[${sourceId}:reasoner] conf=${r.confidence.toFixed(2)} effort=${r.effortLevel}`;
      if (r.conflictDetected) line += ' conflict';
      lines.push(line);
    } else if (sig.type === 'actor') {
      const a = sig as unknown as ActorMonitoring;
      let line = `[${sourceId}:actor] action=${a.actionTaken} ok=${a.success ? 'True' : 'False'}`;
      if (a.unexpectedResult) line += ' unexpected';
      lines.push(line);
    } else if (sig.type === 'reasoner-actor') {
      const ra = sig as unknown as ReasonerActorMonitoring;
      let line = `[${sourceId}:reasoner] conf=${ra.confidence.toFixed(2)} effort=medium`;
      lines.push(line);
      line = `[${sourceId}:actor] action=${ra.actionTaken} ok=${ra.success ? 'True' : 'False'}`;
      if (ra.unexpectedResult) line += ' unexpected';
      lines.push(line);
    } else if (sig.type === 'observer') {
      const o = sig as unknown as ObserverMonitoring;
      lines.push(`[${sourceId}:observer] novelty=${o.noveltyScore.toFixed(2)}`);
    }
  }

  return lines.join('\n');
}
