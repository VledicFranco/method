---
name: realize
description: >
  PRD realization orchestrator — decomposes a PRD into commissions, spawns sub-agents
  via /com to implement each part, reviews and merges their PRs, and loops until the
  entire PRD is fully implemented or impossible. The orchestrator saves context by
  delegating all implementation work to sub-agents, keeping only the plan, status
  tracking, and quality gates in its own context.
  Trigger phrases: "realize", "implement this PRD end to end", "realize this PRD",
  "full PRD implementation".
disable-model-invocation: true
argument-hint: "[PRD path — e.g. 'docs/prds/027-pacta.md']"
---

# /realize — PRD Realization Orchestrator

> Decomposes a PRD into commissions, spawns sub-agents to implement each, reviews
> their PRs, and loops until the PRD is fully realized or proven impossible.

```
PRD → Plan → Commission Loop:
  [ decompose → /com sub-agent → PR → /review-pipeline → merge or fix ]
  ...repeat until all acceptance criteria pass...
→ PRD Realized
```

**Core mechanism:** The orchestrator never writes implementation code. It plans,
commissions, reviews, and integrates. All implementation work is delegated to `/com`
sub-agents, each running in an isolated worktree. The orchestrator's context stays
small — it holds only the plan, status tracker, and review results.

---

## When to use

- A PRD has multiple phases or deliverables that can be implemented as independent commissions
- The work is too large for a single `/com` session (> 5 tasks, multiple packages, or phases)
- You want gated quality across the entire PRD with automated review and merge
- The PRD has explicit acceptance criteria and success criteria to verify

## When NOT to use

- Single-phase PRDs with < 5 tasks — use `/com` directly
- PRDs that are still in draft/exploration — stabilize the spec first
- PRDs with no acceptance criteria — define them first
- Work that requires continuous human design input — the orchestrator assumes autonomy

---

## Phase 0 — Initialize

### 0.1 — Load PRD

Read the PRD at `$ARGUMENTS`. Extract and hold in working memory:

| PRD field | What you extract |
|-----------|-----------------|
| **Objective** | What the PRD achieves |
| **Phases** | Each phase with deliverables and exit criteria |
| **Success criteria** | Numbered list — these are the acceptance gates |
| **Packages** | What packages are created or modified |
| **Dependencies** | Between phases (what blocks what) |
| **Non-goals** | What is explicitly out of scope |

If the PRD has no phases or success criteria:
> *"This PRD has no phases/success criteria. I need at least: (1) a list of deliverables
> that can be independently commissioned, and (2) acceptance criteria I can verify.
> Add these to the PRD or provide them now."*

### 0.2 — Load Project Card

Read `.method/project-card.yaml`. Extract: essence, build/test/lint commands, layer stack,
governance, delivery rules. Same as `/com` Phase 0.1.

### 0.3 — Create Realization Session

```
session_id: realize-{YYYYMMDD}-{HHMM}-{prd-slug}
```

Create session directory: `.method/sessions/{session_id}/`

---

## Phase 1 — Realization Plan

### 1.1 — Decompose PRD into Commissions

Analyze the PRD's phases and deliverables. Decompose into **commissions** — independent
units of work, each suitable for a single `/com` sub-agent session.

**Decomposition rules:**
- Each commission maps to one package or one domain (FCA boundary = commission boundary)
- Commissions within a phase can be parallelized if they touch different packages/domains
- Commissions across phases respect phase dependencies (Phase 2 waits for Phase 1)
- Each commission has a clear scope: files to create/modify, acceptance criteria to satisfy
- Target commission size: 3-8 tasks (matching `/com`'s nu_B budget of 5 iterations)
- If a phase has > 8 tasks, split into multiple commissions within that phase

### 1.2 — Define Commission Cards

For each commission, produce a card:

```yaml
- id: C-{N}
  phase: {PRD phase number}
  title: "{what this commission implements}"
  scope: "{package or domain — e.g. @method/pacta core types}"
  depends_on: [C-{M}, ...]  # commissions that must complete first
  parallel_with: [C-{K}, ...] # commissions that can run simultaneously
  deliverables:
    - "{specific artifact 1}"
    - "{specific artifact 2}"
  acceptance_criteria:
    - "{testable criterion 1}"
    - "{testable criterion 2}"
  estimated_tasks: {N}
  branch: "feat/{prd-slug}-c{N}-{short-desc}"
  status: pending
```

### 1.3 — Define Acceptance Gates

For each PRD success criterion, define how the orchestrator verifies it:

```yaml
gates:
  - criterion: "{success criterion text}"
    verification: "{how to verify — command, test, manual check}"
    commission_ids: [C-{N}, ...]  # which commissions contribute to this criterion
    status: pending
```

### 1.4 — Write the Realization Plan

Write the plan to `tmp/realize-plan-{prd-slug}-{date}.md`:

```markdown
# Realization Plan: PRD {N} — {title}

## Commissions

| ID | Phase | Title | Depends On | Status |
|----|-------|-------|------------|--------|
| C-1 | 1 | ... | — | pending |
| C-2 | 1 | ... | — | pending |
| C-3 | 2 | ... | C-1, C-2 | blocked |

## Execution Order

Wave 1 (parallel): C-1, C-2
Wave 2 (parallel): C-3, C-4 (after Wave 1 completes)
Wave 3: C-5 (after Wave 2)

## Acceptance Gates

| # | Criterion | Verification | Commissions | Status |
|---|-----------|-------------|-------------|--------|
| 1 | ... | ... | C-1, C-2 | pending |

## Status Tracker

Total: {N} commissions, {M} waves
Completed: 0 / {N}
Current wave: —
Blocked: —
Failed: —
```

### 1.5 — Present Plan to PO

Present the plan summary:
> *"Realization plan for PRD {N}: {M} commissions across {K} waves.
> Wave 1 ({parallel count}): {commission titles}.
> Total acceptance gates: {N}.
> Estimated sub-agent sessions: {M}.
> Proceed?"*

Wait for PO approval before executing. The PO may adjust commission boundaries,
reorder waves, or modify acceptance criteria.

---

## Phase 2 — Commission Loop

### 2.1 — Select Next Wave

From the plan, identify commissions whose dependencies are all satisfied (status = done).
Group them into the current wave. Commissions in the same wave can run in parallel.

If no commissions are eligible (all remaining have unsatisfied dependencies):
- Check if any dependency is in `failed` status → escalate
- Check if any dependency is in `in_progress` status → wait
- If all dependencies are `done` but commission is still `blocked` → bug in plan, fix

### 2.2 — Spawn Commission Sub-Agents

For each commission in the current wave, spawn a sub-agent:

```typescript
Agent({
  prompt: `You are a commissioned implementation agent. Execute /com with this task:

Task: ${commission.title}
Scope: ${commission.scope}
Branch: ${commission.branch}
Base branch: master

Deliverables:
${commission.deliverables.map(d => `- ${d}`).join('\n')}

Acceptance criteria:
${commission.acceptance_criteria.map(c => `- ${c}`).join('\n')}

Instructions:
1. Run /com with the task description above
2. Create your feature branch: ${commission.branch}
3. Implement all deliverables
4. Ensure all acceptance criteria pass
5. Create a PR against master
6. Report back with: PR URL, gate results, any blockers

Do NOT merge the PR. The orchestrator reviews and merges.`,
  isolation: 'worktree',
  run_in_background: true,
})
```

**Parallelism:** Launch all commissions in the current wave simultaneously using
`run_in_background: true`. Each runs in its own worktree (isolated git state).

**Context efficiency:** The sub-agent gets only its commission card, not the full PRD.
The orchestrator retains the plan; sub-agents retain their commission scope.

### 2.3 — Monitor Commission Progress

As sub-agents complete:

1. Read the sub-agent's result (PR URL, gate status, blockers)
2. Update the plan's status tracker:
   - `done` — PR created, gates pass
   - `failed` — sub-agent reported blockers or gate failures
   - `needs_review` — PR created, needs orchestrator review

If a sub-agent reports `failed`:
- Read the failure reason
- Classify: `fixable` (code issue, retry with guidance) or `impossible` (spec contradiction, design issue)
- If `fixable`: spawn a new sub-agent with the failure context as additional instructions
- If `impossible`: pause the wave, escalate to PO

### 2.4 — Review Commission PRs

For each completed commission PR:

1. Run `/review-pipeline` on the PR
2. If review is clean (no CRITICAL or HIGH findings):
   - Mark commission as `reviewed`
   - Proceed to merge (2.5)
3. If review has findings:
   - If findings are fixable: spawn a fix sub-agent targeting the specific findings
     ```
     Agent({
       prompt: `Fix these review findings on branch ${commission.branch}:
       ${findings.map(f => `- ${f.id}: ${f.title} — ${f.recommendation}`).join('\n')}
       Push fixes to the existing branch. Do not create a new PR.`,
       isolation: 'worktree',
     })
     ```
   - After fix sub-agent completes: re-run `/review-pipeline`
   - Maximum 2 fix cycles per commission. After 2 failures: escalate to PO

### 2.5 — Merge Commission PRs

For reviewed commissions (review clean):

1. Merge the PR to master
   ```bash
   gh pr merge {pr_number} --merge
   ```
   Or via GitHub MCP tools if configured.

2. Update plan status: commission → `done`

3. After each merge, check:
   - Do any blocked commissions become eligible? → add to next wave
   - Does this satisfy any acceptance gate? → update gate status

**Merge order within a wave:** If multiple PRs in the same wave are ready, merge
sequentially (not simultaneously) to avoid conflicts. After each merge, pull latest
master before merging the next.

**Merge conflicts:** If a merge fails due to conflicts:
- Spawn a conflict-resolution sub-agent with both branches
- The sub-agent resolves conflicts, pushes, re-runs gates
- Orchestrator re-reviews after resolution

### 2.6 — Wave Completion Check

After all commissions in a wave are `done`:

1. Pull latest master (all wave PRs now merged)
2. Run full gate verification on master:
   ```bash
   {build_command} && {test_command} && {lint_command}
   ```
3. If gates fail on master after merge:
   - Identify which commission's merge introduced the failure
   - Spawn a fix sub-agent on master (new branch, not on commission branch)
   - Fix → PR → review → merge
4. If gates pass: proceed to next wave (2.1)

### 2.7 — Commission Loop Exit

The loop exits when:

| Condition | Action |
|-----------|--------|
| All commissions `done`, all gates pass | Proceed to Phase 3 |
| Commission marked `impossible` | Escalate to PO, pause |
| 3+ fix cycles on same commission | Escalate — structural issue |
| All waves complete but acceptance gates fail | Spawn targeted fix commissions (Phase 2.8) |

### 2.8 — Gap Commissions

If all planned commissions are `done` but acceptance gates still fail:

1. Identify which gates are failing and why
2. Decompose the gap into new commissions (same format as 1.2)
3. Add to plan as a new wave
4. Re-enter commission loop (2.1)

Maximum 2 gap waves. If acceptance gates still fail after 2 gap waves: escalate.

---

## Phase 3 — Final Verification

### 3.1 — Full Acceptance Gate Check

On master (all commissions merged), verify every acceptance gate:

```
For each gate in plan.gates:
  Run gate.verification
  Record: PASS or FAIL with details
```

### 3.2 — Integration Review

Run `/review-pipeline` on the full diff from before the first commission to current master.
This catches cross-commission issues that per-commission reviews missed.

If findings:
- CRITICAL/HIGH: spawn fix sub-agent on master
- MEDIUM/LOW: record in final report

### 3.3 — PRD Status Update

If all acceptance gates pass:
- Update the PRD's status line from "Draft" to "Implemented"
- Add implementation date

### 3.4 — Realization Report

Write to `tmp/realize-report-{prd-slug}-{date}.md`:

```markdown
# Realization Report: PRD {N} — {title}

**Status:** {Realized | Partial | Blocked}
**Date:** {YYYY-MM-DD}
**Commissions:** {completed}/{total}
**Waves:** {N}
**Sub-agent sessions:** {total spawned}
**Fix cycles:** {total fix sub-agents spawned}
**Merge conflicts:** {count}

## Acceptance Gates

| # | Criterion | Status | Verified By |
|---|-----------|--------|-------------|
| 1 | ... | PASS | ... |

## Commissions Summary

| ID | Title | PR | Status | Fix Cycles |
|----|-------|----|--------|------------|
| C-1 | ... | #N | done | 0 |

## Issues & Escalations

- {any issues encountered, decisions made, escalations to PO}

## Deferred Items

- {anything explicitly deferred during realization}
```

### 3.5 — Report to PO

> *"PRD {N} realized. {M}/{N} commissions completed across {K} waves.
> {G} acceptance gates: {pass_count} PASS, {fail_count} FAIL.
> Report at `tmp/realize-report-{slug}-{date}.md`.
> {If any gates failed: 'Remaining gaps: {list}. Escalating for decision.'}"*

---

## Resumability

### Plan File as Checkpoint

The realization plan (`tmp/realize-plan-{slug}-{date}.md`) IS the checkpoint.
It tracks: commission statuses, wave progress, gate results. On resume:

1. Re-read the plan file
2. Identify commissions in `in_progress` — check their branches/PRs for status
3. Identify commissions in `pending` whose dependencies are now `done`
4. Resume from the current wave

### Orchestrator Context Management

The orchestrator's context stays small by:
- Delegating all implementation to sub-agents (they hold the code context)
- Keeping only the plan, commission cards, and gate results in working memory
- Reading sub-agent results as summaries (PR URL + gate status), not full transcripts
- Using the plan file as persistent state (not in-context memory)

---

## Anti-patterns

- **Do not implement code in the orchestrator.** The orchestrator plans, commissions,
  reviews, and merges. If you're writing implementation code, you've lost the plot.
  Spawn a sub-agent.
- **Do not hold sub-agent transcripts in context.** Read their result summary (PR URL,
  status, blockers). The full transcript is in their worktree output file.
- **Do not merge without review.** Every commission PR gets `/review-pipeline` before merge.
  No exceptions, even for "trivial" changes.
- **Do not skip gap commissions.** If acceptance gates fail after all planned commissions,
  the gap is real work that needs a commission, not a quick fix in the orchestrator.
- **Do not run more than 2 gap waves.** If the PRD can't be realized after planned
  commissions + 2 gap waves, the problem is in the PRD or the architecture, not in
  the implementation. Escalate.
- **Do not parallelize merges.** Merge one PR at a time to master, pull between merges.
  Parallel merges create conflict cascades.
- **Do not continue after an `impossible` classification.** If a sub-agent reports a
  commission is impossible (spec contradiction, architecture limitation), stop and
  escalate. Spawning more agents won't fix a design problem.
- **Do not update the PRD during realization.** The PRD is the spec. If it needs changes,
  that's a PO decision, not an orchestrator decision. Escalate.
