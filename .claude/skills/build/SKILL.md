---
name: build
description: >
  Autonomous build orchestrator — drives a requirement through the full FCD lifecycle
  from idea to validated delivery. 8 phases: explore, specify, design, plan, implement,
  review, validate, measure. Produces an EvidenceReport with machine-evaluated criteria,
  delivery metrics, and process refinements.
disable-model-invocation: true
argument-hint: "[requirement — e.g. 'Add rate limiting to the API gateway']"
---

# /build — Autonomous FCD Lifecycle from Idea to Validated Delivery

> One command. 8 phases. One EvidenceReport.

```
/build "Add rate limiting to the API gateway with per-tenant quotas"
```

**Core invariant:** Every phase saves a checkpoint. Resumable from any point.

**Primary interface:** Bridge dashboard at `/app/builds`. Claude Code as fallback.

---

## When to use

- Any feature, refactor, or improvement that needs design → implement → verify
- Multi-commission work spanning multiple domains
- When you want proof that the delivered code meets success criteria

## When NOT to use

- Quick single-file changes — just edit the file
- Exploration only (no implementation intent) — use SPL explore directly
- Modifying methodology registry — use steering council

---

## Phase 0 — Initialize

Parse the requirement from arguments. Check for existing builds to resume:
- If `.method/sessions/build-{slug}/checkpoints/` exists → offer resume
- Otherwise create new build session

Load project card, CLAUDE.md, domain structure.

## Phase 1 — Explore

Scan the codebase using SPL `explore` with the requirement as query.

**Actions:**
- Identify affected domains, existing patterns, port interfaces, test coverage
- If 3+ viable approaches → spawn `/fcd-debate` council automatically
- Human can also trigger [Debate] at any time via dashboard

**Output:** ExplorationReport → presented to human as context for Phase 2.

**No human gate.** Fully autonomous.

## Phase 2 — Specify

Drive a conversation to produce a **FeatureSpec** with machine-evaluable success criteria.

**Conversation flow:**
1. Present exploration findings
2. Propose problem statement — human refines
3. Propose success criteria — human adds/removes/adjusts
4. Propose scope — human confirms

**Critical:** Criteria must be machine-evaluable. Guide the human:

| Good | Bad |
|------|-----|
| "tsc --noEmit: 0 errors" | "No type issues" |
| "GET /health returns 200" | "API works" |
| "No `any` in port files" | "Good TypeScript" |
| "All tests pass" | "Code is tested" |

If a criterion can't be automated: "I can't test 'clean code' — can you rephrase as a specific check?"

**Human gate:** Discuss + [Approve Spec]

## Phase 3 — Design

Invoke `s-fcd-design` with the FeatureSpec.

- If complex surfaces detected → invoke `s-fcd-surface` sessions
- Human can trigger [Surface] for explicit co-design

**Human gate:** Discuss + [Approve Design]

## Phase 4 — Plan

Invoke `s-fcd-plan` to decompose into commissions.

Dashboard renders commission DAG with dependencies and wave structure.

**Human gate:** Discuss + [Approve Plan]

## Phase 5 — Implement

Invoke `s-fcd-commission-orch` for parallel commission execution.

**Failure routing:**
1. Read gate failure from strategy status
2. Construct targeted retry with failure context
3. Re-execute only the failed commission
4. If retry fails → escalate to human

Human can trigger [Review] on any commission mid-flight.

**No human gate** in happy path. Escalation via conversation panel if stuck.

## Phase 6 — Review

Invoke `s-fcd-review` (6 parallel advisors).

**Review loop:** If REQUEST_CHANGES:
1. Route findings to relevant commissions
2. Re-implement only affected commissions
3. Re-run review (max 2 cycles)

**Human gate:** Discuss + [Approve] / [Request Changes]

## Phase 7 — Validate

Evaluate each TestableAssertion from Phase 2:
- `command` → run, check exit code
- `grep` → search files for pattern
- `typescript` → tsc --noEmit
- `endpoint` → HTTP request, check status
- `custom` → run script, check output

If criteria fail → route back to implement (max 1 cycle).

**No human gate.** Success Criteria Tracker lights up green/red in real-time.

## Phase 8 — Measure

Produce **EvidenceReport**:
- Validation: criteria total/passed/failed with evidence
- Delivery: cost, overhead %, interventions, duration, failure recoveries
- Verdict: fully_validated / partially_validated / validation_failed
- Refinements: per-build improvement proposals

Write retro to `.method/retros/retro-build-{slug}.yaml`.

---

## Autonomy Levels

Set per-build via dashboard dropdown:

| Level | Behavior |
|-------|----------|
| **Discuss All** (default) | All gates require discuss + approve |
| **Auto-Routine** | Auto-approve when confidence > 0.85 (similar to past builds). 30s intervention window. |
| **Full Auto** | All gates auto-approve. Human only sees EvidenceReport. |

## On-Demand Skills

Available at any phase via dashboard buttons:

| Button | Skill | When useful |
|--------|-------|------------|
| **[Debate]** | `/fcd-debate` | Phases 1-3: resolve architectural decisions |
| **[Review]** | `/fcd-review` | Phases 5-7: targeted commission review |
| **[Surface]** | `/fcd-surface` | Phase 3: explicit co-design |

## Checkpoint / Resume

Saved after every phase transition. Includes:
- Current phase, completed strategies, artifact manifest
- FeatureSpec with success criteria
- Full conversation history
- Cost accumulator

Resume: `/build resume {session-id}` or dashboard [Resume] button.

## Dashboard Integration

- **Builds list:** `/app/builds` — mini pipeline strips, status, cost
- **Context bar:** Requirement, phase, cost, controls — always visible
- **4 tabs:** Overview (timeline, commissions, criteria), Artifacts, Events, Analytics
- **Conversation panel:** Rich cards, gate actions, skill buttons, threading
- **Evidence report:** Verdict badge, criteria checklist, refinements

---

## Anti-Capitulation Rules

1. **Never skip phases.** All 8 phases execute, even for "simple" features.
2. **Never accept vague criteria.** Phase 2 produces testable assertions or the spec is rejected.
3. **Never modify frozen ports.** Route to /fcd-surface.
4. **Never leave PRs floating.** Merge each commission before the next wave.
5. **Never stub.** Every function gets a complete body.
