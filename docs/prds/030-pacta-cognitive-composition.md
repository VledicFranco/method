---
title: "PRD 030: Pacta Cognitive Composition"
status: implemented
date: "2026-03-27"
tier: heavyweight
depends_on: [27, 28]
enables: []
blocked_by: []
complexity: high
domains_affected: [pacta, pacta-testkit, pacta-playground]
---

# PRD 030: Pacta Cognitive Composition

**Status:** Implemented (2026-03-27)
**Author:** PO + Lysica
**Date:** 2026-03-27
**Package:** `@methodts/pacta` (L3 — library)
**Depends on:** PRD 027 (Pacta SDK), PRD 028 (Pacta Print-Mode Convergence)
**RFC:** `docs/rfcs/001-cognitive-composition.md`
**Organization:** Vidtecci — vida, ciencia y tecnologia

## Problem Statement

This is a theory-first design bet. No empirical Pacta failure data motivates this PRD. The RFC's Calculus of Cognitive Composition hypothesizes that deliberately modeling cognitive architecture produces composable, modular agent designs with better structure than flat prompt pipelines. This PRD implements the theory; follow-up experiments (EXP-series) will validate or abandon it based on the RFC's three validation criteria. **Completion of this PRD does not constitute validation of the cognitive composition thesis.**

Pacta Phase 1 provides flat linear middleware composition: budget enforcer wraps output validator wraps provider. This model is not designed to express agents that monitor their own reasoning, compete for workspace influence, form hierarchical control loops, or shift strategy mid-task based on metacognitive signals. Whether agents need these capabilities is an open empirical question — the RFC hypothesizes that they do.

We believe cognitive science composition patterns (ACT-R, SOAR, GWT, Nelson & Narens, CLARION) may produce better-structured agents when adapted for LLM execution semantics. No agent framework currently grounds itself in these patterns. This implementation is the vehicle for testing that belief.

## Objective

Implement the Calculus of Cognitive Composition (RFC `docs/rfcs/001-cognitive-composition.md`) as a new `cognitive/` domain within `@methodts/pacta`, organized into three FCA sub-domains: `algebra/` (type system + operators), `modules/` (8 implementations), `engine/` (cycle + composition). Deliver:

1. A typed cognitive module abstraction `M = (I, O, S, mu, kappa)` with `step: (I, S, kappa) -> (O, S', mu)`
2. Four composition operators: sequential (`>>`), parallel (`|`), competitive (`<|>`), hierarchical (`>`), plus bounded recursive tower
3. A port-mediated workspace with salience-based attention, bounded capacity, and typed read/write access per module
4. A provider adapter bridging `AgentProvider.invoke()` to the cognitive module `step()` contract
5. Eight cognitive modules spanning two levels: object-level (reasoner, actor, observer, memory) and meta-level (monitor, evaluator, planner, reflector) — these are initial proposals; signal types will be revised based on implementation experience
6. A cognitive cycle orchestrator implementing 8 phases with a default-interventionist pattern, error handling, and control policy enforcement
7. Test infrastructure (testkit + playground) for cognitive agent evaluation
8. Two hard decision gates implementing the RFC's Phase 2 gating conditions

The implementation must preserve Pacta's core invariants: zero runtime dependencies (G-PORT), no cross-domain imports (G-BOUNDARY), no upward layer violations (G-LAYER), and full backward compatibility with Phase 1 types.

## Architecture & Design

### Core Thesis

Cognitive composition is a **parallel execution model** alongside the existing middleware pipeline — not a replacement. An agent can be:

- **Flat** (Phase 1): `createAgent({ pact, provider, reasoning })` — linear middleware
- **Cognitive** (Phase 2): `createCognitiveAgent({ modules, workspace, cycle })` — module composition with workspace and cycle

Both coexist. `CognitiveAgent` is a **separate interface** — not a subtype of `Agent`. An explicit adapter `asFlatAgent(cognitive)` bridges the two when interop is needed, making the impedance mismatch visible and testable.

### Domain Structure (FCA)

The cognitive domain is split into three sub-domains with enforced boundaries:

```
packages/pacta/src/cognitive/
  algebra/       Pure types, composition operators, workspace types. Zero awareness of specific modules.
  modules/       8 module implementations. Depend only on algebra/ types and pacta ports.
  engine/        CognitiveCycle, createCognitiveAgent. Depends on algebra/ types. Receives modules via injection.
```

**G-BOUNDARY rules:**
- `modules/` must not import from `engine/`
- `engine/` must not import from `modules/` (only from `algebra/` CognitiveModule interface)
- `cognitive/` must not import from `agents/` and vice versa

### The Cognitive Module

The fundamental type — a tuple of typed channels:

```typescript
interface CognitiveModule<I, O, S, Mu extends MonitoringSignal, Kappa extends ControlDirective> {
  readonly id: ModuleId;
  step(input: I, state: S, control: Kappa): Promise<StepResult<O, S, Mu>>;
  initialState(): S;
  stateInvariant?(state: S): boolean;  // optional integrity check called after each step
}

interface StepResult<O, S, Mu> {
  output: O;
  state: S;
  monitoring: Mu;
  error?: StepError;    // explicit error channel
  trace?: TraceRecord;
}

interface StepError {
  message: string;
  recoverable: boolean;
  moduleId: ModuleId;
  phase?: CyclePhase;
}
```

**Monitoring signals** use a discriminated union with a base type:

```typescript
interface MonitoringSignal {
  source: ModuleId;
  timestamp: number;
}

// Per-module signals extend the base (initial proposals — subject to revision)
interface ReasonerMonitoring extends MonitoringSignal { type: 'reasoner'; confidence: number; conflictDetected: boolean; }
interface ActorMonitoring extends MonitoringSignal { type: 'actor'; actionTaken: string; success: boolean; unexpectedResult: boolean; }
// ... etc for each module

type AggregatedSignals = Map<ModuleId, MonitoringSignal>;
```

**Control directives** follow the same pattern, with a `ControlPolicy` that whitelists permitted values:

```typescript
interface ControlDirective {
  target: ModuleId;
  timestamp: number;
}

interface ControlPolicy {
  allowedDirectiveTypes: string[];
  maxSpawnDepth?: number;       // sub-agent spawn limit (default: 0 = no spawning)
  allowedActions?: string[];    // whitelist for Actor directives
  validate(directive: ControlDirective): boolean;
}
```

The cycle orchestrator validates every control directive against the ControlPolicy before passing it to the target module. Directives that fail validation are rejected and emit a `CognitiveControlPolicyViolation` event.

### Provider Adapter

Cognitive modules that need LLM invocation (Reasoner, Planner) or tool execution (Actor) use adapter interfaces that bridge existing Pacta ports to the step() contract:

```typescript
interface ProviderAdapter {
  invoke(workspaceSnapshot: ReadonlyWorkspaceSnapshot, config: AdapterConfig): Promise<ProviderAdapterResult>;
}

interface AdapterConfig {
  pactTemplate: Partial<Pact>;    // base pact fields for invocations
  systemPrompt?: string;
  abortSignal?: AbortSignal;
}

interface ProviderAdapterResult {
  output: string;
  usage: TokenUsage;
  cost: CostReport;
}
```

`createProviderAdapter(provider: AgentProvider, defaults: AdapterConfig)` constructs an adapter from an existing AgentProvider. The adapter builds an AgentRequest from workspace contents, invokes the provider, and destructures the AgentResult. Module constructors accept the adapter:

```typescript
function createReasoner(adapter: ProviderAdapter, config?: ReasonerConfig): CognitiveModule<...>;
function createActor(tools: ToolProvider, config?: ActorConfig): CognitiveModule<...>;
```

### Composition Operators

Four operators that produce new cognitive modules from existing ones. All operators perform both compile-time (TypeScript generics) and runtime (defensive `CompositionError`) validation.

| Operator | Signature | Semantics | Error Behavior |
|----------|-----------|-----------|----------------|
| `sequential(A, B)` | A's output feeds B's input | Both signals emitted | Abort on first error |
| `parallel(A, B, merge)` | Both execute on same input | Merge combines outputs | Collect errors, pass to error merge function |
| `competitive(A, B, selector)` | Both produce; selector chooses | Selector has own signal | Throwing module is non-candidate |
| `hierarchical(M, T)` | M reads T's mu, issues kappa | Temporal: T first, M reacts | T error propagates; M error escalates |

Plus `tower(M, n)` — bounded recursive hierarchical composition (default max depth: 3). Budget constraints propagate downward — each level gets a fraction of the parent's budget.

### Workspace (Port-Mediated Access)

Modules interact with the workspace through **typed, per-module port interfaces** — not through a shared mutable bag. The workspace engine enforces access contracts:

```typescript
interface WorkspaceReadPort<T extends WorkspaceEntry = WorkspaceEntry> {
  read(filter?: WorkspaceFilter): T[];
  attend(budget: number): T[];
  snapshot(): ReadonlyWorkspaceSnapshot;
}

interface WorkspaceWritePort<T extends WorkspaceEntry = WorkspaceEntry> {
  write(entry: T): void;
}
```

Each module declares what entry types it can read and write. The cycle orchestrator wires specific read/write ports at composition time, making data flow explicit and testable. Constraints:
- **Per-module write quota**: max entries and max aggregate salience budget per cycle
- **Salience normalization**: the workspace engine computes salience centrally via a pluggable `SalienceFunction`, not trusting module-reported values
- **Eviction notifications**: `CognitiveWorkspaceEviction` events emitted when entries are evicted, so modules can react to lost context
- **Deterministic tie-breaking**: when salience scores are equal within epsilon, FIFO (oldest evicted first)

**Salience computation:**

```typescript
type SalienceFunction = (entry: WorkspaceEntry, context: SalienceContext) => number;

interface SalienceContext {
  now: number;
  goals: string[];
  sourcePriorities: Map<ModuleId, number>;
}

// Default formula (pluggable):
// salience = 0.4 * recencyScore(entry, now) + 0.3 * sourcePriority(entry, priorities) + 0.3 * goalOverlap(entry, goals)
```

Capacity enforcement, TTL-based expiry, and write logging as previously specified.

### Two-Level Architecture

```
MetaLevel (monitor, control) = Monitor + Evaluator + Planner + Reflector
       |                                               ^
       | control directives (kappa)                    | monitoring signals (mu)
       | [validated by ControlPolicy]                  |
       v                                               |
ObjectLevel (do the work) = Observer + Memory + Reasoner + Actor
       |                                               ^
       | writes (via WorkspaceWritePort)               | reads (via WorkspaceReadPort)
       v                                               |
       +-------------- Workspace Engine ---------------+
```

### Cognitive Cycle

Eight phases per agent turn. **Execution model: async/await sequential** (phases 1-7 awaited in order). LEARN is fire-and-forget with a state lock preventing concurrent mutation.

```
1. OBSERVE   — Observer processes new input
2. ATTEND    — Workspace attention selects salient entries
3. REMEMBER  — Memory retrieves relevant knowledge
4. REASON    — Reasoner produces reasoning trace
5. MONITOR   — Meta: reads aggregated monitoring signals [DEFAULT-INTERVENTIONIST]
6. CONTROL   — Meta: issues control directives, validated by ControlPolicy [DEFAULT-INTERVENTIONIST]
7. ACT       — Actor selects and executes action
8. LEARN     — Reflector distills cycle into memory [FIRE-AND-FORGET, state-locked]
```

MONITOR/CONTROL only fire when monitoring signals cross configurable thresholds. The default-interventionist pattern is designed to keep cost low on routine turns; actual cost ratio depends on workload and will be measured in validation experiments.

**Error handling:**

```typescript
interface CycleConfig {
  phases: CyclePhase[];                    // which phases are active
  thresholds: ThresholdPolicy;             // when meta-level engages
  errorPolicy: CycleErrorPolicy;           // abort | skip | retry
  controlPolicy: ControlPolicy;            // directive validation
  cycleBudget?: CycleBudget;               // per-cycle resource bounds
  maxConsecutiveInterventions?: number;     // meta-intervention cooldown (default: 3)
}

interface CycleErrorPolicy {
  default: 'abort' | 'skip';
  perModule?: Map<ModuleId, 'abort' | 'skip' | 'retry'>;
  maxRetries?: number;           // default: 1
  onError?: (error: StepError, phase: CyclePhase) => 'abort' | 'skip' | 'retry';
}

interface CycleBudget {
  maxProviderCallsPerCycle?: number;
  maxTokensPerCycle?: number;
  maxConsecutiveMetaInterventions?: number;  // force skip after N consecutive interventions
}
```

**LEARN failure handling:** The cycle catches LEARN rejections and emits `CognitiveLEARNFailed` events. LEARN failures do not corrupt the Reflector's state for subsequent cycles (state-lock rollback on error).

**Threshold policy:**

```typescript
type ThresholdPolicy =
  | { type: 'predicate'; shouldIntervene: (signals: AggregatedSignals) => boolean }
  | { type: 'field'; rules: Array<{ source: ModuleId; field: string; operator: '<' | '>'; value: number }> };
```

### Observability

Every module step emits a `TraceRecord`. Traces are consumed through a `TraceSink` port:

```typescript
interface TraceSink {
  onTrace(record: TraceRecord): void;
}
```

Built-in sinks:
- `InMemoryTraceSink` — stores traces for programmatic inspection (essential for testkit and experiments)
- `ConsoleTraceSink` — pretty-prints for development

The cycle orchestrator collects traces from each phase's StepResult and forwards to registered sinks. `CognitiveAgent` exposes `traces()` for post-hoc inspection. `CycleResult` includes the full trace array.

### Module Contracts

> **Note:** The 8-module decomposition is a starting hypothesis based on the RFC's analysis of cognitive architectures, not a derivation. The specific monitoring signal fields are initial proposals that will be revised based on implementation experience and validation experiments. The RFC raises minimality as open question Q2.

**Object-Level:**

| Module | Uses Port | Mu (monitoring) | Kappa (control) |
|--------|-----------|-----------------|-----------------|
| Observer | — | `{ type: 'observer', inputProcessed, noveltyScore }` | `{ focusFilter? }` |
| Memory | `MemoryPort` | `{ type: 'memory', retrievalCount, relevanceScore }` | `{ retrievalStrategy }` |
| Reasoner | `ProviderAdapter` | `{ type: 'reasoner', confidence, conflictDetected, effortLevel }` | `{ strategy, effort }` |
| Actor | `ToolProvider` | `{ type: 'actor', actionTaken, success, unexpectedResult }` | `{ allowedActions?, escalate? }` |

**Meta-Level:**

| Module | Uses Port | Mu (monitoring) | Kappa (control) |
|--------|-----------|-----------------|-----------------|
| Monitor | — | `{ type: 'monitor', escalation?, anomalyDetected }` | `never` (top-level) |
| Evaluator | — | `{ type: 'evaluator', estimatedProgress, diminishingReturns }` | `{ evaluationHorizon }` |
| Planner | `ProviderAdapter` | `{ type: 'planner', planRevised, subgoalCount }` | `{ replanTrigger? }` |
| Reflector | `MemoryPort` | `{ type: 'reflector', lessonsExtracted }` | `{ reflectionDepth }` |

## Alternatives Considered

### Alternative 1: Extend existing middleware stack

Add monitoring signals to `ReasonerMiddleware` and a `MetaMiddleware` layer.

**Pros:** Incremental, no new abstractions, backward-compatible.
**Cons:** Middleware is fundamentally linear — it is not designed to express parallel, competitive, or hierarchical composition. Monitoring would be bolted on without structural guarantees.
**Why rejected:** The RFC's core hypothesis is that the composition model matters. Whether agents need metacognition is the hypothesis under test — but testing it requires non-linear composition, which middleware can't express.

### Alternative 2: Port ACT-R or SOAR directly

Implement ACT-R's production system or SOAR's impasse-subgoal-chunk cycle.

**Pros:** Decades of research validation, established formalisms.
**Cons:** Designed for biological simulation with fundamentally different constraints (50ms production cycles vs multi-second LLM turns). Token/context constraints have no ACT-R analogue.
**Why rejected:** The RFC uses cognitive architectures as design inspiration, not implementation targets. A faithful port would be misaligned with LLM execution semantics.

### Alternative 3: Graph-based orchestration (LangGraph-style)

Model agent behavior as a state machine graph with nodes as processing steps.

**Pros:** Well-understood paradigm, existing OSS implementations.
**Cons:** Graphs don't naturally express metacognition, competitive selection, or salience-based workspace management. Reduces Pacta to "another LangGraph."
**Why rejected:** The RFC's composition operators (hierarchical, competitive) are fundamentally non-graph. A monitor/control hierarchy is a feedback loop, not a DAG edge.

### Alternative 4: Incremental validation (build only types + sequential operator, benchmark, then decide)

Implement only Phases 1-2 (type foundation + composition operators), benchmark sequential operator overhead against flat middleware, and decide whether to proceed based on results.

**Pros:** Cheaper, faster to abandon if the approach is unpromising, directly respects the RFC's Phase 2 gating conditions.
**Cons:** May not demonstrate enough of the theory to fairly evaluate it — the RFC's thesis is about the *combination* of monitoring, workspace, and composition, not operators in isolation. A partial prototype might fail for incidental reasons (adapter overhead, test scaffolding cost) rather than fundamental ones.
**Why not chosen as primary approach:** The PO has decided to be ambitious and implement the full system. However, this alternative's wisdom is preserved through **hard decision gates** embedded in the phase plan (Gate A after Phase 3, Gate B after Phase 5) that implement the RFC's gating conditions and provide honest off-ramps.

## Scope

### In-Scope

- Cognitive module type system (`CognitiveModule<I,O,S,Mu,Kappa>`)
- All 4 composition operators + bounded tower with `CompositionError` (compile-time + runtime validation)
- Port-mediated workspace with typed read/write access, pluggable salience, capacity enforcement
- Provider adapter bridging `AgentProvider.invoke()` to `step()` contract
- Control policy enforcement (directive validation, spawn gating)
- All 8 cognitive modules (4 object-level + 4 meta-level) as initial implementations
- 8-phase cognitive cycle with default-interventionist pattern, error handling, cycle budget
- `createCognitiveAgent()` composition function with separate `CognitiveAgent` interface
- `asFlatAgent()` adapter for Agent interop
- Cognitive event types extending `AgentEvent` (including error and LEARN failure events)
- TraceSink port with InMemoryTraceSink and ConsoleTraceSink
- Testkit: RecordingModule, cognitive builders, cognitive assertions
- Playground: cognitive scenario DSL with integration scenarios
- Two hard decision gates (Gate A, Gate B) implementing RFC gating conditions

### Out-of-Scope

- Mathematical formalization (category theory, sheaf theory, process algebra) — theory work, deferred
- System 1/2 compilation mechanism — RFC open research question Q8
- Biological fidelity — explicitly disclaimed by RFC
- Production deployment in bridge — L3 library validation only, bridge integration is a follow-up PRD
- Validation experiments — experiments follow implementation (EXP-series pattern), not part of this PRD
- Provider changes — `@methodts/pacta-provider-claude-cli` and `@methodts/pacta-provider-anthropic` are unaffected
- Workspace persistence port — deferred until a consumer exists (follow-up PRD)

### Non-Goals

- Replacing the existing flat middleware model — cognitive composition is a parallel path, not a replacement
- Achieving production-grade performance — this is research infrastructure; optimization follows validation
- Proving the cognitive composition thesis — this PRD builds the infrastructure; EXP-series validates it

## Implementation Phases

### Phase 1: Type Foundation + Provider Adapter

The leaf — every other phase depends on these types.

Files:
- `packages/pacta/src/cognitive/algebra/module.ts` — new — CognitiveModule, StepResult, StepError, ModuleId, ModuleConfig, MonitoringSignal (base + per-module discriminated union), ControlDirective (base), CompositionError
- `packages/pacta/src/cognitive/algebra/workspace-types.ts` — new — WorkspaceReadPort, WorkspaceWritePort, WorkspaceEntry, WorkspaceFilter, SalienceFunction, SalienceContext, WorkspaceConfig
- `packages/pacta/src/cognitive/algebra/trace.ts` — new — TraceRecord (module ID, phase, timestamp, input hash, output summary, monitoring signal, state hash, duration, token usage), TraceSink interface
- `packages/pacta/src/cognitive/algebra/control-policy.ts` — new — ControlPolicy, ControlPolicyViolation
- `packages/pacta/src/cognitive/algebra/events.ts` — new — CognitiveModuleStep, CognitiveMonitoringSignal, CognitiveControlDirective, CognitiveControlPolicyViolation, CognitiveWorkspaceWrite, CognitiveWorkspaceEviction, CognitiveCyclePhase, CognitiveLEARNFailed, CognitiveCycleAborted
- `packages/pacta/src/cognitive/algebra/provider-adapter.ts` — new — ProviderAdapter interface, AdapterConfig, ProviderAdapterResult, createProviderAdapter() factory
- `packages/pacta/src/cognitive/algebra/index.ts` — new — algebra barrel
- `packages/pacta/src/events.ts` — modified — extend AgentEvent union with cognitive event types

Tests:
- `packages/pacta/src/cognitive/algebra/__tests__/module.test.ts` — new — 5 scenarios
  1. CognitiveModule interface compiles with generic parameters
  2. StepResult carries output, state, monitoring, and optional error
  3. MonitoringSignal discriminated union dispatches correctly
  4. ControlDirective types compose with ControlPolicy validation
  5. CompositionError thrown on invalid composition (runtime)
- `packages/pacta/src/cognitive/algebra/__tests__/provider-adapter.test.ts` — new — 3 scenarios
  1. createProviderAdapter wraps AgentProvider, builds AgentRequest from workspace
  2. Adapter maps AgentResult to ProviderAdapterResult with usage/cost
  3. Adapter propagates errors from provider as StepError

Checkpoint: `npm run build` passes. New types export from algebra barrel.

### Phase 2: Composition Operators

Files:
- `packages/pacta/src/cognitive/algebra/composition.ts` — new — sequential(), parallel(), competitive(), hierarchical() with both compile-time and runtime validation
- `packages/pacta/src/cognitive/algebra/tower.ts` — new — tower(M, n) with budget propagation

Tests:
- `packages/pacta/src/cognitive/algebra/__tests__/composition.test.ts` — new — 12 scenarios
  1. Sequential: produces valid module with composed state
  2. Sequential: runtime CompositionError on type mismatch
  3. Parallel: both execute, merge combines outputs, both signals emitted
  4. Parallel: one module throws — error merge function receives error
  5. Competitive: selector receives both outputs, picks one, selector signal emitted
  6. Competitive: throwing module treated as non-candidate
  7. Hierarchical: target runs first, monitor reacts with kappa
  8. Hierarchical: temporal sequencing verified (target before monitor)
  9. Tower: tower(M, 2) produces 2-level hierarchy
  10. Tower: n > MAX_TOWER_DEPTH throws CompositionError
  11. Tower: budget propagates downward (each level gets fraction)
  12. All operators: stateInvariant() called after each step when present

Checkpoint: `npm run build` passes. Operators produce valid CognitiveModule instances.

### Phase 3: Workspace Engine

Files:
- `packages/pacta/src/cognitive/algebra/workspace.ts` — new — createWorkspace(config), workspace engine with port-mediated access, pluggable SalienceFunction, default formula, per-module write quotas, eviction notifications, FIFO tie-breaking
- `packages/pacta/src/cognitive/algebra/trace-sinks.ts` — new — InMemoryTraceSink, ConsoleTraceSink

Tests:
- `packages/pacta/src/cognitive/algebra/__tests__/workspace.test.ts` — new — 10 scenarios
  1. Write via WorkspaceWritePort adds entry with computed salience
  2. At-capacity write evicts lowest-salience entry
  3. Read via WorkspaceReadPort returns only entries matching type filter
  4. Attend returns top-N by salience within budget
  5. TTL expiry removes entries automatically
  6. Snapshot returns immutable copy
  7. Write log records all operations
  8. Per-module write quota enforced (excess writes rejected)
  9. Uniform-salience eviction uses FIFO deterministically
  10. CognitiveWorkspaceEviction event emitted with eviction reason and salience delta
- `packages/pacta/src/cognitive/algebra/__tests__/trace-sinks.test.ts` — new — 2 scenarios
  1. InMemoryTraceSink stores and retrieves traces
  2. ConsoleTraceSink formats trace without error

Checkpoint: `npm run build` passes. Workspace enforces capacity, quotas, and access contracts.

---

### >>> GATE A — RFC Gating Condition (a)

**Before proceeding to Phase 4:** benchmark `sequential(A, B)` composition overhead using RecordingProvider.

- Measure: token overhead of composed module vs flat middleware for equivalent task
- Measure: wall-clock overhead of composition machinery
- Document results in design notes
- **If overhead is clearly prohibitive (>3x for simplest case):** stop and reassess architecture before building 8 modules
- **If acceptable:** proceed to Phase 4

This gate implements RFC condition: *"at least one composition operator prototyped with measured token cost."*

---

### Phase 4: Object-Level Modules

**Parallelization note:** Phases 4 and 5 are independent at the implementation level — object modules depend on algebra/ types and existing Pacta ports, meta modules depend on algebra/ types and monitoring signal types (defined in Phase 1). Both phases can proceed as parallel commissions.

Files:
- `packages/pacta/src/cognitive/modules/observer.ts` — new — uses WorkspaceWritePort
- `packages/pacta/src/cognitive/modules/memory-module.ts` — new — uses MemoryPort + WorkspaceWritePort
- `packages/pacta/src/cognitive/modules/reasoner.ts` — new — uses ProviderAdapter + WorkspaceReadPort + WorkspaceWritePort
- `packages/pacta/src/cognitive/modules/actor.ts` — new — uses ToolProvider + WorkspaceReadPort

Tests:
- `packages/pacta/src/cognitive/modules/__tests__/observer.test.ts` — new — 4 scenarios
  1. Processes input, writes observation to workspace via write port
  2. Emits noveltyScore monitoring signal
  3. Respects focusFilter control directive
  4. step() rejection produces StepError with recoverable flag
- `packages/pacta/src/cognitive/modules/__tests__/memory-module.test.ts` — new — 4 scenarios
  1. Retrieves from MemoryPort, writes to workspace via write port
  2. Emits retrievalCount and relevanceScore signals
  3. Respects retrievalStrategy control directive
  4. step() rejection on MemoryPort failure
- `packages/pacta/src/cognitive/modules/__tests__/reasoner.test.ts` — new — 4 scenarios
  1. Invokes ProviderAdapter with workspace contents, writes trace
  2. Emits confidence and conflictDetected signals
  3. Respects strategy and effort control directives
  4. Provider adapter error maps to StepError
- `packages/pacta/src/cognitive/modules/__tests__/actor.test.ts` — new — 4 scenarios
  1. Selects and executes action via ToolProvider
  2. Emits unexpectedResult when tool output is anomalous
  3. Respects allowedActions filter from ControlPolicy
  4. Tool execution error maps to StepError

Dependencies: Phase 1 (types + adapter), Phase 3 (workspace ports).

Checkpoint: `npm run build` passes. All 4 object-level modules implement CognitiveModule. Each module has happy path + error path coverage.

### Phase 5: Meta-Level Modules

**Can run in parallel with Phase 4.**

Files:
- `packages/pacta/src/cognitive/modules/monitor.ts` — new — reads AggregatedSignals, maintains abstracted model
- `packages/pacta/src/cognitive/modules/evaluator.ts` — new — reads workspace + signals
- `packages/pacta/src/cognitive/modules/planner.ts` — new — uses ProviderAdapter, issues directives
- `packages/pacta/src/cognitive/modules/reflector.ts` — new — uses MemoryPort, designed for fire-and-forget with state lock

Tests:
- `packages/pacta/src/cognitive/modules/__tests__/monitor.test.ts` — new — 4 scenarios
  1. Aggregates mu from multiple modules, detects conflict
  2. Emits escalation when anomaly crosses threshold
  3. Maintains abstracted model (no direct object-level state access)
  4. step() rejection produces StepError
- `packages/pacta/src/cognitive/modules/__tests__/evaluator.test.ts` — new — 3 scenarios
  1. Estimates progress from workspace + signals
  2. Detects diminishing returns pattern
  3. Respects evaluationHorizon directive
- `packages/pacta/src/cognitive/modules/__tests__/planner.test.ts` — new — 4 scenarios
  1. Decomposes goal, issues control directives
  2. Triggers replan when workspace state changes
  3. Issues strategy-change directive to reasoner
  4. Directives validated against ControlPolicy (rejected directive emits violation event)
- `packages/pacta/src/cognitive/modules/__tests__/reflector.test.ts` — new — 4 scenarios
  1. Reads cycle traces, extracts lessons
  2. Writes distilled memories to MemoryPort
  3. Respects reflectionDepth directive
  4. Failure emits CognitiveLEARNFailed event, does not corrupt state

Dependencies: Phase 1 (types), Phase 3 (workspace). Phase 4 not required (meta reads signal types, not module implementations).

Checkpoint: `npm run build` passes. All 4 meta-level modules implement CognitiveModule. Each has happy path + error path coverage.

---

### >>> GATE B — RFC Gating Condition (b)

**Before proceeding to Phase 6:** demonstrate that the Monitor module catches at least one error class that would be invisible to flat middleware.

- Construct a testkit scenario where: the Reasoner emits low confidence, the Actor produces an unexpected result, and the Monitor detects the compound anomaly
- Verify: a flat `createAgent()` with equivalent reasoning/tool setup does NOT detect this condition
- Document results in design notes
- **If Monitor cannot detect any error class:** reassess meta-level architecture before building the full cycle
- **If Monitor demonstrates detection:** proceed to Phase 6

This gate implements RFC condition: *"metacognitive monitoring demonstrated to catch at least one error class that flat agents miss."*

---

### Phase 6: Cognitive Cycle + Composition Engine

Files:
- `packages/pacta/src/cognitive/engine/cycle.ts` — new — CognitiveCycle orchestrator (8 phases, async/await sequential, default-interventionist, error policy, control policy validation, cycle budget, LEARN fire-and-forget with state lock)
- `packages/pacta/src/cognitive/engine/create-cognitive-agent.ts` — new — createCognitiveAgent(), CognitiveAgent interface, CycleResult (includes trace array)
- `packages/pacta/src/cognitive/engine/as-flat-agent.ts` — new — asFlatAgent() adapter (AgentRequest→cycle, cycle→AgentResult mapping, provider field selection, turn/cost aggregation)
- `packages/pacta/src/cognitive/engine/index.ts` — new — engine barrel
- `packages/pacta/src/cognitive/index.ts` — new — domain barrel (re-exports algebra/, modules/, engine/)
- `packages/pacta/src/index.ts` — modified — add cognitive exports
- `packages/pacta/src/gates/gates.test.ts` — modified — G-BOUNDARY for cognitive sub-domains (algebra/modules/engine isolation) and cognitive/agents isolation

Tests:
- `packages/pacta/src/cognitive/engine/__tests__/cycle.test.ts` — new — 9 scenarios
  1. Full 8-phase cycle executes in order with all modules
  2. Default-interventionist: MONITOR/CONTROL skipped when signals below threshold
  3. Default-interventionist: MONITOR/CONTROL fire when signals cross threshold
  4. LEARN phase fire-and-forget (does not block cycle return)
  5. LEARN failure emits CognitiveLEARNFailed event, does not corrupt next cycle
  6. Workspace state threads correctly through phases via typed ports
  7. CognitiveCyclePhase events emitted at each boundary
  8. Module step() error triggers CycleErrorPolicy (abort path)
  9. Module step() error triggers CycleErrorPolicy (skip path)
- `packages/pacta/src/cognitive/engine/__tests__/create-cognitive-agent.test.ts` — new — 5 scenarios
  1. createCognitiveAgent returns CognitiveAgent with invoke()
  2. CognitiveAgent.invoke() runs cognitive cycle and returns CycleResult with traces
  3. Invalid module config throws at composition time
  4. ControlPolicy violation emits event and rejects directive
  5. CycleBudget exceeded stops cycle gracefully
- `packages/pacta/src/cognitive/engine/__tests__/as-flat-agent.test.ts` — new — 4 scenarios
  1. asFlatAgent() returns valid Agent interface
  2. AgentRequest prompt maps to Observer input
  3. CycleResult maps to AgentResult (token aggregation, turn = cycle count)
  4. Abort signal propagates through adapter to all module steps
- `packages/pacta/src/cognitive/engine/__tests__/integration.test.ts` — new — 3 scenarios
  1. Full CognitiveAgent with RecordingProvider: prompt→cycle→result end-to-end
  2. Monitor intervenes mid-cycle, control directive changes Reasoner strategy
  3. asFlatAgent() used where Agent is expected — full round-trip

Checkpoint: `npm run build` passes. `npm test` passes. createCognitiveAgent() produces working agent. End-to-end integration verified.

### Phase 7: Testkit + Playground + Docs

Files:
- `packages/pacta-testkit/src/recording-module.ts` — new — RecordingModule (captures step invocations, scripted responses)
- `packages/pacta-testkit/src/cognitive-builders.ts` — new — CognitiveModuleBuilder, WorkspaceBuilder, CycleConfigBuilder
- `packages/pacta-testkit/src/cognitive-assertions.ts` — new — assertModuleStepCalled, assertMonitoringSignalEmitted, assertWorkspaceContains, assertCyclePhaseOrder
- `packages/pacta-testkit/src/index.ts` — modified — export new cognitive test helpers
- `packages/pacta-playground/src/cognitive-scenario.ts` — new — cognitive scenario DSL with cycle-aware assertions
- `packages/pacta-playground/src/index.ts` — modified — export cognitive scenario support
- `docs/arch/cognitive-composition.md` — new — architecture doc for cognitive domain
- `docs/arch/pacta.md` — modified — add cognitive composition section
- `docs/guides/cognitive-composition.md` — new — usage guide
- `CLAUDE.md` — modified — add cognitive domain to package table
- `docs/rfcs/001-cognitive-composition.md` — modified — add implementation status

Tests:
- `packages/pacta-testkit/src/recording-module.test.ts` — new — 3 scenarios
  1. RecordingModule captures step invocations
  2. Scripted responses play back in order
  3. Records monitoring signals emitted
- `packages/pacta-playground/src/cognitive-scenario.test.ts` — new — 3 scenarios
  1. Cognitive scenario executes with recording modules
  2. Phase order assertion works
  3. Monitor intervention detection works

Dependencies: Phase 6.

Checkpoint: `npm run build` passes. `npm test` passes across all packages. Docs written.

## Success Criteria

### Functional

| Criterion | Target | Measurement |
|-----------|--------|-------------|
| Type safety | 0 `any` casts in cognitive domain | grep scan |
| Composition correctness | All 4 operators produce valid modules | composition.test.ts (12 scenarios) |
| Workspace access control | All module writes go through typed ports | workspace.test.ts + gate tests |
| Cycle phase order | 8/8 phases in correct order | cycle.test.ts scenario 1 |
| Default-interventionist | Skips when below threshold, fires when above | cycle.test.ts scenarios 2-3 |
| Error handling | Module failures handled per CycleErrorPolicy | cycle.test.ts scenarios 8-9 |
| Control policy | Invalid directives rejected with event | create-cognitive-agent.test.ts scenario 4 |
| Backward compatibility | All existing pacta tests pass unchanged | `npm test` in pacta package |

### Non-Functional

| Criterion | Target | Measurement |
|-----------|--------|-------------|
| G-PORT gate | 0 runtime dependencies | gates.test.ts |
| G-BOUNDARY gate | 0 cross-domain imports (algebra/modules/engine + cognitive/agents) | gates.test.ts |
| G-LAYER gate | 0 upward layer violations | gates.test.ts |
| Test coverage | Every public function has >= 1 happy path and >= 1 error path test | Review |
| Integration tests | >= 3 end-to-end scenarios | integration.test.ts |

### Architecture

| Criterion | Target | Measurement |
|-----------|--------|-------------|
| Module interface consistency | All 8 modules implement CognitiveModule | Compilation + per-module tests |
| Observability | Every module step emits TraceRecord consumed by TraceSink | trace assertions in tests |
| Sub-domain isolation | algebra/, modules/, engine/ have no forbidden imports | gates.test.ts |

### Theory Linkage

| Criterion | Target | Measurement |
|-----------|--------|-------------|
| Gate A passed | Sequential operator benchmarked, overhead documented | Design notes |
| Gate B passed | Monitor catches >= 1 error class invisible to flat middleware | Design notes |
| EXP-series drafted | Follow-up experiment plan exists before PRD marked complete | File exists |

## Acceptance Criteria

### AC-01: Cognitive module type compiles with generic parameters

**Given** a TypeScript module implementing `CognitiveModule<WorkspaceSnapshot, ReasoningTrace, ChainOfThought, ReasonerMonitoring, StrategyDirective>`
**When** the module is compiled
**Then** the compiler accepts the implementation with full type safety (no `any` casts)
**Test location:** `packages/pacta/src/cognitive/algebra/__tests__/module.test.ts` scenario 1
**Automatable:** yes

### AC-02: Sequential composition produces valid module

**Given** module A with output type `X` and module B with input type `X`
**When** `sequential(A, B)` is called
**Then** the result is a valid `CognitiveModule` with A's input type and B's output type, composed state, and both monitoring signals
**Test location:** `packages/pacta/src/cognitive/algebra/__tests__/composition.test.ts` scenario 1
**Automatable:** yes

### AC-03: Composition operators validate at both compile-time and runtime

**Given** module A with output type `X` and module B with input type `Y` where X !== Y
**When** `sequential(A, B)` is called at runtime
**Then** `CompositionError` is thrown with descriptive message
**Test location:** `packages/pacta/src/cognitive/algebra/__tests__/composition.test.ts` scenario 2
**Automatable:** yes

### AC-04: Parallel composition merges outputs and handles errors

**Given** modules A and B and a merge function
**When** `parallel(A, B, merge)` is called and module A throws
**Then** the error merge function receives A's error and B's output
**Test location:** `packages/pacta/src/cognitive/algebra/__tests__/composition.test.ts` scenario 4
**Automatable:** yes

### AC-05: Competitive composition selects winner

**Given** modules A and B and a selector
**When** `competitive(A, B, selector)` is called and the composed module steps
**Then** both modules execute, selector receives both outputs, and only the selected output is returned
**Test location:** `packages/pacta/src/cognitive/algebra/__tests__/composition.test.ts` scenario 5
**Automatable:** yes

### AC-06: Hierarchical composition enforces temporal sequencing

**Given** a monitor module M and a target module T composed via `hierarchical(M, T)`
**When** the composed module steps
**Then** T runs first producing monitoring signal mu, then M reacts producing control directive kappa for the next step
**Test location:** `packages/pacta/src/cognitive/algebra/__tests__/composition.test.ts` scenario 8
**Automatable:** yes

### AC-07: Workspace enforces capacity via typed ports

**Given** a workspace with capacity 5, a module with WorkspaceWritePort, and 5 existing entries
**When** the module writes a new entry
**Then** the workspace computes salience centrally, evicts the lowest-salience entry (FIFO on tie), and emits CognitiveWorkspaceEviction
**Test location:** `packages/pacta/src/cognitive/algebra/__tests__/workspace.test.ts` scenario 2
**Automatable:** yes

### AC-08: Per-module write quota enforced

**Given** a module with write quota of 3 entries per cycle
**When** the module attempts a 4th write
**Then** the write is rejected and an error event is emitted
**Test location:** `packages/pacta/src/cognitive/algebra/__tests__/workspace.test.ts` scenario 8
**Automatable:** yes

### AC-09: Provider adapter bridges AgentProvider to step() contract

**Given** a ProviderAdapter wrapping a RecordingProvider
**When** the adapter is invoked with a workspace snapshot
**Then** the RecordingProvider receives a valid AgentRequest built from workspace contents, and the adapter returns a ProviderAdapterResult with usage/cost
**Test location:** `packages/pacta/src/cognitive/algebra/__tests__/provider-adapter.test.ts` scenario 1
**Automatable:** yes

### AC-10: Reasoner module invokes ProviderAdapter

**Given** a reasoner module with a ProviderAdapter wrapping RecordingProvider
**When** the reasoner's step() is called with workspace contents
**Then** the adapter is invoked, and the reasoner writes a reasoning trace to the workspace via WorkspaceWritePort
**Test location:** `packages/pacta/src/cognitive/modules/__tests__/reasoner.test.ts` scenario 1
**Automatable:** yes

### AC-11: Monitor detects conflict from aggregated signals

**Given** a monitor module receiving AggregatedSignals: reasoner (confidence: 0.3) and actor (unexpectedResult: true)
**When** the monitor's step() is called
**Then** the monitor emits `{ type: 'monitor', anomalyDetected: true }` with escalation message
**Test location:** `packages/pacta/src/cognitive/modules/__tests__/monitor.test.ts` scenario 1
**Automatable:** yes

### AC-12: Control policy rejects invalid directives

**Given** a ControlPolicy that disallows 'spawn' directives
**When** the Planner issues a directive with type 'spawn'
**Then** the cycle orchestrator rejects it and emits CognitiveControlPolicyViolation event
**Test location:** `packages/pacta/src/cognitive/engine/__tests__/create-cognitive-agent.test.ts` scenario 4
**Automatable:** yes

### AC-13: Cognitive cycle executes 8 phases in order

**Given** a CognitiveCycle with all 8 modules configured
**When** a cycle is executed
**Then** phases fire: OBSERVE, ATTEND, REMEMBER, REASON, MONITOR, CONTROL, ACT, LEARN
**And** CognitiveCyclePhase events are emitted at each boundary
**Test location:** `packages/pacta/src/cognitive/engine/__tests__/cycle.test.ts` scenario 1
**Automatable:** yes

### AC-14: Default-interventionist skipping

**Given** a CognitiveCycle with threshold policy checking confidence > 0.5
**When** all object-level modules report confidence > 0.5
**Then** MONITOR and CONTROL phases are skipped
**Test location:** `packages/pacta/src/cognitive/engine/__tests__/cycle.test.ts` scenario 2
**Automatable:** yes

### AC-15: Default-interventionist triggering

**Given** a CognitiveCycle with threshold policy checking confidence > 0.5
**When** the reasoner reports confidence of 0.2
**Then** MONITOR and CONTROL phases fire, and control directives are applied to the next cycle
**Test location:** `packages/pacta/src/cognitive/engine/__tests__/cycle.test.ts` scenario 3
**Automatable:** yes

### AC-16: Module step() error handled by CycleErrorPolicy

**Given** a CognitiveCycle with errorPolicy.default = 'skip'
**When** the Reasoner's step() rejects
**Then** the cycle skips the REASON phase, emits CognitiveCycleAborted for that phase, and continues to MONITOR
**Test location:** `packages/pacta/src/cognitive/engine/__tests__/cycle.test.ts` scenario 9
**Automatable:** yes

### AC-17: LEARN failure does not corrupt state

**Given** a Reflector whose step() rejects during LEARN phase
**When** the next cycle executes
**Then** the Reflector's state is intact (state-lock rollback) and CognitiveLEARNFailed was emitted
**Test location:** `packages/pacta/src/cognitive/engine/__tests__/cycle.test.ts` scenario 5
**Automatable:** yes

### AC-18: asFlatAgent() returns valid Agent interface

**Given** a CognitiveAgent
**When** `asFlatAgent(cognitive)` is called
**Then** the returned Agent has invoke(), pact, and provider fields, and invoke() maps AgentRequest through the cognitive cycle to AgentResult
**Test location:** `packages/pacta/src/cognitive/engine/__tests__/as-flat-agent.test.ts` scenario 1
**Automatable:** yes

### AC-19: End-to-end integration

**Given** a full CognitiveAgent with RecordingProvider, all 8 RecordingModules, and a workspace
**When** invoke() is called with a prompt
**Then** the prompt flows through Observer→workspace→Reasoner→Actor, traces are captured by InMemoryTraceSink, and CycleResult contains the full trace array
**Test location:** `packages/pacta/src/cognitive/engine/__tests__/integration.test.ts` scenario 1
**Automatable:** yes

### AC-20: Tower bounds enforcement

**Given** a module M and MAX_TOWER_DEPTH of 3
**When** `tower(M, 4)` is called
**Then** a CompositionError is thrown
**Test location:** `packages/pacta/src/cognitive/algebra/__tests__/composition.test.ts` scenario 10
**Automatable:** yes

### AC-21: G-BOUNDARY gate — cognitive sub-domain isolation

**Given** the Pacta source tree
**When** the G-BOUNDARY gate test runs
**Then** modules/ does not import from engine/, engine/ does not import from modules/, and cognitive/ does not import from agents/
**Test location:** `packages/pacta/src/gates/gates.test.ts`
**Automatable:** yes

## Risks & Mitigations

| Risk | Severity | Likelihood | Impact | Mitigation |
|------|----------|-----------|--------|-----------|
| Provider adapter is complex — step() to invoke() mapping introduces overhead or semantic loss | High | Medium | Modules produce degraded reasoning or incorrect state threading | Define adapter in Phase 1 with explicit test coverage. Iterate on the mapping before building modules. Gate A benchmarks overhead. |
| Workspace salience heuristics produce degenerate eviction | High | Medium | Critical context evicted, agent loses coherence | Pluggable SalienceFunction with tested default. Per-module write quotas. FIFO tie-breaking. Adversarial test scenarios. |
| Default-interventionist thresholds hard to tune | Medium | High | Meta fires too often (cost) or too rarely (misses) | Configurable ThresholdPolicy (predicate or field-based). CycleBudget limits worst case. Meta-intervention cooldown. |
| Type-level combinatorial explosion with 5 generic parameters | Medium | Medium | API unusable with deep compositions | Evaluate in Phase 1. If inference struggles, reduce to 3 params per Architect recommendation. Type aliases for common cases. |
| Workspace shared state enables cross-module interference | High | Low | Module poisons context for others | Port-mediated access (typed read/write ports). Per-module quotas. Central salience normalization. Eviction notifications. |
| Meta-level control directives weaponize Actor | Medium | Low | Agent executes unintended actions | ControlPolicy validated by cycle orchestrator. Sub-agent spawning requires explicit grant. |
| Theory doesn't translate — validation experiments fail | High | Medium | Research direction abandoned | Gate A and Gate B provide early off-ramps. This PRD builds infrastructure; abandonment criteria apply to theory, not code. |
| Module step() failures cascade through cycle | Medium | Medium | Cycle crashes or enters inconsistent state | StepError type. CycleErrorPolicy (abort/skip/retry). State-lock on async LEARN. |

## Dependencies & Cross-Domain Impact

### Depends On

- PRD 027: Pacta SDK — core types, ports, composition engine
- PRD 028: Pacta Print-Mode Convergence — enriched CLI provider

### Enables

- Validation experiments (EXP-series) — cognitive agents vs flat agents on benchmark tasks
- Bridge integration PRD — promote cognitive agents from L3 to L4
- Mathematical formalization — implementation informs which formalisms are worth pursuing

### Blocks / Blocked By

None. PRD 027-028 are complete.

## Documentation Impact

| Document | Action | Details |
|----------|--------|---------|
| `docs/arch/pacta.md` | Update | Add cognitive composition section |
| `docs/arch/cognitive-composition.md` | Create | Dedicated arch doc: sub-domain structure, module contracts, cycle semantics, workspace access model |
| `docs/guides/cognitive-composition.md` | Create | Usage guide: creating cognitive agents, configuring workspace, tuning thresholds |
| `CLAUDE.md` | Update | Add cognitive domain to package table, note sub-domain structure |
| `docs/rfcs/001-cognitive-composition.md` | Update | Add implementation status linking to PRD 030 |

## Open Questions

| # | Question | Owner | Deadline |
|---|----------|-------|----------|
| OQ-1 | What is the right default monitoring threshold for the default-interventionist pattern? | PO | Phase 6 |
| OQ-2 | Should the Reflector module's async LEARN phase use a separate provider invocation or share the main agent's context? | Implementation agent | Phase 5 |

*Resolved: OQ-1 from draft (runtime vs compile-time validation) — answer: both. Compile-time via TypeScript generics, runtime via defensive CompositionError checks. CompositionError defined in Phase 1.*

## Implementation Status

| Phase | Status | Notes |
|-------|--------|-------|
| Phase 1: Type Foundation + Provider Adapter | pending | |
| Phase 2: Composition Operators | pending | |
| Phase 3: Workspace Engine | pending | |
| Gate A: Sequential operator benchmark | pending | RFC gating condition (a) |
| Phase 4: Object-Level Modules | pending | Parallelizable with Phase 5 |
| Phase 5: Meta-Level Modules | pending | Parallelizable with Phase 4 |
| Gate B: Monitor error detection demo | pending | RFC gating condition (b) |
| Phase 6: Cognitive Cycle + Engine | pending | |
| Phase 7: Testkit + Playground + Docs | pending | |

## Review History

### Adversarial Review (2026-03-27)

6 advisors (Skeptic, Architect, Implementor, Historian, Security, Operations) produced 32 findings: 3 CRITICAL, 14 HIGH, 14 MEDIUM, 1 LOW. Synthesizer consensus classified 12 as fix-now, 4 as defer, 2 as acknowledge. All fixes applied in this revision.

**Key changes from review:**
- Problem statement restructured: honest framing leads (F-S-2)
- Hard decision gates added implementing RFC gating conditions (F-S-1, F-S-6)
- Workspace redesigned with port-mediated access (F-A-1, F-SEC-1)
- ProviderAdapter interface specified (F-I-1)
- CognitiveAgent separated from Agent with asFlatAgent() adapter (F-A-2, F-I-4)
- cognitive/ split into algebra/, modules/, engine/ sub-domains (F-A-3)
- Concrete SalienceFunction with pluggable default formula (F-I-2)
- Async execution model specified with error handling (F-I-3, F-O-1)
- TraceSink port with InMemoryTraceSink and ConsoleTraceSink (F-O-2)
- ControlPolicy enforcement with directive validation (F-SEC-2)
- OQ-1 resolved: both compile-time + runtime validation (F-H-4)
- Workspace persistence port removed — premature (F-H-6)
- Alternative 4 (incremental validation) added (F-S-5)
- Parallelization opportunities marked in phases (F-H-1)
- Usage guide added to documentation impact (F-H-2)
- Test strategy shifted from count target to coverage + integration (F-I-6)
