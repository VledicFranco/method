---
guide: 1
title: "What is a Method?"
domain: concepts
audience: [everyone]
summary: >-
  The 5-tuple formal structure, steps, objectives, and why formalism matters.
touches:
  - registry/
  - theory/
---

# Guide 1 — What is a Method?

A method is a formal specification of how to get something done. Not a vague process description — a precise structure with defined inputs, steps, roles, and success criteria.

## The 5-Tuple

Every method in this system is a **5-tuple**:

```
M = (D, Roles, Γ, O, μ⃗)
```

| Component | What it is | Plain English |
|-----------|-----------|---------------|
| **D** | Domain Theory | The world the method operates in — what things exist and what rules they follow |
| **Roles** | Team Topology | Who does what, what each role can see, what each role is allowed to do |
| **Γ** | Step DAG | The sequence of steps from start to finish |
| **O** | Objective | What "done" looks like — a testable condition, not a wish |
| **μ⃗** | Success Profile | How to measure progress toward the objective |

### Example: M3-TMP (Traditional Meta-Prompting)

M3-TMP is the simplest method in the system. An agent receives a challenge, decomposes it into sub-questions, addresses each one, and verifies the result.

```
D  = { Challenge, SubQuestion, Answer, Response, VerifyCheck }
     with axioms: every challenge has ≥1 sub-question, completeness ↔ all addressed

Roles = { analyst }
        one role, sees everything, does everything

Γ  = sigma_0 (Orient) → sigma_1 (Execute) → sigma_2 (Verify)
     three steps, linear path, no loops

O  = complete(response, decomposition) AND consistent(response)
     all sub-questions answered, no internal contradictions

μ⃗ = (coverage: fraction of sub-questions addressed,
      consistency: 1 if no contradictions, 0 otherwise)
```

That's the whole method. Three steps. One role. Two measures. But every piece is explicit: you can check whether the objective is met, measure progress, and verify that steps compose correctly.

## Why Formalism?

You might ask: "Why not just write instructions?"

Because instructions are ambiguous. A method that says "review the code carefully" gives the agent no way to know when it's done. A method that says `O = report_complete(reviewReport) AND verdict_of(reviewReport) ∈ {PASS, CONDITIONAL, FAIL}` — the agent knows exactly what "done" means.

Formalism buys you three things:

1. **Verifiable completion.** The objective O is a predicate — it's either true or false. No judgment needed to determine if the method succeeded.

2. **Composable steps.** Each step has a precondition and postcondition. If post(step_i) ⊆ pre(step_{i+1}), the steps compose correctly. You can verify this statically, before running anything.

3. **Measurable progress.** The success profile μ⃗ tells you how far along you are. If μ₁ = 0.6, you've addressed 60% of the sub-questions. Not vague — a number derived from the current state.

## The Domain Theory (D)

The domain theory defines the world the method operates in. It has three parts:

**Sorts** — the types of things that exist. M3-TMP has 5 sorts: Challenge, SubQuestion, Answer, Response, VerifyCheck. These are not implementation types (no `string`, `int`) — they're domain concepts.

**Predicates** — the relationships and properties that matter. `complete(Response, List(SubQuestion))` means all sub-questions are addressed. `consistent(Response)` means no internal contradictions.

**Axioms** — the rules that are always true. `∀r. complete(r, qs) ↔ ∀sq ∈ qs. addressed(sq, r)` — completeness is definitionally equivalent to all sub-questions being addressed. Axioms constrain what states are valid. A state where `complete` is true but some sub-question is unaddressed violates the axiom — it's not a valid state.

### Domain boundaries

Every domain theory declares what it **excludes**. M3-TMP excludes: the content domain of the challenge, tool availability, execution history across sessions. This prevents scope creep — the method doesn't try to model everything, just the structure it needs to operate.

## Steps and the Step DAG (Γ)

Steps are the method's execution units. Each step has:

- **Precondition**: what must be true before this step runs
- **Postcondition**: what is true after this step completes
- **Guidance**: instructions for the agent executing the step
- **Output schema**: the typed fields the agent must produce

Steps form a **directed acyclic graph** (DAG). Most methods use a simple linear path:

```
sigma_0 → sigma_1 → sigma_2
```

But some methods have branching (step 3 can go to step 4a or 4b depending on a condition) or re-entry loops (step 4 can loop back to step 1, bounded by a termination certificate).

### Composability

The critical property of steps is composability: `post(sigma_i) ⊆ pre(sigma_{i+1})`. This means the output of step i satisfies the input requirements of step i+1. Every method explicitly claims this for each edge in the DAG — and the compilation check (G4) verifies it.

## Roles

A role is not a job title. It's a formal specification of:

- **Observation projection**: what slice of the world this role can see
- **Authorized transitions**: what state changes this role can make

M3-TMP has one role (analyst) that sees everything and can do everything. But more complex methods have multiple roles with different visibility and authority. M1-COUNCIL has three roles: Leader (sees all, can synthesize but not decide), Contrarian (sees from their expertise lens, can argue), Product Owner (sees all, can decide).

The role partition creates **epistemic separation** — different roles know different things. This is how methods produce genuine diversity of perspective rather than one agent talking to itself.

## Objective and Measures

The objective O is a predicate over the method's state space: `O(s) = true` means the method has succeeded in state s. It's not a description of a process — it's a property of the world.

The success profile μ⃗ is a vector of scalar measures that track progress toward O. Each measure is:

- **Observable**: computable from the current state
- **Order-preserving**: states closer to O have higher values
- **Falsifiable**: there exists a state where the measure would be shown to be a poor proxy

## Compilation

A method isn't just written — it's **compiled**. The compilation check runs the method through 7 acceptance gates (G0-G6) that verify structural completeness:

| Gate | Checks |
|------|--------|
| G0 | Navigation: what/who/why/how/when answered? |
| G1 | Domain theory: sorts, predicates, axioms well-formed? |
| G2 | Objective: expressible as Sigma-predicate? Measures well-formed? |
| G3 | Roles: coverage and authority claims hold? |
| G4 | Step DAG: composable? Acyclic? Contrarian challenge addressed? |
| G5 | Guidance: constraints-first format? Covers all output fields? |
| G6 | YAML encoding: structurally complete? |

A method that passes all 7 gates is **compiled** — it's structurally sound and ready to execute. See [Guide 7](07-compilation-gates.md) for details on each gate.

## Next

Now that you know what a method is, [Guide 2](02-what-is-a-methodology.md) explains how **methodologies** select between methods at runtime.
