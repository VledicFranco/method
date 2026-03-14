# Guide 9 — The Retrospective Protocol

How methodologies improve themselves. A compiled method is precise and verifiable, but it is also frozen. Without a feedback mechanism, the same gaps persist across every session and every project. The Retrospective Protocol is the self-improvement loop that closes this gap.

## Why Self-Improvement Matters

A method that passes all 7 compilation gates (Guide 7) is structurally sound. But structural soundness does not mean the guidance is correct in practice. An agent following M1-IMPL might discover that sigma_B3's guidance doesn't address multi-file scope escalation. Another agent running M3-PHRV might find that the citation format axiom is too narrow for YAML files. These are real gaps — and they only surface during execution, not during compilation.

Without a feedback loop, what happens?

- The agent improvises around the gap
- The improvisation is lost when the session ends
- The next agent hits the same gap and improvises again
- The method never learns

The Retrospective Protocol makes these observations structural. Every session produces a retrospective artifact. Observations accumulate. When enough evidence points to the same gap, an evolution cycle fires and the method improves.

## The Retrospective Schema

Every methodology session produces a retrospective — a YAML file with a fixed schema. Four fields do the heavy lifting.

### hardest_decision

The moment of maximum uncertainty during the session. This is the highest-signal field in the entire retrospective. Agents that report everything as "fine" still have to name one decision that was harder than the rest.

```yaml
hardest_decision:
  step: sigma_B3
  decision: "5 tasks touched 3 packages — should I batch by package or by feature?"
  outcome: "Batched by feature. First batch touched 2 packages and caused a merge conflict in shared types."
  guidance_gap: true
```

The `guidance_gap` flag matters: `true` means the method's guidance was silent on this decision. The agent had to figure it out alone. That silence is a concrete, fixable deficiency.

**What makes a good hardest_decision:** Specificity. "Deciding how to structure the code" is too vague. "Deciding whether to inline the retry logic or extract it, given that sigma_B3 says prefer small steps but the retry spans 3 call sites" — that names the step, the tension, and why the guidance didn't resolve it.

### observations

Structured observations about the session. At least one is required — even if the session went well. This forces engagement and prevents rote "everything fine" compliance.

Each observation has a type, severity, and improvement target:

| Field | Values | Purpose |
|-------|--------|---------|
| **type** | gap, friction, success, surprise | What kind of observation |
| **severity** | HIGH, MEDIUM, LOW | How much it affected the session |
| **improvement_target** | abstract_method, project_card, both, unclear | Where the fix should go |

**Types explained:**

- **gap** — guidance was wrong or missing. The method told the agent to do something that produced a bad result, or said nothing when it should have said something.
- **friction** — guidance was correct but awkward. The agent got the right result but had to fight the method's structure to get there.
- **success** — guidance was particularly helpful. Worth recording so that evolution cycles don't accidentally remove what works.
- **surprise** — something unexpected happened that the method didn't anticipate. Not necessarily bad, but worth tracking.

**Example observation:**

```yaml
observations:
  - step: M1-IMPL.sigma_B3
    type: friction
    severity: MEDIUM
    description: "sigma_B3 stretched across 7 tasks in one batch. Guidance says scope each task but doesn't address when a batch is too large."
    evidence: "session-log.md:L145 — batch 3 required 4 context switches"
    improvement_target: abstract_method
```

### card_feedback

Per-rule feedback on the project card's delivery rules. Required when a project card was used. Each entry names a specific delivery rule and gives a verdict.

| Verdict | Meaning |
|---------|---------|
| **helpful** | The rule improved the session outcome |
| **unhelpful** | The rule didn't apply or added noise |
| **missing_coverage** | A situation arose that no rule addressed |
| **overly_restrictive** | The rule blocked valid work |

**Example:**

```yaml
card_feedback:
  - rule_id: DR-01
    verdict: unhelpful
    note: "Metals MCP mandate doesn't apply to shell scripts — agent wasted time trying to use Metals for .sh files"
  - rule_id: DR-05
    verdict: helpful
    note: "Independent QA assessment caught a type error the impl agent missed"
```

This is how project cards evolve. A rule that gets `overly_restrictive` from three sessions is flagged for revision. A rule that gets `helpful` consistently is left alone.

### proposed_deltas

Optional. The agent's suggested changes to the method or card. Valuable when the agent has genuine insight from the session; noisy when forced. That is why this field is not mandatory.

```yaml
proposed_deltas:
  - target: abstract_method
    location: "M1-IMPL sigma_B3 guidance"
    current: "Scope each implementation task to a single concern"
    proposed: "Scope each implementation task to a single concern. When a batch exceeds 5 tasks, split into sub-batches grouped by dependency proximity."
    rationale: "7-task batch caused 4 context switches. Grouping by dependency reduces cross-package churn."
```

Each delta names the target (abstract method or project card), quotes what the guidance says now, proposes what it should say instead, and explains why. These proposed deltas are collected during aggregation and fed into evolution cycles as candidate fixes.

## Where Retrospectives Live

Retrospectives are stored in the project repository:

```
your-project/
  .method/
    project-card.yaml
    CHANGELOG.yaml
    retros/
      retro-2026-03-14-001.yaml
      retro-2026-03-14-002.yaml
      retro-2026-03-15-001.yaml
```

Key decisions about storage:

- **Committed, not ephemeral.** Retrospectives are versioned configuration artifacts. They are the evidence base for card and method evolution. Unlike session logs (which may be gitignored), retros are permanent records.
- **One file per method execution.** A session that runs M5-PLAN followed by M1-IMPL produces two retro files. Files accumulate horizontally — no file grows unbounded.
- **Old retros are never edited.** New observations go in new files. This preserves the audit trail.
- **Naming convention:** `retro-YYYY-MM-DD-NNN.yaml` where NNN is a sequence number within the day.

## The Two-Level Evolution Model

Not all improvements are equal. Some gaps are universal (the abstract method is wrong for everyone). Some are project-specific (the delivery rule is too strict for this codebase). The protocol separates these into two levels:

| Level | What changes | Evidence needed | Who decides | Example |
|-------|-------------|-----------------|-------------|---------|
| **Abstract method** | The method YAML in the registry | Cross-project evidence (2+ projects) | Registry maintainer via M3-MEVO | sigma_B3 guidance on batch sizing |
| **Project card** | Delivery rules in the project repo | Single-project evidence | Project lead | DR-01 scoped to Scala files only |

This separation matters because abstract methods affect every project that uses them. Changing M1-IMPL because one project had friction is premature — maybe that project's card should handle it. But if two different projects report the same friction on the same step, the gap is in the method, not the cards.

The `improvement_target` field in each observation drives the split. During aggregation, card-level observations stay in the project repo. Method-level observations get extracted and submitted to the method registry.

## Aggregation

Retrospectives sitting in `.method/retros/` don't improve anything by themselves. Someone has to process them. That processing is called aggregation, and it happens at two levels.

### Project-Level: Card Aggregation

The project lead processes retrospectives from `.method/retros/`:

1. Read all unprocessed retros
2. Split observations by improvement_target (card vs. method)
3. Check card-level thresholds — does any delivery rule have enough feedback to warrant revision?
4. Apply card changes, update `.method/CHANGELOG.yaml`
5. Extract method-level observations into `.method/submissions/`
6. Submit to the method registry (`pv-method/registry/submissions/incoming/`)

### Registry-Level: Method Aggregation

The registry maintainer processes submissions from all projects:

1. Read all incoming submissions
2. Group observations by method and step
3. Check method-level thresholds (see next section)
4. Create gap candidates in the methodology's `EVOLUTION-LEDGER.yaml`
5. When a gap candidate is ready, trigger an M3-MEVO session to evolve the method
6. Update `CHANGELOG.yaml` and `EVOLUTION-LEDGER.yaml`
7. Move processed submissions to `registry/submissions/processed/`

### Cadence

Aggregation runs every 5 retros or weekly, whichever comes first. During active development with multiple sessions per week, the 5-retro trigger fires frequently. During quiet periods, the weekly cadence prevents staleness.

## Thresholds

Not every observation triggers an evolution. Severity determines how much evidence is needed.

### Method-Level Thresholds (Abstract Methods)

| Severity | Count | Scope | Action |
|----------|-------|-------|--------|
| **HIGH** | 1 | Any single session | Immediate gap candidate, fast-tracked to M3-MEVO queue |
| **MEDIUM** | 2 | 2+ projects | Gap candidate created with aggregated evidence |
| **LOW** | No auto-trigger | Accumulated | Reviewed in periodic evolution cycles, never auto-triggers |

HIGH means the guidance produced wrong output or blocked progress. One occurrence is enough — the agent couldn't complete the step correctly by following the method. That is a defect, not an anecdote.

MEDIUM means the agent improvised significantly. A single improvisation might be an outlier. The same improvisation across two different projects on the same step is a pattern.

LOW means minor friction. Accumulated for periodic review, but never automatically triggers a change. Some friction is inherent in any structured process.

### Card-Level Thresholds (Project Cards)

| Severity | Count | Scope | Action |
|----------|-------|-------|--------|
| **Any** | 3 observations on the same rule | 1 project | Delivery rule flagged for revision |

Card thresholds are simpler: three observations about the same delivery rule from the same project is enough. Cards are project-specific, so cross-project evidence is not required. The card_feedback verdicts (helpful, unhelpful, missing_coverage, overly_restrictive) guide the revision direction.

### Calibration Period

The MEDIUM threshold for abstract methods was refined during the protocol trial. The original spec required 3 MEDIUM observations across 2+ projects. The trial lowered this to 2 MEDIUM across 2+ projects for a 6-month calibration period. If this produces premature evolutions, it goes back to 3.

## Evolution Ledgers and Changelogs

Two artifacts track the history of improvements.

### Evolution Ledger

One per methodology, stored at `registry/{methodology}/EVOLUTION-LEDGER.yaml`. Contains:

- **Observation counts** — per-step accumulation: `M1-IMPL.sigma_B3: { HIGH: 0, MEDIUM: 3, LOW: 5, total_sessions: 15 }`. This is the data source for threshold triggers.
- **Gap candidates** — active and resolved. Each records the target step, observation count, contributing sessions, contributing projects, and aggregated proposed deltas.
- **Evolution history** — every M3-MEVO or card revision cycle triggered by the protocol. Each records the gap candidate it resolved, the method version change, the date, and (critically) the pre-evolution and post-evolution observation rates.
- **Regression flags** — entries where the post-evolution observation rate *increased*. The fix made things worse. Flagged for human review.

The observation rate comparison is the closed loop. If sigma_B3 generated friction in 1 of every 3 sessions before evolution and 0 of every 5 sessions after, the fix worked. If the rate went up, it didn't.

### Changelogs

Two kinds:

- **Project-level** (`.method/CHANGELOG.yaml`) — tracks card version history. Each entry lists the changes, the retros that provided evidence, and the gap candidate ID.
- **Registry-level** (`registry/{methodology}/CHANGELOG.yaml`) — tracks methodology and method version history. Each entry traces to gap candidates and submission evidence.

Both changelogs exist so that any change can be traced backward: from the new guidance, to the gap candidate, to the observations, to the specific sessions and projects where the problem was observed.

## Empirical Basis

The protocol is not theoretical. It was trialed in a single day across 2 projects (t1-cortex and pv-method), and the results motivated its promotion proposal.

### The Numbers

| Metric | Result |
|--------|--------|
| Retrospectives collected | 11 |
| Gap candidates surfaced | 4 |
| Evolution cycles triggered | 2 |
| Card revisions applied | 4 |
| Methods improved | 3 (M1-COUNCIL, M3-PHRV, M7-PRDS) |
| Cards improved | 2 (I1-T1X, I2-METHOD) |
| Proposed deltas collected | 12 |
| Actionable deltas | 12 |
| Rote/empty retrospectives | 0 |

### What Happened

From 5 sessions across 2 projects, the protocol collected 11 retrospective artifacts (some sessions executed multiple methods). Four gap candidates emerged:

- **GC-P2SD-001**: sigma_B3 multi-task friction — MEDIUM severity, accumulated across sessions
- **GC-P2SD-002**: M3-PHRV citation format too narrow for YAML — resolved through M3-MEVO (Ax-1 generalized)
- **GC-P2SD-003**: I1-T1X Metals mandate overly restrictive for non-Scala files — resolved through card revision (DR-01/02/03 scoped)
- **GC-P2SD-004**: M1-COUNCIL proportionality — accumulated, pending

Two evolution cycles fired. One was an abstract method change (M3-PHRV's citation format axiom was generalized from code-only to code-and-YAML). The other was a card revision (I1-T1X's delivery rules scoped to appropriate file types). Both produced measurable improvements in subsequent sessions.

### The Self-Referential Test

The promotion criteria include a self-referential test: the protocol must have improved at least one method through its own mechanism. This was met. M3-PHRV's Ax-1 was improved based on a retrospective observation collected through the protocol itself. The feedback loop — collect, accumulate, trigger, evolve — produced an actual method change. The protocol ate its own dog food.

### What the Trial Could Not Test

- **Long-term quality decay.** All 11 retros came from a single day. Whether agents produce rote compliance after months of use is unknown.
- **Organic MEDIUM accumulation speed.** The trial compressed many sessions into one day. In normal usage, reaching 2 MEDIUM observations across 2 projects on the same step may take weeks or months.
- **Automated validation.** Verifying that an evolution fixed the gap requires a re-run (another session on the same step). This is manual. There is no automated regression test.

## How to Write a Good Retrospective

The schema is small, but quality matters. Rote compliance ("everything went fine, LOW severity, success type") defeats the purpose. Here is what makes each field useful.

### hardest_decision

- **Be genuine.** Every session has a hardest decision, even successful ones. Name the step, the tension, and what made it hard.
- **Not "what took the longest."** The hardest decision is the moment of maximum uncertainty, not the most time-consuming task. A 2-minute routing decision can be harder than a 30-minute implementation.
- **Flag guidance gaps honestly.** If `guidance_gap: true`, it means the method was silent when it should have spoken. This is the most actionable signal in the entire retrospective.

### observations

- **At least one, even for good sessions.** A success observation ("sigma_B3's scope-per-task rule prevented the batch from growing uncontrollable") is genuinely useful — it protects working guidance from accidental removal during evolution.
- **Be specific about evidence.** "The step was awkward" is noise. "session-log.md:L145 — batch 3 required 4 context switches because tasks touched 3 packages" is signal. File references, line numbers, output excerpts.
- **Get the improvement_target right.** Ask: "Is this gap universal (any project would hit it) or specific to this project?" Universal gaps target `abstract_method`. Project-specific gaps target `project_card`. When unsure, use `unclear` — it gets triaged during aggregation.

### card_feedback

- **Name the specific rule.** DR-01, not "the tooling rules." The aggregation threshold counts per rule.
- **Use the right verdict.** `unhelpful` means the rule didn't apply. `overly_restrictive` means the rule blocked valid work. These have different revision implications — don't conflate them.
- **Include missing coverage.** If a situation arose that no delivery rule addressed, that is `missing_coverage`. This is how new rules get added, not just existing rules revised.

### proposed_deltas

- **Only when you have genuine insight.** The field is optional for a reason. A vague delta ("make the guidance better") wastes everyone's time. A specific delta that quotes the current text and proposes a replacement — that can be applied directly during an M3-MEVO session.
- **Quote the current guidance.** The `current` field exists so the reviewer can see what the agent was working with. Without it, the proposed change lacks context.

## Summary

The Retrospective Protocol turns methodology execution into a feedback loop:

```
Execute method → Write retrospective → Accumulate observations
    → Threshold met → Gap candidate → Evolution cycle
        → Updated method → Execute again → Fewer gaps
```

Methods start frozen after compilation. Retrospectives thaw them — not through opinion, but through accumulated evidence with severity-based triggers and closed-loop validation. The two-level model ensures that project-specific fixes stay in project cards while universal fixes propagate through the abstract methods.

The protocol was trialed in a single day and produced measurable improvements. It is now being promoted to a required component of every methodology.

This guide will evolve as more retrospective data accumulates.
