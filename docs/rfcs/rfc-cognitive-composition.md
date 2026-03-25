# RFC: Formal Theory of Cognitive Composition

**Status:** Draft — open for exploration
**Author:** PO + Lysica
**Date:** 2026-03-25
**Applies to:** `@method/pacta` (future phases), potentially `pv-agi`
**Organization:** Vidtecci

## Motivation

Current agent reasoning techniques (ReAct, Reflexion, CoT, think tool) are ad-hoc patterns
that accidentally mirror cognitive processes. If we deliberately model the cognitive architecture,
we get composability (cognitive processes compose in known ways), multimodality (not all
processing is conscious), and metacognition (monitoring and controlling your own reasoning).

Five decades of cognitive science already solved module composition:
- ACT-R: buffer-mediated parallel modules with serial decisions
- SOAR: impasse→subgoal→chunk as System 1/2 compilation
- GWT: competitive broadcast for attention gating
- Nelson & Narens: monitor/control metacognition (recursive)
- CLARION: dedicated metacognitive subsystem

No agent framework grounds itself in these patterns. This RFC proposes a formal algebra of
cognitive composition that Pacta can implement.

## Goal

Define a **compositional algebra of cognitive modules** where:

1. Each module has typed inputs, outputs, monitoring signals, and control signals
2. Modules compose via known cognitive patterns (sequential, parallel, competitive, hierarchical)
3. Metacognition is a first-class composition operator, not an afterthought
4. The algebra is grounded in both cognitive science and mathematical formalism
5. The formalism is implementable in TypeScript as Pacta port interfaces

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
This is perception → reasoning → action.

### Parallel (|)

Modules A and B execute simultaneously on the same input:

```
A | B : (I, Sₐ×Sᵦ, κₐ×κᵦ) → (Oₐ×Oᵦ, Sₐ'×Sᵦ', μₐ×μᵦ)
```

Outputs must be merged. This is multi-modal processing (visual + auditory).

### Competitive (<|>)

Modules A and B both produce outputs; a selector chooses:

```
A <|> B : (I, Sₐ×Sᵦ×Sₛ, κₐ×κᵦ) → (Oₐ|Oᵦ, Sₐ'×Sᵦ'×Sₛ', μₐ×μᵦ×μₛ)
```

Where the selector has its own state and monitoring signal. This is GWT's
competitive broadcast — modules compete for workspace access.

### Hierarchical (▷)

Module A monitors and controls module B:

```
A ▷ B where:
  B.step(input, state_b, control) → (output, state_b', monitoring)
  A.step(monitoring, state_a, _)  → (control', state_a', meta_monitoring)
```

A reads B's monitoring signals and issues control directives. This is Nelson & Narens'
metacognitive architecture. A maintains an abstracted model of B (not direct access).

### Recursive (fix)

A module monitors itself — the metacognitive tower:

```
fix(M) = M ▷ M ▷ M ▷ ...
```

In practice, bounded to 2-3 levels (humans rarely go deeper).
Level 0: do the task. Level 1: monitor how the task is going. Level 2: assess whether
the monitoring strategy is working.

## Part III: The Workspace (Global Broadcast)

The **workspace** is the shared state that all modules read from and compete to write to.
It implements GWT's conscious broadcast:

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
with existing entries based on salience. Low-salience entries decay and are evicted. This
models both attention (what's in focus) and working memory limits (bounded capacity).

The workspace IS the agent's current "conscious" state — what it can reason about right now.

## Part IV: The Two-Level Architecture

Every Pacta agent has an object level and a meta level:

```
Agent = MetaLevel ▷ ObjectLevel

ObjectLevel = Workspace + {
  reasoner:  Module,   // deliberate reasoning (System 2)
  actor:     Module,   // action selection and execution
  observer:  Module,   // processes tool results, environment
  memory:    Module,   // episodic, semantic, procedural retrieval
}

MetaLevel = {
  monitor:   Module,   // conflict detection, error monitoring (ACC)
  evaluator: Module,   // outcome prediction, value estimation (OFC)
  planner:   Module,   // goal decomposition, strategy selection (aPFC)
  reflector: Module,   // offline learning, experience distillation (DMN)
}
```

Information flow:
1. **Object → Meta (monitoring ↑)**: Each object-level module emits monitoring signals
   (confidence, progress, errors, resource usage). These are aggregated and sent to the
   meta-level.
2. **Meta → Object (control ↓)**: The meta-level issues control directives (change strategy,
   increase effort, stop and reflect, escalate to human, spawn sub-agent).
3. **Workspace (broadcast)**: Object-level modules compete to write to the workspace.
   The workspace contents are available to all modules and to the meta-level.

### The Cognitive Cycle

Each agent turn executes a cognitive cycle (adapted from LIDA):

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
(default-interventionist pattern — System 1 handles most cycles, System 2 engages on anomaly).

## Part V: The System 1/2 Transition

Following SOAR's chunking mechanism:

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

This creates an adaptive system that starts slow (everything is System 2) and gets faster
as it learns patterns, while retaining the ability to escalate on novelty.

## Part VI: Mathematical Grounding

### Category-Theoretic Formulation

**Objects**: Cognitive module types (parameterized by I, O, S, μ, κ).

**Morphisms**: Module transformations — functions that convert one module into another
while preserving the step signature.

**Functor**: A composition operator (>>, |, <|>, ▷) is a functor from a product category
of modules to a composed module.

**Natural transformation**: An analogy between two compositions — e.g., "this reasoning
strategy over this provider" is analogous to "that reasoning strategy over that provider"
if a natural transformation exists between them.

**Properties to prove**:
- Sequential composition is associative: (A >> B) >> C ≅ A >> (B >> C)
- Parallel composition is commutative up to isomorphism: A | B ≅ B | A
- Hierarchical composition is not commutative: A ▷ B ≇ B ▷ A (monitoring is asymmetric)
- The workspace is a colimit — the "gluing" of module outputs into a coherent whole

### Sheaf-Theoretic Formulation (Binding)

**Base space**: The set of active modules (topological space with overlap structure).

**Sections**: Each module's output over its domain of competence.

**Gluing condition**: Local module outputs that agree on overlaps can be glued into a
global section = coherent agent behavior.

**Cohomological obstructions**: When the gluing condition fails (modules contradict each
other), the obstruction class identifies what kind of incoherence and suggests resolution
(competitive selection, meta-level arbitration, or composition refactoring).

### Process-Algebraic Formulation (Concurrency)

**Processes**: Each module is a process with typed input/output channels.

**Channels**: Monitoring (μ), control (κ), workspace read/write.

**Synchronization**: Sequential composition = channel linking. Parallel = independent
channels. Competitive = shared channel with arbitration. Hierarchical = asymmetric channels.

**Properties**: Deadlock freedom (no circular channel dependencies), liveness (every
module eventually gets input), fairness (competitive selection doesn't starve modules).

## Part VII: Open Research Questions

1. **Is the algebra closed under composition?** Does composing two cognitive modules
   via any operator always produce a valid cognitive module? Or are there degenerate
   compositions?

2. **What are the minimal modules?** Is there a smallest set of cognitive modules from
   which all agent behaviors can be composed? The Common Model suggests: reasoner, memory,
   actor, monitor. Is this minimal?

3. **Can metacognitive towers be bounded?** Nelson & Narens allow recursive meta-levels.
   In practice, 2-3 suffice. Is there a formal argument for why?

4. **How does the algebra relate to F1-FTH?** The project's formal theory of methods
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

## Relationship to Pacta

This RFC is a **theory document**. It defines the algebra; Pacta implements it.

- **Pacta Phase 1** proceeds with flat types (Pact, BudgetContract, etc.) — usable now.
- **Pacta Phase 2+** can refactor toward the algebra as it stabilizes.
- The cognitive module types (M = (I, O, S, μ, κ)) can be expressed as TypeScript generics.
- The composition operators (>>, |, <|>, ▷) can be expressed as higher-order functions.
- The workspace can be expressed as a typed store with salience-based eviction.

The theory informs the SDK; the SDK validates the theory. They evolve together.
