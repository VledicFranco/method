---
title: "PRD 022: Meta Agent Loop — Methodology-Native Agent Orchestrator"
status: implemented
---

# PRD 022: Meta Agent Loop — Methodology-Native Agent Orchestrator

**Status:** Draft (post-review synthesis applied 2026-03-21)
**Owner:** Steering Council
**Methodology:** P2-SD v2.0
**Depends on:** PRD 021 Phase 1b (MethodTS SDK — co-developed; runtime, strategy, providers, stdlib must reach Phase 1b before PRD 022 Phase 1a begins), PRD 017 (strategy pipelines), PRD 004 (methodology runtime)
**Subsumes:** PRD 015 (Default Execution Method — M-EXEC is absorbed as one selectable methodology)
**Complexity:** High — new package, standalone process, M-SELECT methodology design, client contract
**Package:** `@method/loop` (new)
**Council:** TOPIC-META-AGENT-LOOP session 2026-03-21. 6-member council, 4 questions resolved, 3 position shifts, 0 escalations.
**Review:** 4-advisor adversarial review completed 2026-03-21. 32 findings, 23 fixes applied. Action plan: `tmp/action-plan-prd022-2026-03-21.md`

---

## 1. Problem Statement

**Current state:**

Claude Code's agent loop is a generic tool-use cycle: read prompt → reason → use tools → respond. It has no awareness of methodologies, no structured state tracking, no formal routing, and no typed safety bounds. When an orchestrator wants methodology-governed execution, it must manually: select a methodology, compose a commission prompt, spawn a sub-agent, parse results, and decide next steps — all inside the agent's context window, burning tokens on deterministic work.

PRD 015 identified that agents following methodology step DAGs via MCP tools don't stall — the `step_current → work → step_advance` loop keeps them in active tool-calling mode. But PRD 015's solution (M-EXEC as a step DAG within the existing runtime) is a patch on a generic loop, not a replacement for it.

PRD 021 (MethodTS) provides the foundation: typed methodologies, suspendable execution, strategy controllers, agent providers, and commission generation — all as compiled TypeScript. But PRD 021 defines the *library*; it doesn't define the *agent* that uses it.

**The gap:** No agent exists that natively exploits MethodTS's capabilities. No agent can select from available methodologies, compose methodology pipelines, create new methodologies on the fly, pitch a plan to a human, and execute with typed state tracking and suspension-based control. The bridge can spawn agents, but those agents are Claude Code instances following generic loops with methodology grafted on via MCP tools.

**Target users:**
- **Primary: Project owners and methodology practitioners** who want an agent that understands their project's methodologies, selects the right one for a task, and executes it with full observability and safety — without manual orchestration.
- **Secondary: Client developers** building TUI or web interfaces on top of the meta agent loop. They receive typed events and suspensions, not raw terminal output.
- **Tertiary: Method designers** whose authored methodologies are automatically discoverable and selectable by the meta-loop.

**Opportunity:**

A standalone MethodTS process — the **meta agent loop** — that replaces Claude Code's generic agent loop with a methodology-native orchestrator. The user states an objective. The loop analyzes the task, selects (or creates) a methodology, pitches the plan, and executes autonomously with typed state tracking, suspension-based human control, and formal safety bounds. Clients (TUI, web) plug in as renderers of the loop's event stream and suspension points.

---

## 2. Vision & Scope

### Vision

The meta agent loop is a **MethodTS strategy** that acts as the outer shell for all methodology-governed agent work. It receives a user objective, reasons about which methodologies apply (or designs new ones), negotiates a plan with the human, and executes — using Claude only for reasoning steps, and TypeScript for everything deterministic. The loop IS the agent; Claude is a service it calls.

This subsumes PRD 015 (M-EXEC). M-EXEC's 7-step DAG (Activate → Load Commission → Load Context → Route Method → Execute → Deliver → Report) becomes one selectable methodology within the meta-loop's registry. The meta-loop's architecture — typed state, suspension, strategy control — provides the anti-stalling benefit M-EXEC was designed for, but structurally rather than as a DAG workaround.

### Scope

**Phase 1 — Core Loop:**
- `MetaState` type and `MethodologyMeta` registry interface
- M-SELECT methodology: 5-step method (analyze → select → pitch → execute → evaluate)
- 4-arm priority-stack routing: exact match → adapted match → composed pipeline → create new (arm 4 gated by M1-MDES availability)
- Orchestration strategy controller with suspension-based human interaction
- `interrupt` resolution variant for cancelling long-running child methodologies
- Client contract: EventBus subscription + bridge channel merging
- `ClaudeHeadlessProvider` integration for agent steps
- Safety bounds: budget inheritance, step/loop caps on created methodologies
- Post-strategy persistence hook for created methodologies
- TUI reference client (minimal — demonstrates the contract)

**Phase 2 — Enrichment:**
- `BridgeAgentProvider` integration for sub-agent steps with dashboard visibility
- Methodology composition via retraction pairs (pipeline entries share state coherently)
- `agentSteeredController` — agent decides suspension resolutions for fully autonomous mode
- Methodology versioning and A/B selection (pick the version with better historical metrics)
- Registry persistence service (created methodologies saved with full compilation artifacts)
- Web client reference implementation

**Phase 3 — Self-Improvement:**
- Methodology evolution loop: aggregate retros, identify gaps, propose methodology updates
- Cross-project methodology transfer: methodologies proven in one project offered to others
- Adaptive safety bounds: bounds adjusted based on historical success rates

**Exclude:**
- Bridge modifications (the bridge is consumed as-is via `BridgeAgentProvider`)
- Formal theory extensions (F1-FTH, F4-PHI)
- New MCP tools (the meta-loop is a standalone process, not an MCP server)
- Concurrent methodology execution within a single strategy run (blocked on P4)

### Dependency Graph

```
PRD 021 Phase 1b (MethodTS runtime + strategy + providers + stdlib)
  │
  ├─ Methodology<S>, runMethodology, runStrategy
  ├─ StrategyController<S>, SuspendedMethodology<S>, Resolution<S>
  ├─ ClaudeHeadlessProvider, MockAgentProvider
  ├─ Commission generation, Prompt algebra
  ├─ EventBus<S>, RuntimeEvent<S>
  ├─ compileMethod (M1-MDES gates), simulateRun
  └─ P0-META stdlib (optional: M1-MDES for arm 4)
       │
       ▼
PRD 022 (this PRD)
  │
  ├─ MetaState, MethodologyMeta types
  ├─ M-SELECT methodology (5-step, 4-arm routing)
  ├─ MetaStrategy controller
  ├─ Client contract (EventBus + bridge channels)
  └─ @method/loop package
```

---

## 3. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        Client (TUI / Web)                       │
│  Renders: suspensions, event stream, pitch UI, Q&A, progress    │
│  Sends:   resolutions (approve, reject, steer, interrupt)       │
└───────────────────────┬─────────────────────────────────────────┘
                        │ EventBus subscription + Resolution input
                        ▼
┌─────────────────────────────────────────────────────────────────┐
│                    @method/loop process                          │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │              MetaStrategy Controller                      │   │
│  │  onSuspend: render for client, wait for resolution        │   │
│  │  onComplete: evaluate objective, decide retry/done        │   │
│  │  safety: strategy-level bounds (cost, time, loops)        │   │
│  └──────────────────────┬───────────────────────────────────┘   │
│                          │ runs                                   │
│  ┌──────────────────────▼───────────────────────────────────┐   │
│  │              M-SELECT Methodology                         │   │
│  │                                                           │   │
│  │  σ_analyze → σ_select → σ_pitch → σ_execute → σ_evaluate │   │
│  │                                                           │   │
│  │  δ_Φ routing (4 arms):                                    │   │
│  │    1. Exact match     → run selected methodology          │   │
│  │    2. Adapted match   → adjust params, run                │   │
│  │    3. Composed pipeline → run sequential methodologies    │   │
│  │    4. Create new       → M1-MDES → compile → run         │   │
│  └──────────────────────┬───────────────────────────────────┘   │
│                          │ spawns                                 │
│  ┌──────────────────────▼───────────────────────────────────┐   │
│  │         Selected Methodology Execution                    │   │
│  │  (P2-SD, P1-EXEC, custom, or newly created)              │   │
│  │                                                           │   │
│  │  Agent steps → ClaudeHeadlessProvider (Phase 1)           │   │
│  │              → BridgeAgentProvider    (Phase 2)           │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                  │
│  ┌────────────────────┐  ┌────────────────────────────────┐     │
│  │    EventBus<Meta>  │  │  Bridge Client (Phase 2)       │     │
│  │  strategy events   │  │  sub-agent sessions, channels  │     │
│  └────────────────────┘  └────────────────────────────────┘     │
└─────────────────────────────────────────────────────────────────┘
```

**Process architecture:** The meta-loop is a standalone Node.js process. It is NOT a Claude Code instance. It is NOT a bridge session. It owns its own Effect runtime, event bus, and state management. Claude is invoked via `ClaudeHeadlessProvider` for agent reasoning steps. The bridge is consumed via `BridgeAgentProvider` (Phase 2) for sub-agent orchestration.

**Two observability layers:**
1. **Strategy EventBus** — emits `RuntimeEvent<MetaState>` for the meta-loop's own lifecycle (methodology selection, pitch, execution progress, strategy decisions). The client subscribes directly.
2. **Bridge channels** (Phase 2) — sub-agent sessions emit progress/events via the bridge. The client subscribes to the bridge's SSE/channel endpoints.

The client merges both streams into a unified view. The meta-loop process handles the merge logic or exposes a unified stream endpoint.

**Cross-methodology type erasure:** Child methodology state types are erased to `unknown` at the MetaState boundary. The meta-loop evaluates child results observationally — via status, trace, step outcomes, cost, and the child methodology's own objective predicate result — rather than by inspecting typed state. This is a deliberate trade-off: TypeScript has no existential types, and the alternative (parameterizing MetaState over all possible child state types) is not tractable. The `renderPipelineResults` contract and each child's own objective evaluation provide the evaluation surface. Phase 2 may introduce a `Renderable` protocol for richer cross-boundary rendering.

**WorldState convention:** PRD 021 wraps all state in `WorldState<S> = { value: S; axiomStatus: ... }`. Throughout this PRD, when accessing state from `MethodologyResult<S>.finalState`, the raw state fields live at `.finalState.value`, not `.finalState` directly. When passing state to `runMethodology`, it must be wrapped in a `WorldState` envelope.

---

## 4. Components

### Component 1: MetaState and MethodologyMeta

The domain state for the meta agent loop. `MetaState` models the full lifecycle from objective to completion.

**Core types:**

```typescript
type MetaState = {
  // ── Input ──
  objective: string                                 // user's task in natural language
  projectCard: ProjectCard                          // project identity, essence, delivery rules

  // ── Registry (frozen at strategy start) ──
  availableMethodologies: ReadonlyArray<MethodologyMeta>

  // ── Analysis ──
  taskAnalysis: TaskAnalysis | null

  // ── Selection ──
  selectedPipeline: PipelineEntry[]                 // ordered methodology sequence (length >= 1)
  selectionRationale: string | null

  // ── Creation (arm 4 only) ──
  candidateMethodology: CandidateMethodology | null

  // ── Pitch ──
  pitchApproved: boolean
  pitchInsight: string | null                       // cached pitch text for Q&A re-runs

  // ── Execution ──
  pipelinePosition: number                          // index into selectedPipeline
  childResult: MethodologyResult<unknown> | null
  pipelineResults: MethodologyResult<unknown>[]     // accumulated results per pipeline entry

  // ── Evaluation ──
  objectiveMet: boolean | null
  evaluationRationale: string | null

  // ── Lifecycle ──
  status: MetaStatus
}

type MetaStatus =
  | "analyzing"
  | "selecting"
  | "creating"       // arm 4: running M1-MDES
  | "pitching"
  | "approved"
  | "executing"
  | "evaluating"
  | "complete"
  | "failed"
  | "aborted"

type TaskAnalysis = {
  decomposition: string[]             // sub-tasks identified
  requiredCapabilities: string[]      // what the methodology needs to handle
  constraints: string[]               // discovered constraints (budget, time, scope)
  ambiguities: string[]               // things the agent couldn't resolve alone
  suggestedTags: string[]             // methodology tags that match the task
}

type PipelineEntry = {
  methodologyId: string               // ID of the selected methodology
  order: number                       // execution sequence position
  rationale: string                   // why this methodology for this part of the task
  estimatedCostUsd: number | null      // historical median, or null if no prior runs. Agent flags null entries in pitch.
}

type CandidateMethodology = {
  definition: unknown                 // the MethodTS Methodology<S> value (opaque in MetaState)
  compilationReport: CompilationReport
  simulationResult: SimulationResult<unknown>
  estimatedCostUsd: number
}
```

**MethodologyMeta — the registry summary type:**

```typescript
type MethodologyMeta = {
  id: string                          // e.g., "P2-SD"
  name: string                        // e.g., "Software Delivery"
  version: string                     // e.g., "2.0"
  objective: string                   // natural language objective description
  domainSortNames: string[]           // sorts this methodology operates on
  predicateLabels: string[]           // predicates it evaluates
  methodIds: string[]                 // methods in range(δ_Φ)
  methodCount: number
  tags: string[]                      // "delivery", "review", "triage", "governance", etc.
  estimatedTokenBudget: number | null  // historical median, or null if no prior runs
  estimatedCostUsd: number | null     // historical median, or null if no prior runs
  compilationStatus: "compiled" | "trial" | "draft"
  lastRunDate: string | null          // ISO date of most recent execution
  successRate: number | null          // historical objective-met rate (0.0–1.0)
}
```

**Registry loading:** At strategy start, the loop scans the methodology registry (compiled YAML or MethodTS stdlib) and builds `ReadonlyArray<MethodologyMeta>`. This array is frozen for the duration of the strategy run — no mid-run mutations. Created methodologies go to `candidateMethodology`, not into the registry array. If the registry scan returns zero methodologies, σ_select routes to arm 4 (create new) if M1-MDES is available. If M1-MDES is also unavailable, the strategy suspends with error: "No methodologies available and M1-MDES not installed."

**Deliverables (Phase 1):**
- [ ] `MetaState` type with all fields
- [ ] `MetaStatus` union type
- [ ] `TaskAnalysis`, `PipelineEntry`, `CandidateMethodology` types
- [ ] `MethodologyMeta` type
- [ ] Registry scanner: load methodology metadata from registry YAML and/or MethodTS stdlib
- [ ] Tests: `MetaState` serialization round-trip, registry scanner against real registry

### Component 2: M-SELECT Methodology

The core methodology that governs the meta agent loop. M-SELECT is a MethodTS `Methodology<MetaState>` with a single method containing a 5-step DAG and a 4-arm coalgebraic transition function.

#### 2.1 Domain Theory

```typescript
const D_SELECT: DomainTheory<MetaState> = {
  id: "D_SELECT",
  signature: {
    sorts: [
      { name: "Objective", description: "The user's task expressed in natural language", cardinality: "singleton" },
      { name: "ProjectCard", description: "Project identity, essence, delivery rules", cardinality: "singleton" },
      { name: "MethodologyMeta", description: "Available methodology summaries", cardinality: "finite" },
      { name: "TaskAnalysis", description: "Decomposed task with capabilities and constraints", cardinality: "singleton" },
      { name: "PipelineEntry", description: "Selected methodology in execution sequence", cardinality: "finite" },
      { name: "CandidateMethodology", description: "Newly created methodology artifact", cardinality: "singleton" },
    ],
    functionSymbols: [
      { name: "match_score", inputSorts: ["MethodologyMeta", "TaskAnalysis"], outputSort: "Number", totality: "total" },
    ],
    predicates: {
      has_objective: check("has_objective", (s: MetaState) => s.objective.trim().length > 0),
      has_analysis: check("has_analysis", (s: MetaState) => s.taskAnalysis !== null),
      has_selection: check("has_selection", (s: MetaState) => s.selectedPipeline.length > 0),
      has_candidate: check("has_candidate", (s: MetaState) => s.candidateMethodology !== null),
      pitch_approved: check("pitch_approved", (s: MetaState) => s.pitchApproved === true),
      pipeline_complete: check("pipeline_complete", (s: MetaState) =>
        s.pipelinePosition >= s.selectedPipeline.length),
      objective_met: check("objective_met", (s: MetaState) => s.objectiveMet === true),
      m1_mdes_available: check("m1_mdes_available", (s: MetaState) =>
        s.availableMethodologies.some(m => m.id === "M1-MDES")),
      // Note: has_creation_budget cannot be a pure predicate because the ExecutionAccumulator
      // (which tracks remaining budget) is not part of MetaState — it lives in the runtime.
      // The actual budget gate is enforced by the strategy controller's onSuspend handler at
      // method_boundary before M-CREATE runs: if remainingBudget < $10, the controller
      // returns { tag: "abort", reason: "insufficient budget for methodology creation" }.
      // This predicate exists as a placeholder for domain theory completeness.
      has_creation_budget: check("has_creation_budget", (_s: MetaState) => true),
    },
  },
  axioms: {
    "Ax-PIPE": check("pipeline_ordered", (s: MetaState) =>
      s.selectedPipeline.every((e, i) => e.order === i)),
    "Ax-BUDGET": check("budget_positive", (s: MetaState) =>
      s.selectedPipeline.every(e => e.estimatedCostUsd === null || e.estimatedCostUsd >= 0)),
    "Ax-STATUS": check("status_consistent", (s: MetaState) => {
      if (s.status === "executing") return s.pitchApproved
      if (s.status === "complete") return s.objectiveMet !== null
      return true
    }),
  },
}
```

#### 2.2 Method: M-LOOP (the 5-step DAG)

```
σ_analyze (Analyze Task)
  ↓
σ_select (Select Methodology)
  ↓
σ_pitch (Pitch to Human)
  ↓
σ_execute (Execute Pipeline)
  ↓
σ_evaluate (Evaluate Outcome)
```

**σ_analyze — Analyze Task** (`tag: "agent"`)

The agent decomposes the user's objective into sub-tasks, identifies required capabilities, discovers constraints, and flags ambiguities. It reads the project card for context.

```typescript
const analyzeStep: Step<MetaState> = {
  id: "sigma_analyze",
  name: "Analyze Task",
  role: "orchestrator",
  precondition: check("has_objective", s => s.objective.trim().length > 0),
  postcondition: check("has_analysis", s => s.taskAnalysis !== null),
  execution: {
    tag: "agent",
    role: "orchestrator",
    context: {
      worldReads: [
        { key: "project_card", extract: (s) => renderProjectCard(s.projectCard) },
        { key: "codebase_summary", extract: (s) => extractCodebaseSummary(s.projectCard) },
      ],
      domainFacts: { axioms: "all", sorts: "all" },
      produceInsight: {
        key: "task_analysis",
        instruction: "Summarize your analysis as: sub-tasks, required capabilities, constraints, ambiguities, suggested methodology tags.",
      },
    },
    prompt: analyzePrompt,   // "Given this objective and project context, decompose the task..."
    parse: parseTaskAnalysis, // extract TaskAnalysis from fenced JSON block in agent output
  },
  suspension: "on_failure",
}
```

**σ_select — Select Methodology** (`tag: "agent"`)

The agent evaluates available methodologies against the task analysis and selects one or more for a pipeline. This is an agent step because methodology selection requires reasoning about fit — matching domain sorts, capability coverage, and project constraints.

```typescript
const selectStep: Step<MetaState> = {
  id: "sigma_select",
  name: "Select Methodology",
  role: "orchestrator",
  precondition: check("has_analysis", s => s.taskAnalysis !== null),
  postcondition: or(
    check("has_selection", s => s.selectedPipeline.length > 0),
    check("has_candidate", s => s.candidateMethodology !== null),
  ),
  execution: {
    tag: "agent",
    role: "orchestrator",
    context: {
      worldReads: [
        { key: "registry", extract: (s) => renderMethodologyRegistry(s.availableMethodologies) },
      ],
      insightDeps: ["task_analysis"],
      domainFacts: { predicates: ["has_selection", "has_candidate", "m1_mdes_available"] },
      produceInsight: {
        key: "selection_rationale",
        instruction: "Explain which methodology/pipeline you selected and why. If creating new, explain why existing options don't fit.",
      },
    },
    prompt: selectPrompt,   // "Given the task analysis and available methodologies, select..."
    parse: parseSelection,  // extract PipelineEntry[] or trigger arm 4
  },
  suspension: "on_failure",
}
```

When the agent determines no existing methodology fits (and M1-MDES is available), it sets `status: "creating"` and the methodology's transition function routes to arm 4 — running M1-MDES as a child methodology to create a new one.

**σ_pitch — Pitch to Human** (`tag: "agent"`, `suspension: "always"`)

The agent composes a rich explanation of the selected plan: what methodologies will run, in what order, what each does, estimated cost and time, identified risks, and any ambiguities that need human input. For arm 4, the pitch additionally includes the compilation report and simulation results.

```typescript
const pitchStep: Step<MetaState> = {
  id: "sigma_pitch",
  name: "Pitch Strategy to Human",
  role: "orchestrator",
  precondition: or(
    check("has_selection", s => s.selectedPipeline.length > 0),
    check("has_candidate", s => s.candidateMethodology !== null),
  ),
  postcondition: check("pitch_approved", s => s.pitchApproved === true),
  execution: {
    tag: "agent",
    role: "orchestrator",
    context: {
      worldReads: [
        { key: "methodology_details", extract: loadSelectedMethodologyDetails },
        { key: "project_context", extract: (s) => renderProjectCard(s.projectCard) },
      ],
      insightDeps: ["task_analysis", "selection_rationale"],
      domainFacts: { axioms: "all", roleConstraints: true },
      produceInsight: {
        key: "pitch_text",
        instruction: "Render the full pitch as a structured plan the human can review.",
      },
    },
    prompt: pitchPrompt,
    parse: (raw, current) => Effect.succeed({ ...current, pitchApproved: true }),
    parseInsight: extractPitchText,
  },
  suspension: "always",  // ALWAYS suspend — human must approve
}
```

**Pitch prompt structure (conditional on arm):**

```typescript
const pitchPrompt: Prompt<StepContext<MetaState>> = sequence(
  constant("## Strategy Proposal\n\n"),
  // Base pitch: objective recap, selection, rationale
  new Prompt(ctx => renderBasePitch(ctx.state, ctx.insights)),
  // Arm 4 only: show created methodology details
  cond(
    ctx => ctx.state.candidateMethodology !== null,
    sequence(
      constant("\n## Created Methodology\n\n"),
      new Prompt(ctx => renderCompilationReport(ctx.state.candidateMethodology!.compilationReport)),
      new Prompt(ctx => renderSimulationResults(ctx.state.candidateMethodology!.simulationResult)),
    ),
  ),
  // Always: risks and cost estimate
  new Prompt(ctx => renderRiskAnalysis(ctx.state, ctx.insights)),
  new Prompt(ctx => renderCostEstimate(ctx.state)),
)
```

**Multi-turn Q&A:** When the human asks a question before approving, the resolution is `rerun_step_with` (adding the question to state). The step re-runs, but the agent finds the prior pitch in the insight store (`pitchInsight` key) and answers the question in context without re-deriving the full pitch. Token cost per Q&A round depends on the agent provider: with stateless `ClaudeHeadlessProvider`, each call re-injects full context; insight caching saves re-derivation of the pitch content but not context injection. Net savings vary by objective complexity — the insight cache eliminates re-derivation of the pitch content, but context injection is always paid. Expect savings of 30-50% vs full re-derivation for typical objectives.

**Human resolutions at pitch:**
- `continue` → pitch approved, postcondition passes, proceed to execute
- `rerun_step_with` → human provides a question or modification; step re-runs with updated state
- `change_methodology` → propagates to strategy controller, M-SELECT re-evaluates from σ_select
- `abort` → strategy terminates

**σ_execute — Execute Pipeline** (`tag: "script"`)

A script step that runs the selected methodology pipeline. For each `PipelineEntry`, it loads the full `Methodology<S>` object via `RegistryService.load(methodologyId)`, constructs a retraction pair from `MetaState` to the child's state, and calls `runMethodology`. Results are accumulated in `pipelineResults`. For registry methodologies, `load` resolves from compiled MethodTS stdlib imports or YAML-to-MethodTS adapter (PRD 021 D-098). For arm 4 candidates, `load` returns `state.candidateMethodology.definition`.

```typescript
const executeStep: Step<MetaState> = {
  id: "sigma_execute",
  name: "Execute Pipeline",
  role: "orchestrator",
  precondition: check("pitch_approved", s => s.pitchApproved === true),
  postcondition: check("pipeline_complete", s => s.pipelinePosition >= s.selectedPipeline.length),
  execution: {
    tag: "script",
    execute: (state) => Effect.gen(function* () {
      let current = state
      for (const entry of current.selectedPipeline) {
        const methodology = yield* loadMethodology(entry.methodologyId)
        const retraction = yield* buildRetraction(current, methodology)
        const childState = retraction.embed(current)
        // Wrap in WorldState envelope for runMethodology
        const childWorldState = { value: childState, axiomStatus: { valid: true, violations: [] } }
        const result = yield* runMethodology(methodology, childWorldState)
        // Handle child methodology result
        if (result.status !== "completed") {
          // Pipeline partial failure: suspend with results so far.
          // Strategy controller presents to human. Resolutions:
          //   "continue" → skip failed entry, proceed to next
          //   "rerun_step" → retry failed entry
          //   "abort" → terminate pipeline
          yield* Effect.fail({ _tag: "StepError", stepId: "sigma_execute", message: `Pipeline entry ${entry.methodologyId} failed: ${result.status}` })
        }
        current = {
          ...retraction.project(result.finalState.value),  // unwrap WorldState
          pipelinePosition: entry.order + 1,
          childResult: result,
          pipelineResults: [...current.pipelineResults, result],
        }
      }
      return current
    }),
  },
  suspension: "on_failure",
}
```

**Implementation requirement:** σ_execute must use `runMethodology` (not `runMethodologyToCompletion`) with a forwarding loop that relays child methodology suspensions to the parent's `onSuspend` handler. The script step spawns each child methodology execution as a forked Effect Fiber for interruptibility (see Component 4). The pseudocode above is simplified — the real implementation wraps each pipeline entry in a `SuspensionSignal`-aware execution loop.

**Pipeline partial failure:** If a pipeline entry's methodology fails (`result.status !== "completed"`), σ_execute suspends with reason `error`. The strategy controller presents partial results to the human. Resolutions: `continue` (skip failed entry, proceed to next), `rerun_step` (retry failed entry), `abort` (terminate pipeline). Accumulated `pipelineResults` up to the failure point are preserved.

**Retraction pairs (Phase 1):** Phase 1 retraction pairs are manually authored per known methodology (P2-SD, P1-EXEC). For arm 4 created methodologies, a universal retraction is used:
- `embed(meta: MetaState) → ChildState`: passes `{ objective: meta.objective, projectCard: meta.projectCard, taskAnalysis: meta.taskAnalysis }` to the child's initial state. The child methodology's `parse` functions merge agent output into this base.
- `project(child: unknown) → Partial<MetaState>`: does NOT inspect the child's typed state (it is `unknown`). Instead, returns `{ childResult: result }` using the `MethodologyResult` structural envelope (status, trace, cost). The child's own objective predicate result (boolean) is the primary completion signal.

Typed retraction verification is deferred to Phase 2.

**σ_evaluate — Evaluate Outcome** (`tag: "agent"`)

The agent reviews the pipeline results against the original objective and determines whether the objective was met.

```typescript
const evaluateStep: Step<MetaState> = {
  id: "sigma_evaluate",
  name: "Evaluate Outcome",
  role: "orchestrator",
  precondition: check("pipeline_complete", s => s.pipelinePosition >= s.selectedPipeline.length),
  postcondition: check("has_evaluation", s => s.objectiveMet !== null),
  execution: {
    tag: "agent",
    role: "orchestrator",
    context: {
      worldReads: [
        { key: "pipeline_results", extract: renderPipelineResults },
      ],
      insightDeps: ["task_analysis", "pitch_text"],
      domainFacts: { axioms: "all" },
    },
    prompt: evaluatePrompt,  // "Review the execution results against the original objective..."
    parse: parseEvaluation,  // extract objectiveMet + evaluationRationale
  },
  suspension: "on_failure",
}
```

**`renderPipelineResults` contract:** Renders the structural envelope of each `MethodologyResult<unknown>`: status, step count, methods completed, cost, duration, and the child methodology's own objective predicate result (boolean). Does not interpret the child's typed state — evaluation is observational. For each result: `"Methodology {id}: status={status}, steps={N}, cost=${usd}, objective_met={bool}"` plus step-by-step output summaries from `CompletedMethodRecord.stepOutputSummaries`.

#### 2.3 Transition Function (δ_Φ) — 4-Arm Priority Stack

M-SELECT's transition function routes based on the current `MetaState`. The methodology wraps M-LOOP as the single method — the 4 arms control what *happens within* M-LOOP (specifically, what σ_select produces), not which method runs.

However, for arm 4, the transition function routes to a second method — M-CREATE — before re-entering M-LOOP.

```typescript
const M_SELECT: Methodology<MetaState> = {
  id: "M-SELECT",
  name: "Meta Agent Loop",
  domain: D_SELECT,
  arms: [
    {
      priority: 0,
      label: "terminate",
      condition: or(
        check("complete", s => s.status === "complete"),
        check("aborted", s => s.status === "aborted"),
        check("failed", s => s.status === "failed"),
      ),
      selects: null,  // terminate
      rationale: "Methodology complete, aborted, or failed — stop.",
    },
    {
      priority: 1,
      label: "create_methodology",
      condition: and(
        check("needs_creation", s => s.status === "creating"),
        check("m1_mdes_available", s => s.availableMethodologies.some(m => m.id === "M1-MDES")),
        check("has_creation_budget", _s => true),  // placeholder — real check in strategy controller onSuspend at method_boundary
        not(check("already_created", s => s.candidateMethodology !== null)),
      ),
      selects: M_CREATE,  // run M1-MDES to create a methodology
      rationale: "No existing methodology fits. Create a new one via M1-MDES.",
    },
    {
      priority: 2,
      label: "execute_loop",
      condition: or(
        check("ready_to_analyze", s => s.status === "analyzing"),
        check("ready_to_select", s => s.status === "selecting"),
        check("ready_to_pitch", s => s.status === "pitching"),
        check("ready_to_execute", s => s.status === "approved"),
        check("ready_to_evaluate", s => s.status === "evaluating"),
      ),
      selects: M_LOOP,  // the 5-step DAG
      rationale: "Continue the selection-pitch-execute-evaluate loop.",
    },
    {
      priority: 3,
      label: "retry_with_adaptation",
      condition: and(
        check("evaluated", s => s.objectiveMet === false),
        check("has_budget", _s => true),  // checked by safety bounds
      ),
      selects: M_LOOP,  // re-run with adapted state
      rationale: "Objective not met — re-enter the loop for methodology re-selection.",
    },
  ],
  objective: check("objective_met", s => s.objectiveMet === true),
  terminationCertificate: {
    measure: (s) => {
      if (s.status === "complete" || s.status === "failed" || s.status === "aborted") return 0
      return s.selectedPipeline.length - s.pipelinePosition + (s.objectiveMet === false ? 1 : 0)
    },
    decreases: "Pipeline position advances monotonically within a single methodology run. The termination certificate is locally decreasing per-loop; cross-retry termination is guaranteed by the strategy's maxLoops cap (not by this measure).",
  },
  safety: {
    maxLoops: 5,
    maxTokens: 2_000_000,
    maxCostUsd: 50,
    maxDurationMs: 7_200_000,  // 2 hours
    maxDepth: 3,               // Methodology depth: M-SELECT(1) → child(2) → child's child(3). Does not count strategy level.
  },
}
```

#### 2.4 M-CREATE Method (Arm 4)

When the selection step determines no existing methodology fits and M1-MDES is available, the transition function routes to M-CREATE — a method that wraps M1-MDES execution and validates the result.

M-CREATE is a 3-step method:

```
σ_design (Run M1-MDES)
  ↓
σ_compile (Compile and Validate)
  ↓
σ_simulate (Simulate Routing)
```

**σ_design** — Agent step that runs M1-MDES as a child methodology via retraction. The agent describes what methodology is needed based on the task analysis. M1-MDES produces a candidate `Method<S>` in its final state.

**σ_compile** — Script step that runs `compileMethod()` on the candidate. Gates G1–G6. If compilation passes, the candidate receives `compilationStatus: "trial"` (not "compiled" — promoted to "compiled" only after successful execution and human approval via persistence). If compilation fails, the step fails and the strategy can retry or abort.

**σ_simulate** — Script step that runs `simulateRun()` with at least 3 hypothetical states derived from the task analysis. Verifies the created methodology's routing produces sensible method sequences.

**Safety envelope for created methodologies:**

```typescript
const MIN_VIABLE_BUDGET = 5.0  // floor: below this, created methodology cannot execute meaningfully

function constrainCreatedMethodology(
  created: Methodology<unknown>,
  parentAccumulator: ExecutionAccumulator,
  parentSafety: SafetyBounds,
): Methodology<unknown> {
  // Runtime assertion: validate the created value is a structurally valid methodology
  // before applying safety constraints. Prevents garbage from spread operator on non-Methodology objects.
  const validation = validateMethodology(created)
  if (!validation.valid) throw new Error(`Created methodology is structurally invalid: ${validation.errors.join(", ")}`)

  const remainingBudget = parentSafety.maxCostUsd - parentAccumulator.totalCostUsd
  return {
    ...created,
    safety: {
      maxLoops: Math.min(created.safety.maxLoops, 5),
      maxTokens: Math.min(created.safety.maxTokens, 500_000),
      maxCostUsd: Math.min(created.safety.maxCostUsd, Math.max(remainingBudget * 0.5, MIN_VIABLE_BUDGET)),
      maxDurationMs: Math.min(created.safety.maxDurationMs, 1_800_000),  // 30 min
      maxDepth: 1,  // created methodologies cannot create sub-methodologies
    },
  }
}
// Note: arm 4 should not be attempted if remainingBudget < $10 (2x MIN_VIABLE_BUDGET).
// The has_creation_budget predicate in the transition function gates this.
```

**Arm 4 experimental status:** Arm 4 is the highest-risk path. LLM-authored TypeScript that passes G1-G6 compilation gates is at the frontier of current capability. Phase 1 treats arm 4 as experimental — gated by M1-MDES availability, bounded by maxRetries: 3 on σ_compile, with fallback to arms 2/3 on exhaustion. Success criteria should accept fallback as a valid outcome.

**Caps (v1 guardrails, removable later):**
- `maxLoops: 5` — max 5 routing iterations
- `maxSteps: 7` per method — enforced at compilation (G4 edge count check)
- `maxMethods: 3` — enforced at compilation (arm count check)
- `maxCostUsd: min(remaining * 0.5, absolute_cap)` — never consumes entire remaining budget
- `maxDepth: 1` — created methodologies cannot themselves create methodologies

**Deliverables (Phase 1):**
- [ ] M-LOOP method: 5-step DAG with typed steps
- [ ] M-CREATE method: 3-step DAG (design, compile, simulate)
- [ ] M-SELECT methodology: 4-arm transition function
- [ ] D_SELECT domain theory with axioms and predicates
- [ ] `constrainCreatedMethodology` — safety envelope enforcement
- [ ] Prompt definitions for all agent steps (analyze, select, pitch, evaluate, design)
- [ ] Parse functions for all agent steps (each must use structured output extraction — e.g., fenced JSON blocks — with retry-on-parse-failure: if extraction fails, re-prompt the agent with the expected format)
- [ ] Tests: M-LOOP and M-CREATE compile via `compileMethod()`; M-SELECT passes `validateMethodology()`. Routing simulation covers all 4 arms

### Component 3: MetaStrategy Controller

The `StrategyController<MetaState>` that wraps M-SELECT and governs the meta-loop's interaction with the human.

```typescript
// R parameter includes both ClientIO and RegistryService — both are provided in the Effect layer.
const MetaStrategy: StrategyController<MetaState, ClientIO & RegistryService> = {
  id: "S-META",
  name: "Meta Agent Loop",
  methodology: M_SELECT,

  gates: [
    scriptGate(check("objective_met", s => s.objectiveMet === true)),
  ],

  onSuspend: (suspended) => Effect.gen(function* () {
    const { reason } = suspended

    switch (reason.tag) {
      case "checkpoint": {
        // Pitch step — present to human via client
        if (reason.step.id === "sigma_pitch") {
          const resolution = yield* ClientIO.presentPitch(suspended)
          return resolution
        }
        // Other checkpoints — present status
        const resolution = yield* ClientIO.presentCheckpoint(suspended)
        return resolution
      }

      case "gate_review":
      case "checklist_review":
        // Gate/checklist failure — present to human
        return yield* ClientIO.presentGateFailure(suspended)

      case "error":
        // Step error — present to human with options
        return yield* ClientIO.presentError(suspended)

      case "safety_warning":
        // Budget/time warning — human decides continue or abort
        return yield* ClientIO.presentSafetyWarning(suspended)

      case "human_decision":
        // Explicit question for the human
        return yield* ClientIO.presentQuestion(suspended)

      case "method_boundary":
        // Between methods — auto-continue unless configured otherwise
        return { tag: "continue" }

      case "methodology_complete":
        // Inner methodology done — auto-continue to evaluation
        return { tag: "continue" }

      default:
        return { tag: "continue" }
    }
  }),

  onComplete: (result) => Effect.gen(function* () {
    const state = result.finalState.value  // unwrap WorldState<MetaState>
    if (result.status === "completed" && state.objectiveMet) {
      // Offer to persist created methodology if applicable
      if (state.candidateMethodology !== null) {
        const save = yield* ClientIO.offerMethodologyPersistence(
          state.candidateMethodology
        )
        if (save) {
          yield* RegistryService.persist(state.candidateMethodology)
        }
      }
      return { tag: "done", result }
    }

    if (result.status === "completed" && !state.objectiveMet) {
      // Objective not met — ask human: retry, switch approach, or accept
      const decision = yield* ClientIO.presentIncompleteResult(result)
      return decision
    }

    if (result.status === "safety_violation") {
      yield* ClientIO.presentSafetyViolation(result)
      return { tag: "abort", reason: `Safety violation: ${result.violation?.bound}` }
    }

    // Failed or aborted — present to human
    yield* ClientIO.presentFailure(result)
    return { tag: "abort", reason: result.status }
  }),

  safety: {
    maxLoops: 3,         // max 3 full strategy iterations (select → execute → evaluate → re-select)
    maxTokens: 5_000_000,
    maxCostUsd: 100,
    maxDurationMs: 14_400_000,  // 4 hours
    maxDepth: 4,         // Strategy depth: strategy(0) → M-SELECT(1) → M1-MDES or child(2) → created(3) → child methods(4). Includes strategy level. Methodology maxDepth (3) + 1 for strategy wrapper.
  },
}
```

**ClientIO service interface:**

```typescript
interface ClientIO {
  readonly _tag: "ClientIO"
  presentPitch: (suspended: SuspendedMethodology<MetaState>) => Effect<Resolution<MetaState>, never, never>
  presentCheckpoint: (suspended: SuspendedMethodology<MetaState>) => Effect<Resolution<MetaState>, never, never>
  presentGateFailure: (suspended: SuspendedMethodology<MetaState>) => Effect<Resolution<MetaState>, never, never>
  presentError: (suspended: SuspendedMethodology<MetaState>) => Effect<Resolution<MetaState>, never, never>
  presentSafetyWarning: (suspended: SuspendedMethodology<MetaState>) => Effect<Resolution<MetaState>, never, never>
  presentQuestion: (suspended: SuspendedMethodology<MetaState>) => Effect<Resolution<MetaState>, never, never>
  presentIncompleteResult: (result: MethodologyResult<MetaState>) => Effect<StrategyDecision<MetaState>, never, never>
  presentSafetyViolation: (result: MethodologyResult<MetaState>) => Effect<void, never, never>
  presentFailure: (result: MethodologyResult<MetaState>) => Effect<void, never, never>
  offerMethodologyPersistence: (candidate: CandidateMethodology) => Effect<boolean, never, never>
}

const ClientIO = Context.Tag<ClientIO>("ClientIO")
```

**Worst-case loop product:** 3 strategy iterations x 5 methodology loops x N pipeline entries. With `maxLoops: 5` at the methodology level and `maxLoops: 3` at the strategy level, the theoretical maximum is 15 methodology executions per strategy run. The cost ceiling (`maxCostUsd: $100`) is the effective termination bound — the loop product cannot explode because the budget exhausts. Loop caps are defense-in-depth.

The `ClientIO` service is the boundary between the meta-loop process and the client (TUI/web). Each client provides its own `ClientIO` implementation. The TUI renders suspensions as text prompts; the web client renders them as interactive UI components. The meta-loop process is agnostic to the rendering mechanism.

**Deliverables (Phase 1):**
- [ ] `MetaStrategy` controller definition
- [ ] `ClientIO` service interface
- [ ] `onSuspend` handler: route by suspension reason, delegate to ClientIO
- [ ] `onComplete` handler: methodology persistence offer, retry/abort logic
- [ ] Strategy-level safety bounds
- [ ] Tests: mock `ClientIO` + mock `AgentProvider` for full strategy loop

### Component 4: Interrupt Resolution

A new resolution variant for PRD 021's `Resolution<S>` type, enabling the human to forcibly suspend a running child methodology.

```typescript
// Addition to PRD 021's Resolution<S> union:
| { tag: "interrupt"; reason: string }
```

**Mechanism:** When the client sends an `interrupt` resolution, the strategy controller propagates it as an `Effect.interrupt` to the child methodology's Effect Fiber. The child's cleanup logic captures current state and trace. The interrupted methodology returns a `MethodologyResult<S>` with status `"aborted"` and a partial trace.

**Requirements:**
- Child methodologies must run in their own Effect Fiber (for interruptibility)
- The meta-loop's `σ_execute` step must spawn child methodology execution as a forked Fiber
- `Effect.interrupt` is the standard Effect cancellation mechanism — no custom implementation needed
- The interrupted child's `finalState` is the last committed snapshot (post-step, not mid-step)

**Deliverables (Phase 1):**
- [ ] `interrupt` variant added to `Resolution<S>` type (PRD 021 amendment)
- [ ] Child methodology Fiber management in `σ_execute`
- [ ] Interrupt propagation: client → strategy → fiber interrupt
- [ ] Tests: interrupt mid-execution, verify partial trace captured

### Component 5: Client Contract

The interface between the meta-loop process and any client (TUI, web, or programmatic).

**Two event streams:**

1. **Strategy EventBus** — `RuntimeEvent<MetaState>` events for the meta-loop's own lifecycle. Emitted by the MethodTS runtime as M-SELECT executes.

2. **Bridge channels** (Phase 2) — sub-agent progress/events via bridge HTTP API. Only present when `BridgeAgentProvider` is used.

**Client responsibilities:**
- Subscribe to strategy EventBus (required)
- Subscribe to bridge channels (Phase 2, optional)
- Merge both streams into a unified view for the user
- Implement `ClientIO` to handle suspension presentations
- Send resolutions back to the meta-loop process

**Process communication:**

Phase 1 (in-process): The client and meta-loop run in the same Node.js process. `ClientIO` is a direct function call. EventBus subscription is a direct `Stream` consumer.

Phase 2 (cross-process): The meta-loop exposes an HTTP/WebSocket API. The client connects remotely. Events are streamed via SSE. Resolutions are sent via HTTP POST. Suspensions are serialized (PRD 021's suspension serialization) for cross-process delivery. **Note:** The Phase 1→2 transition (in-process → cross-process) is a significant architectural change. `ClientIO` and `EventBus` abstract over transport, but suspension serialization, event stream transport, and connection lifecycle management are non-trivial additions. Phase 2 should be scoped as its own PRD amendment.

**Unified event type for clients:**

```typescript
type ClientEvent =
  | { source: "strategy"; event: RuntimeEvent<MetaState> }
  | { source: "bridge"; sessionId: string; event: BridgeChannelEvent }
```

**Deliverables (Phase 1):**
- [ ] `ClientEvent` union type
- [ ] In-process client binding (direct EventBus + ClientIO)
- [ ] Minimal TUI reference client: readline-based input, text-based rendering of suspensions and events. No full-screen layout.
- [ ] TUI pitch rendering: structured plan display with approve/reject/question commands

**Deliverables (Phase 2):**
- [ ] HTTP/WebSocket API for cross-process client communication
- [ ] SSE endpoint for event streaming
- [ ] Suspension serialization for remote delivery
- [ ] Web client reference implementation

### Component 6: Post-Strategy Methodology Persistence

When a strategy run completes and a methodology was created (arm 4), offer to save it to the registry for future use.

**Flow:**
1. Strategy `onComplete` detects `candidateMethodology !== null` and status `"completed"`
2. Strategy calls `ClientIO.offerMethodologyPersistence(candidate)`
3. If human approves: persist to registry with full compilation artifacts
4. Future M-SELECT runs discover the new methodology via the registry scanner

**Persistence format:**
- MethodTS definition saved as `.ts` file in stdlib or a user-defined methodology directory
- Compilation report saved alongside
- `MethodologyMeta` entry added to a registry index

**Important:** Persistence is a post-strategy side effect, not a mid-run mutation. The `availableMethodologies` array remains frozen during execution. The persisted methodology becomes available on the *next* strategy run.

**Deliverables (Phase 1):**
- [ ] `RegistryService` Effect service interface (persist, scan)
- [ ] File-based persistence: write MethodTS definition + compilation report
- [ ] Registry index update on persistence
- [ ] Tests: persist a methodology, verify it appears in next registry scan

---

## 5. Package Structure

```
packages/loop/
  src/
    index.ts                        — barrel export
    state/
      meta-state.ts                 — MetaState, MetaStatus, TaskAnalysis, PipelineEntry
      methodology-meta.ts           — MethodologyMeta type
      candidate.ts                  — CandidateMethodology type
    methodology/
      d-select.ts                   — D_SELECT domain theory
      m-loop.ts                     — M-LOOP method (5-step DAG)
      m-create.ts                   — M-CREATE method (arm 4: design, compile, simulate)
      m-select.ts                   — M-SELECT methodology (4-arm transition function)
      safety.ts                     — constrainCreatedMethodology, budget inheritance
    strategy/
      meta-strategy.ts              — MetaStrategy controller
      client-io.ts                  — ClientIO service interface
    steps/
      analyze.ts                    — σ_analyze step definition + prompt + parse
      select.ts                     — σ_select step definition + prompt + parse
      pitch.ts                      — σ_pitch step definition + prompt + parse
      execute.ts                    — σ_execute step definition (script)
      evaluate.ts                   — σ_evaluate step definition + prompt + parse
      create/
        design.ts                   — σ_design step (M1-MDES wrapper)
        compile.ts                  — σ_compile step (compileMethod)
        simulate.ts                 — σ_simulate step (simulateRun)
    registry/
      scanner.ts                    — scan YAML registry + MethodTS stdlib → MethodologyMeta[]
      persistence.ts                — RegistryService: persist created methodologies
    prompts/
      analyze-prompt.ts             — Prompt<StepContext<MetaState>> for task analysis
      select-prompt.ts              — Prompt<StepContext<MetaState>> for methodology selection
      pitch-prompt.ts               — Prompt<StepContext<MetaState>> for pitch rendering
      evaluate-prompt.ts            — Prompt<StepContext<MetaState>> for outcome evaluation
    client/
      client-event.ts               — ClientEvent union type
      tui/
        index.ts                    — TUI reference client entry point
        renderer.ts                 — Terminal rendering for suspensions, events, pitch
        input.ts                    — User input handling (approve, reject, question, interrupt)
    run.ts                          — main(): parse args, build layers, runStrategy
  test/
    meta-state.test.ts              — MetaState serialization, axiom validation
    m-select.test.ts                — M-SELECT compilation, routing simulation (all 4 arms)
    m-create.test.ts                — M-CREATE compilation, safety constraints
    strategy.test.ts                — Full strategy loop with MockAgentProvider + mock ClientIO
    registry.test.ts                — Registry scanner against real YAML + stdlib
    pitch.test.ts                   — Pitch prompt rendering, Q&A re-run token efficiency
    interrupt.test.ts               — Interrupt resolution, fiber cancellation, partial trace
    persistence.test.ts             — Created methodology persistence and re-discovery
    integration.test.ts             — End-to-end with ClaudeHeadlessProvider (requires API access)
```

---

## 6. PRD 015 Subsumption

PRD 015 (Default Execution Method — M-EXEC) is subsumed by this PRD. The specific mapping:

| PRD 015 Concept | PRD 022 Equivalent |
|-----------------|-------------------|
| M-EXEC 7-step DAG | One selectable methodology in the registry. M-SELECT can route to it via arm 1 (exact match) for simple tasks. |
| Commission YAML storage | Replaced by `MetaState` — the meta-loop's typed state carries all commission context. No separate YAML file needed. |
| P1-EXEC routing to M-EXEC | M-SELECT's transition function handles all routing. P1-EXEC methodologies are in the registry, selectable by the meta-loop. |
| Anti-stalling via step DAG | Structural: the meta-loop runs typed methods with pre/postconditions. Agent steps are discrete, bounded, and goal-directed. The MethodTS runtime's step execution model inherently prevents stalling. |
| Auto-load on bridge spawn | The meta-loop IS the spawner. Bridge sessions are children of the meta-loop, not standalone agents needing anti-stall measures. |
| `/commission` skill | Replaced by the meta-loop's σ_pitch step. The human approves a plan, not a commission YAML. |

**PRD 015 status change:** Draft → Subsumed by PRD 022.

---

## 7. Success Criteria

1. **Meta-loop selects correct methodology** for 3 test scenarios: (a) implementation task → P2-SD, (b) governance decision → P1-EXEC with M1-COUNCIL, (c) novel task type → arm 4 creates methodology (when M1-MDES available) or arm 2/3 adapts existing
2. **Pitch renders with actionable detail** — methodology names, step summaries, cost estimates, risk assessment. Human can make informed approve/reject decision.
3. **Q&A re-run is token-efficient** — follow-up questions cost < 60% of initial pitch token count (insight store caching avoids re-derivation; context re-injection cost is provider-dependent)
4. **End-to-end loop completes** — objective → analyze → select → pitch → approve → execute → evaluate → done, with MockAgentProvider
5. **Safety bounds enforced** — created methodology budget ≤ 50% of remaining, step/loop caps applied, depth bounded at 3
6. **Interrupt works** — human sends interrupt during child methodology execution, partial trace captured, strategy recovers gracefully
7. **Created methodology persistence** — methodology created via arm 4, human approves persistence, methodology appears in next registry scan
8. **Client contract stable** — Minimal TUI reference client renders all suspension types, sends valid resolutions, merges event streams
9. **Loop overhead measured** — Full 5-step loop overhead (analyze → select → pitch → execute → evaluate) measured for simple, medium, and complex tasks. If simple-task overhead exceeds 30K tokens, fast-path design triggered for Phase 2

---

## 8. Implementation Phases

### Prerequisites (PRD 021 Readiness Gates)

PRD 022 is co-developed with PRD 021. The following PRD 021 Phase 1b deliverables must exist before each PRD 022 phase begins:

| PRD 022 Phase | Requires from PRD 021 |
|---------------|----------------------|
| Phase 1a | `Methodology<S>`, `Method<S>`, `Step<S>`, `Predicate<S>`, `Prompt<A>`, `DomainTheory<S>`, `compileMethod`, `validateMethodology`, `simulateRun`, `SafetyBounds` types |
| Phase 1b | `runMethodology`, `runStrategy`, `StrategyController<S, R>`, `SuspendedMethodology<S>`, `Resolution<S>`, `EventBus<S>`, `RuntimeEvent<S>`, `MockAgentProvider`, `ClaudeHeadlessProvider` |
| Phase 1c | Full Phase 1b runtime operational; `ClaudeHeadlessProvider` tested against real Claude |

A readiness checkpoint must confirm these APIs exist before commissioning each phase.

### Phase 1a: Foundation (types + methodology definition)
- `MetaState`, `MethodologyMeta`, and all supporting types
- D_SELECT domain theory
- M-LOOP method (5-step DAG) with step definitions, prompts, and parse functions
- M-CREATE method (3-step DAG) with safety constraints
- M-SELECT methodology (4-arm transition function)
- `compileMethod()` validation: M-LOOP and M-CREATE pass G1–G6; M-SELECT passes `validateMethodology()`
- Routing simulation tests: all 4 arms fire correctly

### Phase 1b: Strategy + Client
- MetaStrategy controller with `onSuspend` and `onComplete` handlers
- `ClientIO` service interface
- `interrupt` resolution variant (PRD 021 amendment)
- Registry scanner (YAML + stdlib → `MethodologyMeta[]`)
- Registry persistence service (post-strategy methodology saving)
- TUI reference client
- Full strategy loop tests with MockAgentProvider

### Phase 1c: Integration
- End-to-end test with `ClaudeHeadlessProvider` against real Claude
- Package wiring (`@method/loop` depends on `@method/methodts`)
- CLI entry point (`run.ts` — parse objective from args or stdin, build Effect layers, execute)
- Documentation: getting-started guide, architecture overview
- **Deployment:** CLI invocation: `npx @method/loop --objective 'task description' --workdir .`. Prerequisites: Node.js 20+, `claude` CLI on PATH, `@method/methodts` installed, valid `.method/project-card.yaml`. Environment variables: `CLAUDE_BIN` (default: `claude`), `MAX_COST_USD` (default: 100), `MODEL` (default: user's configured model).
- Token overhead measurement: if overhead exceeds 30K tokens for trivial objectives, add a fast-path that skips analysis/pitch for pre-approved methodology patterns

### Phase 2: Bridge + Web
- `BridgeAgentProvider` integration (sub-agent sessions with dashboard visibility)
- Cross-process client API (HTTP/WebSocket + SSE)
- Web client reference implementation
- `agentSteeredController` for fully autonomous mode
- Methodology composition via retraction pairs (pipeline coherence)

### Phase 3: Self-Improvement
- Methodology evolution: aggregate retros, identify gaps, propose updates
- Adaptive safety bounds from historical success rates
- Cross-project methodology transfer

---

## 9. Open Design Questions (deferred)

| Question | Context | Proposed Resolution |
|----------|---------|-------------------|
| How does the meta-loop handle multi-turn conversation? | User says "now fix the tests too" after first task completes. | Strategy's `onComplete` handler: if human provides a new objective, update `MetaState.objective` and `rerun`. The strategy loop naturally handles this. |
| Should the meta-loop manage its own project card? | The loop needs a project card for instantiation. Does it use the target project's card? | Use the target project's card. The meta-loop is an executor, not a project. Its identity is the strategy, not a card. |
| How do retraction pairs work for pipeline entries? | Sequential pipeline execution needs state coherence across methodologies with different domains. | Phase 1: each pipeline entry gets an independent `embed`/`project` pair built from the task analysis. Phase 2: formal retraction verification via PRD 021. |
| What happens when M1-MDES produces an invalid methodology? | Compilation fails after agent-authored a methodology. | σ_compile fails → step retry with feedback ("compilation failed: {gates}") → M1-MDES re-runs with the failure context. Bounded by step maxRetries (default 3). If exhausted, arm 4 fails and strategy falls back to arm 2/3 or aborts. |
| What is the fast path for simple tasks? | For trivial objectives (e.g., "fix this typo"), the full 5-step analyze-select-pitch-execute-evaluate loop imposes disproportionate overhead (22K-37K tokens before real work begins). | Phase 1 deferred. Possible mitigations: (1) a fast-path arm skipping analysis/pitch for tasks matching a single methodology with high confidence, (2) a lightweight mode collapsing analyze+select into one step, (3) a `skipPitchThreshold` for tasks below a cost estimate. Measured in Phase 1c integration testing. |

---

## 10. Relationship to Existing Infrastructure

| System | Relationship | Direction |
|--------|-------------|-----------|
| **@method/methodts** (PRD 021) | The meta-loop's foundation. All types, runtime, providers, strategy come from MethodTS. | Consumed |
| **@method/bridge** (PRDs 005-018) | Session pool for sub-agent execution (Phase 2). Dashboard for sub-agent visibility. | Consumed via BridgeAgentProvider |
| **@method/mcp** | Not used. The meta-loop is a standalone process, not an MCP server. MCP tools are available to agents spawned by the meta-loop (via Claude Code's tool surface). | Indirect |
| **@method/core** | Not used. The meta-loop uses MethodTS, not core. PRD 021's transition plan applies: core is deprecated as MethodTS matures. | None |
| **Registry (YAML)** | Scanned at strategy start for `MethodologyMeta`. Read-only during execution. Created methodologies persisted post-strategy. | Read + append |
| **Project card** | Loaded at strategy start into `MetaState.projectCard`. Used for instantiation and context injection. | Read |
| **Bridge dashboard** | Shows sub-agent sessions spawned by the meta-loop (Phase 2). Does NOT show the meta-loop itself. | Downstream |
