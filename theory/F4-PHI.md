# Φ-Schema — Methodology Coalgebra Design Schema

> Version: 0.1 | Status: draft
> Authors: Dr. Kaspar Weil (formal) · Dr. Renata Möll (empirical bridge)
> Grounding: F1-FTH §7, §8.4 | Gate compatibility: G4_revised (M1-MDES)

---

## 0. Purpose and Scope

### What this schema produces

A completed Φ-schema declaration is a well-formed **methodology** in the sense of
Definition 7.1 (F1-FTH §7):

```
Φ = (D_Φ, δ_Φ, O_Φ)
```

where `D_Φ` is a shared domain theory, `δ_Φ : Mod(D_Φ) → Option(Method)` is a
transition function, and `O_Φ : Mod(D_Φ) → Bool` is a global objective. A designer
who fills in every required field in §§1–6 produces a Φ that satisfies all four
methodology conditions of G4_revised: G4-Φ1 (transition function typing), G4-Φ2
(retraction existence), G4-Φ3 (inter-method coherence), and G4-Φ4 (termination
certificate or obligation). The shared conditions G4-S1 and G4-S2 are addressed in
§2 and §4 respectively.

### Who uses it

An LLM agent executing M1-MDES to design a methodology, or a human methodology
designer working from first principles. The schema is read from top to bottom; each
section produces a field that feeds into later sections.

### What this schema does NOT produce

- A method M = (D, Roles, Γ, O, μ⃗) with a step DAG. That is a distinct artifact
  governed by the method-branch of G4_revised (G4-M1 through G4-M6).
- A learned policy for δ_Φ. Hand-authored δ_Φ is the scope here; Extension E3
  (F2-OPR) covers learned policies and is noted at the honest boundary in §4.
- A proof of bisimulation equivalence between two methodologies. That requires §8.4
  of F1-FTH and depends on the observation map declared in §3 of this schema.

---

## 1. Shared Domain Theory Declaration (D_Φ)

D_Φ bounds the world in which the methodology observes and selects methods. It is a
domain theory in the sense of Definition 1.1 (F1-FTH §1): a pair `(Σ_Φ, Ax_Φ)`
where `Σ_Φ = (S_Φ, Ω_Φ, Π_Φ)` is a many-sorted signature and `Ax_Φ` is a finite set
of closed Σ_Φ-sentences.

### 1.1 D_Φ Identifier

```
D_Φ identifier: [assign a short name, e.g., D_Φ_RESEARCH or D_Φ_PLANNING]
```

### 1.2 Required Sorts

The following sorts are **mandatory** in every D_Φ. The observation map (§3) and
the transition function (§4) are typed against them; omitting any one makes δ_Φ
ill-typed.

| Sort | Formal role |
|------|-------------|
| `current_method_id` | Identifies which method is currently executing, or `None` if between executions. This is the value `δ_Φ` last returned. |
| `phase_index` | The index of the current phase within the executing method. Range: `ℕ ∪ {⊥}` where `⊥` denotes between-method state. |
| `O_Φ_satisfied` | Boolean — whether the global objective is currently achieved. `true` is the terminal condition for the methodology. |

These three sorts are the **minimum state component** needed to define the standard
observation map (§3). They encode what `δ_Φ` needs to remember across method
boundaries: which method ran, where it terminated, and whether the global objective
was met.

**Justification for mandating these sorts:** The observation map
`obs(s) = (current_method_id, phase_index, O_Φ(s))` (§3) is defined over these
sorts. If any sort is absent from `Σ_Φ`, the observation map is not expressible in
`Σ_Φ`, violating G4-S1 (objective and observation expressibility in D_Φ's signature).

### 1.3 Additional Domain-Specific Sorts

```
Additional sorts:
  [list any further sorts required for state conditions in δ_Φ]
  [example: execution_history : Seq(Method × Outcome), global_state : [domain-specific]]
```

Guidance: Add a sort only when at least one condition in the δ_Φ table (§4) or one
axiom in Ax_Φ (§1.4) references it. Unnecessary sorts widen the state space without
improving discriminating power.

### 1.4 Function Symbols and Predicate Symbols

Declare all `Ω_Φ` (function symbols) and `Π_Φ` (predicate symbols) with typed
signatures. Every predicate and function argument must reference a sort in `S_Φ`.

```
Function symbols Ω_Φ:
  [name] : [sort₁ × ... × sortₙ → sort_result]
  ...

Predicate symbols Π_Φ:
  [name] : [sort₁ × ... × sortₙ]
  ...
```

### 1.5 Axioms (Ax_Φ)

State the domain invariants as closed Σ_Φ-sentences. Every valid methodology state
`s ∈ Mod(D_Φ)` satisfies all axioms. Axioms define the state space — they are not
post-hoc filters (Definition 1.3, F1-FTH §1).

```
Ax-Φ-1: [closed sentence over Σ_Φ]
Ax-Φ-2: [closed sentence over Σ_Φ]
...
```

Minimum required axioms:
- One axiom governing the relationship between `O_Φ_satisfied` and the global
  objective predicate (§2): `O_Φ_satisfied(s) ↔ O_Φ(s)`.
- One axiom stating the initial condition: `current_method_id(s_init) = None ∧ phase_index(s_init) = ⊥`.

### 1.6 Retraction Compatibility Constraint

**Every method M in range(δ_Φ) must admit a retraction pair to D_Φ.** This is the
compatibility constraint from Definition 7.3 (F1-FTH §7) and G4-Φ2:

```
For each Mᵢ in range(δ_Φ):
  embed_i   : Mod(D_Φ) → Mod(Dᵢ)     [declared in §4.1]
  project_i : Mod(Dᵢ)  → Mod(D_Φ)    [declared in §4.1]
  retraction condition: project_i ∘ embed_i = id on subspace(Mᵢ)
```

If a candidate method's domain theory `Dᵢ` cannot be connected to `D_Φ` by any
retraction pair, that method cannot be placed in range(δ_Φ). This is not a
contingent design choice — it is a hard type constraint from Definition 7.1.

---

## 2. Global Objective Declaration (O_Φ)

O_Φ is a predicate on valid states of D_Φ (Definition 5.1, F1-FTH §5, read at
the methodology level via Definition 7.1):

```
O_Φ : Mod(D_Φ) → Bool
```

### 2.1 Formal Statement

```
O_Φ(s) = [predicate over the sorts and predicates of Σ_Φ]
```

O_Φ must be expressible in Σ_Φ — every sort and predicate symbol it references must
appear in `S_Φ`, `Ω_Φ`, or `Π_Φ`. This is the G4-S1 objective expressibility condition.

### 2.2 Relationship to Constituent Method Objectives

Each method Mᵢ in range(δ_Φ) has its own objective `Oᵢ : Mod(Dᵢ) → Bool`. The
required relationship (G4-S1): every terminal state of Mᵢ (a state `s_i` satisfying
`Oᵢ(s_i) = true`) must project via `project_i` to a state that makes progress toward
`O_Φ`. Formally:

```
For each Mᵢ in range(δ_Φ):
  ∀ s_i ∈ Mod(Dᵢ). Oᵢ(s_i) = true →
    (project_i(s_i) makes progress toward O_Φ)
```

"Makes progress toward" means the projected state is strictly more advanced under the
progress preorder `≼_{O_Φ}` than the state before Mᵢ executed. This is not required
to be a formal proof — a credible argument is sufficient for gate passage, per G4-Φ4's
standard.

```
Constituent objective compatibility:
  M₁: [O₁ stated] → [argument that terminal states of M₁ advance O_Φ]
  M₂: [O₂ stated] → [argument that terminal states of M₂ advance O_Φ]
  ...
```

### 2.3 Non-Vacuousness Argument

O_Φ must be satisfiable: there exists at least one reachable execution reaching a
state where `O_Φ(s) = true`. This is the G4-S2 condition.

```
Non-vacuousness: [describe an execution sequence — method selections and outcomes —
  that begins from a valid initial state and terminates with O_Φ satisfied]
```

---

## 3. Observation Map Declaration

For bisimulation (Definition 8.1, F1-FTH §8.4) to be well-defined, the observation
map must be declared explicitly. The observation map fixes what it means for two
methodologies to be **observationally equivalent** — two methodologies bisimulate iff
they are indistinguishable under the declared observation map on all reachable states.

### 3.1 The Standard Observation Map

The minimum well-defined observation map for any Φ satisfying this schema is:

```
obs : Mod(D_Φ) → Observations
obs(s) = (current_method_id(s), phase_index(s), O_Φ(s))
```

This map is well-defined whenever D_Φ contains the three required sorts of §1.2. It
maps every valid state to a triple: which method is running (or `None`), where in that
method execution stands, and whether the global objective is satisfied.

**This is the minimum observation map.** Use it as the default unless there is a
specific reason to refine it.

### 3.2 Observation Map Field

```
obs function: [state which map is used]
  Standard map: obs(s) = (current_method_id(s), phase_index(s), O_Φ(s))
  Refined map:  obs(s) = [extended tuple; name additional state components]
  Reason for choice: [see §3.3]
```

### 3.3 Justification for Granularity

The observation map is a **design choice with formal consequences**:

- **Coarser maps** (fewer components in the tuple): larger bisimulation equivalence
  classes. Two methodologies that select different methods for the same state but
  produce the same `(current_method_id, O_Φ)` pair are equivalent under a coarser
  map. Coarsening loses discriminating power — genuinely different methodologies may
  be declared equivalent.

- **Finer maps** (more components): smaller equivalence classes. Methodologies that
  differ only in their internal phase bookkeeping are declared non-equivalent under a
  finer map, even if their outputs are identical. Refining may separate methodologies
  that should be treated as equivalent for all practical purposes.

- **The standard map** is the minimum that makes bisimulation meaningful: two
  methodologies are equivalent iff they agree on which method is running, where in
  that method execution is, and whether the goal is met.

```
Granularity justification:
  [Explain why the chosen map is appropriate for this methodology's context.
   If using the standard map: "The standard map is sufficient — no additional
   state components are required to discriminate methodologically relevant behaviors."
   If refining: "We add [component] because [two methodologies that agree on the
   standard map but disagree on this component should be considered non-equivalent,
   because...]"]
```

### 3.4 Bisimulation Consequence

State explicitly what "equivalent methodology" means under the chosen map:

```
Bisimulation consequence: Two methodologies Φ and Φ' are bisimilar under obs iff
  for all reachable states s and s' with obs(s) = obs(s'):
    (a) δ_Φ(s) = None iff δ_{Φ'}(s') = None
    (b) if δ_Φ(s) = Some Mᵢ and δ_{Φ'}(s') = Some Mⱼ, then Mⱼ refines Mᵢ
        (in the sense of Definition 8.2, F1-FTH §8.4) and the post-execution
        states remain bisimulation-related
  [Instantiate this with the chosen obs to make the equivalence class explicit]
```

### 3.5 Corollary (G3-obs Derivation)

**Corollary.** If M satisfies G3 of M1-MDES (role observation projections declared as reduct
functors with the coverage claim G3-C1 holding), then `obs(s)` is well-defined without
independent declaration. Specifically:

```
obs(s) = (π_{ρ_current}(s)|_{method_id}, phase_index(s), O_Φ(s))
```

where `π_{ρ_current}` is the observation projection of the role currently executing in state `s`,
as declared at G3, and `|_{method_id}` restricts that projection to the `current_method_id`
component of D_Φ's required sorts (§1.2).

**Argument.** The standard obs tuple has three components:

1. `current_method_id(s)` — this identifies which method is active, which is exactly what the
   currently executing role's observation projection reads: the role operates within a specific
   method, and `π_{ρ_current}(s)` is defined over that method's execution state. The method
   identity is a dimension of D_Φ observable by any role executing within that method. It is
   therefore recovered from `π_{ρ_current}(s)` by restriction to the `current_method_id` sort.

2. `phase_index(s)` — the step position within the executing method. This is not a role
   projection in the sense of Definition 2.1 (it is execution bookkeeping rather than epistemic
   access), but it is readable from the role's step-position context and must be present in D_Φ
   by §1.2. It is not derived from G3 projections alone; it is the residual explicit declaration
   required even when G3 holds.

3. `O_Φ(s)` — the global objective truth value. Always included; declared in §2.

The G3 coverage claim (G3-C1: `⋃_ρ S_ρ = S_Φ`) guarantees that `current_method_id` is in at
least one role's observation sub-theory — and by the definition of D_Φ's required sorts, it is
in every role's context (roles execute within methods and must be able to read which method they
are in). Therefore, if G3 passes, components (1) and (3) of obs are determined by the role
declarations without additional specification. Component (2) remains an explicit declaration
but is already mandated by §1.2. The obs map is thus **derived**, not independently required,
once G3 holds.

**Design implication.** Schemas that declare roles before declaring the observation map may use
the derived form: fill in §3.2 by citing the G3 role declarations rather than re-specifying
the state components independently. Independent obs(s) declaration is required only when no
role projection covers `current_method_id` — typically, flat methods without role separation,
where G3 would produce a coverage warning (G3-C1 fails or is vacuous). In role-separated
designs, declaring roles at G3 and declaring obs(s) independently are redundant for the
method-identity component; the independent declaration is still useful as a legibility aid
but is not a distinct formal obligation.

**Concrete illustration — M1-IMPL (Φ_SI).** The orchestrator role in M1-IMPL has an
observation projection that reads: which sub-agent findings exist, which review gates are
blocked, and which tasks are marked complete. This is exactly the state information that
`δ_{Φ_SI}` consults before selecting the next method. The observation map for Φ_SI therefore
does not need to be specified separately from the orchestrator's G3 observation projection
— the projection already encodes the discriminating state components. The G3 coverage claim
for Φ_SI (the orchestrator's projection covers the gate-and-finding dimensions, and the
methodology's required sorts are in the orchestrator's sub-theory) entails that `obs(s)` is
well-defined. This coupling — that `δ_Φ` reads what `π_{ρ_current}` sees — is not incidental;
it is the formal content of the observation map derivation result. The transition function and
the observation map are coupled through the role projection: `δ_Φ` discriminates states in
exactly the way the currently executing role observes them.

---

## 4. Transition Function Declaration (δ_Φ)

δ_Φ is the coalgebraic heart of the methodology (Definition 7.1, F1-FTH §7):

```
δ_Φ : Mod(D_Φ) → Option(Method)
```

It is Markovian in D_Φ's state: the current state `s` is the sole input. If the
identity of the previously executed method is relevant to method selection, it must be
encoded in `D_Φ` — specifically in the `current_method_id` sort or in an
`execution_history` sort if sequential patterns matter.

### 4.1 Method Inventory

List every method in range(δ_Φ). For each, declare its domain retraction pair and
state the retraction condition. This satisfies G4-Φ1 (transition function typing) and
G4-Φ2 (retraction existence).

```
Method inventory:

  M₁:
    identifier: [name or reference]
    domain theory: D₁ = (Σ₁, Ax₁)
    retraction pair:
      embed_1   : Mod(D_Φ) → Mod(D₁)
        [describe how D_Φ-states are expanded into D₁-states — what new sorts or
         relations are added, and what default values are assigned to sorts in Σ₁ \ Σ_Φ]
      project_1 : Mod(D₁) → Mod(D_Φ)
        [describe which D₁ components are read back into D_Φ; what is discarded]
    retraction condition claim:
        project_1 ∘ embed_1 = id on subspace(M₁)
        [state why: name the specific sorts and relations that M₁ reads or writes,
         and argue that projecting back to D_Φ preserves exactly those dimensions]

  M₂:
    [same structure as M₁]

  ...
```

**None (termination):** `None` is always a valid return value of δ_Φ. It requires no
retraction pair. Terminal states are those where `δ_Φ(s) = None` — see §4.3.

### 4.2 Condition Table (Hand-Authored δ_Φ)

Specify δ_Φ as an explicit condition table. Each row has a state condition (expressible
in Σ_Φ) and a method selection or termination decision. This is the hand-authored
specification required by G4-Φ1.

The table format:

```
| Condition on s (Σ_Φ expression) | δ_Φ(s) returns |
|----------------------------------|-----------------|
| [condition₁]                    | Some M₁         |
| [condition₂]                    | Some M₂         |
| ...                              | ...             |
| [terminal condition₁]           | None            |
| [terminal condition₂]           | None            |
| [default / else]                | [Some Mₖ or None] |
```

**Requirements for the condition table:**

1. Every method listed in §4.1 must appear at least once in the "returns" column.
   A method that never gets selected is dead code — remove it from the inventory.

2. All conditions must be expressible in Σ_Φ's signature: sorts, function symbols,
   and predicates declared in §1. Conditions that reference sorts not in Σ_Φ are
   ill-typed.

3. The conditions must be mutually exclusive and jointly exhaustive over
   `Mod(D_Φ)` — every valid state routes to exactly one row. State the
   exhaustiveness argument in §4.2.1.

4. Decision tree alternative: if the table grows unwieldy (>6 rows), replace it
   with an explicit decision tree. Each internal node is a condition over Σ_Φ;
   each leaf is `Some Mᵢ` or `None`. The table format and the decision tree format
   are formally equivalent.

### 4.2.1 Completeness Claim

```
Completeness claim: [argue that the conditions in §4.2 are jointly exhaustive — that
  every state s ∈ Mod(D_Φ) satisfies exactly one row's condition. Minimally: state
  the partition of Mod(D_Φ) that the conditions induce, and confirm it covers all
  valid states.]
```

If the table has an explicit default row (an "else" clause), the completeness claim
is trivially satisfied by construction. Note this explicitly if applicable.

### 4.3 Terminal Conditions

**Exhaustively enumerate** every condition under which δ_Φ returns `None`. This is
required for G4-S2 (execution path existence): there must exist at least one initial
state from which a None-returning state is reachable.

```
Terminal conditions:
  TC-1: [condition under which δ_Φ(s) = None]
    justification: [why this state is a valid endpoint for the methodology]
  TC-2: [condition]
    justification: [...]
  ...

Reachability of None: [name a specific execution sequence — from a valid initial
  state, selecting methods in order — that terminates by reaching a state satisfying
  TC-1 (or TC-k). This is the G4-S2 witness.]
```

### 4.4 Honest Boundary Note — Extension E3

The condition table in §4.2 is a **hand-authored δ_Φ**: the designer specifies the
method-selection policy at design time, in terms of state conditions. This is the
correct choice when:

- The state space is small enough to enumerate conditions;
- The method-selection logic is well-understood and stable;
- No trajectory data from past executions is available to fit a learned policy.

**Extension E3 (F2-OPR)** would replace this table with a **learned policy**
`δ_Φ^*` derived from the MDP `(Mod(D_Φ), Methods, T, R)` where `T` is a transition
distribution fit from `(state, method_chosen, outcome)` tuples and `R` is a reward
function related to O_Φ. The data structure required by E3 is already named in §1.3
as the `execution_history` sort.

A methodology designed with this schema should be **instrument-ready for E3**: the
D_Φ sorts declared in §1 are precisely the state components that E3's feature
representation would need. A designer who anticipates future learning should include
`execution_history : Seq(Method × Outcome)` in §1.3 and record it in the condition
table's conditions, even if it is not yet used for selection.

---

## 5. Inter-Method Coherence Declaration

This section satisfies G4-Φ3. It is required whenever two or more methods in
range(δ_Φ) have non-empty shared subspaces.

**Definition 7.3 (F1-FTH §7) recalled:** When methods Mᵢ and Mⱼ in Φ have
different domain theories Dᵢ and Dⱼ, D_Φ must admit retraction pairs for each.
The coherence condition requires that embedding into Dᵢ and projecting back, versus
embedding into Dⱼ and projecting back, agree on all shared dimensions:

```
∀ s ∈ Mod(D_Φ). ∀ Mᵢ, Mⱼ in range(δ_Φ). subspace(Mᵢ) ∩ subspace(Mⱼ) ≠ ∅ →
  project_i(embed_i(s)) ↾ shared = project_j(embed_j(s)) ↾ shared
```

where `↾ shared` restricts to `subspace(Mᵢ) ∩ subspace(Mⱼ)`.

### 5.1 Shared Subspace Identification

For each pair (Mᵢ, Mⱼ) in range(δ_Φ):

```
  Pair (Mᵢ, Mⱼ):
    subspace(Mᵢ) = [sorts and relations that Mᵢ reads or writes in D_Φ]
    subspace(Mⱼ) = [sorts and relations that Mⱼ reads or writes in D_Φ]
    intersection: subspace(Mᵢ) ∩ subspace(Mⱼ) = [sorts in common; or ∅]
```

If `subspace(Mᵢ) ∩ subspace(Mⱼ) = ∅` for a pair: coherence for this pair is vacuously
satisfied. Record this explicitly.

If all methods in range(δ_Φ) share the same domain theory (Dᵢ = Dⱼ for all i, j):
coherence is vacuously satisfied for all pairs. Record this and skip to §6.

### 5.2 Coherence Claims

For each pair with non-empty intersection:

```
  Pair (Mᵢ, Mⱼ), shared subspace: [sorts listed]
    coherence claim: project_i(embed_i(s)) ↾ shared = project_j(embed_j(s)) ↾ shared
    argument: [why this holds — either because embed_i and embed_j agree on the
      shared sorts (they map them identically from D_Φ), or because project_i and
      project_j both read the same D_Φ components for those sorts]
    status: [proven | claimed | open obligation]
```

**Status guidance:**
- `proven`: a formal argument exists demonstrating the equality.
- `claimed`: the design intention is clear and the equality holds by inspection of
  the embed/project definitions, but no formal proof has been written.
- `open obligation`: the coherence claim is known to be required but has not been
  verified. This must be registered as an open item in §10.

### 5.3 Sequential vs. Concurrent Scope

The coherence condition declared here is the **sequential condition**: state is
consolidated between method executions. δ_Φ selects one method at a time; state
passes through `project_i` before the next `embed_j` is applied.

The **concurrent case** — where Mᵢ and Mⱼ execute simultaneously before state
consolidation — is **out of scope**. It depends on the resolution of open problem P4
(F2-OPR: parallel retraction coherence). Until P4 is resolved, concurrent
methodologies cannot satisfy G4-Φ3 and are excluded from this schema's scope.

---

## 6. Termination Certificate

This section satisfies G4-Φ4. A methodology must either provide a well-founded
measure (Case A) or explicitly declare a proof obligation (Case B). The absence of
either is a gate failure.

### 6.1 Case A — Certificate Provided

Provide a well-founded measure `ν : Mod(D_Φ) → ℕ` and argue that every method
execution strictly decreases it (Definition 7.4, F1-FTH §7):

```
∀ s ∈ Mod(D_Φ). δ_Φ(s) = Some Mᵢ → ν(exec_{Mᵢ}(s)) < ν(s)
```

**Fields:**

```
Measure function:
  ν(s) = [expression over sorts of D_Φ]
  [Example: ν(s) = remaining_items(s) — the count of items not yet processed]
  [Example: ν(s) = max_iterations - iteration_count(s)]

Base case:
  [State the minimum value ν can take and confirm it is ≥ 0:
   "ν(s) ≥ 0 for all s ∈ Mod(D_Φ), with ν(s) = 0 iff s satisfies a terminal condition."]

Convergence argument (for each Mᵢ):
  Mᵢ: [argue why ν(exec_{Mᵢ}(s)) < ν(s) — what dimension of state Mᵢ strictly
    decreases, and why it cannot decrease indefinitely (i.e., why ν is bounded below)]
  Mⱼ: [...]
  ...
```

A credible argument naming what decreases and why it cannot decrease indefinitely
satisfies this condition. A formal proof is not required for gate passage.

### 6.2 Case B — Proof Obligation Declared

If the convergence of δ_Φ depends on runtime conditions that cannot be certified at
design time:

```
Termination obligation:
  Obligation name: [assign a unique identifier, e.g., TERM-OBL-001]
  Status: declared (not-yet-certified-terminating)
  What would satisfy it: [describe the evidence that would close this obligation —
    e.g., "a proof that execution_history grows monotonically and is bounded by
    the total number of valid initial states," or "empirical convergence data from
    EXP-003 showing termination in all observed sessions"]
  Open item registration: [cross-reference §10, item OI-k]
```

A methodology declaring Case B passes G4-Φ4 with a WARN, not a FAIL, provided all
other G4-Φ conditions pass (G4_revised §4b).

### 6.3 Which Case Applies

```
Termination case: [Case A | Case B]
```

State this explicitly. Do not leave it implicit.

---

## 7. Validation Checklist

A completed Φ-schema declaration is valid iff all items below are checked. Use this
list before submitting the declaration for gate evaluation.

```
D_Φ Declaration:
  [ ] D_Φ identifier assigned
  [ ] Required sorts present: current_method_id, phase_index, O_Φ_satisfied
  [ ] All additional sorts named in §1.3 referenced in at least one axiom or δ_Φ condition
  [ ] Function symbols Ω_Φ declared with typed signatures; every argument sort is in S_Φ
  [ ] Predicate symbols Π_Φ declared with typed signatures; every argument sort is in S_Φ
  [ ] Axioms Ax_Φ are closed sentences over Σ_Φ; no free variables
  [ ] Minimum axioms present: O_Φ_satisfied ↔ O_Φ(s), initial condition on current_method_id

O_Φ Declaration:
  [ ] O_Φ stated as a predicate on Mod(D_Φ)
  [ ] O_Φ expressible in Σ_Φ (G4-S1)
  [ ] Non-vacuousness: at least one execution reaching O_Φ described (G4-S2)
  [ ] Constituent method objectives Oᵢ compatible with O_Φ (each terminal state advances O_Φ)

Observation Map:
  [ ] obs function declared (standard or refined)
  [ ] Granularity justification present
  [ ] Bisimulation consequence stated (what "equivalent methodology" means under this map)

Transition Function:
  [ ] All methods in range(δ_Φ) listed in §4.1 inventory (G4-Φ1)
  [ ] Each method has a declared retraction pair (embed_i, project_i) with retraction condition claim (G4-Φ2)
  [ ] Condition table covers all reachable states — completeness argument present (§4.2.1)
  [ ] Every method in inventory appears in condition table
  [ ] Terminal conditions exhaustively enumerated (§4.3)
  [ ] None-reachability: an execution reaching a terminal condition is described (G4-S2)
  [ ] Honest boundary noted: E3 scope identified (§4.4)

Inter-Method Coherence:
  [ ] All method pairs enumerated (§5.1)
  [ ] Shared subspaces identified per pair
  [ ] Vacuous cases noted (empty intersection or identical domain theories)
  [ ] Non-vacuous pairs: coherence claim present with argument and status (G4-Φ3)
  [ ] Sequential scope confirmed; concurrent case explicitly deferred pending P4

Termination:
  [ ] Case A or Case B stated explicitly (§6.3)
  [ ] Case A: ν declared, base case stated, convergence argument per method present (G4-Φ4a)
  [ ] Case B: obligation named, evidence requirement stated, open item registered (G4-Φ4b)
```

---

## 8. Example: Minimal Methodology

The following is a complete Φ-schema declaration for a minimal methodology with two
methods in range(δ_Φ). Every field is filled in. The example is deliberately small;
its purpose is to demonstrate format compliance, not domain depth.

**Setting:** A research methodology that selects between an exploration method and an
analysis method based on whether sufficient data has been collected.

---

### §1 — D_Φ

**D_Φ identifier:** `D_Φ_RESEARCH`

**Required sorts:**
- `current_method_id : Option({EXPLORE, ANALYZE})`
- `phase_index : ℕ ∪ {⊥}`
- `O_Φ_satisfied : Bool`

**Additional sorts:**
- `data_items : ℕ` — count of collected data items
- `analysis_complete : Bool` — whether analysis has produced a conclusion

**Function symbols Ω_Φ:**
- `item_count : Mod(D_Φ_RESEARCH) → ℕ` — returns `data_items(s)`

**Predicate symbols Π_Φ:**
- `sufficient_data : Mod(D_Φ_RESEARCH) → Bool` — `data_items(s) ≥ 10`
- `no_data : Mod(D_Φ_RESEARCH) → Bool` — `data_items(s) = 0`

**Axioms Ax_Φ:**
```
Ax-Φ-1: ∀ s. O_Φ_satisfied(s) ↔ (analysis_complete(s) = true)
Ax-Φ-2: ∀ s. current_method_id(s_init) = None ∧ phase_index(s_init) = ⊥ ∧ data_items(s_init) = 0
Ax-Φ-3: ∀ s. data_items(s) ≥ 0
```

---

### §2 — O_Φ

```
O_Φ(s) = (analysis_complete(s) = true)
```

**Constituent objectives:**
- M_EXPLORE (M₁): `O_EXPLORE(s₁) = (data_items(project_1(s₁)) > data_items(s_before))`
  — exploration succeeds iff it increases data_items.
  Compatibility: every terminal state of M₁ has more data_items than before, which is
  progress toward eventually satisfying `sufficient_data` and thence `O_Φ`.
- M_ANALYZE (M₂): `O_ANALYZE(s₂) = (analysis_complete(project_2(s₂)) = true)`
  — analysis succeeds iff it produces a conclusion.
  Compatibility: every terminal state of M₂ satisfies O_Φ directly via Ax-Φ-1.

**Non-vacuousness:** Execute M_EXPLORE until data_items ≥ 10 (at most 10 iterations if
each adds 1 item), then execute M_ANALYZE once. The terminal state satisfies O_Φ.

---

### §3 — Observation Map

```
obs(s) = (current_method_id(s), phase_index(s), O_Φ(s))
```

**Granularity justification:** Standard map. No additional state components are
required to discriminate relevant behaviors: two research methodology executions that
agree on which method is running, where in it they are, and whether the analysis is
complete are observationally equivalent.

**Bisimulation consequence:** Two research methodologies are bisimilar under this map
iff they agree on method-selection decisions at every state where
`(current_method_id, phase_index, O_Φ_satisfied)` match. Methodologies that differ
only in which specific exploration sub-strategy they use within M_EXPLORE are
bisimulation-equivalent provided their post-execution states agree on the standard map.

---

### §4 — δ_Φ

**Method inventory:**

```
M₁ = M_EXPLORE:
  domain theory: D_EXPLORE = (Σ_EXPLORE, Ax_EXPLORE)
    [D_EXPLORE extends D_Φ_RESEARCH with sorts for search_space and candidate_items]
  embed_1: s ↦ s with search_space = full_domain, candidate_items = ∅
    [adds search_space initialized to the declared research domain; adds candidate_items
     initialized to empty set; all D_Φ sorts carry over unchanged]
  project_1: s₁ ↦ s₁ ↾ D_Φ_RESEARCH_sorts
    [discards search_space and candidate_items; retains data_items, analysis_complete,
     current_method_id, phase_index, O_Φ_satisfied]
  retraction condition: project_1(embed_1(s)) = s on subspace(M_EXPLORE)
    subspace(M_EXPLORE) = {data_items, current_method_id, phase_index}
    Argument: embed_1 copies data_items unchanged; project_1 reads data_items back.
    Round-trip is identity on data_items, current_method_id, phase_index. ✓

M₂ = M_ANALYZE:
  domain theory: D_ANALYZE = (Σ_ANALYZE, Ax_ANALYZE)
    [D_ANALYZE extends D_Φ_RESEARCH with sorts for hypothesis and evidence_set]
  embed_2: s ↦ s with hypothesis = None, evidence_set = current data_items as evidence
  project_2: s₂ ↦ s₂ ↾ D_Φ_RESEARCH_sorts
    [retains analysis_complete, data_items, current_method_id, phase_index]
  retraction condition: project_2(embed_2(s)) = s on subspace(M_ANALYZE)
    subspace(M_ANALYZE) = {data_items, analysis_complete, current_method_id, phase_index}
    Argument: embed_2 reads data_items to populate evidence_set; project_2 writes back
    analysis_complete; data_items is passed through unchanged. Round-trip is identity
    on the named subspace. ✓
```

**Condition table:**

| Condition on s | δ_Φ(s) returns |
|----------------|----------------|
| `¬sufficient_data(s) ∧ ¬O_Φ(s)` | `Some M_EXPLORE` |
| `sufficient_data(s) ∧ ¬O_Φ(s)` | `Some M_ANALYZE` |
| `O_Φ(s)` | `None` |

**Completeness claim:** The three conditions partition `Mod(D_Φ_RESEARCH)`:
- Every state either satisfies `O_Φ(s)` (row 3) or does not.
- Among states not satisfying `O_Φ(s)`: either `sufficient_data(s)` holds (row 2) or not (row 1).
- The conditions are mutually exclusive and the disjunction covers all valid states. ✓

**Terminal conditions:**
```
TC-1: O_Φ(s) = true, i.e., analysis_complete(s) = true
  Justification: The global objective is satisfied; no further method execution serves any purpose.

Reachability of None: From s_init (data_items = 0, analysis_complete = false):
  Execute M_EXPLORE until data_items ≥ 10 (≤ 10 EXPLORE iterations by induction on data_items).
  Then execute M_ANALYZE once: its terminal state satisfies O_ANALYZE, which sets
  analysis_complete = true via project_2. The resulting state satisfies TC-1. ✓
```

**Honest boundary:** The condition table uses `sufficient_data` (a threshold on data_items).
In practice, what counts as "sufficient" for analysis is epistemically complex. Extension E3
would replace this hard threshold with a learned policy that has seen many exploration–analysis
cycles and knows, from trajectory data, when additional exploration is no longer productive.

---

### §5 — Inter-Method Coherence

```
Pair (M_EXPLORE, M_ANALYZE):
  subspace(M_EXPLORE) = {data_items, current_method_id, phase_index}
  subspace(M_ANALYZE) = {data_items, analysis_complete, current_method_id, phase_index}
  shared subspace = {data_items, current_method_id, phase_index}

  Coherence claim:
    project_1(embed_1(s)) ↾ shared = project_2(embed_2(s)) ↾ shared

  Argument: Both embed_1 and embed_2 copy data_items, current_method_id, and phase_index
    from D_Φ_RESEARCH unchanged (neither method's embedding modifies these during embedding
    — they are read, not written, at embed time). Both project_1 and project_2 read those
    same fields back verbatim. The round-trip is identity on the shared subspace for both
    retractions. Therefore:
      project_1(embed_1(s)).data_items = s.data_items = project_2(embed_2(s)).data_items
    and similarly for current_method_id and phase_index. ✓

  Status: claimed
```

Sequential scope confirmed. Concurrent execution of M_EXPLORE and M_ANALYZE is not
part of this methodology's design; concurrent coherence (P4, F2-OPR) is not applicable.

---

### §6 — Termination Certificate

**Case: A**

```
Measure function:
  ν(s) = 10 - data_items(s) + (1 if ¬analysis_complete(s) else 0)

  Equivalently:
  - If ¬O_Φ(s) ∧ ¬sufficient_data(s):  ν(s) = 10 - data_items(s) + 1   ≥ 2
  - If ¬O_Φ(s) ∧  sufficient_data(s):  ν(s) = 10 - data_items(s) + 1   ≥ 1
  - If  O_Φ(s):                         δ_Φ(s) = None; ν not required to decrease

Base case: ν(s) ≥ 0 for all s ∈ Mod(D_Φ_RESEARCH).
  At O_Φ(s) = true: ν(s) = 0 (data_items ≥ 10, analysis_complete = true → second term = 0).
  ν is bounded below by 0.

Convergence arguments:
  M_EXPLORE: Each execution of M_EXPLORE increases data_items by at least 1
    (enforced by O_EXPLORE: terminal states have strictly more data_items than the
    pre-execution state). Therefore ν(exec_{M_EXPLORE}(s)) ≤ ν(s) - 1 < ν(s). ✓

  M_ANALYZE: M_ANALYZE is selected only when sufficient_data(s) holds, i.e.,
    data_items(s) ≥ 10. Its terminal state satisfies analysis_complete = true, setting
    O_Φ(s') = true. Since O_Φ(s') = true → δ_Φ(s') = None, M_ANALYZE executes at most
    once per methodology run. ν decreases from ≥ 1 to 0 across this execution. ✓
```

---

## 9. Theorem Candidate

**THMC-001 (Method-Attributability Bisimulation)**

Method-attributable insights — results reproducible across agents executing the same
method — correspond to methodologies with smaller bisimulation equivalence classes under
the standard observation map `obs(s) = (current_method_id, phase_index, O_Φ(s))`.

Formally: a method M is **method-attributable** iff for any two agents A₁, A₂ executing
M under the same methodology Φ:

```
obs(A₁(s)) = obs(A₂(s))  for all reachable states s
```

That is: any two agents executing M are bisimulation-related to each other under the
standard map — they cannot be distinguished by an external observer attending to
(which method is running, where in it, whether the goal is met).

**Consequence:** A methodology with finer-grained observations (more components in obs)
has smaller equivalence classes. Agent-to-agent variation that was invisible under the
standard map becomes visible under a finer map. The finer the map, the harder it is for
method-attributability to hold — more of the variation is attributed to the agents
rather than the method.

**Theorem status:** Candidate. This is not a theorem — it is a conjecture requiring
formal proof. The proof would need to:
1. Define method-attributability precisely (possibly in terms of the success profile
   μ⃗ from Definition 6.1, F1-FTH §6);
2. Show that bisimulation-relatedness of all A₁, A₂ executing M implies the claimed
   reproducibility property;
3. Show the converse: that reproducibility implies bisimulation-relatedness under the
   standard map.

**Connection to H3 (Chronicles/RESEARCH-REPORT.md):** The claim that scientific results
are method-attributable rather than agent-attributable corresponds, in this framework,
to the claim that scientific methodologies have small bisimulation classes. Agents who
produce different results under the same method are producing agent-attributable
variation — detectable precisely because the methodology's observation map is fine
enough to distinguish their states. A coarser map collapses this distinction; a finer
map surfaces it. The appropriate observation granularity for scientific reproducibility
is an empirical question, not a formal one.

---

## 10. Open Items Surfaced

Items that belong in F2-OPR or as future revisions to this schema:

**OI-1 — Observation map refinement criteria**
The schema declares the standard observation map as the default but gives no formal
criterion for when refinement is warranted. A principled criterion would state: "Refine
obs by adding component c iff there exist two methodologically distinct behaviors that
agree on the current obs but disagree on c." Formalizing "methodologically distinct" in
terms of the methodology's objectives would turn this into a decision procedure.
Belongs in: F2-OPR as a sub-problem of E4.

**OI-2 — Learned policy interface (Extension E3)**
The honest boundary note in §4.4 identifies the data structures E3 requires (execution
history, feature representation) but does not specify the interface between the
hand-authored δ_Φ and the learned δ_Φ^*. A schema revision should include a field
for declaring the MDP reward function R and the state feature representation, so that
a methodology designed with hand-authored δ_Φ can be upgraded to E3 without redesigning
D_Φ. Belongs in: F2-OPR E3, and a future §4 revision of this schema.

**OI-3 — Concurrent coherence gate (P4)**
§5.3 excludes concurrent methodologies pending P4 resolution. Once P4 (F2-OPR) is
resolved — the tensor product D_i ⊗ D_j is formally defined and the commutativity
condition is stated precisely — a §5.4 should be added covering the concurrent coherence
declaration. Until then, any methodology with concurrent method execution cannot be
validated against this schema.

**OI-4 — Terminal coalgebra construction and schema completeness**
A methodology satisfying this schema is a coalgebra for the functor F(X) = 1 + Method
on Mod(D_Φ). The terminal coalgebra for F is the final object in the category of
F-coalgebras — the "universal" methodology that all others map into. Whether the
terminal coalgebra for this specific functor exists (given the structure of Mod(D_Φ)
as a class, not a set) is related to P5 (F2-OPR: categorical completeness of Meth).
If the terminal coalgebra exists, it provides a canonical reference point for
bisimulation equivalence: two methodologies are bisimilar iff they have the same image
in the terminal coalgebra. A future schema revision should include a field noting whether
the designer intends their Φ to be the terminal coalgebra in a given subcategory.
Belongs in: F2-OPR E4, E5.

**OI-5 — Termination obligation closure protocol**
Case B (§6.2) declares a proof obligation but does not specify when or how it is closed.
A future schema revision should include: (a) a protocol for converting a Case B
declaration to Case A once evidence is available; (b) a specification of what "empirical
convergence data" means precisely enough to count as evidence (relevant to EXP-003).

---

## Empirical Bridge Note

*— Dr. Renata Möll*

This schema gives us the formal skeleton; EXP-003 must give it bones. Three things the
schema cannot settle without experimental data: First, whether the standard observation
map `obs(s) = (current_method_id, phase_index, O_Φ(s))` is coarse enough to be useful
in practice — if two agents executing the same method diverge in ways that this map
cannot detect, the map is giving us false equivalences, and we need to know that before
we trust bisimulation certificates. Second, whether hand-authored condition tables (§4.2)
degrade gracefully when the state space grows: the minimal example in §8 has three rows;
real methodologies may have dozens of conditions, and it is not obvious that human
designers can write exhaustive, mutually-exclusive condition tables at that scale —
EXP-003 should include a methodology with at least six methods in range(δ_Φ) and
measure how often the completeness claim (§4.2.1) is wrong at first draft. Third, the
termination certificate in Case A rests on O_EXPLORE guaranteeing that each exploration
run strictly increases data_items; whether LLM-executed methods actually satisfy their
objectives reliably enough to make ν a valid measure is exactly the question E2
(probabilistic steps) and EXP-003 must answer together — a methodology that certifies
termination via ν but whose constituent methods satisfy their objectives only 80% of the
time is not, in practice, certifiably terminating.
