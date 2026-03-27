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

/** A structured action instruction for the Actor to execute. */
export interface ActionInstruction {
  /** Tool name to invoke. */
  tool: string;
  /** Tool-specific input (JSON-serializable). */
  input: unknown;
  /** Why this action was chosen. */
  rationale: string;
  /** Self-reported confidence (0-1). */
  confidence?: number;
}

/** Output of the reasoner: the reasoning trace. */
export interface ReasonerOutput {
  /** The reasoning trace text. */
  trace: string;
  /** Extracted confidence score (0-1). */
  confidence: number;
  /** Whether contradictory signals were detected. */
  conflictDetected: boolean;
  /** Structured action instruction, if the LLM produced one. */
  action?: ActionInstruction;
}

/** Reasoner internal state. */
export interface ReasonerState {
  /** Number of LLM invocations performed. */
  invocationCount: number;
  /** Confidence from the last invocation. */
  lastConfidence: number;
  /** Accumulated chain-of-thought across steps. */
  chainOfThought: string[];
  /** Cumulative real token count. */
  totalTokensUsed: number;
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

const ACTION_INSTRUCTION = `

After your reasoning, output exactly ONE action block specifying what tool to call next.
Use this exact format:

<action>
{"tool": "ToolName", "input": {"param": "value"}, "rationale": "why this action", "confidence": 0.8}
</action>

"confidence": a number 0.0 (very uncertain) to 1.0 (certain this is the right action)

Available tool input schemas:
- Read: {"file_path": "path/to/file"}
- Write: {"file_path": "path/to/file", "content": "file content"}
- Edit: {"file_path": "path/to/file", "old_string": "text to find", "new_string": "replacement"}
- Glob: {"pattern": "**/*.ts"}
- Grep: {"pattern": "searchRegex", "path": "directory"}
- Bash: {"command": "shell command"}

If the task is complete and no further action is needed, output:
<action>
{"tool": "done", "input": {}, "rationale": "task complete", "confidence": 1.0}
</action>
`;

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

// ── Action Block Parsing ────────────────────────────────────────

const ACTION_BLOCK_REGEX = /<action>\s*([\s\S]*?)\s*<\/action>/;

/**
 * Parse a structured action instruction from the LLM response.
 * Returns undefined if no valid action block is found.
 */
function parseActionBlock(text: string): ActionInstruction | undefined {
  const match = ACTION_BLOCK_REGEX.exec(text);
  if (!match) return undefined;

  try {
    const parsed = JSON.parse(match[1]);
    if (typeof parsed.tool === 'string' && parsed.input !== undefined) {
      const instruction: ActionInstruction = {
        tool: parsed.tool,
        input: parsed.input,
        rationale: typeof parsed.rationale === 'string' ? parsed.rationale : '',
      };
      if (typeof parsed.confidence === 'number' && parsed.confidence >= 0 && parsed.confidence <= 1) {
        instruction.confidence = parsed.confidence;
      }
      return instruction;
    }
  } catch {
    // JSON parse failed — malformed action block, ignore
  }
  return undefined;
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
        totalTokensUsed: 0,
      };
    },

    async step(
      input: ReasonerInput,
      state: ReasonerState,
      control: ReasonerControl,
    ): Promise<StepResult<ReasonerOutput, ReasonerState, ReasonerMonitoring>> {
      try {
        // Build strategy-specific system prompt with action instruction
        const strategyPrompt = STRATEGY_PROMPTS[control.strategy];
        const effortPrefix = EFFORT_PREFIXES[control.effort];
        const systemPrompt = `${effortPrefix}${strategyPrompt}${ACTION_INSTRUCTION}`;

        // Invoke provider adapter with workspace snapshot
        const adapterConfig: AdapterConfig = {
          pactTemplate,
          systemPrompt,
        };

        const result = await adapter.invoke(input.snapshot, adapterConfig);
        const trace = result.output;
        const realTokens = result.usage.totalTokens;

        // Extract confidence and conflict signals
        const conflictDetected = detectConflict(trace);

        // Parse structured action instruction from LLM response
        const action = parseActionBlock(trace);

        // Use self-reported confidence from action block if present, else extract heuristically
        const confidence = (action?.confidence !== undefined)
          ? action.confidence
          : extractConfidence(trace);

        // Write reasoning trace to workspace
        const traceEntry: WorkspaceEntry = {
          source: id,
          content: trace,
          salience: confidence,
          timestamp: Date.now(),
        };
        writePort.write(traceEntry);

        // If action instruction was parsed, write it as a separate structured entry
        if (action) {
          const actionEntry: WorkspaceEntry = {
            source: id,
            content: { type: 'action_instruction', ...action },
            salience: 1.0,  // high salience — the Actor needs this
            timestamp: Date.now(),
          };
          writePort.write(actionEntry);
        }

        // Update state
        const newState: ReasonerState = {
          invocationCount: state.invocationCount + 1,
          lastConfidence: confidence,
          chainOfThought: [...state.chainOfThought, trace],
          totalTokensUsed: state.totalTokensUsed + realTokens,
        };

        const monitoring: ReasonerMonitoring = {
          type: 'reasoner',
          source: id,
          timestamp: Date.now(),
          confidence,
          conflictDetected,
          effortLevel: control.effort,
          tokensThisStep: realTokens,
        };

        return {
          output: { trace, confidence, conflictDetected, action },
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
          tokensThisStep: 0,
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
