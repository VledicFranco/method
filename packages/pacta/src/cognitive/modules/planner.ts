/**
 * Planner — meta-level cognitive module for goal decomposition, difficulty assessment,
 * phase planning, and control directive production.
 *
 * Runs at cycle 0 to produce a TaskAssessment (difficulty, phases, KPIs, solvability
 * prior) that parameterizes the Evaluator's metamonitor. Can re-plan on demand when
 * the Monitor signals an impasse. Uses ModuleWorkingMemory to persist its plan across
 * cycles, immune to shared workspace eviction.
 *
 * ## Cognitive Science Grounding
 *
 * **Primary analog: Anterior Prefrontal Cortex (aPFC) — abstract planning,
 * goal management, and prospective memory.**
 *
 * - **Koriat (2007) — Ease-of-Learning Judgment (EOL):** Before engaging with a task,
 *   the metacognitive system forms an initial assessment of difficulty and expected effort.
 *   The EOL judgment parameterizes the subsequent monitoring process. A task judged as
 *   "hard" sets different monitoring thresholds than a task judged as "easy." The Planner's
 *   TaskAssessment at cycle 0 implements this: difficulty estimate, phase budgets, and
 *   solvability prior calibrate the Evaluator so it can distinguish "expected exploration"
 *   from "alarming stagnation."
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
 *   by production rules. Our Planner generates subgoals and may revise the plan,
 *   functioning as the goal management system.
 *
 * - **Hierarchical Task Network (HTN) Planning (Erol et al., 1994):** The
 *   Planner's decomposition of goals into subgoals mirrors HTN's recursive
 *   task decomposition.
 *
 * - **Carver & Scheier (1998) — Multi-Level Control:** The Planner provides
 *   the reference trajectory (phase structure) that the Evaluator's metamonitor
 *   needs to evaluate "is current behavior appropriate for the current phase?"
 *   rather than just "is discrepancy decreasing?"
 *
 * - **Baddeley (2000) — Working Memory:** The Planner uses per-module working
 *   memory (ModuleWorkingMemory) to persist its plan and assessment across cycles,
 *   immune to shared workspace eviction. This is the prefrontal working memory
 *   that maintains task-relevant representations independent of the sensory stream.
 *
 * **What this module captures:**
 * - Pre-task difficulty assessment (Koriat's EOL) via LLM at cycle 0
 * - Phase decomposition with cycle budgets and progress indicators
 * - Solvability prior estimation
 * - Observable KPI definition for progress tracking
 * - Plan revision on demand (impasse-triggered re-planning)
 * - Working memory for plan persistence across cycles
 * - Control directive production for downstream modules
 *
 * **What this module does NOT capture (known gaps):**
 * - No plan library: each invocation generates from scratch. SOAR's chunking
 *   compiles successful plans into reusable productions — we don't.
 * - No adaptive re-assessment: the Planner produces one TaskAssessment at cycle 0
 *   and optionally revises on impasse. Continuous difficulty re-estimation is
 *   deferred to a future iteration.
 *
 * **References:**
 * - Koriat, A. (2007). Metacognition and consciousness. Cambridge Handbook of Consciousness.
 * - Laird, J. E. (2012). The Soar Cognitive Architecture. MIT Press.
 * - Anderson, J. R. (2007). How Can the Human Mind Occur in the Physical Universe? Oxford UP.
 * - Erol, K., Hendler, J., & Nau, D. S. (1994). HTN planning: Complexity and expressivity.
 * - Carver, C. S., & Scheier, M. F. (1998). On the Self-Regulation of Behavior. Cambridge UP.
 * - Baddeley, A. D. (2000). The episodic buffer. Trends in Cognitive Sciences, 4(11), 417-423.
 *
 * @see docs/rfcs/001-cognitive-composition.md — Part IV, Phase 6 (CONTROL)
 * @see docs/rfcs/006-anticipatory-monitoring.md — Planner module + Module Working Memory
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
  ModuleWorkingMemory,
  WorkingMemoryConfig,
  WorkspaceEntry,
  TaskAssessment,
  GoalRepresentation,
  CheckableKPI,
  VerificationState,
  KPICheckResult,
} from '../algebra/index.js';
import {
  moduleId,
  createWorkingMemory,
  updateWorkingMemory,
  assessTaskWithLLM,
  defaultAssessment,
  fileExists,
  fileContains,
  fileExports,
} from '../algebra/index.js';

// ── Types ──────────────────────────────────────────────────────────

/** Configuration for the Planner module. */
export interface PlannerConfig {
  /** Module ID override. Default: 'planner'. */
  id?: string;
  /** PRD 045: type-driven context binding. */
  contextBinding?: import('../algebra/partition-types.js').ModuleContextBinding;
  /** Working memory configuration for plan persistence across cycles. */
  workingMemoryConfig?: WorkingMemoryConfig;
  /** Maximum cycles available for the task (used in assessment). Default: 15. */
  maxCycles?: number;
  /** System prompt override for re-planning LLM calls. */
  systemPrompt?: string;
  /** PRD 049: optional SLM-backed KPIChecker. When present, replaces the LLM
   *  requestCheckableKPIs call with reliable SLM DSL generation. */
  kpiChecker?: import('../algebra/kpi-checker-port.js').KPICheckerPort;
}

/** Input to the Planner: goal representation + workspace snapshot. */
export interface PlannerInput {
  /** Current workspace snapshot for context. */
  workspace: ReadonlyWorkspaceSnapshot;
  /** Goal representation — the task the agent is working on. */
  goal?: GoalRepresentation;
}

/** A subgoal within the current plan. */
export interface Subgoal {
  description: string;
  status: 'pending' | 'active' | 'completed';
}

/** Output: TaskAssessment + plan + control directives. */
export interface PlannerOutput {
  /** Pre-task assessment (produced at cycle 0, revised on replan). */
  assessment: TaskAssessment | null;
  /** Natural language plan description. */
  plan: string;
  /** Decomposed subgoals. */
  subgoals: Subgoal[];
  /** Control directives for downstream modules. */
  directives: ControlDirective[];
  /** Whether the plan was revised this step. */
  planRevised: boolean;
  /** Tokens consumed by LLM invocations this step. */
  tokensUsed: number;
  /** PRD 048: Checkable KPIs with optional machine-checkable predicates.
   *  Populated when the Planner generates structured KPI checks. */
  checkableKpis: import('../algebra/verification.js').CheckableKPI[];
}

/** State: current plan, assessment, working memory, revision tracking. */
export interface PlannerState {
  /** Current natural language plan. */
  currentPlan: string;
  /** Active subgoals. */
  subgoals: Subgoal[];
  /** Number of plan revisions so far. */
  revisionCount: number;
  /** Cycle counter. */
  cycleCount: number;
  /** TaskAssessment produced at cycle 0 (persistent, immune to workspace eviction). */
  assessment: TaskAssessment | null;
  /** Goal representation (persistent, set from input at cycle 0). */
  goal: GoalRepresentation | null;
  /** Per-module working memory — persists plan context across cycles. */
  workingMemory?: ModuleWorkingMemory;
}

/** Control directive: replan trigger from Monitor. */
export interface PlannerControl extends ControlDirective {
  /** When set, triggers re-planning. Value describes why (e.g., 'anomaly detected'). */
  replanTrigger?: string;
}

// ── Prompt for Re-Planning ──────────────────────────────────────────

const DEFAULT_REPLAN_SYSTEM_PROMPT =
  `You are a planning module for a coding agent. Given the current workspace context and previous plan, produce a revised plan as JSON.

Respond with a JSON object containing:
- plan: (string) natural language description of the revised plan
- subgoals: (array of {description: string, status: 'pending'|'active'|'completed'}) decomposed sub-tasks
- directives: (array of {target: string, directiveType: string, payload?: object}) control directives for other modules

Example directives:
- {target: "reasoner-1", directiveType: "strategy_shift", payload: {strategy: "cot"}}
- {target: "actor-1", directiveType: "action_whitelist", payload: {actions: ["read_file"]}}`;

// ── Factory ────────────────────────────────────────────────────────

/**
 * Create a Planner cognitive module.
 *
 * At cycle 0: invokes assessTaskWithLLM() to produce a TaskAssessment from the
 * goal representation. On subsequent cycles: passes through unless replanTrigger
 * is set, in which case it re-invokes the LLM for a revised plan and directives.
 *
 * Uses ModuleWorkingMemory (when configured) to persist its plan context across
 * cycles, immune to shared workspace eviction.
 *
 * @param adapter - The ProviderAdapter for LLM invocation.
 * @param config - Optional configuration (id, working memory, maxCycles).
 */
export function createPlanner(
  adapter: ProviderAdapter,
  config?: PlannerConfig,
): CognitiveModule<PlannerInput, PlannerOutput, PlannerState, PlannerMonitoring, PlannerControl> {
  const id = moduleId(config?.id ?? 'planner');
  const maxCycles = config?.maxCycles ?? 15;
  const wmConfig = config?.workingMemoryConfig;
  const systemPrompt = config?.systemPrompt ?? DEFAULT_REPLAN_SYSTEM_PROMPT;
  const kpiChecker = config?.kpiChecker;

  return {
    id,
    contextBinding: config?.contextBinding ?? {
      types: ['goal', 'constraint'],
      budget: 4096,
      strategy: 'salience' as const,
    },

    async step(
      input: PlannerInput,
      state: PlannerState,
      control: PlannerControl,
    ): Promise<StepResult<PlannerOutput, PlannerState, PlannerMonitoring>> {
      const isCycle0 = state.cycleCount === 0;
      const shouldReplan = control.replanTrigger !== undefined;

      // Capture goal from input at cycle 0 (persists in state thereafter)
      const goal = state.goal ?? input.goal ?? null;

      try {
        let assessment = state.assessment;
        let plan = state.currentPlan;
        let subgoals = state.subgoals;
        let directives: ControlDirective[] = [];
        let planRevised = false;
        let tokensUsed = 0;
        let checkableKpis: CheckableKPI[] = [];

        // ── Cycle 0: produce TaskAssessment via assessTaskWithLLM() ──
        if (isCycle0 && goal) {
          const assessResult = await assessTaskWithLLM(adapter, goal, maxCycles, id);
          assessment = assessResult.assessment;
          tokensUsed += assessResult.tokensUsed;

          // Derive initial plan and subgoals from the assessment
          plan = buildPlanFromAssessment(assessment, goal);
          subgoals = buildSubgoalsFromAssessment(assessment, goal);
          planRevised = true;

          // PRD 049: prefer SLM-backed KPIChecker when available (100% parse rate,
          // near-zero cost). Falls back to LLM requestCheckableKPIs if no SLM port.
          if (kpiChecker && assessment.kpis.length > 0) {
            const inputs = assessment.kpis.map(kpi => ({
              kpi,
              context: {
                objective: goal.objective,
                knownPaths: [] as string[],
                knownIdentifiers: [] as string[],
                difficulty: assessment!.difficulty as 'low' | 'medium' | 'high' | undefined,
              },
            }));
            checkableKpis = await kpiChecker.generateChecks(inputs);
            // SLM has its own token budget — not counted against planner LLM budget
          } else {
            // PRD 048 fallback: LLM-based check generation
            const checksResult = await requestCheckableKPIs(
              adapter, goal, assessment.kpis, id,
            );
            checkableKpis = checksResult.checkableKpis;
            tokensUsed += checksResult.tokensUsed;
          }
        } else if (isCycle0 && !goal) {
          // No goal provided — produce a default assessment
          assessment = defaultAssessment(maxCycles);
          plan = 'No goal provided — using default assessment.';
          subgoals = [];
          planRevised = true;
        }

        // ── Re-planning: triggered by Monitor impasse signal ──
        if (shouldReplan && !isCycle0) {
          const replanResult = await replan(
            adapter,
            input.workspace,
            state,
            control.replanTrigger!,
            systemPrompt,
            id,
          );
          plan = replanResult.plan;
          subgoals = replanResult.subgoals;
          directives = replanResult.directives;
          tokensUsed += replanResult.tokensUsed;
          planRevised = true;

          // Optionally revise the assessment if the replan changes phase expectations
          // (future enhancement — for now we keep the original assessment)
        }

        // ── Update working memory with current plan context ──
        const updatedWM = updatePlannerWorkingMemory(
          state.workingMemory,
          plan,
          assessment,
          subgoals,
          id,
        );

        const newState: PlannerState = {
          currentPlan: plan,
          subgoals,
          revisionCount: planRevised ? state.revisionCount + 1 : state.revisionCount,
          cycleCount: state.cycleCount + 1,
          assessment,
          goal,
          workingMemory: updatedWM,
        };

        const monitoring: PlannerMonitoring = {
          type: 'planner',
          source: id,
          timestamp: Date.now(),
          planRevised,
          subgoalCount: subgoals.length,
        };

        return {
          output: {
            assessment,
            plan,
            subgoals,
            directives,
            planRevised,
            tokensUsed,
            checkableKpis, // PRD 048: populated by CheckableKPI generation (C-4)
          },
          state: newState,
          monitoring,
        };
      } catch (err: unknown) {
        // On failure: return current state with error, fallback to default assessment
        const fallbackAssessment = state.assessment ?? defaultAssessment(maxCycles);

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
            assessment: fallbackAssessment,
            plan: state.currentPlan,
            subgoals: state.subgoals,
            directives: [],
            planRevised: false,
            tokensUsed: 0,
            checkableKpis: [],
          },
          state: {
            ...state,
            cycleCount: state.cycleCount + 1,
            assessment: fallbackAssessment,
            goal,
          },
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
        cycleCount: 0,
        assessment: null,
        goal: null,
        workingMemory: wmConfig ? createWorkingMemory(wmConfig) : undefined,
      };
    },

    stateInvariant(state: PlannerState): boolean {
      return (
        state.revisionCount >= 0 &&
        state.cycleCount >= 0
      );
    },
  };
}

// ── CheckableKPI Generation (PRD 048 — C-4) ──────────────────────

/**
 * System prompt for the checkable KPI generation call.
 */
const CHECKS_SYSTEM_PROMPT =
  `You are a verification assistant for a coding agent. Given the task and KPIs, produce machine-checkable tests. Respond ONLY with the <checks> block.`;

/**
 * Build the prompt that asks the LLM for checkable KPI predicates.
 */
function buildChecksPrompt(goal: GoalRepresentation, kpis: string[]): string {
  const kpiList = kpis.map((k, i) => `  ${i + 1}. ${k}`).join('\n');
  return `TASK: ${goal.objective}

KPIs to verify:
${kpiList}

For each KPI, suggest a machine-checkable test in this format:
<checks>
<check kpi="description">file_exists('src/handlers/v2.ts')</check>
<check kpi="description">file_contains('src/handlers/v2.ts', 'handleOrderV2')</check>
<check kpi="description">file_exports('src/handlers/v2.ts', 'handleOrderV2')</check>
</checks>

Available primitives:
- file_exists('path') — check that a file exists
- file_contains('path', 'pattern') — check that a file contains a string/pattern
- file_exports('path', 'name') — check that a file exports a named symbol

Rules:
- One <check> per KPI
- The kpi attribute should match the KPI description
- Use ONLY the primitives listed above
- Paths should be reasonable guesses based on the task`;
}

/** A single parsed check from the DSL. */
export interface ParsedCheck {
  kpiDescription: string;
  primitive: string;
  args: string[];
}

/**
 * Parse the `<checks>` block from LLM output.
 * Returns an array of ParsedCheck. If no `<checks>` block is found, returns [].
 */
export function parseChecksBlock(text: string): ParsedCheck[] {
  const checksMatch = text.match(/<checks>([\s\S]*?)<\/checks>/);
  if (!checksMatch) return [];

  const block = checksMatch[1];
  const results: ParsedCheck[] = [];

  const checkRegex = /<check\s+kpi="([^"]*)">(.*?)<\/check>/g;
  let match: RegExpExecArray | null;
  while ((match = checkRegex.exec(block)) !== null) {
    const kpiDescription = match[1].trim();
    const dslBody = match[2].trim();
    const parsed = parseDSLPrimitive(dslBody);
    if (parsed) {
      results.push({ kpiDescription, ...parsed });
    } else {
      // Malformed DSL — include as description-only (no primitive)
      results.push({ kpiDescription, primitive: '', args: [] });
    }
  }

  return results;
}

/**
 * Parse a single DSL primitive call like `file_exists('path')` or
 * `file_contains('path', 'pattern')`.
 * Returns { primitive, args } or null if unparseable.
 */
function parseDSLPrimitive(dsl: string): { primitive: string; args: string[] } | null {
  // Match: primitive_name('arg1') or primitive_name('arg1', 'arg2')
  const primitiveMatch = dsl.match(/^(file_exists|file_contains|file_exports)\s*\(\s*(.*)\s*\)$/);
  if (!primitiveMatch) return null;

  const primitive = primitiveMatch[1];
  const argsRaw = primitiveMatch[2];

  // Parse arguments: single-quoted strings separated by commas
  const args: string[] = [];
  const argRegex = /'([^']*)'/g;
  let argMatch: RegExpExecArray | null;
  while ((argMatch = argRegex.exec(argsRaw)) !== null) {
    args.push(argMatch[1]);
  }

  // Validate arity
  if (primitive === 'file_exists' && args.length !== 1) return null;
  if (primitive === 'file_contains' && args.length !== 2) return null;
  if (primitive === 'file_exports' && args.length !== 2) return null;

  return { primitive, args };
}

/**
 * Build a check function from a parsed DSL primitive.
 * Returns the (state) => KPICheckResult predicate, or undefined if not a known primitive.
 */
function buildCheckFunction(parsed: ParsedCheck): ((state: VerificationState) => KPICheckResult) | undefined {
  if (!parsed.primitive) return undefined;

  switch (parsed.primitive) {
    case 'file_exists':
      return fileExists(parsed.args[0]);
    case 'file_contains':
      return fileContains(parsed.args[0], parsed.args[1]);
    case 'file_exports':
      return fileExports(parsed.args[0], parsed.args[1]);
    default:
      return undefined;
  }
}

/**
 * Build CheckableKPI[] from parsed checks + assessment KPIs.
 * If a parsed check has a valid primitive, includes the check function.
 * Otherwise, produces a description-only KPI (LLM fallback).
 */
export function buildCheckableKPIs(
  assessmentKpis: string[],
  parsedChecks: ParsedCheck[],
): CheckableKPI[] {
  // If we have parsed checks, use them (one CheckableKPI per parsed check)
  if (parsedChecks.length > 0) {
    return parsedChecks.map(pc => {
      const checkFn = buildCheckFunction(pc);
      const kpi: CheckableKPI = {
        description: pc.kpiDescription,
        met: false,
        evidence: '',
      };
      if (checkFn) {
        kpi.check = checkFn;
      }
      return kpi;
    });
  }

  // Fallback: produce description-only KPIs from the assessment
  return assessmentKpis.map(kpi => ({
    description: kpi,
    met: false,
    evidence: '',
  }));
}

/**
 * Request checkable KPI predicates from the LLM.
 * This is a separate, lightweight call after the assessment.
 * On any failure, returns [] (graceful degradation).
 */
async function requestCheckableKPIs(
  adapter: ProviderAdapter,
  goal: GoalRepresentation,
  kpis: string[],
  plannerId: ModuleId,
): Promise<{ checkableKpis: CheckableKPI[]; tokensUsed: number }> {
  if (kpis.length === 0) {
    return { checkableKpis: [], tokensUsed: 0 };
  }

  try {
    const prompt = buildChecksPrompt(goal, kpis);

    const promptSnapshot = [{
      source: plannerId,
      content: prompt,
      salience: 1.0,
      timestamp: Date.now(),
    }];

    const adapterConfig: AdapterConfig = {
      pactTemplate: {
        mode: { type: 'oneshot' },
        budget: { maxOutputTokens: 512 },
      },
      systemPrompt: CHECKS_SYSTEM_PROMPT,
      timeoutMs: 15_000,
    };

    const result = await adapter.invoke(promptSnapshot, adapterConfig);
    const parsedChecks = parseChecksBlock(result.output);
    const checkableKpis = buildCheckableKPIs(kpis, parsedChecks);

    return { checkableKpis, tokensUsed: result.usage.totalTokens };
  } catch {
    // On failure, return description-only KPIs from the assessment
    return {
      checkableKpis: kpis.map(kpi => ({
        description: kpi,
        met: false,
        evidence: '',
      })),
      tokensUsed: 0,
    };
  }
}

// ── Internals ──────────────────────────────────────────────────────

/**
 * Build a natural language plan description from the TaskAssessment.
 */
function buildPlanFromAssessment(assessment: TaskAssessment, goal: GoalRepresentation): string {
  const phaseDescriptions = assessment.phases
    .map(p => `${p.name} (cycles ${p.expectedCycles[0]}-${p.expectedCycles[1]}): ${p.progressIndicator}`)
    .join('; ');

  return `Goal: ${goal.objective}. ` +
    `Difficulty: ${assessment.difficulty}. ` +
    `Estimated ${assessment.estimatedCycles} cycles. ` +
    `Phases: ${phaseDescriptions}.`;
}

/**
 * Derive subgoals from the goal's subgoals + assessment KPIs.
 */
function buildSubgoalsFromAssessment(
  assessment: TaskAssessment,
  goal: GoalRepresentation,
): Subgoal[] {
  const subgoals: Subgoal[] = [];

  // Include goal's decomposed subgoals if any
  for (const sg of goal.subgoals) {
    subgoals.push({
      description: sg.description,
      status: sg.satisfied ? 'completed' : 'pending',
    });
  }

  // Add KPIs as pending subgoals (observable progress indicators)
  for (const kpi of assessment.kpis) {
    subgoals.push({
      description: kpi,
      status: 'pending',
    });
  }

  return subgoals;
}

// ── Re-Planning ──────────────────────────────────────────────────

interface ReplanResult {
  plan: string;
  subgoals: Subgoal[];
  directives: ControlDirective[];
  tokensUsed: number;
}

/**
 * Re-plan by invoking the LLM with current workspace context + replan trigger.
 */
async function replan(
  adapter: ProviderAdapter,
  workspace: ReadonlyWorkspaceSnapshot,
  state: PlannerState,
  trigger: string,
  systemPrompt: string,
  plannerId: ModuleId,
): Promise<ReplanResult> {
  // Build context: include previous plan + trigger reason
  const contextEntry: WorkspaceEntry = {
    source: plannerId,
    content: `[REPLAN CONTEXT]\nPrevious plan: ${state.currentPlan}\nReplan trigger: ${trigger}\nRevision #${state.revisionCount + 1}`,
    salience: 1.0,
    timestamp: Date.now(),
  };

  // Prepend working memory entries if available
  const wmEntries: WorkspaceEntry[] = [];
  if (state.workingMemory && state.workingMemory.entries.length > 0) {
    const wmHeader: WorkspaceEntry = {
      source: plannerId,
      content: '[PLANNER WORKING MEMORY]\n' +
        state.workingMemory.entries
          .map(e => typeof e.content === 'string' ? e.content : JSON.stringify(e.content))
          .join('\n'),
      salience: 1.0,
      timestamp: Date.now(),
    };
    wmEntries.push(wmHeader);
  }

  const effectiveSnapshot: ReadonlyWorkspaceSnapshot = [
    ...wmEntries,
    contextEntry,
    ...workspace,
  ];

  const adapterConfig: AdapterConfig = {
    pactTemplate: { mode: { type: 'oneshot' } },
    systemPrompt,
    timeoutMs: 20_000,
  };

  const result = await adapter.invoke(effectiveSnapshot, adapterConfig);
  const parsed = parsePlanOutput(result.output, plannerId);

  return {
    plan: parsed.plan,
    subgoals: parsed.subgoals.length > 0 ? parsed.subgoals : state.subgoals,
    directives: parsed.directives,
    tokensUsed: result.usage.totalTokens,
  };
}

// ── Plan Output Parsing ──────────────────────────────────────────

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

// ── Working Memory Updates ──────────────────────────────────────

/**
 * Update the Planner's working memory with current plan context.
 * Stores a summary of the assessment and plan for persistence across cycles.
 */
function updatePlannerWorkingMemory(
  wm: ModuleWorkingMemory | undefined,
  plan: string,
  assessment: TaskAssessment | null,
  subgoals: Subgoal[],
  plannerId: ModuleId,
): ModuleWorkingMemory | undefined {
  if (!wm) return undefined;

  const completedCount = subgoals.filter(s => s.status === 'completed').length;
  const pendingCount = subgoals.filter(s => s.status === 'pending').length;

  let content = `[PLANNER STATE]\nPlan: ${plan}`;
  if (assessment) {
    content += `\nDifficulty: ${assessment.difficulty}`;
    content += `\nEstimated cycles: ${assessment.estimatedCycles}`;
    content += `\nSolvability: ${assessment.solvabilityPrior}`;
    content += `\nPhases: ${assessment.phases.map(p => p.name).join(' → ')}`;
  }
  content += `\nSubgoals: ${completedCount} completed, ${pendingCount} pending`;

  const entry: WorkspaceEntry = {
    source: plannerId,
    content,
    salience: 1.0,
    timestamp: Date.now(),
  };

  return updateWorkingMemory(wm, [entry]);
}
