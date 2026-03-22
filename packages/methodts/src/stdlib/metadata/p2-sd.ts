/**
 * Narrative metadata for P2-SD (Software Delivery Methodology) and its 7 methods.
 * Extracted from compiled YAML specs in registry/P2-SD/.
 */

import type { MethodologyMetadata, MethodMetadata } from "../metadata-types.js";

// ── P2-SD Methodology ──

export const P2_SD_META: MethodologyMetadata = {
  id: "P2-SD",
  name: "Software Delivery Methodology",
  description: `LLM-assisted, gate-controlled delivery of typed-language software against \
pre-existing PRD artifacts, organized in discrete sessions. Covers: PRD \
sectioning, architecture refinement, phase planning, implementation \
(single-agent and parallel), phase review, and cross-phase drift audit. \
Excludes: product discovery, PRD writing, greenfield architecture design \
(from scratch with no existing codebase), deployment/ops, free-form research.`,
  version: "2.0",
  status: "compiled",
  compilation_date: "2026-03-14",
  niche: `LLM-assisted, gate-controlled delivery of typed-language software against \
pre-existing PRD artifacts, organized in discrete sessions. Covers: PRD \
sectioning, architecture refinement, phase planning, implementation \
(single-agent and parallel), phase review, and cross-phase drift audit. \
Excludes: product discovery, PRD writing, greenfield architecture design \
(from scratch with no existing codebase), deployment/ops, free-form research.`,
  navigation: {
    what: `P2-SD receives a software delivery challenge, classifies it by task type, \
and routes it to the appropriate execution method. It does not deliver anything \
directly — it evaluates delta_SD and dispatches. Seven task types map to seven \
methods covering the full delivery loop: PRD sectioning, architecture refinement, \
planning, implementation, review, and audit.`,
    who: `The dispatcher role — any agent (human or LLM) who receives a software delivery \
challenge and must decide which method to invoke.`,
    why: `Seven structurally different delivery activities exist, each with a distinct \
input/output signature, domain theory, and execution model. Routing the wrong \
method to a challenge wastes effort (M1-COUNCIL on a simple implementation task) \
or produces poor results (M3-TMP on a problem needing adversarial review). \
delta_SD externalizes the routing decision into an explicit, auditable function.`,
    how: `Evaluate task_type(challenge, t) against the operationalization criteria. Apply \
delta_SD (7-arm priority stack). For implement challenges, additionally evaluate \
multi_task_scope to choose M1-IMPL vs M2-DIMPL.`,
    when_to_use: [
      "A software delivery challenge arrives within the niche",
      "The executor is unsure which delivery method to invoke",
      "The full delivery loop needs orchestrating: PRD -> architecture -> plan -> implement -> review -> audit",
    ],
    when_not_to_use: [
      "Product discovery or PRD writing — outside niche",
      "Greenfield architecture with no existing codebase — outside niche",
      "Deployment, ops, infrastructure — outside niche",
      "Free-form research or exploration — outside niche",
      "A specific method is already identified — invoke it directly",
    ],
  },
  compilation_record: {
    gates: [
      {
        gate: "G0",
        result: "PASS",
        note: `Navigation complete. What: 7-arm routing methodology for software delivery. \
Who: single dispatcher role. Why: wrong method selection degrades quality. \
How: evaluate task_type -> apply delta_SD -> dispatch. When: software delivery \
challenges within the niche.`,
      },
      {
        gate: "G1",
        result: "PASS",
        note: `D_Phi_SD = (Sigma_Phi_SD, Ax_Phi_SD). 5 sorts with cardinality (Challenge, \
TaskType with 6 values, MethodID with 7 values, ExecutionResult, State). \
4 function symbols with totality. 6 predicates with typed signatures referencing \
declared sorts. 5 closed axioms with rationale. Domain boundary stated. Initial \
and terminal state membership claimed with axiom-by-axiom verification.`,
      },
      {
        gate: "G2",
        result: "PASS",
        note: `O_Phi_SD stated as conjunction of three Sigma-predicates. Type: terminal. \
Expressibility claim present. addresses operationalized as method-specific O_M \
satisfaction. Progress preorder as 3-state total chain. Two measures with \
formulas, ranges, terminal values, and proxy claims.`,
      },
      {
        gate: "G3",
        result: "PASS",
        note: `One role (dispatcher) with identity observation projection and explicit \
authorized/not-authorized transitions. Coverage claim: trivially total. \
Authority claim: all routing transitions authorized. Role partition rationale: \
one role is minimal for a pure routing methodology.`,
      },
      {
        gate: "G4",
        result: "PASS",
        note: `delta_SD declared as 9-arm priority stack (7 routing + terminate + executing). \
Totality: Ax-3 guarantees every task type maps to a method. Termination \
certificate nu_SD = 1 with single-invocation decrease witness. Seven retraction \
pairs declared (RP-1 through RP-7) with embed/project signatures and retraction \
verification claims. RP-5 (M1-IMPL) grounded; others declared at type level (W3).`,
      },
      {
        gate: "G5",
        result: "PASS",
        note: `Six task_type values operationalized with True/False conditions and concrete \
criteria. multi_task_scope operationalized with n >= 3 threshold. Evaluation \
order specified: upstream activities (section, architecture) before downstream \
(plan, implement, review, audit).`,
      },
      {
        gate: "G6",
        result: "PASS",
        note: "This file (P2-SD/P2-SD.yaml). Structurally complete.",
      },
    ],
  },
  known_wip: [
    {
      id: "W1",
      status: "open",
      description: `Predicate operationalization for task_type is heuristic. Boundary cases exist: \
a challenge that is both an architecture refinement and a planning task. The \
priority ordering (architecture before plan) resolves this, but two independent \
dispatchers may disagree on the classification. Calibration from empirical runs \
would improve agreement.`,
    },
    {
      id: "W2",
      status: "open",
      description: `multi_task_scope threshold (n >= 3) is empirical. Calibrate from first \
orchestration runs. If n = 2 tasks consistently benefit from parallel dispatch, \
lower the threshold.`,
    },
    {
      id: "W3",
      status: "open",
      description: `Retraction pairs RP-1 through RP-4, RP-6, RP-7 are declared at type level \
(embed/project signatures stated) but not formally verified (project o embed = id \
not proven, only claimed). Verification requires checking that each method's \
terminal state projects back to D_Phi_SD correctly. RP-5 (M1-IMPL) is grounded \
from the original P2-SI compilation.`,
    },
  ],
};

// ── M1-IMPL ──

export const M1_IMPL_META: MethodMetadata = {
  id: "M1-IMPL",
  parent: "P2-SD",
  name: "Method for Implementing Software from Architecture and PRDs",
  description: `General method for LLM-assisted implementation of software systems where architecture \
documents and PRDs precede code. Grounded in Voss-Solaric methodology theory. Two-phase \
structure: Phase A raises implementation confidence to a threshold by auditing the spec \
corpus against source; Phase B executes implementation tasks under validated specs. The \
method compiles when all nine steps are composable to O_SI and all seven acceptance gates \
pass. Project-level instantiation produced via M4-MINS.`,
  version: "3.1",
  status: "compiled",
  compilation_date: "2026-03-09",
  evolution_note: "v3.1: serialization completeness rule added to sigma_B3; R8-TCAG, R9-PDVF, R10-SCAG indexed in section 8",
  formal_grounding: "theory/F1-FTH.md",
  navigation: {
    what: `M1-IMPL is the core implementation method: it takes an active PhaseDoc and produces \
a completed phase — all tasks implemented, build clean, tests passing, session log \
recorded. Two-phase structure: Phase A raises confidence in the spec corpus before \
any code is written; Phase B executes implementation tasks under validated specs.`,
    who: `Two roles in sequence: auditor (Phase A — reads spec corpus, identifies and fixes \
discrepancies, produces confidence score) and implementor (Phase B — writes production \
code, validates, records). LLM agents are the primary execution target.`,
    why: `Implementation docs drift from architecture. Phase A catches discrepancies before \
they become runtime bugs. Without the confidence-raising pass, agents implement \
against stale or contradictory specs — compounding errors across phases.`,
    how: `Nine-step DAG: sigma_A1-sigma_A4 (Phase A, with re-entry loop bounded by nu_A) \
then sigma_B1-sigma_B5 (Phase B, one pass per task). Phase A exit requires \
confidence >= threshold AND nu_A = 0. Phase B exit requires O_SI.`,
  },
  compilation_record: {
    gates: [
      {
        gate: "G0",
        result: "PASS",
        note: `What/Who/Why/How/When all present. What: LLM-assisted software implementation from \
architecture docs. Who: auditor (Phase A), implementor (Phase B); LLM execution target. \
Why: informal knowledge drifts; Phase A catches spec drift before implementation. \
How: two-phase (confidence raising -> implementation), 9-step DAG. \
When: before writing net-new production code; before resuming after a long gap.`,
      },
      {
        gate: "G1",
        result: "PASS",
        note: "D_SI = (Sigma_SI, Ax_SI) declared with 10 sorts, 2 function symbols, 13 predicates, 6 closed axioms",
      },
      {
        gate: "G2",
        result: "PASS",
        note: "O_SI expressible over Sigma_SI; measures mu_1-mu_4 with formulas, ranges, proxy claims; preorder preceq_SI well-founded",
      },
      {
        gate: "G3",
        result: "PASS",
        note: "8 roles declared; coverage_claim and authority_claim present; union of observation projections covers full Mod(D_SI)",
      },
      {
        gate: "G4",
        result: "PASS",
        note: "9 steps; 11 composability claims including re-entry edge; initial_condition_claim and terminal_condition_claim declared; termination certificate nu_A; contrarian_challenge (weakest edge sigma_A4->sigma_B1, severity calibration revision)",
      },
      {
        gate: "G5",
        result: "PASS",
        note: "All 9 steps ADEQUATE and FORMAT-OK; 3 revised (sigma_A2, sigma_A4, sigma_B4); all constraints-first",
      },
      {
        gate: "G6",
        result: "PASS",
        note: "This file. Structurally complete: 9 phases, output schemas with typed fields and hard_invariants, loop_structure with termination certificate, composability claims, guidance adequacy record",
      },
    ],
  },
};

// ── M2-DIMPL ──

export const M2_DIMPL_META: MethodMetadata = {
  id: "M2-DIMPL",
  parent: "P2-SD",
  name: "Distributed Implementation Method",
  description: `Re-entrant orchestration method for software implementation. Decomposes a \
multi-task phase into parallel sub-tasks, dispatches impl-sub-agents, evaluates \
results through Gate A (quality) and Gate B (security/architecture), patches \
failures, and iterates until all gates pass or budget exhausted. Extracted from \
M1-IMPL section 11 Orchestrator Mode.`,
  version: "1.0",
  status: "compiled",
  compilation_date: "2026-03-14",
  formal_grounding: "theory/F1-FTH.md",
  navigation: {
    what: `M2-DIMPL takes a PhaseDoc with multiple independent tasks, dispatches parallel \
impl-sub-agents to execute them, evaluates each via Gate A (quality) and Gate B \
(security/architecture), patches failed tasks, and produces an integrated session \
log with all tasks passing both gates. Unlike P1-EXEC/M2-ORCH (single-pass, \
terminal on failure), M2-DIMPL re-dispatches on failure.`,
    who: `Four role types: orchestrator (1, holds architectural context, coordinates), \
impl-sub-agent (n, executes scoped tasks), qa-sub-agent (per-task Gate A \
reviewer), sec-arch-sub-agent (1, Gate B security/architecture verifier).`,
    why: `Single-agent execution of large multi-task phases burns context windows — \
architectural context is crowded out by source-level detail. Serialization of \
independent tasks wastes time. M2-DIMPL separates architectural context \
(orchestrator) from task execution (sub-agents) and adds quality gates that \
catch failures before integration.`,
    how: `Five steps: decompose (produce sub-task set from PhaseDoc) -> dispatch (parallel \
sub-agents) -> gate_a (quality review per task, PAT-003A hybrid step with bounded \
patch loop) -> gate_b (security/architecture review) -> integrate (assemble session \
log). Gate A failures trigger patch sub-agents and re-evaluation (bounded re-entry).`,
    when_to_use: [
      "PhaseDoc has >= 3 tasks with non-overlapping file scopes",
      "Task boundaries are clear from the PhaseDoc (scope declarable before execution)",
      "Tasks are independent: completing task i does not change inputs for task j",
      "Quality gates (compilation, test regression, architecture alignment) are required",
    ],
    when_not_to_use: [
      "Tasks share state or have execution dependencies — use M1-IMPL (single-agent)",
      "Fewer than 3 tasks — single-agent execution is more efficient",
      "Review-patch sessions — targeted single-agent sigma_B1-B5 is better for localized correction",
      "Decomposition requires exploratory execution",
    ],
  },
  compilation_record: {
    gates: [
      {
        gate: "G0",
        result: "PASS",
        note: `Navigation complete. What: decompose, dispatch, gate-a (quality + patch loop), \
gate-b (security/architecture), integrate. Who: orchestrator + n impl-sub-agents \
+ qa-sub-agents + sec-arch-sub-agent (four role types). Why: context window burn \
and serialization waste, plus quality gate enforcement. How: five-step DAG with \
PAT-003A hybrid at sigma_2. When: >= 3 independent tasks with declarable scopes \
and quality gate requirements; not for dependent tasks, < 3 tasks, or exploratory \
decomposition.`,
      },
      {
        gate: "G1",
        result: "PASS",
        note: `D_DIMPL = (Sigma_DIMPL, Ax_DIMPL). 10 sorts with cardinality (including nat for \
bounds). 1 declared constant (max_patch_attempts : nat = 2). 5 function symbols \
with totality (file_scope, assignee, gate_a, compile_exit, patch_count). 10 \
predicates with typed signatures referencing declared sorts (from_phase, independent, \
task_complete, gate_a_pass, gate_b_pass, patched, dispatched, scope_declared, \
no_regression, budget_exhausted). 6 closed axioms with rationale — Ax-5 references \
declared constant max_patch_attempts. Domain boundary stated. Initial and terminal \
state membership in Mod(D_DIMPL) claimed with axiom-by-axiom verification.`,
      },
      {
        gate: "G2",
        result: "PASS",
        note: `O_DIMPL stated as conjunction of four Sigma-predicates (gate_a_pass for all tasks, \
gate_b_pass, compile_exit = 0, no_regression). Type: terminal. Expressibility claim \
present — all referenced symbols in Sigma_DIMPL. Progress preorder declared with \
well-foundedness argument (finite task set, finite patch budget). Three measures \
(task_gate_coverage, compile_integrity, test_stability) with formulas, ranges, \
terminal values, and proxy claims. All measure formulas reference only declared \
Sigma symbols.`,
      },
      {
        gate: "G3",
        result: "PASS",
        note: `Four role types: orchestrator (coordination authority), impl_sub_agent (scoped \
execution), qa_sub_agent (quality evaluation), sec_arch_sub_agent (security/ \
architecture evaluation). Each with explicit observation_projection and authorized/ \
not-authorized transitions. Coverage claim: union of projections covers all of \
Mod(D_DIMPL). Authority claim: union covers all transitions to O_DIMPL. Role \
partition rationale: four-way split is minimal for distributed implementation with \
quality gates.`,
      },
      {
        gate: "G4",
        result: "PASS",
        note: `Five steps in path graph (sigma_2 is PAT-003A hybrid with bounded internal \
convergence — same pattern as M1-COUNCIL sigma_2). Each step has pre, post, \
finalized guidance in constraints-first format, typed output_schema with hard/soft \
invariants. Four composability claims (all edges justified). Terminal condition \
claim: post_sigma_4 implies O_DIMPL on PASS path. Initial condition claim: \
pre_sigma_0 satisfied by M1-IMPL Phase A. Contrarian challenge on sigma_2->sigma_3 \
(budget-exhausted tasks in Gate B review context) defended by terminal_failures \
chain and GAP_DOCUMENTED verdict.`,
      },
      {
        gate: "G5",
        result: "PASS",
        note: `All five steps have finalized guidance in constraints-first format. Each guidance \
block covers all required output_schema fields by name. sigma_2 guidance includes \
PAT-003A termination argument (nu_sigma_2 with strict decrease, Ax-5 bound). \
Spot-check: sigma_0 names tasks, coverage_verified, deferred_gaps; sigma_2 names \
gate_a_results, all_gate_a_pass, terminal_failures; sigma_4 names session_log, \
compile_exit, test_results, outcome. All fields covered.`,
      },
      {
        gate: "G6",
        result: "PASS",
        note: "This file (P2-SD/M2-DIMPL/M2-DIMPL.yaml). Structurally complete.",
      },
    ],
  },
};

// ── M3-PHRV ──

export const M3_PHRV_META: MethodMetadata = {
  id: "M3-PHRV",
  parent: "P2-SD",
  name: "Phase Review Method",
  description: `Post-implementation review method. After a phase completes via M1-IMPL or \
M2-DIMPL, M3-PHRV evaluates the delivered work against the PhaseDoc, \
architecture docs, and PRD. Produces a ReviewReport with per-finding citations \
(file:line) and an overall verdict. Read-only — M3-PHRV does not modify source.`,
  version: "1.1",
  status: "compiled",
  compilation_date: "2026-03-19",
  formal_grounding: "theory/F1-FTH.md",
  evolution_note: `v1.1: Added M4-ADVREV delegation support. When the phase artifact is high-stakes \
(>= 5 acceptance criteria or touches architecture), M3-PHRV can delegate its sigma_1 \
(Criteria Audit) and sigma_2 (Architecture Assessment) to M4-ADVREV via retraction \
pair RP-PHRV-ADVREV. This replaces single-perspective review with adversarial \
multi-perspective review while preserving M3-PHRV's domain framing (acceptance criteria \
enumeration in sigma_0, verdict production in sigma_3). Council decision D-4 Tier 1.`,
  navigation: {
    what: `M3-PHRV takes a completed phase's artifacts (source files, session log, PhaseDoc, \
architecture docs) and produces a ReviewReport: a list of findings with file:line \
citations, severity ratings, and an overall verdict (PASS, CONDITIONAL, FAIL). \
Does not fix anything — findings are input to the next M1-IMPL or M3-MEVO cycle.`,
    who: `One role — reviewer. Read-only access to all phase artifacts. The reviewer \
evaluates delivered work against the spec, not against their own judgment about \
what the code should do.`,
    why: `Implementation without review accumulates silent drift: the code works but \
diverges from the spec, architecture constraints are violated without detection, \
and acceptance criteria are partially met without explicit acknowledgment. M3-PHRV \
makes the gap between spec and delivery visible and citable.`,
    how: `Four linear steps: orient (load phase artifacts) -> audit (check each task against \
PhaseDoc acceptance criteria) -> assess (evaluate architecture and cross-cutting \
concerns) -> report (produce ReviewReport with verdict).`,
    when_to_use: [
      "A phase has completed via M1-IMPL or M2-DIMPL",
      "The delivered work needs evaluation against PRD and architecture",
      "Findings are needed as input to the next planning or evolution cycle",
    ],
    when_not_to_use: [
      "Mid-implementation review — use M1-IMPL sigma_A1-A4 (confidence raising) instead",
      "Cross-phase drift analysis — use M4-DDAG instead",
      "The task is to fix issues, not find them — use M1-IMPL",
    ],
  },
  compilation_record: {
    gates: [
      {
        gate: "G0",
        result: "PASS",
        note: `Navigation complete. What: load artifacts, audit criteria, assess architecture, \
produce report. Who: single reviewer role (read-only). Why: makes gap between \
spec and delivery visible and citable. How: four-step linear path. When_to_use: \
post-phase evaluation. When_not_to_use: mid-implementation, cross-phase drift, \
fixing issues.`,
      },
      {
        gate: "G1",
        result: "PASS",
        note: `D_PHRV = (Sigma_PHRV, Ax_PHRV). 7 sorts with cardinality, 3 total function \
symbols, 5 predicates with typed signatures referencing declared sorts \
(AcceptanceCriterion, Finding, Severity, PhaseArtifact, ArchDoc, ReviewReport, \
Verdict — all declared). 4 closed axioms (Ax-1 through Ax-4) with rationale. \
Domain boundary stated. Initial and terminal state membership in Mod(D_PHRV) \
claimed with axiom-by-axiom verification.`,
      },
      {
        gate: "G2",
        result: "PASS",
        note: `O_PHRV stated as conjunction of Sigma-predicates (report_complete, verdict_of, \
criterion_met, criterion_gap, severity_of — all declared). Expressibility claim \
present. Type: terminal. Progress preorder declared with well-foundedness argument \
(finite criterion set). Two measures (mu_coverage, mu_completeness) with formulas, \
ranges, terminal values, and proxy claims. All measure formulas reference only \
declared Sigma symbols.`,
      },
      {
        gate: "G3",
        result: "PASS",
        note: `One role (reviewer) with identity observation projection and explicit authorized \
transitions covering all four steps. Not_authorized list present. Coverage claim: \
trivially total (identity projection). Authority claim: all four steps authorized. \
Role partition rationale: one role because no epistemic separation requirement \
exists in single-evaluator review.`,
      },
      {
        gate: "G4",
        result: "PASS",
        note: `Four steps (sigma_0, sigma_1, sigma_2, sigma_3) in path graph. Each step has \
pre, post, finalized guidance with constraints-first format, typed output_schema \
with required fields, and invariants (hard + soft). Three composability claims \
(sigma_0->sigma_1, sigma_1->sigma_2, sigma_2->sigma_3). Terminal and initial \
condition claims present. Contrarian challenge on sigma_1->sigma_2 edge: semantic \
adequacy of criterion_met judgments; defended by citation requirement, architecture \
cross-check, and auditable output format.`,
      },
      {
        gate: "G5",
        result: "PASS",
        note: `All four steps have finalized guidance in constraints-first format. Each guidance \
block explicitly names all output_schema fields. Adequacy spot-check: sigma_0 \
names acceptance_criteria, architecture_docs, files_in_scope; sigma_1 names \
criteria_results; sigma_2 names architecture_findings, architecture_aligned; \
sigma_3 names review_report, verdict, finding_count, severity_breakdown. All \
fields covered.`,
      },
      {
        gate: "G6",
        result: "PASS",
        note: "This compilation record. All gates G0-G5 passed. File: P2-SD/M3-PHRV/M3-PHRV.yaml. Structurally complete.",
      },
    ],
  },
};

// ── M4-DDAG ──

export const M4_DDAG_META: MethodMetadata = {
  id: "M4-DDAG",
  parent: "P2-SD",
  name: "Drift Audit Method",
  description: `Cross-phase drift detection method. Analyzes N most recent completed phases to \
identify architectural drift, accumulating divergences, pattern violations, and \
inter-phase inconsistencies that single-phase review (M3-PHRV) cannot detect. \
Produces a DriftReport with drift vectors and remediation recommendations. \
Read-only — M4-DDAG does not modify source.`,
  version: "1.0",
  status: "compiled",
  compilation_date: "2026-03-14",
  formal_grounding: "theory/F1-FTH.md",
  navigation: {
    what: `M4-DDAG takes the session logs and source artifacts from N recent phases and \
produces a DriftReport: identified drift vectors (where the codebase is diverging \
from architecture), accumulated divergences (individually minor but collectively \
significant), and remediation recommendations. Output is a diagnostic artifact, \
not a fix.`,
    who: `One role — drift-auditor. Read-only access to all phase artifacts across the \
N-phase window. The auditor looks for patterns invisible to per-phase review.`,
    why: `Individual phases may pass M3-PHRV review while the codebase drifts from its \
architecture over time. Each phase introduces small divergences that are locally \
acceptable but collectively produce architectural decay. M4-DDAG detects this \
accumulation by comparing the current codebase against the architecture across \
multiple phases. Typically invoked every ~3 phases.`,
    how: `Four linear steps: scope (define audit window) -> collect (gather cross-phase \
divergences) -> analyze (identify drift vectors) -> report (produce DriftReport).`,
    when_to_use: [
      "3+ phases have completed since last drift audit",
      "M3-PHRV findings show recurring MEDIUM/LOW issues across phases",
      "Architecture docs have been updated and prior phases may not conform",
      "A significant refactor or migration is being planned (need drift baseline)",
    ],
    when_not_to_use: [
      "Single-phase review — use M3-PHRV",
      "Mid-implementation audit — use M1-IMPL Phase A (confidence raising)",
      "The task is to fix drift, not detect it — use M1-IMPL with drift-fix PhaseDoc",
    ],
  },
  compilation_record: {
    gates: [
      {
        gate: "G0",
        result: "PASS",
        note: `Navigation complete. What: cross-phase drift detection producing DriftReport. Who: \
single drift-auditor role with read-only access. Why: detect accumulated architectural \
drift invisible to per-phase review. How: four-step linear path (scope, collect, \
analyze, report). When: after 3+ phases or recurring findings; not for single-phase \
review or fixing drift.`,
      },
      {
        gate: "G1",
        result: "PASS",
        note: `D_DDAG = (Sigma_DDAG, Ax_DDAG). 8 sorts with cardinality, 3 total function symbols, \
8 predicates with typed signatures referencing declared sorts (including "evaluated" \
used in Ax-1), 4 closed axioms with rationale. Domain boundary stated. Initial and \
terminal state membership in Mod(D_DDAG) claimed with axiom-by-axiom verification.`,
      },
      {
        gate: "G2",
        result: "PASS",
        note: `O_DDAG stated as conjunction of Sigma-predicates (report_complete, in_window, \
evaluated, drift_detected, severity_of, remediation_proposed). Type: terminal. \
Expressibility claim present — all symbols declared in Sigma_DDAG. Progress preorder \
declared with well-foundedness argument (finite phase set, bounded measure). Two \
measures (mu_1, mu_2) with formulas, ranges, terminal values, and proxy claims.`,
      },
      {
        gate: "G3",
        result: "PASS",
        note: `One role (drift_auditor) with observation projection (read-only full visibility) \
and explicit authorized transitions for all four steps. Not-authorized list present. \
Coverage claim: full visibility over Mod(D_DDAG). Authority claim: all four steps \
authorized. Role partition rationale: one role because no epistemic separation \
required in single-perspective longitudinal analysis.`,
      },
      {
        gate: "G4",
        result: "PASS",
        note: `Four steps (sigma_0 through sigma_3) in path graph with formal DAG declaration. \
Each step has pre/post conditions, finalized guidance, typed output_schema with \
required flags, and invariants (hard + soft). Three composability claims (all \
identity inclusion). Terminal and initial condition claims present. Contrarian \
challenge on sigma_1->sigma_2 edge: divergence collection completeness; defended \
by multi-source examination and honest domain boundary acknowledgment.`,
      },
      {
        gate: "G5",
        result: "PASS",
        note: `All four steps have finalized guidance in constraints-first format. Each guidance \
block covers all required output_schema fields by name. Adequacy spot-check: \
sigma_0 guidance names audit_window_size, phases, architecture_baseline; sigma_1 \
guidance names divergences and phases_examined; sigma_2 guidance names drift_vectors \
and no_drift_detected; sigma_3 guidance names drift_report, drift_vector_count, \
severity_breakdown, phases_covered, and remediations. All fields covered.`,
      },
      {
        gate: "G6",
        result: "PASS",
        note: "This file (P2-SD/M4-DDAG/M4-DDAG.yaml). Structurally complete.",
      },
    ],
  },
};

// ── M5-PLAN ──

export const M5_PLAN_META: MethodMetadata = {
  id: "M5-PLAN",
  parent: "P2-SD",
  name: "Phase Planning Method",
  description: `Takes a PRDSection and produces a PhaseDoc — a scoped, severity-rated, validated task \
list for one delivery phase. Five linear steps: validate inputs, extract tasks from PRD, \
integrate carryover from phase history, scope and rate tasks, write and validate PhaseDoc. \
Output is the handoff artifact consumed by M1-IMPL or M2-DIMPL.`,
  version: "1.0",
  status: "compiled",
  compilation_date: "2026-03-13",
  formal_grounding: "theory/F1-FTH.md",
  navigation: {
    what: `M5-PLAN takes a PRD section and produces a PhaseDoc — a structured, scoped, \
severity-rated task list that M1-IMPL or M2-DIMPL can execute directly. It does \
not implement anything.`,
    who: `The planner role — an agent (human or LLM) who has access to the PRD, the \
architecture documents, and the history of previous phases.`,
    why: `Unplanned phases drift. Without an explicit PhaseDoc, the implementing agent must \
infer scope from PRD text — a lossy operation that produces unscoped tasks, missed \
acceptance criteria, and unresolved carryover. M5-PLAN makes the planning act \
explicit and auditable.`,
    how: `Five linear steps: validate inputs -> extract tasks from PRD -> integrate carryover \
from phase history -> scope and rate each task -> write and validate the PhaseDoc.`,
  },
  compilation_record: {
    gates: [
      {
        gate: "G0",
        result: "PASS",
      },
      {
        gate: "G1",
        result: "PASS",
        note: "D_PLAN: 5 sorts, 8 predicates, 4 axioms. All Horn clauses, non-recursive (Type B-i).",
      },
      {
        gate: "G2",
        result: "PASS",
        note: "O_PLAN: complete(phaseDoc) AND covers(phaseDoc, PRDSection). Progress preorder well-founded. nu_PLAN = 1.",
      },
      {
        gate: "G3",
        result: "PASS",
        note: "Single role: planner. pi_planner = id. G3-C1 and G3-C2 hold.",
      },
      {
        gate: "G4",
        result: "PASS",
        note: "Linear DAG sigma_0-sigma_4. 5 composability claims. nu_PLAN = 1.",
      },
      {
        gate: "G5",
        result: "PASS",
        note: "All 5 steps: constraints-first, procedure explicit, output schema with hard invariants.",
      },
      {
        gate: "G6",
        result: "PASS",
        note: "This file is the canonical YAML artifact.",
      },
    ],
  },
};

// ── M6-ARFN ──

export const M6_ARFN_META: MethodMetadata = {
  id: "M6-ARFN",
  parent: "P2-SD",
  name: "Architecture Refinement Method",
  description: `Takes a PRD (or PRDSection) and an existing codebase/architecture, and produces \
or updates an ArchDoc — a set of focused architecture specification files \
following the horizontal documentation pattern. Refinement scope: updates \
existing architecture to accommodate new requirements. Not greenfield \
architecture design.`,
  version: "1.0",
  status: "compiled",
  compilation_date: "2026-03-14",
  formal_grounding: "theory/F1-FTH.md",
  navigation: {
    what: `M6-ARFN takes a PRD and existing architecture artifacts, analyzes what \
architectural changes the new requirements demand, and produces updated \
architecture specs. Output is a set of focused ArchDoc files (not one monolithic \
document) following the horizontal documentation pattern: system-context.md, \
interfaces.md, domains.md, data-flows.md, etc. Each file is independently \
evolvable and Git-trackable.`,
    who: `One role — the architect. Reads PRD, existing architecture, and existing \
codebase. Produces architecture refinements. Does not implement — only specifies.`,
    why: `Every method in P2-SD (M5-PLAN, M1-IMPL, M2-DIMPL, M3-PHRV, M4-DDAG) consumes \
ArchDoc as input but nothing produces it. When a new PRD arrives, the architecture \
must be refined to accommodate new requirements before planning and implementation \
can begin. Without M6-ARFN, architecture refinement happens implicitly during \
implementation — producing undocumented architectural decisions, inconsistent \
patterns, and drift that M4-DDAG later detects but cannot prevent.`,
    how: `Four linear steps: assess (identify architectural impact of new requirements) -> \
analyze (evaluate trade-offs and design options) -> specify (produce/update \
focused architecture spec files) -> validate (verify consistency and coverage).`,
    when_to_use: [
      "A new PRD or PRDSection requires changes to the system architecture",
      "Existing architecture docs are stale and need updating before implementation",
      "M5-PLAN or M1-IMPL needs an ArchDoc that doesn't yet reflect current requirements",
      "M4-DDAG identified architectural drift that needs formal specification update",
    ],
    when_not_to_use: [
      "Greenfield architecture design with no existing codebase — outside P2-SD niche",
      "The architecture is unchanged by the new PRD — pass ArchDoc directly to M5-PLAN",
      "The task is implementation, not specification — use M1-IMPL or M2-DIMPL",
      "Product discovery or PRD writing — outside P2-SD niche",
    ],
  },
  compilation_record: {
    gates: [
      {
        gate: "G0",
        result: "PASS",
        note: `Navigation complete. What: take PRD and existing architecture, produce focused \
ArchDoc spec files. Who: single architect role (specification only). Why: fills \
the ArchDoc production gap in P2-SD — no other method produces architecture specs. \
How: four-step linear path (assess, analyze, specify, validate). When_to_use: \
new PRD requiring architecture changes. When_not_to_use: greenfield design, \
unchanged architecture, implementation tasks.`,
      },
      {
        gate: "G1",
        result: "PASS",
        note: `D_ARFN = (Sigma_ARFN, Ax_ARFN). 8 sorts with cardinality, 3 total function \
symbols with totality declarations, 7 predicates with typed signatures \
referencing only declared sorts (PRDInput, ExistingArchitecture, ArchImpact, \
DesignOption, ArchDecision, ArchSpecFile, ArchDoc, ConsistencyCheck — all \
declared). The focused predicate (used in Ax-4) is declared with signature \
ArchSpecFile -> Bool. 4 closed axioms (Ax-1 through Ax-4) with rationale. \
Domain boundary stated. Initial and terminal state membership in Mod(D_ARFN) \
claimed with axiom-by-axiom verification for both.`,
      },
      {
        gate: "G2",
        result: "PASS",
        note: `O_ARFN stated as conjunction of Sigma-predicates (impact_resolved, \
rationale_documented, internally_consistent, spec_updated, focused — all \
declared). Expressibility claim present: all symbols in Sigma_ARFN, O_ARFN is \
a closed sentence over Mod(D_ARFN). Type: terminal. Progress preorder declared \
with well-foundedness argument (finite impact set, monotonic progress). Two \
measures (mu_resolution, mu_consistency) with formulas, ranges, terminal values, \
and proxy claims. All measure formulas reference only declared Sigma symbols.`,
      },
      {
        gate: "G3",
        result: "PASS",
        note: `One role (architect) with identity observation projection and explicit authorized \
transitions covering all four steps. Not_authorized list present with 4 items. \
Coverage claim: trivially total (identity projection, pi_architect = id). \
Authority claim: all four steps authorized, no transition unauthorized. Role \
partition rationale: one role because no epistemic separation requirement — \
full context beneficial for specification. Override path to M1-COUNCIL documented.`,
      },
      {
        gate: "G4",
        result: "PASS",
        note: `Four steps (sigma_0, sigma_1, sigma_2, sigma_3) in path graph. Each step has \
pre/post conditions, finalized guidance with constraints-first format, typed \
output_schema with required fields, and invariants (hard + soft). Three \
composability claims (sigma_0->sigma_1, sigma_1->sigma_2, sigma_2->sigma_3). \
Terminal and initial condition claims present. Contrarian challenge on \
sigma_1->sigma_2 edge: semantic adequacy of rationale_documented; defended by \
explicit trade-off fields, downstream consistency validation, and consumer-side \
validation. Formal DAG declared with topology and formal tuple.`,
      },
      {
        gate: "G5",
        result: "PASS",
        note: `All four steps have finalized guidance in constraints-first format. Each guidance \
block explicitly names all output_schema fields. Adequacy spot-check: sigma_0 \
names impacts, existing_architecture_summary; sigma_1 names decisions; sigma_2 \
names spec_files, readme_updated; sigma_3 names consistency_result, inconsistencies, \
breaking_changes, coverage_verified. All fields covered.`,
      },
      {
        gate: "G6",
        result: "PASS",
        note: "This compilation record. All gates G0-G5 passed. File: P2-SD/M6-ARFN/M6-ARFN.yaml. Structurally complete.",
      },
    ],
  },
};

// ── M7-PRDS ──

export const M7_PRDS_META: MethodMetadata = {
  id: "M7-PRDS",
  parent: "P2-SD",
  name: "PRD Sectioning Method",
  description: `Takes a full PRD and decomposes it into plannable PRDSections — scoped, ordered \
units that M5-PLAN can consume individually. Identifies dependencies between \
sections, proposes a delivery ordering, and produces a SectionMap that serves \
as the roadmap for iterative plan-implement-review cycles.`,
  version: "1.0",
  status: "compiled",
  compilation_date: "2026-03-14",
  formal_grounding: "theory/F1-FTH.md",
  navigation: {
    what: `M7-PRDS takes a full PRD document and produces a SectionMap: a list of PRDSections \
with dependency edges and a proposed delivery ordering. Each PRDSection is a scoped, \
self-contained unit that M5-PLAN can turn into a PhaseDoc. Output satisfies O_PRDS: \
all PRD content is covered, dependencies are explicit, and ordering respects \
dependencies.`,
    who: `One role — the sectioner. The executing agent (human or LLM) reads the PRD and \
existing architecture docs. Produces the decomposition. Does not plan or \
implement — only sections.`,
    why: `M5-PLAN takes a PRDSection as input, but PRDs are typically monolithic documents \
covering multiple features, domains, and delivery phases. Without explicit \
sectioning, the boundary-drawing happens implicitly during planning — producing \
inconsistent scope, missed features, and cross-section dependencies that surface \
mid-implementation. M7-PRDS makes the decomposition explicit and auditable.`,
    how: `Three linear steps: analyze (read PRD, identify feature clusters) -> decompose \
(produce PRDSections with boundaries, dependencies, acceptance criteria per section) \
-> order (topological sort on dependency graph, produce delivery sequence). \
Path graph — no branching, no loops.`,
    when_to_use: [
      "A full PRD exists and needs to be broken into plannable phases",
      "The PRD covers multiple features or domains that should be delivered incrementally",
      "The delivery team needs a roadmap before invoking M5-PLAN",
    ],
    when_not_to_use: [
      "The PRD is already a single section — pass directly to M5-PLAN",
      "The task is to write the PRD — that is product discovery, outside P2-SD scope",
      "The task is to plan a single section — use M5-PLAN directly",
    ],
  },
  compilation_record: {
    gates: [
      {
        gate: "G0",
        result: "PASS",
        note: `Navigation complete. What: decompose PRD into SectionMap with dependency-ordered \
PRDSections. Who: single sectioner role. Why: implicit sectioning during planning \
causes inconsistent scope and missed features. How: three-step linear path \
(analyze, decompose, order). When to use: multi-feature PRD needing phased delivery. \
When not to use: single-section PRD, PRD writing, single-section planning.`,
      },
      {
        gate: "G1",
        result: "PASS",
        note: `D_PRDS = (Sigma_PRDS, Ax_PRDS). 6 sorts with cardinality (PRD, FeatureCluster, \
PRDSection, Dependency, SectionMap, ArchDoc). 3 function symbols with totality \
(section_count, depends_on, order — order added to close Ax-5 reference). \
7 predicates with typed signatures referencing ONLY declared sorts: covers(SectionMap x PRD), \
scoped(PRDSection), has_acceptance_criteria(PRDSection), dependency_acyclic(SectionMap), \
ordering_valid(SectionMap), section_of(PRDSection x SectionMap), \
cluster_of(FeatureCluster x PRD). 5 closed axioms (Ax-1 through Ax-5) with \
rationale. Domain boundary stated. Initial and terminal state membership in \
Mod(D_PRDS) claimed with axiom-by-axiom verification for both states.`,
      },
      {
        gate: "G2",
        result: "PASS",
        note: `O_PRDS stated as conjunction of Sigma-predicates (covers, dependency_acyclic, \
ordering_valid, scoped, has_acceptance_criteria, section_of). Expressibility \
claim present — all six predicates declared in Sigma_PRDS. type: terminal. \
Progress preorder declared with well-foundedness argument (finite lattice over \
bounded section and requirement counts). Three measures (mu_coverage, mu_scoping, \
mu_dag_validity) each with formula, range, terminal value, and proxy claim. All \
measure formulas reference only declared Sigma_PRDS symbols.`,
      },
      {
        gate: "G3",
        result: "PASS",
        note: `One role (sectioner) with identity observation projection and explicit authorized \
transitions (sigma_0, sigma_1, sigma_2). Coverage claim: trivially total — \
identity projection names all sorts, predicates, and function symbols. Authority \
claim: all three steps authorized, no required transition unauthorized. Not \
authorized list present (4 items). Role partition rationale: one role because \
PRD sectioning is single-perspective analytical work with no epistemic separation \
requirement.`,
      },
      {
        gate: "G4",
        result: "PASS",
        note: `Three steps (sigma_0, sigma_1, sigma_2) in path graph. Formal DAG declaration \
present: Gamma_PRDS with vertices, edges, init, term. Each step has pre, post, \
finalized guidance, typed output_schema with invariants (hard + soft). Two \
composability claims (sigma_0->sigma_1: identity inclusion; sigma_1->sigma_2: \
identity inclusion). Terminal condition claim present (post_sigma_2 = O_PRDS). \
Initial condition claim present (PRD and ArchDocs available at session start). \
Contrarian challenge on sigma_1->sigma_2 edge: semantic vs syntactic coverage \
accuracy; defended by scope_boundary/requirements_covered auditability.`,
      },
      {
        gate: "G5",
        result: "PASS",
        note: `All three steps have finalized guidance in constraints-first format. Adequacy \
spot-check: sigma_0 guidance names feature_clusters and architecture_context; \
sigma_1 guidance names sections, coverage_verified, and deferred_requirements; \
sigma_2 guidance names dependencies, delivery_order, and section_map. All \
output_schema fields covered by name in guidance blocks. Each guidance block \
follows constraints-first format (Constraints, Rationale, Procedure, Output \
schema reference).`,
      },
      {
        gate: "G6",
        result: "PASS",
        note: "This file (P2-SD/M7-PRDS/M7-PRDS.yaml). Structurally complete.",
      },
    ],
  },
};
