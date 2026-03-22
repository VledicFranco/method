---
name: commission
description: Generate a ready-to-paste orchestrator prompt for a fresh agent to execute a task following the project's methodology. Reads the project card, methodology, delivery rules, essence, and Guide 8 template to compose a complete prompt. Use when you want to spawn an agent session for a PRD, bug fix, or any methodology-driven task. Trigger phrases: "commission agent", "generate prompt", "spawn agent for", "create orchestrator prompt".
disable-model-invocation: true
argument-hint: [task description or path to PRD/issue, e.g. "implement docs/prds/005.md" or "fix issue #47"]
---

# Commission Agent

> Generates a complete orchestrator prompt from the project's methodology instance.
> The human reviews, tweaks if needed, and fires via bridge or pastes into a new session.

## When to use

- You have a PRD, bug, or task and want a fresh agent to execute it following the methodology
- You want to avoid manually composing the orchestrator prompt
- You're launching parallel agents and need consistent prompt structure

## How it works

If `$ARGUMENTS` is provided, use it as the task. Otherwise ask:
> *"What task should the new agent execute? (PRD path, issue number, or description)"*

### Step 1 — Load context

Read these files in order. If any is missing, note it and continue:

1. **`.method/project-card.yaml`** — the project card
   - Extract: `essence` (purpose, invariant, optimize_for)
   - Extract: `methodology` and `methodology_version`
   - Extract: `governance` (autonomy mode)
   - Extract: `context` (language, build, test commands)
   - Extract: `delivery_rules` — select the 3-5 most relevant to the task
   - Extract: `role_notes` for impl_sub_agent and orchestrator

2. **The task spec** — the PRD, issue, or task description from `$ARGUMENTS`
   - Read the full file if it's a path
   - Extract: objective, scope, acceptance criteria, implementation order

3. **The methodology's transition function** — from the registry
   - If the card has `methodology_registry_path`, read: `{methodology_registry_path}/{methodology}/{methodology}.yaml` → `transition_function.arms`
   - Otherwise, try `registry/{methodology}/{methodology}.yaml` relative to the project root
   - Extract: the delta routing table (task_type → method mapping)
   - **IMPORTANT:** The routing table must be embedded into the composed prompt (Section 3). The spawned agent may not have access to the registry path (e.g., in a worktree).

4. **`.method/council/AGENDA.yaml` or `.method/council/AGENDA.md`** (whichever exists) — check for governance context
   - If the card has `governance.council_path`, use that as the base directory and glob for `AGENDA.*`
   - Any agenda items related to this task? Any council decisions that should influence the prompt?

### Step 2 — Evaluate routing

Based on the task spec, pre-evaluate delta for the human:

- What `task_type` is this? (section / architecture / plan / implement / review / audit)
- If implement: does `multi_task_scope` apply? (>= 3 independent tasks with disjoint scopes)
- Which method will likely be selected?
- Does the task involve design decisions that warrant M1-COUNCIL?

**PhaseDoc precondition check (for task_type=implement):**
If task_type is `implement`, check whether a PhaseDoc exists at the card's `delivery.phase_docs` glob pattern matching this PRD/task. If no PhaseDoc is found, warn the human:
> *"⚠ No PhaseDoc found for this task. The methodology requires M5-PLAN before M2-DIMPL/M1-IMPL. Options: (a) Run M5-PLAN first to produce a PhaseDoc, (b) Treat the PRD's implementation phases section as the PhaseDoc equivalent, (c) Create a lightweight PhaseDoc now."*
If the human picks (b), note the override in the composed prompt as a DC note.

**IMPORTANT**: State the routing directive clearly. The commissioned agent MUST use the method you evaluate here, not default to M1-COUNCIL. Example: "This is task_type=implement → M1-IMPL. Do NOT use M1-COUNCIL."

State the routing evaluation so the human can confirm or override.

### Step 3 — Compose prompt

Generate the orchestrator prompt following this structure:

**Section 1 — Role Declaration**
```
You are an orchestrating agent for {project}. Your role is rho_executor —
you coordinate methodology execution, make routing decisions, and spawn
sub-agents for actual work. You do not write code or edit files directly.
```

**Section 2 — Objective**
From the task spec: what to implement, where the spec lives.

**Section 3 — Methodology Binding**
From the card: methodology, version, card path. Include the delta routing table.

**IMPORTANT**: Include an explicit routing directive:
```
This is task_type={type} → {method}. Load {methodology} and route to {method}.
Do NOT use M1-COUNCIL unless the task explicitly requires adversarial debate.
```

**Section 4 — Essence Context**
From the card: purpose, invariant, optimize_for. Frame as: "Every decision you make should serve this purpose and respect this invariant."

**Section 5 — Execution Binding**
```
For every step, state which P1-EXEC method you're using:
- M3-TMP (default) — sequential reasoning
- M1-COUNCIL — when multiple defensible positions exist
- M2-ORCH — when 3+ parallel independent sub-tasks

Proportionality: M1-COUNCIL when security invariants, 3+ options with
non-obvious tradeoffs, or irreversible. M3-TMP for reversible, low-stakes.
```

**Section 6 — Key Delivery Rules**
From the card: the 3-5 most relevant delivery rules for this specific task. Don't include all rules — highlight what matters.

**Section 7 — Retrospective Protocol**
```
After completing each method, produce a retrospective YAML at
.method/retros/retro-YYYY-MM-DD-NNN.yaml. Schema: hardest_decision,
observations (>= 1), card_feedback (including essence feedback),
proposed_deltas (optional).
```

**Section 8 — Execution Protocol**
Based on routing evaluation:
- If sectioning needed → step through M7-PRDS first
- If architecture update needed → M6-ARFN
- Standard loop: plan → implement → review
- Include sigma_A4 go/no-go as a decision point

**Section 9 — Sub-Agent Instructions**
```
1. Bounded tasks — one step or deliverable per sub-agent
2. Include relevant delivery rules
3. Sub-agents commit their work to YOUR feature branch and push immediately
4. Sub-agents don't make scope decisions — report back
5. State the P1-EXEC method for each sub-agent
6. CRITICAL: Explicitly list which files/directories each sub-agent may modify:
   - Phase X agents: `packages/bridge/src/**`, `packages/bridge/src/__tests__/**`
   - Phase Y agents: `docs/guides/**`
   These paths will be passed as `allowed_paths` to `bridge_spawn` for
   infrastructure-level enforcement (PRD 014). The bridge installs a pre-commit
   hook that blocks commits outside these patterns and a PTY watcher that
   detects out-of-scope writes in real time.
7. CRITICAL: Sub-agents must NEVER push to master. They push only to the
   feature branch you created. If a sub-agent needs to push, give it the
   exact branch name.
```

**Section 10 — Visibility and Channel Usage**
```
Your bridge session ID will be injected at spawn time. Use it to report progress:
- Call bridge_progress after each methodology step transition (type: "step_started"
  or "step_completed", content: { methodology, method, step, step_name, description })
- Call bridge_event with type "completed" when done (include commit hashes, test results,
  files modified)
- Call bridge_event with type "error" if you hit a blocker
- Call bridge_event with type "escalation" if you need human input
Your parent agent and the dashboard can see these reports in real time.
```

**Section 11 — Git Workflow (PR as Living Artifact)**

Read the card's `github` section (if present) to determine the PR tool and base branch. Defaults: `github.tool = "mcp__github-personal"`, `github.default_branch = "main"`.

```
You are working in a git worktree on a feature branch.

CRITICAL GIT RULES:

1. NEVER push to master/main. Only push to YOUR feature branch.
   If you are unsure which branch you are on, run `git branch --show-current`.

2. Commit early, commit often, push constantly.
   Make a commit after EVERY meaningful change (new file, interface defined,
   function implemented, test written). Push after every commit. If the
   session dies, nothing should be lost.

3. Create a draft PR immediately after your FIRST commit and push.
   - Title: short description (conventional commit format)
   - Body: paste the FULL commission prompt as the PR description.
     The reviewer will check your work against this spec.
   - Base branch: {github.default_branch}
   - Use {github.tool} to create the PR.

4. After each significant milestone, add a PR comment documenting:
   - What was just implemented
   - Any design decisions made and why
   - Any deviations from the spec and why
   - What's next
   Use {github.tool + add_issue_comment} (PRs are issues) to add comments.
   This creates a living implementation log.

5. Final state = PR ready for review.
   When all deliverables are complete, tests pass, and build succeeds:
   - Add a final PR comment: what was implemented, test results, open items
   - Report the PR URL in bridge_event "completed"
   Do NOT merge the PR — the reviewer merges after review.
```

**Section 12 — Files to Read First**
From the card: architecture paths, the task spec, project card itself.

### Step 4 — Add governance context (if available)

If the council agenda (`.method/council/AGENDA.yaml` or `AGENDA.md` — check both) has items related to this task, or if a recent council session produced relevant decisions, add a "Governance Context" section:

```
### Governance Context (from steering council)

The steering council has noted: [relevant agenda items or decisions].
This affects your execution: [how it changes priorities or approach].
```

### Step 5 — Present for review and optionally fire

Present the complete prompt to the human with:

1. The full prompt text (ready to copy-paste)
2. A routing summary: "This will run {method} on {methodology} with {N} delivery rules highlighted"
3. Any flags: "Note: the PRD has 5 phases — consider whether sectioning (M7-PRDS) is needed"
4. Bridge config: "Will spawn with isolation: worktree, budget: {max_depth: N, max_agents: N}"

Ask:
> *"Review the prompt above. Options: (1) I fire it via the bridge now, (2) copy-paste into a new session yourself, or (3) modify first?"*

### Step 6 — Fire the agent

Two dispatch paths: bridge (if available) or native Agent tool (fallback).

**Building the allowedTools list:**

Start with the base set:
```
Bash,Read,Write,Edit,Glob,Grep,Agent
```

Then add tools dynamically from the project card:

1. **Methodology MCP tools** (always included):
   `mcp__method__methodology_list,mcp__method__methodology_start,mcp__method__methodology_get_routing,mcp__method__methodology_route,mcp__method__methodology_load_method,mcp__method__methodology_select,mcp__method__methodology_transition,mcp__method__methodology_status,mcp__method__step_current,mcp__method__step_advance,mcp__method__step_context,mcp__method__step_validate,mcp__method__theory_lookup`

2. **Bridge tools** (only if firing via bridge):
   `mcp__method__bridge_progress,mcp__method__bridge_event`

3. **Language server MCP tools** — if the card has `context.language_server_mcp_name`, include all tools from that server. For example, if `language_server_mcp_name: "scala-metals-t1-cortex"`, add:
   `mcp__scala-metals-t1-cortex__compile-file,mcp__scala-metals-t1-cortex__compile-full,mcp__scala-metals-t1-cortex__compile-module,mcp__scala-metals-t1-cortex__find-dep,mcp__scala-metals-t1-cortex__format-file,mcp__scala-metals-t1-cortex__get-docs,mcp__scala-metals-t1-cortex__get-usages,mcp__scala-metals-t1-cortex__glob-search,mcp__scala-metals-t1-cortex__inspect,mcp__scala-metals-t1-cortex__list-modules,mcp__scala-metals-t1-cortex__typed-glob-search,mcp__scala-metals-t1-cortex__test`

4. **GitHub tools** — based on `github.tool` from the card:
   - If `"gh"`: no extra tools needed (Bash covers `gh` CLI)
   - If `"mcp__github-personal"`: add `mcp__github-personal__create_pull_request,mcp__github-personal__create_branch,mcp__github-personal__add_issue_comment`

**Reading budget from the card:**

If the card has `governance.budget`, use its `max_depth` and `max_agents`. Otherwise default to `{ max_depth: 3, max_agents: 10 }`.

#### Step 6a — Fire via bridge

If `bridge_spawn` MCP tool is available and the human says "fire it":

1. Call `bridge_spawn` with:
   - `workdir`: the current project directory
   - `isolation`: `"worktree"`
   - `spawn_args`: `["--allowedTools", "{built allowedTools list}"]`
   - `initial_prompt`: the composed prompt from Step 3
   - `session_id`: from the current methodology session if one is active
   - `budget`: from `governance.budget` or default
   - `allowed_paths`: derived from Section 9's file-scope listing (PRD 014). Convert each sub-agent's declared scope to glob patterns. Example: if Section 9 says "Phase 1 agents: `packages/bridge/src/**`", pass `["packages/bridge/src/**"]`. If the task has a broad scope (e.g., multiple packages), include all relevant patterns.
   - `scope_mode`: `"enforce"` (default — pre-commit hook blocks out-of-scope commits)

2. Report the `bridge_session_id` to the human
3. Note: the human can monitor progress on the bridge dashboard (default: http://localhost:3456/dashboard)
4. Note: the parent agent can monitor via `bridge_read_progress` and `bridge_read_events`

**Prerequisites for bridge firing:**
- The bridge must be running (`npm run bridge`)
- The method MCP server must be configured in `.mcp.json`
- The `bridge_spawn` MCP tool must be available in this session

#### Step 6b — Fire via native Agent tool (fallback)

If the bridge is not available, use Claude Code's native `Agent` tool:

1. Call `Agent` with:
   - `isolation`: `"worktree"`
   - `prompt`: the composed prompt from Step 3 (with Section 10 bridge references removed or marked optional)
   - `subagent_type`: `"general-purpose"`

2. The agent runs in a git worktree automatically
3. Results are returned when the agent completes
4. Note: no real-time progress monitoring — the agent returns its full result at completion

When composing the prompt for native Agent dispatch, mark Section 10 (Visibility and Channel Usage) as conditional:
```
If bridge tools (bridge_progress, bridge_event) are available, use them to report
progress. If not, skip — your results will be returned directly to the parent agent.
```

### Step 7 — Monitor and review (if fired via bridge)

After firing:

1. Poll `bridge_read_progress` periodically to monitor methodology step progression
2. Watch for `bridge_read_events` — especially `completed`, `error`, or `escalation`
3. On `completed`: check the PR URL in the event content, review the changes
4. On `error`: assess whether to retry, escalate, or abort
5. On `escalation`: provide the requested input via `bridge_prompt`

## What this skill does NOT do

- **Does not auto-fire without human approval** — always presents the prompt first
- **Does not make routing decisions** — it pre-evaluates and suggests. The human (or the spawned agent) decides
- **Does not replace the steering council** — the council decides WHAT to work on. This skill produces HOW
- **Does not modify project files** — read-only. The prompt is output text, not a file write
- **Does not merge PRs** — the commissioned agent creates the PR, the reviewer merges
