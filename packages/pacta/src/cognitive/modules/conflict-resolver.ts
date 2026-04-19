// SPDX-License-Identifier: Apache-2.0
/**
 * Conflict Resolver — synthesizes parallel adversarial reasoning (PRD 032, P1).
 *
 * When two reasoner-actors produce competing proposals (one optimistic, one critical),
 * the conflict resolver decides which to follow or synthesizes a combination.
 *
 * Grounded in: GWT competitive workspace access, ACT-R conflict resolution.
 */

import type {
  CognitiveModule,
  MonitoringSignal,
  ControlDirective,
  StepResult,
  StepError,
  ProviderAdapter,
  AdapterConfig,
} from '../algebra/index.js';
import { moduleId } from '../algebra/index.js';

// ── Types ────────────────────────────────────────────────────────

/** A single proposal from a parallel reasoner-actor. */
export interface Proposal {
  plan: string;
  reasoning: string;
  action: string;
  confidence: number;
}

/** Input to the conflict resolver: two competing proposals plus task context. */
export interface ConflictInput {
  proposalA: Proposal;
  proposalB: Proposal;
  taskContext: string;
}

/** Output of the conflict resolver: the synthesized resolution. */
export interface ConflictOutput {
  resolution: 'accept-a' | 'accept-b' | 'synthesize';
  selectedPlan: string;
  selectedAction: string;
  rationale: string;
}

/** Conflict resolver internal state. */
export interface ConflictState {
  resolutionCount: number;
  synthesisCount: number;
}

/** Monitoring signal emitted by the conflict resolver. */
export interface ConflictResolverMonitoring extends MonitoringSignal {
  type: 'conflict-resolver';
  resolution: ConflictOutput['resolution'];
  confidenceA: number;
  confidenceB: number;
  tokensThisStep: number;
}

/** Control directive for the conflict resolver. */
export interface ConflictResolverControl extends ControlDirective {
  /** Bias toward synthesis vs. selection. Higher = prefer synthesis. */
  synthesisBias?: number;
}

/** Configuration for the conflict resolver factory. */
export interface ConflictResolverConfig {
  id?: string;
  pactTemplate?: AdapterConfig['pactTemplate'];
}

// ── Prompt Construction ──────────────────────────────────────────

function buildSynthesisPrompt(input: ConflictInput): string {
  return `Two approaches to the current task are proposed:

APPROACH A (confidence: ${input.proposalA.confidence}):
Plan: ${input.proposalA.plan}
Reasoning: ${input.proposalA.reasoning}
Proposed action: ${input.proposalA.action}

APPROACH B (confidence: ${input.proposalB.confidence}):
Plan: ${input.proposalB.plan}
Reasoning: ${input.proposalB.reasoning}
Proposed action: ${input.proposalB.action}

Task context: ${input.taskContext}

Which approach is better? Or can you synthesize a superior approach?
Respond with JSON: {"resolution": "accept-a"|"accept-b"|"synthesize", "plan": "...", "action": "...", "rationale": "..."}`;
}

// ── Response Parsing ─────────────────────────────────────────────

/** Shape of the parsed JSON response from the LLM. */
interface ParsedResolution {
  resolution: 'accept-a' | 'accept-b' | 'synthesize';
  plan: string;
  action: string;
  rationale: string;
}

const VALID_RESOLUTIONS = new Set<string>(['accept-a', 'accept-b', 'synthesize']);

/** Extract JSON from LLM response text, handling markdown fences and surrounding prose. */
function extractJson(text: string): string | null {
  // Try markdown-fenced JSON first
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  if (fenced) return fenced[1].trim();

  // Try bare JSON object
  const braceMatch = /\{[\s\S]*\}/.exec(text);
  if (braceMatch) return braceMatch[0];

  return null;
}

/** Parse and validate the LLM resolution response. Returns null on any failure. */
function parseResolution(text: string): ParsedResolution | null {
  const jsonStr = extractJson(text);
  if (!jsonStr) return null;

  try {
    const parsed = JSON.parse(jsonStr);

    if (
      typeof parsed.resolution === 'string' &&
      VALID_RESOLUTIONS.has(parsed.resolution) &&
      typeof parsed.plan === 'string' &&
      typeof parsed.action === 'string' &&
      typeof parsed.rationale === 'string'
    ) {
      return {
        resolution: parsed.resolution as ParsedResolution['resolution'],
        plan: parsed.plan,
        action: parsed.action,
        rationale: parsed.rationale,
      };
    }
  } catch {
    // JSON parse failed — malformed response
  }

  return null;
}

// ── Fallback Strategy ────────────────────────────────────────────

/** When the LLM call fails, accept the higher-confidence proposal. */
function fallbackResolution(input: ConflictInput): ConflictOutput {
  if (input.proposalA.confidence >= input.proposalB.confidence) {
    return {
      resolution: 'accept-a',
      selectedPlan: input.proposalA.plan,
      selectedAction: input.proposalA.action,
      rationale: `Fallback: accepted proposal A (confidence ${input.proposalA.confidence} >= ${input.proposalB.confidence})`,
    };
  }
  return {
    resolution: 'accept-b',
    selectedPlan: input.proposalB.plan,
    selectedAction: input.proposalB.action,
    rationale: `Fallback: accepted proposal B (confidence ${input.proposalB.confidence} > ${input.proposalA.confidence})`,
  };
}

// ── Factory ──────────────────────────────────────────────────────

/**
 * Create a Conflict Resolver cognitive module.
 *
 * Takes two competing action proposals from parallel reasoner-actors and
 * synthesizes a resolution: accept one, or combine both into a superior plan.
 *
 * @param llm - The ProviderAdapter for LLM invocation.
 * @param config - Optional configuration.
 */
export function createConflictResolver(
  llm: ProviderAdapter,
  config?: ConflictResolverConfig,
): CognitiveModule<ConflictInput, ConflictOutput, ConflictState, ConflictResolverMonitoring, ConflictResolverControl> {
  const id = moduleId(config?.id ?? 'conflict-resolver');
  const pactTemplate = config?.pactTemplate ?? {};

  return {
    id,

    initialState(): ConflictState {
      return {
        resolutionCount: 0,
        synthesisCount: 0,
      };
    },

    stateInvariant(state: ConflictState): boolean {
      return (
        state.resolutionCount >= 0 &&
        state.synthesisCount >= 0 &&
        state.synthesisCount <= state.resolutionCount
      );
    },

    async step(
      input: ConflictInput,
      state: ConflictState,
      control: ConflictResolverControl,
    ): Promise<StepResult<ConflictOutput, ConflictState, ConflictResolverMonitoring>> {
      let output: ConflictOutput;
      let tokensUsed = 0;

      try {
        // 1. Build the synthesis prompt
        const prompt = buildSynthesisPrompt(input);

        // 2. Call ProviderAdapter
        const adapterConfig: AdapterConfig = {
          pactTemplate,
          systemPrompt:
            'You are a conflict resolution module. Analyze two competing proposals and decide which is better, ' +
            'or synthesize a superior approach. Always respond with valid JSON.',
        };

        const result = await llm.invoke(
          [{ source: id, content: prompt, salience: 1, timestamp: Date.now() }],
          adapterConfig,
        );

        tokensUsed = result.usage.totalTokens;

        // 3. Parse JSON response
        const parsed = parseResolution(result.output);

        if (parsed) {
          output = {
            resolution: parsed.resolution,
            selectedPlan: parsed.plan,
            selectedAction: parsed.action,
            rationale: parsed.rationale,
          };
        } else {
          // Parsing failed — fall back to confidence-based selection
          output = fallbackResolution(input);
          output.rationale = `Parse fallback (unparseable LLM response): ${output.rationale}`;
        }
      } catch {
        // LLM call failed — fall back to higher-confidence proposal
        output = fallbackResolution(input);
      }

      // 4. Update state
      const newState: ConflictState = {
        resolutionCount: state.resolutionCount + 1,
        synthesisCount: state.synthesisCount + (output.resolution === 'synthesize' ? 1 : 0),
      };

      // 5. Build monitoring signal
      const monitoring = {
        type: 'conflict-resolver',
        source: id,
        timestamp: Date.now(),
        resolution: output.resolution,
        confidenceA: input.proposalA.confidence,
        confidenceB: input.proposalB.confidence,
        tokensThisStep: tokensUsed,
      } as ConflictResolverMonitoring;

      return {
        output,
        state: newState,
        monitoring,
      };
    },
  };
}
