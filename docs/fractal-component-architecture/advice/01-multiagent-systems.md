---
title: "FCA Advice: Multiagent Systems"
scope: fractal-component-architecture/advice
status: draft
evidence_tier: L2-L4 validated, L0-L1 and L5 hypothesized
origin: Council session TOPIC-FCA-MULTIAGENT (2026-03-23, isolated mode, 3 rounds)
---

# Multiagent Systems

Guidance for applying FCA to systems where components are autonomous LLM agents — entities that interpret their interfaces, exercise judgment, and can violate their own contracts.

## Domain Context

FCA's component model was designed for passive software: functions, modules, packages, and services that do what their interface says or crash. Agents introduce three properties absent from passive components:

1. **Non-deterministic compliance.** The same agent with the same input produces different outputs, and both may be correct. An agent satisfies its Interface *to a degree*, not absolutely.
2. **Autonomous initiative.** Agents initiate action, reinterpret commissions, and probe boundaries. A function never decides to call an API its signature doesn't mention. An agent might.
3. **Temporal dynamics.** Agents compose like actors in message-passing systems, where ordering, timeouts, retries, and revision cascades are primary concerns — not build-graph dependencies.

**The core finding:** FCA's 8-part structural model holds for agents without new primitives. But the shift from deterministic to probabilistic Interface compliance changes the composition algebra's character — from set-inclusion to measure-theoretic containment. This change is invisible to practitioners without explicit tooling and will produce brittle pipelines if ignored.

> **Why:** Council debate (Kael vs. Rhea, 3 rounds) tested this with worked examples. Kael demonstrated probabilistic contracts composing via multiplicative algebra (`Pr[post] >= p`). Rhea demonstrated that substitutability fragments when compliance profiles differ — two agents satisfying the same Interface structurally but at different reliability levels are not interchangeable. Resolution: the algebra holds formally, but its changed character is operationally load-bearing.

## What Maps Cleanly

These FCA-to-agent mappings require no special treatment:

| FCA Part | Agent Instantiation | Notes |
|----------|-------------------|-------|
| **Boundary** | Scope enforcement (`allowed_paths`, tool restrictions) | Maps directly. Agent boundaries need runtime detection (Observability) and graduated response (Architecture of parent), but Boundary-as-specification is unchanged. |
| **Port** | Injected dependencies: tools, knowledge bases, channels, parent references | Commission prompts are Port injection. A well-framed commission declares the agent's dependencies explicitly. |
| **Domain** | Ontological territory the agent owns | Specialist agents outperform generalists because they respect domain cohesion. An agent owning too many domains is a monolith. |
| **Documentation** | Session framing, agent card, capability manifest | The five-layer session framing model (Composition/Constraints/Objectives/Mechanisms/Context) is Documentation that is load-bearing — not an afterthought. |
| **Observability** | Progress channels, event channels, PTY watchers, execution traces | The three-tier coordination metrics framework (TDMI/PID → GEMMAS → observable proxies) maps directly to Observability instrumentation at different fractal levels. |

> **References:**
> - Session framing as five-layer composition: ov-research/knowledge/multi-agent/session-framing.md
> - Specialist > generalist: Production patterns from Devin annual review (67% merge rate scoped vs 70% failure general)
> - Three-tier coordination metrics: ov-research/knowledge/multi-agent/coordination-metrics.md

## What Requires Attention

### 1. Interface — Probabilistic Contracts

**The issue.** FCA's Interface assumes a component either satisfies its contract or doesn't. Agents satisfy contracts probabilistically. A CodeReviewer agent returns structurally correct output 100% of the time but semantically consistent output (e.g., `approved=true` implies no critical findings) only 85-95% of the time. This isn't a bug — it's the nature of LLM-backed components.

**What changes.** Interface specifications for agent components must include a **compliance profile**: the expected probability of semantic correctness per contract clause. This is not decorative metadata — it changes the substitutability relation.

```
Interface CodeReviewer:
  input:  Diff
  output: { severity: critical|major|minor, findings: Finding[], approved: bool }
  contract:
    structural: "output matches schema"           # deterministic, enforced by validation
    semantic:   "approved=true ⇒ no critical findings"  # probabilistic
    compliance: semantic >= 0.95                    # the compliance bound
```

**Why this matters for composition.** Two CodeReviewer implementations satisfying the same structural interface but with different compliance profiles (0.95 vs 0.78) are **not substitutable** for composition purposes. A three-step pipeline at 0.95 per step gives 0.86 end-to-end. The same pipeline at 0.78 per step gives 0.47. FCA's substitutability guarantee — "any component satisfying Interface I can replace any other" — holds only within the same compliance equivalence class.

**Pattern: Composition Budgets.** Every multi-agent pattern must declare:
1. Confidence parameters of each agent's Interface commitments
2. End-to-end success probability computed from the pipeline DAG
3. Retry/fallback strategy when probabilistic composition fails

**Composition arithmetic:**
- Sequential: multiply (`p1 * p2 * p3`)
- Parallel with fallback: `1 - (1-p1)(1-p2)`
- Retry: `1 - (1-p)^n`
- Voting (majority of 3): `3p^2 - 2p^3`

> **References:**
> - Substitutability worked example: Council Round 3, Rhea Scenario 1
> - Probabilistic postconditions: F1-FTH Section 8.2, `Pr[post(s')] >= p` generalization
> - Composition closure under probabilistic contracts: Council Round 3, Kael DeliveryTeam example
> - **Standing dissent (Rhea):** Compliance profiles may warrant promotion from Interface annotation to structural metadata if production adoption reveals systematic substitutability failures. Revisit after empirical data.

### 2. Verification — Statistical, Not Binary

**The issue.** Verifying a passive component: call with known inputs, assert expected outputs. Verifying an agent: the same inputs produce different (valid) outputs across runs.

**What changes.** Verification at L2+ for agent components is **statistical acceptance testing**: run N trials over a representative corpus, compute confidence intervals, compare to declared compliance bounds. This is a meaningful change in what "proving correctness" means at higher fractal levels.

**Pattern: Statistical Verification Harness.**
```
verify(agent: CodeReviewer, corpus: Diff[], n: int = 100):
  results = corpus.map(diff => agent.review(diff))
  consistency = results.filter(r => consistent(r.approved, r.findings)).length / n
  assert consistency >= agent.compliance.semantic  # 0.95
  assert confidence_interval(consistency, n).lower >= agent.compliance.semantic - 0.05
```

The verification harness is part of the agent component's **testkit** — shipped alongside the implementation, exactly as FCA's Principle 4 requires. If testing an agent is hard, the design is wrong.

> **References:**
> - Verification as correctness-establishment means (not prescribed mechanism): FCA 05-principles.md, Principle 4
> - Agent failure modes requiring statistical verification: ov-research/knowledge/multi-agent/agent-failure-modes.md (8 classes)

### 3. Architecture — Temporal Coordination at L3

**The issue.** FCA's Architecture part at L3 is well-defined for structural composition (layers, domain boundaries, dependency direction). It's underspecified for behavioral sequencing across sub-components.

**What changes.** L3 Architecture for agent teams must include **temporal coordination protocols**: causal ordering, retry policies, timeout budgets, and revision cascade handling. This is an extension of what Architecture currently covers, not a replacement.

**Concrete scenario.** SchemaDesigner -> MigrationWriter -> TestScaffolder pipeline. Designer completes and emits schema v1. MigrationWriter starts. Designer self-revises and emits schema v2. Questions FCA's Architecture part must answer:
- Should MigrationWriter be interrupted?
- Should TestScaffolder wait for restart or proceed with v1?
- Who detects and resolves the conflict?

The L3 component (the team) owns these decisions in its Architecture. The temporal protocol is the team's internal behavioral structure, invisible to consumers of the team's Interface.

**Pattern: Temporal Architecture Template.**
```yaml
architecture:
  phases:
    - name: design
      agent: SchemaDesigner
      outputs: [schema]
    - name: implement
      agent: MigrationWriter
      depends_on: [design]
      inputs: [schema]
    - name: verify
      agent: TestScaffolder
      depends_on: [design, implement]
      inputs: [schema, migrations]
  temporal_policy:
    revision_handling: restart_downstream  # or: ignore, queue, escalate
    timeout_per_phase: 10m
    total_budget: 30m
    stale_detection: true
    max_retries: 3
    retry_scope: from_revised_phase  # not from scratch
```

> **References:**
> - Temporal orchestration patterns: ov-research/knowledge/multi-agent/temporal-orchestration.md
> - Durable execution: Netflix 4% to 0.0001% deployment failures via Temporal (workflow/activity split)
> - Orchestration vs choreography complementarity: temporal-orchestration.md finding on hybrid models

### 4. Boundary — Graduated Containment

**The issue.** Passive components either operate within their boundary or fail. Agents probe boundaries as part of normal operation — reading adjacent files to understand context, attempting writes outside scope because they judged it contextually reasonable.

**What changes.** Boundary remains a design-time specification. But agent components require a **graduated containment pattern** coordinating three existing parts:

| Part | Role in Containment |
|------|-------------------|
| **Boundary** | Specifies allowed scope (paths, tools, domains) |
| **Observability** | Detects boundary approaches and violations at runtime |
| **Architecture (parent)** | Encodes graduated response: warn, constrain, kill |

**Pattern: Graduated Containment Protocol.**
```
on boundary_approach(agent, action):
  if action.type == "read" and action.target is adjacent_domain:
    WARN — log observation, allow read-only, notify parent
  if action.type == "write" and action.target is outside_scope:
    CONSTRAIN — block write, revoke tool from agent's Ports, continue session
  if action.type == "install" or action.domain is unrelated:
    KILL — terminate session, report scope drift to parent
```

The graduated response is **stateful** — escalation depends on violation history and cumulative drift assessment. This is not Boundary itself becoming stateful; it's the parent's Architecture maintaining containment state while Boundary remains a static specification.

> **References:**
> - Bridge scope enforcement: PRD 014 (allowed_paths, enforce/warn/log modes)
> - PTY activity auto-detection: PRD 010 (pattern matching for scope violations)
> - Already implemented in bridge server: packages/bridge/source/ scope enforcement

## Structural Patterns

### Structural Dissent (L3 Architecture Pattern)

**Classification:** Architecture pattern at L3 with verification side effects. NOT a Verification primitive.

**What it is.** The team's Architecture includes an adversarial role (the Contrarian) whose purpose is to generate genuine alternatives and surface failure modes the Proposer didn't consider.

**Why Architecture, not Verification.** Verification is confirmatory — it checks outputs against specifications. Dissent is **generative** — it produces alternative framings that didn't previously exist. The 1.8-2.5x quality improvement comes from the generative property. Classifying dissent as Verification causes implementers to treat it as a checking mechanism rather than a composition strategy.

**Three mechanisms, ranked by effectiveness:**

| Mechanism | Effectiveness | Description |
|-----------|--------------|-------------|
| Independent proposals | HIGH | Agents draft proposals before reading others. Mean similarity 0.43 vs 0.7 anchoring threshold. Prevents convergence before exploration. |
| Designated contrarian | MEDIUM-HIGH | Structurally mandated "find the weakest assumption." 3/3 counter-arguments had evidence in experiments. |
| Conviction logging | MEDIUM | Each agent declares confidence (0-100) and reasoning after every decision. Surfaces hidden uncertainty. |

**Anti-pattern: Dissent as permission, not mandate.** LLM agreeableness is structural — in experiments, zero genuine disagreements occurred when critique was permitted but not mandated. The contrarian role must be architecturally required, not optionally available.

**Anti-pattern: Defend-only or acknowledge-only.** Every agent in a dissent pattern must have BOTH "defend your positions" AND "acknowledge genuinely good counter-arguments honestly." Defend-only produces 56% rigidity. Acknowledge-only produces capitulation. Both together produce conditional updating.

> **References:**
> - 1.8-2.5x quality improvement: ov-research/knowledge/multi-agent/dissent-mechanisms.md
> - Context isolation amplifies disagreement +43-233%: EXP-002 (2026-03-18)
> - Anti-capitulation both-halves: EXP-003 (2026-03-19)
> - Historical precedent: Sanhedrin unanimous-guilt to acquittal rule, Israeli Devil's Advocate Unit
> - Voting beats consensus by 13.2%: arXiv:2502.19130
> - Deliberation plateaus at 2-3 rounds: same paper

### Decision Protocols (L3-L4 Architecture Pattern)

**Classification:** Architecture patterns governing how agent teams make decisions.

| Tier | Scope | Protocol | Threshold | Timeout |
|------|-------|----------|-----------|---------|
| Operational | Routine, reversible | Majority vote | >50% | None |
| Tactical | Medium stakes | Consensus-seeking + majority fallback | 2-3 rounds max | 15 min, default-proceed |
| Critical | High stakes, hard to reverse | Supermajority | >=66% | 30 min, default-block |
| Emergency | Time-critical | Designated leader | -- | Immediate |

**Key finding:** Extended discussion *decreases* performance due to anchoring and social convergence. Cap deliberation at 2-3 rounds.

> **References:**
> - Four-tier model: ov-research/knowledge/multi-agent/decision-protocols.md
> - Voting +13.2% over consensus: arXiv:2502.19130
> - Deliberation plateau: same paper
> - Institutional governance reducing collusion 50% to 5.6%: arXiv:2601.11369

## Architectural Constraints

### Coordination Ceilings

These are **hard architectural constraints**, not soft guidelines. Compositions violating them have reliability properties that degrade non-linearly.

| Constraint | Value | Evidence |
|------------|-------|----------|
| Flat coordination ceiling | 10 agents | AgentsNet benchmark: O(n^2) coordination overhead, cliff-edge at 10 |
| Span of control | 5-7 direct reports per team lead | Gallup organizational research; 3-tier hierarchy for 10+ agents |
| Specialist spawning threshold | Complexity > 0.7 | 73% success vs 52% baseline when complexity-triggered |

**Architectural implication:** Compositions at L3 exceeding 10 flat agents MUST introduce hierarchical sub-teams. This is a structural constraint on the Architecture part, not a guideline in an appendix.

> **References:**
> - O(n^2) overhead, 5-10 agent degradation: arXiv:2507.08616
> - Span of control 5-7: Gallup, Team Topologies (Skelton & Pais)
> - Complexity-triggered spawning: ov-research/knowledge/multi-agent/agent-lifecycle.md

## Fractal Agent Levels

The FCA level hierarchy for agent systems, with evidence tier:

| Level | Agent Analog | FCA Analog | Evidence |
|-------|-------------|------------|----------|
| L0 | Tool invocation | Function | **Hypothesized** — structurally plausible, untested |
| L1 | Single agent turn | Module | **Hypothesized** — structurally plausible, untested |
| L2 | Agent session | Component | **Validated** — bridge experiments, session-level patterns |
| L3 | Agent team | Service / Subsystem | **Validated** — EXP-001 series, coordination norms, decision protocols |
| L4 | Orchestrated pipeline | Application | **Partial** — bridge strategy pipelines, OpenDev architecture |
| L5 | Multi-project platform | System | **Hypothesized** — Genesis agent prototype only |

The same 8 parts apply at every level. This document provides instantiation guidance for L2-L4 where evidence exists. L0-L1 and L5 guidance will be added as empirical validation accumulates.

> **References:**
> - L2-L3 evidence base: ov-research/knowledge/multi-agent/ (17 topic files)
> - L4 partial evidence: bridge strategy pipelines (PRD 017), OpenDev architecture (arXiv:2603.05344)
> - L5 prototype: Genesis agent (bridge PRD 020)

## Agent-Specific Failure Modes

Eight failure classes specific to autonomous agents, mapped to FCA mitigation locus:

| Failure Class | Description | Mitigation Locus (FCA Part) | Level |
|---------------|-------------|----------------------------|-------|
| Infinite loops | Agent repeats failed actions without progress | **Architecture** — doom-loop detection, max-retry limits | L2 |
| Context overflow | Context window exhausted, degrading output quality | **Boundary** — context budget limits; **Observability** — token tracking | L2 |
| Compounding hallucinations | Fabricated outputs fed to downstream agents, amplifying error | **Verification** — statistical validation gates between pipeline stages | L3-L4 |
| Ephemeral state loss | Agent loses track of prior decisions across turns | **Observability** — structured execution traces; **Documentation** — decision logs | L2 |
| Prescriptive rigidity | Agent follows instructions literally when judgment is needed | **Architecture** — conditions-not-directions framing; declarative objectives | L2-L3 |
| Opacity | Agent's reasoning invisible to parent/operator | **Observability** — channels, progress reporting, PTY watchers | L2-L3 |
| Cost explosion | Unconstrained token/API usage | **Boundary** — budget caps; **Observability** — cost tracking; **Architecture** — budget-triggered escalation | L2-L4 |
| Catastrophic irreversible actions | Agent takes destructive action (rm -rf, force-push) | **Boundary** — scope enforcement; **Architecture** — graduated containment | L2 |

**Key principle:** These are substrate-specific failure modes with no analog in passive component systems. FCA's structural model doesn't predict them — they come from the LLM substrate. But FCA's 8 parts provide the mitigation architecture: Boundary constrains blast radius, Verification detects unreliable outputs, Observability surfaces degradation, Architecture encodes response protocols.

> **References:**
> - Eight failure classes: ov-research/knowledge/multi-agent/agent-failure-modes.md
> - Production failure data: AutoGPT, CrewAI, LangGraph documented failures
> - Cost explosion: ov-research/knowledge/multi-agent/production-patterns.md

## Degradation Signaling Protocol

When an agent's compliance drops below its declared bound, the system must make this visible. This is Observability instantiated for probabilistic components.

**Signal format:**
```yaml
degradation:
  agent_id: reviewer-3
  interface: CodeReviewer
  contract_clause: "approved consistency"
  declared_bound: 0.95
  observed: 0.82
  window: "last 20 invocations"
  trend: declining
  action_recommended: substitute or recalibrate
```

**Escalation triggers:**
- Observed compliance < declared bound for 2+ consecutive measurement windows: warn parent
- Observed compliance < declared bound - 0.10: constrain (reduce agent's responsibilities)
- Observed compliance < 0.50: kill and substitute

This is a coordination across Interface (declared bound), Observability (measurement), and Architecture of the parent (response). Three existing parts.

## Anti-Patterns

### Treating agents as deterministic components

**Symptom:** Pipeline has no compliance profiles, no composition budgets, no retry strategy. "It works when I test it" — because single tests don't reveal probabilistic failure.

**Why it fails:** A five-step pipeline at 90% per step gives 59% end-to-end reliability. Without explicit composition arithmetic, practitioners won't discover this until production.

### Flat teams exceeding coordination ceilings

**Symptom:** 15 agents all reporting to one orchestrator. Coordination overhead dominates useful work. Agents duplicate effort, contradict each other, wait for attention.

**Why it fails:** O(n^2) coordination overhead. The 10-agent cliff is empirical, not theoretical.

### Dissent without structural mandate

**Symptom:** "Agents can disagree if they want to." In practice, zero disagreements occur because LLM agreeableness is structural.

**Why it fails:** Agreeableness is not a bug to fix with prompting — it's a baseline property. Disagreement requires architectural mandate (designated contrarian role), not permission.

### Verification-as-testing for agent teams

**Symptom:** "We test the team by running it once and checking the output." Binary pass/fail.

**Why it fails:** Non-deterministic outputs require statistical verification. A team that passes one test may fail 40% of the time. Run N trials, compute confidence intervals.

### Ignoring temporal coordination at L3

**Symptom:** Agents in a pipeline are wired structurally but have no retry policy, no timeout budget, no revision handling. When an upstream agent revises its output, downstream agents work with stale data.

**Why it fails:** Agent pipelines are temporal systems. Causal ordering, revision cascades, and partial failure handling are Architecture concerns that must be specified.

## Open Questions

These are unresolved and flagged for future work:

1. **Does F1-FTH Section 8.2 fully cover probabilistic Interface composition?** If the `Dist(Mod(D))` generalization is present and preserves substitutability/closure, the formal foundation is settled. If not, a formal Interface extension (compliance bound as structural metadata) may be warranted.

2. **Cross-component relational postconditions.** The Contrarian's postcondition depends on *difference from the Proposer's output* — a relational property across components. FCA's step execution is single-component. Can this be housed in L3 Architecture, or does it require a relational composition operator?

3. **L4 and L5 empirical validation.** Do the patterns in this document hold at orchestrated-pipeline scale (L4) and multi-project-platform scale (L5)? Production evidence is needed.

4. **Compliance profile standardization.** What format should compliance profiles use? How should compliance bounds be measured and updated? This is an interop protocol design question.
