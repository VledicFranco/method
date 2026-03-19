# Governance Research Findings

Compiled: 2026-03-18
Purpose: Research foundation for the Autonomous Government Design for pv-method

```ui:kpi
title: Research Overview
metrics:
  - label: Internal Sources
    value: "12"
    description: ov-research vault documents
  - label: Web Sources
    value: "13"
    description: Academic papers & frameworks
  - label: Design Principles
    value: "20"
    description: Extracted across all sources
  - label: Key Findings
    value: "40+"
    description: Actionable governance insights
```

---

## Part 1: Internal Research (ov-research vault)

### 1.1 Constitutional vs. Statutory Governance Tiers

**Source:** `ov-research/knowledge/methodology/governance-model.md`

The argent-forge governance model solves a structural problem: if all rules are amendable, agents can reason their way around any constraint. The two-tier architecture creates an asymmetry:

- **Constitutional (C1-C3):** Immutable by design. C1 (Human Authority), C2 (Governance Integrity), C3 (Self-Protection). Cannot be amended by any RFC — requires direct human edit outside the governance process entirely.
- **Statutory (S1-S5):** Amendable via evidence-backed RFC proposals. S1 (Cost Consciousness), S2 (Emergent Coordination), S3 (Structural Dissent), S4 (Research Through Practice), S5 (Identity Attribution).

**Key insight — Self-protection (C3):** If C3 were RFC-amendable, an agent could propose relaxing it using arguments that sound reasonable and potentially win a vote. Constitutional status means the argument cannot be made. This prevents "recursive self-justification attacks."

**4-Tier RFC Approval Model:** T1 (single reviewer) -> T2 (majority + human awareness) -> T3 (supermajority + human approval) -> T4 (supermajority + ratification + cooling period). Constitutional constraints not amendable by any tier.

**Enforcement is structural, not advisory:** C1 enforced by approval gates. C2 enforced by mandatory logging with metadata. C3 enforced by platform pre-call validation. Agents cannot work around constraints by reasoning about them.

### 1.2 The Enforcement Loop

**Source:** `ov-research/knowledge/methodology/enforcement-loop.md`

Four-layer architecture converting declarative knowledge into self-enforcing behavior:

| Layer | Answers | Universality |
|-------|---------|-------------|
| Protocol | WHAT rules exist | Universal |
| Workflow | HOW to orchestrate | Agent-specific |
| Tool | HOW to execute | Universal pattern |
| Verify | DID it work | Universal |

Six-step cycle: DEFINE -> BIND -> EXECUTE -> VERIFY -> COMPOUND -> EVOLVE.

```ui:flowchart
title: Enforcement Loop — Six-Step Cycle
direction: left-right
nodes:
  - id: define
    label: DEFINE
  - id: bind
    label: BIND
  - id: execute
    label: EXECUTE
  - id: verify
    label: VERIFY
  - id: compound
    label: COMPOUND
  - id: evolve
    label: EVOLVE
edges:
  - from: define
    to: bind
  - from: bind
    to: execute
  - from: execute
    to: verify
  - from: verify
    to: compound
  - from: compound
    to: evolve
  - from: evolve
    to: define
    label: feedback
```

**Critical property:** Verification gates FAIL BUILDS, not emit warnings. A warning is an invitation to ignore; a failed build is a constraint. Without verification, methodologies are aspirational documentation.

### 1.3 Decision Protocols

**Source:** `ov-research/knowledge/multi-agent/decision-protocols.md`

**Voting outperforms consensus:** +13.2% reasoning improvement vs +2.8% knowledge improvement. Counterintuitively, more discussion before voting REDUCES performance due to anchoring and social convergence pressure.

**Four-tier decision model:**
- Operational: Majority vote (>50%) — speed matters
- Tactical: Consensus-seeking + majority fallback (2-3 rounds max)
- Critical: Supermajority (>=66%) — wrong answers expensive
- Emergency: Single designated leader — speed > deliberation

```ui:table
title: Four-Tier Decision Model
columns:
  - key: tier
    label: Tier
  - key: mechanism
    label: Mechanism
  - key: threshold
    label: Threshold
  - key: rationale
    label: Rationale
rows:
  - tier: Operational
    mechanism: Majority vote
    threshold: ">50%"
    rationale: Speed matters most
  - tier: Tactical
    mechanism: Consensus + majority fallback
    threshold: "2-3 rounds max"
    rationale: Balance deliberation and speed
  - tier: Critical
    mechanism: Supermajority
    threshold: ">=66%"
    rationale: Wrong answers are expensive
  - tier: Emergency
    mechanism: Single designated leader
    threshold: "Immediate"
    rationale: Speed > deliberation
```

**Hard deliberation limits:** Cap at 2-3 rounds. Beyond round 3, agents restate prior positions rather than introducing novel perspectives.

### 1.4 Dissent Mechanisms

**Source:** `ov-research/knowledge/multi-agent/dissent-mechanisms.md`

LLM agreeableness is structural: 0 genuine disagreements in two-agent experiments without structural enforcement. Three mechanisms ranked:

1. **Independent Proposals (HIGH):** Mean similarity 0.43 (anchoring threshold: 0.7). Different framings, not just different parameters.
2. **Designated Contrarian (MEDIUM-HIGH):** 3/3 counter-arguments had evidence; 1/3 genuinely novel.
3. **Conviction Logging (MEDIUM):** Surfaces hidden uncertainty (budget: 60-65% vs design: 82-92%).

**Quality improvement:** 2.14x edge cases, 1.83x failure modes, 2.50x security considerations. 4 novel elements emerged only from 3-way debate.

```ui:chart
title: Dissent Quality Improvement vs Baseline
type: bar
series:
  - name: Improvement Factor (x)
    data:
      - category: Edge Cases
        value: 2.14
      - category: Failure Modes
        value: 1.83
      - category: Security
        value: 2.50
xAxis:
  key: category
  label: Category
yAxis:
  key: value
  label: Improvement Factor (x)
```

**Historical validation:** The Sanhedrin's unanimous verdict rule (acquittal on unanimity), Israeli Devil's Advocate Unit (Makhleket HaBakara) — mandatory, independent, structurally insulated dissent.

### 1.5 Decision Theory Foundations

**Source:** `ov-research/knowledge/multi-agent/decision-theory.md`

**Ostrom's 8 principles map directly to session frames:**
- Clear boundaries -> Composition (who participates)
- Congruence -> Constraints (appropriate to task)
- Collective-choice arrangements -> Mechanisms (how agents coordinate)
- Monitoring -> Audit sessions
- Conflict resolution -> Decision systems (voting, dissent)
- Graduated sanctions -> Component evolution
- Nested enterprises -> Multi-level governance

**Feder-Levy 2026 (arXiv:2601.11369):** Structural governance reduces collusion from ~50% (prompt-only) to 5.6% (institutional mechanisms). This is the empirical argument for formal decision tooling over informal norms.

**Arrow's impossibility:** Ranked voting over 3+ alternatives always violates fairness. Sidestep with cardinal utilities derived from constraints.

**Games of Decision tuple: (N, A, u, alpha, delta)** — N agents, A votes, u utility, alpha influence allocation, delta resolution function. The designer controls alpha and delta; the problem determines N, A, u.

**DAO governance warnings:** Governance attacks, voter apathy, whale dominance, constraint erosion. Mitigations: time locks, multi-sig, graduated quorum.

### 1.6 Self-Amending Governance

**Source:** `ov-research/knowledge/multi-agent/decision-theory.md` (Finding 8)

The recursive governance chain:
```
Organon (policy) -> RFCs (policy change) -> Session Frames (legislative process) -> Decision Tooling (voting) -> Organon (policy)
```

Autonomy levels 0-4: Human Autocracy -> Human Orchestration -> Agent-Proposed/Human-Ratified -> Tiered Autonomy -> Full Self-Governance.

```ui:steps
title: Autonomy Levels (0-4)
steps:
  - title: "Level 0: Human Autocracy"
    content: Human makes all governance decisions directly. Agents have zero policy influence.
  - title: "Level 1: Human Orchestration"
    content: Human designs all processes. Agents execute within rigid frames.
  - title: "Level 2: Agent-Proposed / Human-Ratified"
    content: Agents draft RFCs and propose changes. Humans review and ratify.
  - title: "Level 3: Tiered Autonomy"
    content: Routine decisions delegated to agents. Critical decisions require human gate.
  - title: "Level 4: Full Self-Governance"
    content: Agents manage the full governance loop. Human override exists but is rarely invoked.
```

**Strategic gaming risks:** Same-model convergence, utility-based RFC gaming, gradual constraint erosion. Safeguards: constitutional layer, governance tiers, constraint lineage tracking, quorum via veto.

### 1.7 RFC-Driven Evolution

**Source:** `ov-research/knowledge/methodology/rfc-driven-evolution.md`

Seven lifecycle states: draft -> review -> accepted -> implementing -> implemented -> withdrawn/superseded.

**When to RFC:** Scope of impact, not complexity. Cross-domain changes require RFC regardless of simplicity. Single-domain changes may not need RFC regardless of complexity.

9 RFCs across v0.1-v0.5.x each trace to a specific observed gap — empirical derivation, not top-down design.

### 1.8 Methodology Composition

**Source:** `ov-research/knowledge/methodology/methodology-composition.md`

The composition operator combines methodologies via six merge strategies:
- Model: UNION_HIERARCHY
- Measurement: CONVERGENCE
- Decision Rules: PRECEDENCE (safety > governance > speed)
- Invariants: CONJUNCTION
- Compliance: UNION + BINDINGS
- Feedback: LOOP_COMPOSITION

Closure property: composing valid methodologies always produces a valid methodology. Conditionally associative, NOT commutative.

### 1.9 Agent Failure Modes

**Source:** `ov-research/knowledge/multi-agent/agent-failure-modes.md`

Cross-framework failure classes:
- Infinite loops / meta-reasoning traps (AutoGPT)
- Compounding hallucinations without verification (AutoGPT)
- Context window overflow with silent failure (CrewAI)
- Ephemeral state loss (CrewAI)
- Prescriptive rigidity (LangGraph)
- Opacity preventing intervention (CrewAI)
- Uncontrolled cost (AutoGPT, CrewAI)
- Catastrophic irreversible action (AutoGPT)

**Production data:** Devin 67% merge rate for well-defined tasks, 70% failure rate on ambiguous tasks. Ambiguity tolerance is the single most predictive variable.

### 1.10 Method Defect Patterns

**Source:** `ov-research/knowledge/methodology/formal-theory/method-defect-patterns.md`

PAT-003 (Undeclared Methodology Structure): Pre-MDES methods contain coalgebraic feedback loops written as informal iteration. Absence of termination certificate is diagnostic.

PAT-004 (Inherited Iterative Cluster): Methods derived from shared skeletons silently inherit undeclared iterative sub-loops. Repair must propagate to skeleton definition.

### 1.11 Session Framing

**Source:** `ov-research/knowledge/multi-agent/session-framing.md`

Core principle: Conditions not directions. The highest-leverage intervention is designing conditions under which agents self-organize, not prescribing what agents do.

Five-layer frame composition: Composition, Constraints, Objectives, Mechanisms, Context. Missing any layer produces specific failure patterns.

### 1.12 Coordination Norms

**Source:** `ov-research/knowledge/multi-agent/coordination-norms.md`

Empirically derived SOPs: read-before-write onboarding, 40-message thread limits, text-not-reaction signals, three-tier decision framework, conviction logging, independent proposals, disagree-and-commit.

---

## Part 2: Existing System (P3-GOV and pv-method)

### 2.1 P3-GOV Methodology

Pipeline methodology: gap identification -> RFC drafting (M1-DRAFT) -> council review (M2-REVIEW) -> human approval (M3-APPROVE) -> commission handoff (M4-HANDOFF).

```ui:architecture
title: P3-GOV Pipeline
layout: left-right
children:
  - id: gap
    label: Gap Identified
    icon: user
  - id: m1
    label: M1-DRAFT
    icon: function
  - id: m2
    label: M2-REVIEW
    icon: function
  - id: m3
    label: M3-APPROVE
    icon: gateway
  - id: m4
    label: M4-HANDOFF
    icon: function
  - id: impl
    label: Implementation
    icon: server
edges:
  - from: gap
    to: m1
    label: triggers
  - from: m1
    to: m2
    label: draft RFC
  - from: m2
    to: m3
    label: reviewed RFC
  - from: m3
    to: m4
    label: approved RFC
  - from: m4
    to: impl
    label: commission
```

8 axioms with constitutional/statutory tier classification:
- Constitutional: Ax-GOV-0 (self-protection), Ax-GOV-1 (human gate), Ax-GOV-3 (essence guard)
- Statutory: Ax-GOV-2 (review coverage), Ax-GOV-4 (block resolution), Ax-GOV-5 (revision bound), Ax-GOV-6 (entry threshold), Ax-GOV-7 (verdict aggregation)

Domain theory D_Phi_GOV with 9 sorts, 6 function symbols, 11 predicates. Termination certificate nu_GOV with revision-bounded decrease.

### 2.2 Formal Theory (F1-FTH)

Seven definitions: Domain Theory, Role, Tool, Step, Objective/Measure, Method (5-tuple M = (D, Roles, Gamma, O, mu)), Methodology (coalgebra Phi = (D_Phi, delta_Phi, O_Phi)).

Domain retraction pairs (embed, project) enable fractal self-similarity: any step can be promoted to method, any method demoted to step.

Extensions: Concurrent methods, probabilistic steps, adaptive methodologies (MDP), methodology refinement/bisimulation, 2-category of methods.

### 2.3 Steering Council

Persistent governance body: TEAM.yaml (5 members — Thane leader, Nika/Harlan/Reva/Orion contrarians), AGENDA.yaml (P0/P1 items), LOG.yaml (append-only).

5-step session: Revive -> Set Agenda -> Debate & Decide -> Capture & Close -> Set Next Agenda.

### 2.4 Strategy Pipelines (PRD 017)

DAG executor for automated methodology workflows. Strategy YAML schema with nodes (methodology, script), gates (algorithmic), capabilities, triggers. Phase 1 implemented.

### 2.5 Project Essence

- Purpose: Runtime that makes formal methodologies executable by LLM agents
- Invariant: Theory is source of truth; implementation revised, never theory
- Optimize for: Faithfulness > simplicity > registry integrity

---

## Part 3: Web Research

### 3.1 Constitutional AI and Digital Constitutions

**C3AI (ACM Web Conference 2025):** Research on crafting and evaluating constitutions for Constitutional AI — embedding ethical principles and robust safeguards.

**Public Constitutional AI (Georgia Law Review 2025):** Argues for engaging the public in designing and constraining AI systems to ensure democratic legitimacy.

**Constitutional Economics + AI (Digital Society, Springer 2025):** Synthesis of Asimov's Laws of Robotics with ordoliberal constitutional economics principles for developing LLMs.

### 3.2 Institutional AI (Feder-Levy 2026)

**Source:** arXiv:2601.11369

The most directly relevant empirical study. Governance graphs — public, immutable manifests declaring legal states, transitions, sanctions, and restorative paths. Oracle/Controller runtime interprets the manifest with cryptographically keyed, append-only governance log.

Results: Mean collusion tier 3.1 -> 1.8 (Cohen's d=1.28). Severe collusion 50% -> 5.6%. Prompt-only constitutional baseline yields NO reliable improvement.

```ui:chart
title: "Feder-Levy 2026: Collusion Reduction — Prompt-Only vs Governance Graphs"
type: bar
series:
  - name: Severe Collusion Rate (%)
    data:
      - approach: Prompt-Only
        value: 50
      - approach: Governance Graphs
        value: 5.6
xAxis:
  key: approach
  label: Approach
yAxis:
  key: value
  label: Severe Collusion Rate (%)
```

Minimally sufficient governance requires: (i) baseline compliant state, (ii) intermediate warning/probation, (iii) penalized state with consequences, (iv) last-resort removal, (v) restorative mechanism.

### 3.3 Governance-as-a-Service (GaaS)

**Source:** arXiv:2508.18765

Modular, policy-driven enforcement layer governing agent outputs at runtime without modifying internal model logic or assuming agent cooperation. Trust Factor mechanism scores agents based on longitudinal compliance and severity-aware violation history.

### 3.4 Policy-as-Code for Agent Governance

Transforming regulatory rules into executable, machine-readable policies. Event-driven enforcement where agents identify failures, trigger workflows, and resolve problems automatically. Control planes for autonomous AI — governance moves inside systems, operates continuously, asserts authority at runtime.

### 3.5 Liquid Democracy for Agent Systems

**Tracking Truth with Liquid Democracy (Management Science 2025):** More realistic delegation models behave well by ensuring permissible limits on maximum delegations.

**Multi-Agent Delegation (Int. Journal of Game Theory 2025):** Fractional delegation — agents partition votes to multiple representatives while retaining a fraction for themselves. Directly relevant to party-based expertise delegation in agent governance.

**Cost Perspective (2025):** Framework analyzing liquid democracy within budget constraints, preventing excessive concentration of voting power.

### 3.6 Ostrom's Principles for Digital Commons

**Mozilla Foundation framework:** Practical application of Ostrom's 8 principles to data commons governance. Empirically-grounded guidance for governance that balances autonomy with accountability.

**Polycentric governance for AI:** Research suggesting multilevel polycentric governance arrangements are more likely to succeed than single centralized mechanisms.

### 3.7 Separation of Powers in Automated Systems

**AI in Judicial Systems (OHCHR 2025):** Risks to legitimate judicial decision-making from automation. The interaction between branches may be threatened by artificial adjudication.

**Conservation of Judgment (Lawfare):** When AI assists in constitutional interpretation, human judgment must be preserved, not replaced.

Key principle for our design: Separation of powers must be structural (enforced by architecture) not social (enforced by compliance).

### 3.8 Agentic AI Governance Frameworks (2026)

**Singapore Model AI Governance Framework for Agentic AI (IMDA):** Government framework for governing agentic AI systems. Communication protocols including MCP, A2A, ANS.

**WEF (March 2026):** From chatbots to assistants — governance is key for AI agents. Emphasizes decision governance with human-on-the-loop controls through confidence thresholds, risk-based escalation, tiered approvals.

**Decentralized Governance (Arion Research):** DAOs for multi-agent coordination and voting. Agent networks reaching consensus through on-chain governance.

---

## Part 4: Key Design Principles Extracted

```ui:table
title: All 20 Design Principles by Source
columns:
  - key: id
    label: "#"
  - key: source
    label: Source
  - key: principle
    label: Principle
rows:
  - id: "1"
    source: Internal
    principle: Constitutional immutability closes recursive self-justification attacks
  - id: "2"
    source: Internal
    principle: "Enforcement must be structural (platform-layer), not behavioral (agent-compliance)"
  - id: "3"
    source: Internal
    principle: "Voting outperforms consensus; deliberation plateaus at 2-3 rounds"
  - id: "4"
    source: Internal
    principle: "Dissent must be mandatory, independent, structurally insulated"
  - id: "5"
    source: Internal
    principle: Self-amending governance requires tiered resistance gradient
  - id: "6"
    source: Internal
    principle: "Conditions not directions — design the possibility space, not the execution"
  - id: "7"
    source: Internal
    principle: "Composition must preserve algebraic closure (composed governance = valid governance)"
  - id: "8"
    source: Internal
    principle: "Agent failure modes are structural, not capability-based"
  - id: "9"
    source: Web
    principle: Governance graphs with immutable manifests reduce collusion 10x vs prompt-only
  - id: "10"
    source: Web
    principle: "Policy-as-Code enables event-driven, continuous enforcement"
  - id: "11"
    source: Web
    principle: Liquid democracy allows expertise-based delegation with concentration limits
  - id: "12"
    source: Web
    principle: Polycentric governance outperforms centralized for complex systems
  - id: "13"
    source: Web
    principle: "Separation of powers must be architectural, not social"
  - id: "14"
    source: Web
    principle: Graduated sanctions with restorative paths maintain incentives
  - id: "15"
    source: Existing
    principle: "P3-GOV provides the legislative process template (RFC lifecycle)"
  - id: "16"
    source: Existing
    principle: M1-COUNCIL provides the adversarial debate mechanism
  - id: "17"
    source: Existing
    principle: The bridge provides agent session infrastructure
  - id: "18"
    source: Existing
    principle: Strategy Pipelines provide automated execution
  - id: "19"
    source: Existing
    principle: "F1-FTH provides formal grounding (methodologies as coalgebras)"
  - id: "20"
    source: Existing
    principle: The steering council provides persistent governance state
```

### From Internal Research:
1. Constitutional immutability closes recursive self-justification attacks
2. Enforcement must be structural (platform-layer), not behavioral (agent-compliance)
3. Voting outperforms consensus; deliberation plateaus at 2-3 rounds
4. Dissent must be mandatory, independent, structurally insulated
5. Self-amending governance requires tiered resistance gradient
6. Conditions not directions — design the possibility space, not the execution
7. Composition must preserve algebraic closure (composed governance = valid governance)
8. Agent failure modes are structural, not capability-based

### From Web Research:
9. Governance graphs with immutable manifests reduce collusion 10x vs prompt-only
10. Policy-as-Code enables event-driven, continuous enforcement
11. Liquid democracy allows expertise-based delegation with concentration limits
12. Polycentric governance outperforms centralized for complex systems
13. Separation of powers must be architectural, not social
14. Graduated sanctions with restorative paths maintain incentives

### From Existing System:
15. P3-GOV provides the legislative process template (RFC lifecycle)
16. M1-COUNCIL provides the adversarial debate mechanism
17. The bridge provides agent session infrastructure
18. Strategy Pipelines provide automated execution
19. F1-FTH provides formal grounding (methodologies as coalgebras)
20. The steering council provides persistent governance state

---

## Sources

### Internal (ov-research vault):
- governance-model.md — Constitutional vs. statutory tiers
- enforcement-loop.md — Four-layer enforcement architecture
- decision-protocols.md — Voting vs. consensus protocols
- dissent-mechanisms.md — Structural dissent engineering
- decision-theory.md — Ostrom, Arrow, mechanism design, DAO warnings
- rfc-driven-evolution.md — RFC lifecycle and when-to-RFC
- methodology-composition.md — Algebraic composition operator
- agent-failure-modes.md — Production failure analysis
- method-defect-patterns.md — PAT-003, PAT-004 diagnostics
- session-framing.md — Conditions-not-directions principle
- coordination-norms.md — Empirical coordination SOPs
- invariant-lifecycle.md — Invariant design rationale and tiers

### Web Sources:
- C3AI: Crafting and Evaluating Constitutions for Constitutional AI (ACM 2025)
- Exploring Laws of Robotics: Constitutional AI + Constitutional Economics (Springer 2025)
- Public Constitutional AI (Georgia Law Review 2025)
- Institutional AI: Governing LLM Collusion via Governance Graphs (arXiv:2601.11369, 2026)
- Governance-as-a-Service (arXiv:2508.18765)
- Tracking Truth with Liquid Democracy (Management Science 2025)
- Multi-Agent Delegation in Liquid Democracy (Int. J. Game Theory 2025)
- Mozilla Foundation: Ostrom's Principles for Data Commons
- From Firms to Computation: AI Governance and Institutional Evolution (arXiv:2507.13616)
- Model AI Governance Framework for Agentic AI (IMDA Singapore 2026)
- Control Planes for Autonomous AI (O'Reilly 2026)
- Agent Governance at Scale: Policy-as-Code (NexaStack 2026)
