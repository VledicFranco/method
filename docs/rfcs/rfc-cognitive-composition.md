# RFC: Calculus of Cognitive Composition

**Status:** Draft — exploratory theory document
**Author:** PO + Lysica
**Date:** 2026-03-25
**Applies to:** `@method/pacta` (future phases), potentially `pv-agi`
**Organization:** Vidtecci

## Motivation

Current agent reasoning techniques (ReAct, Reflexion, CoT, think tool) are ad-hoc patterns
that mirror cognitive processes without deliberate design. This RFC explores whether
deliberately modeling the cognitive architecture — drawing on the study of human cognitive
functions — produces composable, modular agent designs with better structure than flat
prompt pipelines.

The approach: treat cognitive science research as a source of **design patterns** for
information-processing systems, not as biological claims about LLMs. The structural patterns
(buffer-mediated parallelism, competitive selection, monitor/control hierarchies) are valuable
regardless of whether they evolved for biological reasons. LLMs face analogous information-
processing constraints — bounded context, attention allocation, strategy selection — even
though the underlying mechanisms differ.

Five decades of cognitive science identified composition patterns worth studying:
- ACT-R: buffer-mediated parallel modules with serial decisions
- SOAR: impasse→subgoal→chunk (learning through compilation)
- GWT: competitive access to a shared workspace
- Nelson & Narens: monitor/control metacognition (recursive)
- CLARION: dedicated metacognitive subsystem with dual implicit/explicit processing

No agent framework grounds itself in these patterns. This RFC proposes a compositional
calculus of cognitive modules that Pacta can implement.

> **Epistemological note:** This RFC uses cognitive architectures as *design inspiration*,
> not as biological validation. The claim is not "LLMs are brains" but "the compositional
> structures discovered by cognitive science are useful for decomposing agent behavior."
> Where the analogy breaks (and it does — see §Limitations), the RFC should stand on its
> engineering merits alone.

## Goal

Define a **compositional calculus of cognitive modules** where:

1. Each module has typed inputs, outputs, monitoring signals, and control signals
2. Modules compose via known patterns (sequential, parallel, competitive, hierarchical)
3. Metacognition is a first-class composition operator, not an afterthought
4. The calculus is inspired by cognitive science and amenable to future formalization
5. The framework is implementable in TypeScript as Pacta port interfaces

## Part I: The Cognitive Module

### Definition

A cognitive module **M** is a tuple:

```
M = (I, O, S, μ, κ)
```

Where:
- **I** : Input type — what the module reads from the workspace
- **O** : Output type — what the module writes to the workspace
- **S** : Internal state — private, opaque to other modules
- **μ** : Monitoring signal type — what the module reports upward (to meta-level)
- **κ** : Control signal type — what the module accepts from above (from meta-level)

A module's **execution** is:

```
step : (I, S, κ) → (O, S', μ)
```

Given input, current state, and a control directive, produce output, updated state, and
a monitoring signal. This is the fundamental operation.

### Examples

```
Reasoner = (
  I: WorkspaceSnapshot,
  O: ReasoningTrace,
  S: ChainOfThought,
  μ: { confidence: number, conflictDetected: boolean },
  κ: { strategy: 'cot' | 'think' | 'plan', effort: Level }
)

Monitor = (
  I: MonitoringSignal[],     // aggregated μ from all object-level modules
  O: ControlDirective[],     // κ directives to send downward
  S: MetacognitiveModel,     // abstracted model of object-level state
  μ: { escalation?: string },// monitoring to meta-meta (if recursive)
  κ: never                   // top-level monitor accepts no control
)
```

## Part II: Composition Operators

### Sequential (>>)

Module A's output feeds module B's input:

```
A >> B : (Iₐ, Sₐ×Sᵦ, κₐ×κᵦ) → (Oᵦ, Sₐ'×Sᵦ', μₐ×μᵦ)
```

Both monitoring signals are emitted. Both accept independent control.
This models the perception → reasoning → action pipeline.

### Parallel (|)

Modules A and B execute simultaneously on the same input:

```
A | B : (I, Sₐ×Sᵦ, κₐ×κᵦ) → (Oₐ×Oᵦ, Sₐ'×Sᵦ', μₐ×μᵦ)
```

Outputs must be merged. This models multi-modal processing.

> **Caveat:** Commutativity (A | B ≅ B | A) holds only for pure modules. If both modules
> write to a shared workspace, write order may affect results. Practical implementations
> should either enforce independent workspace regions or define a merge strategy.

### Competitive (<|>)

Modules A and B both produce outputs; a selector chooses:

```
A <|> B : (I, Sₐ×Sᵦ×Sₛ, κₐ×κᵦ) → (Oₐ|Oᵦ, Sₐ'×Sᵦ'×Sₛ', μₐ×μᵦ×μₛ)
```

Where the selector has its own state and monitoring signal. Inspired by GWT's
competitive access — modules compete for workspace influence.

> **Cost note:** Competitive composition runs all candidate modules and discards all but
> one output. This is N× the cost of a single module. Use selectively — for strategy
> selection or high-stakes decisions, not routine steps.

### Hierarchical (▷)

Module A monitors and controls module B:

```
A ▷ B where:
  B.step(input, state_b, control) → (output, state_b', monitoring)
  A.step(monitoring, state_a, _)  → (control', state_a', meta_monitoring)
```

A reads B's monitoring signals and issues control directives. Inspired by Nelson & Narens'
metacognitive architecture. A maintains an abstracted model of B (not direct access).

> **Concurrency note:** The hierarchy creates a feedback cycle (A reads B's μ, B reads A's κ).
> This is resolved by temporal sequencing: B runs first, A reacts on the next step. This is
> a standard control loop, not a deadlock, but the scheduling discipline must be specified
> in implementation.

### Recursive Tower — tower(M, n)

A bounded metacognitive tower:

```
tower(M, n) = M ▷ M ▷ ... (n levels)
```

In practice, bounded to 2-3 levels (cognitive science suggests diminishing returns beyond this).
Level 0: do the task. Level 1: monitor how the task is going. Level 2: assess whether
the monitoring strategy is working.

> **Note:** This is bounded recursive application, not a fixed point in the domain-theoretic
> sense. No continuity or CPO structure is assumed. The notation `tower` reflects the
> bounded, practical nature of the construction.

## Part III: The Workspace (Shared Context)

The **workspace** is the shared context that all modules read from and compete to write to.
It is the agent's active context — the information available for reasoning in the current
cycle. Inspired by GWT's shared workspace concept, though the implementation here is closer
to a bounded blackboard with salience-based eviction than a true broadcast architecture.

> **Design note:** GWT's key mechanism is *coalition formation + broadcast*: processors form
> coalitions that compete, and the winning coalition's content is broadcast to all processors
> simultaneously. This RFC simplifies to competitive writes with salience scoring. A future
> revision may add explicit broadcast semantics if the simpler model proves insufficient.

```
W = {
  contents: Map<string, WorkspaceEntry>,
  capacity: number,               // token/slot budget
  attention: SelectionFunction,   // determines which entries persist
}

WorkspaceEntry = {
  source: ModuleId,
  content: unknown,
  salience: number,               // competition weight
  timestamp: number,
  ttl?: number,                   // automatic decay
}
```

**Attention** is the gating function: when the workspace is at capacity, new entries compete
with existing entries based on salience. Low-salience entries decay and are evicted.

> **Salience computation:** Salience is computed heuristically by the producing module at
> write time — recency, source priority, and keyword overlap with current goals. This is a
> cheap deterministic computation, not an LLM call. LLM-scored salience is an optional
> refinement applied asynchronously, not the default path.

## Part IV: The Two-Level Architecture

Every Pacta agent has an object level and a meta level. This decomposition draws on
the study of human cognitive function — each module is named for its functional role
and is loosely analogous to a cognitive subsystem studied in neuroscience and cognitive
psychology. The analogy provides design vocabulary and decomposition rationale; the
modules stand or fall on their engineering merit.

### Cognitive Analogy

| Module | Functional Role | Cognitive Analogy |
|--------|----------------|-------------------|
| Reasoner | Deliberate reasoning, chain-of-thought | Prefrontal cortex executive function, System 2 processing |
| Actor | Action selection and execution | Basal ganglia gating, habit vs goal-directed behavior |
| Observer | Processes tool results, environment | Sensory cortex perception and feature extraction |
| Memory | Episodic, semantic, procedural retrieval | Hippocampal binding, long-term memory systems |
| Monitor | Conflict detection, error monitoring | Anterior cingulate conflict monitoring |
| Evaluator | Outcome prediction, value estimation | Orbitofrontal value computation |
| Planner | Goal decomposition, strategy selection | Anterior prefrontal abstract planning |
| Reflector | Offline learning, experience distillation | Default mode network consolidation |

> **Limitation:** These analogies are approximate. Brain regions do not map cleanly to
> discrete functions — modern neuroscience emphasizes distributed networks over modular
> localization. The table names the *inspiration*, not a biological claim. The module
> decomposition is justified by separation of concerns, not by neuroscience.

### Structure

```
Agent = MetaLevel ▷ ObjectLevel

ObjectLevel = Workspace + {
  reasoner:  Module,   // deliberate reasoning
  actor:     Module,   // action selection and execution
  observer:  Module,   // processes tool results, environment
  memory:    Module,   // episodic, semantic, procedural retrieval
}

MetaLevel = {
  monitor:   Module,   // conflict detection, error monitoring
  evaluator: Module,   // outcome prediction, value estimation
  planner:   Module,   // goal decomposition, strategy selection
  reflector: Module,   // offline learning, experience distillation
}
```

> **Simplification note:** This two-level decomposition is intentionally simpler than
> CLARION's four subsystems (action-centered, non-action-centered, motivational,
> meta-cognitive). The motivational subsystem (drives, goal generation) is collapsed
> into the planner module. The meta-cognitive subsystem is the entire MetaLevel.
> ACT-R's one-chunk-per-buffer constraint is not modeled; the workspace capacity
> parameter serves an analogous but coarser role. Nelson & Narens' rich monitoring
> taxonomy (ease-of-learning, judgments-of-learning, feeling-of-knowing) is simplified
> to scalar confidence + conflict detection; the full taxonomy is deferred to implementation.

Information flow:
1. **Object → Meta (monitoring ↑)**: Each object-level module emits monitoring signals
   (confidence, progress, errors, resource usage). These are aggregated and sent to the
   meta-level.
2. **Meta → Object (control ↓)**: The meta-level issues control directives (change strategy,
   increase effort, stop and reflect, escalate to human, spawn sub-agent).
3. **Workspace (shared context)**: Object-level modules compete to write to the workspace.
   The workspace contents are available to all modules and to the meta-level.

### The Cognitive Cycle

Each agent turn executes a cognitive cycle (inspired by LIDA and other cognitive cycle
models; the ordering and phase selection below is this RFC's design, not a faithful
reproduction of any single architecture):

```
1. OBSERVE   — Observer processes new input (tool results, user prompt, environment)
2. ATTEND    — Workspace attention selects what's salient
3. REMEMBER  — Memory retrieves relevant episodic/semantic/procedural knowledge
4. REASON    — Reasoner produces a reasoning trace given workspace contents
5. MONITOR   — Meta-level reads monitoring signals, updates its model
6. CONTROL   — Meta-level issues control directives (continue, re-plan, reflect, stop)
7. ACT       — Actor selects and executes an action (tool call, response, sub-agent spawn)
8. LEARN     — Reflector (async/background) distills the cycle into memory updates
```

Not all steps fire every cycle. MONITOR/CONTROL only intervene when signals cross thresholds
(default-interventionist pattern — fast path handles most cycles, slow deliberation engages
on anomaly).

> **Cost model:** A full 8-phase cycle requires 2-6× the tokens of a single ReAct step.
> The default-interventionist pattern is essential: most cycles should skip MONITOR/CONTROL/
> LEARN, amortizing to a target of <1.5× ReAct cost for routine turns. The meta-level
> engages only when monitoring signals cross thresholds — not every turn.

### Observability

Every module `step` call emits a structured trace record:

- Module ID, phase name, timestamp
- Input hash (not full content — for correlation, not replay)
- Output summary
- Monitoring signal emitted
- Wall-clock duration, token usage (if LLM call)

The workspace maintains a write log. These provide the debugging surface for composed
agents — a developer can trace which module produced which workspace entry and what
monitoring signals triggered meta-level intervention.

## Part V: The System 1/2 Transition

Drawing loosely on SOAR's chunking concept and dual-process theory (Kahneman):

> **Note:** SOAR itself has a uniform production-rule architecture, not a dual-process one.
> The analogy here is that SOAR's chunking (compiling subgoal solutions into productions)
> is *functionally similar* to the System 1/2 transition, not that SOAR implements
> dual-process theory. The framing below is this RFC's design, not a SOAR claim.

- **System 2 (deliberate)**: Full cognitive cycle. Reasoner engages, monitor active,
  planning explicit. Expensive (high token use, slow).
- **System 1 (compiled)**: Cached response. Actor pattern-matches from procedural memory,
  bypasses reasoner. Cheap (low token use, fast).

**Compilation**: When the same reasoning pattern produces the same action type N times,
the Reflector extracts it as a cached production rule. Future matching inputs skip the
Reasoner and go directly to the Actor.

**Escalation**: When the Actor's cached response produces a monitoring signal above the
confidence threshold (anomaly, unexpected result), control escalates from System 1 back
to System 2. The Reasoner re-engages.

> **Open implementation question:** The compilation mechanism described above requires
> detecting "same reasoning pattern" over natural-language traces — an unsolved problem.
> Candidate implementations include: prompt caching with pattern keys, few-shot retrieval
> from procedural memory, embedding similarity matching, or fine-tuned adapters. This is
> speculative and moved to Open Research Questions (Q8).

## Part VI: Mathematical Directions

> **Preamble:** This section sketches directions for future formalization. It does not
> present completed proofs or rigorous constructions. Every claim below is a conjecture
> to be verified, not an established result. The purpose is to identify which mathematical
> frameworks are most promising for formalizing the composition operators. This section
> does not yet inform implementation.

### Category-Theoretic Sketch

**Objects**: Cognitive module types (parameterized by I, O, S, μ, κ).

**Morphisms**: Module transformations — functions that convert one module into another
while preserving the step signature. (The precise morphism type — likely a simulation
relation — remains to be defined.)

**Conjecture**: Each composition operator (>>, |, <|>, ▷) can be viewed as a mapping from
pairs of modules to composed modules. Formalizing this as a functor requires defining the
morphism action, which is future work. The sequential operator (>>) is partial (output type
of A must match input type of B), suggesting a typed composition structure (bicategory or
multicategory) rather than a total functor on a product category.

**Properties to investigate** (conjectured, not proven):
- Sequential composition is associative: (A >> B) >> C ≅ A >> (B >> C)
  (requires state-threading purity assumptions to be stated)
- Parallel composition is commutative for pure modules: A | B ≅ B | A
  (shared workspace writes may break this — see Part III caveat)
- Hierarchical composition is not commutative: A ▷ B ≇ B ▷ A (monitoring is asymmetric)

**Missing structure**: No identity element has been identified. No interaction laws between
operators have been stated (e.g., does >> distribute over |?). Until these are established,
this is a compositional framework, not an algebra in the strict mathematical sense.

### Sheaf-Theoretic Analogy (Binding)

> This is a conceptual analogy, not a formal sheaf construction. No topology or presheaf
> has been defined.

The binding problem — how separate modules produce coherent output — can be *conceptualized*
in sheaf-theoretic terms: local module outputs are "sections" over their domains, and
coherent agent behavior requires "gluing" them into a global section. When modules contradict
each other, the failure to glue is analogous to a cohomological obstruction.

Making this precise would require: (1) defining a topology on the module space, (2)
constructing a presheaf of outputs, (3) verifying the gluing axiom. This is a research
direction, not a completed formalization.

### Process-Algebraic Direction (Concurrency)

**Processes**: Each module is a process with typed input/output channels.

**Channels**: Monitoring (μ), control (κ), workspace read/write.

**Synchronization**: Sequential composition = channel linking. Parallel = independent
channels. Competitive = shared channel with arbitration. Hierarchical = asymmetric channels.

**Properties to investigate**: Deadlock freedom, liveness, fairness. The hierarchical
operator's feedback cycle (A reads B's μ, issues κ; B reads κ, produces μ) is resolved
by temporal sequencing but requires careful analysis to prove freedom from circular blocking.
A specific process calculus (e.g., CSP) should be selected and the operators encoded
before these properties can be rigorously claimed.

## Part VII: Open Research Questions

1. **Is the calculus closed under composition?** Does composing two cognitive modules
   via any operator always produce a valid cognitive module? Or are there degenerate
   compositions?

2. **What are the minimal modules?** Is there a smallest set of cognitive modules from
   which all agent behaviors can be composed? The Common Model suggests: reasoner, memory,
   actor, monitor. Is this minimal?

3. **Can metacognitive towers be bounded?** Nelson & Narens allow recursive meta-levels.
   In practice, 2-3 suffice. Is there a formal argument for why?

4. **How does the calculus relate to F1-FTH?** The project's formal theory of methods
   (theory/F1-FTH/) defines methodology execution as a state machine. Cognitive modules
   could be the mechanism that executes methodology steps. What's the formal relationship?

5. **Can sheaf cohomology predict agent failure modes?** If binding failures correspond
   to non-trivial cohomology classes, can we detect potential failures statically from
   the composition structure before runtime?

6. **How do LLM attention mechanisms relate to GWT attention?** The transformer's attention
   mechanism and GWT's competitive broadcast both implement a selection function. Is there
   a formal correspondence?

7. **What is the right granularity?** ACT-R fires one production per 50ms cycle. LLM
   agents take seconds per turn. The granularity mismatch suggests different levels of
   the cognitive cycle operate at different timescales. How to formalize this?

8. **What is the implementation mechanism for System 1/2 compilation?** How can an LLM-based
   agent detect "same reasoning pattern" across natural-language traces and cache the
   result as a reusable production rule? Candidate approaches: embedding similarity,
   few-shot retrieval, explicit rule engines, fine-tuned adapters.

## Validation Criteria

This theory is worth pursuing if:

1. Composed agents using the calculus outperform flat ReAct on multi-step tasks requiring
   strategy shifts (measured: task success rate at equivalent token budgets)
2. The metacognitive tower catches and corrects errors that flat agents miss
   (measured: error recovery rate on adversarial tasks)
3. The workspace capacity mechanism reduces token waste vs. unlimited context
   (measured: tokens consumed per successful task completion)

**Abandonment criteria:** If Pacta Phase 2 prototypes fail all three criteria across
3+ benchmark tasks, the compositional approach should be abandoned in favor of simpler
patterns. The theory is a hypothesis, not a commitment.

## Relationship to Pacta

This RFC is a **theory document**. It defines the calculus; Pacta implements it.

- **Pacta Phase 1** proceeds with flat types (Pact, BudgetContract, etc.) — usable now.
- **Pacta Phase 2** gates on: (a) at least one composition operator (>> or |) prototyped
  with measured token cost, and (b) metacognitive monitoring demonstrated to catch at
  least one error class that flat agents miss. If neither gate passes, the compositional
  approach is shelved.
- The cognitive module types (M = (I, O, S, μ, κ)) can be expressed as TypeScript generics.
- The composition operators (>>, |, <|>, ▷) can be expressed as higher-order functions.
- The workspace can be expressed as a typed store with heuristic salience eviction.

The theory informs the SDK; the SDK validates the theory. They evolve together — but
the theory can be abandoned if the SDK doesn't benefit from it.
