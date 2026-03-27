/**
 * Reasoner Module — invokes the LLM provider to produce reasoning traces.
 *
 * The reasoner reads workspace contents, constructs a strategy-appropriate
 * prompt (chain-of-thought, think, or plan), invokes the ProviderAdapter,
 * and writes the reasoning trace back to the workspace.
 *
 * Grounded in: ACT-R procedural module, SOAR problem-space reasoning,
 * CLARION explicit reasoning level.
 */

import type {
  CognitiveModule,
  ModuleId,
  ReasonerMonitoring,
  ControlDirective,
  StepResult,
  StepError,
  WorkspaceWritePort,
  WorkspaceEntry,
  ReadonlyWorkspaceSnapshot,
  ProviderAdapter,
  AdapterConfig,
} from '../algebra/index.js';
import { moduleId } from '../algebra/index.js';

// ── Types ────────────────────────────────────────────────────────

/** Input to the reasoner: a workspace snapshot to reason over. */
export interface ReasonerInput {
  /** Workspace snapshot to use as reasoning context. */
  snapshot: ReadonlyWorkspaceSnapshot;
}

/** Output of the reasoner: the reasoning trace. */
export interface ReasonerOutput {
  /** The reasoning trace text. */
  trace: string;
  /** Extracted confidence score (0-1). */
  confidence: number;
  /** Whether contradictory signals were detected. */
  conflictDetected: boolean;
}

/** Reasoner internal state. */
export interface ReasonerState {
  /** Number of LLM invocations performed. */
  invocationCount: number;
  /** Confidence from the last invocation. */
  lastConfidence: number;
  /** Accumulated chain-of-thought across steps. */
  chainOfThought: string[];
}

/** Control directive for the reasoner. */
export interface ReasonerControl extends ControlDirective {
  /** Reasoning strategy to employ. */
  strategy: 'cot' | 'think' | 'plan';
  /** Effort level controlling prompt detail. */
  effort: 'low' | 'medium' | 'high';
}

/** Configuration for the reasoner factory. */
export interface ReasonerConfig {
  /** Custom module ID. Defaults to 'reasoner'. */
  id?: string;
  /** Base pact template fields for the adapter. */
  pactTemplate?: AdapterConfig['pactTemplate'];
}

// ── Strategy Prompts ─────────────────────────────────────────────

const STRATEGY_PROMPTS: Record<ReasonerControl['strategy'], string> = {
  cot: 'Think step by step. Show your reasoning chain before reaching a conclusion.',
  think: 'Consider the problem deeply. Weigh alternatives and identify the strongest path.',
  plan: 'Produce a structured plan with numbered steps. Identify dependencies and risks.',
};

const EFFORT_PREFIXES: Record<ReasonerControl['effort'], string> = {
  low: 'Briefly: ',
  medium: '',
  high: 'Thoroughly and comprehensively: ',
};

// ── Confidence Extraction ────────────────────────────────────────

/** Keywords that increase confidence. */
const HIGH_CONFIDENCE_KEYWORDS = ['certain', 'confident', 'clearly', 'definitely', 'sure', 'obvious'];
/** Keywords that decrease confidence. */
const LOW_CONFIDENCE_KEYWORDS = ['uncertain', 'unsure', 'maybe', 'perhaps', 'unclear', 'doubtful', 'might'];

/**
 * Extract a confidence score from the response text.
 * Heuristic: count high/low confidence keywords, default to 0.5.
 */
function extractConfidence(text: string): number {
  const lower = text.toLowerCase();
  let score = 0.5;

  for (const kw of HIGH_CONFIDENCE_KEYWORDS) {
    if (lower.includes(kw)) score += 0.08;
  }
  for (const kw of LOW_CONFIDENCE_KEYWORDS) {
    if (lower.includes(kw)) score -= 0.08;
  }

  return Math.min(1, Math.max(0, score));
}

/** Conflict keywords that suggest contradictory reasoning. */
const CONFLICT_KEYWORDS = ['however', 'on the other hand', 'contradicts', 'but', 'alternatively', 'conflict'];

/**
 * Detect contradictory signals in the response.
 * Heuristic: multiple conflict keywords suggest internal contradiction.
 */
function detectConflict(text: string): boolean {
  const lower = text.toLowerCase();
  let conflictCount = 0;
  for (const kw of CONFLICT_KEYWORDS) {
    if (lower.includes(kw)) conflictCount++;
  }
  // Two or more conflict indicators suggests actual contradiction
  return conflictCount >= 2;
}

// ── Factory ──────────────────────────────────────────────────────

/**
 * Create a Reasoner cognitive module.
 *
 * @param adapter - The ProviderAdapter for LLM invocation.
 * @param writePort - Workspace write port for emitting reasoning traces.
 * @param config - Optional configuration.
 */
export function createReasoner(
  adapter: ProviderAdapter,
  writePort: WorkspaceWritePort,
  config?: ReasonerConfig,
): CognitiveModule<ReasonerInput, ReasonerOutput, ReasonerState, ReasonerMonitoring, ReasonerControl> {
  const id = moduleId(config?.id ?? 'reasoner');
  const pactTemplate = config?.pactTemplate ?? {};

  return {
    id,

    initialState(): ReasonerState {
      return {
        invocationCount: 0,
        lastConfidence: 0,
        chainOfThought: [],
      };
    },

    async step(
      input: ReasonerInput,
      state: ReasonerState,
      control: ReasonerControl,
    ): Promise<StepResult<ReasonerOutput, ReasonerState, ReasonerMonitoring>> {
      try {
        // Build strategy-specific system prompt
        const strategyPrompt = STRATEGY_PROMPTS[control.strategy];
        const effortPrefix = EFFORT_PREFIXES[control.effort];
        const systemPrompt = `${effortPrefix}${strategyPrompt}`;

        // Invoke provider adapter with workspace snapshot
        const adapterConfig: AdapterConfig = {
          pactTemplate,
          systemPrompt,
        };

        const result = await adapter.invoke(input.snapshot, adapterConfig);
        const trace = result.output;

        // Extract confidence and conflict signals
        const confidence = extractConfidence(trace);
        const conflictDetected = detectConflict(trace);

        // Write reasoning trace to workspace
        const entry: WorkspaceEntry = {
          source: id,
          content: trace,
          salience: confidence,
          timestamp: Date.now(),
        };
        writePort.write(entry);

        // Update state
        const newState: ReasonerState = {
          invocationCount: state.invocationCount + 1,
          lastConfidence: confidence,
          chainOfThought: [...state.chainOfThought, trace],
        };

        const monitoring: ReasonerMonitoring = {
          type: 'reasoner',
          source: id,
          timestamp: Date.now(),
          confidence,
          conflictDetected,
          effortLevel: control.effort,
        };

        return {
          output: { trace, confidence, conflictDetected },
          state: newState,
          monitoring,
        };
      } catch (err: unknown) {
        const error: StepError = {
          message: err instanceof Error ? err.message : String(err),
          recoverable: true,
          moduleId: id,
          phase: 'reason',
        };

        const monitoring: ReasonerMonitoring = {
          type: 'reasoner',
          source: id,
          timestamp: Date.now(),
          confidence: 0,
          conflictDetected: false,
          effortLevel: control.effort,
        };

        return {
          output: { trace: '', confidence: 0, conflictDetected: false },
          state,
          monitoring,
          error,
        };
      }
    },
  };
}
