---
name: com
description: >
  Full-lifecycle implementation agent — goes from spec to clean PR autonomously.
  Loads the project card for configuration, raises confidence on specs (Phase A),
  designs with FCA (Phase A+), implements in a gated loop with periodic mandate
  reminders and adversarial review (Phase B), then runs hygiene and final review
  (Phase C). Manages its own feature branch, PR, checkpoints, and context continuity.
  Trigger phrases: "com", "implement end to end", "spec to PR", "full implementation",
  "commissioned implementation", "implement this PRD".
disable-model-invocation: true
argument-hint: "[task description, PRD path, or issue — e.g. 'implement docs/prds/019.md' or 'fix session leak in bridge spawn']"
---

# /com — Commissioned Implementation

> Autonomous spec-to-clean-PR agent. Card-configured, FCA-grounded, review-gated, self-checkpointing.

```
Task → Phase 0 (init) → Phase A (confidence) → Phase A+ (design)
     → Phase B loop (implement + review) → Phase C loop (hygiene + final review) → Clean PR
```

**Core mechanism:** The project card (`.method/project-card.yaml`) is the configuration source.
The mandate card (derived from project card + task + design) is the execution anchor.
A cron pulses the mandate card every 5 minutes to fight context decay.

---

## When to use

- You have a PRD, task, or issue and want to go from spec to merged-ready PR
- The project has a `.method/project-card.yaml` (or you can create a minimal one)
- The work involves implementation against an existing codebase with architecture docs
- You want gated quality, FCA compliance, and adversarial review built into the process

## When NOT to use

- Greenfield architecture design (no existing codebase) — use M6-ARFN first
- PRD writing or product discovery — outside niche
- Trivial bug fixes where the full pipeline is disproportionate — just fix the bug
- Tasks with no clear acceptance criteria — clarify the spec first
- Projects without FCA domain-co-located structure (skip or adapt Phase A+ and C.3)

---

## Phase 0 — Initialize

### 0.1 — Load Project Card

Read `.method/project-card.yaml`. Extract and hold in working memory:

| Card field | What you extract |
|---|---|
| `essence` | purpose, invariant, optimize_for |
| `context` | build_command, test_command, lint_command, language |
| `architecture` | fca_spec path, architecture_path, layer_stack, docs_root |
| `source_layout` | packages (name, path, layer, purpose), registry path |
| `delivery_rules` | full list — you will select 3-7 relevant ones later |
| `governance` | autonomy mode, max_autonomous_decisions, council_path |
| `role_notes` | impl_sub_agent notes, scope_enforcement rules |
| `processes` | all PR-XX items (trigger-action pairs) |

If the card has a `github` section, extract `github.tool` and `github.default_branch`.

If the card is missing, ask:
> *"No project card found at `.method/project-card.yaml`. I need at minimum: build_command, test_command, and a one-line purpose. Provide these or point me to the card."*

### 0.2 — Load Task Spec

If `$ARGUMENTS` is provided, use it as the task. Resolve file paths, issue numbers, or descriptions.
If not provided, ask:
> *"What should I implement? Give me a PRD path, issue number, or task description."*

Read the task spec thoroughly. Extract: objective, scope, acceptance criteria, implementation phases (if any).

### 0.3 — Resolve Git Configuration

Determine the base branch in priority order:
1. User-specified (from `$ARGUMENTS` or explicit instruction, e.g., "PR against dev")
2. Card's `github.default_branch` (if present)
3. Repo default: detect via `git symbolic-ref refs/remotes/origin/HEAD` → extract branch name

Determine the PR tool (card's `github.tool` is authoritative when present):
1. Card's `github.tool` (if present)
2. Infer from CLAUDE.md or project context (e.g., personal repos → `mcp__github-personal`, T1 repos → `gh`)
3. Default: `mcp__github-personal`

### 0.4 — Identifier Derivation

Generate identifiers before creating any files or branches:

```
task-slug derivation:
  - If task is a file path: use filename without extension (e.g., docs/prds/019.md → prd-019)
  - If task is an issue number: use issue-{N} (e.g., #47 → issue-47)
  - If task is a description: lowercase, replace spaces and special chars with hyphens,
    collapse consecutive hyphens, truncate to 40 chars
    (e.g., "fix session leak in bridge spawn" → fix-session-leak-in-bridge-spawn)

session_id derivation:
  Format: com-{YYYYMMDD}-{HHMM}-{task-slug}
  Example: com-20260324-1430-prd-019
```

### 0.5 — Check for Existing Session (Resumability)

Look for a checkpoint file at `.method/sessions/com-*/checkpoint.yaml` matching this task.

If found, present to user:
> *"Found prior session `{session_id}` at Phase {phase}, iteration {N}. Tasks completed: {list}. Resume or start fresh?"*

**Resume matching:** A checkpoint matches if `checkpoint.task` == `$ARGUMENTS` (exact string match)
OR the checkpoint's branch name matches `feat/{task-slug}`.

If resuming: load checkpoint, skip to the recorded phase/step, verify git state matches.
On resume: verify `nu_remaining + iteration` is consistent with `nu_max`. If inconsistent,
use `nu_max - iteration` as the remaining budget (conservative).

If starting fresh or no checkpoint found: continue to 0.6.

### 0.6 — Create Feature Branch & Draft PR

```bash
# Generate branch name from task
git checkout -b feat/{task-slug} {base_branch}
git push -u origin feat/{task-slug}
```

The draft PR is created after the first implementation code commit in Phase B (sigma_B5).
Phase A doc-only commits do not trigger draft PR creation.

### 0.7 — Select Delivery Rules

From the card's `delivery_rules`, select the **3-7 most relevant** to this specific task.
Selection criteria:
- Does the rule's `applies_to` include the methods this task will use?
- Does the rule's `affects_roles` include impl_sub_agent?
- Is the rule about an artifact type this task will touch?

These selected rules go into the mandate card and are enforced throughout.

---

## Phase A — Confidence Raising

> Ensures specs aren't stale before any code is written.
> Follows M1-IMPL sigma_A1–sigma_A4. If methodology MCP tools are available,
> use `methodology_start` to load the methodology and track steps formally.

### sigma_A1 — Inventory

Read the spec corpus for the current task:
1. Organization-level docs (if card has `architecture.docs_root`, use it; otherwise CLAUDE.md + top-level `docs/`)
2. Architecture docs (from card's `architecture.architecture_path`)
3. The task spec / PRD / phase doc
4. Existing source files in the affected area

For each spec document: enumerate every claim relevant to this task.
For each claim: identify which source file(s) must be examined to verify it.

**Write the inventory explicitly** — not mentally. This is an artifact.

**Exit:** spec_corpus_items >= 1, source_files_read >= 1, inventory written.

### sigma_A2 — Cross-Reference

Compare each inventory claim against the source-of-truth hierarchy.
For every conflict: record location, claim, correct value, severity.

Severity classification:
- **CRITICAL** — would cause compile failure
- **HIGH** — would cause wrong runtime behavior
- **MEDIUM** — underspecified (ambiguous, incomplete)
- **LOW** — documentation gap (cosmetic, no behavioral impact)

**Ambiguous requirement escalation:** MEDIUM findings classified as "ambiguous requirement"
(spec could be interpreted multiple ways with different implementation outcomes) must be
escalated to the user before Phase A exits. These are not the same as documentation gaps.

**Write the discrepancy catalog** — every entry classified. Zero discrepancies is valid.

**Exit:** catalog written, severity breakdown complete, all entries classified.

### sigma_A3 — Fix

Fix all CRITICAL and HIGH discrepancies **in the implementation docs** (not source code — that's Phase B).

**Severity recheck:** Re-examine every LOW/MEDIUM entry — could it actually cause a compile error or wrong behavior? If yes, reclassify and fix.

**Exit:** unresolved_critical = 0, unresolved_high = 0, severity_rechecked = TRUE.

### sigma_A4 — Verify and Decide

1. Grep for known-bad strings in implementation docs (stale field names, wrong types, removed APIs)
2. Re-read all sections fixed in sigma_A3 — confirm correctness
3. Re-confirm unresolved_critical = 0 AND unresolved_high = 0
4. Verify every claim in the inventory is in one of these states:
   - **verified** — matches source code
   - **fixed** — discrepancy resolved in sigma_A3
   - **accepted-risk** — MEDIUM/LOW, documented with one-line rationale
   - **escalation-required** — ambiguous requirement, escalated to user

**Go/no-go gate (all must be true):**
- unresolved_critical = 0
- unresolved_high = 0
- No claims in "escalation-required" state remain unresolved
- Every claim is in one of the four states above (none unverified)

**If gate passes:** proceed to Phase A+.
**If gate fails AND nu_A > 0:** re-enter Phase A at sigma_A1.
**If gate fails AND nu_A = 0:** escalate to human — "All CRITICAL/HIGH resolved but {N} claims
remain unverified or in escalation-required state. Cannot proceed without input."
Do NOT re-enter the loop when nu_A = 0.

**Termination bound:** nu_A = |{CRITICAL + HIGH unresolved}|. Strictly decreases each iteration.

**Exit:** go_no_go_decision recorded. If GO → proceed to Phase A+.

---

## Phase A+ — Design (FCA-Grounded)

> Architectural design before implementation. Ensures the agent knows WHERE code goes
> and HOW pieces connect before writing anything.

### A+.1 — Produce Scoped Boundary Map

Read the project's FCA spec at the path from `card.architecture.fca_spec`.
Read the layer stack from `card.source_layout.layer_stack`.
Read the package layout from `card.source_layout.packages`.

Produce a **scoped boundary map** for the domains this work touches:

1. Enumerate domains in the project (e.g., `ls packages/bridge/src/domains/`)
2. Read available ports (e.g., `ls packages/bridge/src/ports/*.ts`)
3. For domains this work will touch, produce:

```
Domains touched:
  - {domain}: imports allowed from {ports/, shared/ only}
Adjacent domains:
  - {domain} — interaction via {port name} ({existing | needs creation})
Layer: {N} — may depend on L0..L{N-1}, must not be imported by L{N+1}..
Available ports: {list of port interfaces relevant to this work}
```

This boundary map becomes input to A+.2, is included in the design artifact (A+.3),
and is provided to the FCA advisor during reviews (B.3).

### A+.2 — Domain Mapping & Layer Placement

Answer these questions explicitly:

1. **Which existing domain(s)** does this work belong to?
2. **Does a new domain need to be created?** If yes, what's its responsibility boundary?
3. **Which layer** in the stack? What can it depend on? What must NOT depend on it?
4. **Cross-domain interactions:** Does this work need to call into other domains? If yes, through which port interfaces? Do new ports need to be defined?

**Decision procedure:** Choose the domain whose existing files would change together with
the new code (FCA coherence test). If multiple candidates: prefer the one requiring fewer
new cross-domain port additions. If no existing domain fits: propose a new domain.

### A+.3 — Produce Design Artifact

Write a design artifact (in context, not necessarily a file) with this structure:

```
Domain: {domain name} ({existing | new}) at Layer {N}
New files:
  - {path} — {purpose}
  - {path} — {purpose}
Modified files:
  - {path} — {what changes}
Cross-domain interactions:
  - {domain A} → {domain B}: via {port name} ({existing | new port})
Layer violations: {NONE | list violations that need resolution}
Port interfaces needed: {NONE | list new/extended ports}
Naming conventions: {conventions observed in this domain}
Adjacent domain boundaries:
  - {domain} — allowed imports via {port name}
Tasks:
  - {task 1}: {description} — files: {list} — estimated scope: {small|medium|large}
  - {task 2}: {description} — files: {list} — estimated scope: {small|medium|large}
  - ...
```

If total task count exceeds nu_B (default 5), escalate: the work may need multiple
`/com` sessions or an increased iteration budget.

### A+.4 — FCA Compliance Pre-Check

Verify the **design artifact** (A+.3) against FCA principles. These are design-level
checks — code-level verification happens at C.3.

- [ ] No upward layer dependencies planned in the design
- [ ] No cross-domain imports planned without a port interface
- [ ] All new files co-located with their domain
- [ ] Naming follows existing domain conventions (read 3 existing files in the domain to confirm)
- [ ] If new domain: proper structure planned (index, types, tests)

If any check fails: revise the design before proceeding.
If FCA violations persist after **2 design revisions**, escalate to user —
the task may fundamentally require a pattern that needs architectural discussion.

---

## Mandate Card & Crons

### Compose the Mandate Card

After Phase A+ completes, compose the mandate card. This is a **derived artifact** —
every field comes from the project card, the task spec, or the Phase A+ design.

Write it to `.method/sessions/{session_id}/mandate-card.md`:

```yaml
# Mandate Card — {session_id}
# Pulsed every 5 minutes. Do not edit manually — recompose if stale.
# PROTOCOL REFERENCE: Read .claude/skills/com/SKILL.md for the full /com protocol.
# If you are unsure about what phase you are in, what to do next, or how a gate works,
# re-read the skill file. It is the source of truth for your execution procedure.

objective: |
  {from task spec — 2-3 sentences: what to build, why, acceptance bar}

essence:
  purpose: "{card.essence.purpose — abbreviated}"
  invariant: "{card.essence.invariant — abbreviated}"
  optimize_for: "{card.essence.optimize_for — top 2}"

quality_gates:
  compile: "{card.context.build_command} exits 0"
  test: "{card.context.test_command} — zero regressions"
  lint: "{card.context.lint_command} — clean"
  scope: "only files in declared scope modified"
  fca: "no boundary or layer violations"

delivery_rules:
  - "{DR-XX}: {abbreviated rule}"
  - "{DR-YY}: {abbreviated rule}"
  - "{DR-ZZ}: {abbreviated rule}"

fca_anchors:
  domain: "{from Phase A+ design}"
  layer: "{layer N — depends on {lower}, must not be imported by {higher}}"
  boundary_rule: "{key boundary constraint}"
  port_interfaces: "{ports needed or extended}"
  boundary_map: "{from A+.1 — domains touched and their allowed imports}"

key_files:
  - "{file 1 — why it matters}"
  - "{file 2 — why it matters}"
  # 5-10 most important files

governance:
  autonomy: "{card.governance.autonomy}"
  max_decisions_before_escalate: {card.governance.max_autonomous_decisions}
  escalation: "essence-related decisions → ALWAYS escalate"

stopping_conditions:
  continue: "gates failing but fixable, review findings actionable"
  stop_success: "all gates pass, no CRITICAL or HIGH review findings"
  stop_escalate: "blocked, budget exhausted, thrashing detected (same root cause 2+ iterations)"
  stop_impossible: "spec contradicts itself, architecture can't support requirement without redesign"

progress:
  phase: "{current phase}"
  iteration: "{N} of {nu_max}"
  completed: []
  remaining: []
```

**Keep the mandate card under ~40 lines.** Each field should be a single abbreviated line.
The point is re-anchoring, not re-reading the full spec. If you need details, the protocol
reference at the top points you to the full skill file.

### Start Crons

Set up two recurring crons:

**1. Mandate Pulse (every 5 minutes):**
Read `.method/sessions/{session_id}/mandate-card.md` and present it. The card content is
**frozen at composition time** — only the `progress` section is updated at each checkpoint.
Do not regenerate the card on each pulse; read and present the file.

**2. Base Branch Drift Check (every 10 minutes):**
```bash
git fetch origin {base_branch}
git diff --stat HEAD...origin/{base_branch}
```

**Drift merge protocol:**
- Only auto-merge if `nu_B_remaining >= 2`. Do NOT merge when budget is tight (nu_B_remaining <= 1) — defer to user.
- If > 20 files changed on base since branch point: merge base into feature branch.
- After any merge, re-run gates immediately. If new failures are attributable to the merge
  (files you did not author), they do **not** count against nu_B.
- **Conflict resolution:**
  - Files you authored: preserve your changes, re-verify against spec
  - Files you did NOT author: accept theirs
  - Complex conflicts (> 5 files, or lockfiles/generated files): escalate to user
- If merge is skipped (budget tight or complex conflicts), note drift in PR comment.

Use the `CronCreate` tool or equivalent to set up these crons. Clean them up (CronDelete)
when the skill completes or is interrupted.

---

## Phase B — Implementation Loop

> Bounded by nu_B (default: 5 iterations). Each iteration: implement → validate → review.
> Loop exits when quality gates pass AND no CRITICAL or HIGH review findings remain.

### B.1 — Implement (per task)

For each task in the design artifact's task list, execute M1-IMPL Phase B steps:

**sigma_B1 — Orient:** Read all files named in the task. Read normative references.
Pre-flight naming check. If task spans > 5 files: decompose in writing first.

**sigma_B2 — Diff:** Write an explicit change list — every file, method, field, transformation.
If any change can't be stated specifically, go back to B1 and orient more.

**sigma_B3 — Implement:** Make the smallest change satisfying the postcondition.
- Before writing any file: verify it's in the domain path from the Phase A+ design artifact
- Before adding any import: verify it doesn't cross a domain boundary without a port
- When source contradicts spec: check source-of-truth hierarchy, record as divergence, implement what hierarchy says
- When making an undeclared-scope change: record as decision BEFORE implementing
- If undeclared scope exceeds 30 lines or touches > 1 file not in scope: BLOCK and escalate
- After any batch edit across > 2 files: grep immediately for unintended matches
- **Non-trivial design decisions:** If the decision is irreversible, security-relevant, or has 3+
  defensible options, invoke `/council-team` for adversarial debate (M1-COUNCIL). For reversible
  low-stakes choices, think through options sequentially — list alternatives, weigh tradeoffs, pick
  one, document rationale (M3-TMP). Respect `governance.max_autonomous_decisions` from the card.
- **Adding a runtime dependency** counts as an autonomous decision against
  `governance.max_autonomous_decisions`. Prefer stdlib or existing project dependencies.
  Dev dependencies for testing do not count against the decision budget.
- **Infrastructure failures** (build, test, git, tool operations failing due to network, auth,
  registry): retry once. If retry fails, record as INFRA and escalate. Infrastructure failures
  do not consume B-loop iterations — they are not code quality issues.

**sigma_B4 — Validate:** Run `{card.context.build_command}` then `{card.context.test_command}`.
Every failing test classified (REGRESSION / DIVERGED / INFRA / FLAKY / EXPECTED) before proceeding.
Record all test counts + delta from baseline. If `{card.context.lint_command}` exists, run it.

**FLAKY test protocol:** Re-run the failing test up to 2 additional times. If it passes on any
retry: FLAKY_PASS, proceed (note in PR comment, do not count as gate failure). If all 3 runs
fail: reclassify as REGRESSION or INFRA based on the failure mode. If > 3 distinct tests are
FLAKY in one iteration: escalate — the test infrastructure may be unstable.

**sigma_B5 — Record:** Commit with a descriptive message. Push to feature branch.
If this is the first commit: create the draft PR now.
Add a PR comment documenting what was implemented, decisions made, what's next.

### B.2 — Self-Review

After all tasks in this iteration are complete:

1. Re-read the mandate card
2. Check quality gates locally:
   - [ ] `{build_command}` exits 0
   - [ ] `{test_command}` — zero regressions
   - [ ] `{lint_command}` — clean (if configured)
   - [ ] Only files in declared scope modified (check via `git diff --name-only {base_branch}...HEAD`)
   - [ ] No FCA boundary or layer violations in new imports
   - [ ] Secret patterns — check diff for hardcoded credentials, API keys, private key headers,
         password literals. Any match is CRITICAL — remove immediately.
3. Compare work against the objective in the mandate card — is the task actually complete?

**If gates fail:** proceed directly to next B iteration — fix the failures, skip review.
**If gates pass:** proceed to B.3 (review tier).

### B.3 — Review Tier

Review tier (state machine):

- **Gates failing** → no review. Fix gates first.
- **Gates pass, no prior review run this session** → `/review-advisors` with 2-3 advisors
  (one MUST be FCA advisor). Provide the FCA advisor with: the design artifact from A+.3,
  the boundary map from A+.1, and instruction to check for cross-domain imports in
  the changed files.
  → If no CRITICAL or HIGH findings: exit to Phase C.
  → If CRITICAL or HIGH findings: classify per B.6, fix, next iteration.
- **Gates pass, prior review findings addressed** → full `/review-pipeline`.
  → If no CRITICAL or HIGH findings: exit to Phase C.
  → If CRITICAL or HIGH findings: classify per B.6, fix, next iteration.
- **Last iteration (nu_B_remaining = 0)** → full `/review-pipeline` regardless.
  Exit to Phase C with all findings recorded in PR.

**"Review clean" = zero CRITICAL or HIGH findings.** MEDIUM and LOW findings are recorded
in the PR but do not block exit.

**Mandatory FCA advisor** — every review invocation (whether `/review-advisors` or `/review-pipeline`)
must include an advisor that checks:
- Boundary violations (direct imports across domains without ports)
- Layer violations (upward dependencies)
- Co-location violations (artifacts in wrong directories)
- Port discipline (domain logic leaked into port implementations)
- Domain sprawl (code stuffed into wrong domain)

### B.4 — Checkpoint & Push

At every iteration boundary:

1. **Re-read the mandate card** — re-anchor before any bookkeeping
2. **Update mandate card** `progress` section (completed tasks, remaining, iteration count)
3. **Check PR comments** since last checkpoint. If a human comment contains a direction change
   or blocker, pause and escalate before continuing.
4. **Run drift check** (same as the cron — `git fetch`, diff stat, merge if appropriate per drift merge protocol)
5. **Write checkpoint** to `.method/sessions/{session_id}/checkpoint.yaml`:
   ```yaml
   session_id: "{session_id}"
   task: "{task description or PRD path}"
   phase: B
   iteration: {N}
   nu_B_remaining: {nu_B - N}
   continuation_depth: {N}   # 0 at start, incremented on each self-continuation
   tasks_completed: [...]
   tasks_remaining: [...]
   review_findings_pending: [...]
   gate_status: {compile: PASS|FAIL, test: PASS|FAIL, lint: PASS|FAIL}
   last_commit: "{sha}"
   branch: "feat/{task-slug}"
   base_branch: "{base_branch}"
   pr_number: {N}
   pr_comments_checked: "{ISO timestamp}"
   changeset_lines: {N}     # from git diff --stat
   ```
6. **Commit and push** all implementation work
7. **Self-continuation check:** Consider self-continuation if any of these are true:
   - You have completed **3+ B iterations** in this session
   - You have performed **150+ tool invocations**
   - You notice degraded recall of earlier context (mandate card re-reading doesn't match your working memory)

   If self-continuation is warranted:
   - If `continuation_depth >= 3` (max_continuations): do NOT spawn another agent.
     Complete the current iteration cleanly, write checkpoint, push, add PR comment with
     checkpoint details. **Stop.** The user can re-invoke `/com` to resume.
   - Otherwise: push all work, add PR comment "Session continuing — checkpoint at Phase B
     iteration {N}", spawn a fresh agent (via `Agent` tool with `isolation: "worktree"`) with
     the checkpoint path, mandate card path, and instruction to resume.
   - **Fallback:** If Agent tool is unavailable or spawn fails, write checkpoint, push, add PR
     comment with continuation instructions. Stop cleanly. Resume detection (Phase 0.5) will
     pick up the checkpoint.
   - Or, if using the bridge: report via `bridge_event` type "continuation" and let the
     orchestrator handle respawn.

### B.5 — Thrashing Check

After each review (B.3), check for regression loops:

1. Compare current review findings against previous iteration's findings
2. **Same root cause** = same finding ID from a prior review, OR same file AND same
   function/type affected AND same test regression. If 2 of 3 match across consecutive
   iterations, it is the same root cause.
3. If a finding with the same root cause appears in **2+ consecutive iterations**:
   - **STOP.** Do not attempt a third fix.
   - Write up the cycle: "Finding {ID} and {related issue} are in tension — fixing one breaks the other"
   - Escalate to human: *"Structural conflict detected. These findings require a design-level decision, not a code-level fix."*
   - Record the conflict in the PR as a comment
   - Proceed to Phase C with the conflict documented (do not loop forever)

### B.6 — Scope Creep Classification

When review findings arrive, classify each:

| Classification | Criteria | Action |
|---|---|---|
| **IN_SCOPE** | Finding is about code you wrote or changed | Fix in next B iteration |
| **ADJACENT** | Finding is about code you touched but didn't change | Fix only if < 15 min effort, else defer to PR comment |
| **OUT_OF_SCOPE** | Finding is about pre-existing code unrelated to your changes | Record in PR as "Noted, out of scope". Do NOT fix. |

**The mandate card is the arbiter.** If it's not in the mandate, it's not in scope.

### B Loop Exit Conditions

| Condition | What happens |
|-----------|-------------|
| All gates pass AND no CRITICAL or HIGH review findings | Exit to Phase C |
| nu_B exhausted (default 5 iterations) | Exit to Phase C with pending findings recorded in PR |
| Thrashing detected | Exit to Phase C with conflict documented |
| Impossible to continue | Write up why, push what you have, mark PR as blocked, STOP |

---

## Phase C — Hygiene & Final Validation

> Bounded by nu_C (default: 3 iterations). Polish, verify, clean, review.
> Loop exits when final review is clean or nu_C exhausted.

### C.1 — Gate Re-Verification

Do NOT trust Phase B's last validation. Re-run everything from scratch:

```bash
{card.context.build_command}     # full compile
{card.context.test_command}      # full test suite
{card.context.lint_command}      # lint (if configured)
```

Record results. If gates fail here, fix before proceeding — this is the integrated baseline.

### C.2 — Hygiene Sweep

Systematic check for project hygiene issues. Check each category:

**Code hygiene:**
- [ ] Dead code — unreferenced exports, unused imports, orphaned helpers introduced during this session
- [ ] Debug artifacts — `console.log`, `debugger`, `TODO(hack)`, leftover `// FIXME` from implementation
- [ ] Type safety — any `any` casts, `@ts-ignore`, `as unknown as X` introduced?
- [ ] Naming consistency — do new symbols follow existing codebase conventions?
- [ ] Secret patterns — check diff for hardcoded credentials, API keys, private key headers,
      password literals. Any match is CRITICAL and must be removed before PR finalization.

**Test hygiene:**
- [ ] Test gaps — any new public function/method without a corresponding test?
- [ ] Test quality — are tests testing behavior or just exercising code paths?
- [ ] Flaky indicators — any `setTimeout`, `sleep`, or timing-dependent assertions introduced?

**Documentation hygiene:**
- [ ] Stale docs — do any existing docs reference code that was changed? Are they still accurate?
- [ ] API docs — if public APIs were added/changed, are they documented?
- [ ] Architecture docs — if the design introduced new patterns, should arch docs be updated?

**Dependency hygiene:**
- [ ] New dependencies — any added? Are they in lockfile? Are they justified?
- [ ] Unused dependencies — any existing deps now unused after your changes?

**Commit hygiene:**
- [ ] Commit messages — are they logical and well-messaged?
- [ ] Commit sequence — does the history tell a coherent story, or is it "fix" "fix again" "actually fix"?
- [ ] If commit history needs cleanup, suggest the user perform an interactive rebase manually
      after the PR is created. Do not use `git rebase -i`.

### C.3 — FCA Sweep (executable)

Run these checks against files changed on the feature branch.

1. **Boundary check** — cross-domain imports via relative paths:
   ```bash
   grep -rn "from ['\"]\.\.\/" packages/bridge/src/domains/{YOUR_DOMAIN}/ \
     | grep -v "/ports/" | grep -v "\.test\." | grep -v "/shared/"
   ```
   Any remaining hit is a boundary violation. The import style (relative vs absolute) depends
   on the project — derive the pattern from existing imports if different from the example above.

2. **Layer check:** For each import in new/modified files, verify the target package's layer
   is <= your layer per `card.source_layout.layer_stack`.

3. **Co-location check:** Verify every new file is under the domain path declared in the
   Phase A+ design artifact.

4. **Port discipline** (reference card's delivery rules for banned imports):
   ```bash
   grep -rn "from ['\"]node:" packages/bridge/src/domains/{YOUR_DOMAIN}/ \
     --include="*.ts" | grep -v "\.test\."
   ```
   Check the card's delivery rules (e.g., DR-15) for specific banned imports and allowed
   exceptions (e.g., test files for fixture setup, `fs.watch()` in trigger watchers).
   Any other hit is a violation — the domain must accept the dependency via port injection.

5. **Domain structure:** If a new domain was created, verify: `index.ts` exists, at least
   one `*.test.ts` file, types exported.

### C.4 — Process Enforcement

Check the card's `processes` section. For each process:
- **PR-01 (Guide sync):** Did this session modify registry files? If yes, check if guides need updating.
- **PR-02 (Stale agenda):** Not applicable during implementation — skip.
- **PR-03 (Retro placement):** If a retro was produced, verify it's in `.method/retros/`, not `tmp/`.
- Any other project-specific processes in the card.

### C.5 — Execute Fixes

Fix everything found in C.2, C.3, C.4.

**Scope rule:** Fix items related to your work. Items about pre-existing code that you didn't touch
are OUT_OF_SCOPE — record them in the PR as "Noted, pre-existing" but do not fix.

Commit hygiene fixes separately from implementation:
```
chore: remove dead code from {domain}
docs: update {guide} after {change}
test: add missing tests for {function}
```

Push after each commit.

### C.6 — Full Review Pipeline

Run **`/review-pipeline`** on the full changeset (all commits on the feature branch vs base).

**The FCA advisor is mandatory** — include it in the advisor cast. Provide the FCA advisor
with the boundary map from A+.1 and the design artifact from A+.3.

### C.7 — Review Response Loop

If the review pipeline produces actionable findings:

1. Classify each finding (IN_SCOPE / ADJACENT / OUT_OF_SCOPE)
2. Present classified findings to user: *"{N} IN_SCOPE to fix, {M} ADJACENT (fix if trivial),
   {K} OUT_OF_SCOPE to record. Proceed with IN_SCOPE fixes?"*
3. On user confirmation (or autonomously for IN_SCOPE CRITICAL/HIGH if governance allows):
   fix IN_SCOPE findings
4. Fix ADJACENT findings only if < 15 min effort
5. Record OUT_OF_SCOPE findings in PR
6. Re-run C.1 (gate re-verification)
7. Decrement nu_C
8. If nu_C > 0 and CRITICAL or HIGH findings remain: run `/review-pipeline` again (C.6)
9. If nu_C = 0: run gates (C.1) one final time. If gates pass, proceed to C.8 with remaining
   findings documented. If gates fail, mark PR as blocked. Do NOT run another full review —
   record "final iteration fixes not fully reviewed" in PR.

### C.8 — PR Finalization

When Phase C exits (review clean OR nu_C exhausted):

1. **Final PR comment:**
   ```
   ## Implementation Complete

   **Objective:** {from mandate card}
   **Gate results:** compile {PASS|FAIL}, test {PASS|FAIL} ({pass}/{total}), lint {PASS|FAIL}
   **Review status:** {clean | N findings remaining}
   **FCA compliance:** {clean | N violations noted}

   ### What was implemented
   - {bullet list of completed tasks}

   ### Decisions made
   - {bullet list of design decisions with rationale}

   ### Deferred items
   - {bullet list of items deferred to follow-up work}

   ### Known issues
   - {bullet list of remaining review findings, if any}
   ```

2. **Mark PR ready for review** (remove draft status)

3. **Produce retrospective** at `.method/retros/retro-{date}-{NNN}.yaml`:
   ```yaml
   session_id: "{session_id}"
   methodology: "{card.methodology}"
   method: "com"
   date: "{YYYY-MM-DD}"
   hardest_decision: "{the single hardest decision made during this session}"
   observations:
     - "{observation 1}"
     - "{observation 2}"
   card_feedback:
     essence: "{did the essence help or hinder? any suggested changes?}"
     delivery_rules: "{which rules were useful? which were missing?}"
   proposed_deltas: []
   ```

4. **Clean up crons** (CronDelete the mandate pulse and drift check)

5. **Report to user:**
   > *"PR ready for review: {PR_URL}. {N} tasks implemented, {M} review iterations, {K} hygiene items fixed. Retro at `.method/retros/retro-{date}-{NNN}.yaml`."*

---

## Resumability Protocol

### Checkpoint File

Written at every phase/iteration boundary to `.method/sessions/{session_id}/checkpoint.yaml`:

```yaml
session_id: "{session_id}"
task: "{task description or PRD path}"
phase: "{A | A+ | B | C}"
iteration: {N}               # within current phase
nu_remaining: {count}         # iterations left in current loop
continuation_depth: {N}       # 0 at start, incremented on each self-continuation
max_continuations: 3          # hard cap
tasks_completed: [...]
tasks_remaining: [...]
review_findings_pending:
  - id: "{finding ID}"
    classification: "{IN_SCOPE | ADJACENT | OUT_OF_SCOPE}"
    status: "{pending | fixed | deferred}"
gate_status:
  compile: "{PASS | FAIL}"
  test: "{PASS | FAIL}"
  lint: "{PASS | FAIL}"
mandate_card_path: ".method/sessions/{session_id}/mandate-card.md"
design_artifact: |
  {inline copy of Phase A+ design artifact}
branch: "feat/{task-slug}"
base_branch: "{base_branch}"
pr_number: {N}
last_commit: "{sha}"
pr_comments_checked: "{ISO timestamp}"
changeset_lines: {N}
```

### Proactive Self-Continuation

Consider self-continuation if any of these are true:
- You have completed **3+ B iterations** in this session
- You have performed **150+ tool invocations**
- You notice degraded recall of earlier context

Procedure:
1. Complete the current step (don't interrupt mid-sigma)
2. Write checkpoint
3. Commit and push all work
4. Add PR comment: "Session continuing — checkpoint at {phase} iteration {N}"
5. If `continuation_depth >= 3`: do NOT spawn. Stop cleanly with PR comment.
6. Otherwise: spawn a fresh agent with the checkpoint and mandate card paths,
   instruction to resume from checkpoint.
7. **Fallback:** If Agent tool is unavailable or spawn fails, write PR comment with
   checkpoint details and stop. The user can re-invoke `/com` to resume.

### Resume Detection

On `/com` invocation, before Phase 0.6:

1. Glob for `.method/sessions/com-*/checkpoint.yaml`
2. For each checkpoint: check if the branch still exists and the task matches
   (exact string match on `checkpoint.task` vs `$ARGUMENTS`, or branch name matches)
3. If a matching checkpoint is found, offer to resume
4. On resume: read checkpoint, verify `last_commit` matches branch HEAD,
   verify `nu_remaining + iteration` is consistent (use conservative value if not),
   continue from recorded phase/step

---

## Anti-patterns

- **Do not skip Phase A.** "The spec looks fine" is not confidence — verified claims are. Agents that skip Phase A implement against stale specs and compound errors across tasks.
- **Do not skip Phase A+ (design).** Jumping straight from spec-verified to code produces locally correct but architecturally incoherent changes. The FCA design step is where structural mistakes are caught cheaply.
- **Do not let the mandate cron regenerate the card.** The card is frozen at composition time (except the progress section). Regenerating it burns context on meta-reasoning about the mandate instead of the work.
- **Do not run `/review-pipeline` when gates are failing.** Fix compilation and test failures first. Reviewing broken code wastes 7-9 sub-agents on findings that will be moot after the fix.
- **Do not fix OUT_OF_SCOPE review findings.** The mandate card is the scope boundary. Pre-existing issues in code you didn't touch are not your responsibility. Record them, don't fix them.
- **Do not loop more than 2 times on the same root cause.** If fixing finding X breaks Y and fixing Y re-introduces X, this is a structural conflict requiring human design input, not more code iterations. Escalate.
- **Do not skip the retro.** The retro is a methodology obligation (Ax-RETRO). It feeds the project's self-improvement loop. Put it in `.method/retros/`, not `tmp/`.
- **Do not merge the PR.** `/com` creates the PR and marks it ready. The human (or a designated reviewer) merges after review. Merging is not within the agent's authority.
- **Do not auto-apply Phase C review findings without classification.** Classify every finding as IN_SCOPE, ADJACENT, or OUT_OF_SCOPE before fixing. IN_SCOPE CRITICAL/HIGH findings may be fixed autonomously. MEDIUM/LOW IN_SCOPE and all ADJACENT findings are presented to user first. OUT_OF_SCOPE findings are recorded, never fixed.
- **Do not continue past nu_B or nu_C without user confirmation.** Budget exhaustion means escalation, not silent continuation. If 5 B-loop iterations or 3 C-loop iterations didn't produce a clean result, the problem is structural.
- **Do not burn B or C iterations on infrastructure failures.** Network outages, auth expiration, and tool unavailability are not implementation quality issues — retry once, then escalate.
