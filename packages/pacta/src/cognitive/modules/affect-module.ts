/**
 * Affect Module — emotional metacognition from behavioral patterns (PRD 032, P3).
 *
 * Computes affect signals (valence, arousal, label) from observable behavioral traces.
 * NOT self-report — purely computed from action history and success patterns.
 * All computations are deterministic and rule-based (zero LLM calls).
 *
 * Grounded in: Damasio's somatic marker hypothesis, Schwarz's feelings-as-information.
 */

import type {
  CognitiveModule,
  MonitoringSignal,
  ControlDirective,
  StepResult,
} from '../algebra/index.js';
import { moduleId } from '../algebra/index.js';

// ── Types ──────────────────────────────────────────────────────────

/** Affect signal — computed emotional state from behavioral patterns. */
export interface AffectSignal {
  /** Emotional polarity: -1 (negative) to +1 (positive). */
  valence: number;
  /** Activation level: 0 (calm) to 1 (urgent). */
  arousal: number;
  /** Discrete affect label derived from valence/arousal quadrant. */
  label: 'confident' | 'anxious' | 'frustrated' | 'curious' | 'neutral';
}

/** Input: observable behavioral traces from recent cognitive cycles. */
export interface AffectInput {
  /** Last 5 actions with their success/failure outcomes. */
  recentActions: Array<{ name: string; success: boolean }>;
  /** Last 5 confidence scores (oldest first) for trend detection. */
  confidenceTrend: number[];
  /** Number of distinct action types in the recent window. */
  uniqueActionsInWindow: number;
  /** Cycles elapsed since the agent last performed a Write or Edit action. */
  cyclesSinceLastWrite: number;
  /** Whether the last action revealed previously unknown information. */
  novelInfoDiscovered: boolean;
}

/** Output: computed affect signal with context-appropriate guidance. */
export interface AffectOutput {
  /** The computed affect signal. */
  signal: AffectSignal;
  /** Context-appropriate prompt injection for the agent. Empty string for neutral. */
  guidance: string;
}

/** State: recent affect signals for trend detection across cycles. */
export interface AffectState {
  /** Last 3 affect signals for trend detection. */
  previousSignals: AffectSignal[];
}

/** Configuration for the Affect module. */
export interface AffectConfig {
  /** Module ID override. Default: 'affect'. */
  id?: string;
  /** Minimum successful actions (out of last 5) to trigger confident. Default: 3. */
  confidentSuccessThreshold?: number;
  /** Minimum cycles since last write to trigger frustrated. Default: 3. */
  frustratedWriteThreshold?: number;
  /** Maximum unique actions to trigger frustrated (repetitive behavior). Default: 2. */
  frustratedDiversityThreshold?: number;
  /** Minimum declining confidence cycles to trigger anxious. Default: 3. */
  anxiousDeclineCycles?: number;
}

/** Monitoring signal type for the affect module. */
export interface AffectMonitoring extends MonitoringSignal {
  type: 'affect';
  label: AffectSignal['label'];
  valence: number;
  arousal: number;
}

// ── Pure Computation ───────────────────────────────────────────────

/**
 * Compute an affect signal from behavioral input. Pure function, no side effects.
 *
 * Priority order (first match wins):
 * 1. frustrated — stuck in a loop (high cycles since write + low action diversity)
 * 2. anxious — declining confidence with no recent successes
 * 3. confident — high success rate with stable/rising confidence
 * 4. curious — novel information with high action diversity
 * 5. neutral — default
 */
export function computeAffect(
  input: AffectInput,
  config?: Pick<AffectConfig,
    'confidentSuccessThreshold' |
    'frustratedWriteThreshold' |
    'frustratedDiversityThreshold' |
    'anxiousDeclineCycles'
  >,
): AffectSignal {
  const confidentThreshold = config?.confidentSuccessThreshold ?? 3;
  const frustratedWriteThreshold = config?.frustratedWriteThreshold ?? 3;
  const frustratedDiversityThreshold = config?.frustratedDiversityThreshold ?? 2;
  const anxiousDeclineCycles = config?.anxiousDeclineCycles ?? 3;

  // Check frustrated first — being stuck is the most actionable signal
  if (isFrustrated(input, frustratedWriteThreshold, frustratedDiversityThreshold)) {
    return { valence: -0.7, arousal: 0.9, label: 'frustrated' };
  }

  // Check anxious — declining confidence with failures
  if (isAnxious(input, anxiousDeclineCycles)) {
    return { valence: -0.5, arousal: 0.7, label: 'anxious' };
  }

  // Check confident — things are going well
  if (isConfident(input, confidentThreshold)) {
    return { valence: 0.8, arousal: 0.2, label: 'confident' };
  }

  // Check curious — exploring new information
  if (isCurious(input)) {
    return { valence: 0.5, arousal: 0.5, label: 'curious' };
  }

  // Default: neutral
  return { valence: 0, arousal: 0.3, label: 'neutral' };
}

// ── Condition Detectors ────────────────────────────────────────────

/**
 * Confident: >= threshold of last 5 actions succeeded AND confidence trend is stable/rising.
 */
function isConfident(input: AffectInput, successThreshold: number): boolean {
  const { recentActions, confidenceTrend } = input;

  // Need enough actions to judge
  if (recentActions.length === 0) return false;

  const successCount = recentActions.filter(a => a.success).length;
  if (successCount < successThreshold) return false;

  // Confidence trend must be stable or rising (not declining)
  if (confidenceTrend.length < 2) return successCount >= successThreshold;
  return isStableOrRising(confidenceTrend);
}

/**
 * Anxious: confidence trend declining over 3+ cycles AND no recent successes.
 */
function isAnxious(input: AffectInput, declineCycles: number): boolean {
  const { recentActions, confidenceTrend } = input;

  // Need enough trend data
  if (confidenceTrend.length < declineCycles) return false;

  // Check if trend is declining over the required window
  const recentTrend = confidenceTrend.slice(-declineCycles);
  const declining = isDeclining(recentTrend);
  if (!declining) return false;

  // No recent successes — check if all recent actions failed
  const hasRecentSuccess = recentActions.some(a => a.success);
  return !hasRecentSuccess;
}

/**
 * Frustrated: cyclesSinceLastWrite >= threshold AND uniqueActionsInWindow <= diversityThreshold.
 * The agent is stuck: not making changes and repeating the same actions.
 */
function isFrustrated(
  input: AffectInput,
  writeThreshold: number,
  diversityThreshold: number,
): boolean {
  return (
    input.cyclesSinceLastWrite >= writeThreshold &&
    input.uniqueActionsInWindow <= diversityThreshold
  );
}

/**
 * Curious: novel information discovered AND action diversity is high (> 2 unique actions).
 */
function isCurious(input: AffectInput): boolean {
  return input.novelInfoDiscovered && input.uniqueActionsInWindow > 2;
}

// ── Trend Helpers ──────────────────────────────────────────────────

/** Check if a numeric series is stable or rising (no sustained decline). */
function isStableOrRising(values: number[]): boolean {
  if (values.length < 2) return true;
  // Allow small fluctuations: overall trend from first to last is non-negative
  // AND no more than one consecutive decline
  let consecutiveDeclines = 0;
  let maxConsecutiveDeclines = 0;
  for (let i = 1; i < values.length; i++) {
    if (values[i] < values[i - 1]) {
      consecutiveDeclines++;
      maxConsecutiveDeclines = Math.max(maxConsecutiveDeclines, consecutiveDeclines);
    } else {
      consecutiveDeclines = 0;
    }
  }
  // Stable/rising: no more than 1 consecutive decline
  return maxConsecutiveDeclines <= 1;
}

/** Check if a numeric series is strictly declining (each element < previous). */
function isDeclining(values: number[]): boolean {
  if (values.length < 2) return false;
  for (let i = 1; i < values.length; i++) {
    if (values[i] >= values[i - 1]) return false;
  }
  return true;
}

// ── Guidance Mapping ───────────────────────────────────────────────

/** Map an affect label to context-appropriate guidance text. */
function guidanceForLabel(label: AffectSignal['label']): string {
  switch (label) {
    case 'confident':
      return 'You are making good progress. Continue with the current approach.';
    case 'anxious':
      return 'Your confidence is declining. Consider verifying your current assumptions before proceeding.';
    case 'frustrated':
      return 'You appear stuck in a loop. Step back and consider: what assumptions are you making? What have you NOT examined?';
    case 'curious':
      return 'New information discovered. Take time to understand its implications before acting.';
    case 'neutral':
      return '';
  }
}

// ── Factory ────────────────────────────────────────────────────────

/**
 * Create an Affect cognitive module.
 *
 * The Affect module computes emotional metacognition signals from behavioral
 * patterns — success rates, confidence trends, action diversity, and novelty.
 * All computation is deterministic and rule-based (zero LLM calls).
 */
export function createAffectModule(
  config?: AffectConfig,
): CognitiveModule<AffectInput, AffectOutput, AffectState, AffectMonitoring, ControlDirective> {
  const id = moduleId(config?.id ?? 'affect');

  return {
    id,

    async step(
      input: AffectInput,
      state: AffectState,
      _control: ControlDirective,
    ): Promise<StepResult<AffectOutput, AffectState, AffectMonitoring>> {
      // Compute affect signal — pure, deterministic
      const signal = computeAffect(input, config);
      const guidance = guidanceForLabel(signal.label);

      // Update state: keep last 3 signals for trend detection
      const newPreviousSignals = [...state.previousSignals, signal];
      if (newPreviousSignals.length > 3) {
        newPreviousSignals.shift();
      }

      const newState: AffectState = {
        previousSignals: newPreviousSignals,
      };

      const monitoring: AffectMonitoring = {
        type: 'affect',
        source: id,
        timestamp: Date.now(),
        label: signal.label,
        valence: signal.valence,
        arousal: signal.arousal,
      };

      return {
        output: { signal, guidance },
        state: newState,
        monitoring,
      };
    },

    initialState(): AffectState {
      return {
        previousSignals: [],
      };
    },

    stateInvariant(state: AffectState): boolean {
      return (
        Array.isArray(state.previousSignals) &&
        state.previousSignals.length <= 3 &&
        state.previousSignals.every(
          s =>
            s.valence >= -1 && s.valence <= 1 &&
            s.arousal >= 0 && s.arousal <= 1 &&
            ['confident', 'anxious', 'frustrated', 'curious', 'neutral'].includes(s.label),
        )
      );
    },
  };
}
