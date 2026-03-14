# The Structure of Methodical Action
## A Formal Theory of Methods and Methodologies

---

> *This document is the joint work of two authors who arrived at the same formal object
> from opposite directions — one from the phenomenology of structured human activity, one
> from the mathematics of typed computation and reactive systems. We began with a
> disagreement about notation and ended with a shared conviction: that methodology is one
> of the oldest and most consequential inventions of cognitive life, and that it has never
> been given the formal treatment it deserves. What follows is our attempt at that
> treatment. It is a working draft in the best sense: rigorous enough to be argued with,
> open enough to be extended.*

---

## Abstract

We present a formal theory of methods and methodologies — the structured processes by
which complex multi-step cognitive tasks get done reliably. Methodology has shaped every
domain of intellectual activity without ever receiving precise mathematical treatment.
We attempt that treatment.

The theory is grounded in many-sorted model theory, the Hoare state monad, and
coalgebra. Seven definitions develop the core structure: a *domain theory* bounds the
world a method operates in; *roles* assign formal observation projections and authorized
transitions to agents; *steps* are 4-tuples `(pre_σ, post_σ, guidance_σ, tools_σ)`,
composable when post-state extensions include the pre-state conditions of their
successors; *methods* combine domain, team topology, step DAG, objective, and success
profile into a 5-tuple `M = (D, Roles, Γ, O, μ⃗)`; and *methodologies* are coalgebras
`Φ = (D_Φ, δ_Φ, O_Φ)` whose transition functions select methods at runtime, enabling
adaptive behavior unreachable by any fixed method. A *domain retraction* pair
`(embed, project)` makes the theory self-similar: any step can be promoted to a method,
any method demoted to a step, provided the retraction condition holds.

Each definition is developed alongside a running implementation — an MCP server that
enforces methodology execution at runtime for LLM agents. Co-development with the
implementation serves as the primary source of falsification: definitions are revised
when their instantiation produces inconsistencies or awkward special cases.

We state five open problems — including the decidability boundary for method
verification and the semantic adequacy of guidance text — and five extension directions
including concurrent, probabilistic, and adaptive methodologies.

---

## Notation

- Types are capitalised: `Sort`, `State`, `Method`
- `Mod(D)` — the class of models of domain theory `D`
- `P(X)` — powerset of `X`
- `A ↾ Σ` — reduct of structure `A` to sub-signature `Σ`
- `Option(X) = None | Some(X)` — the option type
- `⊆` on predicates denotes subset of extensions: `P ⊆ Q` iff `{x | P(x)} ⊆ {x | Q(x)}`
- `HST[P, Q] A` — Hoare state monad: computations over states satisfying `P`, returning `A` in a state satisfying `Q`
- `f ∘ g` — function composition, `(f ∘ g)(x) = f(g(x))`

---

## 0. Motivation

The problem that this theory addresses is not philosophical but practical: how do complex,
multi-step cognitive tasks get done reliably?

The naive answer is *competence*. A sufficiently skilled agent knows what to do. But
competence is insufficient. Every practitioner of every demanding discipline has
experienced the phenomenon of knowing exactly what to do and failing to do it — not from
lack of skill but from lack of structure. The researcher who skips exploratory analysis
and jumps straight to the hypothesis they wanted to confirm. The engineer who codes
before designing. The reviewer who approves before understanding. In each case the
agent's competence is not in doubt. What fails is the *ordering* of action — the
disciplined sequencing that good methodology provides.

A method is a formal answer to this failure mode. It does not add capability to an agent;
it adds *accountability to structure*. It tells the agent not just what to do but what
must be true before they do it and what they must produce when they are done. The method
is not a constraint on intelligence — it is the scaffold that allows intelligence to be
applied where it matters.

This theory takes the method seriously as a mathematical object. We want to know: what
is the minimal formal structure that makes a method well-defined? What does it mean for
methods to compose? What distinguishes a methodology — a system that *chooses* between
methods at runtime — from a method that merely sequences steps? These questions have
been answered informally for centuries. We attempt to answer them precisely.

The theory is developed in seven definitions (§1–§7), followed by an extended section on
open problems and future directions (§8). Footnotes throughout connect each formal
concept to its instantiation in the method server — a running implementation of this
theory as a software system.[^impl]

---

## 1. Domain Theory

Every method operates within a bounded world. The first act of methodology design is the
act of bounding: deciding which entities exist, what relations hold between them, and
which configurations are possible. This is not a metaphysical claim about what is real —
it is a pragmatic commitment to what is *relevant*. The scientist does not, while
measuring a particle, account for the politics of the funding agency. The commitment to
ignore everything outside the boundary is what makes purposive action possible at all.

We capture this boundary as a *domain theory*: a formal specification of the ontology
and the laws that govern it.

**Definition 1.1 (Domain Theory).** A **domain theory** `D` is a pair:

```
D = (Σ, Ax)
```

where `Σ = (S, Ω, Π)` is a **many-sorted signature**:

- `S` — a finite set of **sort names**: the typed entity classes of the domain
  (e.g., `Ticket`, `Sprint`, `Developer`, `Status`)
- `Ω` — a family of **function symbols** `f : s₁ × ... × sₙ → s`,
  typed operations that construct or transform instances
- `Π` — a family of **predicate symbols** `p : s₁ × ... × sₙ`,
  typed relations over instances

and `Ax` is a finite set of **closed Σ-sentences** — the domain's axioms.[^domain-impl]

**Definition 1.2 (World State).** A **world state** is a **Σ-structure** `A`: an assignment of

- a carrier set `A_s` for each `s ∈ S` (the concrete instances of that type)
- an interpretation `f^A : A_{s₁} × ... × A_{sₙ} → A_s` for each `f ∈ Ω`
- an interpretation `p^A ⊆ A_{s₁} × ... × A_{sₙ}` for each `p ∈ Π`

**Definition 1.3 (Valid States).** The **valid states** of `D` are:

```
Mod(D) = { A | A is a Σ-structure and A ⊨ ax for all ax ∈ Ax }
```

the class of Σ-structures satisfying all axioms.

The axioms in `Ax` are the invariants of the domain — not a post-hoc filter over a
pre-given state space, but the *constitutive* laws that define what kind of world this
is. An axiom such as `∀ sprint. |tickets(sprint)| ≤ capacity(sprint)` does not filter
the state space after it is defined; it defines the state space to begin with. There is
no valid state in which this constraint fails. The invariants are the world's character.

Note that `Mod(D)` is not required to be a set — it is a *class*, potentially
containing structures of varying carrier sizes. For practical methods, we assume a
locally small `D` and work within a fixed universe.

**Definition 1.4 (Domain Morphism).** A **domain morphism** `m : D → D'` is a
signature translation `m : Σ → Σ'` that:

- maps each sort `s ∈ S` to a sort `m(s) ∈ S'`
- maps each symbol in `Ω` and `Π` to corresponding symbols in `Ω'` and `Π'`
  with matching translated arities
- **preserves axioms**: `Ax' ⊨ m(ax)` for all `ax ∈ Ax`

Every `D'$-model `A'` **reduces** along `m` to a `D`-model `A' ↾_m`, obtained by
interpreting each `s` via `m(s)`'s carrier, each symbol via its translated counterpart.
This reduct is the mechanism that enables method composition (§6).

---

## 2. Role

Methods are rarely executed by a single undifferentiated agent. Even when one person
works alone, multiple roles are in play — author and reviewer, explorer and skeptic,
planner and executor. This is not convention. It reflects something structural about
complex domains: no single perspective is adequate. The domain is too multidimensional
for any one vantage point to grasp in full.

A role is not just a set of tasks. It is a *lens*: a formal specification of what an
agent can see and what they are authorized to do.

**Definition 2.1 (Role).** Given a domain theory `D`, a **role** `ρ` is a pair:

```
ρ = (π_ρ, α_ρ)
```

where:

- `π_ρ : Mod(D) → Mod(D_ρ)` — the **observation projection**: a reduct functor to a
  sub-theory `D_ρ = (Σ_ρ, Ax_ρ)` with `Σ_ρ ⊆ Σ`. An agent in role `ρ` observes only
  the dimensions of state expressible in `Σ_ρ` — they receive `π_ρ(s)`, not `s`.[^role-impl]

- `α_ρ : Mod(D) → P(Mod(D))` — the **authorized transitions**: a function returning the
  set of valid next states reachable by an agent in role `ρ` from the current state

The observation space `Mod(D_ρ)` is a model of a *different, smaller theory* — not a
subset of the same state space. When `π_ρ(s₁) = π_ρ(s₂)`, states `s₁` and `s₂` are
**epistemically indistinguishable** to role `ρ`. Role-based information hiding is
therefore not a social arrangement but a formal consequence of observation projection.

**Definition 2.2 (Team Topology).** A **team topology** over `D` is a finite set of roles
`{ρ₁, ..., ρₙ}`. Multiple agents may occupy the same role. A single agent may occupy
multiple roles, subject to the intersection of their observation projections
`⋂ π_{ρᵢ}` and the intersection of their authorized transition functions.

The roles partition cognitive labor. The quality of a team topology is measured by
whether the union of role observations covers the full state space — whether, collectively,
nothing relevant is invisible — and whether role authorities cover all required transitions
without unnecessary overlap.

---

## 3. Tool

A tool is the smallest unit of state-transforming action. It is not a step — it lacks
the pre/postcondition structure and guidance text that make a step accountable to the
method. A tool is primitive: it does one thing, it takes typed input, it produces typed
output, and it leaves the world in a new valid state.

**Definition 3.1 (Tool).** A **tool** `t` is a computation in the Hoare state monad:[^tool-impl]

```
t : Input → HST[P_t, Q_t] Output
```

where:

- `P_t : Mod(D) → Bool` — the **precondition**: `t` is callable only from states satisfying `P_t`
- `Q_t : Output → Mod(D) → Bool` — the **postcondition**: after `t` returns value `v`,
  the resulting state satisfies `Q_t(v, −)`

Concretely, without dependent types, `t` is a partial function:

```
t : Input → { s ∈ Mod(D) | P_t(s) } → (Output × { s' ∈ Mod(D) | Q_t(−, s') })
```

Tools are **atomic**: they are not further decomposed within the method that uses them.
They are the vocabulary of the method's action language. The Hoare indexing makes each
tool's resource contract explicit — the type of a tool is a specification of what it
requires and what it guarantees.

---

## 4. Step

A step is a directed transformation of the world. It is not merely activity — it is
*accountable* activity: activity that knows what must be true before it begins, what it
must produce when it ends, and what guidance the executing agent should receive to
orient their action. The guidance is not a recipe. It is a *context-giving act*: the
method speaking to the agent about what matters here and why.

**Definition 4.1 (Step).** A **step** `σ` is a 4-tuple:

```
σ = (pre_σ, post_σ, guidance_σ, tools_σ)
```

where:

- `pre_σ : Mod(D) → Bool` — **precondition**: `σ` may execute only from states satisfying `pre_σ`
- `post_σ : Mod(D) → Bool` — **postcondition**: the resulting state satisfies `post_σ`
- `guidance_σ : Context → Text` — a function from session context to guidance text
  addressed to the executing role
- `tools_σ ⊆ Tools(D)` — the tools available during this step[^step-impl]

**Definition 4.2 (Step Execution).** The **execution semantics** of `σ` is the partial function:

```
exec_σ : { s ∈ Mod(D) | pre_σ(s) } → { s' ∈ Mod(D) | post_σ(s') }
```

**Definition 4.3 (Sequential Composition).** Steps `σ₁` and `σ₂` are **composable** iff:

```
{ s ∈ Mod(D) | post_{σ₁}(s) }  ⊆  { s ∈ Mod(D) | pre_{σ₂}(s) }
```

Their composition `σ₁ ; σ₂` has `pre_{σ₁;σ₂} = pre_{σ₁}` and `post_{σ₁;σ₂} = post_{σ₂}`,
with `exec_{σ₁;σ₂} = exec_{σ₂} ∘ exec_{σ₁}`.

The condition is set inclusion on predicate *extensions*, not logical entailment between
propositions. The distinction matters: entailment `⊢` is a proof-theoretic relation and
imports the structure of a proof system. We need only a semantic containment — that
every state satisfying `post_{σ₁}` also satisfies `pre_{σ₂}`. No proof system is
presupposed.

**Definition 4.4 (Step DAG).** A **step DAG** `Γ = (V, E, σ_init, σ_term)` is:

- `V` — a finite set of steps
- `E ⊆ V × V` — directed edges: `(σᵢ, σⱼ) ∈ E` iff `σᵢ` and `σⱼ` are composable
- `σ_init ∈ V` — the designated initial step
- `σ_term ∈ V` — the designated terminal step
- the graph `(V, E)` is acyclic

A **run** of `Γ` from state `s₀` with `pre_{σ_init}(s₀)` is any directed path
`σ_init = σ₁ → σ₂ → ... → σₙ = σ_term` through `Γ`, inducing the state sequence:

```
s₁ = exec_{σ₁}(s₀),  s₂ = exec_{σ₂}(s₁),  ...,  sₙ = exec_{σₙ}(sₙ₋₁)
```

The DAG structure allows conditional branching: an agent may follow different paths
through the step DAG depending on what state their execution of earlier steps produced.
The linear list of `core.md` is the special case where every node has out-degree at most
one — i.e., `Γ` is a path graph. The DAG is strictly more general.

---

## 5. Objective and Measure

Without an objective, a step sequence is motion — potentially vigorous, possibly
impressive, but not progress. Progress is change *toward something*. The objective
defines that something: a condition on the state space whose satisfaction means the
method has accomplished what it set out to do. Everything that precedes it is
methodologically meaningful only in relation to it.

**Definition 5.1 (Objective).** An **objective** `O` is a predicate:

```
O : Mod(D) → Bool
```

A state `s` is **terminal** iff `O(s) = true`. A run of a method succeeds iff its
final state is terminal.

Objectives are classified by structure:

- **Terminal**: `O(s) = (s ≅ s*)` for some target state `s*` (up to relevant isomorphism)
- **Threshold**: `O(s) = (μ(s) ≥ k)` for some measure `μ` and threshold `k`
- **Comparative**: `O(s) = (μ(s) > μ(s₀))` where `s₀` is the initial state

The objective is not a description of process. It is a property of state. A method that
never forces the question "what would it look like for the world to be different?" is a
method that permits the accumulation of activity without accountability.

**Definition 5.2 (Progress Preorder).** Given objective `O`, a **progress preorder**
`≼_O` on `Mod(D)` is a reflexive, transitive relation such that:

- `O(s₁) = true` and `O(s₂) = false` implies `s₁ ≻_O s₂` (terminal states are maximal)
- Informally: `s₁ ≼_O s₂` means "`s₁` is at least as advanced toward `O` as `s₂`"

The progress preorder is a **design artifact**: the methodology author specifies it
alongside `O`. It is not automatically derivable from `O` in general — the structure of
"closeness to the objective" depends on the domain.

**Definition 5.3 (Measure).** A **measure** `μ : Mod(D) → ℝ` is **well-formed** with
respect to `O` iff it is an order-homomorphism into `(ℝ, ≥)`:

```
s₁ ≼_O s₂   ⟹   μ(s₁) ≥ μ(s₂)
```

A method may define a **success profile** `μ⃗ : Mod(D) → ℝⁿ` — a vector of measures.
Individual components may be weighted or given lexicographic priority.[^measure-impl]

A measure is a hypothesis: it claims that a certain observable dimension of state tracks
progress toward the objective. Like all hypotheses, it can be falsified — specifically,
when a state `s₁` satisfying `s₁ ≻_O s₂` is assigned a *lower* scalar value than `s₂`.
The history of measurement is in large part a history of measures that were once good
hypotheses and ceased to be, under pressure from agents who learned to optimize the
measure rather than the objective.

---

## 6. Method

A method is not a mere procedure. It is a *committal structure*: a bounded world, a set
of roles with explicit epistemic limitations, a step DAG whose edges enforce sequencing,
an objective that defines success, and a success profile that makes progress observable.
The method is what remains when the agent's competence and effort are taken for granted —
the scaffold within which competence becomes reliable.

**Definition 6.1 (Method).** A **method** `M` is a 5-tuple:

```
M = (D, Roles, Γ, O, μ⃗)
```

where:
- `D = (Σ, Ax)` — the domain theory (§1)
- `Roles = {ρ₁, ..., ρₖ}` — a team topology over `D` (§2)
- `Γ = (V, E, σ_init, σ_term)` — the step DAG (§4)
- `O : Mod(D) → Bool` — the objective (§5)
- `μ⃗ : Mod(D) → ℝⁿ` — the success profile (§5)

All steps in `V` are valid under `D`: their pre- and postconditions are expressible in
`Σ` and their tools are elements of `Tools(D)`.

**Definition 6.2 (Method Execution).** The **execution** of `M` from initial state
`s₀ ∈ Mod(D)` with `pre_{σ_init}(s₀)` is a run of `Γ` from `s₀` (Definition 4.4).
`M` **succeeds** on `s₀` if at least one run produces a terminal state `sₙ` with
`O(sₙ) = true`.

**Definition 6.3 (Domain Retraction).** When a step `σ ∈ Γ` delegates to a
sub-method `M' = (D', ...)`, a **domain retraction** must be defined:

```
embed   : Mod(D)  → Mod(D')    -- inject parent state into child domain
project : Mod(D') → Mod(D)     -- project child result back to parent domain
```

satisfying the **retraction condition**:

```
project ∘ embed  =  id_{Mod(D)}  restricted to the subspace touched by σ
```

The pair `(embed, project)` is *not* required to be a bijection. `embed` is an
expansion (injective); `project` is a reduct (surjective). The retraction condition
requires only that the round-trip is lossless on the dimensions that `σ` reads or
writes — not on the full state space.[^retraction]

**Clarification (Reading B — adopted).** The "subspace touched by σ" is formally
defined as:

```
Σ_T(M') = ⋃_{σ' ∈ Γ_{M'}} referenced_sorts(σ')
```

— the union of all sorts appearing in any step's `pre`, `post`, or `tools` across the
entire step DAG `Γ_{M'}` of the sub-method `M'`. This is the child-method-global scope,
not the parent-step-local scope. The retraction must be lossless on everything the
sub-method `M'` touches internally — not only on what the parent step's `pre`/`post` in
`D` explicitly names. This definition is operationalized in `M4-MINS` as `Σ_T`.

*Design rationale (EXP-003 C-003):* The parent-step-local interpretation (Reading A)
would allow silent state corruption — the sub-method modifying a sort that falls outside
the parent step's declared interface, with the parent never detecting the inconsistency.
Reading B (child-method-global) is more conservative and more honest: the retraction pair
must account for everything the sub-method actually does, not only what the parent
expected it to do.

The execution of `σ` via `M'` is then:

```
exec_σ(s)  =  project(s'_final)   where s'_final = exec_{M'}(embed(s))
```

In model-theoretic terms: `embed` expands a `D`-structure to a `D'`-structure along a
signature inclusion `Σ → Σ'`, and `project` reduces it back. The method `M'` operates
in a richer domain; the parent method `M` sees only the projection. Composition is
coherent when that projection preserves everything the parent cares about.

**Proposition 6.4.** Sequential composition of steps (§4) and domain retraction (§6.3)
are consistent: if `exec_σ` is implemented via sub-method `M'` with retraction
`(embed, project)`, then `exec_σ` has the same pre/postcondition type as any other step
in `Γ`. The sub-method's internals are invisible to `Γ`.

This is the **fractal property** of methods: any step can be promoted to a full method,
and any method can be demoted to a step, provided the retraction pair exists and is
coherent. Methods are self-similar across scales.

---

## 7. Methodology

A methodology is not a large method. This distinction is easy to miss and important not
to. A method's step DAG is fixed at definition time — the structure of execution is
known before any execution begins. A methodology watches. It attends to the state of
the world as methods execute within it and decides: not just what step is next, but
what *method* is next, and sometimes whether any method should run at all. A methodology
adapts; a method executes.

The correct mathematical model for an entity that observes its own state and selects
next behaviors is a **coalgebra** — a structure that pairs a state space with a
transition function that may produce new behaviors or terminate.

**Definition 7.1 (Methodology).** A **methodology** `Φ` is a triple:

```
Φ = (D_Φ, δ_Φ, O_Φ)
```

where:

- `D_Φ = (Σ_Φ, Ax_Φ)` — the **shared domain theory**: a domain theory over which all
  methods in `Φ`'s repertoire operate, or to which they retract

- `δ_Φ : Mod(D_Φ) → Option(Method)` — the **transition function**: given the current
  state, selects the next method to execute, or returns `None` to terminate.[^methodology-impl]

- `O_Φ : Mod(D_Φ) → Bool` — the **global objective**: the condition whose satisfaction
  constitutes the methodology's completion

`Φ` is a **coalgebra** for the functor `F : Set → Set` defined by `F(X) = 1 + Method`
(on `Mod(D_Φ)`): a structure `δ_Φ : Mod(D_Φ) → 1 + Method`, where `1` corresponds to
`None` and `Method` to `Some M`.

**Definition 7.2 (Methodology Execution).** The **execution** of `Φ` from initial state
`s₀ ∈ Mod(D_Φ)` is:

```
run_Φ(s) =
  case δ_Φ(s) of
    None   → s
    Some M → run_Φ(exec_M(s))
```

`Φ` **succeeds** on `s₀` iff `run_Φ(s₀)` terminates and `O_Φ(run_Φ(s₀)) = true`.

The state `s` is the sole input to `δ_Φ`. If the identity of the previously executed
method is relevant to the next selection, that information is encoded as a component of
the state in `D_Φ`. The transition function is Markovian in the domain-theoretic state.

**Definition 7.3 (Inter-method Coherence).** When methods `Mᵢ` and `Mⱼ` in `Φ` have
different domain theories `Dᵢ` and `Dⱼ`, `D_Φ` must admit retraction pairs
`(embed_i : Mod(D_Φ) → Mod(Dᵢ), project_i : Mod(Dᵢ) → Mod(D_Φ))` for each `i`.
`Φ` threads state across method boundaries by composing these retractions.

**Definition 7.4 (Termination Certificate).** A methodology `Φ` is **certifiably
terminating** iff there exists a **well-founded measure** `ν : Mod(D_Φ) → ℕ` such that:

```
∀ s ∈ Mod(D_Φ). δ_Φ(s) = Some M  ⟹  ν(exec_M(s)) < ν(s)
```

This is a proof obligation, not part of the definition of `Φ`. A methodology without
a termination certificate may or may not terminate; the certificate witnesses that it
does.[^termination-impl]

**Observation.** The termination certificate connects the methodology to the standard
theory of well-founded recursion. If `ν` exists, then `run_Φ` is definitionally equal
to a primitive recursive function on the ordinal `ν(s₀)`. The existence of `ν` is
therefore equivalent to `run_Φ` being strongly normalizing.

---

## 8. Extensions

*The following section records the extensions we consider most promising, in roughly
ascending order of difficulty. Some are refinements; others open new areas. We write them
with the honesty of researchers who are excited about directions they have not yet fully
pursued.*

### 8.1 Concurrent Methods

The step DAG of §4 permits branching but not *parallelism*. Two branches of a DAG are
sequential alternatives, not concurrent executions. Many real methodologies involve
genuinely concurrent work: a design review that proceeds in parallel with a prototype,
a test suite that runs while a refactor is evaluated.

The natural algebraic structure for concurrency is a **monoidal category**. Define the
**parallel composition** of two steps `σ₁ ∥ σ₂` over compatible state decompositions:
if the domain theory `D` decomposes as `D₁ ⊗ D₂` (a tensor product of domain theories,
formalisable via the institution-theoretic tensor of Goguen and Burstall), and if `σ₁`
acts only on `Mod(D₁)` and `σ₂` only on `Mod(D₂)`, then `σ₁ ∥ σ₂` acts on
`Mod(D₁ ⊗ D₂)` with precondition `pre_{σ₁} ⊗ pre_{σ₂}` and postcondition
`post_{σ₁} ⊗ post_{σ₂}`.

The step DAG becomes a **step petri net** (or a string diagram in a monoidal category)
when parallelism is added. The theory of **workflow nets** (van der Aalst, 1998) provides
sound and complete characterizations of when such nets are *correct* — when every run
eventually terminates, every step is reachable, and no deadlock is possible.

For LLM-directed methods, parallelism arises naturally when multiple agents execute
different roles simultaneously. The formal structure above would allow a methodology
to specify which phases may be parallelized without risk of state conflict.

### 8.2 Probabilistic Steps

The execution semantics of §4 assigns to each step a deterministic function from
pre-states to post-states. This is the right model for steps whose outcome is guaranteed
by their implementation. But many steps in practice have uncertain outcomes: a
hypothesis-testing step may confirm or refute; a review step may approve or reject;
a search step may return results or not.

The generalization is a **probabilistic execution semantics**:

```
exec_σ : { s ∈ Mod(D) | pre_σ(s) }  →  Dist(Mod(D))
```

where `Dist(X)` is the set of probability distributions over `X` (or, for
continuous domains, a measurable space of measures). The postcondition becomes a
probabilistic assertion: `Pr[post_σ(s')] ≥ p` for some declared confidence `p ∈ [0, 1]`.

This connects to **probabilistic Hoare logic** (Kozen, 1985; Rand & Zdancewic, 2015)
and **probabilistic model checking**. A method with probabilistic steps succeeds with
probability `Pr[O(s_final)] ≥ threshold`. The success profile `μ⃗` becomes an expected
value under the distribution.

Probabilistic steps are especially relevant when the executing agent is an LLM, whose
outputs are not deterministic functions of their inputs. The formal treatment of LLM
steps as stochastic functions with statistically characterizable postcondition
satisfaction rates is an important open problem.

### 8.3 Adaptive Methodologies: Learning `δ_Φ`

The transition function `δ_Φ` of Definition 7.1 selects the next method based on
current state. In the current theory, `δ_Φ` is fixed at methodology design time. But a
methodology that *learns* from past executions — that improves its method selection
policy over time — is strictly more capable.

The formal structure is a **Markov Decision Process (MDP)**:[^learning]

```
(Mod(D_Φ), Methods, T, R)
```

where:
- `Mod(D_Φ)` is the state space
- `Methods` is the action space
- `T : Mod(D_Φ) × Methods → Dist(Mod(D_Φ))` is the transition distribution
- `R : Mod(D_Φ) → ℝ` is the reward function (related to `O_Φ`)

A learned transition function `δ_Φ^*` is the policy that maximizes expected cumulative
reward — i.e., the solution to the MDP. This connects methodology theory to
reinforcement learning in a precise way: a methodology is an MDP, a methodology design
session is a policy search, and the termination certificate of §7 corresponds to a
bounded-horizon policy with guaranteed convergence.

The path from the current theory to a learned methodology is: (1) instrument executions
to collect `(state, method_chosen, outcome)` tuples, (2) fit a transition model `T`,
(3) solve the MDP for `δ_Φ^*`, (4) deploy the learned policy. The theoretical challenge
is that `Mod(D_Φ)` is typically high-dimensional; practical policy learning requires
either a good state embedding or a compact function approximation.

### 8.4 Methodology Refinement and Behavioral Equivalence

Given two methodologies `Φ` and `Φ'` over the same domain theory `D_Φ`, when should we
say that `Φ'` is *at least as good* as `Φ`? The natural answer, from coalgebra theory,
is a **simulation relation**.

**Definition 8.1 (Methodology Simulation).** A relation
`R ⊆ Mod(D_Φ) × Mod(D_{Φ'})` is a **simulation from `Φ` to `Φ'`** iff for all
`(s, s') ∈ R`:

1. If `δ_Φ(s) = None`, then `O_Φ(s) = true` implies `O_{Φ'}(s') = true`
2. If `δ_Φ(s) = Some M`, then `δ_{Φ'}(s') = Some M'` for some `M'` that
   refines `M` (in the sense of Definition 8.2 below), and `(exec_M(s), exec_{M'}(s')) ∈ R`

**Definition 8.2 (Method Refinement).** A method `M'` **refines** `M` over the same
domain theory `D` iff for every run of `M` from `s₀`, there exists a run of `M'` from
`s₀` that produces a state `s'_final` with `μ⃗_{M'}(s'_final) ≥ μ⃗_M(s_final)`
component-wise.

If a simulation from `Φ` to `Φ'` exists, `Φ'` is provably no worse than `Φ` — it can
mimic every execution of `Φ` with equal or better outcomes. **Bisimulation** (mutual
simulation) gives behavioral equivalence: `Φ` and `Φ'` are observationally identical
from the outside, even if their internal method selections differ.

This provides a formal basis for methodology optimization: proving that a simpler or
faster methodology bisimulates a more thorough one establishes that the simplification
is *safe* — it loses no expressiveness. This is the methodology-theoretic analogue of
program equivalence proofs in programming language semantics.

### 8.5 The 2-Category of Methods and the Hierarchy Principle

Methods compose into methodologies; methodologies can in turn be treated as methods in a
meta-methodology. This recursive structure suggests that the theory should close under
its own compositions. The correct formal vehicle is a **2-category**.

**Sketch.** Define a 2-category `Meth`:

- **Objects**: domain theories `D`
- **1-cells**: methods `M : D → D` (endomorphisms — state transformations on `Mod(D)`)
  or, more generally, methods from `D` to `D'` mediated by a retraction
- **2-cells**: method refinements (Definition 8.2) — a 2-cell from `M` to `M'` is a
  proof that `M'` refines `M`
- **Horizontal composition**: method composition via domain retraction (§6.3)
- **Vertical composition**: transitivity of refinement

A methodology `Φ` is a **diagram** in `Meth` equipped with a coalgebraic transition
function selecting which 1-cell to traverse next. The methodology terminates when the
diagram reaches a terminal object (a domain satisfying `O_Φ`).

The 2-categorical structure makes precise the intuition that methodology design is itself
a structured activity — that there is a *method for designing methods*, a *methodology
for designing methodologies*, and that this hierarchy, rather than regressing infinitely,
closes at the level of the 2-category. The hierarchy terminates in structure, not in
flat meta-levels.

This is the most speculative extension here, and also the one we find most compelling.
A categorical treatment of methodology composition would provide a compositional
semantics for the entire theory — a denotation function from methodology descriptions
to mathematical objects, with a soundness theorem connecting the denotational and
operational semantics.

---

## 9. Summary

| Concept | Type / Signature |
|---|---|
| Domain Theory | `D = (Σ, Ax)` where `Σ = (S, Ω, Π)` |
| Valid States | `Mod(D)` — Σ-structures satisfying `Ax` |
| Domain Morphism | `m : D → D'` — signature translation preserving `Ax` |
| Role | `ρ = (π_ρ : Mod(D) → Mod(D_ρ),  α_ρ : Mod(D) → P(Mod(D)))` |
| Tool | `t : Input → HST[P_t, Q_t] Output` |
| Step | `σ = (pre, post, guidance, tools)` |
| Step execution | `exec_σ : {s \| pre(s)} → {s \| post(s)}` |
| Composition condition | `{s \| post_{σ₁}(s)} ⊆ {s \| pre_{σ₂}(s)}` |
| Step DAG | `Γ = (V, E, σ_init, σ_term)`, acyclic, edges by composability |
| Objective | `O : Mod(D) → Bool` |
| Progress preorder | `≼_O` on `Mod(D)`, reflexive + transitive, `O`-induced |
| Measure | `μ : Mod(D) → ℝ`, order-homomorphism w.r.t. `≼_O` |
| Method | `M = (D, Roles, Γ, O, μ⃗)` |
| Domain Retraction | `(embed, project)` with `project ∘ embed = id` on touched subspace |
| Methodology | `Φ = (D_Φ, δ_Φ : Mod(D_Φ) → Option(Method), O_Φ)` |
| Termination Certificate | `ν : Mod(D_Φ) → ℕ` with `ν(exec_M(s)) < ν(s)` whenever `δ_Φ(s) = Some M` |

---

## 10. Open Problems

We close with a precise statement of what this theory does not yet resolve, to mark
the frontier honestly.

**P1 — Canonical progress preorder.** Given only an objective `O`, there is in general
no canonical way to construct `≼_O`. The preorder must be specified by the methodology
author. Is there a class of objectives (e.g., those expressible as reachability
conditions in the domain theory) for which `≼_O` is canonically derivable? This would
relieve a significant design burden.

**P2 — Semantic validation of guidance.** The component `guidance_σ : Context → Text`
is formal in type but informal in semantics — we have no theory of what "good guidance"
produces. A first step would be a specification language for guidance in terms of its
effects: a guidance text is *adequate* for step `σ` iff an agent receiving it has
sufficient information to execute `exec_σ`. Formalizing "sufficient information" requires
a theory of agent cognition that interacts with the domain theory.

**P3 — Compositional completeness.** Verifying that a method `M` succeeds from every
valid initial state — that its step DAG `Γ` always terminates at an `O`-satisfying state
— is undecidable over arbitrary domain theories. For domain theories with finite model
classes (finite-state methods), bounded model checking is complete. The boundary of
decidability as a function of `D`'s expressiveness is unexplored.

**P4 — Coherence of parallel retraction.** When `Φ` selects methods `Mᵢ` and `Mⱼ` with
different domain theories, and both execute before full state consolidation, the
retraction pairs `(embed_i, project_i)` and `(embed_j, project_j)` must be compatible
on their shared subspace. The formal condition for this compatibility — a commutativity
condition on the retraction diagram — has not been stated precisely.

**P5 — Categorical completeness.** The 2-category `Meth` (§8.5) has been sketched but
not constructed. In particular: do all small diagrams in `Meth` have limits and
colimits? Is the 2-category Cartesian closed? If so, methodology composition is
associative and unital in a strong sense, and there is a well-defined notion of
*internal hom* — a methodology that maps methodologies to methodologies, which would
be the formal model of *meta-methodology*.

---

## Footnotes

[^impl]: The **method server** is a running implementation of this theory as a software
system. It is an MCP server that enforces methodology execution at runtime — receiving
phase outputs from an LLM client, validating them against structural invariants, and
delivering the next phase's guidance only when the current phase is satisfied. The server
is less a tool and more an *execution environment*: the YAML methodology files are the
program, the LLM is the interpreter, and the server is the runtime that enforces
structure the program text alone cannot. Every abstract concept in this theory has a
concrete counterpart in that system.

[^domain-impl]: In the method server, domain theories are encoded through YAML
methodology files. The `output_schema` of each phase implicitly defines the sorts in
`S` — the typed fields the agent must populate. The structural validators applied at
each phase gate are the axioms in `Ax`: an empty array fails, a missing required field
fails, a value outside a declared enum fails. The invariants are not a post-hoc filter;
they are what the gate *is*. The YAML author is performing Definition 1.1 every time
they write a methodology, whether or not they think of it in those terms.

[^role-impl]: The method server enforces role projection by information control. At any
given phase, the LLM receives only the guidance and tool responses for that phase — it
cannot read ahead, cannot see future phase guidance, cannot know which invariants will be
applied to its output next. This is the reduct `π_ρ(s) = s ↾ Σ_ρ` implemented as
deliberate withholding. The server is not teaching the LLM to behave — it is structurally
preventing behavior that would violate the role's epistemic constraints. The enforcement
is architectural, not social.

[^tool-impl]: MCP tools in the method server have precisely the Hoare-monad structure of
Definition 3.1. `method_start` requires no valid session (precondition: absence of
session state) and produces a new session with Phase 0 guidance (postcondition: session
in Phase 0 with valid initial state). `method_advance` requires a valid session in the
current phase (precondition) and produces either a validation error with the phase
repeated, or a new session state in the next phase with next-phase guidance
(postcondition). The tool's type *is* its specification.

[^step-impl]: A phase in a methodology YAML is a step in the sense of Definition 4.1.
`pre_σ` is the validity of the prior phase's output schema — the structural conditions
that the prior `method_advance` call verified. `post_σ` is the structural invariants
declared in the current phase's `invariants` block, which the *next* `method_advance`
will verify. `guidance_σ` is the `guidance` field of the phase YAML, instantiated with
the session topic via `{{topic}}` substitution. `tools_σ` is the set of MCP tools
available to the LLM during the phase — currently the full method server tool set, but
scoped restriction is a planned extension.

[^measure-impl]: The method server implements the success profile as a scalar `delta ∈ [0, 1]`
on the session object — a normalised aggregate of progress across phases. The delta is
computed at each `method_advance` call and stored in the session state. It is not a
measure in the full sense of Definition 5.3 — it does not claim to be an
order-homomorphism with respect to any explicit progress preorder. It is a working
approximation: a hypothesis that phase completion correlates with objective proximity.
The theory makes precise what would need to be true for that hypothesis to be correct.

[^retraction]: The naming `(embed, project)` is deliberate. The original model used
`(φ, φ⁻¹)`, which implies that `φ` is a bijection — that the child domain and parent
domain are isomorphic. This is almost never true: the child domain is typically richer
(the sub-method operates in a more detailed ontology) and the parent sees only a
projection. The retraction condition `project ∘ embed = id` requires only that
*embedding and then projecting* recovers the original parent state on the dimensions
that the step touches. The embedding need not be surjective onto `Mod(D')`. The
projection need not be injective into `Mod(D)`. This is a strictly weaker and more
accurate condition.

[^methodology-impl]: The method server is a coalgebra implementation. The session state
machine *is* `δ_Φ`: given the current session state (current phase index, prior phase
outputs, accumulated delta), it returns the next phase's guidance text wrapped in a tool
response (the `Some M` case) or marks the session complete (the `None` case). The LLM
cannot advance the session without passing through `δ_Φ` — the server withholds the next
method until the current one is satisfied. The server does not ask the LLM to cooperate
with the methodology; it structurally prevents any other execution order.

[^termination-impl]: For the method server, the termination certificate is concrete and
trivial: `ν(s) = total_phases - current_phase`. Each successful `method_advance` call
strictly increments `current_phase`. Since `total_phases` is fixed at methodology
definition time and the phase index is bounded above by it, every well-formed session
terminates in at most `total_phases` advances. The termination certificate for the
server's implementation is derivable directly from the finiteness of the YAML phase
list. The general theory asks: what is the certificate for methodologies whose
termination depends not on a fixed phase count but on the convergence of the LLM's
outputs toward a semantic condition? That question is open.

[^learning]: The Methodology-as-MDP framing is not yet implemented but is the most
promising direction for making the method server *adaptive*: a server that learns, over
many sessions on the same methodology, which phase durations and phase sequences
correlate with successful outcomes, and adjusts the guidance and gating accordingly.
The session history stored in `phase_events` is exactly the trajectory data required to
fit such a model. The architecture is already there; the learning layer is not yet built.
