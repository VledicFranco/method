# Guide 4 — Execution Methods (P1)

P1-EXEC is the universal execution layer. Every challenge an agent encounters can be executed through one of three methods. The methodology's job is to pick the right one.

## The Three Methods

| Method | When | How | Overhead |
|--------|------|-----|----------|
| **M1-COUNCIL** | Multiple defensible positions, needs adversarial debate | Cast of characters with opposing convictions debate the challenge | High — multi-turn, multiple perspectives |
| **M2-ORCH** | Decomposable into parallel independent sub-tasks | Orchestrator dispatches sub-agents, integrates results | Medium — coordination + integration |
| **M3-TMP** | Well-scoped, single correct answer, sequential | One agent: orient → execute → verify | Low — three steps, zero overhead |

## M3-TMP — Traditional Meta-Prompting

The default. Zero overhead. Three steps:

```
σ₀ Orient   → Decompose challenge into sub-questions
σ₁ Execute  → Address each sub-question sequentially
σ₂ Verify   → Confirm completeness and consistency
```

**What it adds over raw prompting:** Two things only — the explicit decomposition commitment (σ₀) and the explicit verification step (σ₂). Without σ₀, the agent can retroactively adjust scope. Without σ₂, dropped sub-questions and contradictions go undetected.

**Principal failure mode:** Apparently well-scoped but actually exploratory challenge. The agent produces a complete, consistent response to the wrong question. σ₂ can't catch this because verification checks against the σ₀ decomposition, which may itself be wrong.

**Use when:** The answer is known territory. One expert's perspective is sufficient. Time-constrained.

## M2-ORCH — Orchestrator

Parallel execution with single-pass integration. Five steps:

```
σ₀ Orient      → Is this decomposable? (hard gate — redirects if not)
σ₁ Decompose   → Produce sub-task set with declared scopes
σ₂ Dispatch    → Parallel sub-agents, each with scoped context
σ₃ Integrate   → Assemble all results into coherent whole
σ₄ Verify      → Check completeness and consistency
```

**Key constraint:** Single-pass. Each sub-task is dispatched once. Verification failure is terminal — the caller decides what to do. No re-dispatch loop (that's M2-DIMPL in P2-SD).

**Principal failure mode:** Sub-agent returns garbage or errors. The method handles this through the integration step — errors are flagged, not silently dropped. But the integration may be degraded.

**Use when:** 3+ independent sub-tasks with non-overlapping scopes. Integration cost is low relative to execution cost.

## M1-COUNCIL — Synthetic Agents

Structured adversarial debate. Four steps:

```
σ₀ Setup           → Confirm challenge with PO
σ₁ Cast Design     → Construct characters with opposing convictions
σ₂ Debate & Resolve → Multi-turn debate until all questions resolved
σ₃ Output          → Consolidate decisions, rationale, minority positions
```

**How it works:** The LLM plays multiple characters simultaneously — a Leader (neutral mediator) and k≥2 Contrarians (opposing-philosophy experts). The human plays Product Owner (final decision authority). Characters hold positions, respond to counter-arguments, and update positions only when a genuine counter-argument is acknowledged (Ax-4).

**What makes it different from "just asking for multiple perspectives":** The characters have **named convictions** (the sentence they defend under pressure) and **named blind spots** (what they systematically underweight). This structural commitment produces genuinely different reasoning paths, not hedged consensus. Evidence: EXP-001c showed 1.8-2.5x quality improvement on design decisions vs neutral collaborative pattern.

**Key axioms:**
- **Cast plurality (Ax-1):** At least 2 contrarians — otherwise it's a monologue with a moderator
- **Position non-repetition (Ax-3):** No restating positions without responding to a counter-argument
- **Conviction stability (Ax-4):** No position updates without acknowledging a counter-argument
- **Diminishing returns halt (Ax-7):** Leader can halt the debate when returns are diminishing

**Principal failure mode:** Characters converge too quickly because the executing LLM can't maintain epistemic separation between characters it plays simultaneously. Ax-3 and Ax-4 structurally resist this, but the residual risk is real.

**Use when:** The problem has multiple defensible solution philosophies. You need minority views surfaced. A decision must be made, not an implementation executed.

## How δ_EXEC Routes

The transition function evaluates two driving predicates:

```
Is adversarial pressure beneficial?
  YES → M1-COUNCIL
  NO  → Is it decomposable before execution?
          YES → M2-ORCH
          NO  → M3-TMP
```

"Adversarial pressure beneficial" is a disjunction of four sub-predicates:
1. **Problem framing uncertain** — the correct framing is contested
2. **Multiple defensible positions** — experts would disagree on the answer
3. **Stakes-driven preconditions** — high stakes + understated precondition space
4. **Silent assumption detection** — the framing depends on something unstated

If ANY of these is true, route to COUNCIL. If none is true but the challenge decomposes into 3+ parallel independent sub-tasks, route to ORCH. Otherwise, route to TMP.

### The ORCH→TMP Fallback

There's one cross-method path: if M2-ORCH's σ₀ (Orient) determines the challenge is NOT decomposable (the dispatcher got it wrong), it rejects. The methodology falls back to M3-TMP. This is the only error recovery in v1.1 — other cross-method transitions (COUNCIL→TMP, ORCH→COUNCIL) are deferred to v2.0.

## Execution Binding

P1-EXEC's methods aren't just for top-level challenges. Any method step in ANY methodology can declare an **execution binding** — which P1-EXEC method it uses:

```yaml
- id: sigma_1
  name: "Domain Theory Crystallization"
  execution_binding:
    default: M3-TMP
    override_permitted: true
    rationale: "Override to M1-COUNCIL when the domain has contested ontologies"
```

The default is the designer's recommendation. At runtime, the executor can override by evaluating δ_EXEC on the step's sub-challenge. This makes P1-EXEC the **execution substrate** beneath all methodologies.

**Rule of thumb:**
- Step produces a **decision** with alternatives → `override_permitted: true`
- Step **evaluates** a condition or checks a property → `override_permitted: false`

## Routing Feedback

P1-EXEC v1.1 includes a routing feedback mechanism: after the selected method completes, the PO is asked "Would you have chosen the same method?" This signal (μ₃ = routing_accuracy) calibrates δ_EXEC over time. If COUNCIL is consistently over-selected, the adversarial_pressure_beneficial disjunction threshold may need tightening.

## Next

[Guide 5](05-software-delivery.md) shows P2-SD — the full delivery loop from PRD to audit, using all 7 methods with a worked example.
