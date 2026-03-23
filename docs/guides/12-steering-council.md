---
guide: 12
title: "The Steering Council Protocol"
domain: governance
audience: [project-leads]
summary: >-
  Persistent governance council, essence guardianship, session structure, and CMEM-PROTO memory.
prereqs: [1, 2, 6]
touches:
  - registry/P1-EXEC/M1-COUNCIL/
  - registry/P0-META/STEERING-PROTOCOL.yaml
  - .method/council/
---

# Guide 12 — The Steering Council Protocol

How to govern a project with a persistent council of synthetic experts that champions the project's essence and steers its direction.

## What Problem This Solves

Execution methodologies (P1-EXEC, P2-SD) answer: "How do I execute this challenge?" But they don't answer: "What should I be working on? Am I drifting from the vision? Should we change direction?"

The Steering Council Protocol (STEER-PROTO) fills this gap. It sits ABOVE execution methodologies:

```
Steering Council → decides what to work on
    ↓
P2-SD / P1-EXEC → executes the work
    ↓
Retrospectives → feed back to the council
    ↓
Steering Council → evaluates results against essence
```

## The Council

A steering council is a **persistent team of synthetic experts** that lives across sessions. Unlike M1-COUNCIL (which creates fresh characters per challenge), the steering council's members persist — they have history, positions, and evolving understanding of the project.

### Members

Every council has:
- **1 Leader** — neutral mediator, facilitates debate, checks essence alignment
- **2+ Contrarians** — opposing philosophies on how to steer the project
- **Cognitive diversity** — at least one divergent-exploration member, one convergent-pruning member

Members should cover the **disciplines needed to steer THIS project**:

| Project Type | Example Disciplines |
|---|---|
| Research | Head of research, systems architect, epistemologist, applied engineer |
| Delivery | Tech lead, product strategy, security architect, DX advocate |
| Infrastructure | Platform engineer, reliability, cost optimization, developer ergonomics |

### The Cast File

Members are defined in `.method/council/TEAM.yaml`:

```yaml
council:
  project: pv-method
  members:
    - name: Thane
      role: leader
      expertise: "Methodology architecture"
      conviction: "The system's value is in inter-method structure"
      blind_spot: "May prioritize elegance over shipping"
      joined: "2026-03-14"
```

Members persist across sessions. When the project's needs change, propose swaps — but document the rationale. The swap is logged, not silent.

## Session Structure

Five steps, same every session. Run via `/steering-council` or `/steering-council [specific challenge]`.

### Step 1 — Revive
Load the cast. Check: are the right disciplines represented? Propose swaps if needed.

### Step 2 — Set Agenda
Load AGENDA.yaml. P0 items are the focus. Check inbox for messages from other councils. Scan recent retros for patterns.

### Step 3 — Debate & Decide
Structured adversarial debate. Same axioms as M1-COUNCIL (no repetition, no friction-avoidance updates, every turn resolves something). **Essence guardianship on every decision.**

### Step 4 — Capture & Close
Update LOG.yaml (decisions) and AGENDA.yaml (close/add items). **Incremental capture** — don't batch at session end.

### Step 5 — Set Next Agenda
Top 3 items for next session. Runs in same message as Step 4 — never deferred.

## Essence Guardianship

The council's **primary duty**. Before finalizing any decision:

1. Does this serve `essence.purpose`? (Are we building the right thing?)
2. Does it respect `essence.invariant`? (Are we violating the non-negotiable?)
3. Is it consistent with `essence.optimize_for`? (Are we optimizing for the right priorities?)

If any answer is NO or UNCLEAR → escalate to PO, regardless of autonomy mode.

### Example

The pv-method council's founding session (SESSION-001) checked the essence:
- **Invariant:** "Theory is source of truth"
- **Concern raised:** PRD 004's `step_validate` uses heuristic keyword matching for postconditions — is that "faithful to theory"?
- **Resolution:** Pragmatic first step, documented as honest gap. Not a violation — the heuristic doesn't CONTRADICT theory, it APPROXIMATES it.

Without the essence check, this concern would never have been raised. The implementation would have shipped without anyone asking "does this serve our invariant?"

## Artifacts

All in `.method/council/`:

```
.method/council/
  TEAM.yaml              — persistent members (committed)
  AGENDA.yaml            — work items with priorities and owners (committed)
  LOG.yaml               — append-only session decisions (committed)
  pending-deltas.yaml    — proposed methodology deltas awaiting council review
  logs/                  — individual session log files
  memory/                — persistent cross-session character memory (CMEM-PROTO)
  memory/INDEX.yaml      — memory index and retrieval metadata
  rfcs/                  — request-for-comment documents
  sub-councils/          — artifacts from spawned sub-council sessions
  theory-council/        — theory-focused sub-council artifacts
```

The `memory/` directory is managed by CMEM-PROTO (Council Memory Protocol), which extends M1-COUNCIL to give council members persistent cross-session character memory. See the manifest for installation details.

### The Agenda

Forward-looking. Prioritized as P0 (immediate), P1 (soon), P2 (later).

**Discipline:** The agenda should shrink over time. Every session must close at least as many items as it opens. If it grows for 3 consecutive sessions, hold a reflection session.

### The Log

Append-only. Never edited after writing. Each entry records: date, cast, challenge, decisions (with for/against/PO ruling), open questions, artifacts produced, next agenda items.

**Incremental capture:** Decisions are logged DURING the session, not batched at the end. Context windows can run out mid-session — if the log isn't updated incrementally, decisions are lost.

## Autonomy Agreement

Configured in the project card:

```yaml
governance:
  autonomy: M2-SEMIAUTO    # council drives clear cases, escalates ambiguity
  session_cadence: weekly   # how often the council meets
  veto_authority: product_owner
  max_autonomous_decisions: 3  # per session before mandatory PO check-in
  essence_escalation: always   # essence decisions ALWAYS go to PO
```

Three modes (maps to P3-DISPATCH):

| Mode | Council decides | Human decides |
|---|---|---|
| **INTERACTIVE** | Nothing — proposes, human confirms | Everything |
| **SEMIAUTO** | Clear operational items | Ambiguous items, essence-touching decisions |
| **FULLAUTO** | Everything within budget | Notified on completion, can veto |

**Non-negotiable:** Essence decisions always escalate, regardless of mode.

## Inter-Project Communication

Councils can send structured messages to each other:

```yaml
message:
  from: I2-METHOD-council
  to: I1-T1X-council
  type: request
  subject: "Need feedback on methodology_validate tool design"
  priority: normal
  response_requested: true
```

Messages go to `.method/council/outbox/` and are delivered to the recipient's `.method/council/inbox/`. The recipient council reviews inbox at Step 2 (Set Agenda).

## Protocol Status and Upgrade Path

STEER-PROTO is currently in **draft** status. Like all protocols, it follows the discovery lifecycle (Guide 11):

```
draft → trial → evaluate → promote
```

### Current status

| Criterion | Status |
|---|---|
| Protocol drafted | Done (STEERING-PROTOCOL.yaml) |
| Trial started | Session 001 completed on pv-method |
| Trial criteria defined | Not yet — AG-004 in pv-method council agenda |

### Promotion criteria (proposed, pending council approval)

The following criteria would need to be met for STEER-PROTO to be promoted:

| Metric | Threshold | Rationale |
|---|---|---|
| Sessions run | >= 5 across 2+ projects | Validates the 5-step structure works repeatably |
| Decisions produced | >= 10 | Shows the council produces actionable output |
| Essence checks | >= 3 that caught real concerns | Shows guardianship adds value, not just overhead |
| Agenda discipline | Net agenda size ≤ initial size after 5 sessions | Shows the council closes items, doesn't just generate them |
| Member swap | >= 1 successful swap | Shows the evolution mechanism works |
| Cross-project message | >= 1 sent and received | Shows comms channel works |

### What promotion could mean

| Outcome | When |
|---|---|
| **Promote to methodology** (P4-STEER) | If the council needs a formal transition function (delta_STEER) with compiled methods |
| **Promote to universal requirement** | If every project should have a council (like every methodology session should have a retrospective) |
| **Keep as protocol** | If formalization adds overhead without value — the protocol structure is sufficient |

The promotion decision will be made by... the steering council itself. Self-referential? Yes. But the council is the governance body — governance decisions are its domain.

## Getting Started

1. **Create `.method/council/`** in your project repo
2. **Design your cast** — who are the 3-5 experts this project needs? Write TEAM.yaml
3. **Set initial agenda** — what are the top 3 questions facing this project? Write AGENDA.yaml
4. **Add governance to your project card** — autonomy mode, cadence, veto authority
5. **Run your first session** — use `/steering-council` or follow the 5-step structure manually
6. **Capture decisions in LOG.yaml** — incrementally, not batched

This guide will evolve as STEER-PROTO progresses through trial and more projects adopt steering councils.
