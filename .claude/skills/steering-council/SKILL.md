---
name: steering-council
description: Run a project steering council session. Champions the project's essence, reviews retro signals, steers priorities, and ensures all work serves the project's ultimate goals. Use for project direction decisions, essence health checks, retro signal review, roadmap assessment, or any governance question. Trigger phrases: "steering council", "project direction", "essence check", "council session", "governance".
disable-model-invocation: true
argument-hint: [agenda item, challenge, or "auto" for autonomous agenda review]
---

# Steering Council

> **Source of truth:** `pv-method/registry/P0-META/STEERING-PROTOCOL.yaml` (STEER-PROTO v0.1).
> This skill is an operational rendering of the Steering Protocol. When this skill and
> the protocol diverge, the protocol is authoritative.

A persistent project governance council that ensures all work serves the project's
essence (purpose, invariant, optimize_for). The council reviews priorities, steers
direction, and catches drift before it compounds.

**When to use:**
- Project direction decisions with multiple defensible options
- Reviewing accumulated retrospective signals
- Essence health checks (is the project serving its invariant?)
- Roadmap reassessment after significant milestones
- Cross-project coordination decisions (reviewing inbox messages)
- Any governance question that affects project direction, not just task execution

**When NOT to use:**
- Task-level execution decisions — use P1-EXEC delta_EXEC instead
- Implementation choices within a method step — those are execution, not governance
- One-off technical questions — use M3-TMP

## Autonomy Mode

The council operates under the project card's governance.autonomy setting:
- **M1-INTERACTIVE:** Every decision blocks for PO confirmation
- **M2-SEMIAUTO (default):** Council drives clear decisions, escalates ambiguity and essence-touching decisions to PO
- **M3-FULLAUTO:** Council drives end-to-end, PO notified on completion

**Non-negotiable:** Any decision touching the project's essence (purpose, invariant, optimize_for) ALWAYS escalates to PO, regardless of autonomy mode.

## Session Execution

### Step 0 — Context Loading

Load in order:
1. `.method/council/TEAM.yaml` — the council cast
2. `.method/council/AGENDA.yaml` — current work items
3. `.method/council/LOG.yaml` — prior session decisions (last 2-3 sessions for context)
4. `.method/project-card.yaml` — essence section and governance settings
5. `.method/council/inbox/` — any incoming messages from other councils
6. `.method/retros/` — scan for unprocessed retrospectives (if agenda includes retro review)

If `$ARGUMENTS` is provided:
- If `$ARGUMENTS` = "auto" → run the agenda as-is (P0 items first)
- Otherwise → add `$ARGUMENTS` as a P0 agenda item and prioritize it

### Step 1 — Revive

Load all council members from TEAM.yaml. Check: are the right disciplines represented
for the current agenda? If the project has entered a new phase (e.g., research → implementation), propose member swaps. Present the active cast.

**Cognitive diversity check:** Verify at least one member leans divergent-exploration
and one leans convergent-pruning. If not, propose an addition.

### Step 2 — Set Agenda

Load AGENDA.yaml. Focus on P0 items. If `$ARGUMENTS` was provided (and ≠ "auto"),
add it as the top P0 item. The Leader frames each item: what are we deciding, what
constrains us, what would success look like?

**Inbox check:** Review `.method/council/inbox/` for new messages. Incoming messages
may add or reprioritize agenda items.

**Retro signal check:** If retrospectives have accumulated since last session, scan
for patterns that should become agenda items (recurring friction, gap candidates
approaching threshold).

**Governance health check:** Review `governance_health` in AGENDA.yaml if it exists.
Check: any `improvement_signals` approaching threshold (count >= 3)? Any processes
with 0 triggers for 10+ sessions (review for removal)? Is the next health review due?

### Step 3 — Debate & Decide

Run structured adversarial debate following M1-COUNCIL axioms:
- **Ax-3:** No position repetition without responding to a counter-argument
- **Ax-4:** Position updates only when counter-argument is acknowledged
- **Ax-5:** Every turn resolves at least one (Character, Question) pair
- **Ax-7:** Leader halts on diminishing returns — records unresolved items

**Sub-council spawning:** When the council encounters a question that exceeds its expertise, any member can propose spawning a sub-council. The Leader checks proportionality:
1. Does the question require expertise the standing council lacks? (Can't a member research instead?)
2. Does adversarial debate add value? (Is this a tradeoff, not a factual lookup?)
3. Is the decision significant? (Architecture, essence, irreversible?)

If all three hold: spawn a sub-agent running `/council-team` with the specific question and a tailored specialist cast. The sub-council produces an artifact at `.method/council/sub-councils/sc-NNN-{topic}.yaml`. The steering council reviews the recommendation and DECIDES — the sub-council only ADVISES.

**Essence guardianship (every decision):**
Before finalizing any decision, the Leader checks:
1. Does this serve `essence.purpose`?
2. Does it respect `essence.invariant`?
3. Is it consistent with `essence.optimize_for` priorities?

If the answer to any is NO or UNCLEAR → escalate to PO regardless of autonomy mode.

**Escalation format:**
> *"[Leader] to Product Owner: [specific question]. Essence concern: [which field is at risk]. The council is split on X because Y. What should we prioritize?"*

### Step 4 — Capture & Close

**Incremental capture is critical.** After each major decision, the Leader updates
LOG.yaml — do NOT batch all decisions at session end. Context windows can run out.

Update:
1. **LOG.yaml** — append session entry with decisions, for/against, open questions
2. **AGENDA.yaml** — close resolved items (mark `status: done`, add `resolved_in`), add new items with owners
3. **outbox/** — if any decisions need to be communicated to other project councils, write message YAMLs
4. **Commission artifacts** — if the council decided to commission agent work (e.g., "implement PRD X"), produce a commission block in the LOG entry and optionally generate the full orchestrator prompt using the `/commission` skill's logic. The commission includes governance context that a mechanical prompt generator wouldn't have:

```yaml
commission:
  task: "implement docs/prds/005.md"
  governance_context: "Prioritize auth module — drift audit flagged auth weakness"
  routing_recommendation: "M1-IMPL (overlapping file scopes prevent M2-DIMPL)"
  prompt_generated: true  # if the full prompt was composed
  prompt_location: "LOG.yaml session entry or separate file"
```

The human reviews and fires the prompt (or delegates to P3-DISPATCH).

5. **Process enforcement** — check each process in the project card's `processes` section:
   - Was any process triggered this session? (e.g., PR-01: did we change registry files? → guide needs updating)
   - Was any process violated? (e.g., we changed a method but didn't flag the guide update)
   - Record in the session_retro (Step 5).

### Step 5 — Set Next Agenda + Governance Retrospective

The Leader proposes top 3 items for the next session based on:
- Unresolved work from this session
- New questions that emerged
- Project roadmap demands
- Accumulated retrospective signals not yet reviewed
- Incoming messages not yet addressed

Update AGENDA.yaml P0 section. **This step runs in the same message as Step 4** — never deferred to a future session.

**Governance retrospective (mandatory):** Append a `session_retro` block to the LOG.yaml session entry:

```yaml
session_retro:
  decisions_actionable: true/false    # did we produce decisions, not just discussion?
  essence_check_genuine: true/false   # did the essence check catch something real?
  agenda_delta: N                     # net change in open items (negative = shrinking)
  debate_quality:                     # M1-COUNCIL success metrics for Step 3 debate
    mu_1_question_resolution: 0.0-1.0 # decided_questions / total_questions (target: 1.0)
    mu_2_adversarial_integrity: 0.0-1.0 # turns_responding_to_counter / total_turns (threshold: >= 0.8)
    mu_3_escalation_precision: 0.0-1.0  # specific_escalations / total_escalations (target: 1.0)
  processes_followed:
    - process: PR-NN
      followed: true/false
      note: "what happened"
  process_improvement_signal: "what should change about governance?"
  member_adequacy: true/false         # right disciplines present?
```

**Governance health review:** Every 5 sessions (or when `process_improvement_signal` recurs 3 times), update the `governance_health` section in AGENDA.yaml with per-process health data and accumulated improvement signals.

**Agenda discipline:** The agenda should shrink over time. If it grows for 3
consecutive sessions, hold a reflection session to assess whether the council is
generating work faster than executing it.

## Error Recovery

| Situation | Action |
|-----------|--------|
| Stale cast | Propose swaps in Step 1 |
| Converging too fast | Leader invokes Ax-3: "Has anyone changed their position without naming the argument?" |
| Running out of context | Capture immediately (Step 4 mid-session), then continue |
| Challenge doesn't fit council | Route to P1-EXEC (execution) or P2-SD (delivery) instead |
| Prior decision feels wrong | Open it as a new agenda item — don't retroactively edit LOG.yaml |
| PO overrides council | Record the override in LOG.yaml with rationale — the council's position is minority, PO's is authoritative |

## Anti-patterns

- Do not let the council become a committee that meets more than it decides
- Do not skip the essence check — it's the council's primary duty
- Do not batch LOG.yaml updates at session end — capture incrementally
- Do not keep members who no longer match the project's discipline needs
- Do not let the agenda grow unboundedly — close items aggressively
