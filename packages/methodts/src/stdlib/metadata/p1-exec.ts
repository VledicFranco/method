import type {
  MethodologyMetadata,
  MethodMetadata,
} from "../metadata-types.js";

export const P1_EXEC_META: MethodologyMetadata = {
  id: "P1-EXEC",
  name: "Execution Methodology",
  description: `Methodology that receives a user challenge and selects the appropriate execution method \u2014 M1-COUNCIL, M2-ORCH, M3-TMP, or M4-ADVREV \u2014 then runs that method to completion and returns the result. Externalizes method-selection logic into a defined transition function delta_EXEC rather than leaving selection implicit or ad-hoc.`,
  version: "1.1",
  status: "compiled",
  compilation_date: "2026-03-14",
  navigation: {
    what: `P1-EXEC receives a user challenge and routes it to the appropriate execution method. It does not execute the challenge directly \u2014 it evaluates driving predicates, selects M1-COUNCIL, M2-ORCH, or M3-TMP via delta_EXEC, runs the selected method, and returns the result. Output satisfies O_Phi_EXEC when the selected method completes and its result addresses the challenge.`,
    who: `Two roles: rho_executor (the agent invoking Phi_EXEC \u2014 evaluates predicates, applies delta_EXEC, dispatches the selected method) and rho_PO (the human \u2014 provides the challenge, receives the result).`,
    why: `Wrong method selection degrades quality or wastes overhead. M1-COUNCIL on a well-scoped single-answer task adds multi-turn debate with no benefit. M3-TMP on a problem with genuine value pluralism misses structurally different perspectives. M2-ORCH on a non-decomposable challenge produces a FAIL at sigma_0. Externalizing selection into delta_EXEC makes the routing decision explicit, auditable, and improvable.`,
    how: `Evaluate two driving predicates on the challenge: adversarial_pressure_beneficial (should we debate?) and decomposable_before_execution (can we parallelize?). Apply delta_EXEC: if adversarial -> M1-COUNCIL; else if decomposable -> M2-ORCH; else -> M3-TMP. Run the selected method. If M2-ORCH rejects at sigma_0 (not decomposable), fallback to M3-TMP. Return result.`,
    when_to_invoke: [
      "A new challenge arrives and execution structure is not obvious",
      "The executor is unsure whether to debate, orchestrate, or reason sequentially",
    ],
    when_not_to_invoke: [
      "The task is running a specific method already identified \u2014 invoke directly",
      "A method is already in progress \u2014 complete it before re-evaluating",
    ],
  },
  compilation_record: {
    gates: [
      {
        gate: "G0",
        result: "PASS",
        note: `Navigation complete. What: methodology routing challenges to COUNCIL/ORCH/TMP. Who: rho_executor + rho_PO. Why: wrong method selection degrades quality or wastes overhead. How: evaluate driving predicates -> apply delta_EXEC -> run selected method. When: every non-trivial challenge where execution structure is not obvious.`,
      },
      {
        gate: "G1",
        result: "PASS",
        note: `D_Phi_EXEC = (Sigma_Phi_EXEC, Ax_Phi_EXEC). 5 sorts with cardinality, 4 function symbols with totality, 16 predicates with typed signatures (all referencing declared sorts, including routing_would_repeat for feedback), 3 defined predicates with explicit definitions, 3 closed axioms. Domain boundary stated. Initial and terminal state membership in Mod(D_Phi_EXEC) claimed with axiom-by-axiom verification.`,
      },
      {
        gate: "G2",
        result: "PASS",
        note: `O_Phi_EXEC stated as conjunction of three Sigma-predicates. Expressibility claim present. addresses operationalization documented (PO judgment). Progress preorder declared as 4-state total chain. Three measures: mu_1 (method completion), mu_2 (result existence), mu_3 (routing accuracy \u2014 PO feedback). Routing feedback section with schema and calibration note.`,
      },
      {
        gate: "G3",
        result: "PASS",
        note: `Two roles: rho_executor (identity projection, full delta_EXEC authority) and rho_PO (restricted projection, challenge provision authority). Coverage claim: union covers all of D_Phi_EXEC. Authority claim: union covers all transitions to O_Phi_EXEC. Role partition rationale: one automation boundary, minimal.`,
      },
      {
        gate: "G4",
        result: "PASS",
        note: `delta_EXEC declared as priority stack with 5 arms + 1 fallback. Totality: Ax-1 guarantees every challenge maps to exactly one method. Termination certificate nu <= 2 with strict decrease witness. Four retraction pairs formally declared and verified (project o embed = id on touched subspace). Inter-method coherence: Ax-2 bounds invocation count. Deferred pairs documented with rationale.`,
      },
      {
        gate: "G5",
        result: "PASS",
        note: `Five driving predicates operationalized with explicit True/False conditions, evaluation order, and boundary notes: PFU (problem framing uncertain), MDP (multiple defensible positions), C3 (stakes-driven precondition surfacing), C4 (silent assumption detection), decomposable_before_execution. Each predicate has concrete examples for True and False cases. Evaluation order specified: adversarial predicates first, then decomposability.`,
      },
      {
        gate: "G6",
        result: "PASS",
        note: `This file (P1-EXEC/P1-EXEC.yaml). Structurally complete.`,
      },
    ],
  },
  known_wip: [
    {
      id: "W1",
      status: "open",
      description: `Predicate operationalization is heuristic. Two independent executors may disagree on PFU or MDP evaluation for boundary-case challenges. Routing feedback (mu_3) provides calibration signal over time but no formal learning mechanism exists in v1.1.`,
    },
    {
      id: "W2",
      status: "open",
      description: `addresses(r, c) and routing_would_repeat(s) are PO judgment \u2014 not computable from state. Structural proxies could supplement but not replace PO evaluation.`,
    },
    {
      id: "W3",
      status: "open",
      description: `COUNCIL_to_TMP and ORCH_to_COUNCIL cross-method transitions deferred to v2.0. v1.1 handles only one cross-method path: ORCH -> TMP via fallback.`,
    },
    {
      id: "W4",
      status: "open",
      description: `Predicate evaluation bias toward COUNCIL: adversarial_pressure_beneficial is a disjunction of four sub-predicates, giving it wide catchment. Routing feedback data may reveal systematic over-routing to COUNCIL, suggesting the disjunction threshold should be raised (e.g., require 2-of-4 instead of 1-of-4).`,
    },
  ],
};

export const M1_COUNCIL_META: MethodMetadata = {
  id: "M1-COUNCIL",
  parent: "P1-EXEC",
  name: "Synthetic Agents Method",
  description: `Structured multi-character debate where a cast of synthetic expert agents argue a challenge and produce a decision or artifact, with the user as final authority. Forces genuine position-holding through character construction: each character has a named conviction and blind spot, and must defend or update positions under structural pressure. Value over single-agent reasoning: method-attributable insight generation through adversarial structure.`,
  version: "1.3",
  status: "compiled",
  compilation_date: "2026-03-20",
  evolution_note: `v1.3: RFC-003 (anti-capitulation invariant). Adds Ax-8 (anti-capitulation clause integrity) \u2014 both defend-position and acknowledge-counter clauses required in every character prompt. sigma_1 guidance updated with explicit anti-capitulation instructions. Approved by Steering Council SESSION-037 (D-087). Prior: v1.2 added RFC-001 (sigma_0 resume precondition for CMEM-PROTO) and RFC-002 (Ax-7 minimum-turns guard), approved SESSION-032 (D-067, D-068).`,
  formal_grounding: "theory/F1-FTH.md",
  navigation: {
    what: `M1-COUNCIL takes a challenge with multiple defensible positions, constructs a cast of synthetic expert characters with opposing philosophies, runs a structured debate, and produces an Artifact consolidating decisions with rationale and minority positions. Output satisfies O_COUNCIL: all Questions resolved, at least one Position updated, Artifact exists, adversarial integrity maintained.`,
    who: `Three role types: Leader (1, neutral mediator), Contrarian (k >= 2, opposing-philosophy experts), Product Owner (the human, final decision authority). In single-LLM execution, the model plays Leader and Contrarians; the human plays PO.`,
    why: `Many design, strategy, and architectural problems benefit from adversarial expert debate but no human team is available. A single LLM agent producing multiple perspectives risks the hedged consensus failure mode \u2014 everything weighed, nothing committed to. M1-COUNCIL forces genuine position-holding through character construction: each character has a named conviction and a named blind spot, producing structurally different perspectives that a single-agent method cannot generate. Evidence: EXP-001c showed 1.8-2.5x quality improvement on design decisions with 3-agent adversarial structure vs neutral collaborative pattern.`,
    how: `Four linear steps: setup (confirm challenge) -> cast design (construct and approve characters) -> debate & resolve (structured multi-turn debate with escalations and decisions until all questions resolved) -> output (consolidate into artifact).`,
    when_to_use: [
      "The problem has at least two defensible solution philosophies leading to different decisions",
      "The task benefits from surfacing risks, minority views, or unconsidered perspectives",
      "A decision must be made and the user wants structured input rather than a single recommendation",
      "The problem space is bounded enough for 3-6 expert characters to credibly cover",
      "Multi-turn interaction is affordable",
    ],
    when_not_to_use: [
      "Execution tasks where the answer is known \u2014 use M3-TMP or M2-ORCH",
      "Purely informational queries needing a fact or summary, not a decision",
      "Tasks requiring continuous external state (API calls, iterative builds)",
      "Problem space so narrow that contrarians cannot hold genuinely different positions",
      "User needs single-response speed \u2014 multi-turn debate is overhead they cannot pay",
    ],
  },
  compilation_record: {
    gates: [
      {
        gate: "G0",
        result: "PASS",
        note: `Navigation complete. What: structured adversarial debate producing decisions and artifact. Who: Leader + Contrarians + PO (three role types). Why: method-attributable insight generation through adversarial structure (EXP-001c evidence). How: four-step linear DAG. When: problems with multiple defensible positions; not for execution tasks or single-answer queries.`,
      },
      {
        gate: "G1",
        result: "PASS",
        note: `D_COUNCIL = (Sigma_COUNCIL, Ax_COUNCIL). 10 sorts with cardinality, 3 function symbols with totality, 18 predicates with typed signatures referencing declared sorts (v1.1 fix: added decision_issued_by, specific_question, precedes, sigma_2_terminates; fixed diminishing_returns signature from State to Council; v1.3: added has_defend_clause, has_acknowledge_clause over CharacterCard), 8 closed axioms with rationale (Ax-4/5 free variables bound; Ax-5 temporal operators replaced with precedes predicate; Ax-6 rewritten with declared predicates; Ax-7 is pragmatic, not formally decidable; v1.2: Ax-7 gains minimum-turns guard |Turns| >= 2*|Questions|; v1.3: Ax-8 anti-capitulation clause integrity uses declared predicates has_defend_clause and has_acknowledge_clause over CharacterCard via card_of function symbol). Domain boundary stated. Initial and terminal state membership in Mod(D_COUNCIL) claimed with axiom-by-axiom verification (v1.2: initial_state_valid_claim covers both fresh and resume paths; v1.3: initial/terminal claims updated for Ax-7 and Ax-8).`,
      },
      {
        gate: "G2",
        result: "PASS",
        note: `O_COUNCIL stated as conjunction of four Sigma-predicates. Expressibility claim present. Progress preorder declared with well-foundedness argument. Three measures with formulas, ranges, and proxy claims. All measure formulas reference only declared Sigma symbols.`,
      },
      {
        gate: "G3",
        result: "PASS",
        note: `Three role types: Leader (neutral synthesis), Contrarian (committed argumentation), PO (external authority). Each with explicit observation projection and authorized/not-authorized transitions. Coverage claim: union covers all of Mod(D_COUNCIL). Authority claim: union covers all transitions to O_COUNCIL. Role partition rationale: minimal for adversarial debate with external arbitration.`,
      },
      {
        gate: "G4",
        result: "PASS",
        note: `Four steps in path graph (sigma_2/sigma_3 flattened per Option A \u2014 PAT-003A hybrid step for sigma_2). Each step has pre, post, finalized guidance, typed output_schema with hard/soft invariants. Three composability claims. Terminal and initial condition claims present. Contrarian challenge on sigma_1->sigma_2 (Question derivation from Challenge) defended by sigma_0 scope confirmation. DAG trivially acyclic. v1.2: sigma_0 precondition now branches for fresh/resume paths (RFC-001). sigma_1 precondition branches for fresh/resume. Composability verified for both paths. Guidance includes resume procedure for CMEM-PROTO state loading.`,
      },
      {
        gate: "G5",
        result: "PASS",
        note: `All four steps have finalized guidance in constraints-first format. Each guidance block covers all required output_schema fields by name. sigma_2 guidance includes PAT-003A termination argument (nu_sigma_2 = |unresolved pairs|, Ax-5 strict decrease). Spot-check: sigma_1 names leader, contrarians, cast_approved; sigma_3 names artifact, decisions_summary, minority_positions, positions_updated_count. All fields covered. v1.2: sigma_0 guidance extended with resume procedure (RFC-001). sigma_2 diminishing returns detection updated with minimum-turns guard reference (RFC-002). v1.3: sigma_1 guidance includes explicit anti-capitulation instructions (Ax-8) \u2014 both defend-position and acknowledge-counter clauses required in every character prompt.`,
      },
      {
        gate: "G6",
        result: "PASS",
        note: `This file (P1-EXEC/M1-COUNCIL/M1-COUNCIL.yaml). Structurally complete. v1.3: RFC-003 applied (Ax-8, sigma_1 anti-capitulation guidance). Prior: v1.2 RFC-001, RFC-002.`,
      },
    ],
  },
  known_wip: [
    {
      id: "W1",
      status: "open",
      description: `Sub-agent spawning within sigma_2 (character does individual research while debate continues). Requires concurrent branches not in current theory. Deferred to v2.0.`,
    },
    {
      id: "W2",
      status: "resolved_v1.1",
      description: `Position identity for Ax-3 enforcement operationalized as Leader tagging (v1.1). The Leader flags repetition based on unchanged prescription + justification. Formal definition (semantic similarity model) remains open for future versions but the pragmatic operationalization is sufficient for LLM execution.`,
    },
    {
      id: "W5",
      status: "open",
      description: `Context isolation execution mode. EXP-002 (ov-research, 2026-03-19) found that running council characters as isolated sub-agents (separate context windows, shared transcript file) produces 2x position shifts, +43% counter-arguments, and qualitatively reversed conviction trajectories vs synthetic single-context execution. M1-COUNCIL axioms (Ax-3 through Ax-7) are mode-independent \u2014 they apply equally under both synthetic and isolated execution (SESSION-033 D-073, Harlan's analysis). Isolation is an execution architecture choice, not a method modification. The /council-team skill implements the --isolated flag (D-074). Method-level parameterization deferred pending 2+ replications on different problem types (D-075).`,
      evidence: "ov-research/experiments/EXP-002-context-isolation",
      council_decisions: ["D-073", "D-074", "D-075"],
    },
  ],
};

export const M2_ORCH_META: MethodMetadata = {
  id: "M2-ORCH",
  parent: "P1-EXEC",
  name: "Orchestrator Execution Method",
  description: `Single-pass orchestration execution method. Given a challenge decomposable into n independent sub-tasks, dispatches parallel sub-agents and integrates outputs. Fixed DAG: orient -> decompose -> dispatch -> integrate -> verify. No loops, no re-evaluation. Verification failure is terminal \u2014 caller handles re-dispatch.`,
  version: "1.0",
  status: "compiled",
  compilation_date: "2026-03-14",
  formal_grounding: "theory/F1-FTH.md",
  navigation: {
    what: `M2-ORCH takes a challenge that decomposes into n independent sub-tasks, dispatches parallel sub-agents to execute them, integrates all results, and verifies the integration for completeness and consistency. Output is an Integration satisfying O_ORCH. Verification failure is terminal \u2014 the caller decides what to do next.`,
    who: `Two roles \u2014 orchestrator (one) and sub-agent (n, determined at sigma_1). The orchestrator holds architectural context and coordinates; sub-agents execute scoped work in isolation from each other.`,
    why: `Two failure modes motivate this method. (1) Context window burn: a single agent executing a large multi-part challenge accumulates source-level detail until architectural context is crowded out. (2) Serialization waste: genuinely parallel sub-problems executed sequentially waste time when parallel dispatch is available. M2-ORCH separates architectural context (orchestrator) from sub-task execution context (sub-agents).`,
    how: `Five linear steps: orient (assess decomposability) -> decompose (produce SubTask set with Scopes) -> dispatch (parallel sub-agents) -> integrate (assemble Results) -> verify (check completeness and consistency). Acyclic by construction \u2014 no re-dispatch.`,
    when_to_use: [
      "Challenge has >= 3 sub-tasks with non-overlapping scopes",
      "Sub-task boundaries can be fully declared before execution begins",
      "Sub-tasks are independent: completing sub-task i does not change inputs for sub-task j",
      "Integration cost is substantially lower than execution cost",
    ],
    when_not_to_use: [
      "Sub-tasks share state or have execution dependencies \u2014 use sequential method or M1-IMPL",
      "Fewer than 3 sub-tasks \u2014 single-agent execution is more efficient",
      "Decomposition requires exploratory execution \u2014 scope cannot be declared before running",
      "Creative generation requiring cross-pollination between sub-problems",
      "Verification failure requires re-dispatch \u2014 use M1-IMPL \u00A711 or future M2-ORCH v2.0",
    ],
  },
  compilation_record: {
    gates: [
      {
        gate: "G0",
        result: "PASS",
        note: `Navigation complete. What: decompose, dispatch, integrate, verify. Who: orchestrator + n sub-agents. Why: context window burn and serialization waste. How: five-step linear DAG. When: >= 3 independent sub-tasks with declarable scopes; not for dependent sub-tasks, creative generation, or re-dispatch scenarios.`,
      },
      {
        gate: "G1",
        result: "PASS",
        note: `D_ORCH = (Sigma_ORCH, Ax_ORCH). 7 sorts with cardinality, 5 total function symbols, 7 predicates with typed signatures referencing declared sorts, 5 closed axioms with rationale. Domain boundary stated. Initial and terminal state membership in Mod(D_ORCH) claimed with axiom-by-axiom verification.`,
      },
      {
        gate: "G2",
        result: "PASS",
        note: `O_ORCH stated as conjunction of three Sigma-predicates (covers, consistent, complete). Expressibility claim present. Progress preorder declared with well-foundedness argument. Two measures with formulas, ranges, terminal values, and proxy claims.`,
      },
      {
        gate: "G3",
        result: "PASS",
        note: `Two roles: orchestrator (architectural context, full orchestration authority) and sub_agent (scoped execution, Result production). Coverage claim: union of projections covers all of Mod(D_ORCH). Authority claim: union covers all required transitions. Role partition rationale: epistemic separation is the method's core mechanism.`,
      },
      {
        gate: "G4",
        result: "PASS",
        note: `Five steps in path graph. Each step has pre, post, finalized guidance, typed output_schema with hard/soft invariants. Four composability claims (all justified). Terminal and initial condition claims present. Contrarian challenge on sigma_2->sigma_3 edge (received vs usable Results) defended by flagged_failures chain.`,
      },
      {
        gate: "G5",
        result: "PASS",
        note: `All five steps have finalized guidance in constraints-first format. Each guidance block covers all required output_schema fields by name. Spot-check: sigma_1 names sub_tasks, coverage_verified, deferred_gaps; sigma_4 names outcome, completeness_notes, consistency_notes, failure_cause. All fields covered.`,
      },
      {
        gate: "G6",
        result: "PASS",
        note: `This file (P1-EXEC/M2-ORCH/M2-ORCH.yaml). Structurally complete.`,
      },
    ],
  },
  known_wip: [
    {
      id: "Q1",
      status: "open",
      description: `Domain retraction pairs for sub-agent scoping (embed_SA/project_SA) required by F1-FTH \u00A76.3 but not formally declared. The retraction is implicit in the scope assignment at sigma_2.`,
    },
    {
      id: "Q2",
      status: "open",
      description: `Parallel dispatch assumes scope-disjointness implies domain-theory-disjointness. This is plausible for file-scoped sub-tasks but unverified formally. Blocked on P4 (parallel retraction coherence) from F2-OPR.`,
    },
  ],
};

export const M3_TMP_META: MethodMetadata = {
  id: "M3-TMP",
  parent: "P1-EXEC",
  name: "Traditional Meta-Prompting Method",
  description: `Single-agent, sequential, structured reasoning. The agent orients against the challenge, executes through explicit decomposition, and verifies its own output. No constructed characters, no parallel sub-agents, no adversarial pressure. Value over raw prompting is precisely located: explicit decomposition (sigma_0) and explicit verification (sigma_2).`,
  version: "1.0",
  status: "compiled",
  compilation_date: "2026-03-14",
  formal_grounding: "theory/F1-FTH.md",
  navigation: {
    what: `M3-TMP takes a user challenge, decomposes it into sub-questions, addresses each sequentially, and verifies the composed response for completeness and consistency. Output is a Response satisfying O_TMP: all sub-questions addressed, no internal contradictions.`,
    who: `One role \u2014 the analyst. The executing agent (human or LLM) occupies this role directly. No constructed characters, no role-switching.`,
    why: `The fastest path from challenge to response with lowest structural overhead. Without the explicit decomposition step, agents skip scope commitment \u2014 they cannot be held accountable to a declared sub-question list. Without the explicit verification step, dropped sub-questions and accumulated contradictions go undetected.`,
    how: `Three linear steps: orient (decompose challenge into sub-questions), execute (address each sub-question sequentially), verify (confirm completeness and consistency). Path graph \u2014 no branching, no loops.`,
    when_to_use: [
      "Well-scoped challenges with a deterministic or near-deterministic correct answer",
      "Tasks where a single expert's perspective is sufficient",
      "Challenge complexity fits within one sequential reasoning chain",
      "Time or context-window constraints make M1-COUNCIL or M2-ORCH disproportionate",
      "Compilation and formal analysis tasks (EXP-002: traditional wins on compilation)",
    ],
    when_not_to_use: [
      "Creative or exploratory challenges where non-obvious framings have value \u2014 route to M1-COUNCIL",
      "Tasks requiring parallel independent workstreams \u2014 route to M2-ORCH",
      "Challenges with irreducible value pluralism requiring adversarial pressure \u2014 route to M1-COUNCIL",
      "Tasks requiring method-attributable insight reproducibility \u2014 route to M1-COUNCIL",
    ],
  },
  compilation_record: {
    gates: [
      {
        gate: "G0",
        result: "PASS",
        note: `Navigation complete. What: decompose, address, verify. Who: single analyst role. Why: accountability via explicit decomposition and verification. How: three-step linear path. When: well-scoped sequential challenges; not for creative/parallel tasks.`,
      },
      {
        gate: "G1",
        result: "PASS",
        note: `D_TMP = (Sigma_TMP, Ax_TMP). 5 sorts with cardinality, 4 total function symbols, 3 predicates with typed signatures referencing declared sorts, 3 closed axioms. Domain boundary stated. Initial and terminal state membership in Mod(D_TMP) claimed with axiom-by-axiom verification.`,
      },
      {
        gate: "G2",
        result: "PASS",
        note: `O_TMP stated as conjunction of two Sigma-predicates (complete, consistent). Expressibility claim present. Progress preorder declared with well-foundedness argument. Two measures with formulas, ranges, terminal values, and proxy claims. All measure formulas reference only declared Sigma symbols.`,
      },
      {
        gate: "G3",
        result: "PASS",
        note: `One role (analyst) with identity observation projection and explicit authorized transitions. Coverage claim: trivially total (identity projection). Authority claim: all three steps authorized. Role partition rationale: one role because no epistemic separation requirement exists in single-agent execution.`,
      },
      {
        gate: "G4",
        result: "PASS",
        note: `Three steps (sigma_0, sigma_1, sigma_2) in path graph. Each step has pre, post, finalized guidance, and typed output_schema with invariants. Two composability claims (both identity inclusion). Terminal and initial condition claims present. Contrarian challenge on sigma_1->sigma_2 edge: semantic vs syntactic adequacy of "addressed" predicate; defended by sigma_2's verification procedure.`,
      },
      {
        gate: "G5",
        result: "PASS",
        note: `All three steps have finalized guidance in constraints-first format. Each guidance block covers all required output_schema fields by name. Adequacy spot-check: sigma_0 guidance names sub_questions and scope_note; sigma_1 guidance names answers and decomposition_revisions; sigma_2 guidance names verify_checks, consistency_check, and final_response. All fields covered.`,
      },
      {
        gate: "G6",
        result: "PASS",
        note: `This file (P1-EXEC/M3-TMP/M3-TMP.yaml). Structurally complete.`,
      },
    ],
  },
  known_wip: [
    {
      id: "Q1",
      status: "open",
      description: `Decomposition quality as predictor of method success. Is there a formal characterization of adequate decomposition checkable at sigma_0? Connects to P2 (semantic validation of guidance) from F1-FTH \u00A710.`,
    },
    {
      id: "Q2",
      status: "open",
      description: `When does sigma_2 find nothing? Consistent zero-correction rate may flag cosmetic verification. Can correction rate be used as integrity measure?`,
    },
  ],
};

export const M4_ADVREV_META: MethodMetadata = {
  id: "M4-ADVREV",
  parent: "P1-EXEC",
  name: "Adversarial Review Pipeline Method",
  description: `Structured adversarial review where parallel contrarian advisors independently attack an artifact from complementary dimensions, followed by parallel synthesizers who defend, refine, and sequence the findings into an Action Plan with consensus. The pipeline produces two artifacts: a Review Report (adversarial findings) and an Action Plan (prioritized response). Parameterized via retraction input for mandatory review dimensions, domain constraints, and artifact type \u2014 enabling any parent method to delegate review execution while preserving domain-specific coverage guarantees. Also invocable standalone for ad-hoc review.`,
  version: "0.1",
  status: "trial",
  compilation_date: "2026-03-19",
  formal_grounding: "theory/F1-FTH.md",
  navigation: {
    what: `M4-ADVREV takes an artifact and produces an adversarial Review Report followed by a consensus-driven Action Plan. Phase A spawns 3-5 parallel contrarian advisors who independently attack the artifact from complementary dimensions (no debate, no consensus-seeking \u2014 value is in divergence). Phase B spawns 3-4 parallel synthesizers with fixed posture archetypes (Defender, Pragmatist, Strategist, Integrator) who independently respond to the findings. The output is an Action Plan with per-finding consensus decisions: accept, accept-with-refinement, defer, acknowledge, reject, merge.`,
    who: `Two role types: rho_orchestrator (single agent that designs casts, dispatches sub-agents, and produces the final artifacts) and rho_PO (the human or parent method \u2014 provides the artifact and receives the Action Plan). Advisors and synthesizers are sub-agents spawned by the orchestrator \u2014 they are not method roles but ephemeral execution units.`,
    why: `Single-perspective review produces approval bias: one agent finds what it expects to find. Multi-perspective review via debate (M1-COUNCIL) forces convergence, which can suppress divergent insights. M4-ADVREV's parallel-isolation architecture ensures advisors cannot influence each other and synthesizers are contrarian to the reviews, not to the artifact. The two-phase structure (attack \u2192 defend) ensures findings are both adversarial and proportional.`,
    how: `Seven-step DAG: target identification \u2192 cast design (with mandatory dimension coverage) \u2192 parallel advisor dispatch \u2192 advisor collection and Review Report \u2192 parallel synthesizer dispatch \u2192 consensus matrix and Action Plan \u2192 iteration check (optional re-review after fixes). Advisors and synthesizers execute as parallel sub-agents. The pipeline produces structured artifacts with finding IDs for traceability.`,
    when_to_use: [
      "An artifact has real stakes \u2014 a design, RFC, PR, data model, or implementation that could fail in ways not obvious from a single perspective",
      "A parent method needs review execution delegated (P2-SD/M3-PHRV, P-GH/M2-REVIEW, P3-GOV/M2-REVIEW in domain mode)",
      "A strategy pipeline includes a review gate between methodology nodes",
      "The PO requests adversarial multi-perspective critique before shipping, merging, or committing to a design",
    ],
    when_not_to_use: [
      "Trivial artifacts where single-perspective review is sufficient \u2014 the overhead of 7-9 parallel agents is not justified",
      "When structured debate with convergence is needed \u2014 use M1-COUNCIL instead (divergence architecture is wrong for that)",
      "P3-GOV steering reviews \u2014 these require M1-COUNCIL debate for essence alignment, not parallel isolation",
      "Mid-implementation feedback \u2014 use M1-IMPL confidence-raising steps instead",
    ],
  },
  compilation_record: {
    gates: [
      {
        gate: "G0",
        result: "PASS",
        note: `Navigation complete. What: adversarial review via parallel advisors + synthesizers. Who: rho_orchestrator + rho_PO. Why: parallel isolation prevents anchoring; two-phase structure ensures findings are both adversarial and proportional. How: 7-step DAG with bounded re-review loop. When: high-stakes artifacts needing multi-perspective review. When not: trivial artifacts, structured debate needs (M1-COUNCIL), steering reviews (M1-COUNCIL).`,
      },
      {
        gate: "G1",
        result: "PASS",
        note: `D_ADVREV = (Sigma_ADVREV, Ax_ADVREV). 18 sorts with cardinality. 9 function symbols with totality. 13 predicates with typed signatures referencing declared sorts. 7 closed axioms (Ax-1 through Ax-7) with rationale. Domain boundary stated. Initial and terminal state membership in Mod(D_ADVREV) claimed with axiom-by-axiom verification.`,
      },
      {
        gate: "G2",
        result: "PASS",
        note: `O_ADVREV stated as conjunction of Sigma-predicates. Type: terminal. Expressibility claim present. Progress preorder over 7-step DAG with well-foundedness argument. Three measures (pipeline_progress, finding_quality, consensus_rate) with formulas, ranges, terminal values, and proxy claims.`,
      },
      {
        gate: "G3",
        result: "PASS",
        note: `Two roles (rho_orchestrator, rho_PO) with observation projections and explicit authorized/not-authorized transitions. Coverage and authority claims present. Role partition rationale: orchestration vs artifact ownership. Sub-agents (advisors, synthesizers) are ephemeral execution units, not method roles.`,
      },
      {
        gate: "G4",
        result: "PASS",
        note: `Seven steps with bounded re-review loop. Loop structure declared with termination certificate nu_iter. Seven composability claims including loop edge. Terminal and initial condition claims present. Contrarian challenge on sigma_3 -> sigma_4 (orchestrator bias in convergence analysis) defended by raw-findings availability and auditable file artifact. Two retraction pairs (standalone, delegated) with verification.`,
      },
      {
        gate: "G5",
        result: "PASS",
        note: `All seven steps have finalized guidance in constraints-first format. Each guidance block names all output_schema fields. Adequacy confirmed: sigma_0 covers artifact loading and retraction parsing; sigma_1 covers cast design with mandatory dimensions; sigma_2 covers advisor dispatch with prompt template; sigma_3 covers collection and Review Report; sigma_4 covers synthesizer design and dispatch; sigma_5 covers consensus and Action Plan; sigma_6 covers iteration decision.`,
      },
      {
        gate: "G6",
        result: "PASS",
        note: `This file (P1-EXEC/M4-ADVREV/M4-ADVREV.yaml). Structurally complete.`,
      },
    ],
  },
};
