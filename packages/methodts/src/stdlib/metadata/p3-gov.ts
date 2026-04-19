// SPDX-License-Identifier: Apache-2.0
import type { MethodologyMetadata, MethodMetadata } from "../metadata-types.js";

export const P3_GOV_META: MethodologyMetadata = {
  id: "P3-GOV",
  name: "Governance Methodology",
  description: `\
Pipeline methodology whose transition function tracks RFC lifecycle through \
governance review stages. Receives identified gaps as input, produces \
human-approved commissions as output. Two output classes: (1) internal \
decisions — automated under M2-SEMIAUTO with escalation on ambiguity/essence, \
(2) RFCs — always require human approval before action. The RFC is the primary \
artifact that crosses the governance-execution boundary.`,
  version: "0.1",
  status: "draft",
  compilation_date: "2026-03-17",
  niche: `\
Formal governance of changes to shared artifacts: registry methods, formal theory, \
architecture decisions, governance rules, and cross-domain concerns. Produces RFCs \
as the primary artifact. Human approves final RFC; another methodology (P2-SD, \
P1-EXEC) executes it. Excludes: gap identification (happens in M1-COUNCIL via \
P1-EXEC), execution of approved changes, domain-internal decisions that don't \
touch shared artifacts.`,
  navigation: {
    what: `\
P3-GOV receives an identified gap or opportunity that requires formal governance \
review, and routes it through the RFC lifecycle: drafting, domain review, steering \
review, human approval, and handoff to an execution methodology. It does not \
identify gaps (that happens in council sessions via P1-EXEC) and does not execute \
approved changes (that happens via P2-SD or P1-EXEC).`,
    who: `\
Three role types: rho_governance (the agent managing RFC lifecycle — evaluates \
delta_GOV, dispatches methods), rho_council (council members who draft and review \
RFCs — varies per method invocation), rho_PO (the human — approves or rejects \
governance-approved RFCs, has veto authority).`,
    why: `\
Without formal governance, changes to shared artifacts (registry, theory, \
architecture) happen ad hoc. AG-035 demonstrated this: PRD 010 was implemented \
outside governance visibility, creating a stale agenda item. P3-GOV links \
governance decisions to implementation through the RFC pipeline. Ax-GOV-1 (human \
gate) ensures nothing changes without human approval — making autonomous governance \
safe because decisions are automated but actions are gated.`,
    how: `\
Evaluate the RFC's current status via delta_GOV. Route to the appropriate method: \
M1-DRAFT for drafting/revision, M2-REVIEW for council review (parameterized for \
domain vs steering), M3-APPROVE for human approval, M4-HANDOFF for commission \
generation. The RFC's status field drives all routing decisions.`,
    when_to_invoke: [
      "A council session identifies a gap that requires formal review (changes to registry, theory, architecture, governance)",
      "An RFC exists and needs to advance through the review pipeline",
      "A retrospective signal suggests a change that crosses domain boundaries",
    ],
    when_not_to_invoke: [
      "Domain-internal decisions that don't touch shared artifacts — use council sessions directly",
      "Bug fixes, documentation updates, test additions — these don't meet RFC threshold",
      "Execution of approved changes — use P2-SD or P1-EXEC",
      "Gap identification — use M1-COUNCIL via P1-EXEC",
    ],
  },
  compilation_record: {
    gates: [
      {
        gate: "G0",
        result: "PASS",
        note: `\
Navigation complete. What: pipeline methodology routing RFCs through governance \
lifecycle. Who: governance agent + council members + human PO. Why: ad-hoc \
changes to shared artifacts bypass governance (AG-035 case study). How: evaluate \
RFC status -> apply delta_GOV -> dispatch method. When: gap identified that \
meets RFC threshold.`,
      },
      {
        gate: "G1",
        result: "PASS",
        note: `\
D_Phi_GOV = (Sigma_Phi_GOV, Ax_Phi_GOV). 9 sorts with cardinality. 6 function \
symbols with totality. 11 predicates with typed signatures referencing declared \
sorts. 8 closed axioms (Ax-GOV-0 through Ax-GOV-7) with tier classification \
(constitutional/statutory). Axiom tier system with self-protection (Ax-GOV-0). Domain \
boundary stated. Initial and terminal state membership claimed with axiom-by- \
axiom verification.`,
      },
      {
        gate: "G2",
        result: "PASS",
        note: `\
O_Phi_GOV stated as disjunction of three conditions (handed_off + commission_ready, \
rejected, withdrawn). Type: terminal. Expressibility claim present. Progress \
preorder as 7-state chain with terminal shortcuts. Three measures (mu_1 pipeline \
progress, mu_2 review coverage, mu_3 governance completion).`,
      },
      {
        gate: "G3",
        result: "PASS",
        note: `\
Three roles (rho_governance, rho_council, rho_PO) with observation projections \
and explicit authorized/not-authorized transitions. Coverage claim: pi_governance \
is identity (full coverage). Authority claim: union covers all transitions. \
Role partition rationale: three roles because governance has three distinct \
authority boundaries (lifecycle management, content/review, approval).`,
      },
      {
        gate: "G4",
        result: "PASS",
        note: `\
delta_GOV declared as 11-arm status-driven condition table. Completeness claim \
present (partitions by Phase values). Termination certificate nu_GOV with \
revision-bounded decrease witness. Four retraction pairs declared at type level \
(W2: not yet verified — requires method domain theories). Method YAMLs not \
yet compiled (W1).`,
      },
      {
        gate: "G5",
        result: "PASS",
        note: `\
Predicate operationalization deferred until method YAMLs are compiled. \
Phase transition predicates (well_formed, fully_reviewed, etc.) need \
concrete True/False criteria from M1-DRAFT and M2-REVIEW domain theories.`,
      },
      {
        gate: "G6",
        result: "PASS",
        note: "This file (P3-GOV/P3-GOV.yaml). Structurally complete.",
      },
    ],
  },
  known_wip: [
    {
      id: "W1",
      status: "open",
      description: `\
Method YAMLs (M1-DRAFT, M2-REVIEW, M3-APPROVE, M4-HANDOFF) not yet compiled. \
P3-GOV.yaml declares the methodology coalgebra; the 4 methods need individual \
compilation following M1-MDES gate structure and F4-PHI schema. Commission \
planned (D-054).`,
    },
    {
      id: "W2",
      status: "open",
      description: `\
Retraction pairs RP-GOV-1 through RP-GOV-4 are declared at type level but not \
formally verified. Method domain theories (D_DRAFT, D_REVIEW, D_APPROVE, \
D_HANDOFF) must be compiled first; then retraction conditions can be verified.`,
    },
    {
      id: "W3",
      status: "open",
      description: `\
M2-REVIEW inherits M1-COUNCIL axioms (Ax-3 through Ax-7) via signature inclusion \
(D-053). The formal signature inclusion from Sigma_COUNCIL into Sigma_REVIEW has \
not yet been spelled out. Required during M2-REVIEW compilation.`,
    },
    {
      id: "W4",
      status: "open",
      description: `\
P3-GOV's interaction model with P1-EXEC and P2-SD is not formalized. They are \
peer program methodologies — the human chooses when to invoke governance vs \
execution. No formal routing between them exists yet.`,
    },
    {
      id: "W5",
      status: "resolved",
      description: `\
RESOLVED (D-058): Added Ax-GOV-6 (entry threshold) as a meta-axiom referencing \
the project card's rfc_threshold field. The threshold criteria are project-level, \
not methodology-level. Remaining work: add rfc_threshold field to PROJECT-CARD-SCHEMA.`,
    },
    {
      id: "W6",
      status: "open",
      description: `\
P3-GOV processes one RFC per pipeline run (RFC sort: singleton_per_pipeline_run). \
Concurrent RFCs require multiple P3-GOV invocations, each tracking one RFC \
independently. The methodology does not model RFC concurrency — the orchestrator \
(human or dispatch agent) manages multiple pipeline runs. Same pattern as P2-SD.`,
    },
    {
      id: "W7",
      status: "open",
      description: `\
M2-REVIEW should delegate its debate step (sigma_2) to M1-COUNCIL via domain \
retraction (F1-FTH Definition 6.3), not reimplement the debate. Axioms inherited \
via signature inclusion (D-053); execution delegated via retraction. M2-REVIEW is \
an adapter that adds RFC-specific framing and verdict production around M1-COUNCIL's \
debate capability. Apply during M2-REVIEW compilation. Contrarian review finding.`,
    },
    {
      id: "W8",
      status: "open",
      description: `\
Enforcement gap roadmap (from contrarian review + ov-research enforcement-loop.md). \
P3-GOV currently has 2 of 4 enforcement layers: Protocol (P3-GOV.yaml) and \
Workflow (/steering-council skill). Missing: Tool (rfc_advance MCP tool that checks \
axioms before allowing status transitions) and Verify (postcondition validation on \
each transition). PRD needed if cooperative compliance proves insufficient.`,
    },
  ],
};

export const M1_DRAFT_META: MethodMetadata = {
  id: "M1-DRAFT",
  parent: "P3-GOV",
  name: "RFC Drafting Method",
  description: `\
Receives a gap description (or an existing RFC in revision mode) and produces a \
well-formed RFC per RFC-SCHEMA. Two modes: initial drafting (gap -> RFC) and revision \
(existing RFC + review feedback -> revised RFC). The RFC is the primary artifact that \
crosses the governance-execution boundary — it must be precise enough for council \
review and human approval.`,
  version: "0.1",
  status: "draft",
  compilation_date: "2026-03-18",
  formal_grounding: "theory/F1-FTH.md",
  navigation: {
    what: `\
M1-DRAFT takes an identified gap or opportunity (from a council session via P1-EXEC) \
and produces a well-formed RFC conforming to RFC-SCHEMA. In revision mode, it receives \
an existing RFC with review feedback and produces a revised RFC addressing the feedback. \
Output: a single RFC YAML artifact with all required fields populated.`,
    who: `\
rho_drafter (specialized from rho_council): the agent drafting the RFC. May consult \
domain expertise but produces a single-author RFC. The drafter operates under \
pi_council observation projection — sees the gap description and RFC-SCHEMA but not \
other councils' pending reviews.`,
    why: `\
The RFC is the control artifact of P3-GOV — every downstream method (review, approval, \
handoff) operates on it. A poorly drafted RFC wastes council review cycles and may \
pass governance review despite being imprecise. M1-DRAFT ensures the RFC meets \
structural and content quality gates before entering the review pipeline.`,
    how: `\
Three-step linear DAG: sigma_0 (analyze gap and frame the RFC), sigma_1 (draft RFC \
fields per RFC-SCHEMA), sigma_2 (validate well-formedness and produce final artifact). \
In revision mode, sigma_0 additionally ingests review feedback and the existing RFC.`,
    when_to_invoke: [
      "A gap has been identified that meets the project's RFC threshold (Ax-GOV-6)",
      "A review has requested changes (revision mode) — revision_count < max_revisions",
    ],
    when_not_to_invoke: [
      "The gap does not meet RFC threshold — handle via normal council sessions",
      "An RFC already exists and needs review, not drafting — use M2-REVIEW",
      "revision_limit_reached — RFC should be auto-rejected per Ax-GOV-5",
    ],
  },
  compilation_record: {
    gates: [
      {
        gate: "G0",
        result: "PASS",
        note: `\
Navigation complete. What: RFC drafting from gap description. Who: rho_drafter \
(specialized from rho_council). Why: well-formed RFCs prevent review cycle waste. \
How: three-step linear DAG (analyze, compose, validate). When: gap meets RFC \
threshold or revision requested.`,
      },
      {
        gate: "G1",
        result: "PASS",
        note: `\
D_DRAFT inherits from D_Phi_GOV. 6 sorts (3 inherited, 3 new), 3 function \
symbols, 5 predicates (1 inherited with operationalization), 3 axioms. \
Domain boundary stated. well_formed operationalized with 10 concrete checks \
per RFC-SCHEMA.`,
      },
      {
        gate: "G2",
        result: "PASS",
        note: `\
O_DRAFT stated as conjunction of well_formed, feedback coverage, and threshold. \
Expressibility claim present. Progress preorder over 3-step DAG. Two measures \
(field_completeness, feedback_coverage).`,
      },
      {
        gate: "G3",
        result: "PASS",
        note: `\
One role (rho_drafter, specializing rho_council). Full coverage of D_DRAFT. \
Authority covers all transitions from initial to terminal state. Single-role \
method — coverage and authority are trivial.`,
      },
      {
        gate: "G4",
        result: "PASS",
        note: `\
Three steps in linear DAG. Three composability claims including terminal \
condition. Initial condition claim references RP-GOV-1 embed. Contrarian \
challenge on sigma_1 -> sigma_2 (content quality) defended by sigma_2's \
validation-and-fix design. Termination certificate: linear DAG, bounded \
internal fix loop.`,
      },
      {
        gate: "G5",
        result: "PASS",
        note: `\
All three steps have constraints-first guidance. Each guidance block covers \
all output_schema fields by name. sigma_0 guidance includes revision mode \
handling. sigma_2 guidance includes all 10 well-formedness checks enumerated.`,
      },
      {
        gate: "G6",
        result: "PASS",
        note: "This file (P3-GOV/M1-DRAFT/M1-DRAFT.yaml). Structurally complete.",
      },
    ],
  },
};

export const M2_REVIEW_GOV_META: MethodMetadata = {
  id: "M2-REVIEW",
  parent: "P3-GOV",
  name: "Council Review Method",
  description: `\
Receives a well-formed RFC and produces a review verdict. Parameterized for domain \
review (review_type = domain) or steering review (review_type = steering). The debate \
step (sigma_2) delegates to M1-COUNCIL via domain retraction (F1-FTH Definition 6.3) \
— M2-REVIEW is an adapter that adds RFC-specific framing and verdict production \
around M1-COUNCIL's debate capability. M1-COUNCIL axioms (Ax-3 through Ax-7) are \
inherited via signature inclusion (D-053), not duplicated.`,
  version: "0.2",
  status: "draft",
  compilation_date: "2026-03-19",
  formal_grounding: "theory/F1-FTH.md",
  navigation: {
    what: `\
M2-REVIEW takes a well-formed RFC and produces a ReviewVerdict (approve, \
approve_with_conditions, request_changes, block). The review is conducted by a \
council whose debate is managed by M1-COUNCIL (delegated via retraction). M2-REVIEW \
adds three capabilities around M1-COUNCIL: (1) RFC-specific framing using the 5-layer \
model, (2) parameterized behavior for domain vs steering review, (3) verdict \
production with aggregation rules.`,
    who: `\
rho_reviewer (specialized from rho_council): the reviewing council. In domain review \
mode, this is a domain-specific council (theory, implementation, quality). In steering \
review mode, this is the steering council with mandatory essence check authority. \
The council's internal structure (Leader + Contrarians + PO) is managed by M1-COUNCIL.`,
    why: `\
RFC quality depends on adversarial review — a single reviewer produces approval bias. \
M1-COUNCIL already provides the adversarial debate mechanism with anti-capitulation \
axioms (Ax-3, Ax-4). M2-REVIEW reuses that capability rather than reimplementing it, \
adding only the RFC-specific framing and verdict extraction that M1-COUNCIL lacks. \
This respects the DRY principle at the methodology level and ensures debate quality \
is consistent across all uses of M1-COUNCIL.`,
    how: `\
Four-step linear DAG: sigma_0 (RFC intake and framing per 5-layer model), sigma_1 \
(council setup — cast design for the RFC's domain), sigma_2 (debate via M1-COUNCIL \
delegation), sigma_3 (verdict production and aggregation). sigma_2 is a delegation \
step — it embeds into M1-COUNCIL's domain and projects back the debate results.`,
    when_to_invoke: [
      "A well-formed RFC needs domain review (first_domain_review or next_domain_review arm)",
      "All domain reviews are complete and steering review is needed (steering_review arm)",
    ],
    when_not_to_invoke: [
      "The RFC is not well-formed — send back to M1-DRAFT",
      "The RFC has already been reviewed by this council",
      "The RFC is in a terminal state (accepted, rejected, withdrawn)",
    ],
  },
  compilation_record: {
    gates: [
      {
        gate: "G0",
        result: "PASS",
        note: `\
Navigation complete. What: RFC review producing ReviewVerdict via council debate. \
Who: rho_reviewer (domain or steering council). Why: adversarial review prevents \
approval bias; delegates to M1-COUNCIL for debate quality. How: 4-step DAG with \
sigma_2 delegation to M1-COUNCIL. When: well-formed RFC needs domain or steering \
review.`,
      },
      {
        gate: "G1",
        result: "PASS",
        note: `\
D_REVIEW inherits from D_Phi_GOV with M1-COUNCIL signature inclusion (D-053). \
8 sorts (5 inherited, 3 new), 4 function symbols (2 inherited), 8 predicates \
(4 inherited). 4 method-level axioms. M1-COUNCIL axioms inherited via delegation, \
not duplicated (W7). Domain boundary stated.`,
      },
      {
        gate: "G2",
        result: "PASS",
        note: `\
O_REVIEW stated as conjunction of verdict_produced, essence_checked (conditional), \
debate_complete, reviewed_by. Expressibility claim present. Progress preorder over \
4-step DAG. Two measures (review_progress, debate_quality delegated to M1-COUNCIL).`,
      },
      {
        gate: "G3",
        result: "PASS",
        note: `\
One role (rho_reviewer, specializing rho_council). Full coverage of D_REVIEW \
with documented anti-anchoring observability constraint. Authority covers all \
transitions including M1-COUNCIL delegation.`,
      },
      {
        gate: "G4",
        result: "PASS",
        note: `\
Four steps in linear DAG. sigma_2 is a PAT-003 declared delegation to M1-COUNCIL \
with explicit retraction pair RP-REVIEW-COUNCIL. Four composability claims including \
terminal condition. Initial condition references RP-GOV-2 embed. Contrarian challenge \
on sigma_2 -> sigma_3 (verdict extraction from debate) defended by sigma_0 framing. \
Termination: linear DAG composed with M1-COUNCIL's bounded termination.`,
      },
      {
        gate: "G5",
        result: "PASS",
        note: `\
All four steps have constraints-first guidance. sigma_0 implements 5-layer framing \
(S030). sigma_2 documents the delegation mechanism with embed/project definitions. \
sigma_3 includes verdict extraction rules, aggregation rules (Ax-GOV-7), and \
essence check procedure (Ax-GOV-3). max_rounds parameter documented (S030).`,
      },
      {
        gate: "G6",
        result: "PASS",
        note: "This file (P3-GOV/M2-REVIEW/M2-REVIEW.yaml). Structurally complete.",
      },
    ],
  },
};

export const M3_APPROVE_META: MethodMetadata = {
  id: "M3-APPROVE",
  parent: "P3-GOV",
  name: "Human Approval Method",
  description: `\
Presents a governance-approved RFC to the human Product Owner with the complete review \
package (all reviews, essence check, minority positions) and records the human's \
decision. Implements Ax-GOV-1 (human gate) — the constitutional axiom that no RFC \
reaches execution without explicit human approval. This is the safety-critical method \
in P3-GOV: it is the boundary between autonomous governance and authorized action.`,
  version: "0.1",
  status: "draft",
  compilation_date: "2026-03-18",
  formal_grounding: "theory/F1-FTH.md",
  navigation: {
    what: `\
M3-APPROVE takes a governance-approved RFC (status = accepted after steering review) \
and presents it to the human PO with the full review package. The human makes one of \
three decisions: approve (proceed to commission), reject (terminate pipeline), or \
request_changes (send back to M1-DRAFT for revision). The method records the decision \
with rationale and updates the RFC status accordingly.`,
    who: `\
Two roles: rho_presenter (the agent preparing and presenting the review package) and \
rho_PO (the human, final decision authority). The agent role is minimal — it assembles \
information for the human, it does not influence the decision.`,
    why: `\
Ax-GOV-1 is the foundational safety axiom of P3-GOV. Without the human gate, autonomous \
councils could approve and execute changes to shared artifacts without human awareness. \
M3-APPROVE makes the human gate operational: it ensures the human sees everything \
relevant (reviews, essence check, minority positions), records the decision formally, \
and translates the decision into a status transition that P3-GOV's delta_GOV can route.`,
    how: `\
Three-step linear DAG: sigma_0 (assemble review package), sigma_1 (present to human \
and record decision), sigma_2 (validate decision and produce status transition).`,
    when_to_invoke: [
      "An RFC has status = accepted (governance-approved by steering review)",
    ],
    when_not_to_invoke: [
      "The RFC has not completed steering review — use M2-REVIEW first",
      "The RFC has already been approved or rejected by the human",
      "The RFC is in revision_requested state — use M1-DRAFT for revision",
    ],
  },
  compilation_record: {
    gates: [
      {
        gate: "G0",
        result: "PASS",
        note: `\
Navigation complete. What: present governance-approved RFC to human, record decision. \
Who: rho_presenter (agent) + rho_PO (human). Why: Ax-GOV-1 (human gate) enforcement. \
How: 3-step linear DAG (assemble, present, validate). When: RFC has status = accepted.`,
      },
      {
        gate: "G1",
        result: "PASS",
        note: `\
D_APPROVE inherits from D_Phi_GOV. 5 sorts (3 inherited, 2 new), 2 function \
symbols (partial — populated after human decides), 7 predicates (3 inherited). \
3 axioms enforcing human gate, complete information, and decision authority. \
Domain boundary stated.`,
      },
      {
        gate: "G2",
        result: "PASS",
        note: `\
O_APPROVE stated as conjunction of decision_recorded, package_assembled, \
all_reviews_included, decision source. Expressibility claim present (with \
meta-level note on source). Progress preorder over 3-step DAG. Two measures \
(package_completeness, decision_recorded binary).`,
      },
      {
        gate: "G3",
        result: "PASS",
        note: `\
Two roles: rho_presenter (agent, assembles and records) and rho_PO (human, \
decides). Clear authority separation — agent cannot decide, human cannot \
be bypassed. Coverage: both roles have full visibility. Authority: union \
covers all transitions.`,
      },
      {
        gate: "G4",
        result: "PASS",
        note: `\
Three steps in linear DAG. Three composability claims including terminal \
condition. Initial condition references RP-GOV-3 embed. Contrarian challenge \
on sigma_0 -> sigma_1 (human engagement quality) defended by complete \
information guarantee (Ax-APPROVE-2). Termination: linear DAG, no loops, \
exactly 3 steps.`,
      },
      {
        gate: "G5",
        result: "PASS",
        note: `\
All three steps have constraints-first guidance. sigma_0 covers all review \
package components. sigma_1 includes explicit anti-influence rules for the \
agent. sigma_2 includes deterministic decision-to-status mapping.`,
      },
      {
        gate: "G6",
        result: "PASS",
        note: "This file (P3-GOV/M3-APPROVE/M3-APPROVE.yaml). Structurally complete.",
      },
    ],
  },
};

export const M4_HANDOFF_META: MethodMetadata = {
  id: "M4-HANDOFF",
  parent: "P3-GOV",
  name: "Commission Handoff Method",
  description: `\
Generates an actionable commission from a human-approved RFC with full governance \
context. The commission is the output artifact of P3-GOV — it crosses the boundary \
from governance to execution. The commission is designed for consumption by another \
methodology (P2-SD or P1-EXEC) and includes governance traceability: which councils \
reviewed, what conditions were set, what the human approved, and what constraints \
the executing agent must respect.`,
  version: "0.1",
  status: "draft",
  compilation_date: "2026-03-18",
  formal_grounding: "theory/F1-FTH.md",
  navigation: {
    what: `\
M4-HANDOFF takes a human-approved RFC and produces a commission: a structured \
prompt for a fresh agent session that will execute the approved change via P2-SD \
or P1-EXEC. The commission includes the RFC content, governance context (reviews, \
conditions, essence check), execution constraints, and traceability references. \
The commission is ready for the human to fire — M4-HANDOFF does not execute it.`,
    who: `\
rho_commission_author (specialized from rho_governance): the agent generating the \
commission. Operates under full D_Phi_GOV visibility to include all governance \
context in the commission.`,
    why: `\
The commission is the governance-execution boundary artifact. Without it, approved \
RFCs sit in accepted state indefinitely — the decision was made but no one acts on \
it. A well-structured commission ensures: (1) the executing agent has all context \
needed, (2) governance conditions are carried into execution as constraints, \
(3) the human can trace from commission back to RFC, reviews, and approval.`,
    how: `\
Three-step linear DAG: sigma_0 (extract execution requirements from RFC and reviews), \
sigma_1 (compose commission with governance context and constraints), sigma_2 \
(validate commission completeness and produce final artifact).`,
    when_to_invoke: [
      "An RFC has status = human_approved (human has approved the RFC for execution)",
    ],
    when_not_to_invoke: [
      "The RFC has not been human-approved — use M3-APPROVE first",
      "The RFC was rejected or withdrawn — pipeline terminates, no commission needed",
      "The commission has already been generated for this RFC",
    ],
  },
  compilation_record: {
    gates: [
      {
        gate: "G0",
        result: "PASS",
        note: `\
Navigation complete. What: generate actionable commission from human-approved RFC. \
Who: rho_commission_author (specialized from rho_governance). Why: governance \
decisions need translation to execution instructions with traceability. \
How: 3-step linear DAG (extract, compose, validate). When: RFC has status = \
human_approved.`,
      },
      {
        gate: "G1",
        result: "PASS",
        note: `\
D_HANDOFF inherits from D_Phi_GOV. 5 sorts (3 inherited, 2 new), 2 function \
symbols, 6 predicates (2 inherited). 3 axioms enforcing commission completeness, \
condition carriage, and traceability. Domain boundary stated.`,
      },
      {
        gate: "G2",
        result: "PASS",
        note: `\
O_HANDOFF stated as conjunction of commission_ready, commission_composed, \
conditions_carried, traceability_complete. Expressibility claim present. \
Progress preorder over 3-step DAG. Two measures (requirement_coverage, \
commission_completeness binary).`,
      },
      {
        gate: "G3",
        result: "PASS",
        note: `\
One role (rho_commission_author, specializing rho_governance). Full visibility \
(identity projection inherited from pi_governance). Authority covers all \
transitions from initial to terminal state.`,
      },
      {
        gate: "G4",
        result: "PASS",
        note: `\
Three steps in linear DAG. Three composability claims including terminal \
condition. Initial condition references RP-GOV-4 embed. Contrarian challenge \
on sigma_1 -> sigma_2 (commission format compatibility with target methodology) \
acknowledged as open (W4) but pragmatically addressed. Termination: linear \
DAG with bounded internal fix loop.`,
      },
      {
        gate: "G5",
        result: "PASS",
        note: `\
All three steps have constraints-first guidance. sigma_0 includes governance \
constraint extraction with specific axiom references. sigma_1 covers all 8 \
commission sections. sigma_2 includes 8 specific validation checks enumerated.`,
      },
      {
        gate: "G6",
        result: "PASS",
        note: "This file (P3-GOV/M4-HANDOFF/M4-HANDOFF.yaml). Structurally complete.",
      },
    ],
  },
};
