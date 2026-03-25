---
name: realize
description: >
  PRD realization orchestrator — decomposes a PRD into commissions along FCA boundaries,
  spawns sub-agents via /com to implement each part, and loops until the entire PRD is
  fully implemented or impossible. Uses FCA domain structure to guarantee conflict-free
  parallel execution. The orchestrator never writes implementation code — it plans,
  commissions, integrates shared surfaces, and verifies acceptance gates.
  Trigger phrases: "realize", "implement this PRD end to end", "realize this PRD",
  "full PRD implementation".
disable-model-invocation: true
argument-hint: "[PRD path — e.g. 'docs/prds/027-pacta.md']"
---

# /realize — PRD Realization Orchestrator

> Decomposes a PRD along FCA boundaries into commissions, spawns `/com` sub-agents to
> implement each, integrates their work, and loops until the PRD is fully realized.

```
PRD → Plan (FCA-partitioned) → Commission Loop:
  [ shared surface prep → /com sub-agents (parallel) → merge → gate check ]
  ...repeat per wave until all acceptance criteria pass...
→ Integration Review → PRD Realized
```

**Core principles:**
1. The orchestrator **never writes implementation code** — it plans, commissions,
   integrates shared surfaces (ports, exports), and verifies.
2. **FCA boundaries are commission boundaries.** Each commission maps to one domain or
   package. Domains don't import each other → commissions can't conflict in domain code.
3. **`/com` owns the full implementation lifecycle** per commission (spec verification,
   design, implement, review, PR). The orchestrator owns the cross-commission lifecycle
   (wave sequencing, shared surfaces, integration, merge, acceptance gates).
4. The orchestrator's context stays small — it holds the plan, not the code.

---

## When to use

- A PRD has multiple phases or deliverables spanning different FCA domains/packages
- The work is too large for a single `/com` session (> 5 tasks, multiple packages)
- You want gated quality across the entire PRD with integration review
- The PRD has explicit acceptance criteria and success criteria to verify

## When NOT to use

- Single-domain PRDs with < 5 tasks — use `/com` directly
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
packages, governance, delivery rules. Same as `/com` Phase 0.1.

### 0.3 — FCA Domain Survey

Read the project's domain structure to identify commission boundaries:

```bash
# Enumerate domains
ls packages/*/src/domains/ 2>/dev/null
# Enumerate ports (shared interfaces)
ls packages/*/src/ports/*.ts 2>/dev/null
# Enumerate shared utilities
ls packages/*/src/shared/ 2>/dev/null
# Enumerate barrel exports
find packages/ -name "index.ts" -maxdepth 4
```

Produce an **FCA partition map**:

```
Domains (independent — can be commissioned in parallel):
  - sessions/     → owns: pty-session, pool, channels, spawn-queue
  - strategies/   → owns: pipeline, gates, execution
  - triggers/     → owns: file-watch, git, schedule, router
  - ...

Shared surfaces (orchestrator-owned — never modified by sub-agents):
  - ports/*.ts           → cross-domain interfaces
  - shared/*.ts          → cross-domain utilities
  - */index.ts           → barrel exports (package + domain level)
  - package.json         → dependency declarations
  - tsconfig.json        → build configuration

Layer stack:
  L4 bridge → L3 mcp, pacta → L2 methodts → (no L1, L0)
```

**The FCA guarantee:** Domains don't import each other — they communicate through ports.
Two commissions touching different domains are structurally incapable of creating merge
conflicts in domain code. The only conflict surfaces are shared surfaces, which the
orchestrator handles.

### 0.4 — Create Realization Session

```
session_id: realize-{YYYYMMDD}-{HHMM}-{prd-slug}
```

Create session directory: `.method/sessions/{session_id}/`

---

## Phase 1 — Realization Plan

### 1.1 — Decompose PRD into Commissions (FCA-Partitioned)

Analyze the PRD's phases and deliverables. Decompose into **commissions** — independent
units of work, each suitable for a single `/com` sub-agent session.

**FCA decomposition rules:**
1. **One commission = one domain or one package.** FCA boundaries are commission boundaries.
   If a PRD phase creates a new package (`@method/pacta-testkit`), that's one commission.
   If it modifies an existing domain (`sessions/`), that's one commission.
2. **No two commissions in the same wave touch the same domain.** FCA guarantees domain
   independence. The orchestrator enforces this structurally, not by convention.
3. **Shared surfaces are never in commission scope.** Port interfaces (`ports/*.ts`),
   barrel exports (`index.ts`), package config (`package.json`, `tsconfig.json`), and
   shared utilities (`shared/*.ts`) are modified only by the orchestrator between waves.
4. **Cross-domain work spawns multiple commissions.** If a deliverable requires changes
   in both `sessions/` and `strategies/`, split it into two commissions — one per domain —
   with the port change handled by the orchestrator between them.
5. **New ports are orchestrator work.** If Commission B depends on a port that Commission A
   defines, the orchestrator creates the port interface between waves (after A, before B).
6. **Commission size: 3-8 tasks** (matching `/com`'s nu_B budget of 5 iterations).
   If a domain's work exceeds 8 tasks, split into sequential commissions within that domain.

### 1.2 — Identify Shared Surface Changes

For each wave, explicitly enumerate what the orchestrator must modify:

```yaml
shared_surface_changes:
  pre_wave_1: []  # nothing needed before first wave
  pre_wave_2:
    - file: "packages/pacta/src/ports/agent-provider.ts"
      change: "Add Streamable interface (needed by C-3)"
      reason: "C-3 implements streaming; port must exist before it starts"
    - file: "packages/pacta/src/index.ts"
      change: "Re-export new types from C-1 and C-2 deliverables"
      reason: "Barrel export must include types from Wave 1 before Wave 2 consumes them"
  pre_wave_3:
    - file: "package.json"
      change: "Add @method/pacta-playground workspace entry"
      reason: "C-5 creates new package; monorepo config must be updated first"
```

**Rule:** The orchestrator makes these changes itself (it is allowed to edit shared
surfaces). These are small, structural changes — not implementation code. Typically:
adding a re-export line, adding a port interface signature, updating a workspace config.
If a shared surface change requires more than ~20 lines, it should be a commission.

### 1.3 — Define Commission Cards

For each commission, produce a card:

```yaml
- id: C-{N}
  phase: {PRD phase number}
  title: "{what this commission implements}"
  domain: "{FCA domain or package this commission owns}"
  scope:
    allowed_paths:
      - "packages/{pkg}/src/domains/{domain}/**"
      - "packages/{pkg}/src/domains/{domain}.test.ts"
    forbidden_paths:
      - "packages/*/src/ports/*"      # orchestrator-owned
      - "packages/*/src/shared/*"     # orchestrator-owned
      - "packages/*/src/index.ts"     # orchestrator-owned
      - "packages/*/package.json"     # orchestrator-owned
  depends_on: [C-{M}, ...]
  parallel_with: [C-{K}, ...]
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

**The `forbidden_paths` field is the FCA enforcement.** Sub-agents are told not to modify
these paths. `/com`'s scope enforcement (Phase A+ boundary map + Phase C FCA sweep) will
catch violations. The orchestrator double-checks on merge.

### 1.4 — Define Acceptance Gates

For each PRD success criterion, define how the orchestrator verifies it:

```yaml
gates:
  - criterion: "{success criterion text}"
    verification: "{how to verify — command, test, manual check}"
    commission_ids: [C-{N}, ...]
    status: pending
```

### 1.5 — Write the Realization Plan

Write the plan to `.method/sessions/{session_id}/realize-plan.md`:

```markdown
# Realization Plan: PRD {N} — {title}

## FCA Partition Map

{from Phase 0.3}

## Commissions

| ID | Phase | Domain/Package | Title | Depends On | Status |
|----|-------|---------------|-------|------------|--------|
| C-1 | 1 | @method/pacta core | ... | — | pending |
| C-2 | 1 | @method/pacta-testkit | ... | — | pending |
| C-3 | 2 | @method/pacta-playground | ... | C-1, C-2 | blocked |

## Shared Surface Changes

| Wave | File | Change | Reason |
|------|------|--------|--------|
| pre-2 | ports/agent-provider.ts | Add Streamable | Needed by C-3 |

## Execution Order

Wave 1 (parallel): C-1, C-2 — disjoint packages, zero shared files
  → orchestrator: shared surface changes for Wave 2
Wave 2 (parallel): C-3, C-4
  → orchestrator: shared surface changes for Wave 3
Wave 3: C-5

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

### 1.6 — Present Plan to PO

Present the plan summary:
> *"Realization plan for PRD {N}: {M} commissions across {K} waves.
> FCA partition: {domains/packages involved}.
> Shared surface changes: {N} between-wave edits by orchestrator.
> Wave 1 ({parallel count}): {commission titles}.
> Total acceptance gates: {N}.
> Proceed?"*

Wait for PO approval before executing.

---

## Phase 2 — Commission Loop

### 2.1 — Pre-Wave: Shared Surface Preparation

Before launching any wave, apply the shared surface changes for this wave from the plan:

1. Pull latest master
2. Create a short-lived branch: `chore/{prd-slug}-wave-{N}-prep`
3. Apply the shared surface changes (port interfaces, barrel exports, package config)
4. Run gates: `{build_command} && {test_command}`
5. Commit, push, merge to master immediately (these are structural-only, no implementation)
6. This ensures sub-agents find the ports/types they need already on master

**If no shared surface changes are needed for this wave:** skip directly to 2.2.

### 2.2 — Select and Launch Wave

From the plan, identify commissions whose dependencies are all satisfied (status = done).
Group them into the current wave. All commissions in a wave touch different FCA domains
(guaranteed by the partition in 1.1).

For each commission, spawn a sub-agent:

```typescript
Agent({
  prompt: `Execute /com with this task:

"${commission.title}"

Domain: ${commission.domain}
Branch: ${commission.branch} (create from master)
Base branch: master

Allowed paths (your scope):
${commission.scope.allowed_paths.join('\n')}

Forbidden paths (orchestrator-owned — do NOT modify):
${commission.scope.forbidden_paths.join('\n')}

Deliverables:
${commission.deliverables.map(d => `- ${d}`).join('\n')}

Acceptance criteria:
${commission.acceptance_criteria.map(c => `- ${c}`).join('\n')}

/com will handle: spec verification, design, implementation, review, and PR creation.
Do NOT merge the PR — the orchestrator merges after integration checks.
Report back with: PR number, gate results, any blockers.`,
  isolation: 'worktree',
  run_in_background: true,
})
```

**Launch all commissions in the wave simultaneously** — batch all Agent calls in one
message. FCA guarantees they touch disjoint domains, so parallel execution is conflict-free
in domain code.

**Git workflow:** Each sub-agent runs in its own worktree (`isolation: 'worktree'`).
Inside the worktree, `/com` creates a feature branch from master, implements, and pushes.
The worktree gives full git isolation — sub-agents can't interfere with each other's
staging, branches, or commits. Shared surface prep (2.1) must be merged to master BEFORE
spawning the wave so that `/com`'s `git checkout -b feat/... master` picks up the latest
ports and exports.

### 2.3 — Monitor Commissions

As sub-agents complete:

1. Read the sub-agent's result (PR number, gate status, blockers)
2. Update the plan's status tracker:
   - `done` — `/com` completed, PR created, gates pass, review clean
   - `failed` — sub-agent reported blockers or impossible task
   - `pr_ready` — PR created, ready for orchestrator merge

**If a sub-agent reports `failed`:**
- Read the failure reason
- Classify: `fixable` (code issue) or `impossible` (spec contradiction, design issue)
- If `fixable`: spawn a new sub-agent with failure context + guidance
- If `impossible`: pause the wave, escalate to PO

**Key insight: `/com` already runs its own `/review-pipeline` (Phase C).** The orchestrator
does NOT re-review each commission PR. Instead, it trusts `/com`'s review and focuses on
cross-commission concerns:
- Did the sub-agent stay within its allowed paths? (check with `git diff --name-only`)
- Did it modify any forbidden paths? (shared surfaces)
- Do gates pass on master after merge?

### 2.4 — Scope Verification

Before merging each PR, the orchestrator runs a lightweight scope check:

```bash
# Get files changed by this commission
git diff --name-only master...${commission.branch}

# Verify all changes are within allowed_paths
# Verify no changes in forbidden_paths
```

**If a sub-agent modified a forbidden path** (port, shared utility, barrel export):
- Do NOT merge
- Read the change — if it's a legitimate need (new port the sub-agent discovered was
  needed), the orchestrator applies the change itself on master and re-commissions the
  domain-specific part
- If it's accidental scope creep: reject, spawn fix sub-agent to revert

### 2.5 — Sequential Merge

For commissions with `pr_ready` status that pass scope verification:

1. Merge PRs to master **one at a time, sequentially**:
   ```bash
   git checkout master && git pull
   # Merge using the project's GitHub tool (from project card)
   ```
   Use the card's `github.tool` for merging (same as `/com` uses for PR creation).

2. After EACH merge, verify gates on master:
   ```bash
   {build_command} && {test_command}
   ```

3. If gates fail after a merge:
   - The most recently merged commission likely broke something
   - Spawn a fix sub-agent targeting the integration failure
   - Fix → push to new branch → PR → merge

4. After each successful merge, update plan: commission → `done`

**Merge order:** If commissions have implicit ordering hints (one produces types the
other might reference through re-exports), merge the producer first.

### 2.6 — Wave Completion

After all commissions in a wave are `done` and merged:

1. Pull latest master
2. Run full gate verification:
   ```bash
   {build_command} && {test_command} && {lint_command}
   ```
3. If gates pass: proceed to shared surface prep for next wave (2.1)
4. If gates fail: identify the cross-commission interaction that broke, commission a fix

### 2.7 — Commission Loop Exit

| Condition | Action |
|-----------|--------|
| All commissions `done`, all gates pass | Proceed to Phase 3 |
| Commission marked `impossible` | Escalate to PO, pause |
| 3+ fix attempts on same commission | Escalate — structural issue |
| All waves done but acceptance gates fail | Gap commissions (2.8) |

### 2.8 — Gap Commissions

If all planned commissions are `done` but acceptance gates still fail:

1. Identify which gates are failing and why
2. Decompose the gap into new commissions (same FCA partitioning rules)
3. Identify shared surface changes needed for gap wave
4. Add to plan as a new wave
5. Re-enter commission loop (2.1)

Maximum 2 gap waves. If acceptance gates still fail after 2 gap waves: escalate to PO.

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
This is the **only full review the orchestrator runs** — it catches cross-commission issues
that per-commission `/com` reviews couldn't see (because each `/com` only sees its own domain).

Focus areas for advisors:
- **FCA boundary violations** across commission boundaries
- **Port coherence** — do the ports the orchestrator created actually match how commissions use them?
- **Integration gaps** — dead code paths, missing wiring, untested cross-domain interactions

If findings:
- CRITICAL/HIGH: spawn fix sub-agent on master
- MEDIUM/LOW: record in final report

### 3.3 — PRD Status Update

If all acceptance gates pass:
- Update the PRD's status line from "Draft" to "Implemented"
- Add implementation date

### 3.4 — Realization Report

Write to `.method/sessions/{session_id}/realize-report.md`:

```markdown
# Realization Report: PRD {N} — {title}

**Status:** {Realized | Partial | Blocked}
**Date:** {YYYY-MM-DD}
**Session:** {session_id}
**Commissions:** {completed}/{total}
**Waves:** {N}
**Sub-agent sessions:** {total spawned, including fix agents}
**Shared surface changes:** {count applied by orchestrator}
**Merge conflicts:** {count}

## FCA Partition

{domains/packages, which commission owned which}

## Acceptance Gates

| # | Criterion | Status | Verified By |
|---|-----------|--------|-------------|
| 1 | ... | PASS | ... |

## Commissions Summary

| ID | Domain | PR | Status | Fix Cycles |
|----|--------|----|--------|------------|
| C-1 | pacta core | #N | done | 0 |

## Shared Surface Changes

| Wave | File | Change |
|------|------|--------|
| pre-2 | ports/... | Added Streamable |

## Integration Review

{summary of Phase 3.2 findings, if any}

## Issues & Escalations

- {any issues encountered, decisions made, escalations to PO}

## Deferred Items

- {anything explicitly deferred during realization}
```

### 3.5 — Report to PO

> *"PRD {N} realized. {M}/{N} commissions completed across {K} waves.
> FCA partition: {N} domains, {M} shared surface changes by orchestrator.
> {G} acceptance gates: {pass_count} PASS, {fail_count} FAIL.
> Integration review: {clean | N findings}.
> Report at `.method/sessions/{session_id}/realize-report.md`.
> {If any gates failed: 'Remaining gaps: {list}. Escalating for decision.'}"*

---

## Resumability

### Plan File as Checkpoint

The realization plan (`.method/sessions/{session_id}/realize-plan.md`) IS the checkpoint.
It tracks: commission statuses, wave progress, gate results. On resume:

1. Re-read the plan file
2. Check commission branches/PRs for current status (some may have completed while
   the orchestrator was offline)
3. Identify commissions in `pending` whose dependencies are now `done`
4. Resume from the current wave

### Orchestrator Context Management

The orchestrator's context stays small by:
- Delegating all implementation to `/com` sub-agents (they hold the code context)
- Keeping only the plan, commission cards, and gate results in working memory
- Reading sub-agent results as summaries (PR number + status), not full transcripts
- Using the plan file as persistent state (not in-context memory)
- Never reading source code — only git diffs, gate output, and plan state

---

## Relationship Between /realize and /com

`/realize` and `/com` have a clear division of responsibility:

| Concern | `/realize` (orchestrator) | `/com` (sub-agent) |
|---------|--------------------------|-------------------|
| **Scope** | Entire PRD | One commission (one domain/package) |
| **Code** | Never writes implementation | Full implementation lifecycle |
| **Branches** | Shared surface prep branches | Feature branch per commission |
| **PRs** | Merges commission PRs to master | Creates PR, marks ready for review |
| **Review** | Integration review (Phase 3, cross-commission) | Per-commission review (Phase C) |
| **Shared surfaces** | Owns ports, exports, config | Forbidden from modifying |
| **Design** | FCA partition, wave ordering | Domain-scoped FCA design (Phase A+) |
| **Git** | Sequential merge to master | Commits to own branch |
| **Quality gates** | Post-merge verification on master | Per-branch verification |

**`/com` is unmodified.** The orchestrator passes the commission as `/com`'s task. `/com`
creates its own branch, does its full lifecycle (A → A+ → B → C), creates a PR, and
reports completion. The orchestrator never reaches inside `/com`'s process.

**The orchestrator adds three things `/com` doesn't do:**
1. FCA-partitioned decomposition across domains
2. Shared surface management between waves
3. Cross-commission integration review on master

---

## Anti-patterns

- **Do not implement code in the orchestrator.** The orchestrator plans, commissions,
  integrates shared surfaces, and verifies. If you're writing domain code, spawn a sub-agent.
  The only code the orchestrator writes is shared surface changes (port interfaces, exports).
- **Do not re-review commission PRs.** `/com` already runs `/review-pipeline` in Phase C.
  The orchestrator trusts `/com`'s review for domain-scoped quality. The orchestrator's
  review (Phase 3) covers cross-commission integration — a concern `/com` can't see.
- **Do not let sub-agents modify shared surfaces.** Ports, barrel exports, package config,
  and shared utilities are orchestrator-owned. If a sub-agent needs a new port, the
  orchestrator creates it between waves. This is the FCA conflict prevention mechanism.
- **Do not parallelize commissions that touch the same domain.** FCA guarantees
  cross-domain independence. Same-domain parallelism has no such guarantee. If two
  commissions must touch the same domain, sequence them.
- **Do not hold sub-agent transcripts in context.** Read their result summary (PR number,
  status, blockers). The full transcript is in their worktree output file.
- **Do not parallelize merges.** Merge one PR at a time to master, verify gates between
  each merge. Parallel merges create conflict cascades even with FCA partitioning
  (shared surfaces like lockfiles can conflict).
- **Do not skip shared surface prep.** If Wave 2 needs a port that Wave 1 defined, the
  orchestrator must add the port to master before Wave 2 starts. Sub-agents that can't
  find expected ports will fail in Phase A+ (FCA boundary check).
- **Do not run more than 2 gap waves.** If the PRD can't be realized after planned
  commissions + 2 gap waves, the problem is in the PRD or the architecture. Escalate.
- **Do not continue after an `impossible` classification.** If a sub-agent says the
  commission is impossible, stop and escalate. More agents won't fix a design problem.
- **Do not update the PRD during realization.** The PRD is the spec. If it needs changes,
  that's a PO decision. Escalate.
