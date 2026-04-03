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
 * ## Cognitive Science Grounding
 *
 * **Primary analog: Anterior Prefrontal Cortex (aPFC) — abstract planning,
 * goal management, and prospective memory.**
 *
 * - **SOAR (Laird, 2012) — Deliberate Planning:** When SOAR reaches an impasse
 *   (no applicable operator), it creates a subgoal and enters a deliberate
 *   planning phase. Our Planner is invoked by the CONTROL phase when the
 *   Monitor detects an anomaly — functionally equivalent to SOAR's impasse-
 *   triggered subgoaling. The Planner produces strategy directives (analogous
 *   to SOAR operator proposals for the subgoal space).
 *
 * - **ACT-R (Anderson, 2007) — Goal Buffer Management:** ACT-R's goal buffer
 *   holds the current goal chunk. Goal changes (push, pop, modify) are driven
 *   by production rules. Our Planner generates `subgoals[]` and may revise
 *   the plan, functioning as the goal management system. However, unlike
 *   ACT-R's strict one-goal-at-a-time constraint, our Planner can maintain
 *   multiple subgoals simultaneously.
 *
 * - **Hierarchical Task Network (HTN) Planning (Erol et al., 1994):** The
 *   Planner's decomposition of goals into subgoals mirrors HTN's recursive
 *   task decomposition. Each subgoal is a primitive or compound task that
 *   can be further decomposed.
 *
 * - **Prospective Memory (Burgess et al., 2011):** The aPFC maintains
 *   intentions for future action — "after X, do Y." Our Planner's directives
 *   serve this function: they encode future-oriented control instructions
 *   that persist across cycles.
 *
 * **What this module captures:**
 * - LLM-based plan generation from workspace context
 * - Goal decomposition into subgoals with status tracking
 * - Control directive production for downstream modules
 * - Plan revision detection (planRevised monitoring signal)
 *
 * **What this module does NOT capture (known gaps):**
 * - No plan evaluation: the Planner generates plans but doesn't evaluate whether
 *   they're progressing toward the goal. Plan quality assessment requires the
 *   Evaluator to have goal-state access (RFC 004).
 * - No plan library: each invocation generates from scratch. SOAR's chunking
 *   compiles successful plans into reusable productions — we don't.
 * - Subgoal tracking is count-based, not completion-based: the Planner tracks
 *   how many subgoals exist, not whether they've been achieved.
 *
 * **References:**
 * - Laird, J. E. (2012). The Soar Cognitive Architecture. MIT Press.
 * - Anderson, J. R. (2007). How Can the Human Mind Occur in the Physical Universe? Oxford UP.
 * - Erol, K., Hendler, J., & Nau, D. S. (1994). HTN planning: Complexity and expressivity.
 *   AAAI-94 Proceedings.
 * - Burgess, P. W., Gonen-Yaacovi, G., & Volle, E. (2011). Functional neuroimaging studies
 *   of prospective memory. Annals of the New York Academy of Sciences, 1224, 36-52.
 *
 * @see docs/rfcs/001-cognitive-composition.md — Part IV, Phase 6 (CONTROL)
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
    contextBinding: config?.contextBinding ?? { types: ['goal', 'constraint'], budget: 4096, strategy: 'salience' as const },

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
