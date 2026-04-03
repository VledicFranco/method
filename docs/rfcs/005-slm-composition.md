# RFC 005: Autonomous Cognitive Skill Compilation

**Status:** Draft — exploratory theory document
**Author:** PO + Lysica
**Date:** 2026-04-03
**Applies to:** `@method/pacta`, `experiments/exp-slm-composition`
**Organization:** Vidtecci
**Extends:** RFC 002 (Small Language Models as Cognitive Skill Compilation)
**Depends on:** RFC 002 experimental results (Phase 3 Gate 3 PASS, Phase 5 R-14 through R-22)

## Motivation

RFC 002 proved that cognitive skills can be compiled to SLMs: the Monitor, Observer,
and Evaluator modules run at 93.4% adversarial accuracy on 0.5B models, with 22% token
reduction and 0.15% fallback rate. Phase 5 showed composition works — T06 went from
0% to 71% only when all architectural layers were present.

But RFC 002 left the compilation loop **manual**. A human designs the DSL, writes the
corpus generator, validates causal consistency, and trains the model. Each SLM takes
~1 week of human+LLM effort. This means:

- The agent can't learn new skills autonomously
- Composition experiments are bottlenecked by SLM creation velocity
- The cognitive architecture can't adapt to novel domains without human intervention

This RFC proposes closing the loop: **cognitive agents that autonomously abstract DSLs
from their own experience, compile them to SLMs, and compose them into new capabilities.**

This is the System 1/2 transition that RFC 002 theorized but couldn't implement:

```
Agent encounters novel pattern               (System 2 — frontier LLM, expensive)
  → repeats it enough times to notice         (Observer, Memory)
  → abstracts the pattern into a formal DSL   (NEW — the core contribution)
  → compiles it to an SLM                     (automated — RFC 002 pipeline)
  → fires the SLM next time                   (System 1 — fast, cheap)
  → accumulates more traces, refines          (continuous improvement)
```

This IS production compilation from ACT-R. This IS SOAR chunking. But implemented
with SLMs as the compilation target and DSL abstraction as the formalization mechanism.

### The Key Observation

Frontier LLMs already abstract naturally. Given examples, they classify, invent
notation, identify invariants, build taxonomies. This is emergent pattern
recognition from training. But it happens **ephemerally** (lost after the conversation),
**expensively** (full frontier compute every time), and **non-composably** (can't plug
one abstraction into another as a pipeline stage).

The proposed system doesn't replace the LLM's abstraction ability — it **captures,
validates, compiles, and composes** the abstractions the LLM produces. The frontier
LLM provides the creative spark. The system provides rigor and memory.

Two specific advantages over in-context LLM abstraction:

1. **Cross-session accumulation.** An LLM abstracts from what fits in its context
   window. A system that accumulates traces across hundreds of sessions can notice
   patterns invisible to any single conversation. The Phase 3 scaling law took 22
   experimental runs to emerge — no single-session LLM would derive it.

2. **Formal validation as filter.** In-context abstractions are plausible but
   unverified. A grammar that compiles is *proven* well-formed. Round-trip testing
   proves consistency. The formal filter catches abstractions that "feel right" but
   are structurally broken — exactly the kind of confident-but-wrong output LLMs
   produce.

The research question: can formalization + persistence + compilation produce
abstractions that are **more reliable and more general** than ephemeral in-context
LLM reasoning?

## Part I: The Abstraction Capability

### What "Abstract a DSL" Means

Given accumulated experience in a domain, produce a formal grammar that:

1. **Captures the structural invariants** — what's always true across instances
2. **Parameterizes the variation** — what changes between instances becomes slots
3. **Compiles to grammar rules** — the invariants become syntax, the slots become
   non-terminals
4. **Is self-validating** — malformed output is syntactically detectable

Example: an agent implements 10 REST endpoints. The invariant is the structure
(route → validate → handle → respond). The variation is the specific route, params,
handler logic. The DSL captures the invariant; the frontier LLM fills the slots:

```
ENDPOINT: {method} {path}
VALIDATE: {params} USING {schema}
HANDLE: {function}
RESPOND: {dto} STATUS {code}
```

The agent hasn't been taught REST patterns. It derived them from its own traces. And
its DSL reflects its own style and the project's conventions — a different agent in a
different codebase would derive a different DSL.

### Three Levels of Abstraction

Not all abstraction is equally tractable:

**Level 1 — Type-Driven Abstraction**

Input is already a formal type system (TypeScript interface, JSON Schema, Protobuf
message, Rust struct, Python dataclass). Output is a parser grammar. This is
**translation between formal languages** — the most tractable form.

Evidence: Phase 3 Run 10 achieved 99.6% exact match on JSON Schema → TypeScript.
The pattern generalizes across type systems because the underlying operation is the
same: structured fields → grammar sections.

| Input Format | Same Underlying Task |
|---|---|
| TypeScript `interface` | fields → grammar sections |
| JSON Schema `properties` | properties + constraints → grammar rules |
| Protobuf `message` | typed fields + nesting → grammar rules |
| Rust `struct` / `enum` | algebraic types → alternation/sequence |
| Python `dataclass` / Pydantic | annotated fields → grammar sections |

This is the **bootstrap layer** — it makes creating new SLMs cheaper.

**Level 2 — Trace-Driven Abstraction**

Input is accumulated behavioral traces with typed I/O. The agent notices structural
invariants across traces and extracts a DSL. The existing cognitive module contracts
constrain the search space.

Example: After 50 debugging sessions, the agent has traces showing:
```
cycle 3: Observer("stack trace: connection pool exhausted") → { novelty: 0.9 }
cycle 4: Reasoner("check connection lifecycle") → { action: Read, target: "db.ts" }
cycle 5: Reasoner("found: connection opened but not closed in finally") → { action: Edit }
```

The invariant across debugging traces: symptom classification → cause hypothesis →
verification read → targeted fix. The DSL encodes this as a diagnostic procedure.

This is harder than Level 1 because the input is semi-structured (natural language
within typed containers). But the types constrain the extraction — the agent knows
what *kind* of thing to look for in each trace field.

**Level 3 — Situation-Driven Abstraction**

Input is an arbitrary new domain the agent encounters. No pre-existing types. The
agent must discover the relevant dimensions, define the vocabulary, and design the
grammar from scratch. This is genuine grammar induction.

This level probably starts as frontier LLM reasoning (System 2) and may eventually
compile to SLM (System 1) once the agent has abstracted enough novel domains that the
*pattern of abstraction itself* becomes routine.

Meta-compilation: compiling the compiler.

### Three Kinds of Pattern

The application domains in Part II reveal that abstractions cluster into fundamentally
different kinds:

| Kind | What's Abstracted | Character |
|---|---|---|
| **Structural** | Invariant shapes in data/code | Deterministic, highest SLM affinity |
| **Causal** | Cause-effect relationships | Requires intervention data, medium SLM affinity |
| **Social** | Agent/human behavioral patterns | Non-stationary (others adapt), lowest SLM affinity |

A general-purpose DSL Inducer needs to handle all three. The compilation pathway
mirrors difficulty: structural abstractions compile first (Level 1-2), causal
abstractions compile second (Level 2), social abstractions may remain System 2
for a long time (Level 3).

## Part II: Application Domains

The autonomous abstraction capability enables qualitatively different agent behaviors
across multiple domains. Each domain illustrates a different facet of the capability.

### Learning to Code from Experimentation

Current agents learn to code from training data (pre-training corpus) and in-context
examples (prompts). An agent with autonomous abstraction learns from **its own
trial-and-error**:

- First REST endpoint: full System 2 reasoning (15 cycles, expensive)
- 10th REST endpoint: Observer flags low novelty, Memory surfaces prior traces,
  Reflector extracts structural pattern
- DSL abstracted: route → validate → handle → error-wrap → respond
- SLM trained on 10 accumulated (task, code) pairs structured through the DSL
- 11th endpoint: SLM fires the scaffold, frontier LLM handles only the novel
  business logic

**What's distinct:** The agent's DSL reflects the *specific project's* conventions.
Different codebase → different DSL → different compiled expertise. Personalized
skill acquisition, not generic training.

**Abstraction kind:** Structural (code patterns).

### Doing Science Through Formalized Observation

The scientific method maps directly to DSL abstraction:

```
observe → hypothesize → formalize → predict → test → refine
```

An agent that runs experiments can formalize its findings as executable models,
not narrative summaries. Concrete example from this project's own research:

```
After R-14 through R-22, the agent abstracts:

SCALING_LAW:
  architecture_change: +21.65pp per family jump
  data_2x: +2.78pp
  rank_2x: +0.95pp
  code_pretrain: = rank_2x

COMPOSITION_LAW:
  prerequisite(goal_preservation): partitioned_workspace
  prerequisite(action_initiation): write_enforcer
  prerequisite(long_horizon): memory
  contraindication(edit_heavy): memory
  requirement(T06): ALL
```

That DSL IS a scientific theory. And it's **falsifiable** — predict what happens if
you add workspace partitioning without a write enforcer. Phase 5 experiments already
confirmed this prediction (R-16/R-17).

**What's distinct:** The agent produces testable formal theories, not text summaries.
The DSL is both explanation and prediction engine. Science that compiles.

**Risk:** Inductive formalization from small N. A DSL from 6 observations is a curve
fit, not a theory. The agent needs to know when it has enough evidence — and when its
formalization is just overfitting noise.

**Abstraction kind:** Causal (cause-effect relationships).

### Learning Coordination from Challenge Spaces

Multi-agent systems can discover compositional structure in their own interactions:

- Three agents work on a codebase. Agent A modifies types in domain X. Agent B
  modifies consumers of domain X. Agent C works on unrelated domain Y.
- Merge conflicts between A and B. Never between A/C or B/C.
- System extracts: `dependency(A.exports, B.imports) → serialize(A, B)` and
  `independent(C, {A,B}) → parallel(C, serialize(A,B))`

That IS a coordination algebra — induced from conflicts, not designed top-down.
The agent has *derived* FCA domain boundaries from operational evidence. It could
discover domain structures that human architects missed.

**What's distinct:** The discovered algebra could express temporal dependencies
("lint before test"), resource contention ("GPU experiments serialize"), and
communication patterns ("gate → notify human"). Rules that currently live in YAML
strategies or documentation, discovered from experience instead.

**Abstraction kind:** Social (multi-agent interaction patterns).

### Debugging and Diagnosis

After 50 debugging sessions, an agent notices: "stack trace mentions connection pool +
timeout → root cause is always connection leak, not server overload."

```
DIAGNOSTIC:
  SYMPTOM(pool_exhaustion, timeout) → CAUSE(connection_leak)
  SYMPTOM(pool_exhaustion, timeout) → NOT CAUSE(server_overload)
  CAUSE(connection_leak) → FIX(add_finally_block, check_close_calls)
```

**What's distinct:** This is *causal* abstraction — the agent learns cause-effect
relationships and compiles them into fast diagnostic rules. Connects to the Phase 5
finding where memory-based salience amplification solved the T02 diagnostic task that
was "architecture-resistant." A compiled diagnostic SLM would solve it in milliseconds.

**Abstraction kind:** Causal.

### Error Recovery and Operational Playbooks

An SRE agent handles 100 production incidents and abstracts:

```
PLAYBOOK:
  ALERT(memory_spike, >90%) ∧ CONTEXT(deployment, <1h)
    → RUNBOOK(rollback)
  ALERT(memory_spike, >90%) ∧ CONTEXT(deployment, >1h)
    → RUNBOOK(heap_dump, analyze, scale_up)
```

**What's distinct:** The **latency of the compiled SLM is load-bearing**. In coding
or science, the frontier LLM's 2-second latency is fine. In incident response, it's
not. The System 2 → System 1 compilation isn't just cheaper — it's *necessary* for
the use case to work at all. This is the strongest argument for compilation over
in-context reasoning.

**Abstraction kind:** Causal (incident → response patterns).

### Process and Workflow Discovery

An agent observes 30 PR reviews and abstracts:

```
WORKFLOW: pr_review
  READ(diff) → CHECK(tests) → CHECK(types)
  IF(security_touched) → REQUIRE(security_review) ELSE SKIP
  WRITE(feedback) → DECIDE(approve | request_changes)
```

**What's distinct:** This generalizes beyond code to any domain with sequential
human-in-the-loop processes. It's process mining but agent-native — discovered from
execution traces, not designed. The compiled workflow SLM becomes an autonomous
process executor for routine reviews.

**Abstraction kind:** Structural (process patterns).

### Adversarial and Strategic Reasoning

An agent in repeated negotiations notices:

```
STRATEGY:
  STATE(opponent_escalated, count>=2)
    → ACTION(de_escalate) EXPECTED(cooperation, 0.80)
  STATE(opponent_cooperated, count>=3)
    → ACTION(propose_commitment) EXPECTED(agreement, 0.65)
```

**What's distinct:** The "world" is another agent, not a deterministic system. The
DSL must encode *uncertainty* and *opponent modeling*. Critically, these patterns are
**non-stationary** — the opponent adapts too. This means the compiled SLM needs
periodic retraining as the opponent's strategy evolves.

**Abstraction kind:** Social (adversarial interaction patterns).

### Communication Adaptation

An agent explaining concepts to different users notices:

```
PEDAGOGY:
  USER_PROFILE(backend, senior) ∧ TOPIC(react_state)
    → FRAME(type_system_analogy, state_machine)
  USER_PROFILE(frontend, junior) ∧ TOPIC(database_indexing)
    → FRAME(search_engine_analogy, progressive_disclosure)
```

**What's distinct:** The abstraction isn't about the domain but about the
*communication channel*. The agent compiles social/linguistic patterns — how to
explain things to different people. A different kind of expertise entirely.

**Abstraction kind:** Social (communication patterns).

### API Behavior Modeling

After integrating with 20 external APIs, an agent abstracts:

```
API_PATTERN:
  pagination(cursor) → IMPL(loop, cursor_field, has_next_check)
  rate_limit(429) → IMPL(exponential_backoff, jitter)
  auth(oauth2) → IMPL(token_refresh, retry_on_401)
```

**What's distinct:** The agent has learned *external system behavior* — runtime
characteristics that aren't in documentation or training data. Each API it integrates
with refines the DSL. The compiled SLM generates integration boilerplate that
accounts for behavioral quirks discovered from experience.

**Abstraction kind:** Structural (API interaction patterns).

## Part III: SLM Taxonomy

RFC 002 defined SLMs as compiled cognitive modules. This RFC refines the taxonomy
based on what the SLM does in a composition pipeline:

### Three Types

| Type | Function | I/O Characteristics | Examples |
|------|----------|---------------------|---------|
| **Classifier** | Bounded judgment → structured label | Closed output vocabulary | Observer, Monitor, Evaluator, validation gates |
| **Translator** | Format A → Format B | Both sides formal, often round-trippable | Schema→Grammar, signal translators, trace distillers |
| **Generator** | Structured input → structured output | Input formal, output formal but creative | JSON Schema→TypeScript, code scaffolders |

The distinction matters for **error propagation** in composition:

- **Classifier errors** are bounded: a wrong label affects one decision point.
- **Translator errors** are self-healing: the next stage's parser rejects malformed
  input. Free error detection.
- **Generator errors** compound multiplicatively: a structural error cascades through
  everything downstream.

Design principle: **maximize translator stages, minimize generator stages.** Translator-
heavy pipelines are inherently safer because errors are caught at every boundary.

### Composition Operators

SLMs compose via the same algebra as cognitive modules (RFC 001):

- **Sequential** `A ▸ B` : Output of A feeds input of B
- **Parallel** `A ⊗ B` : Independent SLMs run concurrently, results merged
- **Competitive** `A ⊕ B` : Multiple SLMs produce candidates, a classifier picks
- **Gated** `g → A | B` : A classifier SLM routes to the appropriate generator

A **Composed Language Model (CLM)** is a composition expression over SLMs:

```
CLM = S₁ ▸ V₁ ▸ S₂ ▸ V₂ ▸ ... ▸ Sₙ
```

Where each `Vᵢ` is a validation gate (parse check + schema check + classifier SLM)
that bounds error propagation between stages.

## Part IV: The Autonomous Compilation Loop

### How the Cognitive Architecture Supports It

The existing modules map directly onto the compilation loop:

| Loop Step | Module | Extension Needed |
|-----------|--------|-----------------|
| **Notice repetition** | Observer (novelty → low = repetition) + Memory (ACT-R frequency tracking) | Compilation trigger: when frequency > N, flag as candidate |
| **Accumulate traces** | Memory (CLS dual-store, episodic entries) | Tag traces with pattern ID for later extraction |
| **Extract pattern** | Reflector (lesson extraction) | Extract structural invariant, not just text summary |
| **Validate pattern** | Evaluator (progress assessment) | Evaluate DSL quality: does it parse? does it cover traces? |
| **Abstract DSL** | NEW: DSL Inducer | The core new capability — see below |
| **Train SLM** | Automated (Phase 3 pipeline) | Trigger from cognitive cycle, not manual |
| **Wire into cycle** | MetaComposer (task classification) | Route compiled tasks to SLM instead of frontier |
| **Refine** | Memory + Evaluator | Track SLM accuracy, retrain when degraded |

### The DSL Inducer

The missing module. Given a set of typed traces exhibiting a structural pattern,
produce a formal grammar that captures the invariant.

**Level 1 implementation** (Schema→Grammar): takes typed I/O contracts from the
module algebra and produces a PEG grammar. This is a translator SLM — the bootstrap
layer. Language-agnostic: works on TypeScript interfaces, JSON Schema, Protobuf,
Rust structs, Python dataclasses. The underlying operation is the same:
structured type description → compact serialization grammar.

**Level 2 implementation** (Trace→DSL): examines accumulated behavioral traces,
identifies the structural invariant (what's always the same) and the variation (what
changes), and produces a grammar where invariants become syntax and variations become
non-terminals. This may start as frontier LLM calls and eventually compile to SLM.

**Level 3 implementation** (Situation→DSL): full grammar induction from an arbitrary
new domain. Probably remains frontier LLM for a long time. But the *traces* of
Level 3 abstractions become training data for Level 2 — meta-compilation.

### The Compilation Trigger

When should the agent attempt to compile a pattern?

ACT-R provides the model: **activation-based compilation threshold**. The Memory
module already tracks episodic entries with ACT-R activation (frequency, recency,
context overlap). When a pattern's activation exceeds a threshold:

```
activation = log(frequency / √age) + contextOverlap
if activation > COMPILATION_THRESHOLD:
  trigger DSL Inducer on accumulated traces for this pattern
```

This mirrors human skill acquisition: you don't consciously decide to automatize a
skill — it happens when you've repeated it enough that the pattern becomes routine.

### The Refinement Loop

A compiled SLM isn't permanent. The Evaluator monitors its accuracy:

- If accuracy degrades (distribution shift), flag for retraining
- If new traces contain patterns the DSL can't express, extend the grammar
- If the domain changes (non-stationary environment), increase compilation threshold
  to avoid premature compilation

For social abstractions (adversarial, communication), the refinement loop is
continuous — the environment adapts, so the SLM must too.

## Part V: Bootstrapping Infrastructure

Before the autonomous loop can run, we need infrastructure that makes SLM creation
cheap. This is the **compiler bootstrapping** phase — using the compilation machinery
to build better compilation machinery.

### Current Pipeline and Its Bottleneck

```
Step 1: Collect frontier LLM traces      ← manual
Step 2: Design DSL grammar (PEG)          ← manual (bottleneck)
Step 3: Write corpus generator            ← manual
Step 4: Ensure causal consistency         ← manual (Phase 3 key finding)
Step 5: Train (LoRA, Qwen2.5-0.5B)       ← automated
Step 6: Validate (parse/semantic/adv)     ← automated
Step 7: Export ONNX, integrate            ← automated
```

### Bootstrap SLMs (priority order)

#### B-1: Schema→Grammar SLM (Translator)

**Input:** Structured type description (any language — TS, JSON Schema, Protobuf, etc.)
**Output:** PEG grammar (Peggy format)

The keystone. Language-agnostic by design. The underlying mapping has consistent
rules across all type systems:

- Scalar types → terminal rules
- Product types (struct/interface) → section sequences
- Sum types (enum/union) → alternation
- Collection types (array/list) → repetition with separator
- Optional types → optional sections
- Nesting → recursive rules

**Self-validating:** Generate a grammar, compile with Peggy, parse test examples.
Malformed grammars fail compilation. Free validation signal.

**Corpus sourcing:**
- Existing type→grammar pairs (Monitor, Observer, Evaluator) — 3 seed pairs
- TypeScript interfaces from 137+ repos in the workspace (`../`)
- GitHub scraping: repos with `.peggy`/`.peg` files alongside typed languages
- JSON Schema ↔ grammar pairs from the schema ecosystem
- Protobuf definitions paired with parser grammars from gRPC projects
- Each pair validated by Peggy compilation (filter bad outputs)

#### B-2: Causal Validator SLM (Classifier)

**Input:** (input example, output example, causal rules)
**Output:** valid | invalid | uncertain

Automates Step 4. Phase 3 showed causal consistency was the difference between 39%
and 98.6% accuracy. A classifier that detects causal violations in generated corpus
entries automates the quality gate.

Conservative threshold is safe: false negatives waste training data but don't hurt
quality. False positives hurt quality. Threshold high.

#### B-3: Trace Distiller SLM (Translator)

**Input:** Frontier LLM natural language output (reasoning trace)
**Output:** Structured decision pattern (typed fields extracted)

Automates Step 1. Essentially NER over domain-specific output — extracting typed
fields from natural language, not understanding the reasoning.

#### B-4: World Extractor (Frontier LLM, not SLM)

**Input:** Source code + type definitions + documentation
**Output:** World specification (I/O types, causal rules, vocabulary bounds)

May remain a frontier LLM call. Runs once per SLM (not per corpus entry), so cost
is acceptable. Its output feeds into the automated pipeline.

### The Flywheel

```
B-1 (Schema→Grammar) exists
  → creating B-2's grammar is automated by B-1
  → B-2 (Causal Validator) exists
    → corpus quality for ALL future SLMs is automated
    → B-3 (Trace Distiller) exists
      → trace collection is automated
      → full pipeline: code → traces → distill → grammar → corpus → validate → train
      → SLM creation drops from ~1 week to ~1 day
        → autonomous compilation loop becomes practical
```

## Part VI: Error Compounding in Composition

The central risk: if each SLM is 93% accurate and you chain 5, you're at ~70%.

### Validation Gates

Between every stage, insert a gate:

```
Sᵢ output → parse check → schema check → Vᵢ classifier → Sᵢ₊₁ input
```

1. **Parse check** (free): output conforms to grammar?
2. **Schema check** (free): parsed output matches expected type?
3. **Classifier gate** (SLM): output semantically reasonable?

On failure: retry Sᵢ (up to N), then escalate to frontier LLM.

### Error Bounds

For N stages with per-stage accuracy `a` and gate false-positive rate `f`:

- **Without gates:** `a^N` (multiplicative compounding)
- **With gates:** `1 - N × f` (linear in gate error)

Gates at 99% accuracy → 5-stage pipeline lower bound = 95%.
**The gate classifier accuracy is the binding constraint**, not generator accuracy.

## Part VII: Validation Plan

### Gate A — Abstraction Feasibility

| Gate | Metric | Target |
|------|--------|--------|
| A-G1 | Level 1 grammar compilability | >= 90% of Schema→Grammar outputs compile |
| A-G2 | Level 1 downstream quality | SLM trained on generated grammar achieves >= 85% semantic |
| A-G3 | Level 2 trace extraction | Reflector extracts patterns that cover >= 70% of trace variance |

### Gate B — Bootstrap Validation

| Gate | Metric | Target |
|------|--------|--------|
| B-G1 | Causal detection precision | >= 90% on known-bad pairs |
| B-G2 | Pipeline speedup | New SLM creation < 2 days (vs ~1 week) |

### Gate C — Composition Validation

| Gate | Metric | Target |
|------|--------|--------|
| C-G1 | 2-stage CLM accuracy | >= 85% end-to-end |
| C-G2 | Gate effectiveness | >= 50% error reduction vs ungated |
| C-G3 | Cost ratio | CLM < 10% of frontier for equivalent task |

### Gate D — Autonomous Loop Validation

| Gate | Metric | Target |
|------|--------|--------|
| D-G1 | Autonomous compilation | Agent compiles >= 1 pattern without human intervention |
| D-G2 | Compiled skill accuracy | Autonomously compiled SLM achieves >= 80% of hand-compiled |
| D-G3 | Refinement | Accuracy improves with additional traces (learning curve) |

### Abandonment Conditions

- If B-1 cannot achieve >= 80% compilable grammars after 3 training iterations,
  grammar design is too creative for 0.5B SLMs. Fall back to frontier LLM for
  grammar design (one-shot cost acceptable).
- If 2-stage CLM net accuracy < 60%, composition is not viable at current SLM
  accuracy. Wait for higher base accuracy.
- If bootstrap speedup < 2x, the automation overhead exceeds manual effort.
- If Level 2 trace extraction cannot identify patterns that a human confirms as
  real, the Reflector extension is not sufficient. Requires architectural revision.

## Part VIII: Infrastructure Requirements

### What Exists (from RFC 002)

- Qwen2.5-Coder-0.5B LoRA training pipeline (Phase 3)
- PEG grammar tooling: Peggy compiler, round-trip verification (Phase 2)
- DSL codecs: encoder/decoder for Monitor, Observer, Evaluator (Phase 4)
- SLM inference: Ollama adapter, ONNX export path (Phase 4)
- Cognitive cycle integration: SLM provider adapter (Phase 5)
- CLS dual-store memory with ACT-R activation (Phase 5, R-20/R-21)
- GPU: RTX 2080 Ti (local), RTX 4090 (chobits, Tailscale)

### What Needs to Be Built

| Component | Purpose | Phase |
|-----------|---------|-------|
| Schema→Grammar corpus (multi-language) | Training data from workspace repos + GitHub | Bootstrap |
| Peggy-in-the-loop validator | Compile generated grammars, filter bad outputs | Bootstrap |
| CLM composition runtime | Stage routing, validation gates, escalation | Composition |
| Compilation trigger in Memory | ACT-R activation threshold for pattern compilation | Autonomous loop |
| Reflector structural extraction | Extract invariants from traces, not just text | Autonomous loop |
| DSL Inducer module | New cognitive module: traces → grammar | Autonomous loop |
| MetaComposer SLM routing | Route compiled patterns to SLMs dynamically | Autonomous loop |

### Training Budget

All SLMs use Qwen2.5-Coder-0.5B with LoRA r=16 (production config from Phase 3).

| SLM | Estimated corpus | Training time (RTX 4090) |
|-----|-----------------|--------------------------|
| B-1 Schema→Grammar | ~5-10K pairs | ~10-20 min |
| B-2 Causal Validator | ~10K pairs | ~15 min |
| B-3 Trace Distiller | ~8K pairs | ~12 min |

## Open Research Questions

**Q1: What is the minimum viable corpus for Schema→Grammar?**
Only 3 existing pairs. Multi-language sourcing (GitHub, workspace repos) should
provide hundreds. Empirical question: how many distinct type→grammar patterns exist?

**Q2: Can the Reflector extract structural invariants, not just text summaries?**
Current Reflector produces natural language lessons. Extending it to produce
structural patterns (what's invariant, what varies) is the key Level 2 challenge.

**Q3: Where is the composition depth ceiling?**
At what N does a CLM pipeline become less reliable than a single frontier LLM call?
Depends on gate quality.

**Q4: Can competitive composition improve generator reliability?**
Run N generators, pick the output passing the most gates. Converts variance into
reliability at Nx cost.

**Q5: At what point does the abstraction capability compile itself?**
If Level 3 abstraction (frontier LLM) runs often enough, its traces become training
data for Level 2 (SLM). Meta-compilation: the compiler compiling itself. Is this
convergent or divergent?

**Q6: How do non-stationary domains affect compiled SLMs?**
Social abstractions (adversarial, coordination) operate in environments that adapt.
What retraining frequency is needed? Does the refinement loop converge or oscillate?

**Q7: Can formal validation (grammar compilation) catch abstraction errors that
LLMs miss?**
The hypothesis: LLMs produce plausible-but-wrong abstractions. Grammar compilation
rejects structurally incoherent ones. Empirical question: what fraction of LLM
abstractions fail grammar compilation?
