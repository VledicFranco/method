---
type: prd
id: "047"
title: "Build Orchestrator — UI-Driven Autonomous FCD Lifecycle from Idea to Validated Delivery"
date: "2026-04-04"
status: draft
domains: [bridge/build, bridge/build-ui, pacta]
surfaces: [CheckpointPort, BuildOrchestratorPact, ConversationPort, BuildUIRoutes]
evidence: "fcd-debate-20260404 council decision, strategy-pipelines council (retry-with-context 60% vs 20%)"
validation: "exp-build-orchestrator — matched-pair A/B (manual skills vs /build), N=3 features"
review: "fcd-review 2026-04-04 — 17 findings (6 high, 8 medium, 3 low), all addressed in v4"
---

# PRD 047 — Build Orchestrator

## Problem

The FCD skill family produces high-quality software through 8 strategy DAGs — but it only covers the middle of the delivery lifecycle, the human interaction is CLI-centric, and there is no systematic learning across builds.

**Four gaps:**

1. **No exploration before design.** The human manually greps around, reads files ad-hoc, maybe spawns a debate. Nothing structured feeds into the design phase. Context gets lost.

2. **No connective tissue between phases.** The human manually sequences design → plan → commission → review, waits between phases, diagnoses failures, re-invokes affected commissions. 10+ manual actions per feature.

3. **No visibility into agent decisions.** When a strategy runs, the human sees pass/fail. They don't see WHY the agent made choices, WHAT the design looks like, or HOW to intervene with ideas mid-flight. The CLI is a keyhole view.

4. **No validation, measurement, or learning.** After code ships, there's no systematic way to prove the feature works, measure value delivered, or learn from patterns across builds to improve the process itself.

## Constraints

- Must not modify existing FCD strategy YAMLs — they are proven and stable
- Must work within existing bridge infrastructure (MCP tools, event bus, dashboard, sessions)
- Pacta cognitive agent SDK is the execution framework
- Single developer — incremental wave delivery
- **Primary interface is the bridge dashboard UI**, not Claude Code sessions
- Human gates must be conversational (discuss, then approve/reject)
- Human must be able to invoke optional skills (debate, review, surface) at any phase from the dashboard
- Orchestrator overhead must be measurable and bounded
- Success criteria defined during specification must be machine-evaluable
- Autonomy level must be configurable per-build (discuss-all, auto-routine, full-auto)

## Success Criteria

| ID | Criterion | Measurement |
|----|-----------|-------------|
| SC-1 | **Full lifecycle coverage** | `/build` drives all 8 phases (explore → specify → design → plan → implement → review → validate → measure) with no manual skill invocations between phases |
| SC-2 | **Reduced human interventions** | `/build` completes a 3-commission feature with ≤ 4 human interventions (scope approval, plan approval, review verdict, merge) vs ≥ 10 manual actions in the skill-by-skill approach |
| SC-3 | **Autonomous failure recovery** | When a commission fails gate checks, `/build` routes failure context to a targeted retry succeeding ≥ 60% of the time |
| SC-4 | **Cost overhead** | Orchestrator agent token usage ≤ 15% of total pipeline token usage |
| SC-5 | **Value evidence** | Every `/build` run produces a validation report with machine-evaluated success criteria |
| SC-6 | **Human comprehension** | At every human gate, the dashboard renders the agent's reasoning, the current design artifacts, and a conversation thread — the human can understand and influence, not just approve/reject |
| SC-7 | **Method learning** | After 5+ builds, the refinement engine surfaces at least 3 actionable improvement proposals for strategies, gates, or the orchestrator itself |

## Scope

**In:** Single-project `/build` orchestrator, 8-phase lifecycle, UI-driven dashboard as primary interface, conversational human gates with discuss-then-decide flow, checkpoint/resume, failure routing, cost tracking, validation against machine-evaluable criteria, evidence reporting, per-build refinements, cross-build analytics, validation experiment.

**Out:** Cross-project orchestration (Genesis), CI/CD headless endpoint (future), custom user-defined strategy DAGs, modification of existing FCD strategies.

---

## The 8-Phase Lifecycle

```
/build "I want rate limiting on the API gateway with per-tenant quotas"
```

| Phase | Name | Driver | Human Gate | Output |
|-------|------|--------|------------|--------|
| 1 | **Explore** | SPL explore + optional /fcd-debate | None (autonomous) | ExplorationReport |
| 2 | **Specify** | Conversational (UI chat) | Discuss + approve spec | FeatureSpec with TestableAssertions |
| 3 | **Design** | s-fcd-design + s-fcd-surface | Discuss + approve PRD | PRD with frozen surfaces |
| 4 | **Plan** | s-fcd-plan | Discuss + approve plan | realize-plan.md + commission cards |
| 5 | **Implement** | s-fcd-commission-orch | None (autonomous, escalates on failure) | Committed code |
| 6 | **Review** | s-fcd-review (6 advisors) | Discuss + approve verdict | Approved code |
| 7 | **Validate** | Validator engine | None (autonomous) | ValidationReport |
| 8 | **Measure** | Refinement engine | None (autonomous) | EvidenceReport + Refinements |

Every phase saves a checkpoint. The pipeline is resumable from any checkpoint after crashes, restarts, or deliberate pauses.

### Phase 1: Explore

The orchestrator uses SPL `explore` (semantic strategy node, PRD 046) to understand the codebase before committing to a design direction.

**Actions:**
- Identify affected domains by running `explore` with the requirement as query
- Read existing patterns, port interfaces, and test coverage in those domains
- If 3+ viable approaches exist: automatically spawn a `/fcd-debate` council to resolve

**Debate integration:** The orchestrator detects debate triggers from the exploration output:
- Multiple viable architectures (3+ approaches with non-obvious tradeoffs)
- Cross-domain boundary decisions (where to place new ports)
- Irreversible structural choices (new domain vs extend existing)

When a debate is triggered, the dashboard renders the debate as a collapsible card in the conversation panel showing: the question, the cast, the decision, and the surface implications. The human can also **manually trigger a debate** at any point during Phases 1-3 via the [Debate] button in the conversation panel.

**Output:** `ExplorationReport` — affected domains, existing patterns, constraints, recommended approach (or debate decision).

**UI:** The dashboard shows the exploration summary as a card with domain tags, pattern highlights, and the debate decision if one was spawned. The human sees this as context before Phase 2.

### Phase 2: Specify

The orchestrator drives a **conversational specification session** through the dashboard chat panel.

**Conversation flow:**
1. Agent presents exploration findings with structured summary
2. Agent proposes a problem statement — human discusses and refines
3. Agent proposes success criteria — human discusses, adds, removes, adjusts
4. Agent proposes scope — human confirms boundaries
5. Agent presents the complete FeatureSpec — human approves or requests changes

**Critical requirement:** Success criteria must be machine-evaluable (`TestableAssertion` type). The orchestrator guides the human:

| Good (machine-evaluable) | Bad (subjective) |
|--------------------------|-------------------|
| "All existing tests pass" | "Code is clean" |
| "New endpoint returns 200 with valid JSON" | "API is well-designed" |
| "No new `any` types in port files" | "TypeScript usage is good" |
| "tsc --noEmit produces zero errors" | "No type issues" |

If the human proposes a vague criterion, the orchestrator asks: "I can't test 'clean code' — can you rephrase as a specific check? For example: 'no TODO/FIXME markers' or 'all functions have return types'."

**Output:** `FeatureSpec { requirement, problem, criteria: TestableAssertion[], scope, constraints }`

**UI:** Chat panel shows the full conversation. The FeatureSpec renders as an interactive card where criteria can be edited inline. Two buttons: [Send message] and [Approve Spec].

### Phase 3: Design

Drives `s-fcd-design` with the FeatureSpec as input.

**New capability:** When the design strategy identifies complex surfaces (> 10 methods, breaking changes, novel patterns), the orchestrator detects this and drives `s-fcd-surface` sessions. The design phase pauses until co-design completes.

**Human gate:** The orchestrator presents the PRD and surface definitions in the chat panel. The human can discuss, request changes, or approve. The dashboard renders the domain map and surface table visually.

**Output:** PRD with frozen surfaces.

### Phase 4: Plan

Drives `s-fcd-plan`.

**Human gate:** The orchestrator presents the commission breakdown and wave structure in the chat panel. The dashboard renders a visual DAG of commissions with dependencies. The human can discuss concerns (e.g., "why 5 commissions? can C-3 and C-4 be merged?") before approving.

**Output:** realize-plan.md + commission cards.

### Phase 5: Implement

Drives `s-fcd-commission-orch`. Parallel commission execution.

**Failure routing (key differentiator):**
1. Read strategy execution status (gate failures, retry feedback)
2. Identify which commission(s) failed and why
3. Construct targeted retry prompt with the failure context
4. Re-execute only the failed commission(s), not the entire pipeline
5. If retry fails again → escalate to human via chat panel with full context

**No human gate** in the happy path. On escalation, the chat panel shows the failure, the agent's analysis, and proposed next steps. The human can discuss and direct.

**On-demand review:** The human can request a targeted review of any individual commission's output at any time during or after implementation via the [Review] skill button. This spawns `s-fcd-review` scoped to just that commission's code, without waiting for Phase 6. The review findings render in the conversation panel. This is optional — Phase 6 runs the full review regardless.

**UI:** The dashboard shows commission progress bars with real-time status as Cursor-style task cards (commission name, current activity, gate progress). Failed commissions show the gate failure and retry status. The failure recovery card explains what the orchestrator tried and why. Each commission card has a contextual [Retry] button (GitHub Actions pattern — per-commission, not per-phase).

### Phase 6: Review

Drives `s-fcd-review` (6 parallel advisors).

**Review loop:** If REQUEST_CHANGES, the orchestrator:
1. Parses findings by domain/commission
2. Routes each finding to the relevant commission as a fix task
3. Re-executes only affected commissions
4. Re-runs review
5. Max 2 implement→review cycles, then escalate

**Human gate:** The orchestrator presents review findings in the chat panel, organized by severity (Fix-Now / Fix-Soon / Suggestion). The dashboard renders findings as a sortable table. The human can discuss individual findings, override severity, or approve. Three options: [Approve] [Approve with Comments] [Request Changes (manual)].

### Phase 7: Validate

Evaluates the shipped code against the success criteria from Phase 2.

**Actions:**
1. Run `npm run build` — build must pass
2. Run `npm test` — all tests must pass
3. For each `TestableAssertion` in the FeatureSpec:
   - `command` → run shell command, check exit code
   - `grep` → search files for pattern, check presence/absence
   - `endpoint` → HTTP request, check status code and response
   - `typescript` → run tsc --noEmit, check zero errors
   - `custom` → run provided script, check output

If criteria fail, the orchestrator can route back to implement (max 1 validate→implement cycle).

**Integration test option:** The orchestrator can optionally invoke `s-fcd-integration-test` for deeper cross-domain validation beyond individual assertions. The human can trigger this via the [Review] skill button during Phase 7.

**UI:** The Success Criteria Tracker lights up in real-time as each criterion is evaluated — green check or red X with evidence.

**Output:** `ValidationReport { criteria: { name, type, passed, evidence }[] }`

### Phase 8: Measure + Reflect

Produces the evidence report AND per-build refinements.

**Evidence report:**
```typescript
interface EvidenceReport {
  readonly requirement: string;
  readonly phases: PhaseResult[];
  readonly validation: {
    readonly criteriaTotal: number;
    readonly criteriaPassed: number;
    readonly criteriaFailed: number;
    readonly details: { name: string; passed: boolean; evidence: string }[];
  };
  readonly delivery: {
    readonly totalCost: { tokens: number; usd: number };
    readonly orchestratorCost: { tokens: number; usd: number };
    readonly overheadPercent: number;
    readonly wallClockMs: number;
    readonly humanInterventions: number;
    readonly failureRecoveries: { attempted: number; succeeded: number };
  };
  readonly verdict: "fully_validated" | "partially_validated" | "validation_failed";
  readonly artifacts: Record<string, string>;
  readonly refinements: Refinement[];
}
```

**Refinement engine:** The orchestrator reflects on its own execution to produce improvement proposals:

```typescript
interface Refinement {
  readonly target: "product" | "strategy" | "gate" | "bridge" | "pacta" | "orchestrator";
  readonly observation: string;  // what happened
  readonly proposal: string;     // what to change
  readonly evidence: string;     // specific data supporting this
  readonly frequency?: number;   // how often seen (populated by cross-build analytics)
}
```

Per-build: the orchestrator asks itself: which phases were slow, which retries worked, which tools were missing, which criteria were hard to evaluate?

**UI:** The evidence report renders as a visual card with verdict badge, cost breakdown, criteria pass/fail, and a refinements list. The refinements are categorized by target (strategy, gate, bridge, etc.) and actionable.

---

## Human Interaction Model

### UI-First, Conversational

The **bridge dashboard** is the primary interface. Claude Code sessions can also trigger `/build` and interact via the terminal, but the dashboard is designed for comprehension and deliberation.

### The Conversation Panel

Every human gate opens a **chat thread** in the dashboard's right panel. The conversation has three participant types:

- **Build Agent** (the orchestrator) — presents findings, proposes specs, asks questions
- **Human** — discusses, adds ideas, requests changes, approves/rejects
- **System** — phase transitions, checkpoint notifications, strategy status updates

The chat supports:
- **Rich cards** — FeatureSpec, PRD summary, commission plan, review findings render as structured cards within the chat, not plain text
- **Inline editing** — success criteria, scope, and constraints can be edited directly within their cards
- **Action buttons** — each gate has specific actions (Approve Spec, Approve Plan, Accept Review, etc.) alongside the message input
- **Message threading** — the human can reply to a specific agent message to address a specific point
- **History** — all conversations are persisted and readable after the build completes

### Gate Interaction Pattern

At every human gate, the same 3-step pattern:

1. **Present** — the orchestrator shows what it did and what it proposes, with full context rendered visually
2. **Discuss** — the human asks questions, suggests changes, adds ideas. The orchestrator responds, updates proposals, explains tradeoffs
3. **Decide** — when the human is satisfied, they click the gate action button (Approve/Reject/Adjust)

The discuss step has no turn limit. The human takes as long as they need. The orchestrator doesn't rush — it responds to every message substantively.

### Autonomy Levels

The human selects an autonomy level per-build via a dashboard dropdown:

| Level | Behavior | Use case |
|-------|----------|----------|
| **Discuss All** (default) | All 4 gates require discuss-then-approve | Novel work, unfamiliar domains, first builds |
| **Auto-Routine** | Gates auto-approve when orchestrator confidence > 0.85 (based on similarity to past successful builds). Human gets a notification and 30s to intervene. | Routine work, well-trodden patterns |
| **Full Auto** | All gates auto-approve. Human only sees the final EvidenceReport. | Batch operations, trusted pipelines, CI/CD mode |

In Auto-Routine mode, the orchestrator calculates confidence per gate by comparing the current build's FeatureSpec, domain count, and commission structure to past builds. If the pattern is novel, it falls back to Discuss All for that gate.

### On-Demand Skill Invocation

The conversation panel includes skill buttons: **[Debate]** **[Review]** **[Surface]**. These let the human invoke optional FCD skills at any point during the pipeline:

| Button | Invokes | When useful |
|--------|---------|------------|
| **Debate** | `/fcd-debate` council | Phases 1-3: resolve competing approaches, surface co-design disagreements |
| **Review** | `/fcd-review` (targeted) | Phases 5-7: review a specific commission's output before the full Phase 6 review |
| **Surface** | `/fcd-surface` co-design | Phase 3: explicitly co-design a complex surface instead of relying on auto-detection |

The skill invocation pauses the pipeline, runs the skill, and resumes with the results. The skill output renders in the conversation panel as a collapsible card (debate decision, review findings, surface record).

### What the Human Sees at Each Gate

| Gate | Agent Presents | Human Can | Actions |
|------|---------------|-----------|---------|
| **Specify** | Exploration summary, proposed problem statement, draft criteria, scope | Refine criteria, add/remove assertions, adjust scope, ask about codebase context | [Approve Spec] |
| **Design** | PRD summary, domain map visual, surface table, architecture decisions | Question surface choices, suggest alternatives, request simpler decomposition | [Approve Design] |
| **Plan** | Commission DAG visual, wave structure, estimated scope per commission | Merge/split commissions, adjust wave ordering, question dependencies | [Approve Plan] |
| **Review** | Findings by severity, code diff links, agent's recommendation | Override severity, discuss individual findings, request specific fixes | [Approve] [Request Changes] |
| **Escalation** | Failure context, what was tried, why it failed, proposed next steps | Direct the orchestrator, provide manual fix, adjust criteria, abort | [Retry with Direction] [Fix Manually] [Abort] |

---

## Dashboard Architecture

### Builds View (`/app/builds`)

New top-level route in the bridge dashboard, alongside Sessions, Strategies, Triggers.

**Left sidebar — Build List:**
- Active builds with **mini pipeline strip** — 8 tiny dots (6px, colored by phase status) giving glanceable progress at a glance (GitLab pattern)
- Status dots: green (completed), blue (running), amber pulsing (waiting for human), red (failed)
- Cost label and current phase name
- **"+ New Build"** button in header opens a modal with requirement input
- Click to select and show detail

**Persistent Context Bar** (Dify Variable Inspect pattern):
Sticky bar at the top of the main content area, always visible regardless of active tab:
- Requirement text (truncated with tooltip for full text)
- Current phase pill (colored)
- Cost accumulator with mini progress bar ($X / $Y budget)
- Commission status summary (e.g., "2/3 done")
- Autonomy level indicator
- **[Pause]** **[Abort]** controls (or **[Resume]** for paused builds)

**Main area — Build Detail (tabbed):**

Tab 1: **Overview**
- Phase timeline — 8 horizontal pills showing completed/current/waiting/future status
- **Gantt timeline** (Temporal pattern) — horizontal bar chart showing phase durations, parallel commission stacking in Phase 5, and amber gaps for human wait times. Hoverable for exact timestamps, duration, and cost per phase.
- Current phase card — Cursor-style task cards: commission name, current activity description, gate progress, contextual [Retry] button per commission
- Failure recovery log — every failure and recovery attempt with reasoning
- Budget bar — current spend vs budget limit
- Success Criteria Tracker — criteria from Phase 2, lights up during Phase 7

Tab 2: **Artifacts**
- Phase-by-phase artifact list — ExplorationReport, FeatureSpec, PRD, plan, code diffs, review findings, evidence report
- Each artifact renderable inline (markdown/YAML viewer)
- **Artifact versioning** (Claude Artifacts pattern) — when a FeatureSpec or PRD is refined through conversation, show version history: v1 (proposed) → v2 (after discussion) → v3 (approved)
- Code diffs link to the actual files with line counts (+135 -21)

Tab 3: **Events**
- Full event stream filtered to this build
- Filter buttons: All, Failures, Gates, System
- Filterable by severity, phase, type
- Each event expandable for detail

Tab 4: **Analytics** (visible for completed builds and cross-build)
- Per-build: phase durations, cost breakdown, retry count
- Cross-build (when viewing build list): failure patterns, phase bottlenecks, method refinements
- Cost trend sparkline across last N builds
- Criteria coverage stats (avg criteria per build, pass rate trend)
- Refinement filtering by target: [All] [Strategy] [Gate] [Orchestrator] [Bridge]

**Right panel — Conversation:**
- Tabbed by active gates (one tab per build with a pending gate)
- Full chat history for completed builds (read-only)
- Rich card rendering for structured data (FeatureSpec, PRD summary, commission DAG, review findings, debate decisions)
- **Message threading** — reply button on agent messages, replies render with left border connecting to parent
- **Per-gate action buttons** — buttons change based on current gate type (see GATE_ACTIONS)
- **Skill invocation buttons** — [Debate] [Review] [Surface] row above message input
- **System messages** — gray/neutral messages for phase transitions, checkpoints, strategy status
- **Inline editing** — spec cards have edit mode for criteria, scope, constraints
- Collapsible (toggle button)

### Progressive Disclosure (3 Tiers)

The dashboard implements Temporal's three-tier model:

| Tier | View | Use case |
|------|------|----------|
| **1. Glanceable** | Mini pipeline strip (8 dots in sidebar) + context bar | Checking status while doing other work |
| **2. Detailed** | Overview tab: phase timeline, Gantt chart, commission cards, criteria tracker | Understanding progress, reviewing gate presentations |
| **3. Deep** | Events tab + artifact versions + conversation history | Post-mortem debugging, understanding agent reasoning |

90% of the time, Tier 1 is sufficient. The human drills into Tier 2 at gates and Tier 3 only for debugging.

### Keyboard Shortcuts

Cmd+K (or Ctrl+K) opens a command palette (Linear pattern):

| Shortcut | Action |
|----------|--------|
| `Cmd+K` | Open command palette |
| `g 1`-`g 8` | Jump to phase 1-8 |
| `a` | Approve current gate |
| `r` | Reject / request changes |
| `d` | Toggle conversation panel |
| `n` | New build |
| `Esc` | Close palette / cancel |

Command palette supports fuzzy search: "approve", "abort", "cost", "phase 3", etc.

### Color Vocabulary (Temporal pattern)

Consistent across all views — never decorative, only status:

| Color | Meaning | Hex |
|-------|---------|-----|
| Green | Completed / passed | #10b981 |
| Blue | Running / in-progress | #3b82f6 |
| Amber | Waiting / human gate / retrying | #f59e0b |
| Red | Failed / error | #ef4444 |
| Purple | Primary accent / interactive | #6d5aed |
| Gray | Pending / future / disabled | #64748b |

### Evidence Report View

When a completed build is selected, the Overview tab shows the evidence report as a visual card:
- Verdict badge (FULLY VALIDATED / PARTIALLY VALIDATED / FAILED)
- 5-stat grid: total cost, overhead %, interventions, duration, failure recoveries
- Criteria pass/fail checklist with evidence snippets
- Refinements list categorized by target

### Cross-Build Analytics

When no specific build is selected (or on the Analytics tab):
- **Phase bottleneck chart** — avg time per phase across N builds, horizontal bars
- **Failure pattern table** — which gates fail most, with frequency and example
- **Method refinements** — aggregated proposals ranked by frequency × confidence:
  - `[strategy]` "Strengthen type constraints in implement prompt" (4/10 builds)
  - `[gate]` "G-NO-ANY misses nested generics" (3/10 builds)
  - `[orchestrator]` "Skip design for trivial features" (3/10 builds)
- **Cost trend** — avg cost per build over time
- **Criteria coverage** — how many criteria per build, pass rate trend

Refinements feed into: steering council agenda, experiments backlog, strategy YAML edits, future PRDs.

---

## Domain Map

```
bridge/build ──→ bridge/sessions     (spawn orchestrator agent — existing SessionPort)
bridge/build ──→ bridge/strategies   (execute FCD strategies — existing MCP tools)
bridge/build ──→ event-bus           (emit build lifecycle events — existing EventSink)
bridge/build ──→ filesystem          (checkpoint persistence — NEW CheckpointPort)
bridge/build ──→ SPL explore         (codebase exploration — existing semantic node, PRD 046)
bridge/build ──→ bridge/build-ui     (conversation + gate state — NEW ConversationPort)
pacta          ──→ bridge/build      (pact definition consumed by build domain)
bridge/build-ui ──→ event-bus        (subscribe to build events — existing WebSocket)
```

Relationship to Genesis: Genesis observes BuildOrchestrator's events via the event bus (build.phase_started, build.failure_detected, etc.). Genesis does not drive or participate in builds. They are complementary: Genesis is infrastructure (persistent observer), BuildOrchestrator is user intent (ephemeral executor).

---

## Surfaces (Primary Deliverable)

### CheckpointPort

Owner: bridge/build | Direction: build → filesystem | Status: **frozen**

```typescript
export interface CheckpointPort {
  save(sessionId: string, checkpoint: PipelineCheckpoint): Promise<void>;
  load(sessionId: string): Promise<PipelineCheckpoint | null>;
  list(): Promise<PipelineCheckpointSummary[]>;
}

export interface PipelineCheckpointSummary {
  readonly sessionId: string;
  readonly phase: Phase;
  readonly requirement: string;
  readonly costAccumulator: { tokens: number; usd: number };
  readonly savedAt: string;
}

export interface PipelineCheckpoint {
  readonly sessionId: string;
  readonly phase: Phase;
  readonly completedStrategies: readonly string[];
  readonly artifactManifest: Record<string, string>;
  readonly featureSpec?: FeatureSpec;
  readonly costAccumulator: { tokens: number; usd: number };
  readonly conversationHistory: readonly ConversationMessage[];
  readonly savedAt: string;
}

export type Phase = "explore" | "specify" | "design" | "plan" | "implement" | "review" | "validate" | "measure" | "completed";

export interface FeatureSpec {
  readonly requirement: string;
  readonly problem: string;
  readonly criteria: readonly TestableAssertion[];
  readonly scope: { in: string[]; out: string[] };
  readonly constraints: string[];
}

export interface TestableAssertion {
  readonly name: string;
  readonly type: "command" | "grep" | "endpoint" | "typescript" | "custom";
  readonly check: string;
  readonly expect: string;
}
```

Gate: G-BOUNDARY.

### ConversationPort

Owner: bridge/build | Direction: build ↔ build-ui | Status: **frozen**

```typescript
export interface ConversationPort {
  /** Send a message from the orchestrator to the human (renders in chat panel). */
  sendAgentMessage(buildId: string, message: AgentMessage): Promise<void>;
  /** Send a system notification (phase transition, checkpoint, status). */
  sendSystemMessage(buildId: string, message: string): Promise<void>;
  /** Wait for the human to respond (blocks until message received via UI). */
  waitForHumanMessage(buildId: string): Promise<HumanMessage>;
  /** Wait for a gate decision (blocks until approve/reject via UI). */
  waitForGateDecision(buildId: string, gate: GateType): Promise<GateDecision>;
  /** Get full conversation history for a build. */
  getHistory(buildId: string): Promise<ConversationMessage[]>;
  /** Human requests an optional skill invocation mid-pipeline. */
  requestSkillInvocation(buildId: string, skill: SkillRequest): Promise<void>;
}

export type SkillRequest =
  | { type: "debate"; context: string }   // spawn /fcd-debate council
  | { type: "review"; commissionId?: string; context: string }  // targeted /fcd-review
  | { type: "surface"; domains: [string, string]; description: string };  // /fcd-surface session

export interface AgentMessage {
  readonly type: "text" | "card" | "artifact";
  readonly content: string;
  readonly card?: StructuredCard; // FeatureSpec, PRD summary, review findings, etc.
  readonly replyTo?: string; // message ID for threading
}

export interface HumanMessage {
  readonly content: string;
  readonly replyTo?: string;
}

export interface GateDecision {
  readonly gate: GateType;
  readonly decision: "approve" | "reject" | "adjust";
  readonly feedback?: string;
  readonly adjustments?: Record<string, unknown>;
}

export type GateType = "specify" | "design" | "plan" | "review" | "escalation";

/** Per-gate action sets rendered by the UI. */
export const GATE_ACTIONS: Record<GateType, string[]> = {
  specify: ["Approve Spec"],
  design: ["Approve Design"],
  plan: ["Approve Plan"],
  review: ["Approve", "Approve with Comments", "Request Changes"],
  escalation: ["Retry with Direction", "Fix Manually", "Abort"],
};

export interface StructuredCard {
  readonly type: "feature-spec" | "prd-summary" | "commission-plan" | "review-findings" | "evidence-report";
  readonly data: Record<string, unknown>;
}
```

Gate: G-BOUNDARY — build domain uses ConversationPort, never directly accesses WebSocket.

### BuildOrchestratorPact

Owner: pacta (type) + bridge/build (instantiation) | Status: **frozen**

```typescript
export const buildOrchestratorPact: Pact = {
  name: "build-orchestrator",
  execution: { mode: "resumable" },
  budget: {
    maxTokens: 300_000,
    maxCostUsd: 5.0,
    maxDurationMs: 7_200_000,
  },
  scope: {
    allowedTools: [
      "strategy_execute", "strategy_status", "strategy_abort",
      "project_get", "project_list",
      "Read", "Glob", "Grep", "Bash",
    ],
  },
  output: { schema: EvidenceReportSchema },
  reasoning: { strategy: "react" },
};
```

Gate: G-PORT.

### BuildUIRoutes

Owner: bridge/build-ui | Consumer: dashboard frontend | Status: **frozen**

```typescript
// REST API for the dashboard
GET  /api/builds                          // List all builds (active + recent)
GET  /api/builds/:id                      // Build detail (phase, cost, artifacts)
GET  /api/builds/:id/conversation         // Full conversation history
POST /api/builds/:id/message              // Human sends a message in the chat
POST /api/builds/:id/gate/:gate/decide    // Human makes a gate decision
POST /api/builds/start                    // Start a new build
POST /api/builds/:id/abort               // Abort a build
POST /api/builds/:id/resume              // Resume from checkpoint
GET  /api/builds/analytics               // Cross-build analytics data
GET  /api/builds/:id/evidence            // Evidence report for a completed build

// WebSocket events (build.* domain)
build.started
build.phase_started     { phase, strategyId? }
build.phase_completed   { phase, cost, duration }
build.checkpoint_saved
build.exploration_complete
build.spec_proposed     { featureSpec }  // triggers UI to show spec card
build.gate_waiting      { gate, context }  // triggers UI to show gate panel
build.gate_resolved     { gate, decision }
build.agent_message     { message }  // new chat message from orchestrator
build.failure_detected  { phase, commission?, gate?, detail }
build.failure_recovery  { phase, strategy, succeeded }
build.validation_result { criterion, passed, evidence }
build.completed         { verdict, cost, criteria, refinements }
build.aborted
```

Gate: G-BOUNDARY.

### Surface Summary

| Surface | Owner | Direction | Status | Gate |
|---------|-------|-----------|--------|------|
| CheckpointPort | bridge/build | build → fs | **frozen** | G-BOUNDARY |
| ConversationPort | bridge/build | build ↔ build-ui | **frozen** | G-BOUNDARY |
| BuildOrchestratorPact | pacta + build | build → pacta | **frozen** | G-PORT |
| BuildUIRoutes | bridge/build-ui | build-ui → dashboard | **frozen** | G-BOUNDARY |
| SessionPort | bridge/sessions | build → sessions | existing | — |
| EventSink | event-bus | build → bus | existing | — |
| Strategy MCP tools | bridge/strategies | build → strategies | existing | — |
| SemanticNodeExecutor | semantic | build → explore | existing (PRD 046) | — |

---

## Per-Domain Architecture

### bridge/build (backend)

```
src/domains/build/
  index.ts              — domain registration
  types.ts              — PipelineCheckpoint, FeatureSpec, TestableAssertion,
                          ExplorationReport, ValidationReport, EvidenceReport,
                          Refinement, PhaseResult, ConversationMessage, BuildConfig
  config.ts             — Zod schema (budget defaults, phase timeouts, retry limits,
                          review loop limit, validate→implement loop limit)
  orchestrator.ts       — BuildOrchestrator: 8-phase loop + failure routing + refinement
  checkpoint-adapter.ts — CheckpointPort impl (YAML in .method/sessions/{id}/checkpoints/)
  conversation-adapter.ts — ConversationPort impl (WebSocket + REST + persistence)
  validator.ts          — Evaluates TestableAssertion[] against live system
  refinement.ts         — Per-build reflection + cross-build aggregation
  routes.ts             — REST API endpoints (BuildUIRoutes)
  __tests__/
    orchestrator.test.ts
    checkpoint.test.ts
    validator.test.ts
    conversation.test.ts
    refinement.test.ts
```

Layer: L4 (bridge application domain).

### bridge/build-ui (frontend)

Extends the existing bridge dashboard (React SPA at `/app/`):

```
src/domains/build-ui/   (or integrated into existing dashboard source)
  BuildsPage.tsx         — top-level builds route
  BuildList.tsx          — left sidebar, build selection
  BuildDetail.tsx        — main area, tabbed (Overview, Artifacts, Events, Analytics)
  PhaseTimeline.tsx      — 8-phase horizontal timeline component
  CommissionProgress.tsx — parallel commission status bars
  CriteriaTracker.tsx    — success criteria pass/fail checklist
  ConversationPanel.tsx  — right panel chat interface
  ChatMessage.tsx        — individual message (agent/human/system)
  StructuredCard.tsx     — rich card renderer (spec, plan, findings, evidence)
  EvidenceReport.tsx     — evidence report visual card
  AnalyticsView.tsx      — cross-build charts and refinements
  GateActions.tsx        — approve/reject/adjust buttons per gate type
```

---

## Build Event Types

```typescript
type BuildEventType =
  | "build.started"
  | "build.phase_started"
  | "build.phase_completed"
  | "build.checkpoint_saved"
  | "build.exploration_complete"
  | "build.spec_proposed"
  | "build.gate_waiting"
  | "build.gate_resolved"
  | "build.agent_message"
  | "build.surface_codesign"
  | "build.failure_detected"
  | "build.failure_recovery"
  | "build.human_intervention"
  | "build.validation_result"
  | "build.completed"
  | "build.aborted"
  | "build.metric"
  | "build.refinement";
```

---

## Upstream Dependencies & Fallbacks

Three capabilities the orchestrator needs from existing skills that aren't fully available yet:

| Dependency | Needed by | Current state | Fallback |
|-----------|-----------|---------------|----------|
| **Surface complexity detection** | Phase 3 (auto-trigger `/fcd-surface`) | s-fcd-design doesn't output a complexity signal | MVP: human triggers surface co-design via [Surface] button. Wave 2: add `surface_complexity` field to design strategy output. |
| **Structured failure metadata** | Phase 5 (targeted retry with context) | s-fcd-commission-solo returns pass/fail, not structured gate failure details | MVP: orchestrator reads strategy execution status via `strategy_status` MCP tool (includes gate results). Wave 2: commission returns `RetryContext { gate, failures[], codeSnippet }`. |
| **Commission-tagged review findings** | Phase 6 (route findings to specific commissions) | s-fcd-review findings are unified, not tagged by commission | MVP: orchestrator uses domain names in findings to guess commission mapping. Wave 2: review strategy tags findings with commission IDs when reviewing multi-commission output. |

These fallbacks ensure the orchestrator works at Wave 1 (MVP) while the upstream skills evolve. The gap between fallback and full capability is a priority for Wave 2.

## FCD Skill Integration Matrix

| Skill | Phase(s) | Trigger | Notes |
|-------|---------|---------|-------|
| `s-fcd-design` | 3 | AUTO | Primary design driver |
| `s-fcd-plan` | 4 | AUTO | Decomposes PRD into commissions |
| `s-fcd-commission-orch` | 5 | AUTO | Parallel commission execution |
| `s-fcd-commission-solo` | 5 | AUTO (via orch) | Individual commission implementation |
| `s-fcd-review` | 6 | AUTO | Full review; also OPTIONAL per-commission on-demand |
| `s-fcd-surface` | 3 | SUB (conditional) or OPTIONAL (human-triggered) | Complex surface co-design |
| `s-fcd-card` | 4 | OPTIONAL | Human can request per-commission component cards |
| `s-fcd-integration-test` | 7 | OPTIONAL | Deeper cross-domain validation |
| `/fcd-debate` | 1, 2, 3 | AUTO (if 3+ approaches) or OPTIONAL (human-triggered) | Council for architectural decisions |

## Validation Experiment

### Hypothesis

H1: `/build` covers all 8 lifecycle phases end-to-end without manual skill invocations.
H2: `/build` reduces human interventions from ≥ 10 to ≤ 4 for a 3-commission feature.
H3: `/build` autonomously recovers from ≥ 60% of commission gate failures.
H4: Orchestrator overhead is ≤ 15% of total pipeline token cost.
H5: Every `/build` run produces a validation report with machine-evaluated success criteria.
H6: At human gates, the dashboard provides sufficient context for informed decisions (subjective, surveyed post-build).
H7: After 5+ builds, the refinement engine surfaces ≥ 3 actionable improvement proposals.

### Protocol

**Design:** Matched-pair A/B. 3 features of similar complexity (3 commissions, 2 domains each). Each feature is delivered under both conditions.

**Condition A (baseline):** Human drives the full lifecycle manually:
- Explore codebase → formulate requirements → `/realize` → wait → monitor → handle failures → `/fcd-review` → handle findings → run tests → assess value subjectively
- Human logs: every action, timestamp, decision, failure diagnosis

**Condition B (treatment):** `/build` drives via dashboard:
- Start build from dashboard → discuss + approve spec → discuss + approve plan → discuss + approve review → read EvidenceReport
- Orchestrator logs: every phase, decision, failure recovery, conversation (via build.* events)

**Metrics:**

| Metric | Source | SC |
|--------|--------|----|
| Phase coverage | Phases completed autonomously | SC-1 |
| Human interventions | Manual count (A) / build.human_intervention events (B) | SC-2 |
| Failure recovery rate | 0% manual (A) / build.failure_recovery events (B) | SC-3 |
| Total token cost | Strategy execution cost summaries | SC-4 |
| Orchestrator token cost | BuildOrchestrator session usage | SC-4 |
| Validation coverage | Criteria defined (A: 0 formal) / criteria evaluated (B) | SC-5 |
| Comprehension survey | Post-build questionnaire (1-5 scale on decision quality) | SC-6 |
| Refinement count | refinements[] in EvidenceReports after 5 builds | SC-7 |

**Success threshold:**
- SC-1: All 8 phases execute for all 3 features
- SC-2: Condition B interventions ≤ 4 for all 3 features
- SC-3: ≥ 2 of 3 features have at least one autonomous failure recovery
- SC-4: Orchestrator cost / total cost ≤ 0.15 for all 3 features
- SC-5: All 3 features produce ValidationReport with ≥ 3 criteria each
- SC-6: Average comprehension score ≥ 4/5 across gates
- SC-7: After 5 builds, ≥ 3 unique refinements surfaced in analytics

---

## Phase Plan

| Wave | Content | Acceptance |
|------|---------|------------|
| **0** | Surfaces: types.ts (all types), config.ts, ports/checkpoint.ts, ports/conversation.ts, pact definition, gate assertions | tsc clean, gate tests pass |
| **1** | Core backend: orchestrator.ts (8-phase loop), checkpoint-adapter.ts, validator.ts, refinement.ts, unit tests | Orchestrator drives mock 8-phase pipeline with simulated failures. Validator evaluates 5 assertion types. Refinement engine produces proposals. Tests pass. |
| **2** | Backend integration: conversation-adapter.ts, routes.ts, index.ts, server-entry wiring, event emission | Bridge starts with build domain. REST API responds. WebSocket events flow. |
| **3** | Dashboard UI: BuildsPage, BuildList, BuildDetail, PhaseTimeline, CommissionProgress, CriteriaTracker, EvidenceReport | Dashboard renders builds with phase timelines, criteria trackers, evidence reports. Static data first. |
| **4** | Conversation UI: ConversationPanel, ChatMessage, StructuredCard, GateActions + WebSocket wiring | Chat panel renders agent messages, human can type and send, gate actions work, spec/plan/review cards render inline. |
| **5** | Analytics UI: AnalyticsView, cross-build aggregation, refinement display | Analytics tab shows phase bottlenecks, failure patterns, method refinements across completed builds. |
| **6** | Integration + /build skill: agent init prompt, `/build` skill definition, full end-to-end integration test | `/build "add hello world endpoint"` completes all 8 phases on test fixture. Dashboard shows progress, conversation, evidence. |
| **7** | Validation: experiment setup, run 3 matched features under both conditions, run 5 builds for refinement testing | Directional evidence on SC-1 through SC-7. Results in experiments/log/. |

---

## Risks

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Orchestrator costs exceed 15% with 8 phases | Medium | SC-4 fails | Phases 1-2 lightweight, 7-8 mostly Bash. Budget 300K tokens carefully. |
| Explore phase too shallow | Medium | SC-1 questioned | SPL explore is recursive and proven. Adjust depth by complexity. |
| Success criteria too vague | High | SC-5 fails | Phase 2 actively guides toward testable criteria. Rejects what it can't check. |
| Dashboard too complex for Wave 3-5 | Medium | Delivery delays | Incremental: static data first (Wave 3), then WebSocket (Wave 4), then analytics (Wave 5). |
| Conversation port latency | Low | UX feels laggy | WebSocket for real-time messages. REST only for history/persistence. |
| Human never reads the conversation | Medium | SC-6 fails | Rich cards with visual summaries reduce reading burden. Gate buttons are prominent. |
| Refinement engine produces noise | Medium | SC-7 questioned | Threshold: only surface refinements seen in ≥ 2 builds with confidence ≥ 0.7. |
| Review→implement loop diverges | Low | Pipeline stalls | Hard limit: 2 cycles then escalate. |
| Checkpoint misses conversation | Medium | Resume loses context | ConversationHistory explicitly in PipelineCheckpoint. Roundtrip test in Wave 1. |
