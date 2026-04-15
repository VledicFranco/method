---
title: "Overnight Autonomous Mission — Method PRDs 061-068"
status: active
started: 2026-04-15
owner: Francisco Aramburo (via autonomous loop)
loop_cadence: dynamic (ScheduleWakeup; 1200-1800s intervals default)
loop_sentinel: <<autonomous-loop-dynamic>>
---

# Overnight Autonomous Mission

> Deliver the remaining 8 method PRDs (061-068) to master, each gated by
> `/fcd-commission` implementation + `/fcd-review` quality pass + local tests
> green + merge. Ship in three waves respecting dependency order. Partial
> scope only where Cortex-side or research-side blockers are explicit.

---

## 0. Loop orientation (every wake-up)

Each time the loop fires, the running agent MUST:

1. **Read this file first** — it is the source of truth for mission state.
2. **`git fetch origin && git log --oneline master -20`** — confirm current master head.
3. **Check §3 state tracker** — read it, update it (the agent updates this file itself at each iteration).
4. **Check PR state** — use `mcp__github-personal__list_pull_requests` to see open + recently-merged PRs for `VledicFranco/method`.
5. **Decide next action** (see §4 decision tree).
6. **Fire subagent(s) or merge PR(s)** per decision.
7. **`ScheduleWakeup`** with delay 1200-1800s and sentinel `<<autonomous-loop-dynamic>>` — continue the loop. Omit only when mission §5 is fully met.

---

## 1. Deliverables

### Fully deliverable PRDs (6)

| PRD | Title | Size | Blockers inside our control? |
|---|---|---|---|
| 061 | `CortexSessionStore` + checkpoint resume | M | none — S4 frozen |
| 062 (Wave 1) | `JobBackedExecutor` (`fresh-per-continuation` mode only) | M-minus | Wave 2 `batched-held` deferred — needs Cortex O1 |
| 063 | `CortexEventConnector` | S | none — S6 frozen |
| 064 | `CortexMethodologySource` + admin API | M | none — S7 frozen |
| 065 | Conformance testkit (`@method/pacta-testkit/conformance` subpath) | S | none — S8 frozen |
| 066 (Track A) | methodts→Cortex mapping + Model-A deploy-time registration | M-minus | Track B deferred — needs Cortex O5/O6/O7 |

### Partial-only PRDs (2)

| PRD | Title | Ship status |
|---|---|---|
| 067 | Multi-app strategy execution | Design + `InProcessCrossAppInvoker` simulator only. Real `CortexCrossAppInvoker` blocked on Cortex PRD-080. |
| 068 | Cognitive modules as Cortex tenant apps | Wave 1 skeleton only — 3 tenant-app scaffolds (Monitor, Planner, Memory). Full cognitive validation gated on R-26c research rerun. |

### Quality bar per PRD

**IMPORTANT — subagents tend to stop short when context pressure hits.** The loop MUST verify completeness independently before trusting any subagent's "complete" report. A reported PR is necessary but NOT sufficient evidence of completion.

Each PRD gates through this pipeline (NO merge until all five gates pass):

**Gate 1 — Commission landed**
- Commission subagent invoked `/fcd-commission` and opened a PR via `mcp__github-personal__create_pull_request`
- Branch pushed to origin with commits carrying co-author trailer

**Gate 2 — Completeness audit (the loop does this, not the subagent)**
- Loop checks out the feat branch locally: `git fetch origin && git checkout <branch>`
- `npm run build` → must exit 0 with no TypeScript errors
- Grep for placeholder markers in changed files: `rg -n 'TODO\|FIXME\|STUB\|not yet implemented\|placeholder\|throw new Error.*TBD' <changed-paths>` → must return 0 matches in code added by this PR (comments referencing deferred open questions O1-O11 are acceptable if explicitly tied to a roadmap follow-up)
- File count: compare files changed by the PR to the in-scope file list from the PRD's §Scope / §Architecture section. If expected files are missing → INCOMPLETE.
- Acceptance gates: each PRD defines gates (G-*). Count active vs placeholder vs deferred. Any active gate without a passing test is INCOMPLETE.
- Workspace tests: `npm --workspace=<workspace> test` → must be green except for the known pre-existing failure list documented in the mission
- Sample-app tests (if this PRD touches them): must be green

**Gate 3 — Fill gaps (continuation subagent if needed)**
- If Gate 2 finds gaps, fire a continuation subagent with a tight scoped prompt listing every gap by file/line and requiring all to be addressed before reporting complete
- Gate 2 runs again after the continuation returns
- Maximum two continuation rounds per PRD before escalating — if still incomplete, write `.method/sessions/ESCALATION-PRD-XXX-incomplete.md` and park the PRD

**Gate 4 — `/fcd-review` signoff**
- Separate review subagent invokes `/fcd-review` against the PR + branch
- Review findings are classified: "no blocking" / "resolvable in-PR" / "architectural escalation"
- Resolvable findings addressed with additional commits before merge
- Blocking architectural findings → ESCALATION file, pause PRD

**Gate 5 — Final tests + merge**
- After review fixes land: `npm run build` green, all relevant workspace tests green
- Merge via `mcp__github-personal__merge_pull_request(merge_method='merge')`
- Delete feature branch; pull master; verify master builds green

Per-commit discipline: Conventional Commits + co-author trailer `Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>` on every commit including continuation fixes and review fixes.

---

## 2. Wave structure (dependency-ordered, parallel intra-wave)

```
Wave 1 (parallel, 4 subagents — all independent after master at 22d2a73):
  • PRD-061 — feat/prd-061-session-store      → PR → master
  • PRD-063 — feat/prd-063-event-connector    → PR → master
  • PRD-064 — feat/prd-064-methodology-source → PR → master
  • PRD-065 — feat/prd-065-conformance-testkit→ PR → master

Wave 2 (parallel, 2 subagents — needs Wave 1 merged):
  • PRD-062 Wave 1 — feat/prd-062-job-executor → PR → master
  • PRD-066 Track A — feat/prd-066-mcp-transport → PR → master

Wave 3 (parallel, 2 subagents — partial):
  • PRD-067 simulator — feat/prd-067-cross-app-sim → PR → master
  • PRD-068 Wave 1 skeleton — feat/prd-068-cognitive-apps → PR → master

Per PR (before merge):
  • /fcd-review subagent spawned; findings addressed with additional commits
  • Merge PR; delete feature branch; pull master
```

Intra-wave PRs merge as they finish; inter-wave serialization enforced by the
loop (Wave N+1 doesn't fire until Wave N is fully merged to master).

---

## 3. Live state tracker (loop updates this)

**Master head:** `22d2a73` (at mission start)

**Wave state:**

| Wave | PRD | Branch | PR | Status |
|---|---|---|---|---|
| 1 | 061 | feat/prd-061-session-store | TBD | pending |
| 1 | 063 | feat/prd-063-event-connector | TBD | pending |
| 1 | 064 | feat/prd-064-methodology-source | TBD | pending |
| 1 | 065 | feat/prd-065-conformance-testkit | TBD | pending |
| 2 | 062 | feat/prd-062-job-executor | TBD | blocked on Wave 1 |
| 2 | 066 | feat/prd-066-mcp-transport | TBD | blocked on Wave 1 |
| 3 | 067 | feat/prd-067-cross-app-sim | TBD | blocked on Wave 2 |
| 3 | 068 | feat/prd-068-cognitive-apps | TBD | blocked on Wave 2 |

**Iteration log:** (agent appends here each wake)

- **2026-04-15 kickoff** — mission doc committed at `0b71030`. Wave 1 fired in background: 4 async subagents (PRD-061 session-store, PRD-063 event-connector, PRD-064 methodology-source, PRD-065 conformance-testkit). Each in its own worktree at `.claude/worktrees/agent-<id>/`. First wake-up scheduled for ~25 min.
- **2026-04-15 protocol update** — **adaptation triggered by user feedback + mid-flight LSP diagnostics** showing partial work in worktree states: PRD-061 (`checkpoint-sink-impl.ts` type mismatches + uninitialized `_workerId`), PRD-064 (`MethodologyChange` missing export + `MethodologyDocument` index-signature failures), PRD-065 (missing fixture files + broken imports, `TokenUsage` mismatch). These are subagent-in-flight states but confirm the risk pattern. Protocol tightened: §Quality bar replaced with 5-gate pipeline, §4 decision tree rewritten with Gate-2 locally-run completeness audit, TRUST MODEL added. Subagent "complete" reports are no longer sufficient — loop independently runs Gate 2 (`npm run build` + grep markers + file count + gates + tests) LOCALLY before advancing status. Continuation cap = 2 rounds before escalation.

**Escalation markers:** (agent creates files at `.method/sessions/ESCALATION-*.md` if an architectural contradiction arises; list them here)

- _(none)_

---

## 4. Decision tree (what to do when the loop wakes)

```
ORIENT
  fetch origin; list open PRs; read §3 state tracker; read last iteration log
  │
  ▼
PLAN — per PRD, apply the 5-gate pipeline from §Quality bar per PRD:

  IF Wave N has PRDs with status="pending" AND no subagent in flight for that PRD:
    → fire PRD commission subagent (isolation=worktree, run_in_background=true)
    → update §3: status="commissioned"

  IF a commission subagent returned with a PR (Gate 1 passed):
    → run Gate 2 (completeness audit) LOCALLY — loop does this, not the subagent:
        • git fetch + checkout the feat branch
        • npm run build → must exit 0
        • rg for TODO/FIXME/STUB/placeholder in changed files → must be 0
        • file count check vs PRD §Scope
        • acceptance gates check (G-* tests passing)
        • workspace tests green
    → IF Gate 2 PASSES: status="audited", proceed to Gate 4
    → IF Gate 2 FAILS: Gate 3 — fire continuation subagent with explicit gap list
        ◦ continuation_count++; if continuation_count > 2 → ESCALATE (see below)
        ◦ Gate 2 re-runs after the continuation returns

  IF status="audited":
    → fire /fcd-review subagent (Gate 4)
    → classify findings: "no blocking" / "resolvable in-PR" / "architectural escalation"
    → resolvable: fire fix subagent, re-run Gate 2 + Gate 4 after fixes land
    → blocking architectural: ESCALATION file, pause PRD, continue other PRDs

  IF Gate 4 clean AND Gate 5 (final tests green) passes:
    → merge via mcp__github-personal__merge_pull_request(merge_method='merge')
    → delete feature branch on origin
    → git checkout master; git pull; verify master still builds green
    → update §3: status="merged"

  IF Wave N fully resolved (all PRDs status="merged" or "escalated"):
    → promote Wave N+1 from "blocked" to "pending"

  IF all 3 waves resolved:
    → run §5 final checklist; omit ScheduleWakeup to end loop

ESCALATE triggers (halt PRD, continue mission):
  • Surface contradiction (architectural — can't fix without mutating frozen decision.md)
  • Continuation count > 2 without reaching completeness
  • /fcd-review finds architectural violation

ESCALATE marker file: .method/sessions/ESCALATION-PRD-XXX-<reason>.md with:
  • What gate failed
  • What's missing
  • What the subagent tried
  • Recommended resolution (e.g. Cortex follow-up needed, surface amendment needed)

EXECUTE → VERIFY (Gates 2+5) → COMMIT → UPDATE (state tracker + iteration log) → ESCALATE?
  if yes → halt this PRD, continue mission with remaining PRDs
  if no  → ScheduleWakeup 1200-1800s with sentinel <<autonomous-loop-dynamic>>

TRUST MODEL: subagents report what they intended, not what they finished. The loop
verifies independently. Every subagent claim is audited against the filesystem +
build + tests before status advances. No PR gets merged on a subagent's word alone.
```

---

## 5. Final checklist (before ending the loop)

- [ ] All 8 PRD branches merged or formally escalated
- [ ] `npm run build` green on master
- [ ] Key workspace tests green: pacta, pacta-provider-cortex, agent-runtime, runtime, bridge (excluding pre-existing triggers + build hangs), each new PRD's workspace
- [ ] Roadmap updated — `docs/roadmap-cortex-consumption.md` §11 table shows merged PRDs as ✔️ implemented
- [ ] Morning report written at `docs/overnight-mission-report-2026-04-15.md` — tables per §6
- [ ] All feature branches deleted from origin
- [ ] Task list: all 5 overnight tasks in TaskList completed

---

## 6. Morning report structure

The final iteration writes `docs/overnight-mission-report-2026-04-15.md` with:

1. **Executive summary** (3-5 sentences): PRDs merged, PRDs escalated, overall quality delta
2. **Per-PRD table**: PRD | PR # | Commission SHA | Review SHA(s) | Merge SHA | Test counts | Quality bar status
3. **Escalations table** (if any): PRD | Contradiction | Surface affected | Proposed resolution
4. **Iteration log** (full list of wake-ups with summaries)
5. **Next recommended actions** (e.g. Cortex follow-ups, research gates)

---

## 7. Constraints (non-negotiable — every subagent inherits these)

- Repo scope: `VledicFranco/method` only. NEVER `t1-repos/*`. Use `mcp__github-personal__*` for GitHub ops; NEVER `gh` CLI.
- Git safety: NEVER `--no-verify`, NEVER `git push --force`, NEVER merge master without tests green.
- CLAUDE.md DR-01..DR-14 apply. Do NOT touch: `registry/` YAML, `theory/`, `.method/project-card.yaml`, `co-design/` signoff files (PRD-060 is under Cortex custody now), frozen surface `decision.md` files.
- Frozen surfaces are law: if a PRD's implementation reveals a surface contradiction, HALT (create ESCALATION marker), do NOT mutate the surface.
- Co-author trailer mandatory on every commit.
- Each PR = one PRD (or one clean scope chunk of one PRD). No cross-PRD PRs.
- Pre-existing test hangs (triggers, build domain) stay pre-existing — not in scope to fix.

---

## 8. Subagent briefing template (the agent reuses this per PRD)

Each commission subagent prompt must include:

1. Working directory: `C:/Users/atfm0/Repositories/method-1/`
2. Read: `CLAUDE.md`, this mission file, the target PRD at `.method/sessions/fcd-design-prd-0XX-*/prd.md`, and the frozen surface decision.md that PRD implements
3. Branch strategy: `git checkout master && git pull && git checkout -b feat/prd-0XX-<slug>`
4. Invoke `Skill(skill="fcd-commission", args="<PRD path>")`
5. Run build + workspace tests; fix root causes of any breaks introduced
6. Open PR via `mcp__github-personal__create_pull_request`, base=master
7. Report back with PR URL, commits, test evidence, any scope deferred, any surprises
8. Constraints: the list in §7 above

Each /fcd-review subagent prompt must include:

1. Working directory + read list (same as commission)
2. PR number + branch name to review
3. Invoke `Skill(skill="fcd-review", args="PR #<N> branch feat/prd-0XX-<slug>")`
4. Classify findings: "no blocking" / "resolvable in same PR" / "architectural escalation"
5. If resolvable: fix in-branch + commit + push
6. Report back with findings classification and any additional commits

---

_This document is the north star. The loop reads it; the loop updates §3 and the iteration log. Nothing outside this document is stable ground during the overnight run._
