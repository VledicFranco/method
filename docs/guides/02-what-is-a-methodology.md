---
guide: 2
title: "What is a Methodology?"
domain: concepts
audience: [everyone]
summary: >-
  How methodologies route to methods via transition functions. P1-EXEC as worked example.
prereqs: [1]
touches:
  - registry/
  - packages/core/src/
---

# Guide 2 — What is a Methodology?

A method tells you how to do one thing. A methodology tells you **which method to use**.

## The 3-Tuple

A methodology is a **3-tuple**:

```
Φ = (D_Φ, δ_Φ, O_Φ)
```

| Component | What it is | Plain English |
|-----------|-----------|---------------|
| **D_Φ** | Domain Theory | The routing state — what the methodology needs to know to pick a method |
| **δ_Φ** | Transition Function | The decision logic — given the current state, which method runs next? |
| **O_Φ** | Objective | What "done" looks like for the methodology (not just the selected method) |

A methodology doesn't have steps or a step DAG — it has a **transition function** that selects methods. The selected method has the steps.

## Example: P1-EXEC (Execution Methodology)

P1-EXEC receives a challenge and decides how to execute it: structured debate (M1-COUNCIL), parallel orchestration (M2-ORCH), sequential reasoning (M3-TMP), or adversarial review (M4-ADVREV).

```
D_Φ = { Challenge, ChallengeProperties, MethodChoice, ExecutionResult, State }

δ_EXEC(s) =
  if adversarial_pressure_beneficial(challenge) → M1-COUNCIL
  else if decomposable_before_execution(challenge) → M2-ORCH
  else → M3-TMP

O_Φ = method_completed AND result_of(s) ≠ None AND addresses(result, challenge)
```

That's the whole methodology. It evaluates two predicates (does this need debate? can we parallelize?) and routes to one of three methods. A fourth method, M4-ADVREV (adversarial review), is also part of P1-EXEC but is delegation-only — invoked by parent methods via retraction pairs or direct load, not by δ_EXEC predicate evaluation. The selected method runs to completion. The methodology succeeds when the method completes and the result addresses the challenge.

### The Transition Function (δ)

The transition function is a **priority stack** — conditions evaluated in order, first match wins:

```
Priority 1: adversarial_pressure_beneficial? → M1-COUNCIL
Priority 2: decomposable_before_execution?   → M2-ORCH
Priority 3: default                          → M3-TMP
```

This is deterministic: every challenge maps to exactly one routable method. The priority order reflects a design judgment — adversarial pressure is checked first because the cost of missing it (shallow single-perspective answer on a contested problem) is higher than the cost of unnecessary debate (overhead on a simple task). M4-ADVREV is outside this routing — it's a delegable method invoked directly by parent methods when an artifact needs adversarial review.

### Predicate Operationalization

The transition function depends on predicates that must be **evaluable at runtime**. The methodology includes operationalization criteria — concrete True/False conditions for each predicate:

**adversarial_pressure_beneficial** is true when ANY of:
- The problem framing is uncertain (multiple valid ways to frame the question)
- Multiple defensible positions exist (experts would disagree)
- High stakes with understated preconditions
- The framing depends on unstated assumptions

**decomposable_before_execution** is true when:
- 3+ independent sub-tasks with non-overlapping scopes
- Scope boundaries declarable before execution
- Sub-tasks don't share state

These aren't formal definitions — they're heuristics that an executor applies at runtime. The methodology documents them explicitly so two different executors evaluating the same challenge would agree most of the time.

## Method vs Methodology: When to Use Which

| Structure | Has steps? | Has transition function? | When to use |
|-----------|-----------|------------------------|-------------|
| **Method** | Yes (step DAG) | No | You know what to do — execute it |
| **Methodology** | No | Yes (selects methods) | You need to decide what to do first |

A method is for execution. A methodology is for routing.

## How Methods and Methodologies Compose

Methodologies **contain** methods. P1-EXEC contains M1-COUNCIL, M2-ORCH, M3-TMP, and M4-ADVREV. P2-SD contains M7-PRDS, M6-ARFN, M5-PLAN, M2-DIMPL, M1-IMPL, M3-PHRV, and M4-DDAG.

When a methodology selects a method, it uses **retraction pairs** to thread state:

```
embed  : Mod(D_Φ) → Mod(D_M)    — inject methodology state into method's domain
project: Mod(D_M) → Mod(D_Φ)    — project method output back to methodology state
```

For P1-EXEC selecting M3-TMP:
- `embed_TMP(s) = { challenge := s.challenge }` — pass the challenge to M3-TMP
- `project_TMP(t) = { result := t.final_response, method_completed := true }` — take M3-TMP's response back

The retraction pair ensures that `project(embed(s)).challenge = s.challenge` — the challenge survives the round trip. This is how methodologies compose with methods without losing state.

## Example: P2-SD (Software Delivery)

P2-SD is a larger methodology with 7 methods covering the full delivery loop:

```
δ_SD(s) =
  Priority 1: task_type = section      → M7-PRDS  (PRD → SectionMap)
  Priority 2: task_type = architecture  → M6-ARFN  (PRD + codebase → ArchDoc)
  Priority 3: task_type = plan          → M5-PLAN  (PRDSection → PhaseDoc)
  Priority 4: task_type = implement + parallel → M2-DIMPL (parallel + gates)
  Priority 5: task_type = implement     → M1-IMPL  (single-agent)
  Priority 6: task_type = review        → M3-PHRV  (phase → ReviewReport)
  Priority 7: task_type = audit         → M4-DDAG  (N phases → DriftReport)
```

The full delivery loop runs multiple δ_SD invocations over time:

```
PRD arrives     → δ_SD selects M7-PRDS → produces SectionMap
Section ready   → δ_SD selects M6-ARFN → produces ArchDoc
Arch + section  → δ_SD selects M5-PLAN → produces PhaseDoc
PhaseDoc ready  → δ_SD selects M1-IMPL → produces implemented code
Phase complete  → δ_SD selects M3-PHRV → produces ReviewReport
Every 3 phases  → δ_SD selects M4-DDAG → produces DriftReport
```

Each invocation is independent — δ_SD fires once per challenge. The pipeline emerges from sequential invocations, not from a single run.

## Termination

A method terminates when its step DAG completes (finite steps, each executes once or bounded loops). A methodology terminates when its transition function returns None (no more methods to select).

P1-EXEC has a termination certificate: `ν = 2 - |invocations|`. It fires at most twice (initial selection + one ORCH-to-TMP fallback). P2-SD has `ν = 1` — it fires exactly once per challenge.

## The Full Registry

The registry contains six methodologies:

| Methodology | Name | Version | Status | Methods |
|-------------|------|---------|--------|---------|
| **P0-META** | Genesis Methodology | v1.2 | compiled | M1-MDES, M2-MDIS, M3-MEVO, M4-MINS, M5-MCOM, M7-DTID |
| **P1-EXEC** | Execution Methodology | v1.1 | compiled | M1-COUNCIL, M2-ORCH, M3-TMP, M4-ADVREV |
| **P2-SD** | Software Delivery | v2.0 | compiled | M7-PRDS, M6-ARFN, M5-PLAN, M2-DIMPL, M1-IMPL, M3-PHRV, M4-DDAG |
| **P3-DISPATCH** | Dispatch Methodology | v1.0 | compiled | M1-INTERACTIVE, M2-SEMIAUTO, M3-FULLAUTO |
| **P3-GOV** | Governance Methodology | v0.1 | draft | M1-DRAFT, M2-REVIEW, M3-APPROVE, M4-HANDOFF |
| **P-GH** | GitHub Operations | v1.0 | compiled | M1-TRIAGE, M2-REVIEW, M3-RESOLVE, M4-WORK |

## The Meta-Methodology (P0-META)

There's a methodology that governs the methodologies themselves: P0-META. Its transition function δ_META selects meta-methods:

- Gaps in a compiled method → M3-MEVO (evolve it)
- Domain sketch ready → M1-MDES (design a new method)
- Method needs project instance → M4-MINS (instantiate it)
- Two methods composable → M5-MCOM (compose them)
- Informal practice → M2-MDIS (discover and formalize it)

This is the self-referential core: P0-META was designed using M1-MDES, and can be evolved using M3-MEVO. The method system maintains itself.

See [Guide 3](03-meta-methods.md) for the full P0 story.

## Next

[Guide 3](03-meta-methods.md) explains the meta-method family — how methods are designed, compiled, evolved, and composed.
