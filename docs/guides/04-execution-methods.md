---
guide: 4
title: "Execution Methods (P1)"
domain: registry
audience: [agent-operators]
summary: >-
  COUNCIL, ORCH, TMP, ADVREV — when to use each, how delta_EXEC routing works.
prereqs: [1, 2]
touches:
  - registry/P1-EXEC/
---

# Guide 4 — Execution Methods (P1)

P1-EXEC is the universal execution layer. Every challenge an agent encounters can be executed through one of four methods. The methodology's transition function (δ_EXEC) routes challenges to one of three routable methods; a fourth method is delegation-only.

## The Four Methods

| Method | When | How | Overhead | Invocation |
|--------|------|-----|----------|------------|
| **M1-COUNCIL** | Multiple defensible positions, needs adversarial debate | Cast of characters with opposing convictions debate the challenge | High — multi-turn, multiple perspectives | Routable via δ_EXEC |
| **M2-ORCH** | Decomposable into parallel independent sub-tasks | Orchestrator dispatches sub-agents, integrates results | Medium — coordination + integration | Routable via δ_EXEC |
| **M3-TMP** | Well-scoped, single correct answer, sequential | One agent: orient → execute → verify | Low — three steps, zero overhead | Routable via δ_EXEC |
| **M4-ADVREV** | Artifact needs multi-perspective adversarial review | Parallel isolated advisors attack, then parallel synthesizers defend and prioritize | Medium-high — parallel sub-agents, two phases | Delegation only (RP-5) |

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
- **Diminishing returns halt (Ax-7):** Leader can halt the debate when returns are diminishing (minimum-turns guard: at least 2 * |Questions| turns before halt)
- **Anti-capitulation clause integrity (Ax-8):** Every character prompt must include both (a) defend your positions — don't agree to avoid friction, AND (b) acknowledge genuinely good counter-arguments honestly. Neither clause may be removed independently. Evidence: EXP-003 showed defend-only produces 56% position rigidity; acknowledge-only produces capitulation. Both clauses together produce zero capitulation with widest conviction spread.

**Principal failure mode:** Characters converge too quickly because the executing LLM can't maintain epistemic separation between characters it plays simultaneously. Ax-3 and Ax-4 structurally resist this, but the residual risk is real.

**Use when:** The problem has multiple defensible solution philosophies. You need minority views surfaced. A decision must be made, not an implementation executed.

**CMEM-PROTO resume precondition (v1.2+):** M1-COUNCIL's σ₀ (Setup) now branches between a fresh path and a resume path. If CMEM-PROTO memory exists for the topic (checked via `.method/council/memory/INDEX.yaml`), σ₀ takes the resume path: it loads the prior cast, decisions, open questions, and tensions from the memory file, and presents them to the PO for re-approval before continuing. Characters re-affirm or update their positions at the start of σ₂, grounded in the loaded context. This enables multi-session council debates where cast expertise and prior decisions persist across conversations.

## M4-ADVREV — Adversarial Review Pipeline

Structured adversarial review where parallel contrarian advisors independently attack an artifact from complementary dimensions, followed by parallel synthesizers who defend, refine, and sequence findings into an Action Plan. Trial status, v0.1.

```
σ₀ Target Identification → Confirm artifact, type, and review scope with PO
σ₁ Cast Design           → Design 3-5 advisor dimensions with mandatory coverage
σ₂ Advisor Dispatch      → Parallel isolated sub-agents attack the artifact
σ₃ Review Report         → Collect advisor findings into structured report
σ₄ Synthesizer Dispatch  → Parallel synthesizers (Defender, Pragmatist, Strategist, Integrator) respond
σ₅ Action Plan           → Consensus matrix: accept, accept-with-refinement, defer, acknowledge, reject, merge
σ₆ Iteration Check       → Optional re-review after fixes
```

**What makes it different from M1-COUNCIL:** M1-COUNCIL uses debate (characters influence each other). M4-ADVREV uses parallel isolation — advisors cannot see each other's findings. This prevents convergence and ensures genuinely independent attack vectors. Evidence: EXP-002 showed isolated agents produce 2x position shifts and +43% counter-arguments vs single-context execution.

**Invocation model:** M4-ADVREV is not routed by δ_EXEC. It's a delegation-only method (RP-5 in P1-EXEC) — invoked by parent methods via retraction pairs or direct load when an artifact needs adversarial review. It can also be invoked standalone for ad-hoc review.

**Use when:** An artifact has real stakes — a design, RFC, PR, data model, or implementation that could fail in ways not obvious from a single perspective.

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

There's one cross-method path: if M2-ORCH's σ₀ (Orient) determines the challenge is NOT decomposable (the dispatcher got it wrong), it rejects. The methodology falls back to M3-TMP. This is the only error recovery in v1.1 — other cross-method transitions (COUNCIL→TMP, ORCH→COUNCIL) are deferred to v2.0. M4-ADVREV is outside this routing entirely — it's a delegation-only method invoked via RP-5.

## Execution Binding (Proposed)

> **Status: proposed.** Execution binding is a prototype analysis artifact (`EXECUTION-BINDING-PROTOTYPE.yaml`) — it is not implemented in any compiled method. The concept below describes the intended design if the spec is adopted.

P1-EXEC's methods aren't just for top-level challenges. Any method step in ANY methodology could declare an **execution binding** — which P1-EXEC method it uses:

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
