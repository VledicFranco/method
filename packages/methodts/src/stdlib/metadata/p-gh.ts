// SPDX-License-Identifier: Apache-2.0
import type { MethodologyMetadata, MethodMetadata } from "../metadata-types.js";

export const P_GH_META: MethodologyMetadata = {
  id: "P-GH",
  name: "GitHub Operations Methodology",
  description: `\
P-GH receives a GitHub operations challenge, classifies it by challenge type \
and action, and routes it to the appropriate execution method. It does not \
execute operations directly — it evaluates delta_GH and dispatches. Four \
challenge types map to four methods covering: issue triage, PR review with \
self-fix loops, merge conflict resolution, and full issue-to-PR work execution.`,
  version: "1.0",
  status: "compiled",
  compilation_date: "2026-03-15",
  niche: `\
GitHub-native operations for LLM agent teams — issue triage, PR review with \
self-fix, merge conflict resolution, and issue execution with full git lifecycle \
management. All methods are git, GitHub, and multi-agent aware. Operates through \
GitHub MCP tools (get_issue, get_pull_request, create_pull_request, etc.) and \
git CLI. Excludes: repository administration, CI/CD pipeline design, release \
management, GitHub Actions authoring, non-GitHub version control platforms.`,
  navigation: {
    what: `\
P-GH receives a GitHub operations challenge, classifies it by challenge type \
and action, and routes it to the appropriate execution method. It does not \
execute operations directly — it evaluates delta_GH and dispatches. Four \
challenge types map to four methods covering: issue triage, PR review with \
self-fix loops, merge conflict resolution, and full issue-to-PR work execution.`,
    who: `\
The dispatcher role — any agent (human or LLM) who receives a GitHub operations \
challenge and must decide which method to invoke. Typically an orchestrator agent \
with access to GitHub MCP tools and git CLI.`,
    why: `\
Four structurally different GitHub operations exist, each with distinct \
input/output signatures, domain theory, and execution models. Sending a triage \
method to resolve a merge conflict wastes effort. Sending a review method to \
execute implementation work produces no deliverable. delta_GH externalizes the \
routing decision into an explicit, auditable function.`,
    how: `\
Evaluate challenge.type and action against the operationalization criteria. Apply \
delta_GH (4-arm priority stack). challenge.type == "issue" is further split by \
action: "triage" routes to M1-TRIAGE, "work" routes to M4-WORK.`,
    when_to_use: [
      "A GitHub operations challenge arrives within the niche",
      "An issue needs triage, classification, or routing",
      "A pull request needs review, potentially with self-fix",
      "A PR has merge conflicts that need resolution",
      "An issue needs to be implemented with full git lifecycle (branch, implement, PR)",
    ],
    when_not_to_use: [
      "Repository administration (settings, permissions, webhooks) — outside niche",
      "CI/CD pipeline design or GitHub Actions authoring — outside niche",
      "Release management or deployment — outside niche",
      "Non-GitHub platforms (GitLab, Bitbucket) — outside niche",
      "A specific method is already identified — invoke it directly",
    ],
  },
  compilation_record: {
    gates: [
      {
        gate: "G0",
        result: "PASS",
        note: `\
Navigation complete. What: 4-arm routing methodology for GitHub operations. \
Who: single dispatcher role. Why: wrong method selection degrades quality. \
How: evaluate challenge_type + action -> apply delta_GH -> dispatch. When: \
GitHub operations challenges within the niche.`,
      },
      {
        gate: "G1",
        result: "PASS",
        note: `\
D_Phi_GH = (Sigma_Phi_GH, Ax_Phi_GH). 14 sorts with cardinality (Challenge, \
ChallengeType with 3 values, Action with 2 values, MethodID with 4 values, \
Issue, PullRequest, ConflictSet, IssueType with 4 values, Scope with 4 values, \
ReviewVerdict with 2 values, ConflictType with 2 values, ResolutionStrategy \
with 4 values, ExecutionResult, State). 5 function symbols with totality. \
6 predicates with typed signatures referencing declared sorts. 5 closed axioms \
with rationale. Domain boundary stated. Initial and terminal state membership \
claimed with axiom-by-axiom verification.`,
      },
      {
        gate: "G2",
        result: "PASS",
        note: `\
O_Phi_GH stated as conjunction of three Sigma-predicates. Type: terminal. \
Expressibility claim present. addresses operationalized as method-specific O_M \
satisfaction. Progress preorder as 3-state total chain. Two measures with \
formulas, ranges, terminal values, and proxy claims.`,
      },
      {
        gate: "G3",
        result: "PASS",
        note: `\
One role (dispatcher) with identity observation projection and explicit \
authorized/not-authorized transitions. Coverage claim: trivially total. \
Authority claim: all routing transitions authorized. Role partition rationale: \
one role is minimal for a pure routing methodology.`,
      },
      {
        gate: "G4",
        result: "PASS",
        note: `\
delta_GH declared as 6-arm priority stack (4 routing + terminate + executing). \
Totality: Ax-3 guarantees every challenge type + action maps to a method. \
Termination certificate nu_GH = 1 with single-invocation decrease witness. \
Four retraction pairs declared (RP-1 through RP-4) with embed/project signatures \
and retraction verification claims. All declared at type level.`,
      },
      {
        gate: "G5",
        result: "PASS",
        note: `\
Three challenge_type values and two action values operationalized with True/False \
conditions and concrete criteria. Evaluation order specified: conflicts first \
(block merges), then reviews, then triage, then work.`,
      },
      {
        gate: "G6",
        result: "PASS",
        note: "This file (P-GH/P-GH.yaml). Structurally complete.",
      },
    ],
  },
};

export const M1_TRIAGE_META: MethodMetadata = {
  id: "M1-TRIAGE",
  parent: "P-GH",
  name: "Issue Triage Method",
  description: `\
Reads a GitHub issue via MCP tools, classifies it by type and scope, checks \
alignment with the project's essence, and routes it to the appropriate action: \
commission an agent (trivial/small), draft a PRD (medium/large), escalate to \
the steering council (essence-touching), or close (won't-fix/duplicate). The \
method produces a triage decision with rationale and executes the decided action.`,
  version: "1.0",
  status: "compiled",
  compilation_date: "2026-03-15",
  formal_grounding: "theory/F1-FTH.md",
  navigation: {
    what: `\
M1-TRIAGE takes a GitHub issue and produces a triage decision: classify the issue \
by type (bug/feature/question/meta) and scope (trivial/small/medium/large), check \
alignment with the project essence, and route to one of four actions — commission \
an agent for immediate work, draft a PRD for larger efforts, escalate to the \
steering council for essence-touching changes, or close with explanation.`,
    who: `\
One role — triager. Reads the issue, project card, existing PRDs, and council \
agenda. Has authority to classify, assess, decide, and execute the triage action. \
LLM agents are the primary execution target.`,
    why: `\
Untriaged issues accumulate and block delivery. Issues routed to the wrong action \
waste effort: a trivial fix sent through PRD creation delays by days; a large \
feature commissioned as a quick fix produces incomplete work. M1-TRIAGE makes \
the routing decision explicit and auditable, with project essence as the guard.`,
    how: `\
Five-step linear DAG: load issue -> classify type -> assess scope and overlap -> \
decide action -> execute action. Each step has concrete preconditions and \
postconditions. The decision step uses explicit predicates (serves_essence, \
overlaps_prd, within_scope) to determine routing.`,
    when_to_use: [
      "A new issue has been opened and needs classification",
      "An existing issue has been updated and needs re-triage",
      "The issue backlog needs systematic processing",
    ],
    when_not_to_use: [
      "The issue has already been triaged and needs implementation — use M4-WORK",
      "The challenge is about a PR, not an issue — use M2-REVIEW",
      "The issue is a merge conflict report — use M3-RESOLVE",
    ],
  },
  compilation_record: {
    gates: [
      {
        gate: "G0",
        result: "PASS",
        note: `\
Navigation complete. What: 5-step issue triage — load, classify, assess, decide, \
act. Who: single triager role. Why: untriaged issues block delivery; wrong routing \
wastes effort. How: linear DAG with essence guard. When: new/updated issues needing \
classification.`,
      },
      {
        gate: "G1",
        result: "PASS",
        note: `\
D_TRIAGE = (Sigma_TRIAGE, Ax_TRIAGE). 8 sorts with cardinality. 3 total function \
symbols. 6 predicates with typed signatures referencing declared sorts. 5 closed \
axioms with rationale. Domain boundary stated. Initial and terminal state \
membership claimed with axiom-by-axiom verification.`,
      },
      {
        gate: "G2",
        result: "PASS",
        note: `\
O_TRIAGE stated as conjunction of Sigma-predicates. Type: terminal. Expressibility \
claim present. Progress preorder with well-foundedness argument (5-step linear DAG). \
Two measures (mu_classification, mu_action) with formulas, ranges, terminal values, \
and proxy claims.`,
      },
      {
        gate: "G3",
        result: "PASS",
        note: `\
One role (triager) with identity observation projection and explicit authorized/ \
not-authorized transitions. Coverage claim: trivially total. Authority claim: all \
five steps authorized. Role partition rationale: one role for single-perspective \
triage evaluation.`,
      },
      {
        gate: "G4",
        result: "PASS",
        note: `\
Five steps in path graph (sigma_0 through sigma_4). Each step has pre, post, \
guidance with constraints-first format, typed output_schema. Four composability \
claims. Terminal and initial condition claims present. Contrarian challenge on \
sigma_1->sigma_2: classification accuracy; defended by essence guard, scope \
cross-check, and auditable triage comment.`,
      },
      {
        gate: "G5",
        result: "PASS",
        note: `\
All five steps have finalized guidance in constraints-first format. Each guidance \
block explicitly names all output_schema fields. Adequacy confirmed for all steps.`,
      },
      {
        gate: "G6",
        result: "PASS",
        note: "This file (P-GH/M1-TRIAGE/M1-TRIAGE.yaml). Structurally complete.",
      },
    ],
  },
};

export const M2_REVIEW_GH_META: MethodMetadata = {
  id: "M2-REVIEW",
  parent: "P-GH",
  name: "PR Review with Self-Fix Method",
  description: `\
Reviews a GitHub pull request by loading the PR diff, reading each changed file, \
checking delivery rules from the project card, and producing a verdict (approve or \
needs_changes) with file:line citations. When needs_changes, the method enters a \
self-fix loop: create a worktree from the PR branch, apply fixes, and re-review \
(max 3 iterations). Reviews are posted as discussion comments via add_issue_comment \
(PR number works as issue number), NOT via create_pull_request_review, because the \
reviewing agent operates under the same GitHub account as the PR author.`,
  version: "1.1",
  status: "compiled",
  compilation_date: "2026-03-19",
  formal_grounding: "theory/F1-FTH.md",
  evolution_note: `\
v1.1: Added M4-ADVREV delegation support. When the PR touches >= 5 files or crosses \
package boundaries, M2-REVIEW can delegate its sigma_1 (Read + Check) to M4-ADVREV \
via retraction pair RP-REVIEW-ADVREV. This replaces single-perspective review with \
adversarial multi-perspective review while preserving M2-REVIEW's domain framing \
(PR loading in sigma_0, verdict in sigma_2, self-fix loop in sigma_3/sigma_4, and \
report+merge in sigma_5). Council decision D-4 Tier 1.`,
  navigation: {
    what: `\
M2-REVIEW takes a GitHub pull request and produces a review report: load the PR diff, \
read each changed file in full context, check against delivery rules and project \
conventions, and produce a verdict with specific file:line citations for every finding. \
If the verdict is needs_changes, the method can self-fix: create a worktree, apply \
corrections, and re-review in a bounded loop (max 3 iterations).`,
    who: `\
Two roles — reviewer (reads and evaluates) and fixer (applies corrections in \
worktree). In single-agent execution, the same agent plays both roles with an \
explicit role switch at sigma_3. LLM agents are the primary execution target.`,
    why: `\
PRs merged without review accumulate defects. PRs reviewed but not fixed create \
a back-and-forth cycle that delays delivery. M2-REVIEW combines review and self-fix \
in a single method, reducing the feedback loop from asynchronous to synchronous. \
The file:line citation requirement (Ax-1) ensures findings are actionable, not vague.`,
    how: `\
Six-step DAG with a conditional self-fix loop: load PR -> read + check -> verdict -> \
fix (conditional) -> self-review (loop back to sigma_1, max 3 iterations) -> report \
+ merge. The loop is bounded by the iteration counter.`,
    when_to_use: [
      "A pull request needs code review",
      "A self-authored PR needs quality verification before merge",
      "An agent-created PR needs automated review with self-fix capability",
    ],
    when_not_to_use: [
      "The PR has merge conflicts — use M3-RESOLVE first, then M2-REVIEW",
      "The challenge is about implementing from an issue — use M4-WORK (which invokes M2-REVIEW internally)",
      "The PR is a draft and not ready for review",
    ],
  },
  compilation_record: {
    gates: [
      {
        gate: "G0",
        result: "PASS",
        note: `\
Navigation complete. What: PR review with self-fix loop. Who: reviewer + fixer \
roles. Why: combines review and fix to reduce feedback loops. How: 6-step DAG \
with conditional fix loop (max 3 iterations). When: PR needs review.`,
      },
      {
        gate: "G1",
        result: "PASS",
        note: `\
D_REVIEW = (Sigma_REVIEW, Ax_REVIEW). 9 sorts with cardinality. 4 total function \
symbols. 6 predicates with typed signatures. 5 closed axioms (including Ax-5 for \
comment-based review constraint). Domain boundary stated. Initial and terminal \
state membership claimed.`,
      },
      {
        gate: "G2",
        result: "PASS",
        note: `\
O_REVIEW stated as conjunction of Sigma-predicates. Type: terminal. Expressibility \
claim present. Progress preorder with well-foundedness argument. Two measures \
(mu_coverage, mu_posted) with formulas, ranges, terminal values, and proxy claims.`,
      },
      {
        gate: "G3",
        result: "PASS",
        note: `\
Two roles (reviewer, fixer) with observation projections and explicit authorized/ \
not-authorized transitions. Coverage and authority claims present. Role partition \
rationale: epistemic separation between evaluation and fixing.`,
      },
      {
        gate: "G4",
        result: "PASS",
        note: `\
Six steps with conditional branching and bounded loop. Loop structure declared \
with termination certificate nu_fix. Seven composability claims including loop \
edges. Terminal and initial condition claims present. Contrarian challenge on \
sigma_3->sigma_4: self-fix blind spots; defended by iteration bound, full \
re-review, and formal role switch.`,
      },
      {
        gate: "G5",
        result: "PASS",
        note: `\
All six steps have finalized guidance in constraints-first format. Each guidance \
block names all output_schema fields. Adequacy confirmed.`,
      },
      {
        gate: "G6",
        result: "PASS",
        note: "This file (P-GH/M2-REVIEW/M2-REVIEW.yaml). Structurally complete.",
      },
    ],
  },
};

export const M3_RESOLVE_META: MethodMetadata = {
  id: "M3-RESOLVE",
  parent: "P-GH",
  name: "Merge Conflict Resolution Method",
  description: `\
Resolves merge conflicts in a GitHub pull request. Detects conflicting files, \
classifies each conflict as mechanical (textual overlap) or semantic (logic \
divergence), selects a resolution strategy (rebase, merge, cherry-pick, or manual \
edit), executes the resolution on the actual branch (no worktree isolation), and \
verifies that build + tests pass with no unintended changes. The core invariant \
is preserves_intent: the resolution must preserve what both branches intended.`,
  version: "1.0",
  status: "compiled",
  compilation_date: "2026-03-15",
  formal_grounding: "theory/F1-FTH.md",
  navigation: {
    what: `\
M3-RESOLVE takes an unmergeable PR and produces a conflict-free branch that \
preserves the intent of both sides. Five steps: detect conflicting files, analyze \
each conflict (mechanical vs semantic), choose a resolution strategy, execute \
the resolution, and verify correctness.`,
    who: `\
One role — resolver. Has read access to both branches and write access to the \
PR branch. Must understand git operations (rebase, merge, cherry-pick) and the \
semantic intent of both branches' changes.`,
    why: `\
Merge conflicts block PR merges and delivery. Mechanical conflicts (two people \
edited adjacent lines) are straightforward but tedious. Semantic conflicts (two \
branches changed the same logic in incompatible ways) require understanding \
intent. M3-RESOLVE makes the conflict analysis and resolution strategy explicit, \
preventing silent data loss from incorrect manual merges.`,
    how: `\
Five-step linear DAG: detect -> analyze -> strategy -> execute -> verify. The \
execute step works on the actual branch (no worktree isolation) because conflict \
resolution requires direct branch manipulation (rebase, merge operations). The \
verify step confirms build + tests pass and no unintended changes were introduced.`,
    when_to_use: [
      "A PR cannot be merged due to git conflicts",
      "An automated merge failed and needs manual resolution",
      "A rebase is needed to bring a branch up to date with the target",
    ],
    when_not_to_use: [
      "The PR is mergeable (no conflicts) — use M2-REVIEW instead",
      "The challenge is about code quality, not merge conflicts",
      "The conflict is in a non-code file that requires human editorial judgment",
    ],
  },
  compilation_record: {
    gates: [
      {
        gate: "G0",
        result: "PASS",
        note: `\
Navigation complete. What: 5-step merge conflict resolution. Who: single resolver \
role. Why: conflicts block merges; incorrect resolution causes data loss. How: \
linear DAG — detect, analyze, strategy, execute, verify. When: PR has merge conflicts.`,
      },
      {
        gate: "G1",
        result: "PASS",
        note: `\
D_RESOLVE = (Sigma_RESOLVE, Ax_RESOLVE). 7 sorts with cardinality. 3 total \
function symbols. 6 predicates with typed signatures. 5 closed axioms with \
rationale (including preserves_intent as core invariant). Domain boundary stated. \
Initial and terminal state membership claimed.`,
      },
      {
        gate: "G2",
        result: "PASS",
        note: `\
O_RESOLVE stated as conjunction of Sigma-predicates. Type: terminal. Expressibility \
claim present. Progress preorder with well-foundedness argument (finite conflict set). \
Two measures (mu_resolution, mu_integrity) with formulas, ranges, terminal values, \
and proxy claims.`,
      },
      {
        gate: "G3",
        result: "PASS",
        note: `\
One role (resolver) with identity observation projection and explicit authorized/ \
not-authorized transitions. Coverage claim: trivially total. Authority claim: all \
five steps authorized. Role partition rationale: one role for single-perspective \
conflict resolution.`,
      },
      {
        gate: "G4",
        result: "PASS",
        note: `\
Five steps in path graph (sigma_0 through sigma_4). Each step has pre, post, \
guidance with constraints-first format, typed output_schema. Four composability \
claims. Terminal and initial condition claims present. Contrarian challenge on \
sigma_1->sigma_2: intent misinterpretation; defended by build/test verification \
and explicit per-file intent check.`,
      },
      {
        gate: "G5",
        result: "PASS",
        note: `\
All five steps have finalized guidance in constraints-first format. Each guidance \
block names all output_schema fields. Adequacy confirmed.`,
      },
      {
        gate: "G6",
        result: "PASS",
        note: "This file (P-GH/M3-RESOLVE/M3-RESOLVE.yaml). Structurally complete.",
      },
    ],
  },
};

export const M4_WORK_META: MethodMetadata = {
  id: "M4-WORK",
  parent: "P-GH",
  name: "Issue Work Execution Method",
  description: `\
Executes a GitHub issue with full git lifecycle management: reads the issue, sets \
up a worktree and branch, plans the approach, implements with a bounded build/test \
loop, commits and pushes, creates a PR linked to the issue, runs M2-REVIEW inline \
as self-review, applies fixes if needed, and reports completion. This is the most \
git-aware method in P-GH — every step knows about worktrees, branches, and the PR \
lifecycle. Branch naming follows the convention fix/issue-{N} or feat/issue-{N}.`,
  version: "1.0",
  status: "compiled",
  compilation_date: "2026-03-15",
  formal_grounding: "theory/F1-FTH.md",
  navigation: {
    what: `\
M4-WORK takes a GitHub issue and produces a merged PR that resolves it. Nine steps \
cover the full lifecycle: load issue, setup worktree + branch, plan approach, \
implement (bounded loop), commit + push, create PR, self-review via M2-REVIEW, \
fix loop (conditional), and report completion. The method manages the entire git \
lifecycle from branch creation to PR merge.`,
    who: `\
Three roles — planner (reads issue and plans), implementor (writes code in worktree), \
and reporter (creates PR, posts comments, reports completion). In single-agent \
execution, the same agent plays all three roles with explicit transitions.`,
    why: `\
Issues that are "ready to work" need a complete execution path from issue to merged \
PR. Without a structured method, agents may skip steps (no branch, no tests, no \
self-review) or lose track of the git state (working on wrong branch, forgetting to \
push). M4-WORK makes every git lifecycle step explicit and mandatory.`,
    how: `\
Nine-step DAG with two conditional loops: sigma_3 (implement) has a bounded build/test \
convergence loop, and sigma_7 (fix loop) re-enters sigma_3 when self-review finds \
issues (max 3 iterations). The method invokes M2-REVIEW inline at sigma_6 for \
self-review.`,
    when_to_use: [
      "An issue has been triaged and is ready for implementation",
      "A trivial/small issue needs direct execution without PRD",
      "An agent has been commissioned to work on a specific issue",
    ],
    when_not_to_use: [
      "The issue needs triage first — use M1-TRIAGE",
      "The issue is medium/large and needs a PRD before implementation",
      "The challenge is about an existing PR, not an issue — use M2-REVIEW or M3-RESOLVE",
    ],
  },
  compilation_record: {
    gates: [
      {
        gate: "G0",
        result: "PASS",
        note: `\
Navigation complete. What: full git lifecycle from issue to merged PR. Who: three \
roles (planner, implementor, reporter). Why: structured execution prevents missed \
steps. How: 9-step DAG with two bounded loops. When: issue ready for implementation.`,
      },
      {
        gate: "G1",
        result: "PASS",
        note: `\
D_WORK = (Sigma_WORK, Ax_WORK). 9 sorts with cardinality. 3 total function \
symbols. 10 predicates with typed signatures. 7 closed axioms (including worktree \
isolation, branch naming, build/test before push, PR-issue linkage, self-review \
required, fix loop bound). Domain boundary stated. Initial and terminal state \
membership claimed.`,
      },
      {
        gate: "G2",
        result: "PASS",
        note: `\
O_WORK stated as conjunction of 7 Sigma-predicates. Type: terminal. Expressibility \
claim present. Progress preorder with well-foundedness argument. Three measures \
(mu_lifecycle, mu_quality, mu_visibility) with formulas, ranges, terminal values, \
and proxy claims.`,
      },
      {
        gate: "G3",
        result: "PASS",
        note: `\
Three roles (planner, implementor, reporter) with observation projections and \
explicit authorized/not-authorized transitions. Coverage claim: union of projections \
covers full Mod(D_WORK). Authority claim: all steps authorized by exactly one role. \
Role partition rationale: epistemic separation between planning, implementing, \
and reporting.`,
      },
      {
        gate: "G4",
        result: "PASS",
        note: `\
Nine steps with two bounded loops (build convergence and self-review fix). Two \
loop structures declared with termination certificates. Ten composability claims \
including conditional and loop edges. Terminal and initial condition claims present. \
Contrarian challenge on sigma_6->sigma_7: self-review bias; defended by citation \
requirement, role switch, and external auditability.`,
      },
      {
        gate: "G5",
        result: "PASS",
        note: `\
All nine steps have finalized guidance in constraints-first format. Each guidance \
block names all output_schema fields. Adequacy confirmed.`,
      },
      {
        gate: "G6",
        result: "PASS",
        note: "This file (P-GH/M4-WORK/M4-WORK.yaml). Structurally complete.",
      },
    ],
  },
};
