import type { MethodologyMetadata, MethodMetadata } from "../metadata-types.js";

export const P3_DISPATCH_META: MethodologyMetadata = {
  id: "P3-DISPATCH",
  name: "Dispatch Methodology",
  description: `\
P3-DISPATCH receives a target methodology, evaluates the requested autonomy mode, \
and routes to the appropriate dispatch method. It does not execute the target \
methodology's steps directly — it manages the orchestration lifecycle around them. \
Three autonomy modes map to three methods covering the full autonomy spectrum: \
human-in-the-loop, selective escalation, and unattended execution.`,
  version: "1.0",
  status: "compiled",
  compilation_date: "2026-03-14",
  niche: `\
Autonomy-aware orchestration of methodology execution. Given a target methodology \
(e.g., P2-SD) and a human-specified autonomy mode, P3-DISPATCH manages the execution \
lifecycle: routing, step execution via sub-agents, validation, retry, and escalation. \
Three autonomy modes cover the spectrum from full human control (INTERACTIVE) through \
selective escalation (SEMIAUTO) to unattended execution (FULLAUTO). Excludes: methodology \
design, method compilation, domain theory authoring, and the internal logic of the target \
methodology's methods.`,
  navigation: {
    what: `\
P3-DISPATCH receives a target methodology, evaluates the requested autonomy mode, \
and routes to the appropriate dispatch method. It does not execute the target \
methodology's steps directly — it manages the orchestration lifecycle around them. \
Three autonomy modes map to three methods covering the full autonomy spectrum: \
human-in-the-loop, selective escalation, and unattended execution.`,
    who: `\
The dispatch agent — an LLM agent that orchestrates methodology execution by spawning \
sub-agents for individual steps, collecting outputs, validating postconditions, and \
managing the human interaction boundary according to the selected autonomy mode.`,
    why: `\
Methodology execution requires different human-agent interaction patterns depending on \
context: exploratory work needs tight human control, well-understood pipelines benefit \
from autonomous execution, and most work falls between. Without explicit autonomy \
routing, agents either over-consult (blocking on every decision) or under-consult \
(making decisions outside their authority). delta_DISPATCH externalizes the autonomy \
decision into an auditable routing function.`,
    how: `\
Evaluate autonomy_mode(s) at initialization. Apply delta_DISPATCH (3-arm direct map). \
The selected method then manages the target methodology's execution lifecycle with the \
appropriate level of human interaction.`,
    when_to_use: [
      "A methodology needs to be executed and the human has specified an autonomy preference",
      "The executor needs to manage sub-agent spawning, validation, and retry logic",
      "The human wants explicit control over how much authority the agent has during execution",
    ],
    when_not_to_use: [
      "The target methodology is being designed or compiled — use M1-MDES",
      "The human wants to execute a method directly without orchestration",
      "No target methodology exists — P3-DISPATCH dispatches execution, not design",
      "The autonomy mode is already known and the method can be invoked directly",
    ],
  },
  compilation_record: {
    gates: [
      {
        gate: "G0",
        result: "PASS",
        note: `\
Navigation complete. What: 3-arm autonomy routing for methodology execution. \
Who: dispatch agent + human (PO or observer depending on mode). Why: wrong \
autonomy level degrades either quality (over-delegation) or throughput \
(over-consultation). How: evaluate autonomy_mode -> apply delta_DISPATCH -> \
dispatch. When: methodology execution with specified autonomy preference.`,
      },
      {
        gate: "G1",
        result: "PASS",
        note: `\
D_Phi_DISPATCH = (Sigma_Phi_DISPATCH, Ax_Phi_DISPATCH). 8 sorts with cardinality \
(TargetMethodology, TargetMethod, AutonomyMode with 3 values, DecisionPoint, \
EscalationChannel with 3 values, AgentSession, StepOutput, ValidationResult with \
2 values). 4 function symbols with totality. 6 predicates with typed signatures \
referencing declared sorts. 4 closed axioms (Ax-D1 through Ax-D4) with rationale. \
Domain boundary stated. Initial and terminal state membership claimed with \
axiom-by-axiom verification.`,
      },
      {
        gate: "G2",
        result: "PASS",
        note: `\
O_Phi_DISPATCH stated as disjunction of two Sigma-predicates (target_objective_met, \
session_aborted). Type: terminal. Expressibility claim present. Progress preorder \
inherits from target methodology. Two measures (mu_1, mu_2) with formulas, ranges, \
terminal values, and proxy claims.`,
      },
      {
        gate: "G3",
        result: "PASS",
        note: `\
Three roles (rho_executor, rho_PO, rho_observer) with observation projections and \
explicit authorized/not-authorized transitions. Coverage claim: pi_executor is \
identity (full coverage). Authority claim: union of role authorities covers all \
required transitions across all three autonomy modes. Role partition rationale: \
three roles because autonomy modes create genuinely different authority boundaries.`,
      },
      {
        gate: "G4",
        result: "PASS",
        note: `\
delta_DISPATCH declared as 3-arm direct map (INTERACTIVE, SEMIAUTO, FULLAUTO). \
Totality: three modes are mutually exclusive and exhaustive. Termination certificate \
nu_DISPATCH wraps nu_target — inherits from target methodology.`,
      },
      {
        gate: "G5",
        result: "PASS",
        note: `\
Three autonomy_mode values operationalized with True/False conditions and concrete \
criteria. INTERACTIVE: confirm every decision. SEMIAUTO: consult on ambiguous \
decisions. FULLAUTO: unattended with notification.`,
      },
      {
        gate: "G6",
        result: "PASS",
        note: "This file (P3-DISPATCH/P3-DISPATCH.yaml). Structurally complete.",
      },
    ],
  },
};

export const M1_INTERACTIVE_META: MethodMetadata = {
  id: "M1-INTERACTIVE",
  parent: "P3-DISPATCH",
  name: "Human-in-the-Loop Dispatch Method",
  description: `\
Interactive dispatch method where the human confirms every decision point. The agent \
executes methodology steps by spawning sub-agents but defers all routing, approval, \
and failure-handling decisions to the human. Appropriate for first-time methodology \
execution, unfamiliar codebases, or high-stakes changes.`,
  version: "1.0",
  status: "compiled",
  compilation_date: "2026-03-14",
  formal_grounding: "theory/F1-FTH.md",
  navigation: {
    what: `\
M1-INTERACTIVE manages methodology execution with full human oversight. For every \
step: load context, spawn a sub-agent, collect output, present to human, and wait \
for human decision (advance, retry, or abort). The agent is an executor — it performs \
mechanical work but makes no judgment calls.`,
    who: `\
Two roles: rho_executor (agent — executes but does not decide) and rho_PO (human — \
decides everything). The agent presents options and results; the human makes all \
choices.`,
    why: `\
First-time methodology execution or high-stakes work requires human confirmation at \
every decision point. Without explicit gating, agents make routing or advancement \
decisions that the human would have overridden. M1-INTERACTIVE makes every decision \
point visible and blocks on human input.`,
    how: `\
Five-step loop: load target routing -> initialize method session -> execute step -> \
validate and decide -> loop or complete. The human confirms routing (sigma_I1), reviews \
every step output (sigma_I3), and decides advance/retry/abort (sigma_I4).`,
    when_to_use: [
      "First time executing a given methodology",
      "Unfamiliar codebase or domain",
      "High-stakes changes where every step needs human review",
      "Debugging methodology execution (step-through mode)",
    ],
    when_not_to_use: [
      "Well-understood pipeline where human review adds no value — use SEMIAUTO or FULLAUTO",
      "Human is unavailable during execution — use FULLAUTO",
      "Batch processing with many independent runs — use FULLAUTO",
    ],
  },
  compilation_record: {
    gates: [
      {
        gate: "G0",
        result: "PASS",
        note: `\
Navigation complete. What: human-in-the-loop dispatch with full oversight. Who: \
executor (agent) and PO (human). Why: first-time or high-stakes execution needs \
human confirmation at every step. How: five-step loop with human gating. When: \
first methodology execution, unfamiliar codebase, high-stakes changes.`,
      },
      {
        gate: "G1",
        result: "PASS",
        note: `\
D_INTERACTIVE inherits D_Phi_DISPATCH. 2 additional sorts (HumanDecision, \
RoutingConfirmation). 2 additional predicates. 2 additional axioms (Ax-I1, Ax-I2).`,
      },
      {
        gate: "G2",
        result: "PASS",
        note: `\
O_INTERACTIVE stated. Progress preorder over confirmed steps. One measure \
(mu_steps_confirmed) with formula, range, terminal value, proxy claim.`,
      },
      {
        gate: "G3",
        result: "PASS",
        note: `\
Two roles (rho_executor, rho_PO) with observation projections and explicit \
authorized/not-authorized. Coverage and authority claims present.`,
      },
      {
        gate: "G4",
        result: "PASS",
        note: `\
Five steps (sigma_I1-sigma_I5) with loop edge sigma_I5 -> sigma_I3. Termination \
certificate nu_I over remaining steps. Five composability claims. Terminal and \
initial condition claims present.`,
      },
      {
        gate: "G5",
        result: "PASS",
        note: `\
All five steps have finalized guidance in constraints-first format. Each guidance \
block references MCP tools (methodology_get_routing, methodology_select, step_current, \
step_validate, step_advance). Output schemas with typed fields and hard invariants.`,
      },
      {
        gate: "G6",
        result: "PASS",
        note: "This file (P3-DISPATCH/M1-INTERACTIVE/M1-INTERACTIVE.yaml). Structurally complete.",
      },
    ],
  },
};

export const M2_SEMIAUTO_META: MethodMetadata = {
  id: "M2-SEMIAUTO",
  parent: "P3-DISPATCH",
  name: "Selective Escalation Dispatch Method",
  description: `\
Semi-autonomous dispatch method where the agent handles clear decisions autonomously \
and escalates ambiguous or failed decisions to the human. Appropriate for familiar \
methodologies where most steps are routine but some require judgment. Balances \
throughput (no blocking on clear cases) with safety (escalation on uncertainty).`,
  version: "1.0",
  status: "compiled",
  compilation_date: "2026-03-14",
  formal_grounding: "theory/F1-FTH.md",
  navigation: {
    what: `\
M2-SEMIAUTO manages methodology execution with conditional autonomy. The agent selects \
methods, advances steps, and retries failures autonomously when the situation is clear. \
When predicates are borderline, validation fails twice, or scope changes exceed \
thresholds, the agent escalates to the human. The human is consulted selectively, not \
at every decision point.`,
    who: `\
Two roles: rho_executor (agent — conditional authority, decides on clear cases) and \
rho_PO (human — escalation authority, decides on ambiguous cases). Authority boundary \
is defined by escalation triggers.`,
    why: `\
Most methodology steps are routine — the routing is clear, the output satisfies \
postconditions, and advancement is mechanical. Blocking on human confirmation for \
these cases wastes human attention without adding value. M2-SEMIAUTO reserves human \
attention for cases that genuinely need it: ambiguous routing, validation failures, \
and scope changes.`,
    how: `\
Six-step loop: load and route (with conditional escalation) -> initialize -> execute \
step -> validate (with auto-advance or escalation) -> scope check -> loop or complete. \
The agent auto-advances on clear PASS, retries once on failure, and escalates on \
second failure or ambiguity.`,
    when_to_use: [
      "Familiar methodology where most steps are routine",
      "Human wants to be consulted on edge cases but not on every step",
      "Moderate-risk work where full autonomy is too aggressive but full control is too slow",
    ],
    when_not_to_use: [
      "First-time methodology execution — use INTERACTIVE",
      "High-stakes changes requiring step-by-step human review — use INTERACTIVE",
      "Well-understood pipeline where no escalation is needed — use FULLAUTO",
      "Human is unavailable during execution — use FULLAUTO",
    ],
  },
  compilation_record: {
    gates: [
      {
        gate: "G0",
        result: "PASS",
        note: `\
Navigation complete. What: selective escalation dispatch with conditional autonomy. \
Who: executor (agent, conditional) and PO (human, escalation). Why: reserves human \
attention for cases that genuinely need it. How: six-step loop with auto-advance \
on clear, escalation on ambiguity/failure. When: familiar methodology, moderate risk.`,
      },
      {
        gate: "G1",
        result: "PASS",
        note: `\
D_SEMIAUTO inherits D_Phi_DISPATCH. 3 additional sorts (EscalationTrigger, \
ScopeChange, ScopeSize). 4 additional predicates. 4 additional axioms (Ax-S1 \
through Ax-S4).`,
      },
      {
        gate: "G2",
        result: "PASS",
        note: `\
O_SEMIAUTO stated. Progress preorder over completed steps. Two measures \
(mu_steps_completed, mu_escalation_rate) with formulas, ranges, proxy claims.`,
      },
      {
        gate: "G3",
        result: "PASS",
        note: `\
Two roles (rho_executor, rho_PO) with observation projections and explicit \
authorized/not-authorized. Coverage and authority claims present.`,
      },
      {
        gate: "G4",
        result: "PASS",
        note: `\
Six steps (sigma_S1-sigma_S6) with loop edge sigma_S6 -> sigma_S3. Termination \
certificate nu_S. Six composability claims. Contrarian challenge on sigma_S4->sigma_S5 \
edge (subjective clarity assessment). Terminal and initial condition claims present.`,
      },
      {
        gate: "G5",
        result: "PASS",
        note: `\
All six steps have finalized guidance in constraints-first format. Each guidance \
block references MCP tools and specifies escalation triggers. Output schemas with \
typed fields and hard invariants.`,
      },
      {
        gate: "G6",
        result: "PASS",
        note: "This file (P3-DISPATCH/M2-SEMIAUTO/M2-SEMIAUTO.yaml). Structurally complete.",
      },
    ],
  },
};

export const M3_FULLAUTO_META: MethodMetadata = {
  id: "M3-FULLAUTO",
  parent: "P3-DISPATCH",
  name: "Unattended Dispatch Method",
  description: `\
Fully autonomous dispatch method where the agent has full decision authority. The human \
is notified on completion or hard failure but is not consulted during execution. The agent \
routes, executes, validates, retries (up to a budget), and advances autonomously. \
Appropriate for well-understood pipelines, batch processing, or when the human is \
unavailable.`,
  version: "1.0",
  status: "compiled",
  compilation_date: "2026-03-14",
  formal_grounding: "theory/F1-FTH.md",
  navigation: {
    what: `\
M3-FULLAUTO manages methodology execution with full agent autonomy. The agent selects \
methods, executes steps, validates outputs, retries failures (up to N times), and \
advances — all without human consultation. The human receives a completion notification \
(with results) or a failure notification (with abort log) when the method finishes.`,
    who: `\
Two roles: rho_executor (agent — full authority over all decisions) and rho_observer \
(human — notified, not consulted; can emergency-abort only). The agent owns the entire \
execution lifecycle.`,
    why: `\
Well-understood pipelines with predictable step outcomes do not benefit from human \
oversight. Blocking on human input adds latency without value. M3-FULLAUTO maximizes \
throughput by delegating all decisions to the agent, bounded by a retry budget that \
prevents unbounded failure loops. The human is protected by the budget — if the agent \
cannot succeed within N retries, it aborts and notifies rather than persisting.`,
    how: `\
Six-step loop: load and route autonomously -> initialize -> execute step -> validate \
and retry (up to N times) -> budget check -> loop or complete. The agent never blocks \
on human input. Termination is guaranteed by the retry budget.`,
    when_to_use: [
      "Well-understood pipeline with predictable outcomes",
      "Batch processing with many independent runs",
      "Human is unavailable during execution",
      "The methodology has been run many times and failure modes are well-characterized",
    ],
    when_not_to_use: [
      "First-time methodology execution — use INTERACTIVE",
      "Work where human judgment adds value at intermediate steps — use SEMIAUTO",
      "High-stakes changes where silent failure would be costly — use INTERACTIVE or SEMIAUTO",
      "Exploratory work where the next step depends on intermediate findings",
    ],
  },
  compilation_record: {
    gates: [
      {
        gate: "G0",
        result: "PASS",
        note: `\
Navigation complete. What: unattended dispatch with full agent autonomy. Who: \
executor (agent, full authority) and observer (human, notified only). Why: \
maximizes throughput for well-understood pipelines. How: six-step loop with \
autonomous validation, retry, and abort. When: well-understood pipelines, batch \
processing, human unavailable.`,
      },
      {
        gate: "G1",
        result: "PASS",
        note: `\
D_FULLAUTO inherits D_Phi_DISPATCH. 2 additional sorts (FailureLog, RetryContext). \
2 additional predicates (retries_exhausted, abort_triggered). 3 additional axioms \
(Ax-F1 through Ax-F3).`,
      },
      {
        gate: "G2",
        result: "PASS",
        note: `\
O_FULLAUTO stated. Progress preorder over completed steps with abort as maximal. \
Two measures (mu_steps_completed, mu_retry_usage) with formulas, ranges, proxy claims.`,
      },
      {
        gate: "G3",
        result: "PASS",
        note: `\
Two roles (rho_executor, rho_observer) with observation projections and explicit \
authorized/not-authorized. Coverage and authority claims present. Observer has \
reduced visibility (terminal state only).`,
      },
      {
        gate: "G4",
        result: "PASS",
        note: `\
Six steps (sigma_F1-sigma_F6) with loop edge sigma_F6 -> sigma_F3. Termination \
certificate nu_F with compound bound (|steps| * (1 + max_retries)). Six \
composability claims. Contrarian challenge on sigma_F4->sigma_F5 edge (structural \
failures waste retry budget). Terminal and initial condition claims present.`,
      },
      {
        gate: "G5",
        result: "PASS",
        note: `\
All six steps have finalized guidance in constraints-first format. Each guidance \
block references MCP tools and specifies autonomous behavior. Output schemas with \
typed fields and hard invariants. No escalation in any step.`,
      },
      {
        gate: "G6",
        result: "PASS",
        note: "This file (P3-DISPATCH/M3-FULLAUTO/M3-FULLAUTO.yaml). Structurally complete.",
      },
    ],
  },
};
