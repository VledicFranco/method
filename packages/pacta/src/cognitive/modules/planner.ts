/**
 * Planner — meta-level cognitive module for plan generation and control directive production.
 *
 * Reads workspace snapshots, invokes a ProviderAdapter for LLM-based plan generation,
 * and produces ControlDirective[] as output — directives for object-level modules
 * (Reasoner strategy changes, Actor allowed actions, etc.).
 *
 * Directives are NOT validated here — the cycle orchestrator validates them
 * against ControlPolicy.
 *
 * Grounded in: SOAR deliberate planning, ACT-R goal buffer management.
 */

import type {
  CognitiveModule,
  PlannerMonitoring,
  ControlDirective,
  StepResult,
  StepError,
  ModuleId,
  ReadonlyWorkspaceSnapshot,
  ProviderAdapter,
  AdapterConfig,
} from '../algebra/index.js';
import { moduleId } from '../algebra/index.js';

// ── Types ──────────────────────────────────────────────────────────

/** Configuration for the Planner module. */
export interface PlannerConfig {
  /** System prompt for LLM plan generation. */
  systemPrompt?: string;
  /** Module ID override. Default: 'planner'. */
  id?: string;
  contextBinding?: import('../algebra/partition-types.js').ModuleContextBinding;
}

/** Input to the Planner: workspace snapshot for context. */
export interface PlannerInput {
  workspace: ReadonlyWorkspaceSnapshot;
}

/** A subgoal within the current plan. */
export interface Subgoal {
  description: string;
  status: 'pending' | 'active' | 'completed';
}

/** Output: control directives for object-level modules. */
export interface PlannerOutput {
  directives: ControlDirective[];
  plan: string;
  subgoals: Subgoal[];
}

/** State: current plan, subgoal list, revision count. */
export interface PlannerState {
  currentPlan: string;
  subgoals: Subgoal[];
  revisionCount: number;
}

/** Control directive: replan trigger. */
export interface PlannerControl extends ControlDirective {
  replanTrigger?: string;
}

// ── Factory ────────────────────────────────────────────────────────

/**
 * Create a Planner cognitive module.
 *
 * Invokes a ProviderAdapter for LLM-based plan generation. Produces
 * ControlDirective[] targeting object-level modules.
 */
export function createPlanner(
  adapter: ProviderAdapter,
  config?: PlannerConfig,
): CognitiveModule<PlannerInput, PlannerOutput, PlannerState, PlannerMonitoring, PlannerControl> {
  const id = moduleId(config?.id ?? 'planner');
  const systemPrompt = config?.systemPrompt ??
    'You are a planning module. Given the current workspace context, produce a plan as JSON with fields: plan (string), subgoals (array of {description, status}), directives (array of {target, directiveType, payload}).';

  return {
    id,
    contextBinding: config?.contextBinding,

    async step(
      input: PlannerInput,
      state: PlannerState,
      control: PlannerControl,
    ): Promise<StepResult<PlannerOutput, PlannerState, PlannerMonitoring>> {
      const shouldReplan = control.replanTrigger !== undefined;

      try {
        const adapterConfig: AdapterConfig = {
          pactTemplate: { mode: { type: 'oneshot' } },
          systemPrompt,
        };

        const result = await adapter.invoke(input.workspace, adapterConfig);

        // Parse the LLM output into structured plan
        const parsed = parsePlanOutput(result.output, id);

        const newSubgoals = parsed.subgoals.length > 0 ? parsed.subgoals : state.subgoals;
        const planRevised = shouldReplan || parsed.plan !== state.currentPlan;

        const newState: PlannerState = {
          currentPlan: parsed.plan,
          subgoals: newSubgoals,
          revisionCount: planRevised ? state.revisionCount + 1 : state.revisionCount,
        };

        const monitoring: PlannerMonitoring = {
          type: 'planner',
          source: id,
          timestamp: Date.now(),
          planRevised,
          subgoalCount: newSubgoals.length,
        };

        return {
          output: {
            directives: parsed.directives,
            plan: parsed.plan,
            subgoals: newSubgoals,
          },
          state: newState,
          monitoring,
        };
      } catch (err: unknown) {
        const error: StepError = {
          message: err instanceof Error ? err.message : String(err),
          recoverable: true,
          moduleId: id,
          phase: 'CONTROL',
        };

        const monitoring: PlannerMonitoring = {
          type: 'planner',
          source: id,
          timestamp: Date.now(),
          planRevised: false,
          subgoalCount: state.subgoals.length,
        };

        return {
          output: {
            directives: [],
            plan: state.currentPlan,
            subgoals: state.subgoals,
          },
          state,
          monitoring,
          error,
        };
      }
    },

    initialState(): PlannerState {
      return {
        currentPlan: '',
        subgoals: [],
        revisionCount: 0,
      };
    },

    stateInvariant(state: PlannerState): boolean {
      return state.revisionCount >= 0;
    },
  };
}

// ── Internals ──────────────────────────────────────────────────────

interface ParsedPlan {
  plan: string;
  subgoals: Subgoal[];
  directives: ControlDirective[];
}

/**
 * Parse LLM output into structured plan. Falls back to using raw output
 * as the plan string if JSON parsing fails.
 */
function parsePlanOutput(output: string, plannerId: ModuleId): ParsedPlan {
  try {
    const parsed = JSON.parse(output) as {
      plan?: string;
      subgoals?: Array<{ description: string; status?: string }>;
      directives?: Array<{ target: string; directiveType?: string; payload?: unknown }>;
    };

    const subgoals: Subgoal[] = (parsed.subgoals ?? []).map(sg => ({
      description: sg.description,
      status: (sg.status as Subgoal['status']) ?? 'pending',
    }));

    const directives: ControlDirective[] = (parsed.directives ?? []).map(d => ({
      target: moduleId(d.target),
      timestamp: Date.now(),
      ...(d.directiveType ? { directiveType: d.directiveType } : {}),
      ...(d.payload !== undefined ? { payload: d.payload } : {}),
    }));

    return {
      plan: parsed.plan ?? output,
      subgoals,
      directives,
    };
  } catch {
    // If parsing fails, use raw output as plan
    return {
      plan: output,
      subgoals: [],
      directives: [],
    };
  }
}
