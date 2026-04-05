---
guide: 36
title: "Build Orchestrator"
domain: build
audience: [developers, delivery-teams]
summary: >-
  Autonomous FCD lifecycle from idea to validated delivery. 8 phases driven by a Pacta
  cognitive agent with conversational human gates, checkpoint/resume, and evidence reporting.
prereqs: [10, 16]
touches:
  - packages/bridge/src/domains/build/
  - packages/bridge/frontend/src/domains/build/
  - .claude/skills/build/
---

# Guide 36 — Build Orchestrator: From Idea to Validated Delivery

How to use `/build` to drive the full FCD lifecycle autonomously — from a natural language requirement to shipped, validated, measured code with an evidence report proving it works.

## What It Does

`/build` is a single command that drives 8 phases: explore the codebase, specify testable success criteria, design a PRD with frozen surfaces, plan commissions, implement in parallel, review with 6 advisors, validate against your criteria, and produce an evidence report with delivery metrics and process refinements.

The primary interface is the **bridge dashboard** at `/app/builds`. You can also invoke it from Claude Code.

## Quickstart

### From the Dashboard

1. Open `http://localhost:3456/app/builds`
2. Click **+ New Build**
3. Type: `Add rate limiting to the API gateway with per-tenant quotas`
4. Click **Start Build**
5. Watch the 8 phases execute in the phase timeline
6. At gates (specify, plan, review): discuss in the conversation panel, then approve
7. Read the EvidenceReport when complete

### From Claude Code

```
/build "Add rate limiting to the API gateway with per-tenant quotas"
```

## The 8 Phases

| # | Phase | What happens | Human gate? |
|---|-------|-------------|------------|
| 1 | **Explore** | SPL scans affected domains, patterns, constraints | No |
| 2 | **Specify** | Conversation produces FeatureSpec with testable criteria | Discuss + approve |
| 3 | **Design** | s-fcd-design produces PRD with frozen surfaces | Discuss + approve |
| 4 | **Plan** | s-fcd-plan decomposes into commissions | Discuss + approve |
| 5 | **Implement** | s-fcd-commission-orch runs parallel commissions | No (escalates on failure) |
| 6 | **Review** | s-fcd-review with 6 advisors | Discuss + approve |
| 7 | **Validate** | Evaluates success criteria against shipped code | No |
| 8 | **Measure** | Produces EvidenceReport + refinements | No |

## Human Gates

At each gate, the same 3-step pattern:

1. **Present** — the orchestrator shows what it did and proposes next steps
2. **Discuss** — you ask questions, suggest changes, add ideas (no turn limit)
3. **Decide** — click the gate action button when satisfied

Gate buttons change per phase:
- Specify: [Approve Spec]
- Design: [Approve Design]
- Plan: [Approve Plan]
- Review: [Approve] / [Approve with Comments] / [Request Changes]
- Escalation: [Retry with Direction] / [Fix Manually] / [Abort]

## Autonomy Levels

Set per-build via the dashboard dropdown:

| Level | Behavior | Best for |
|-------|----------|----------|
| **Discuss All** | Every gate requires conversation + approval | Novel work, first builds |
| **Auto-Routine** | Auto-approves when similar to past successful builds | Routine changes |
| **Full Auto** | All gates auto-approve; you only see the EvidenceReport | Batch operations |

## On-Demand Skills

Three buttons in the conversation panel let you invoke FCD skills mid-pipeline:

- **[Debate]** — spawn a `/fcd-debate` council for architectural decisions (Phases 1-3)
- **[Review]** — targeted review of a specific commission's output (Phases 5-7)
- **[Surface]** — explicit `/fcd-surface` co-design session (Phase 3)

## Success Criteria

Phase 2 requires you to define **machine-evaluable** criteria. The orchestrator helps:

| Good (testable) | Bad (subjective) |
|-----------------|-------------------|
| `tsc --noEmit: 0 errors` | "No type issues" |
| `GET /health returns 200` | "API works" |
| `No any types in ports/` | "Good TypeScript" |
| `All 2024 tests pass` | "Code is tested" |

Phase 7 evaluates each criterion automatically. The Success Criteria Tracker in the dashboard shows real-time pass/fail as validation runs.

## Evidence Report

Every build produces an `EvidenceReport` with:

- **Verdict**: fully_validated / partially_validated / validation_failed
- **Validation**: criteria total/passed/failed with evidence per criterion
- **Delivery metrics**: total cost, orchestrator overhead %, wall-clock time, human interventions, failure recoveries
- **Refinements**: per-build improvement proposals (target: strategy/gate/orchestrator/bridge)

The report is written to `.method/retros/retro-build-{slug}.yaml` and visible in the dashboard.

## Dashboard Views

### Build List (sidebar)
- Mini pipeline strip (8 colored dots) for glanceable status
- Status: blue=running, amber=waiting for you, green=completed, red=failed

### Context Bar (persistent)
- Requirement, current phase, cost/budget, commission status, Pause/Abort controls

### Overview Tab
- Phase timeline pills + Gantt chart showing durations
- Commission task cards with progress and contextual retry
- Success criteria tracker

### Artifacts Tab
- Phase-by-phase artifact browser (ExplorationReport, FeatureSpec, PRD, plan, diffs, evidence)
- Artifact versioning: v1 (proposed) → v2 (discussed) → v3 (approved)

### Events Tab
- Full event stream with filters: All, Failures, Gates, System

### Analytics Tab
- Phase bottleneck chart
- Failure patterns (which gates fail most)
- Method refinements ranked by frequency
- Cost trend sparkline across builds

## Checkpoint and Resume

State is saved after every phase. Resume after crash or deliberate pause:

- **Dashboard**: click [Resume] on a paused build
- **Claude Code**: `/build resume {session-id}`
- **Automatic**: the orchestrator detects existing checkpoints on start

Checkpoints include: phase, completed strategies, FeatureSpec, conversation history, cost.

## Failure Recovery

When a commission fails gate checks:

1. Orchestrator reads the failure (which gate, what evidence)
2. Constructs a targeted retry with failure context
3. Re-executes **only** the failed commission — not the whole pipeline
4. If retry fails → escalates to you with full analysis

Evidence from strategy-pipelines council: 60% success with context vs 20% blind retry.

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Commission keeps failing | Click [Review] to inspect its output, then [Retry with Direction] with specific guidance |
| Success criterion too vague | The orchestrator should have caught this in Phase 2. Pause the build, edit the spec, resume. |
| Build stuck at a gate | Check the conversation panel — the orchestrator is waiting for your input |
| Cost exceeding budget | The context bar shows cost/budget. [Pause] to review, then decide to continue or abort. |
| Bridge restarted mid-build | The build resumes from the last checkpoint automatically |
