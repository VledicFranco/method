---
guide: 3
title: "The Meta-Method Family (P0)"
domain: registry
audience: [method-designers]
summary: >-
  How methods are designed, compiled, evolved, and composed. The P0-META methodology and its methods.
prereqs: [1, 2]
touches:
  - registry/P0-META/
---

# Guide 3 — The Meta-Method Family (P0)

P0-META (v1.2) is the methodology that governs how methods are built, evolved, and maintained. It's the self-referential foundation: the method system that produces method systems.

## What P0-META Does

P0-META receives a **registry state** — the current set of methods with their compilation status, known gaps, and pending work — and selects the next meta-method to run:

```
δ_META(s) =
  Priority 1: Compiled method has HIGH/CRITICAL gap  → M3-MEVO (evolve it)
  Priority 2: Domain sketch ready, no method covers it → M1-MDES (design one)
  Priority 3: Method needs project instantiation       → M4-MINS (instantiate)
  Priority 4: Two methods form a composable pair       → M5-MCOM (compose)
  Priority 5: Informal method needs formalization      → M6-MAUD (audit)
  Priority 6: Method has implementation target         → M7-DTID (derive impl)
  Priority 7: Domain has informal practice             → M2-MDIS (discover)
```

The objective: all methods in the target registry are `compiled_clean` (compiled, no HIGH gaps) and all meta-methods are self-consistent.

## The Meta-Methods

### M1-MDES — Method Design

Takes established domain knowledge and crystallizes it into a compiled method. This is the workhorse — every method in the system was designed using M1-MDES.

**Step DAG:**
```
σ₀ Orientation     → Is there enough domain knowledge to proceed?
σ₁ Domain Theory   → Declare sorts, predicates, axioms (D)
σ₂ Objective       → Define what success looks like (O) and how to measure it (μ⃗)
σ₃ Role Design     → Partition observation and authority (Roles)
σ₄ Step DAG        → Construct the execution path (Γ) with composability claims
σ₅ Guidance Audit  → Verify step guidance covers all output fields
σ₆ Compilation     → Run G0-G6 gates; emit PASS or FAIL with repair targets
```

Two roles: **designer** (σ₀-σ₅, has domain knowledge) and **compiler** (σ₆, has only the candidate document — no domain context). The role switch at σ₆ is deliberate epistemic separation: the compiler can't be influenced by the designer's intent, only by what's written.

**Key design feature: the contrarian challenge.** At σ₄, the designer must identify the weakest composability claim in the step DAG, explain why it might fail, and defend or revise it. This structural self-criticism catches the most common failure: steps that look composable but aren't because of implicit assumptions.

### M3-MEVO — Method Evolution

Takes a compiled method with a known gap (from execution evidence) and produces a new version. The gap is a specific, named problem — not a vague "could be better."

Evolution is version-controlled: the new version must claim it **refines** the old version (every state satisfying the new objective also satisfies the old one). This prevents "improvements" that break existing users.

### M4-MINS — Method Instantiation

Takes a compiled method and a project context, produces a project instance. This is the method behind [Project Cards](06-project-cards.md): the project card is the input, and M4-MINS produces the instance.

**Key concept: conservative extension.** The project instance extends the abstract method's domain theory (adds new sorts, predicates, axioms) without modifying existing axioms. This guarantees the instance is compatible with the abstract method — anything that worked before still works.

### M5-MCOM — Method Composition

Takes two compiled methods that share an interface and produces a composite method that runs them sequentially. The interface is the set of sorts that one method's output shares with the other method's input.

### M2-MDIS — Method Discovery from Informal Practice

Takes an observed informal practice — a recurring pattern identified from retrospective signals, council debates, cross-project examination, or human intuition — and structures it through the protocol lifecycle: recognize, draft, trial, evaluate, promote. Produces either a compiled method (via M1-MDES), a promoted axiom/protocol, or an archived learning. Five linear steps: recognize (validate the observation) -> draft (write protocol YAML) -> trial (enforce on one project, collect data) -> evaluate (check promotion criteria) -> promote (formalize or archive). This is the mechanism by which the method system grows from execution evidence rather than top-down design. Compiled v1.0, all gates PASS.

### M6-MAUD — Method Audit (Planned)

Referenced in δ_META arm 5 (priority 5: informal method needs formalization -> M6-MAUD), but M6-MAUD has no compiled YAML in the registry and no registry directory yet. Its domain theory D_MAUD is referenced in P0-META's RP-5 retraction pair but is not formally declared. Compiling M6-MAUD is an open work item — it would formalize informal methods through a structural audit analogous to the compilation gates.

### M7-DTID — Domain Theory to Implementation Derivation

Takes a compiled method and derives a software implementation from its domain theory. This bridges theory and code — the implementation must be *faithful* to the domain theory (every sort maps to a type, every predicate maps to a check, every axiom maps to an invariant).

## CMEM-PROTO — Council Memory Protocol

CMEM-PROTO (draft v0.1) is a protocol under P0-META that extends M1-COUNCIL with persistent cross-session context. Each topic gets a memory file that accumulates the active cast, decisions made, open questions, key tensions, and evolution history. When a council session resumes a topic, it loads the memory file to restore continuity. CMEM-PROTO's effect on M1-COUNCIL is described in [Guide 4](04-execution-methods.md).

## Self-Application

P0-META was designed using M1-MDES. This is self-application: the meta-method for designing methods was used to design the meta-method for designing methods.

Gate-by-gate:
- **G0**: P0-META's navigation answers what/who/why/how/when
- **G1**: D_META has 11 sorts, 5 function symbols, 13 predicates, 8 axioms
- **G2**: O_META is a closed sentence over D_META
- **G3**: One role (meta-architect) with full visibility
- **G4**: δ_META is a priority-ordered transition function with termination certificate ν_META
- **G5**: Each arm has operationalization criteria
- **G6**: P0-META.yaml

P0-META can also be evolved using M3-MEVO. If execution evidence shows the priority ordering produces suboptimal selections (e.g., composition should happen before instantiation), M3-MEVO would produce P0-META v2.0 with revised priorities.

## The Registry

The meta-method family manages a **registry** — a set of methods with their compilation status:

```
registry/
  P0-META/           ← the meta-methodology (v1.2)
    M1-MDES/          compiled v1.0
    M2-MDIS/          compiled v1.0 (all gates PASS)
    M3-MEVO/          compiled v0.1
    M4-MINS/          compiled v1.2
    M5-MCOM/          compiled v1.1
    M6-MAUD/          uncompiled (referenced in δ_META arm 5, no registry directory yet)
    M7-DTID/          compiled v1.1
    CMEM-PROTO        draft v0.1 (Council Memory Protocol — extends M1-COUNCIL)
  P1-EXEC/           ← execution methodology
    M1-COUNCIL/       compiled v1.3
    M2-ORCH/          compiled v1.0
    M3-TMP/           compiled v1.0
    M4-ADVREV/        trial v0.1
  P2-SD/             ← software delivery methodology
    M1-IMPL/          compiled v3.1
    M2-DIMPL/         compiled v1.0
    ...7 methods total
  P3-DISPATCH/       ← dispatch methodology (v1.0, compiled)
  P3-GOV/            ← governance methodology (v0.1, draft)
  P-GH/              ← GitHub operations methodology (v1.0, compiled)
```

δ_META evaluates the registry state and selects the next meta-method to run. When all methods in the target scope are `compiled_clean`, δ_META returns None — the registry is complete.

## How This Relates to Your Work

If you're **using** methods (running M1-IMPL to implement code, running M3-TMP to answer a question), you don't need to think about P0. The methods are compiled and ready to use.

If you're **designing** methods (creating a new method for a new domain), you'll use M1-MDES. The [compilation gates guide](07-compilation-gates.md) explains what each gate checks.

If you're **instantiating** methods for a project (adapting M1-IMPL for your specific codebase), you'll use M4-MINS via [project cards](06-project-cards.md).

## Next

[Guide 4](04-execution-methods.md) explains P1-EXEC's four execution methods — when to debate, when to orchestrate, when to reason sequentially, and when to run adversarial review.
