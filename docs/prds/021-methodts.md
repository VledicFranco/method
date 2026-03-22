# PRD 021: MethodTS — Typed Methodology SDK

**Status:** Phase 1a implemented (foundation types ~880 lines); Phase 1b not started (runtime, agent providers, gates, stdlib)
**Owner:** Steering Council
**Methodology:** P2-SD v2.0
**Depends on:** PRD 017 (strategy pipelines), PRD 004 (methodology runtime), F1-FTH (formal theory)
**Complexity:** High — new package, Effect ecosystem adoption, touches theory extensions
**Package:** `@method/methodts` (new)
**Review:** 4-advisor adversarial review completed 2026-03-21. 41 findings, 14 fixes applied. Action plan: `tmp/action-plan-021-methodts-2026-03-21.md`
**Impacts:** PRD 004 (replaced Phase 3), PRD 017 (subsumed Phase 2-3), PRD 015 (subsumed), PRD 006 (extended), PRD 018 (extended — EventBus feeds triggers), PRD 012 (extended — wraps print-mode), PRD 020 (extended — project-scoped execution), PRD 010 (complemented — typed retros), PRD 014 (complemented — typed scope), PRD 008 (unchanged — richer events via hook)

---

## 1. Problem Statement

**Current state:**
- Methodology execution is token-heavy. An agent reads ~2,000 lines of YAML to find a 3-line routing table. An orchestrator spends ~800 tokens composing a sub-agent commission that is structurally identical to every prior commission it wrote. A reviewer re-derives predicate evaluation logic from scratch every session.
- Methodology definitions are stringly-typed YAML. Preconditions, postconditions, and guidance are natural language strings. Composition errors surface at runtime as confused agent behavior, not at compile time as type errors.
- Routing decisions (δ_Φ evaluation) happen inside the agent's context window. The agent reads the full transition function, reasons through each arm, and produces a selection — a deterministic computation performed stochastically.
- No first-class state tracking. The instantiated sorts of a domain theory have no typed representation. State flows through session objects as untyped records. Transitions are not observable, diffable, or testable in isolation.
- Gates are evaluated either by agents (burning tokens on algorithmic checks) or by sandboxed string expressions (PRD 017). Neither is type-safe or composable.
- No bridge between the formal theory (F1-FTH) and executable TypeScript. The theory describes mathematical objects (domain theories, methods, methodologies) that have no direct TypeScript representation.

**Target users:**
- **Primary: Method designers and project owners** who author methodology definitions in TypeScript. They gain compile-time safety, composable prompts, and deterministic routing — replacing hand-authored YAML with typed, testable definitions.
- **Secondary: Orchestrator runtime code** that calls compiled routing and commission functions programmatically. This code replaces agent reasoning on structural tasks (routing evaluation, prompt composition, gate checking) with zero-token TypeScript execution.
- **Tertiary (Phase 2): Methodology authors** using TLA+ verification to prove safety and liveness properties of their methodology designs.

**User friction:**
- Every methodology session pays the token tax: reading YAML, composing prompts, evaluating predicates, assembling commissions — all deterministic work that could be precomputed.
- Method designers author YAML by hand with no type checking. A missing sort reference, an unreachable routing arm, or a broken composability edge is discovered only when an agent fails at runtime.
- Testing methodology logic requires spawning agents. There is no way to unit test routing, gate evaluation, or step composition without a full MCP + bridge environment.
- Orchestrators cannot mix algorithmic work (deterministic TypeScript) with reasoning work (agent execution) within a single method. Every step is an agent step, even when the work is purely mechanical.

**Opportunity:**
A typed SDK built on the Effect library that:
1. Eliminates the token tax by moving deterministic methodology operations to TypeScript
2. Provides compile-time safety for methodology composition
3. Makes state first-class: tracked, traced, tested, and injected as agent context
4. Enables hybrid methods where algorithmic steps run in TypeScript and reasoning steps run in agents
5. Generates TLA+ specs from methodology definitions for formal verification
6. Bridges the gap between F1-FTH theory and executable code

---

## 2. Library Interface Design

This section sketches the user experience of MethodTS: what the API feels like, how the pieces compose, and what workflows users follow. The code examples are illustrative — they show the intended UX, not the final signatures.

### 2.1 Design Principles

1. **Define, don't configure.** A methodology is a TypeScript value, not a YAML file loaded at runtime. You write it, the compiler checks it, you test it, you run it.
2. **Compose, don't assemble.** Prompts compose with `andThen`. Predicates compose with `and`/`or`. Methods compose with `compose()`. Every layer uses the same algebraic pattern.
3. **Pure by default, effectful when needed.** Prompt, Predicate, DomainTheory, Method, Methodology — all pure. Effect enters only at execution boundaries: gates that touch the world, extractors that read git, agent providers that spawn Claude.
4. **Suspend, don't block.** The runtime yields control at every decision point. The caller decides: continue, provide a value, rerun, swap methodology, or abort. Humans and agents are interchangeable resolvers.
5. **Trace everything.** Every state transition, every gate result, every agent cost, every suspension — recorded in a typed `StateTrace<S>` that can be replayed, diffed, serialized, and compiled to TLA+.

### 2.2 API Surface at a Glance

```typescript
import {
  // Define
  Prompt, constant, sequence, cond, template,
  check, and, or, not, implies, forall, exists, evaluate,
  type DomainTheory, type Role, type Step, type Method, type Methodology, asMethodology,
  type WorldState, type Predicate, type Gate,

  // Execute
  runMethodology, runMethodologyToCompletion, runStrategy,
  ClaudeHeadlessProvider, MockAgentProvider,

  // Validate
  compileMethod, validateAxioms, checkComposability,

  // Instantiate
  instantiate, instantiateMethodology, type ProjectCard,

  // Commission
  commission, batchCommission,

  // stdlib (batteries included)
  P0_META, M1_MDES, D_META, predicates, prompts, compilationGates,
} from "@method/methodts"
```

### 2.3 User Stories

#### Story 1: Define a method and compile it

*"I'm a methodology designer. I want to define a new code review method in TypeScript and verify it's structurally sound before shipping it."*

```typescript
import { check, and, not, type DomainTheory, type Step, type Method, compileMethod } from "@method/methodts"

// 1. Define the domain — what the method operates on
type ReviewState = {
  prNumber: number
  filesChanged: string[]
  findings: Array<{ file: string; line: number; issue: string; severity: "HIGH" | "MEDIUM" | "LOW" }>
  verdict: "pending" | "approve" | "needs_changes" | null
}

const D_REVIEW: DomainTheory<ReviewState> = {
  id: "D_REVIEW",
  signature: {
    sorts: [
      { name: "PullRequest", description: "The PR under review", cardinality: "singleton" },
      { name: "Finding", description: "A review observation", cardinality: "unbounded" },
    ],
    functionSymbols: [
      { name: "severity_of", inputSorts: ["Finding"], outputSort: "Severity", totality: "total" },
    ],
    predicates: {
      has_findings: check("has_findings", (s: ReviewState) => s.findings.length > 0),
      all_cited: check("all_cited", (s: ReviewState) => s.findings.every(f => f.file && f.line > 0)),
    },
  },
  axioms: {
    "Ax-1": check("findings_cited", (s: ReviewState) => s.findings.every(f => f.file && f.line > 0)),
    "Ax-2": check("verdict_consistent", (s: ReviewState) =>
      s.verdict === "approve" ? s.findings.filter(f => f.severity === "HIGH").length === 0 : true
    ),
  },
}

// 2. Define steps
const loadPR: Step<ReviewState> = {
  id: "sigma_0", name: "Load PR", role: "reviewer",
  precondition: check("pr_exists", s => s.prNumber > 0),
  postcondition: check("files_loaded", s => s.filesChanged.length > 0),
  execution: {
    tag: "agent",
    role: "reviewer",
    context: {
      worldReads: [{ key: "pr_diff", extract: (s) => Effect.succeed(`diff for PR #${s.prNumber}`) }],
      domainFacts: { axioms: "all", roleConstraints: true },
    },
    prompt: new Prompt(ctx => `Review PR #${ctx.state.prNumber}. Changed files:\n${ctx.world["pr_diff"]}`),
    parse: (raw, current) => Effect.succeed({ ...current, findings: JSON.parse(raw).findings }),
  },
  suspension: "on_failure",
}

// ... more steps ...

// 3. Assemble the method
const reviewMethod: Method<ReviewState> = {
  id: "M-REVIEW", name: "Code Review",
  domain: D_REVIEW,
  roles: [{ id: "reviewer", description: "Reviews the PR", observe: s => s, authorized: ["sigma_0", "sigma_1"] }],
  dag: { steps: [loadPR, /* ... */], edges: [/* ... */], initial: "sigma_0", terminal: "sigma_2" },
  objective: check("review_complete", s => s.verdict !== null && s.verdict !== "pending"),
  measures: [{ id: "mu_1", name: "findings_count", compute: s => s.findings.length, range: [0, 100], terminal: 0 }],
}

// 4. Compile — runs G1-G6 automatically
const report = compileMethod(reviewMethod, [
  { prNumber: 42, filesChanged: [], findings: [], verdict: null },      // initial state
  { prNumber: 42, filesChanged: ["a.ts"], findings: [{ file: "a.ts", line: 10, issue: "x", severity: "HIGH" }], verdict: "needs_changes" }, // terminal
])

console.log(report.overall) // "compiled" | "failed" | "needs_review"
report.gates.forEach(g => console.log(`${g.gate}: ${g.status}`))
```

#### Story 2: Run a methodology with suspension and human review

*"I'm running a delivery methodology. I want the runtime to pause at review steps so I can inspect the trace and decide whether to continue."*

```typescript
import { runMethodology, ClaudeHeadlessProvider } from "@method/methodts"
import { P2_SD_methodology, type DeliveryState } from "./my-methodology"

const suspended = await pipe(
  runMethodology(P2_SD_methodology, initialState),
  Effect.provide(runtimeLayer),
  Effect.runPromise
)

// The runtime paused — inspect what happened
if ("reason" in suspended) {
  console.log(`Suspended at: ${suspended.position.stepId}`)
  console.log(`Reason: ${suspended.reason.tag}`)
  console.log(`State:`, suspended.state.value)
  console.log(`Trace: ${suspended.trace.snapshots.length} snapshots`)
  console.log(`Cost so far: $${suspended.accumulator.totalCostUsd}`)

  // Decide: continue, provide a fix, rerun, or abort
  const next = await pipe(
    suspended.resume({ tag: "continue" }),
    Effect.runPromise
  )
}
```

#### Story 3: Build a commission for a sub-agent

*"I'm an orchestrator. I need to generate a typed commission prompt for an implementation sub-agent with delivery rules and scope constraints."*

```typescript
import { sequence, constant, Prompt, commission, type Commission } from "@method/methodts"

type TaskContext = { taskId: string; description: string; scope: string[]; rules: string[] }

const implCommission: Prompt<TaskContext> = sequence(
  new Prompt<TaskContext>(ctx => `You are an implementation sub-agent. Task: ${ctx.description}`).section("Role"),
  new Prompt<TaskContext>(ctx => `Files in scope:\n${ctx.scope.map(f => `  - ${f}`).join("\n")}`).section("Scope"),
  new Prompt<TaskContext>(ctx => `Rules:\n${ctx.rules.map((r, i) => `${i + 1}. ${r}`).join("\n")}`).section("Constraints"),
)

// Render for one task
const comm = commission(implCommission, myTask, { workdir: "/project", nickname: `impl-${myTask.taskId}` })
// comm.prompt → full rendered text
// comm.bridge → ready for bridge_spawn

// Render for batch dispatch
const comms = batchCommission(implCommission, tasks, (t, i) => ({
  workdir: "/project", nickname: `impl-${t.taskId}`, isolation: "worktree",
}))
// comms → ready for bridge_spawn_batch
```

#### Story 4: Define a strategy with adaptive control

*"I want a strategy that runs my delivery methodology, and if it fails at the review gate, a human decides whether to fix and retry or switch to a different approach."*

```typescript
import { runStrategy, interactiveController, type StrategyController } from "@method/methodts"

const myStrategy: StrategyController<DeliveryState> = {
  id: "S-DELIVERY",
  name: "Adaptive Delivery",
  methodology: deliveryMethodology,
  gates: [
    scriptGate(check("tests_pass", s => s.testResults.failed === 0)),
    scriptGate(check("review_approved", s => s.reviewVerdict === "approve")),
  ],
  onSuspend: (suspended) => Effect.gen(function* () {
    // Present to human via console/UI/Slack
    console.log(`⏸ Suspended: ${suspended.reason.tag} at ${suspended.position.stepId}`)
    console.log(`  State: ${JSON.stringify(suspended.state.value, null, 2)}`)

    const answer = yield* readUserInput("continue / rerun / abort? ")
    switch (answer) {
      case "continue": return { tag: "continue" }
      case "rerun":    return { tag: "rerun_step" }
      case "abort":    return { tag: "abort", reason: "user decision" }
      default:         return { tag: "continue" }
    }
  }),
  onComplete: (result) => Effect.gen(function* () {
    if (result.status === "completed") return { tag: "done", result }
    console.log(`Methodology failed: ${result.status}. Retry?`)
    const answer = yield* readUserInput("retry / switch / abort? ")
    if (answer === "retry") return { tag: "rerun" }
    if (answer === "switch") return { tag: "switch_methodology", methodology: fallbackMethodology }
    return { tag: "abort", reason: "user decision" }
  }),
  safety: { maxLoops: 5, maxTokens: 500_000, maxCostUsd: 10, maxDurationMs: 3_600_000, maxDepth: 3 },
}

const result = await pipe(
  runStrategy(myStrategy, initialState),
  Effect.provide(runtimeLayer),
  Effect.runPromise
)
```

#### Story 5: Use the stdlib to design a new methodology

*"I want to use M1-MDES (the method design method) from the stdlib to design a new methodology, then compile it with the library."*

```typescript
import { P0_META, M1_MDES, compilationGates, compileMethod, runMethodologyToCompletion } from "@method/methodts/stdlib"

// Run the design method — an agent crystallizes domain knowledge into a method
const designResult = await pipe(
  runMethodologyToCompletion(asMethodology(M1_MDES), {
    domainKnowledge: "We need a method for triaging GitHub issues...",
    targetDomain: "GitHub issue management",
    compiledMethods: [],
  }),
  Effect.provide(Layer.merge(
    Layer.succeed(AgentProvider, ClaudeHeadlessProvider({ workdir: ".", model: "opus" })),
    CommandServiceLive,
    EventBusLive,
  )),
  Effect.runPromise,
)

// The agent produced a method definition in the typed state
const newMethod = designResult.finalState.candidateMethod

// Compile it — the library validates its own output
const report = compileMethod(newMethod, testStates)
if (report.overall === "compiled") {
  console.log("Method compiled successfully — all gates passed.")
} else {
  console.log("Needs work:", report.gates.filter(g => g.status !== "pass"))
}
```

#### Story 6: Test methodology routing without agents

*"I want to verify that my methodology's routing logic is correct before burning tokens."*

```typescript
import { evaluateTransition, simulateRun, type Methodology } from "@method/methodts"

// Single-state evaluation
const result = evaluateTransition(myMethodology, currentState)
console.log(`Selected: ${result.firedArm?.label}`)  // e.g., "implement"
console.log(`Trace:`, result.armTraces.map(a => `${a.label}: ${a.fired}`))

// Dry-run over a sequence of hypothetical states — zero tokens
const simulation = simulateRun(myMethodology, [state0, state1, state2, state3])
simulation.selections.forEach((s, i) =>
  console.log(`State ${i}: → ${s.firedArm?.label ?? "TERMINATE"}`)
)
// Verify the routing produces the expected method sequence
assert.deepEqual(
  simulation.selections.map(s => s.firedArm?.label),
  ["plan", "implement", "review", null]  // null = terminate
)
```

#### Story 7: React to runtime events

*"I want to send a Slack notification whenever a methodology completes, and trigger a new triage methodology when a GitHub webhook fires."*

```typescript
import { EventBus, type EventHook, type RuntimeEvent } from "@method/methodts"

// Hook: notify on completion
const slackNotify: EventHook<any> = {
  id: "slack-complete",
  description: "Notify Slack on methodology completion",
  filter: e => e.type === "methodology_completed",
  handler: (event) => HttpService.post(SLACK_WEBHOOK, {
    text: `✅ ${event.status} — ${event.trace.snapshots.length} steps, $${event.trace.accumulator?.totalCostUsd.toFixed(2)}`,
  }),
  mode: "fire_and_forget",
}

// Listener: trigger triage on external event
const issueTriageListener = pipe(
  EventBus.subscribe({ types: ["custom"] }),
  Stream.filter(e => e.name === "github_issue_opened"),
  Stream.runForEach(event =>
    runStrategy(triageController, extractIssueState(event.payload))
  ),
)

// Emit custom events from external webhooks
app.post("/webhook/github", (req) => {
  EventBus.emit({ type: "custom", name: "github_issue_opened", payload: req.body, timestamp: new Date() })
})
```

#### Story 8: Evaluate gates as a test suite

*"I want to run a set of quality checks against my project as a gate suite — like a test runner, but the checks are methodology-aware."*

```typescript
import { testRunner, scriptGate, checklistGate, type GateSuite } from "@method/methodts"

const qualityGates: GateSuite<ProjectState> = {
  name: "Release Readiness",
  gates: [
    testRunner("npm test"),
    testRunner("npm run lint"),
    scriptGate(check("no_high_findings", s => s.findings.filter(f => f.severity === "HIGH").length === 0)),
    checklistGate({
      items: [
        { id: "CL-01", claim: "All API endpoints have input validation" },
        { id: "CL-02", claim: "No hardcoded secrets in source" },
        { id: "CL-03", claim: "Migration scripts are idempotent" },
      ],
      requireAll: true,
      requireRationale: true,
    }),
  ],
  run: (state) => Effect.all(qualityGates.gates.map(g => g.evaluate(state))),
}

const results = await pipe(
  qualityGates.run(currentProjectState),
  Effect.provide(worldServicesLayer),
  Effect.runPromise,
)
results.forEach(r => console.log(`${r.passed ? "✅" : "❌"} ${r.reason}`))
```

### 2.4 Progressive Disclosure

The API is layered for progressive learning:

**Level 1 — Templates and shortcuts** (day 1):
```typescript
// Use pre-built templates, don't touch the algebra
import { commission, templates } from "@method/methodts"
const comm = commission(templates.implementation, myTask, bridgeParams)
```

**Level 2 — Compose prompts and predicates** (week 1):
```typescript
// Build custom prompts from combinators
const myPrompt = sequence(roleIntro, scopeConstraints, deliveryRules)
const myPredicate = and(check("compiled", ...), not(check("has_high_gaps", ...)))
```

**Level 3 — Define methods and methodologies** (week 2):
```typescript
// Full method definition with domain theory, steps, roles, objectives
const myMethod: Method<MyState> = { domain, roles, dag, objective, measures }
const report = compileMethod(myMethod, testStates)
```

**Level 4 — Run methodologies with suspension** (week 3):
```typescript
// Execute with suspension, strategy control, event hooks
const result = await runStrategy(myController, initialState)
```

**Level 5 — Stdlib and meta-methods** (week 4+):
```typescript
// Use M1-MDES to design new methods, compose methods, derive IDDs
import { M1_MDES, compose, deriveIDD } from "@method/methodts/stdlib"
```

---

## 3. Vision & Scope

### Vision

MethodTS is a TypeScript library that makes the formal theory executable — and ultimately **replaces `@method/core` as the methodology runtime** (D-093, SESSION-039, PO-approved). A method designer writes typed definitions — domain theories, steps, methods, methodologies — and the library provides: prompt composition, predicate evaluation, routing automation, commission generation, state tracking, gate evaluation, sort extraction, and TLA+ compilation. Agent context windows are freed for judgment and creativity; everything else is compiled, tested, and instant.

**TypeScript is the source of truth** for methodology definitions (D-094). YAML becomes a compilation target — readable, archival, backward-compatible — but not authoritative. The project invariant ("theory is source of truth") and the faithfulness priority both favor this: TypeScript types represent F1-FTH definitions more faithfully than YAML strings.

### Transition Plan (D-093)

**Phase 1 — Prove:** MethodTS is standalone (DR-T05). `@method/core` is unchanged. MethodTS must demonstrate it can express and run methodologies independently. Type duplication between core and MethodTS is intentional and temporary.

**Phase 2 — Integrate:** MCP tool handlers rewire to call MethodTS instead of core (D-099a). A runtime YAML adapter loads existing YAML into MethodTS types dynamically for methodologies not yet ported to TypeScript (D-098). Shared types package extracts structural overlap. P1-EXEC and P2-SD ported to stdlib (D-100).

**Phase 3 — Deprecate:** `@method/core` deprecated. MethodTS IS the runtime. YAML registry becomes archival. P-GH, P3-GOV, P3-DISPATCH ported to stdlib. Core's session management, routing, and validation fully replaced.

**Empirical gate for Phase 2:** MethodTS must run P2-SD end-to-end on a real project (pv-method itself) using `ClaudeHeadlessProvider`, producing equivalent results to the current core-based execution. This is not a test-state simulation — it is a real commissioned agent producing real code.

**What stays unchanged during transition:**
- `@method/bridge` stays as the agent session transport layer (PTY management, dashboard, channels, spawn queue). The bridge does not execute methodology logic. (D-099b)
- `@method/mcp` tool surfaces stay unchanged — agents see no difference. Only the handler implementations change. (D-099a)
- The YAML registry stays readable via the runtime adapter. No methodology becomes inaccessible during transition. (D-098)

### Scope

**Phase 1a — Foundation (pure TypeScript + minimal Effect):**
- Prompt algebra (composition, conditional, sectioning, context injection)
- Predicate algebra (first-order logic, evaluation with diagnostic traces)
- Domain theory types with axiom validation
- Role types with observation projection and epistemic scoping
- First-class state tracking (WorldState, Snapshot, StateTrace)
- Step and Method types (DAG preserved, hybrid agent/script execution)
- Methodology types (coalgebraic transition function with safety bounds)
- Domain retraction pairs with round-trip verification
- Property-based and unit test suite for foundation components
- Foundation documentation (getting-started guide, theory-mapping)

**Phase 1b — Integration (Effect services + runtime):**
- Gate framework (effectful, async, world-touching) — runners: `testRunner`, `scriptGate`, `httpChecker`
- Sort extractors — `Extractor<A, R>` type + `CommandService` + `GitService`
- Commission generation (single + batch, bridge-compatible, template library)
- Strategy adaptive meta-loop (`StrategyController`, suspension handling, gate-based termination, PRD 017 compatibility)
- **Methodology Runtime** — `runMethodology`, `runMethod`, `runStep` execution loop with state tracking, safety enforcement, retry, observability events, and auto-retro from trace
- **Agent Providers** — `MockAgentProvider` (deterministic testing/dry-run) + `ClaudeHeadlessProvider` (production execution via `claude --print`)
- Agent output parsing model (`StepExecution.agent.parse` field)
- Step middleware (tracing, axiom validation, cost tracking, timeout)
- **Meta-Method Support** — `compileMethod` (M1-MDES gates), `aggregateEvidence` (M3-MEVO), `diffDomainTheory` (M3-MEVO), `instantiate` (M4-MINS), `ProjectCard` type
- **Standard Library (stdlib)** — P0-META methodology + M1-MDES method as typed MethodTS values, reusable predicates, prompts, gates. Self-hosting: stdlib compiles via `compileMethod()`.
- Integration tests and remaining documentation

**Phase 2 — Integrate (D-093, D-098, D-099, D-100):**
- **MCP rewire:** tool handlers call MethodTS instead of core. Tool surfaces unchanged. (D-099a)
- **Runtime YAML adapter:** load existing YAML into MethodTS types dynamically (D-098). One-time scaffolding tool to generate .ts stubs from .yaml.
- **Shared types package:** `@method/types` extracts structural overlap between core and MethodTS (D-099d)
- **Stdlib expansion:** P1-EXEC + P2-SD ported as typed MethodTS values (D-100)
- `BridgeAgentProvider` — bridge-backed agent execution with PTY sessions, channels, dashboard
- `agentSteeredController` — strategy controller that commissions reasoning agents for decisions
- TLA+ spec derivation/compiler targeting TLA+ directly (D-096)
- Remaining meta-methods in stdlib: M2-MDIS, M3-MEVO, M4-MINS, M5-MCOM, M7-DTID
- Method composition (`compose()`, `mergeDomainTheories()`, `composeDAGs()`)
- Implementation derivation (`deriveIDD()`, `checkFaithfulness()`)
- Promotion evaluation (`evaluatePromotion()`)
- Refinement verification (`verifyRefinement()`)
- Extractor reconciliation (parsed vs observed state diff post-agent-step)
- Bridge channel integration (emit RuntimeEvents to bridge progress/event channels)
- Retro output compatible with RETRO-PROTO schema
- Additional extractor services: `FileSystemService`, `HttpService`
- `callbackGate` for webhook-style external triggers
- Tool<S> type with Hoare-typed pre/postconditions (F1-FTH Def 3.1)
- Inter-method coherence enforcement (F1-FTH Def 7.3)
- Domain morphisms (F1-FTH Def 1.4)
- Heterogeneous quantifiers (`forall` over sub-types)

**Phase 3 — Deprecate (D-093, D-100):**
- `@method/core` deprecated and removed
- MethodTS IS the methodology runtime
- YAML registry becomes read-only archival format
- Stdlib expansion: P-GH + P3-GOV + P3-DISPATCH ported as typed MethodTS values
- Core's strategy executor replaced by MethodTS's adaptive controller via `fromStrategyDAG` (D-099c)

**Exclude:**
- UI/dashboard changes (bridge dashboard is unaffected by the transition)
- Modifications to the formal theory files (F1-FTH, F4-PHI)
- Concurrent methodology support (blocked on P4 — parallel retraction coherence)

### Dependency Graph

```
Phase 1a (foundation, pure):
  Prompt ──┐
  Predicate ┼──→ DomainTheory ──→ Step/Method ──→ Methodology
            │       ↓                  ↓
            └──→ Role            WorldState/StateTrace
                                       ↓
                                   Retraction

Phase 1b (integration, Effect services + runtime):
  Gate ────────→ Strategy ────┐
  Extractor ──────────────────┤
  Commission ─────────────────┼──→ Runtime (runMethodology, runMethod, runStep)
  AgentProvider ──────────────┘        ↑
    ├─ MockAgentProvider               │ uses all Phase 1a types
    └─ ClaudeHeadlessProvider          │ + Gate, Commission, Extractor
                                       ↓
                                  Observability Events → Retro
```

---

## 4. Architecture Overview

```
┌─────────────────────────────────────────────────────┐
│                   @method/methodts                   │
│                                                      │
│  ┌──────────┐  ┌──────────┐  ┌───────────────────┐  │
│  │  Prompt   │  │Predicate │  │   DomainTheory    │  │
│  │  Algebra  │  │ Algebra  │  │   + WorldState    │  │
│  └────┬─────┘  └────┬─────┘  └────────┬──────────┘  │
│       │              │                 │              │
│  ┌────┴──────────────┴─────────────────┴──────────┐  │
│  │              Step / Method / Methodology         │  │
│  │   (DAG construction, coalgebraic routing)        │  │
│  └────┬──────────────┬─────────────────┬──────────┘  │
│       │              │                 │              │
│  ┌────┴─────┐  ┌─────┴──────┐  ┌──────┴──────────┐  │
│  │Commission│  │   Gates    │  │Sort Extractors   │  │
│  │Generator │  │(effectful) │  │(Effect services) │  │
│  └────┬─────┘  └─────┬──────┘  └──────┬──────────┘  │
│       │              │                 │              │
│  ┌────┴──────────────┴─────────────────┴──────────┐  │
│  │              Effect Runtime Layer                │  │
│  │   (Ref, Layer, Schedule, Stream, Fiber)          │  │
│  └────────────────────┬───────────────────────────┘  │
│                       │                              │
│  ┌────────────────────┴───────────────────────────┐  │
│  │              TLA+ Compiler (Phase 2)            │  │
│  └────────────────────────────────────────────────┘  │
└──────────────────────┬──────────────────────────────┘
                       │
          ┌────────────┴────────────┐
          │    @method/bridge       │
          │  (spawn, prompt, kill)  │
          └─────────────────────────┘
```

### Package Structure

```
packages/methodts/
  src/
    index.ts                    — barrel export
    prompt/
      prompt.ts                 — Prompt<A> pure reader function
      combinators.ts            — andThen, section, when, match, template
    predicate/
      predicate.ts              — Predicate<A> ADT
      evaluate.ts               — evaluate, evaluateWithTrace
      combinators.ts            — and, or, not, implies, forall, exists
    domain/
      domain-theory.ts          — DomainTheory<S>, SortDecl, FunctionDecl
      axioms.ts                 — validateAxioms (Mod(D) membership)
      role.ts                   — Role<S, V>, scopeToRole
    state/
      world-state.ts            — WorldState<S>, Snapshot<S>
      state-trace.ts            — StateTrace<S>, diff, replay
      state-ref.ts              — Effect.Ref-based state threading
    method/
      step.ts                   — Step<S>, StepExecution (agent | script)
      dag.ts                    — StepDAG<S>, topologicalOrder, checkComposability
      method.ts                 — Method<S> (5-tuple)
      measure.ts                — Measure<S>, ProgressOrder<S>, success profile
    methodology/
      methodology.ts            — Methodology<S>, Arm<S>
      transition.ts             — evaluateTransition (δ_Φ)
      safety.ts                 — SafetyBounds, TerminationCertificate, enforcement
      retraction.ts             — Retraction<P, C>, verifyRetraction
    gate/                       — (Phase 1b)
      gate.ts                   — Gate<S> as Effect
      witness.ts                — Witness<S>, evidence chain
      runners/
        test-runner.ts          — Gate that runs a test suite
        http-checker.ts         — Gate that checks HTTP endpoints (client-side)
        script-gate.ts          — Gate that runs a TypeScript predicate
    extractor/                  — (Phase 1b)
      extractor.ts              — Extractor<A> = Effect<A, ExtractionError, R>
      services/
        command.ts              — Shell command executor (composable base)
        git.ts                  — Git service (branches, commits, PRs)
      compose.ts                — Layer composition for multi-service extraction
    commission/                 — (Phase 1b)
      commission.ts             — Commission<A>, BridgeParams
      render.ts                 — commission(), batchCommission()
      templates.ts              — Reusable commission prompt templates
    strategy/                   — (Phase 1b)
      controller.ts             — StrategyController<S>, StrategyDecision<S>
      run-strategy.ts           — runStrategy adaptive meta-loop
      prebuilt.ts               — automatedController, interactiveController
      compat.ts                 — fromStrategyDAG (PRD 017 compat), compileToYaml
    runtime/                    — (Phase 1b)
      run-methodology.ts        — runMethodology suspendable coroutine
      suspension.ts             — SuspendedMethodology<S>, SuspensionReason, Resolution
      run-method.ts             — runMethod step DAG traversal
      run-step.ts               — runStep dispatch (agent | script)
      context.ts                — Step Context Protocol: assembleContext, ContextSpec, StepContext
      insight-store.ts          — InsightStore (Effect.Ref<Record<string, string>>)
      domain-facts.ts           — Domain facts renderer (axioms, predicates, role constraints → text)
      accumulator.ts            — ExecutionAccumulator, safety checking
      event-bus.ts              — EventBus<S> service (emit, subscribe, waitFor, history)
      events.ts                 — RuntimeEvent<S> union type (20 variants)
      hooks.ts                  — EventHook<S>, built-in hooks (logToConsole, logToFile)
      config.ts                 — RuntimeConfig<S> (middleware + hooks + bus capacity)
      middleware.ts             — StepMiddleware<S>, built-in middleware
      retro.ts                  — generateRetro from MethodologyResult
      errors.ts                 — RuntimeError union type (tagged variants)
    provider/                   — (Phase 1b)
      agent-provider.ts         — AgentProvider interface + AgentResult + AgentError
      mock-provider.ts          — MockAgentProvider (deterministic testing)
      claude-headless.ts        — ClaudeHeadlessProvider (claude --print)
      bridge-provider.ts        — BridgeAgentProvider stub (Phase 2)
    meta/                       — (Phase 1b: compile, instantiate, evidence; Phase 2: compose, derive, promote)
      compile.ts                — compileMethod, CompilationReport, assertCompiled
      evolve.ts                 — aggregateEvidence, diffDomainTheory, classifyDomainChanges
      instantiate.ts            — instantiate, instantiateMethodology, validateCardCompatibility
      project-card.ts           — ProjectCard type (MIC schema)
      compose.ts                — compose, mergeDomainTheories, composeDAGs (Phase 2)
      derive-idd.ts             — deriveIDD, checkFaithfulness (Phase 2)
      promote.ts                — evaluatePromotion (Phase 2)
      refine.ts                 — verifyRefinement (Phase 2)
    stdlib/                     — (Phase 1b: P0-META + M1-MDES; Phase 2: remaining methods)
      index.ts                  — barrel export
      meta/
        p0-meta.ts              — P0_META methodology definition
        d-meta.ts               — D_META domain theory
        arms.ts                 — delta_META transition arms
      methods/
        m1-mdes.ts              — M1_MDES method definition
        m2-mdis.ts              — M2_MDIS (Phase 2)
        m3-mevo.ts              — M3_MEVO (Phase 2)
        m4-mins.ts              — M4_MINS (Phase 2)
        m5-mcom.ts              — M5_MCOM (Phase 2)
        m7-dtid.ts              — M7_DTID (Phase 2)
      predicates.ts             — reusable predicate library
      prompts.ts                — reusable prompt templates
      gates.ts                  — compilation gates (G1-G6) + promotion gates
      types.ts                  — MetaState, DesignState, etc.
    tlaplus/                    — (Phase 2)
      compiler.ts               — Methodology → TLA+ spec
      properties.ts             — Safety (□) and liveness (◇) generation
      emitter.ts                — .tla file writer
  test/
    prompt.test.ts
    predicate.test.ts
    predicate.property.ts       — fast-check property tests
    domain.test.ts
    state.test.ts
    method.test.ts
    methodology.test.ts
    gate.test.ts                — (Phase 1b)
    extractor.test.ts           — (Phase 1b)
    commission.test.ts          — (Phase 1b)
    strategy.test.ts            — (Phase 1b)
    runtime.test.ts             — (Phase 1b) full methodology loop with MockAgentProvider
    runtime.integration.ts      — (Phase 1b) ClaudeHeadlessProvider against real Claude
    provider.test.ts            — (Phase 1b) mock provider matching, failure simulation
    meta-compile.test.ts        — (Phase 1b) compileMethod on registry-derived methods
    meta-instantiate.test.ts    — (Phase 1b) instantiate with I2-METHOD card
    meta-evolve.test.ts         — (Phase 1b) aggregateEvidence, diffDomainTheory
    stdlib-meta.test.ts         — (Phase 1b) P0-META routing, M1-MDES compiles, self-hosting
    stdlib-predicates.test.ts   — (Phase 1b) predicate library correctness
  docs/
    getting-started.md          — Tutorial: define prompts, compose, route, commission
    README.md                   — Library overview and concepts
    prompt-algebra.md           — Prompt<A> API reference and examples
    predicate-algebra.md        — Predicate<A> API reference
    state-tracking.md           — WorldState, Snapshot, StateTrace
    gates.md                    — Gate framework and runners (Phase 1b)
    extractors.md               — Sort extraction from the real world (Phase 1b)
    commissions.md              — Commission generation (Phase 1b)
    runtime.md                  — Methodology runtime: execution loop, providers, retry, observability (Phase 1b)
    tlaplus.md                  — TLA+ compilation (Phase 2)
    theory-mapping.md           — How MethodTS types map to F1-FTH definitions
```

---

## 5. Components

### Component 1: Prompt Algebra

A typed prompt composition system. `Prompt<A>` is a **pure function** `(a: A) => string` — deliberately not an Effect. Purity enables simple testing, zero-overhead composition, and no Effect dependency for the most commonly used type. For the rare case where prompt rendering requires world access (e.g., reading a file to include its contents), use `PromptEffect<A, E, R>` typed as `(a: A) => Effect<string, E, R>`.

**Core type:**
```typescript
// Prompt<A> is pure: (context: A) => string
// PromptEffect<A, E, R> is effectful: (context: A) => Effect<string, E, R>

class Prompt<A> {
  run: (a: A) => string

  andThen(other: Prompt<A>): Prompt<A>       // sequential composition (monoid)
  contramap<B>(f: (b: B) => A): Prompt<B>    // adapt context type (contravariant)
  when(pred: (a: A) => boolean): Prompt<A>   // conditional inclusion
  section(heading: string): Prompt<A>         // wrap in markdown section
  map(f: (s: string) => string): Prompt<A>   // transform output
  indent(spaces: number): Prompt<A>           // indent all lines
}
```

**Constructors:** `constant`, `empty`, `template` (tagged template literal), `sequence`, `cond`, `match`.

**Algebraic laws (verified by property tests):**
- Monoid: `empty().andThen(p) ≡ p`, `p.andThen(empty()) ≡ p`, associativity
- Contravariant functor: `p.contramap(id) ≡ p`, `p.contramap(f).contramap(g) ≡ p.contramap(f ∘ g)`

**Deliverables (Phase 1a):**
- [ ] `Prompt<A>` class with all combinators
- [ ] `PromptEffect<A, E, R>` type alias for effectful variant
- [ ] Constructor functions (constant, empty, template, sequence, cond, match)
- [ ] Property-based tests for monoid and contravariant laws
- [ ] Documentation with practical examples (commission prompts, delivery rule checklists)

### Component 2: Predicate Algebra

First-order logic over TypeScript values. Tagged union ADT with evaluation engine.

**Core type:**
```typescript
type Predicate<A> =
  | { tag: "val"; value: boolean }
  | { tag: "check"; label: string; check: (a: A) => boolean }
  | { tag: "and"; left: Predicate<A>; right: Predicate<A> }
  | { tag: "or"; left: Predicate<A>; right: Predicate<A> }
  | { tag: "not"; inner: Predicate<A> }
  | { tag: "implies"; antecedent: Predicate<A>; consequent: Predicate<A> }
  | { tag: "forall"; label: string; elements: (a: A) => A[]; body: Predicate<A> }
  | { tag: "exists"; label: string; elements: (a: A) => A[]; body: Predicate<A> }
```

**Note on `check` variant opacity:** The `check` variant takes an opaque `(a: A) => boolean` function. This is an escape hatch for predicates that cannot be expressed as ADT compositions. Opaque `check` predicates are evaluable and traceable (via `label`) but **not inspectable** — they cannot be serialized, analyzed, or compiled to TLA+. Phase 2's TLA+ compiler will require predicates built from the compositional variants only. Document this limitation in `theory-mapping.md`.

**Evaluation:**
- `evaluate(pred, value) → boolean` — pure evaluation
- `evaluateWithTrace(pred, value) → EvalTrace` — diagnostic trace showing which sub-predicates contributed to the result

```typescript
type EvalTrace = {
  label: string                       // predicate label or combinator name (e.g., "AND", "compiled")
  result: boolean                     // evaluation result at this node
  children: EvalTrace[]               // sub-predicate traces (empty for leaf nodes)
}
```

**Algebraic laws (verified by property tests):**
- De Morgan: `not(and(p, q)) ≡ or(not(p), not(q))`
- Double negation: `not(not(p)) ≡ p` (under evaluation)
- Implication: `implies(p, q) ≡ or(not(p), q)` (under evaluation)
- Forall/Exists duality: `not(forall(f, p)) ≡ exists(f, not(p))` (under evaluation)

**Deliverables (Phase 1a):**
- [ ] Predicate ADT with all constructors
- [ ] `evaluate` and `evaluateWithTrace` functions
- [ ] Property-based tests for logical equivalences
- [ ] Documentation with examples (routing predicates, axiom definitions)

### Component 3: Domain Theory and Axiom Validation

Typed representation of F1-FTH Definition 1.1 with runtime axiom checking.

**Core types:**
```typescript
type SortDecl = {
  name: string
  description: string
  cardinality: "finite" | "unbounded" | "singleton"
}

type FunctionDecl = {
  name: string
  inputSorts: string[]              // arity: references sort names in SortDecl[]
  outputSort: string                // return sort name
  totality: "total" | "partial"
  description?: string
}

type DomainTheory<S> = {
  id: string
  signature: {                      // Σ = (S, Ω, Π) — many-sorted signature
    sorts: SortDecl[]
    functionSymbols: FunctionDecl[]
    predicates: Record<string, Predicate<S>>
  }
  axioms: Record<string, Predicate<S>>
}

type Role<S, V = S> = {
  id: string
  description: string
  observe: (state: S) => V                        // π_ρ : observation projection
  authorizedTransitions?: (state: S) => Predicate<S>  // α_ρ : state-dependent authority (Def 2.1)
  authorized: string[]                            // simplified: step/tool ID allowlist
  notAuthorized: string[]
}
```

**Design note:** `S` parameterizes the instantiated Σ-structure (Def 1.2) — the product of all sort carrier sets as a single TypeScript record type. The many-sorted arity typing discipline (Def 1.1) is approximated via `SortDecl[]` and `FunctionDecl.inputSorts/outputSort` at runtime, not enforced at the TypeScript type level. `validateSignature` checks arity coherence. See `theory-mapping.md` for the full justification of this simplification.

**Operations:**
- `validateAxioms(domain, state) → { valid, violations[] }` — Mod(D) membership test
- `validateSignature(domain) → { valid, errors[] }` — check arity coherence across sorts, functions, predicates
- `scopeToRole(role, prompt) → Prompt<S>` — epistemic scoping via contramap

**Deliverables (Phase 1a):**
- [ ] DomainTheory, SortDecl, FunctionDecl, Role types
- [ ] `validateAxioms` — verify all axioms hold for a given state
- [ ] `validateSignature` — verify arity coherence in the signature
- [ ] `scopeToRole` — restrict prompt context to role's observation projection
- [ ] Unit tests with domain theories from the registry (D_ORCH, D_TMP as fixtures)

### Component 4: First-Class State Tracking

Typed state envelope tracked across step, method, and methodology boundaries.

**Core types:**
```typescript
type WorldState<S> = {
  value: S                            // the Σ-structure (Def 1.2): instantiated sorts
  axiomStatus: { valid: boolean; violations: string[] }
}

type Snapshot<S> = {
  state: WorldState<S>
  sequence: number                    // monotonic ordering
  timestamp: Date
  delta: Diff<S> | null               // diff from previous snapshot
  witnesses: Witness<any>[]           // gates that passed at this point
  metadata: { producedBy?: string; stepId?: string; methodId?: string }
}

type StateTrace<S> = {
  snapshots: Snapshot<S>[]
  initial: WorldState<S>
  current: WorldState<S>
}
```

**Design note:** `WorldState<S>` contains the Σ-structure (`value: S`) and axiom validation status. Operational metadata (timestamps, provenance, step/method IDs) lives in `Snapshot<S>`, not `WorldState<S>`, to cleanly separate the theory concept (Def 1.2/1.3) from execution bookkeeping.

**Effect integration:**
- `Effect.Ref<WorldState<S>>` for mutable state threading during execution
- `Effect.Ref<Snapshot<S>[]>` for append-only trace accumulation
- Steps read current state, produce new state, trace records the transition
- **Single-threaded assumption:** Phase 1 methodology execution is sequential. `Ref<WorldState>` is safe under this assumption. Concurrent step execution (P4) would require `SynchronizedRef`.

**Operations:**
- `snapshot(state, metadata) → Snapshot<S>` — freeze current state
- `diff(before, after) → Diff<S>` — compute state delta (JSON-based structural diff)
- `replayTrace(trace) → WorldState<S>[]` — reconstruct state sequence from trace
- `injectContext(state, prompt) → string` — render state into agent-consumable prompt text

**Deliverables (Phase 1a):**
- [ ] WorldState, Snapshot, StateTrace types
- [ ] Diff computation (structural JSON diff)
- [ ] Effect.Ref-based state threading
- [ ] Trace replay and serialization (YAML-compatible)
- [ ] Context injection into Prompt<S>
- [ ] Tests verifying trace integrity (snapshot sequence, diff correctness)

### Component 5: Step and Method (DAG)

Typed step definitions with hybrid execution (agent OR script). Methods are DAGs with composability checking.

**Core types:**
```typescript
type StepExecution<S> =
  | {
      tag: "agent"
      role: string
      context: ContextSpec<S>                                        // what the agent needs (§12.3)
      prompt: Prompt<StepContext<S>>                                  // renders from enriched context
      parse: (raw: string, current: S) => Effect<S, ParseError, never>  // merge output into current state
      parseInsight?: (raw: string) => string                         // extract insight for downstream steps
    }
  | { tag: "script"; execute: (state: S) => Effect<S, StepError, WorldServices> }

type Step<S> = {
  id: string
  name: string
  role: string
  precondition: Predicate<S>
  postcondition: Predicate<S>
  execution: StepExecution<S>
  tools?: string[]                    // tool IDs available during this step (Def 4.1 4-tuple)
  gate?: Gate<S>
  suspension?: SuspensionPolicy       // when to yield control (default: "on_failure")
}

type SuspensionPolicy =
  | "never"                            // never suspend (script steps, fast gates)
  | "on_failure"                       // suspend on error/postcondition/gate failure (default)
  | "always"                           // always suspend after this step (human checkpoint)
  | { tag: "on_condition"; condition: Predicate<S> }  // suspend when predicate holds on post-step state

type ProgressOrder<S> = {
  compare: (a: S, b: S) => number     // negative = a closer to O, 0 = equal, positive = b closer
}

type Measure<S> = {
  id: string
  name: string
  compute: (state: S) => number
  range: [number, number]
  terminal: number
  order?: ProgressOrder<S>            // Def 5.2 progress preorder (optional, design artifact)
}

type Method<S> = {
  id: string
  name: string
  domain: DomainTheory<S>
  roles: Role<S, any>[]
  dag: StepDAG<S>
  objective: Predicate<S>
  measures: Measure<S>[]
}

type StepEdge = {
  from: string                        // step ID
  to: string                          // step ID
}

type StepDAG<S> = {
  steps: Step<S>[]                    // V — finite set of steps
  edges: StepEdge[]                   // E — directed composability edges
  initial: string                     // σ_init step ID
  terminal: string                    // σ_term step ID
}
```

**Design note on tools:** The `tools` field on `Step<S>` preserves F1-FTH Def 4.1's 4-tuple `(pre, post, guidance, tools)`. In Phase 1, tools are referenced by name string (matching MCP tool IDs). A full `Tool<S>` type with Hoare-typed pre/postconditions (Def 3.1) is deferred to Phase 2 — TypeScript's type system cannot express the dependent typing that Hoare-indexed computations require without significant encoding overhead.

**Design note on progress preorder:** Def 5.2 defines the progress preorder as a design artifact specified alongside the objective. `ProgressOrder<S>` captures this optionally. Measure well-formedness (Def 5.3 — order-homomorphism from preorder to reals) is a Phase 2 TLA+ verification concern, not a Phase 1 runtime check.

**Operations:**
- `checkComposability(stepA, stepB, testStates) → { composable, counterexample }` — verify post ⊆ pre
- `topologicalOrder(dag) → Step<S>[]` — valid execution sequence
- `validateMethod(method) → { valid, errors[] }` — structural validation (all step edges composable, all roles declared, objective expressible)

**Script steps:** Execute TypeScript directly within the Effect runtime. Receive `WorldState<S>` as input, produce `WorldState<S>` as output. No agent spawned, no tokens burned. The step's pre/postconditions still apply — the script must satisfy the same Hoare contract as an agent step.

**Deliverables (Phase 1a):**
- [ ] StepExecution union type (agent | script)
- [ ] Step, StepDAG, StepEdge, Method, Measure, ProgressOrder types
- [ ] `checkComposability` — composability verification
- [ ] `topologicalOrder` — DAG linearization
- [ ] `validateMethod` — structural validation
- [ ] Tests with methods from the registry as fixtures

### Component 6: Methodology (Coalgebra) with Safety Bounds

Typed coalgebraic transition function with deterministic evaluation and execution safety. A methodology is **not** a state machine — it is a state-dependent method selector (F1-FTH Def 7.1). The transition function `δ_Φ` observes the current state and selects the next method to execute, or returns `None` to terminate. The state space is `Mod(D_Φ)` (typically infinite), and transitions are method executions, not labeled edges between fixed states.

**Core types:**
```typescript
type SafetyBounds = {
  maxLoops: number                    // max δ_Φ invocations before forced termination
  maxTokens: number                   // total token budget across all method executions
  maxCostUsd: number                  // total cost budget
  maxDurationMs: number               // wall-clock time limit
  maxDepth: number                    // max recursive retraction depth
}

type TerminationCertificate<S> = {
  measure: (state: S) => number       // ν : Mod(D_Φ) → ℕ (Def 7.4)
  decreases: string                   // argument that ν strictly decreases per method execution
}

type Arm<S> = {
  priority: number
  label: string
  condition: Predicate<S>
  selects: Method<S> | null           // null = terminate
  rationale: string
}

type Methodology<S> = {
  id: string
  name: string
  domain: DomainTheory<S>
  arms: Arm<S>[]                      // compiled priority-stack encoding of δ_Φ
  objective: Predicate<S>
  terminationCertificate: TerminationCertificate<S>
  safety: SafetyBounds
}
```

**Design note on arms vs δ_Φ:** `arms: Arm<S>[]` is the compiled priority-stack encoding of the transition function, matching how every methodology in the registry implements `δ_Φ`. `evaluateTransition` reconstructs the general `δ_Φ : Mod(D_Φ) → Option(Method)` semantics by evaluating arms in priority order. This encoding is inspectable (routing decisions are traceable per-arm) but excludes non-predicate-decomposable transition functions. A general `transition?: (state: S) => ...` escape hatch may be added in Phase 2.

**Design note on coherence:** Phase 1 assumes all methods in a methodology share the same domain theory `S`. Retraction-based inter-method coherence (Def 7.3 — retraction pairs between method domains and methodology domain) is deferred to Phase 2, when multi-domain method composition becomes practical.

**Operations:**
- `evaluateTransition(methodology, state) → TransitionResult<S>` — deterministic δ_Φ evaluation with full trace
- `checkSafety(methodology, executionState) → { safe, violation? }` — verify bounds before next method
- `simulateRun(methodology, states) → SimulationResult<S>` — dry-run δ_Φ routing over a provided state sequence. Evaluates which method would be selected at each state. Does **not** execute method steps (agent or script). Zero tokens, zero cost.
- `validateMethodology(methodology) → { valid, errors[] }` — structural validation (arm completeness, all methods declared, objective expressible)

```typescript
type SimulationResult<S> = {
  selections: TransitionResult<S>[]   // one per input state
  terminatesAt: number | null         // index of first None selection (methodology would terminate)
  methodSequence: string[]            // method IDs in selection order (excludes None)
}
```

**Safety enforcement:** Before each `evaluateTransition` call, the runtime checks `SafetyBounds`. If any bound is exceeded, the methodology terminates with a `safety_violation` status instead of selecting the next method.

**Deliverables (Phase 1a):**
- [ ] Methodology, Arm, SafetyBounds, TerminationCertificate, TransitionResult types
- [ ] `evaluateTransition` — deterministic routing with trace
- [ ] `checkSafety` — pre-transition safety check
- [ ] `simulateRun` — dry-run simulation (routing only, no execution)
- [ ] `validateMethodology` — structural validation
- [ ] `asMethodology(method)` — wrap a single `Method<S>` as a trivial one-arm `Methodology<S>` (convenience for running a single method through the methodology runtime)
- [ ] `Retraction<P, C>` type:
  ```typescript
  type Retraction<P, C> = {
    id: string
    embed: (parent: P) => C           // inject parent state into child domain
    project: (child: C) => P          // project child result back to parent domain
  }
  // Retraction condition: project(embed(s)) = s on the touched subspace (Def 6.3)
  ``` with `embed`, `project` functions
- [ ] `verifyRetraction(retraction, testStates, compare?)` — round-trip verification
- [ ] Tests with P1-EXEC and P2-SD routing logic as fixtures, retraction round-trip tests

### Component 7: Effectful Gate Framework

Gates as Effect computations that touch the real world. A test suite is a collection of gates.

**Core types:**
```typescript
type Gate<S> = {
  id: string
  description: string
  predicate: Predicate<S>           // declarative spec (inspectable, TLA+-compilable)
  evaluate: (state: S) => Effect<GateResult<S>, GateError, WorldServices>  // runtime impl (effectful)
  maxRetries: number
}

type GateResult<S> = {
  passed: boolean
  witness: Witness<S> | null
  reason: string
  feedback?: string
  duration_ms: number
}

// A test suite is a named collection of gates
type GateSuite<S> = {
  name: string
  gates: Gate<S>[]
  run: (state: S) => Effect<GateSuiteResult<S>, GateError, WorldServices>
}
```

**Gate dual evaluation paths:** `predicate` is the declarative specification — inspectable, compilable to TLA+, usable in dry-run simulation. `evaluate` is the effectful runtime implementation — touches the real world. Both must agree on pass/fail for the same state. `evaluate` is authoritative at runtime; `predicate` is authoritative for static analysis and TLA+ compilation.

**Built-in gate runners (Phase 1b):**
- `testRunner(command)` — execute a test command, gate passes if exit code = 0
- `httpChecker(url, expected)` — GET a URL (client-side), gate passes if response matches
- `scriptGate(predicate)` — evaluate a TypeScript predicate in Effect
- `checklistGate(checklist)` — **agent attestation gate** (see below)

**Checklist Gate — Agent Attestation:**

A checklist gate requires the agent to produce a structured attestation: a signed declaration that specific conditions hold, verified by the agent's own reasoning. Unlike postconditions (which the *runtime* checks on state) and algorithmic gates (which run scripts), a checklist gate asks the *agent* to attest that it verified things the runtime *cannot* verify from `S` alone.

```typescript
type ChecklistItem = {
  id: string                          // e.g., "CL-01"
  claim: string                       // what the agent must verify: "No SQL injection in user input paths"
  source?: string                     // where to check: "All files matching src/**/*.ts with user input handling"
}

type ChecklistGateConfig = {
  items: ChecklistItem[]
  requireAll: boolean                 // all items must be attested (default: true)
  requireRationale: boolean           // each attestation must include reasoning (default: true)
}

type ChecklistAttestation = {
  itemId: string
  attested: boolean                   // agent asserts this claim holds
  rationale: string                   // agent's reasoning for why it holds (or why it doesn't)
  confidence: "high" | "medium" | "low"
  evidence?: string                   // optional: specific file:line or artifact reference
}

type ChecklistGateResult = GateResult<any> & {
  attestations: ChecklistAttestation[]
  allAttested: boolean
  lowConfidenceItems: string[]        // items where agent said "low" — flags for human review
}
```

**How it works:**
1. The checklist gate appends structured instructions to the agent's prompt: "Before completing this step, verify each of the following claims and attest to them in the specified format."
2. Each `ChecklistItem.claim` is rendered as a numbered item the agent must address
3. The agent's output must include a structured attestation block (JSON or marked section)
4. The `checklistGate` runner parses the attestation block from the agent output
5. Gate passes if: all items attested (when `requireAll`), all have rationale (when `requireRationale`), and no item has `attested: false`
6. Low-confidence attestations pass the gate but are flagged in `lowConfidenceItems` for human review
7. Failed attestations (agent says `attested: false`) fail the gate with the agent's own reasoning as feedback

**Connection to domain facts context (§12.3):** Domain axioms injected via `DomainFactsSpec` tell the agent what must be true. The checklist gate asks the agent to attest that it *ensured* those things. Together they close the theory→context→execution→attestation loop.

**Example:**
```typescript
const securityChecklist = checklistGate({
  items: [
    { id: "CL-01", claim: "No user input reaches SQL queries without parameterization", source: "src/db/**/*.ts" },
    { id: "CL-02", claim: "All API endpoints validate input against declared schemas", source: "src/routes/**/*.ts" },
    { id: "CL-03", claim: "No secrets or credentials in committed source files", source: "**/*.ts, **/*.json" },
  ],
  requireAll: true,
  requireRationale: true,
})
```

**Composition:** Gates compose via `Effect.all` (all must pass) or `Effect.race` (first to pass wins).

**Deliverables (Phase 1b):**
- [ ] Gate, GateResult, GateSuite types
- [ ] Built-in runners: testRunner, httpChecker, scriptGate, checklistGate
- [ ] ChecklistItem, ChecklistGateConfig, ChecklistAttestation, ChecklistGateResult types
- [ ] Checklist instruction rendering (appended to agent prompt)
- [ ] Checklist attestation parser (extracts structured attestation from agent output)
- [ ] Gate composition (allPass, anyPass, withRetry)
- [ ] Tests using mock Effect services

### Component 8: Sort Extractors

Composable Effect services that instantiate domain sorts from the real world.

**Core type:**
```typescript
// An extractor produces a value of type A from the real world
type Extractor<A, R = WorldServices> = Effect<A, ExtractionError, R>
```

**Built-in services (Phase 1b):**
- `CommandService` — execute shell commands, parse output. Composable base.
- `GitService` (built on CommandService) — branches, commits, PRs, diffs, log

**Deferred to Phase 2:**
- `FileSystemService` — read files, glob, stat, watch
- `HttpService` — fetch URLs, parse JSON/XML

**Composition pattern:**
```typescript
// Compose: CommandService → GitService → PullRequestExtractor
const CommandLive = Layer.succeed(CommandService, { exec: ... })
const GitLive = Layer.provide(GitService.Live, CommandLive)
const PullRequestExtractor = pipe(
  GitService,
  Effect.flatMap(git => git.getPR(prNumber)),
  Effect.map(raw => toPullRequestSort(raw))
)
```

The `R` type parameter in `Effect<A, E, R>` tracks which services are needed. The compiler enforces you provide all of them before running.

**Deliverables (Phase 1b):**
- [ ] Extractor type alias and composition patterns
- [ ] CommandService — shell execution layer
- [ ] GitService — git operations layer (built on CommandService)
- [ ] Example: extract PullRequest + File sorts from a real git repo
- [ ] Tests with mocked services

### Component 9: Commission Generation

Render typed prompts + bridge parameters into commission artifacts.

**Core types:**
```typescript
type Commission<A> = {
  prompt: string                      // rendered prompt text
  context: A                          // context used for rendering (traceability)
  bridge: BridgeParams                // spawn configuration
  metadata: CommissionMetadata        // methodology/method/step IDs, routing trace
}
```

**Operations:**
- `commission(prompt, context, bridge, metadata) → Commission<A>` — single commission
- `batchCommission(prompt, contexts, bridgeFactory) → Commission<A>[]` — batch for bridge_spawn_batch
- Built-in templates: sub-agent implementation, review, council session, retro generation

**Template-first design:** The getting-started guide and commission docs lead with templates for common use cases (implementation sub-agent, PR review, council session). Templates accept simple configuration objects. Power users drop into the algebra (Prompt composition, contramap, conditional sections) when templates don't cover their case.

**Deliverables (Phase 1b):**
- [ ] Commission, BridgeParams, CommissionMetadata types
- [ ] `commission` and `batchCommission` functions
- [ ] Template library (implementation, review, council, retro)
- [ ] Tests verifying prompt rendering and bridge param generation

### Component 10: Strategy — Adaptive Methodology Loop

A Strategy is **not** a static DAG of nodes (that model is in `@method/core` PRD 017). A Strategy is an **adaptive meta-loop** that runs a methodology, observes outcomes, and dynamically decides how to continue — including changing the methodology itself. Strategies are possible because the runtime supports **first-class suspension** (§12.1).

A Strategy wraps methodology execution with: objectives (what "done" means at the strategy level), gates (when to stop), failure tolerance (how to recover), and a decision-maker (human or agent) that steers adaptation at each suspension point.

**Core types:**
```typescript
type StrategyController<S, R = never> = {
  id: string
  name: string

  /** Initial methodology to run (can change between runs via onComplete) */
  methodology: Methodology<S>

  /** Strategy-level gates — evaluated after each methodology completion */
  gates: Gate<S>[]

  /** Called on each runtime suspension — decides resolution.
   *  R parameter: services the controller needs (e.g., console IO for interactive,
   *  AgentProvider for agent-steered). R = never for automated controllers. */
  onSuspend: (suspended: SuspendedMethodology<S>) => Effect<Resolution<S>, never, R>

  /** Called on methodology completion — decides if strategy continues */
  onComplete: (result: MethodologyResult<S>) => Effect<StrategyDecision<S>, never, R>

  /** Strategy-level safety bounds (across all methodology runs within this strategy) */
  safety: SafetyBounds
}

type StrategyDecision<S> =
  | { tag: "done"; result: MethodologyResult<S> }
  | { tag: "rerun"; methodology?: Methodology<S>; state?: WorldState<S> }
  | { tag: "switch_methodology"; methodology: Methodology<S> }
  | { tag: "abort"; reason: string }

type StrategyResult<S> = {
  status: "completed" | "failed" | "aborted" | "safety_violation"
  finalState: WorldState<S>
  trace: StateTrace<S>
  runs: MethodologyResult<S>[]        // all methodology runs within this strategy
  totalCostUsd: number
  totalLoops: number
  gateResults: GateResult<S>[]
}
```

**Strategy execution loop:**
```
runStrategy(controller, initialState):
  state = initialState
  methodology = controller.methodology
  │
  ▼
┌─► result = runMethodology(methodology, state)    // suspendable — may yield
│     │
│     ├─ on suspension → call controller.onSuspend(suspended)
│     │     resolution → resume methodology (see §12.1)
│     │     may suspend multiple times within one methodology run
│     │
│     ▼ methodology complete (or aborted)
│   evaluate strategy gates against result.finalState
│   call controller.onComplete(result)
│     │
│     ├─ done → return StrategyResult
│     ├─ rerun → state = result.finalState (or override), loop
│     ├─ switch_methodology → methodology = new, state = result.finalState, loop
│     └─ abort → return StrategyResult(aborted)
│   │
│   check strategy-level SafetyBounds
└───loop
```

**Relationship to PRD 017 static strategy DAGs:** PRD 017's `StrategyDAG` (nodes with depends_on edges, static topology) is one specific `StrategyController` implementation — one where `onSuspend` always continues, `onComplete` evaluates gates and advances to the next node, and the methodology never changes. To interoperate:
- `compileToYaml(controller) → string` emits PRD 017-compatible YAML for static controllers
- `fromStrategyDAG(dag) → StrategyController<S>` wraps a static DAG in the adaptive interface

**Pre-built controller patterns:**
- `automatedController(methodology, gates)` — fully automated: `onSuspend` always continues, `onComplete` checks gates and reruns on failure (up to safety bounds)
- `interactiveController(methodology, gates)` — human-in-the-loop: `onSuspend` always presents to human, `onComplete` presents trace and asks for decision
- `agentSteeredController(methodology, gates, steeringPrompt)` — agent steering: `onSuspend` commissions a reasoning agent to decide resolution, `onComplete` commissions the same agent to evaluate strategy direction

**Deliverables (Phase 1b):**
- [ ] `StrategyController<S>`, `StrategyDecision<S>`, `StrategyResult<S>` types
- [ ] `runStrategy` — adaptive meta-loop over suspendable methodology runs
- [ ] Pre-built controllers: `automatedController`, `interactiveController`
- [ ] `fromStrategyDAG` — wrap PRD 017 static DAG in the adaptive interface
- [ ] `compileToYaml` — emit PRD 017-compatible YAML for static controllers
- [ ] Tests with MockAgentProvider + mock onSuspend/onComplete handlers

**Deliverables (Phase 2):**
- [ ] `agentSteeredController` — commissions a reasoning agent for suspension resolution and strategy decisions (requires mature AgentProvider + prompt templates)

### Component 11: TLA+ Compiler (Phase 2)

Generate TLA+ specifications from MethodTS methodology definitions.

**Mapping:**
| MethodTS | TLA+ |
|----------|------|
| `WorldState<S>` | State variables |
| `DomainTheory.axioms` | `Invariant == □(axiom₁ ∧ axiom₂ ∧ ...)` (Safety) |
| `Methodology.objective` | `Liveness == ◇(O_Φ)` |
| `Step.precondition / postcondition` | Action pre/postconditions |
| `Methodology.arms` | Next-state relation (disjunction of arm transitions) |
| `SafetyBounds` | `BoundedExecution == □(loop_count ≤ max)` |
| `TerminationCertificate` | Well-founded measure for liveness proof |
| `StateTrace` | Behavior (sequence of states) |

**Note:** Only predicates built from compositional variants (not opaque `check` functions) are compilable to TLA+. See Component 2 note on `check` opacity.

**Operations:**
- `compileToTLA(methodology) → string` — generate .tla specification
- `compileProperties(methodology) → string` — generate safety and liveness properties
- `emitModule(methodology, outputPath) → Effect<void, CompileError, FileSystem>` — write .tla and .cfg files

**Deliverables (Phase 2):**
- [ ] TLA+ AST types (Module, Variable, Action, Property)
- [ ] `compileToTLA` — methodology → TLA+ module
- [ ] `compileProperties` — safety (□) and liveness (◇) property generation
- [ ] `emitModule` — file writer
- [ ] Tests verifying generated specs parse with TLA+ toolbox
- [ ] Documentation explaining the theory-to-TLA+ correspondence

### Component 12: Methodology Runtime (Suspendable)

The execution engine that runs the coalgebraic loop as a **suspendable coroutine**. Given a `Methodology<S>` and an initial `WorldState<S>`, the runtime executes until it reaches a **suspension point** — then yields control to the caller with full state, trace, and resume capability. The caller (human, agent, or strategy controller) inspects the suspension, decides how to proceed, and resumes. This repeats until the methodology completes or aborts.

Suspension is the foundational primitive that enables: human review gates, scheduled halts, interactive error recovery, methodology switching, and adaptive strategies. A straight-through execution (no human intervention) is the degenerate case where every suspension auto-resolves with `continue`.

**Phase delivery:** Phase 1b (suspension, core loop, step runner, context protocol, observability). Phase 2 (extractor reconciliation, serialization for cross-process resume).

#### 12.1 Suspension Model

The runtime is a **coroutine**: it yields `SuspendedMethodology<S>` values and receives `Resolution<S>` values. Each yield-resume cycle advances the methodology until the next suspension point or completion.

```typescript
// ─── Why the runtime suspends ───

type SuspensionReason<S> =
  | { tag: "gate_review"; gate: Gate<S>; result: GateResult<S>; step: Step<S> }
  | { tag: "checklist_review"; attestations: ChecklistAttestation[]; lowConfidence: string[] }
  | { tag: "error"; error: RuntimeError; step: Step<S> }
  | { tag: "safety_warning"; bound: keyof SafetyBounds; usage: number; limit: number }
  | { tag: "scheduled_halt"; trigger: string }
  | { tag: "checkpoint"; step: Step<S> }
  | { tag: "human_decision"; question: string; options: string[] }
  | { tag: "method_boundary"; completedMethod: string; nextArm: Arm<S> | null }
  | { tag: "methodology_complete"; result: MethodologyResult<S> }

// ─── What the runtime yields ───

type SuspendedMethodology<S> = {
  reason: SuspensionReason<S>
  state: WorldState<S>                // current world state — inspectable
  trace: StateTrace<S>                // full execution history — auditable
  accumulator: ExecutionAccumulator   // cost, tokens, loops — measurable
  insightStore: Record<string, string> // insights from prior agent steps
  position: {                         // exactly where execution paused
    methodologyId: string
    methodId: string
    stepId: string
    stepIndex: number
    retryCount: number
  }

  /** Resume execution with a resolution. Returns the next suspension or the final result. */
  resume: (resolution: Resolution<S>) =>
    Effect<SuspendedMethodology<S> | MethodologyResult<S>, RuntimeError, RuntimeServices>
}

// ─── What the caller provides to resume ───

type Resolution<S> =
  | { tag: "continue" }                                            // resume with current state
  | { tag: "provide_value"; value: Partial<S> }                    // merge value into state and continue
  | { tag: "rerun_step" }                                          // rerun the current step
  | { tag: "rerun_step_with"; state: S }                           // replace state, then rerun step
  | { tag: "skip_step" }                                           // skip to next step
  | { tag: "change_methodology"; methodology: Methodology<S> }    // hot-swap methodology, continue from current state
  | { tag: "abort"; reason: string }                               // terminate
```

**Suspension policy on steps:** Each step declares when it should trigger suspension via `SuspensionPolicy` (defined in Component 5, §5). The `suspension` field on `Step<S>` defaults to `"on_failure"`.

**Core operations:**
```typescript
// The main entry point — returns the first suspension or final result
function runMethodology<S>(
  methodology: Methodology<S>,
  initialState: WorldState<S>
): Effect<SuspendedMethodology<S> | MethodologyResult<S>, RuntimeError, RuntimeServices>

// Convenience: run to completion, auto-resolving all suspensions with "continue"
function runMethodologyToCompletion<S>(
  methodology: Methodology<S>,
  initialState: WorldState<S>
): Effect<MethodologyResult<S>, RuntimeError, RuntimeServices>

// Run a single method's step DAG (suspendable)
function runMethod<S>(
  method: Method<S>,
  state: WorldState<S>
): Effect<MethodResult<S>, RuntimeError, RuntimeServices>

// Run a single step (dispatches on tag, may suspend)
function runStep<S>(
  step: Step<S>,
  state: WorldState<S>
): Effect<WorldState<S>, StepError, RuntimeServices>
```

**Result types:**
```typescript
// Effect R parameter uses intersection (&) — all services must be provided
type RuntimeServices = AgentProvider & CommandService & GitService & ClockService & EventBus<any>

type ExecutionAccumulator = {
  loopCount: number                 // δ_Φ invocations
  totalTokens: number               // sum of agent step tokens
  totalCostUsd: number              // sum of agent step cost
  startedAt: Date
  elapsedMs: number
  suspensionCount: number           // how many times execution was suspended
  completedMethods: CompletedMethodRecord[]
}

type MethodologyResult<S> = {
  status: "completed" | "safety_violation" | "failed" | "aborted"
  finalState: WorldState<S>
  trace: StateTrace<S>
  accumulator: ExecutionAccumulator
  violation?: { bound: keyof SafetyBounds; limit: number; actual: number }
  retro: MethodologyRetro
}

type MethodResult<S> = {
  status: "completed" | "step_failed" | "objective_not_met"
  finalState: WorldState<S>
  stepResults: StepResult<S>[]
  objectiveMet: boolean
}

type StepResult<S> = {
  stepId: string
  status: "completed" | "postcondition_failed" | "gate_failed" | "error"
  before: Snapshot<S>
  after: Snapshot<S>
  cost: { tokens: number; usd: number; duration_ms: number }
  gateResults: GateResult<S>[]
  retries: number
  executionTag: "agent" | "script"
}
```

**Supporting types (referenced across components):**
```typescript
// Evidence that a predicate held — produced by gates, consumed by snapshots
type Witness<S> = {
  predicate: Predicate<S>
  evaluatedAt: Date
  trace: EvalTrace                    // from evaluateWithTrace
}

// Structural diff between two states — produced by diff(), stored in Snapshot.delta
type Diff<S> = {
  added: Record<string, unknown>      // fields present in after but not before
  removed: Record<string, unknown>    // fields present in before but not after
  changed: Record<string, { before: unknown; after: unknown }>
}

// Union of Effect services required by the runtime (used as R parameter)
type WorldServices = CommandService & GitService     // extractor services (Effect R intersection)
type HookServices = WorldServices                   // hooks may need the same services
type StepError = { _tag: "StepError"; stepId: string; message: string; cause?: unknown }

// Routing evaluation result — returned by evaluateTransition
type TransitionResult<S> = {
  firedArm: Arm<S> | null
  selectedMethod: Method<S> | null
  armTraces: Array<{ label: string; trace: EvalTrace; fired: boolean }>
}

// Record of a completed method within a methodology run
type CompletedMethodRecord = {
  methodId: string
  objectiveMet: boolean
  stepOutputSummaries: Record<string, string>   // stepId → output preview (capped at 200 chars)
  cost: { tokens: number; usd: number; duration_ms: number }
}

// Bridge spawn parameters — maps to bridge_spawn MCP tool input
type BridgeParams = {
  workdir: string
  nickname?: string
  purpose?: string
  parentSessionId?: string
  depth?: number
  budget?: { maxDepth: number; maxAgents: number }
  isolation?: "worktree" | "shared"
  timeoutMs?: number
  mode?: "pty" | "print"
  spawnArgs?: string[]
}

// Commission metadata — governance traceability
type CommissionMetadata = {
  generatedAt: Date
  methodologyId?: string
  methodId?: string
  stepId?: string
  routingTrace?: TransitionResult<any>
}

// Gate suite result — aggregation of individual gate results
type GateSuiteResult<S> = {
  name: string
  passed: boolean                     // all gates passed
  results: GateResult<S>[]
  duration_ms: number
}
```

#### 12.1a Core Execution Loop (with Suspension)

```
runMethodology(methodology, initialState)
  │
  validate axioms(methodology.domain, initialState)
  snapshot(initialState, "init")
  │
  ▼
┌─► evaluateTransition(methodology, state) ──► None? ──► SUSPEND(methodology_complete)
│     │
│     ▼ Some(method)
│   SUSPEND(method_boundary) if method_boundary policy applies
│   checkSafety(bounds, accumulator) ──► warning? → SUSPEND(safety_warning)
│                                    ──► violated? → terminate(safety_violation)
│     │
│     ▼ safe
│   runMethod(method, state)
│     │
│     for each step in topologicalOrder(method.dag):
│       validate precondition(step, state)
│       snapshot(state, "pre:" + step.id)
│       │
│       ├─ tag: "script" → runScriptStep(step, state)
│       ├─ tag: "agent"  → runAgentStep(step, state, agentProvider)
│       │
│       validate postcondition(step, newState)
│       │ └─ FAILED? → if step.suspension != "never" → SUSPEND(error)
│       │               else → retry (up to maxRetries)
│       validate axioms(methodology.domain, newState)
│       │ └─ VIOLATED? → SUSPEND(error) always — axiom violations are serious
│       run step gate → if failed → SUSPEND(gate_review)
│       run checklist gate → if low_confidence items → SUSPEND(checklist_review)
│       │
│       if step.suspension == "always" → SUSPEND(checkpoint)
│       if step.suspension == on_condition and condition(newState) → SUSPEND(checkpoint)
│       │
│       snapshot(newState, "post:" + step.id)
│       emit observability event
│       state = newState
│     │
│     ▼ method complete
│   validate method objective
│   record CompletedMethodRecord
│   emit method_completed event
│   increment loop counter
└───loop

On SUSPEND:
  yield SuspendedMethodology { reason, state, trace, accumulator, position, resume }
  wait for Resolution from caller
  │
  ├─ continue      → proceed from suspension point
  ├─ provide_value → merge into state, proceed
  ├─ rerun_step    → re-execute current step
  ├─ rerun_step_with → replace state, re-execute
  ├─ skip_step     → advance to next step
  ├─ change_methodology → hot-swap methodology, re-evaluate δ_Φ
  └─ abort         → terminate with "aborted" status
```

**P3-DISPATCH autonomy modes as suspension resolvers:** The three dispatch autonomy modes (INTERACTIVE, SEMIAUTO, FULLAUTO) are specific implementations of the suspension resolution loop:
- **INTERACTIVE:** Every step has `suspension: "always"`. The resolver always presents to human.
- **SEMIAUTO:** Steps have `suspension: "on_failure"`. The resolver auto-continues on `checkpoint`, presents to human on `error`/`gate_review`/`safety_warning`.
- **FULLAUTO:** Steps have `suspension: "on_failure"`. The resolver auto-continues on everything, auto-retries on failure, aborts only on safety violation.

**Suspension implementation mechanism:** The runtime loop (`runMethodology`) runs as a single Effect computation. Suspension is implemented by having inner functions (`runMethod`, `runStep`) signal suspension needs via a typed error channel variant `SuspensionSignal<S>` (not a user-visible error — an internal control flow mechanism). The outer `runMethodology` loop catches `SuspensionSignal`, packages the current state into `SuspendedMethodology<S>`, and yields to the caller. The `resume` function completes an internal `Effect.Deferred<Resolution<S>>` that the loop is awaiting, causing execution to continue from the suspension point. This is the standard Effect Fiber + Deferred coroutine pattern.

**Suspension serialization:** `SuspendedMethodology<S>` must be serializable to YAML/JSON (DR-T06) for: persisting across process restarts, displaying in dashboards, sending via bridge channels, storing for scheduled resume. The `resume` function is not serializable — on deserialization, the runtime uses a **checkpoint-and-replay** strategy: it re-executes the methodology from the beginning using the serialized `StateTrace<S>` as a replay log. Steps whose snapshots exist in the trace are fast-forwarded (postconditions applied directly from the snapshot, no agent/script execution). When the replay reaches the serialized `position`, execution transitions to live mode and the reconstructed `resume` function is returned. Serializability is limited to well-defined suspension points (post-step, post-gate, method-boundary) — mid-step suspensions are not serializable.

#### 12.2 Script Step Execution

Script steps execute TypeScript directly in the Effect runtime. Straightforward: call the function, validate the output.

```
runScriptStep(step, state):
  1. Call step.execution.execute(state.value)    → Effect<S, StepError, WorldServices>
  2. Wrap result in WorldState (validate axioms)
  3. Return new WorldState<S>
```

No agent provider needed. No prompt rendering. No output parsing. The function returns typed `S` directly. Cost: zero tokens, minimal wall-clock time.

#### 12.3 Step Context Protocol

Agent steps don't see `WorldState<S>` directly — they see a **rendered prompt string**. The Step Context Protocol governs what information reaches the agent, ensuring context sufficiency while minimizing token waste. Four context channels feed into every agent step's prompt:

**Channel 1 — State context:** The accumulated `WorldState<S>` from prior steps. Deterministic — the `Prompt<StepContext<S>>` renders exactly the state fields needed for this step. No wasted tokens on irrelevant state.

**Channel 2 — Insight context:** Distilled knowledge from prior agent steps. An agent that analyzed 50 files produces a 200-token insight summary for downstream agents instead of each downstream agent re-reading those 50 files. Insights are keyed strings, explicitly declared as step inputs/outputs.

**Channel 3 — World context:** Pre-fetched fragments from the real world that the agent would otherwise spend tokens discovering. Architecture docs, relevant source files, git history, test results — fetched as script effects (zero agent tokens) and injected into the prompt.

**Channel 4 — Domain facts context:** Axioms, predicates, sort descriptions, role constraints, and delivery rules rendered directly from the typed `DomainTheory<S>` and project card. The methodology's formal invariants are injected as agent instructions: "These axioms must hold. These predicates define your world. These are your role's authorized transitions." The agent receives the theory's constraints without reading YAML.

```typescript
type ContextSpec<S> = {
  /** Pre-fetched world fragments — executed as script effects before the agent runs */
  worldReads?: ContextRead<S>[]

  /** Keys of insights produced by prior steps that this step needs */
  insightDeps?: string[]

  /** Insight this step should produce for downstream steps */
  produceInsight?: {
    key: string                        // e.g., "architecture_risks", "scope_analysis"
    instruction: string                // appended to prompt: "At the end of your response, summarize..."
  }

  /** Domain theory elements to render as agent context */
  domainFacts?: DomainFactsSpec<S>

  /** Predicate: is the assembled context sufficient for this step? */
  sufficient?: Predicate<StepContext<S>>
}

type ContextRead<S> = {
  key: string                          // identifier for this context fragment
  extract: (state: S) => Effect<string, ExtractionError, WorldServices>
  maxTokens?: number                   // truncation budget for this fragment
  label?: string                       // human-readable description for the agent
}

type DomainFactsSpec<S> = {
  /** Include these axiom names from DomainTheory.axioms (or "all") */
  axioms?: string[] | "all"
  /** Include these predicate descriptions (or "all") */
  predicates?: string[] | "all"
  /** Include sort descriptions (or "all") */
  sorts?: string[] | "all"
  /** Include the current role's constraints */
  roleConstraints?: boolean
  /** Include delivery rules from project card (by ID or "all") */
  deliveryRules?: string[] | "all"
}

type StepContext<S> = {
  state: S                             // current world state
  world: Record<string, string>        // pre-fetched world fragments (key → content)
  insights: Record<string, string>     // prior steps' insights (key → content)
  domainFacts: string                  // rendered domain theory facts
}
```

**Context assembly flow (runtime, before prompt rendering):**
```
assembleContext(step, state, insightStore, domain):
  1. Execute worldReads in parallel as script effects → world: Record<string, string>
  2. Gather insightDeps from insightStore → insights: Record<string, string>
  3. Render domainFacts from DomainTheory:
     - Selected axioms as "Invariant: {name} — {statement}"
     - Selected predicates as "Predicate: {name} — {description}"
     - Selected sort descriptions
     - Role constraints for the step's role
     - Delivery rules (if project card provided)
  4. Assemble StepContext<S> = { state, world, insights, domainFacts }
  5. Check sufficient(stepContext) if declared — fail early if insufficient
  6. Return StepContext<S>
```

**Insight store:** A parallel accumulator alongside StateTrace — `Effect.Ref<Record<string, string>>`. Steps declare `produceInsight.key` as output; the runtime extracts the insight from the agent's response using `parseInsight` and stores it. Downstream steps reference keys via `insightDeps`. `validateMethod` checks at design time that all `insightDeps` keys are produced by prior steps in the DAG.

**Context sufficiency:** The optional `sufficient` predicate on `ContextSpec` enables formal verification that the assembled context contains enough for the step. Checked at runtime before dispatch. In TLA+, becomes an invariant: `[](step_executing(σ_i) ⇒ context_sufficient(σ_i))`.

**StepExecution type:** The canonical definition is in Component 5 (§5). The agent variant includes `context: ContextSpec<S>`, `prompt: Prompt<StepContext<S>>`, `parse(raw, current)`, and `parseInsight?` — all driven by the Context Protocol above.

**Insight chain example:**
```
Step 1 (agent): "Analyze the codebase architecture"
  context:
    worldReads: [{ key: "arch_docs", extract: readGlob("docs/arch/*.md") }]
    domainFacts: { axioms: ["Ax-I_compile", "Ax-I_scope"], roleConstraints: true }
    produceInsight: { key: "arch_analysis", instruction: "Summarize architectural findings as 3-5 bullets." }
  → agent sees: arch docs (pre-fetched, 0 discovery tokens) + domain axioms + role constraints
  → agent produces: typed output + "arch_analysis" insight (200 tokens)

Step 2 (script): Transform state — zero tokens

Step 3 (agent): "Implement task T1"
  context:
    worldReads: [{ key: "source", extract: readFiles(state.taskScope) }]
    insightDeps: ["arch_analysis"]
    domainFacts: { axioms: "all", deliveryRules: ["DR-01", "DR-03"] }
  → agent sees: source (pre-fetched) + arch analysis (200 tokens from step 1, not 2000 from raw docs)
             + all axioms + relevant delivery rules
```

#### 12.4 Agent Step Execution

Agent steps commission an LLM agent, collect its output, and parse it back into typed state. The Step Context Protocol (§12.3) governs what the agent sees.

```
runAgentStep(step, state, insightStore, domain, retryContext?):
  1. Assemble context: assembleContext(step, state, insightStore, domain)
  2. Check context sufficiency (if declared)
  3. Render prompt: step.execution.prompt.run(stepContext)  → string
  4. If produceInsight: append instruction to rendered prompt
  5. If retrying: append retryContext feedback
  6. Build Commission: { prompt, bridge params, metadata }
  7. Call AgentProvider.execute(commission)  → Effect<AgentResult, AgentError, AgentProvider>
  8. Parse output: step.execution.parse(agentResult.raw, state.value)  → Effect<S, ParseError, never>
  9. If parseInsight: extract insight, store in insightStore under key
  10. (Optional Phase 2) Reconcile with extractor: re-extract world state, diff against parsed
  11. Wrap result in WorldState (validate axioms)
  12. Update accumulator with agentResult.cost
  13. Return new WorldState<S>
```

**Agent output parsing model:** The `parse` function receives both the raw agent output AND the current state `S`, enabling partial state updates (merge agent changes into existing state rather than full replacement).

Common `parse` implementations:
- `parseJSON<S>(schema)` — parse output as JSON, validate against schema, merge into current S
- `parseStructured<S>(extractors)` — extract fields from natural language using markers
- `parsePassthrough(current)` — agent modified the world (wrote files, committed code); state is re-extracted via extractors, not parsed from output

**Optional extractor reconciliation (Phase 2):** After parsing, re-run sort extractors against the real world. Diff the parsed state (what the agent *claimed*) against the extracted state (what *actually happened*). Divergence triggers a warning or a gate. This catches agents that claim success but didn't actually do the work.

#### 12.5 Retry Semantics

Two levels of retry, both bounded:

**Step-level retry (on postcondition/gate failure):**
1. Postcondition or gate fails after step execution
2. Build retry feedback: `buildRetryFeedback(gateResult)` → string
3. Re-run the step with feedback appended to the prompt (agent) or re-execute (script)
4. Bounded by `step.gate.maxRetries` (default: 3 for algorithmic, 2 for observation, 0 for human)
5. If retries exhausted: step fails, method aborts

**Method-level (implicit via coalgebra):**
- No explicit method retry. If a method fails (objective not met), the runtime returns to the methodology loop
- `δ_Φ` is evaluated again on the current state — it may select the same method (creating implicit retry) or a different one
- Bounded by `SafetyBounds.maxLoops` — the methodology's loop counter prevents infinite re-selection

#### 12.6 Error Taxonomy

| Error | Source | Severity | Recovery |
|-------|--------|----------|----------|
| `PreconditionError` | State doesn't satisfy `step.precondition` | Fatal to method | Abort method. Composition bug — should be caught by `checkComposability`. |
| `PostconditionError` | Step output doesn't satisfy `step.postcondition` | Retryable | Retry step (up to maxRetries). If exhausted, abort method. |
| `GateError` | Step gate fails | Retryable | Retry step with gate feedback. If exhausted, escalate or abort. |
| `ParseError` | `parse(raw)` fails on agent output | Retryable | Retry agent step: "Your output didn't match the expected format: {error}." |
| `AgentError` | AgentProvider.execute fails (timeout, crash, permission denial) | Retryable | Retry with extended timeout. If persistent, abort step. |
| `AxiomViolation` | `validateAxioms(domain, newState)` fails post-step | Fatal to method | Step produced an invalid state. Abort method, record violation. |
| `SafetyViolation` | Bounds exceeded mid-execution | Fatal to methodology | Terminate immediately. Return partial trace. |
| `ObjectiveNotMet` | Method completes but `method.objective` not satisfied | Non-fatal | Return to methodology loop. δ_Φ decides next action. |

All errors are typed as Effect error channel variants (`RuntimeError = PreconditionError | PostconditionError | ...`), enabling selective catching via `Effect.catchTag`.

#### 12.7 Event System — EventBus

The runtime's event system is the nervous system that connects methodology execution to the outside world. It serves three layers of capability, all built on one primitive: a typed `EventBus<S>` Effect service.

**Layer 1 — Observation:** Reactive UIs, dashboards, logging, metrics. Consumers subscribe to the event stream and react. No feedback to the runtime — pure observation.

**Layer 2 — Side-effect triggers:** When event X fires, do Y. Webhooks, Slack notifications, metrics recording, file writes. Fire-and-forget effects that run in parallel with the methodology. The runtime doesn't wait for them.

**Layer 3 — Cross-methodology coordination:** A methodology suspended at a checkpoint waiting for an event from another methodology. Methodology A fires `step_completed`. Methodology B's strategy controller calls `EventBus.waitFor(...)` and resumes B when the event arrives. This turns isolated methodology runs into a **reactive network** where methodologies coordinate, depend on each other, share insights across boundaries, and react to each other's failures.

##### Event Types

```typescript
type RuntimeEvent<S> =
  // Methodology lifecycle
  | { type: "methodology_started"; methodologyId: string; initialState: WorldState<S>; timestamp: Date }
  | { type: "methodology_completed"; status: MethodologyResult<S>["status"]; trace: StateTrace<S>; timestamp: Date }
  | { type: "methodology_suspended"; reason: SuspensionReason<S>; position: SuspendedMethodology<S>["position"]; timestamp: Date }
  | { type: "methodology_resumed"; resolution: Resolution<S>; position: SuspendedMethodology<S>["position"]; timestamp: Date }
  // Method lifecycle
  | { type: "method_selected"; arm: string; methodId: string; trace: TransitionResult<S>; timestamp: Date }
  | { type: "method_completed"; methodId: string; objectiveMet: boolean; timestamp: Date }
  // Step lifecycle
  | { type: "step_started"; stepId: string; snapshot: Snapshot<S>; executionTag: "agent" | "script"; timestamp: Date }
  | { type: "step_completed"; stepId: string; snapshot: Snapshot<S>; cost: StepResult<S>["cost"]; timestamp: Date }
  | { type: "step_retried"; stepId: string; attempt: number; feedback: string; timestamp: Date }
  // Verification
  | { type: "gate_evaluated"; gateId: string; result: GateResult<S>; timestamp: Date }
  | { type: "checklist_attested"; gateId: string; attestations: ChecklistAttestation[]; timestamp: Date }
  | { type: "axiom_validated"; valid: boolean; violations: string[]; timestamp: Date }
  // Safety
  | { type: "safety_checked"; accumulator: ExecutionAccumulator; safe: boolean; timestamp: Date }
  | { type: "safety_warning"; bound: keyof SafetyBounds; usage: number; limit: number; timestamp: Date }
  // Context
  | { type: "insight_produced"; key: string; stepId: string; preview: string; timestamp: Date }
  | { type: "context_assembled"; stepId: string; channels: string[]; tokenEstimate: number; timestamp: Date }
  // Strategy (emitted by runStrategy, not runMethodology)
  | { type: "strategy_loop"; iteration: number; methodologyId: string; timestamp: Date }
  | { type: "strategy_decision"; decision: StrategyDecision<S>; timestamp: Date }
  | { type: "strategy_completed"; result: StrategyResult<S>; timestamp: Date }
  // Custom (user-defined events)
  | { type: "custom"; name: string; payload: unknown; timestamp: Date }
```

##### EventBus Service

```typescript
interface EventBus<S> {
  readonly _tag: "EventBus"

  /** Emit an event. All subscribers and hooks are notified. */
  emit: (event: RuntimeEvent<S>) => Effect<void, never, never>

  /** Subscribe to a filtered event stream. Returns an Effect.Stream. */
  subscribe: (filter?: EventFilter<S>) => Stream<RuntimeEvent<S>>

  /**
   * Wait for a specific event. Suspends the calling fiber until an event
   * matching the predicate arrives or the timeout expires.
   *
   * This is the primitive for cross-methodology coordination:
   *   EventBus.waitFor(e => e.type === "step_completed" && e.stepId === "sigma_3")
   */
  waitFor: (
    predicate: (event: RuntimeEvent<S>) => boolean,
    timeout?: Duration
  ) => Effect<RuntimeEvent<S>, TimeoutError, never>

  /** Get all events emitted so far (for trace reconstruction). */
  history: () => Effect<RuntimeEvent<S>[], never, never>
}

const EventBus = Context.Tag<EventBus<any>>("EventBus")

type EventFilter<S> = {
  types?: RuntimeEvent<S>["type"][]             // filter by event type
  methodologyId?: string                         // filter by methodology
  methodId?: string                              // filter by method
  stepId?: string                                // filter by step
  custom?: (event: RuntimeEvent<S>) => boolean   // arbitrary predicate
}
```

**Implementation:** The `EventBus` is backed by an `Effect.PubSub` (bounded async pub-sub channel). Subscribers receive events via `Stream`. `waitFor` uses `Deferred` — it creates a deferred value, subscribes a listener that resolves the deferred when the predicate matches, and the caller awaits the deferred. Timeout uses `Effect.timeout` on the deferred.

##### Event Hooks

Hooks are user-provided reactions to events. They are registered at runtime initialization and invoked by the EventBus on every matching event.

```typescript
type EventHook<S> = {
  id: string
  description: string
  /** Which events this hook responds to */
  filter: (event: RuntimeEvent<S>) => boolean
  /** What to do when the event fires */
  handler: (event: RuntimeEvent<S>) => Effect<void, HookError, HookServices>
  /** Execution mode */
  mode: "fire_and_forget" | "blocking"
}
```

**Modes:**
- **`fire_and_forget`** — the handler is `Effect.fork`ed. The runtime does not wait. Failures are logged but do not affect methodology execution. Use for: notifications, metrics, logging, dashboard updates.
- **`blocking`** — the runtime waits for the handler to complete before proceeding. The handler can inspect the event and produce side effects that the next step depends on. Use for: external approval gates, deployment checks, resource provisioning. **Caution:** blocking hooks add latency and can deadlock if they wait for events the runtime hasn't emitted yet.

**Built-in hooks:**
- `logToConsole(filter?)` — logs matching events to stdout (development)
- `logToFile(path, filter?)` — appends YAML-serialized events to a file (audit trail)
- `bridgeChannelHook(bridgeUrl, sessionId)` — forwards events to bridge progress/event channels (Phase 2)
- `metricsHook(collector)` — records cost, duration, token usage to a metrics collector

**Registration:**
```typescript
type RuntimeConfig<S> = {
  middleware: StepMiddleware<S>[]
  hooks: EventHook<S>[]             // registered at runtime init
  eventBusCapacity?: number          // PubSub buffer size (default: 1000)
}
```

##### Cross-Methodology Coordination Examples

**Example 1: Methodology B waits for Methodology A's review step**
```typescript
// In Strategy Controller for Methodology B:
onSuspend: (suspended) => Effect.gen(function* () {
  if (suspended.reason.tag === "checkpoint" && suspended.reason.step.id === "needs_review_input") {
    // Wait for Methodology A to complete its review
    const event = yield* EventBus.waitFor(
      e => e.type === "step_completed" && e.stepId === "sigma_review" && e.methodId === "M3-PHRV",
      Duration.minutes(30)
    )
    // Extract review findings from the event and inject into B's state
    return { tag: "provide_value", value: { reviewFindings: event.snapshot.state.findings } }
  }
  return { tag: "continue" }
})
```

**Example 2: Fire webhook on methodology completion**
```typescript
const notifyOnComplete: EventHook<MyState> = {
  id: "slack-notify",
  description: "Send Slack message when methodology completes",
  filter: e => e.type === "methodology_completed",
  handler: (event) => Effect.gen(function* () {
    yield* HttpService.post("https://hooks.slack.com/...", {
      text: `Methodology ${event.status}: ${event.trace.snapshots.length} steps, $${event.trace.accumulator?.totalCostUsd}`
    })
  }),
  mode: "fire_and_forget"
}
```

**Example 3: Pause on cost threshold (blocking hook as soft safety bound)**
```typescript
const costGuard: EventHook<MyState> = {
  id: "cost-guard",
  description: "Alert human when cost exceeds $2",
  filter: e => e.type === "step_completed" && e.cost.usd > 0,
  handler: (event) => Effect.gen(function* () {
    const acc = yield* accumulatorRef.get
    if (acc.totalCostUsd > 2.0) {
      yield* EventBus.emit({ type: "custom", name: "cost_alert", payload: { total: acc.totalCostUsd }, timestamp: new Date() })
      // In a blocking hook, this would pause methodology execution until human acknowledges
    }
  }),
  mode: "fire_and_forget"  // or "blocking" for hard pause
}
```

**Example 4: Trigger a new methodology on event**
```typescript
// A standalone listener (not part of any methodology) that spawns new methodology runs
const autoTriageListener = pipe(
  EventBus.subscribe({ types: ["custom"] }),
  Stream.filter(e => e.name === "new_github_issue"),
  Stream.runForEach(event => runStrategy(
    automatedController(triageMethodology, triageGates),
    extractInitialState(event.payload)
  ))
)
```

##### EventBus and Suspension Interaction

The EventBus and the suspension model interact at two points:

1. **Suspension emits events.** Every `SUSPEND(...)` in the runtime loop emits a `methodology_suspended` event before yielding. Every `resume()` emits a `methodology_resumed` event before continuing. External observers always know when a methodology is paused and when it resumes.

2. **Suspension can wait for events.** A strategy controller's `onSuspend` handler can call `EventBus.waitFor(...)` before deciding on a resolution. This is how cross-methodology coordination works: methodology B suspends at a checkpoint, its strategy controller waits for an event from methodology A, and then resumes B with the event payload merged into state.

**No circular dependency:** The EventBus is an Effect service in the Layer, not part of the methodology definition. Methodologies don't reference the EventBus in their types — they emit events through the runtime, and consume events through strategy controllers. The bus is infrastructure, not domain.

##### Deliverables

**Phase 1b:**
- [ ] `RuntimeEvent<S>` union type (20 event variants)
- [ ] `EventBus<S>` service interface (`emit`, `subscribe`, `waitFor`, `history`)
- [ ] `EventBus` implementation backed by `Effect.PubSub`
- [ ] `EventFilter<S>` type and filtering logic
- [ ] `EventHook<S>` type with `fire_and_forget` and `blocking` modes
- [ ] `RuntimeConfig<S>` with hook registration
- [ ] Built-in hooks: `logToConsole`, `logToFile`
- [ ] Integration with runtime loop: events emitted at every boundary (step, method, methodology, suspension, gate, safety)
- [ ] Integration with suspension: `methodology_suspended` / `methodology_resumed` events
- [ ] `waitFor` with timeout for cross-methodology coordination
- [ ] Tests: hook firing, event filtering, waitFor with mock events

**Phase 2:**
- [ ] `bridgeChannelHook` — forward events to bridge progress/event channels
- [ ] `metricsHook` — structured metrics collection
- [ ] Cross-process event bus (events survive process restarts, delivered via bridge or message queue)

#### 12.8 Auto-Retrospective from Trace

When the methodology completes (or aborts), the runtime generates a structured retrospective from the `StateTrace<S>` and `ExecutionAccumulator`. Unlike the bridge's PTY-based auto-retro (which parses terminal output patterns), this retro is computed from typed data — every field is derived, not inferred.

```typescript
type MethodologyRetro = {
  methodology_id: string
  status: "completed" | "safety_violation" | "failed" | "aborted"
  timing: {
    started_at: string; completed_at: string; duration_minutes: number
    time_in_agent_steps_ms: number; time_in_script_steps_ms: number
  }
  cost: {
    total_usd: number; total_tokens: number
    per_method: Array<{ method_id: string; cost_usd: number; tokens: number }>
    agent_steps: number; script_steps: number
  }
  routing: {
    loops: number; methods_selected: string[]
    routing_trace: Array<{ arm: string; method: string }>
  }
  steps: {
    total: number; completed: number; failed: number
    retries: number; gate_failures: number
    hardest_step: { id: string; retries: number; reason: string }  // most retried
  }
  safety: {
    bounds: SafetyBounds
    final_accumulator: ExecutionAccumulator
    headroom: Record<keyof SafetyBounds, number>  // how much budget remained
  }
  axiom_violations: string[]         // any axiom violations observed during execution
}
```

**Deliverable:** `generateRetro(result: MethodologyResult<S>) → MethodologyRetro` — pure function, no effects. The retro YAML is serializable via DR-T06.

#### 12.9 Middleware / Interceptors

Since every step goes through the same pipeline (`pre → execute → post → gate → snapshot`), the runtime supports composable middleware that wraps the pipeline:

```typescript
type StepMiddleware<S> = (
  step: Step<S>,
  state: WorldState<S>,
  next: (state: WorldState<S>) => Effect<WorldState<S>, StepError, RuntimeServices>
) => Effect<WorldState<S>, StepError, RuntimeServices>
```

**Built-in middleware:**
- `withTracing()` — snapshot state at every boundary, append to trace
- `withAxiomValidation(domain)` — validate axioms after every state transition
- `withCostTracking()` — accumulate cost from AgentResults
- `withTimeout(ms)` — wrap each step with `Effect.timeout`
- `withLogging(sink)` — emit RuntimeEvents to an event sink

Middleware composes via function composition: `withTracing() |> withAxiomValidation(domain) |> withCostTracking()`.

**Deliverables (Phase 1b):**
- [ ] `SuspendedMethodology<S>`, `SuspensionReason<S>`, `Resolution<S>` types
- [ ] `SuspensionPolicy` type and integration with `Step<S>`
- [ ] `runMethodology` — suspendable coroutine returning first suspension or result
- [ ] `runMethodologyToCompletion` — convenience wrapper that auto-resolves suspensions
- [ ] `resume()` function on `SuspendedMethodology<S>` — coroutine continuation
- [ ] `runMethod`, `runStep` core functions
- [ ] Suspension serialization (YAML/JSON) for `SuspendedMethodology<S>` (excluding `resume` function)
- [ ] Suspension deserialization + resume reconstruction from position + methodology
- [ ] Step Context Protocol: `ContextSpec<S>`, `StepContext<S>`, `ContextRead<S>`, `DomainFactsSpec<S>`
- [ ] `assembleContext` — context assembly from 4 channels (state, insights, world, domain facts)
- [ ] `InsightStore` — `Effect.Ref<Record<string, string>>` with key validation
- [ ] Domain facts renderer — axioms, predicates, sorts, role constraints, delivery rules → agent-consumable text
- [ ] Context sufficiency checking via `ContextSpec.sufficient` predicate
- [ ] `StepExecution.agent.parse(raw, current)` — merge-based output parsing
- [ ] `StepExecution.agent.parseInsight` — insight extraction from agent output
- [ ] Step-level retry with feedback injection
- [ ] Error taxonomy as Effect error channel variants
- [ ] `ExecutionAccumulator` with safety bound checking
- [ ] `RuntimeEvent<S>` stream emission
- [ ] `StepMiddleware<S>` type and built-in middleware (tracing, axiom validation, cost tracking, timeout)
- [ ] `generateRetro` — auto-retrospective from trace
- [ ] Integration tests: full methodology loop with MockAgentProvider
- [ ] Insight chain test: verify insights flow from producer step to consumer step

**Deliverables (Phase 2):**
- [ ] Extractor reconciliation (parsed vs observed state diff)
- [ ] Bridge channel integration (emit RuntimeEvents to bridge progress/event channels)
- [ ] Retro output compatible with RETRO-PROTO schema

### Component 13: Agent Providers

The `AgentProvider` is the Effect service that executes agent steps. The runtime dispatches to it without knowing how agents are invoked. Three implementations cover testing, headless execution, and bridge-backed orchestration.

#### 13.1 AgentProvider Service Interface

```typescript
interface AgentResult {
  raw: string                         // raw agent text output
  cost: {
    tokens: number                    // total tokens consumed
    usd: number                       // total cost in USD
    duration_ms: number               // wall-clock duration
    duration_api_ms: number           // API call duration only
  }
  usage: {                            // detailed token breakdown
    input_tokens: number
    output_tokens: number
    cache_read_tokens: number
    cache_write_tokens: number
  }
  session_id: string                  // agent session ID (for resume/traceability)
  num_turns: number                   // agentic turns taken
  stop_reason: string                 // end_turn, max_turns, budget_exceeded, etc.
  permission_denials: string[]        // tools the agent tried to use but was denied
}

interface AgentProvider {
  readonly _tag: "AgentProvider"
  execute: (commission: Commission<any>) => Effect<AgentResult, AgentError, never>
}

// Effect service tag for Layer injection
const AgentProvider = Context.Tag<AgentProvider>("AgentProvider")
```

**Error types:**
```typescript
type AgentError =
  | { _tag: "AgentTimeout"; commission: Commission<any>; timeout_ms: number }
  | { _tag: "AgentCrash"; commission: Commission<any>; exitCode: number; stderr: string }
  | { _tag: "AgentBudgetExceeded"; commission: Commission<any>; budget_usd: number; actual_usd: number }
  | { _tag: "AgentPermissionDenied"; commission: Commission<any>; denied_tools: string[] }
  | { _tag: "AgentSpawnFailed"; commission: Commission<any>; reason: string }
```

#### 13.2 MockAgentProvider (Testing & Dry-Run)

Deterministic provider for unit tests, property tests, and dry-run simulation. Returns canned responses keyed by prompt content, step ID, or sequence number.

```typescript
interface MockResponse {
  match: (commission: Commission<any>) => boolean    // predicate: does this mock handle this commission?
  response: string | ((commission: Commission<any>) => string)  // static or dynamic response
  cost?: Partial<AgentResult["cost"]>                // optional cost simulation
  delay_ms?: number                                  // optional simulated latency
}

interface MockAgentProviderConfig {
  responses: MockResponse[]                          // ordered: first match wins
  fallback?: string                                  // default response if no mock matches
  failOn?: (commission: Commission<any>) => AgentError | null  // simulate failures
}

function MockAgentProvider(config: MockAgentProviderConfig): AgentProvider
```

**Usage in tests:**
```typescript
const testProvider = MockAgentProvider({
  responses: [
    { match: c => c.metadata.stepId === "sigma_0", response: '{"sub_questions": ["q1", "q2"]}' },
    { match: c => c.metadata.stepId === "sigma_1", response: '{"answers": [...]}' },
  ],
  fallback: '{"status": "ok"}',
})

const result = pipe(
  runMethodology(myMethodology, initialState),
  Effect.provide(Layer.succeed(AgentProvider, testProvider)),
  Effect.runPromise
)
```

**Properties:**
- Fully deterministic: same config → same results, every time
- No external dependencies: no Claude binary, no API calls, no network
- Fast: responses are instant (or delayed by configurable `delay_ms` for timing tests)
- Composable: mock responses can reference the commission's context for dynamic generation
- Failure simulation: `failOn` produces typed `AgentError` variants for error-path testing

**Deliverables (Phase 1b):**
- [ ] `MockAgentProvider` implementation
- [ ] `MockResponse` matching system (predicate-based, first-match-wins)
- [ ] Failure simulation via `failOn`
- [ ] Example: full methodology test using MockAgentProvider

#### 13.3 ClaudeHeadlessProvider (Production — Claude `--print` Mode)

Production provider that invokes Claude Code in headless print mode via `claude --print`. Each agent step spawns a new `claude` process. Multi-turn conversations use `--resume <session_id>`. No persistent PTY — structured JSON output, no settle delay, no regex parsing.

This wraps the same `claude --print` mechanism used by the bridge's `PrintSession` and `ClaudeCodeProvider`, but adapted for the Effect runtime.

**How `claude --print` works:**
- `claude --print -p "prompt" --output-format json --session-id <id>` — start a new session
- `claude --print -p "prompt" --output-format json --resume <id>` — continue an existing session
- `--permission-mode bypassPermissions` — required for headless (no human to approve tool use)
- `--max-budget-usd N` — per-invocation cost cap
- `--append-system-prompt "..."` — inject context (bridge URL, session metadata)
- `--model <model>` — model override (default: user's configured model)
- `--allowedTools tool1,tool2` — restrict which tools the agent can use

**Output:** Structured JSON with `result` (text), `is_error`, `total_cost_usd`, `num_turns`, `usage` (token breakdown), `session_id`, `stop_reason`, `permission_denials`.

```typescript
interface ClaudeHeadlessConfig {
  claudeBin?: string                  // path to claude binary (default: "claude")
  workdir: string                     // working directory for the agent
  model?: string                      // model override
  maxBudgetUsd?: number               // per-step cost cap
  permissionMode?: string             // default: "bypassPermissions"
  appendSystemPrompt?: string         // additional system context
  allowedTools?: string[]             // tool restrictions
  timeoutMs?: number                  // per-invocation timeout (default: 300_000)
}

function ClaudeHeadlessProvider(config: ClaudeHeadlessConfig): AgentProvider
```

**Implementation:**
1. Receive `Commission<any>` from runtime
2. Build CLI args: `--print -p <commission.prompt> --output-format json --session-id <unique_id>`
3. Set `--permission-mode bypassPermissions`
4. Apply config overrides (model, budget, allowed tools, system prompt)
5. Spawn `claude` process via `Effect.tryPromise`
6. Collect stdout, parse as JSON
7. Map to `AgentResult` (same field mapping as bridge's `ClaudeCodeProvider.parseJsonResult`)
8. For multi-turn within a step (if the step needs follow-up): use `--resume <session_id>`
9. On timeout: kill process, return `AgentTimeout` error
10. On non-zero exit: return `AgentCrash` error
11. On budget exceeded (`stop_reason === "budget_exceeded"`): return `AgentBudgetExceeded` error

**Session management:**
- Each `runMethodology` invocation creates a unique session namespace
- Each agent step gets a unique session ID within that namespace: `{methodology_run_id}_{method_id}_{step_id}`
- Multi-turn within a step uses `--resume` to continue the conversation
- Sessions are NOT shared across steps — each step starts fresh (the state envelope provides continuity, not the agent's context window)

**Cost tracking:** Every `AgentResult` includes `cost.usd` and `cost.tokens`. The runtime accumulates these in `ExecutionAccumulator` and checks against `SafetyBounds` after each agent step.

**Deliverables (Phase 1b):**
- [ ] `ClaudeHeadlessProvider` implementation wrapping `claude --print`
- [ ] CLI arg builder (prompt, session ID, resume, model, budget, tools, system prompt)
- [ ] JSON output parser → `AgentResult`
- [ ] Timeout handling via `Effect.timeout` + process kill
- [ ] Error mapping (exit code → `AgentError` variants)
- [ ] Session ID namespace management
- [ ] Integration test: run a single agent step against real Claude (requires API access)

#### 13.4 BridgeAgentProvider (Phase 2 — Bridge-Backed Orchestration)

Delegates agent execution to the bridge HTTP API (`bridge_spawn` + `bridge_prompt` + `bridge_kill`). Enables PTY sessions, visibility channels, xterm.js dashboard, batch spawning, and all bridge features (PRD 006-018). Deferred to Phase 2 because it requires the bridge client Effect service.

**Sketch:**
```typescript
function BridgeAgentProvider(bridgeUrl: string): AgentProvider
  // execute(commission):
  //   1. POST /sessions (bridge_spawn) with commission.bridge params
  //   2. POST /sessions/:id/prompt with commission.prompt
  //   3. Parse response → AgentResult
  //   4. DELETE /sessions/:id (bridge_kill)
```

**Deliverables (Phase 2):**
- [ ] `BridgeAgentProvider` implementation
- [ ] Bridge client as Effect service (`BridgeClient` Layer)
- [ ] Channel integration (emit RuntimeEvents to bridge progress/events)

### Component 14: Meta-Method Support

Functions that automate or partially automate the P0-META meta-methods (M1-MDES through M7-DTID). These compose from MethodTS primitives — they are high-value convenience functions, not new infrastructure. They close the loop: the library that defines methods can also compile, evolve, instantiate, compose, and derive implementations from them.

#### 14.1 Method Compilation (M1-MDES)

A well-typed `Method<S>` that passes automated checks is structurally equivalent to passing most M1-MDES compilation gates.

```typescript
type CompilationGateResult = {
  gate: "G0" | "G1" | "G2" | "G3" | "G4" | "G5" | "G6"
  status: "pass" | "fail" | "needs_review"
  findings: string[]
}

type CompilationReport = {
  method: string
  overall: "compiled" | "failed" | "needs_review"
  gates: CompilationGateResult[]
  timestamp: Date
}
```

**Gate automation mapping:**

| Gate | Check | Automation |
|------|-------|------------|
| G0 | Navigation (what/who/why/how/when) | `needs_review` — presence of `navigation` field checked, content requires human judgment |
| G1 | Domain theory well-formed | `pass/fail` — `validateSignature()` (arity coherence) + `validateAxioms()` over test states + closed axiom check |
| G2 | Objective expressible in Σ | `pass` — `objective: Predicate<S>` is typed over the same `S` as the domain, expressibility guaranteed by construction |
| G3 | Role coverage + authority | `pass/fail` — verify union of `observe` projections covers `S`, union of `authorizedTransitions` covers all step transitions. Testable over test states. |
| G4 | Step DAG composability | `pass/fail` — `topologicalOrder()` (acyclicity) + `checkComposability()` per edge over test states |
| G5 | Guidance adequacy | `needs_review` — structural presence of `Prompt<StepContext<S>>` checked; semantic adequacy requires judgment |
| G6 | YAML encodable | `pass/fail` — `compileToYaml(method)` succeeds |

```typescript
function compileMethod<S>(
  method: Method<S>,
  testStates: S[],
  options?: { navigation?: Record<string, string> }
): CompilationReport

// Convenience: compile and assert all gates pass (throws on failure)
function assertCompiled<S>(method: Method<S>, testStates: S[]): void
```

**Deliverables (Phase 1b):**
- [ ] `compileMethod` — runs all automatable gates, produces `CompilationReport`
- [ ] `assertCompiled` — compile-or-throw for test assertions
- [ ] `CompilationReport` serializable to YAML (matches registry compilation_record format)

#### 14.2 Method Evolution (M3-MEVO)

Functions for evolving methods from execution evidence.

```typescript
type EvidenceSummary = {
  totalRuns: number
  perStepFailureRates: Record<string, { total: number; failed: number; rate: number }>
  gapCandidates: Array<{ stepId: string; pattern: string; sessionCount: number; severity: "HIGH" | "MEDIUM" | "LOW" }>
  topRetried: Array<{ stepId: string; totalRetries: number }>
}

type DomainChange =
  | { tag: "sort_added"; sort: SortDecl }
  | { tag: "sort_removed"; sort: string }
  | { tag: "axiom_added"; name: string; axiom: Predicate<any> }
  | { tag: "axiom_removed"; name: string }
  | { tag: "axiom_modified"; name: string; before: Predicate<any>; after: Predicate<any> }
  | { tag: "predicate_added"; name: string }
  | { tag: "predicate_removed"; name: string }
  | { tag: "function_added"; name: string }
  | { tag: "function_removed"; name: string }

type DomainChangeType = "conservative_extension" | "axiom_revision"

type RefinementReport = {
  old: string; new: string
  testStatesChecked: number
  measureComparisons: Array<{ measureId: string; allImproved: boolean; counterexample?: any }>
  refinementHolds: boolean
}

// Aggregate retrospectives into gap candidates
function aggregateEvidence(retros: MethodologyRetro[]): EvidenceSummary

// Structural diff between two domain theories
function diffDomainTheory<S>(before: DomainTheory<S>, after: DomainTheory<S>): DomainChange[]

// Classify domain changes as conservative extension or axiom revision
function classifyDomainChanges(changes: DomainChange[]): DomainChangeType

// Empirical refinement check: run both methods on same test states, compare measures
function verifyRefinement<S>(
  oldMethod: Method<S>,
  newMethod: Method<S>,
  testStates: S[],
  mockProvider: AgentProvider
): Effect<RefinementReport, RuntimeError, RuntimeServices>
```

**Deliverables (Phase 1b):**
- [ ] `aggregateEvidence` — gap crystallization from retro data
- [ ] `diffDomainTheory` — structural diff
- [ ] `classifyDomainChanges` — conservative extension vs axiom revision

**Deliverables (Phase 2):**
- [ ] `verifyRefinement` — empirical refinement check (requires running both methods)

#### 14.3 Method Instantiation (M4-MINS)

Instantiation is function application: abstract method + project card = project instance.

```typescript
type ProjectCard = {
  id: string                          // e.g., "I2-METHOD"
  project: string
  methodology: string
  methodologyVersion: string
  cardVersion: string
  essence: {
    purpose: string
    invariant: string
    optimizeFor: string[]
  }
  context: {
    language: string
    buildCommand: string
    testCommand: string
    lintCommand?: string
    languageServer?: string
    additionalTools?: Array<{ name: string; purpose: string }>
  }
  deliveryRules: Array<{
    id: string
    rule: string
    appliesTo: string[]
    affectsRoles?: string[]
  }>
  roleNotes: Record<string, { note: string }>
}

type CompatibilityReport = {
  compatible: boolean
  missingMethods: string[]             // methods referenced in deliveryRules but not in methodology
  missingRoles: string[]               // roles referenced in roleNotes but not in methods
  warnings: string[]
}

// Apply a project card to an abstract method, producing a project-specific instance
function instantiate<S>(method: Method<S>, card: ProjectCard): Method<S>

// Check card-method compatibility before instantiation
function validateCardCompatibility<S>(method: Method<S>, card: ProjectCard): CompatibilityReport

// Apply card to an entire methodology (instantiate all methods in range(δ_Φ))
function instantiateMethodology<S>(methodology: Methodology<S>, card: ProjectCard): Methodology<S>
```

**How instantiation works:**
- Delivery rules are injected into the Step Context Protocol's `DomainFactsSpec` (domain facts channel) for every step whose `appliesTo` matches the method ID
- Role notes are overlaid onto matching `Role<S, V>.description` fields
- Context fields (build command, test command) are bound into script step extractors and gates (e.g., `testRunner(card.context.testCommand)`)
- The output is a new `Method<S>` with card-derived modifications baked in — the abstract method's types are unchanged, only the runtime context is enriched

**Deliverables (Phase 1b):**
- [ ] `ProjectCard` type (matching MIC schema)
- [ ] `instantiate` — apply card to method
- [ ] `instantiateMethodology` — apply card to all methods in a methodology
- [ ] `validateCardCompatibility` — pre-instantiation compatibility check
- [ ] Tests with I2-METHOD project card as fixture

#### 14.4 Method Composition (M5-MCOM)

Sequential composition of two compiled methods into a composite M'' = M ; M'.

```typescript
type InterfaceSpec<S1, S2, S12> = {
  sharedSorts: string[]                // sort names that appear in both domains
  embed: (s1: S1) => S12              // expand M's terminal state to composite domain
  project: (s12: S12) => S1          // project composite state back to M's domain
  embed2: (s2: S2) => S12            // expand M''s initial state to composite domain
  project2: (s12: S12) => S2         // project composite state back to M''s domain
}

type CompositionError =
  | { tag: "empty_interface"; message: string }
  | { tag: "retraction_failed"; counterexample: any }
  | { tag: "axiom_conflict"; conflicting: string[] }
  | { tag: "seam_incomposable"; post: string; pre: string }
  | { tag: "compilation_failed"; report: CompilationReport }

// Compose two methods sequentially
function compose<S1, S2, S12>(
  left: Method<S1>,
  right: Method<S2>,
  interface_: InterfaceSpec<S1, S2, S12>,
  testStates?: S1[]
): Effect<Method<S12>, CompositionError, never>

// Merge two domain theories (conservative amalgamation)
function mergeDomainTheories<S1, S2, S12>(
  d1: DomainTheory<S1>,
  d2: DomainTheory<S2>,
  interface_: InterfaceSpec<S1, S2, S12>
): DomainTheory<S12>

// Concatenate two step DAGs with a seam edge
function composeDAGs<S1, S2, S12>(
  dag1: StepDAG<S1>,
  dag2: StepDAG<S2>,
  seamEdge: { from: string; to: string },
  mapStep1: (step: Step<S1>) => Step<S12>,
  mapStep2: (step: Step<S2>) => Step<S12>
): StepDAG<S12>
```

**Deliverables (Phase 2):**
- [ ] `compose` — full method composition with validation
- [ ] `mergeDomainTheories` — conservative amalgamation
- [ ] `composeDAGs` — DAG concatenation with seam edge
- [ ] `InterfaceSpec` type with retraction verification
- [ ] Tests composing two simple methods and verifying the composite compiles

#### 14.5 Implementation Derivation (M7-DTID)

Auto-generate an Implementation Decision Document from a typed domain theory by applying the derivation taxonomy.

```typescript
type ForcedChoice = {
  source: { type: "sort" | "function" | "predicate" | "axiom"; name: string }
  rule: string                         // e.g., "sort→entity", "total-fn→non-null"
  implementation: string               // the derived implementation pattern
}

type FreeChoice = {
  source: { type: "sort" | "function" | "predicate" | "axiom"; name: string }
  reason: string                       // why this is under-determined
  decision?: string                    // the chosen implementation (may be TBD)
  rationale?: string                   // why this decision was made
}

type IDD = {
  domainTheoryId: string
  domainTheoryVersion: string
  forcedChoices: ForcedChoice[]
  freeChoices: FreeChoice[]
  faithful: boolean                    // every axiom covered by at least one entry
  uncoveredAxioms: string[]            // axioms not covered (faithful = false if non-empty)
  generatedAt: Date
}

// Auto-generate IDD by walking the domain theory and applying the derivation taxonomy
function deriveIDD<S>(domain: DomainTheory<S>): IDD

// Check faithfulness: every axiom in Ax is covered by at least one IDD entry
function checkFaithfulness(idd: IDD, domain: DomainTheory<any>): { faithful: boolean; uncovered: string[] }
```

**Derivation taxonomy (10 forced-choice rules):**

| Domain construct | Rule | Implementation pattern |
|-----------------|------|----------------------|
| Sort | sort→entity | Record type / DB table / in-memory map |
| Total function | total-fn→non-null | Required field / FK NOT NULL |
| Partial function | partial-fn→nullable | Optional field / FK NULLABLE |
| Boolean predicate | pred→column | Boolean field / enum value |
| Sort-marker predicate | pred→role-not-entity | Enum variant / role flag |
| Mutual exclusion axiom | excl-ax→enum-check | Tagged union / CHECK constraint |
| Uniqueness axiom | uniq-ax→unique-index | Unique constraint / Set key |
| Cross-entity consistency axiom | consistency-ax→txn-boundary | Atomic block / transaction |
| Routing axiom | routing-ax→subscription | Event handler / subscription |
| Existence guarantee axiom | existence-ax→create-path | Constructor / insert path |
| Logic-only axiom | logic-only | Verified, no IDD entry |

**Deliverables (Phase 2):**
- [ ] `deriveIDD` — auto-generate IDD from domain theory
- [ ] `checkFaithfulness` — axiom coverage check
- [ ] `ForcedChoice`, `FreeChoice`, `IDD` types
- [ ] IDD serializable to YAML (matching M7-DTID output format)
- [ ] Tests with D_ORCH and D_TMP as fixtures

#### 14.6 Promotion Evaluation (M2-MDIS)

Evaluate promotion criteria against trial evidence for protocols going through the discovery lifecycle.

```typescript
type PromotionCriterion = {
  metric: string                       // e.g., "retrospective_count"
  threshold: string                    // e.g., ">= 10"
  gate: Gate<MethodologyResult<any>>   // evaluated against trial results
}

type PromotionReport = {
  criteria: Array<{ criterion: PromotionCriterion; met: boolean; actual: string }>
  allMet: boolean
  recommendation: "promote" | "extend_trial" | "refine" | "archive"
}

function evaluatePromotion(
  criteria: PromotionCriterion[],
  trialResults: MethodologyResult<any>[]
): PromotionReport
```

**Deliverables (Phase 2):**
- [ ] `PromotionCriterion`, `PromotionReport` types
- [ ] `evaluatePromotion` — gates over trial methodology results

---

### Component 15: Standard Library (stdlib)

The standard library ships P0-META — the genesis methodology that governs all other methodologies — as a MethodTS-native definition. This makes the library **self-hosting**: methodology designers use the library's own meta-methods (defined in the stdlib) to design, evolve, instantiate, compose, and derive new methodologies. The stdlib is the "batteries included" layer that bootstraps the methodology ecosystem.

#### 15.1 What the stdlib contains

The stdlib defines the P0-META methodology and its constituent methods as typed MethodTS values — not YAML files loaded at runtime, but compiled TypeScript constants with full type checking, predicate evaluation, and gate automation.

```typescript
// packages/methodts/src/stdlib/index.ts
export {
  // The genesis methodology
  P0_META,                            // Methodology<MetaState>

  // Individual meta-methods
  M1_MDES,                           // Method<DesignState>     — method design/compilation
  M2_MDIS,                           // Method<DiscoveryState>  — discovery lifecycle
  M3_MEVO,                           // Method<EvolutionState>  — method evolution
  M4_MINS,                           // Method<InstantiationState> — project instantiation
  M5_MCOM,                           // Method<CompositionState> — method composition
  M7_DTID,                           // Method<DerivationState>  — implementation derivation

  // Domain theories
  D_META,                            // DomainTheory<MetaState>
  D_MDES,                            // DomainTheory<DesignState>
  D_MEVO,                            // DomainTheory<EvolutionState>
  // ... etc

  // Pre-built predicates (reusable across methodology definitions)
  predicates,                        // { compiled, proposed, deprecated, hasGap, highGap, ... }

  // Pre-built gates
  compilationGates,                  // G0 through G6 as Gate<DesignState>
  promotionGates,                    // Trial promotion criteria as Gate<MethodologyResult>

  // Pre-built prompt templates
  prompts,                           // { compilationCheck, evidenceAssessment, gapCrystallization, ... }

  // State types (exported for user extension)
  type MetaState,
  type DesignState,
  type EvolutionState,
  type DiscoveryState,
  type InstantiationState,
  type CompositionState,
  type DerivationState,
}
```

#### 15.2 Self-hosting: using the stdlib to build methodologies

The core value proposition: a user who wants to design a new methodology uses the stdlib's `M1_MDES` — the method design method — which is itself a typed MethodTS method. The design workflow is:

```typescript
import { M1_MDES, D_MDES, compilationGates } from "@method/methodts/stdlib"
import { runMethodology, ClaudeHeadlessProvider } from "@method/methodts"

// Design a new methodology by running M1-MDES
const designResult = await pipe(
  runMethodologyToCompletion(
    asMethodology(M1_MDES),   // wrap the design method as a single-method methodology
    initialDesignState         // the domain knowledge to crystallize
  ),
  Effect.provide(Layer.merge(
    Layer.succeed(AgentProvider, ClaudeHeadlessProvider({ workdir: ".", model: "opus" })),
    CommandServiceLive,
  )),
  Effect.runPromise
)

// The result contains the new methodology as typed state
const newMethodology: Methodology<MyState> = designResult.finalState.compiledMethodology

// Compile it (automates G1, G2, G4, G6 — reports G0, G3, G5 as needs_review)
const report = compileMethod(extractMethod(newMethodology, "my-method"), testStates)
```

The stdlib enables a **methodology design pipeline**: identify gap → run M2-MDIS (discovery) → run M1-MDES (design) → `compileMethod()` (compilation) → `instantiate()` (project binding) → `runMethodology()` (execution) → `aggregateEvidence()` (evolution feedback). Every step uses MethodTS types. Every transition is typed and traceable.

#### 15.3 Reusable predicate library

The stdlib exports predicates from D_META that are useful across methodology definitions:

```typescript
export const predicates = {
  // Status predicates (from D_META)
  compiled: <S>(statusField: (s: S) => string) =>
    check("compiled", s => statusField(s) === "compiled"),
  proposed: <S>(statusField: (s: S) => string) =>
    check("proposed", s => statusField(s) === "proposed"),

  // Gap predicates
  hasGap: <S>(gapsField: (s: S) => Array<{ severity: string }>) =>
    check("has_gap", s => gapsField(s).length > 0),
  highGap: <S>(gapsField: (s: S) => Array<{ severity: string }>) =>
    check("high_gap", s => gapsField(s).some(g => g.severity === "HIGH" || g.severity === "CRITICAL")),

  // Composition predicates
  composablePair: <S>(canCompose: (s: S) => boolean) =>
    check("composable_pair", canCompose),

  // Scope predicates
  inScope: <S>(scopeCheck: (s: S) => boolean) =>
    check("in_scope", scopeCheck),

  // Generic threshold
  threshold: <S>(name: string, extract: (s: S) => number, min: number) =>
    check(name, s => extract(s) >= min),
}
```

#### 15.4 Reusable prompt templates

The stdlib exports prompt building blocks for common methodology patterns:

```typescript
export const prompts = {
  /** "You are a {role}. Your task: {description}" */
  roleIntro: <S>(role: (s: S) => string, task: (s: S) => string) => Prompt<S>,

  /** Render domain axioms as agent constraints */
  axiomConstraints: <S>(domain: DomainTheory<S>) => Prompt<S>,

  /** Render delivery rules from a project card */
  deliveryRules: (card: ProjectCard) => Prompt<any>,

  /** "At the end of your response, summarize {topic} in {n} bullets." */
  insightRequest: (topic: string, bullets: number) => Prompt<any>,

  /** Standard compilation check prompt (for M1-MDES σ₆) */
  compilationCheck: Prompt<DesignState>,

  /** Standard evidence assessment prompt (for M3-MEVO σ₀) */
  evidenceAssessment: Prompt<EvolutionState>,

  /** Standard gap crystallization prompt (for M3-MEVO σ₁) */
  gapCrystallization: Prompt<EvolutionState>,
}
```

#### 15.5 Pre-built gates

```typescript
export const compilationGates = {
  G1_domainTheory: Gate<DesignState>,    // validateSignature + validateAxioms
  G2_objective: Gate<DesignState>,       // objective expressible in Σ
  G3_roleCoverage: Gate<DesignState>,    // union of projections covers S
  G4_dagComposable: Gate<DesignState>,   // checkComposability per edge
  G5_guidancePresent: Gate<DesignState>, // every step has a prompt
  G6_yamlEncodable: Gate<DesignState>,   // compileToYaml succeeds
}

export const promotionGates = {
  minRetroCount: (n: number) => Gate<MethodologyResult<any>>,
  minGapCandidates: (n: number) => Gate<MethodologyResult<any>>,
  minEvolutions: (n: number) => Gate<MethodologyResult<any>>,
  selfReferentialTest: Gate<MethodologyResult<any>>,
}
```

#### 15.6 Package structure

```
packages/methodts/
  src/
    stdlib/
      index.ts                  — barrel export
      meta/
        p0-meta.ts              — P0_META methodology definition
        d-meta.ts               — D_META domain theory
        arms.ts                 — delta_META transition arms
      methods/
        m1-mdes.ts              — M1_MDES method (design/compilation)
        m2-mdis.ts              — M2_MDIS method (discovery lifecycle)
        m3-mevo.ts              — M3_MEVO method (evolution)
        m4-mins.ts              — M4_MINS method (instantiation)
        m5-mcom.ts              — M5_MCOM method (composition)
        m7-dtid.ts              — M7_DTID method (implementation derivation)
      predicates.ts             — Reusable predicate library
      prompts.ts                — Reusable prompt templates
      gates.ts                  — Pre-built compilation + promotion gates
      types.ts                  — State types (MetaState, DesignState, etc.)
  test/
    stdlib/
      meta.test.ts              — P0_META compiles via compileMethod
      mdes.test.ts              — M1_MDES steps produce valid compilation reports
      instantiation.test.ts     — instantiate() with I2-METHOD card
```

**Deliverables (Phase 1b):**
- [ ] `MetaState`, `DesignState`, and state types for all meta-methods
- [ ] `D_META` domain theory with all sorts, predicates, axioms from the registry
- [ ] `M1_MDES` method definition (7 steps, 2 roles, 7 gates)
- [ ] `P0_META` methodology definition (8 arms, delta_META transition function)
- [ ] `predicates` — reusable predicate library (compiled, proposed, hasGap, highGap, threshold, etc.)
- [ ] `prompts` — reusable prompt templates (roleIntro, axiomConstraints, deliveryRules, insightRequest)
- [ ] `compilationGates` — G1 through G6 as typed gates
- [ ] `compileMethod()` passes on the stdlib's own M1_MDES (self-hosting validation)
- [ ] Tests: P0_META routing evaluates correctly, M1_MDES compiles, stdlib gates pass on valid methods

**Deliverables (Phase 2):**
- [ ] Remaining meta-methods: M2_MDIS, M3_MEVO, M4_MINS, M5_MCOM, M7_DTID
- [ ] `promotionGates` — trial promotion criteria
- [ ] Full P0-META executable via `runMethodology` with `ClaudeHeadlessProvider`

---

## 6. Technology Stack

| Concern | Choice | Rationale |
|---------|--------|-----------|
| Runtime | **Effect** (`effect` package) | Typed effects, dependency injection via Layer, Ref for state, Schedule for retry, generators for do-notation |
| Testing | **Vitest** + `@effect/vitest` | Effect-native test runner |
| Property testing | **fast-check** | Generate arbitrary Predicate<A>, Step<S> values to verify algebraic laws |
| Build | **tsc** | Standard TypeScript compilation. Preferred over tsup for library builds due to known Effect tree-shaking conflicts with esbuild. |
| Documentation | **Markdown** in `docs/` | Consistent with project conventions |
| YAML | **js-yaml** | Consistent with `@method/core` (DR-05) |

---

## 7. Theory Grounding

### F1-FTH Type Mappings

| MethodTS Type | F1-FTH Definition | Section | Fidelity |
|---------------|-------------------|---------|----------|
| `Prompt<A>` | `guidance_σ : Context → Text` | §4 Def. 4.1 | Faithful |
| `Predicate<A>` | Closed Σ-sentence in Ax | §1 Def. 1.1 | Faithful for compositional variants. `check` variant is opaque (not inspectable). |
| `DomainTheory<S>` | `D = (Σ, Ax)` | §1 Def. 1.1 | Pragmatic encoding. `S` is the instantiated Σ-structure (Def 1.2), not the signature. Many-sorted arity typing approximated via `SortDecl[]/FunctionDecl[]` arrays with arity fields, not enforced at TypeScript type level. |
| `WorldState<S>` | `A ∈ Mod(D)` (Σ-structure satisfying Ax) | §1 Def. 1.3 | Enriched envelope. `value: S` is the Σ-structure. Operational metadata lives in `Snapshot<S>`, not `WorldState<S>`. |
| `Role<S, V>` | `ρ = (π_ρ, α_ρ)` | §2 Def. 2.1 | `observe` = π_ρ (faithful). `authorizedTransitions` = α_ρ (optional, Phase 1 approximates with string allowlist). |
| `Step<S>` | `σ = (pre, post, guidance, tools)` | §4 Def. 4.1 | Faithful. `execution` merges guidance into prompt. `tools` field preserves 4-tuple. |
| `StepDAG<S>` | `Γ = (V, E, σ_init, σ_term)` | §4 Def. 4.4 | Faithful |
| `Method<S>` | `M = (D, Roles, Γ, O, μ⃗)` | §6 Def. 6.1 | Faithful |
| `Retraction<P, C>` | `(embed, project)` with round-trip | §6 Def. 6.3 | Faithful |
| `Methodology<S>` | `Φ = (D_Φ, δ_Φ, O_Φ)` coalgebra | §7 Def. 7.1 | Faithful. `arms` is compiled priority-stack encoding of δ_Φ. |
| `TerminationCertificate<S>` | `ν : Mod(D_Φ) → ℕ` (well-founded measure with strict decrease) | §7 Def. 7.4 | Faithful |
| `Measure<S>` | `μ : Mod(D) → ℝ` order-homomorphism | §5 Def. 5.3 | Partial. `ProgressOrder<S>` captures Def 5.2 preorder. Well-formedness (order-homomorphism) is a Phase 2 TLA+ verification concern. |
| `Arm<S>` | Arm of `δ_Φ` priority stack | §7 (compiled registry pattern) | Implementation concept — specific encoding, not general δ_Φ. |

### Implementation Concepts (not in F1-FTH)

| MethodTS Type | Origin | Notes |
|---------------|--------|-------|
| `SafetyBounds` | Runtime execution bounds | Max loops, tokens, cost, duration. Pragmatic kill switch. Not the termination certificate (Def 7.4). |
| `Gate<S>` | M1-MDES compilation gates (G0–G6) | Nearest theory concept: `post_σ` + external verification. Gates are an operational bridge between theory and practice. |
| `Commission<A>` | Bridge integration | No theory counterpart. Maps to bridge_spawn parameters. |
| `Strategy<S>` | PRD 017 strategy pipelines | Higher-order methodology composition. |

### Theory extensions (documented, formalized in Phase 2)
- `WorldState<S>` adds explicit state tracking (currently implicit in Mod(D))
- `StateTrace<S>` adds execution history (discussed in F1-FTH §8.3 MDP extension)
- `Snapshot<S>` adds observable transition records (no theory counterpart)

### Deferred theory concepts
- **Tool (Def 3.1):** Full Hoare-typed `Tool<S>` with `Input → HST[P_t, Q_t] Output` deferred to Phase 2. Phase 1 references tools by name string.
- **Domain morphism (Def 1.4):** Signature translations preserving axioms. Needed for retraction verification. Deferred to Phase 2.
- **Inter-method coherence (Def 7.3):** Retraction pairs between method domains and methodology domain. Phase 1 assumes single shared domain `S`. Deferred to Phase 2.

---

## 8. Delivery Rules

| ID | Rule |
|----|------|
| DR-T01 | All types must map to a named F1-FTH definition or be documented as an implementation concept. Document the mapping and fidelity level in `theory-mapping.md`. |
| DR-T02 | Within `@method/methodts`, Effect is the primary side-effect mechanism. No raw Promises or `async/await` in internal logic. Integration boundaries with existing packages use `Effect.promise()` wrappers. Existing packages (`core`, `mcp`, `bridge`) retain their current async patterns. |
| DR-T03 | Algebraic laws (monoid, functor, logical equivalences) must have property-based tests. |
| DR-T04 | Every public function must have JSDoc documentation with at least one example. |
| DR-T05 | **Phase 1 only:** Zero runtime dependency on `@method/core`, `@method/mcp`, or `@method/bridge`. MethodTS is standalone. Type duplication is intentional. Phase 2 introduces shared types package. Phase 3 deprecates core — DR-T05 expires. (D-099d, SESSION-039) |
| DR-T06 | State tracking types must be serializable to YAML (for retro/trace integration). |
| DR-T07 | Script steps execute within the Effect runtime with the same pre/post contract as agent steps. |
| DR-T08 | Gate evaluation must produce diagnostic traces (not just pass/fail) for commission feedback. |
| DR-T09 | Sort extractors must compose via Effect's Layer system, not custom composition operators. |
| DR-T10 | API documentation uses plain-language descriptions. Theory terminology appears only in `theory-mapping.md` and JSDoc `@see` references. |

---

## 9. Success Criteria

**Phase 1a is complete when:**
1. Components 1-6 have implementations passing their test suites
2. Property-based tests verify all declared algebraic laws (monoid, contravariant, De Morgan, etc.)
3. Library documentation includes getting-started guide and theory-mapping reference
4. `npm test` passes, `npm run build` produces clean output

**Phase 1b is complete when:**
5. Components 7-15 have implementations passing their test suites (Phase 1b deliverables)
6. A practical example demonstrates end-to-end: define domain theory → extract sorts → build method → evaluate routing → generate commission → **run methodology** via `runMethodology` with `MockAgentProvider` → produce trace and retro
7. P2-SD's transition function (δ_SD) is expressible as MethodTS types with `evaluateTransition` returning the correct method selection for at least 3 test scenarios covering different routing arms
8. `ClaudeHeadlessProvider` executes at least one agent step against real Claude in `--print` mode (integration test, requires API access)
9. Suspension round-trip test: methodology suspends at a checkpoint, serializes state, deserializes, resumes, and completes successfully
10. Strategy controller test: `automatedController` runs a methodology to completion with gate-based termination
11. `compileMethod()` passes on stdlib's own M1-MDES (**self-hosting validation**: the library compiles its own methods)
12. `evaluateTransition(P0_META, state)` routes correctly for at least 3 meta-state scenarios matching the registry's delta_META arms
13. `instantiate(M1_MDES, I2_METHOD_card)` produces a valid instantiated method
14. Full library documentation in `docs/` covers all components with examples

**Empirical gate (required before Phase 2 begins):**
15. **MethodTS runs P2-SD end-to-end on pv-method** using `ClaudeHeadlessProvider` — a real commissioned agent produces real code, builds clean, tests pass. This is the proof that MethodTS can replace core. (D-093)

**Phase 2 is complete when:**
16. MCP tool handlers rewired to call MethodTS — agents see no behavior change (D-099a)
17. Runtime YAML adapter loads existing registry YAML into MethodTS types (D-098)
18. P1-EXEC and P2-SD fully ported to stdlib as typed MethodTS values (D-100)
19. TLA+ compiler generates parseable .tla specs targeting TLA+ directly (D-096)
20. Generated safety properties (□) and liveness properties (◇) match the methodology's axioms and objective
21. All 6 P0-META meta-methods defined in stdlib and executable via `runMethodology`
22. `compose(M_left, M_right, interface)` produces a composite method that passes `compileMethod()`

**Phase 3 is complete when:**
23. `@method/core` removed from the monorepo — MethodTS is the sole methodology runtime
24. P-GH, P3-GOV, P3-DISPATCH ported to stdlib
25. YAML registry is read-only archival — all methodology authoring is TypeScript

---

## 10. Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Effect learning curve | Medium — team unfamiliar with Effect ecosystem | Phase 1a is mostly pure TypeScript. Effect surfaces in Phase 1b (gates, extractors). Start with core patterns (Effect.gen, Layer, Ref). Avoid advanced features (Stream, Fiber) until needed. |
| Type system complexity | Medium — deep generics (Predicate<A>, Role<S, V>) may confuse users | Provide concrete type aliases for common cases. Documentation-first approach with getting-started guide leading with templates. DR-T10 enforces plain-language docs. |
| TLA+ tooling availability | Low — TLA+ toolbox is Java-based, may not be in all environments | Phase 2 delivery. Compiler produces .tla text files that can be verified externally. |
| Premature core replacement | High — replacing core before MethodTS is proven causes regression | Empirical gate: MethodTS must run P2-SD end-to-end on pv-method with ClaudeHeadlessProvider before Phase 2 integration begins. DR-T05 enforces Phase 1 standalone. (D-093) |
| Fast-check generator complexity | Medium — generating valid Predicate<A> trees requires careful recursion bounds | Use `fc.letrec` for recursive structures with depth cap of 3. Budget implementation time for generator design. Quantifier laws tested with hand-crafted generators; propositional laws with fully generic generators. |
| Type duplication with @method/core | Medium — parallel type definitions may drift over time | Intentional per DR-T05 and Migration Strategy. Phase 2 addresses convergence via shared types package or code generation. |
| Suspension serialization complexity | High — reconstructing coroutine resume from serialized position is non-trivial | `SuspendedMethodology<S>` must serialize to YAML/JSON (DR-T06) and reconstruct `resume` from position + methodology on deserialization. Risk: state divergence or reconstruction failure at certain suspension points (mid-retry, mid-context-assembly). Mitigation: round-trip property tests for every `SuspensionReason` variant; explicit test coverage of resume-from-deserialization; limit serializability to well-defined suspension points (post-step, post-gate, method-boundary) — mid-step suspensions are not serializable. |
| EventBus blocking hook deadlock | Low — blocking hooks can stall the runtime if they wait for events the runtime hasn't emitted | Mitigation: mandatory timeout on all blocking hooks (default 30s). Blocking hooks that exceed timeout are killed and logged as hook failures. Document that blocking hooks must not call `EventBus.waitFor` on events from the same methodology run. |

---

## 11. Resolved Questions (SESSION-039)

All original open questions were resolved by Steering Council SESSION-039 (D-094 through D-098):

| OQ | Question | Decision | Reference |
|----|----------|----------|-----------|
| OQ-1 | YAML or TypeScript as source of truth? | **TypeScript is source of truth.** YAML is a compilation target (readable, archival, backward-compatible). Runtime YAML adapter for unported methodologies. | D-094 |
| OQ-2 | Diff strategy for deeply nested WorldState? | **Path-based structural diff** with configurable depth limit (default 3) and `ignorePaths` option. Fields below depth limit compared by reference equality. | D-095 |
| OQ-3 | TLA+ or PlusCal? | **Target TLA+ directly.** PlusCal loses expressiveness. Compiler output is machine-consumed by TLC, not hand-read. | D-096 |
| OQ-4 | Extractors project-card-aware? | **Yes, via `instantiate()`.** Already specified in Component 14.3. Card context fields bound into extractors and gates during instantiation. | D-097 |
| OQ-5 | YAML-to-TypeScript scaffolding? | **Yes to both:** one-time migration tool (Phase 2 dev tool) + runtime YAML adapter (Phase 2 essential for transition). | D-098 |

## 12. Remaining Open Questions

- **OQ-6:** What are the exact empirical gate criteria for Phase 2? Which P2-SD method, which pv-method task, which success metrics beyond "builds clean, tests pass"?
- **OQ-7:** Should the project card's `essence.purpose` be updated to reflect the transition from "loads compiled methodology YAML specifications" to "executes typed methodology definitions"? (Deferred until Phase 2 integration begins.)
