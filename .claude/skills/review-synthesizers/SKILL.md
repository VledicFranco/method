---
name: review-synthesizers
description: Take a Review Report (from /review-advisors) and spawn contrarian synthesizers who defend the original artifact, refine proposed mitigations, and produce a structured Action Plan consumable by an implementer agent. Synthesizers are contrarian to the REVIEWS, not the artifact — they push back on overreach, propose lighter fixes, and sequence work strategically. Trigger phrases: "synthesize reviews", "review synthesizers", "respond to review", "action plan from review", "triage findings".
disable-model-invocation: true
argument-hint: [path to review report from /review-advisors, or "use current context"]
---

# Review Synthesizers

A structured response layer where contrarian synthesizers independently evaluate review findings, defend the artifact where reviewers overreached, refine mitigations, and produce a concrete Action Plan. Each synthesizer runs as a parallel sub-agent with a distinct strategic posture.

**Pipeline position:** This skill consumes a **Review Report** (from `/review-advisors`) and produces an **Action Plan** — a structured artifact that an implementer agent can execute without ambiguity.

```
Artifact → /review-advisors → Review Report → /review-synthesizers → Action Plan → implementer
```

**When to use:** After `/review-advisors` produces a Review Report with findings that need triage. When you want the response to findings to be as rigorous as the findings themselves.

**When NOT to use:** When the Review Report has < 5 findings that are all clearly correct. Just fix them. The overhead of synthesis agents is justified when findings are debatable, conflicting, or when the response strategy is non-obvious.

## Phase 1 — Load Review Report

1. If `$ARGUMENTS` is a file path, read it as the Review Report.
2. If `$ARGUMENTS` is `"use current context"` or omitted, look for a Review Report in the current conversation context (from a prior `/review-advisors` run).
3. If no report found, ask:
   > *"Point me to the Review Report. Give me a file path or run `/review-advisors` first."*
4. **Also read the original artifact** that was reviewed. Synthesizers need both the review findings AND the artifact to judge whether findings are valid.
5. Parse the Review Report to extract: artifact path, cast, all findings (with IDs, severities, sections, mitigations), and convergence themes.

---

## Phase 2 — Synthesizer Cast Design

Design **3-4 synthesizers**, each with a distinct **strategic posture** for responding to review findings. Synthesizers are contrarian to the REVIEWS — they defend the artifact, propose alternatives, or challenge the reviewers' assumptions.

**Fixed posture archetypes (pick 3-4, adapt names to the domain):**

| Posture | Role | What they do |
|---------|------|-------------|
| **Defender** | Artifact advocate | Argues the artifact is right where reviewers overreached. Pushes back on findings that misunderstand context, misread the design, or apply standards that don't fit. Not blindly defensive — concedes when the finding is genuinely correct. |
| **Pragmatist** | Lighter-fix proposer | Accepts valid concerns but proposes simpler, cheaper, or less invasive fixes than the reviewer suggested. "You're right about the problem but your fix is overkill — here's a 5-line change that addresses 90% of the risk." |
| **Strategist** | Sequencing advisor | Thinks about what to fix now vs later. Groups findings by implementation phase. Proposes which findings belong in the current artifact vs a follow-up PRD vs a future RFC. Considers dependencies between fixes. |
| **Integrator** | Cross-finding synthesizer | Looks for findings that are actually the same underlying issue. Proposes unified solutions that address multiple findings at once. Identifies when fixing one finding makes another moot. Spots contradictions between reviewers. |

**Present the cast as a table:**

| Synthesizer | Posture | Response Angle |
|-------------|---------|---------------|
| **Name** | Posture archetype | One-line description of how they'll respond |

After presenting the cast, ask:
> *"Any changes to the synthesizer lineup before I dispatch?"*

---

## Phase 3 — Dispatch

Launch all synthesizers as **parallel background sub-agents** using the Agent tool. Each synthesizer gets:

1. **Identity:** Their name, posture, and response angle.
2. **Inputs:** Both the Review Report AND the original artifact file path(s).
3. **Scope:** ALL findings — every synthesizer sees every finding, but responds from their posture.
4. **Instructions:**
   - You are a contrarian TO THE REVIEWS, not to the artifact.
   - For each finding, choose a response action and justify it.
   - Be SPECIFIC — reference finding IDs, section numbers, and propose concrete alternatives.
   - Return a structured response using the exact format specified below.

**Response actions vocabulary (each synthesizer picks one per finding):**

| Action | Meaning | When to use |
|--------|---------|-------------|
| `accept` | Finding is correct, proposed mitigation is appropriate | Clear correctness/security issue with a good fix |
| `accept-with-refinement` | Finding is correct but mitigation needs adjustment | Right problem, but a lighter/different fix is better |
| `defer` | Finding is valid but doesn't belong in this artifact | Too detailed, belongs in a PRD, follow-up RFC, or implementation |
| `acknowledge` | Finding is real but doesn't need a fix — add a note | Known tradeoff, documented risk, conscious design decision |
| `reject` | Finding is wrong or inapplicable in this context | Reviewer misread the design, applied wrong standards, or concern is theoretical |
| `merge` | Finding is a duplicate or subset of another finding | Reference the parent finding ID |

**Synthesizer output format (MANDATORY):**

````
## {Synthesizer Name} — {Posture} Response

### Per-Finding Responses

#### F-{X}-{N}: {finding title}
- **Action:** {accept | accept-with-refinement | defer | acknowledge | reject | merge}
- **Response:** {1-3 sentences justifying the action}
- **Refined approach:** {only if action is accept-with-refinement — describe the alternative fix}
- **Defer target:** {only if action is defer — where this belongs: PRD name, phase, or follow-up RFC}
- **Merge into:** {only if action is merge — the parent finding ID}

{repeat for every finding in the Review Report}

### Cross-Cutting Observations
{2-3 observations about patterns across findings that inform the overall response strategy}
````

**Prompt template for each synthesizer:**

```
You are **{name}**, a {posture} synthesizer responding to review findings
about {artifact_description}. You are CONTRARIAN TO THE REVIEWS — your job
is to defend the artifact where reviewers overreached, propose lighter fixes
where they over-engineered, and ensure the response is proportional to the
actual risk.

Read the Review Report at: {review_report_path}
Read the original artifact at: {artifact_path}

Your posture: **{posture}** — {response_angle}

For EACH finding in the Review Report (referenced by their F-{X}-{N} IDs),
choose a response action from: accept, accept-with-refinement, defer,
acknowledge, reject, merge.

Be specific. Reference finding IDs and section numbers. When you propose a
refined approach, describe the concrete change (not vague improvements).

IMPORTANT: Return your response using this EXACT structure:

## {Your Name} — {Your Posture} Response

### Per-Finding Responses

#### F-{X}-{N}: {finding title}
- **Action:** {action}
- **Response:** {justification}
- **Refined approach:** {if accept-with-refinement}
- **Defer target:** {if defer}
- **Merge into:** {if merge}

{repeat for ALL findings}

### Cross-Cutting Observations
{2-3 patterns you noticed}
```

Tell the user:
> *"All {N} synthesizers are responding to the review in parallel. I'll present their responses as they come in."*

---

## Phase 4 — Collect & Summarize

As each synthesizer completes, present a **concise summary**:

```
### {Name} ({Posture})

| Action | Count | Finding IDs |
|--------|-------|-------------|
| accept | {N} | F-X-1, F-X-3 |
| accept-with-refinement | {N} | F-X-2, F-X-5 |
| defer | {N} | F-X-4, F-X-7 |
| acknowledge | {N} | F-X-6 |
| reject | {N} | F-X-8 |
| merge | {N} | F-X-9 → F-X-2 |

**Key insight:** {one sentence from their cross-cutting observations}
```

---

## Phase 5 — Action Plan

After ALL synthesizers complete, produce the **Action Plan**. This is the primary output artifact — it is designed to be consumed by an implementer agent.

### Step 1 — Consensus Matrix

For each finding, tally the synthesizer votes:

| Finding | Defender | Pragmatist | Strategist | Integrator | Consensus |
|---------|----------|-----------|------------|------------|-----------|
| F-K-1 | accept | accept-with-refinement | accept | accept | **accept** |
| F-J-2 | reject | defer | defer | merge→F-J-5 | **defer** |

**Consensus rules:**
- If ≥ 3 synthesizers agree on the action → that action wins
- If no majority → the host picks the most conservative action (accept > refinement > defer > acknowledge > reject) and marks it as `disputed`
- `merge` votes are resolved first — if a finding is merged, it inherits the parent's consensus

### Step 2 — Resolve Refinements

For findings with `accept-with-refinement`, compare the synthesizers' proposed alternatives:
- If multiple synthesizers propose refinements, pick the one that is simplest while addressing the core risk
- If only one synthesizer proposed a refinement and others accepted the original mitigation, present both options to the user

### Step 3 — Write the Action Plan

Write the Action Plan to `tmp/action-plan-{artifact-slug}-{date}.md`:

````markdown
---
type: action-plan
source_review: {review report path}
artifact: {original artifact path}
date: {YYYY-MM-DD}
total_findings: {N}
actions: { accept: N, refinement: N, defer: N, acknowledge: N, reject: N, merge: N }
---

# Action Plan: {artifact name}

## Source
- **Artifact:** {path}
- **Review Report:** {path}
- **Advisors:** {names and dimensions}
- **Synthesizers:** {names and postures}

## Decisions

### Fix Now
{Findings where consensus is `accept` or `accept-with-refinement`.
These are changes to make to the artifact before it ships.}

#### F-{X}-{N}: {title}
- **Severity:** {from review}
- **Section:** {reference}
- **Change:** {exact description of what to add, modify, or remove in the artifact}
- **Rationale:** {why this finding was accepted}
- **Refined from original:** {if refinement — what changed from the reviewer's proposal and why}

{repeat for each fix-now finding}

### Defer
{Findings where consensus is `defer`. Grouped by target.}

#### Deferred to: {target name — PRD, phase, follow-up RFC}
| Finding | Title | Severity | Why deferred |
|---------|-------|----------|-------------|
{findings deferred to this target}

### Acknowledge
{Findings where consensus is `acknowledge`. These are notes to add to the artifact.}

#### F-{X}-{N}: {title}
- **Note to add:** {exact text to add to the artifact, and where}
- **Rationale:** {why this is a known tradeoff, not a fix}

### Reject
{Findings where consensus is `reject`.}

#### F-{X}-{N}: {title}
- **Rationale:** {specific reason the finding was rejected}

### Merged
{Findings merged into other findings.}

| Finding | Merged Into | Rationale |
|---------|-------------|-----------|
{merged findings}

## Implementation Checklist

A flat, ordered list of all changes from "Fix Now" and "Acknowledge" sections,
in the order they should be applied to the artifact:

- [ ] {F-X-N}: {one-line description of the change} ({section reference})
- [ ] {F-X-N}: {one-line description} ({section reference})
- [ ] ...

## Deferred Items Summary

Items for downstream implementers to pick up in follow-up work:

| Target | Finding Count | Highest Severity | Summary |
|--------|--------------|-------------------|---------|
| {PRD name or phase} | {N} | {severity} | {one-line summary} |
````

### Step 4 — Present to User

Show the user a concise summary of the Action Plan:

```
**Action Plan Summary:**
- Fix now: {N} findings ({list of IDs})
- Defer: {N} findings → {targets}
- Acknowledge: {N} findings
- Reject: {N} findings
- Merge: {N} findings

**Implementation checklist has {N} items.**
Action Plan written to `tmp/action-plan-{slug}-{date}.md`.
```

Then ask:
> *"Want to adjust any decisions before I apply the fixes? Or should I proceed with the implementation checklist?"*

If the user approves, the host can apply the "Fix Now" and "Acknowledge" changes directly to the artifact, using the Implementation Checklist as a task list.

---

## Anti-patterns

- Do not let the Defender reject everything. A Defender who rejects > 50% of findings is not defending — they are obstructing. The posture is "defend where overreach exists," not "reject all criticism."
- Do not let the Pragmatist accept everything with trivial refinements. "Add a comment" is not a refinement — it's a no-op. Refinements must materially change the fix approach.
- Do not merge findings that are genuinely distinct. Merge only when two findings are the same underlying issue surfaced by different advisors.
- Do not defer everything to avoid work. Defer is for findings that genuinely belong in a later phase, not for findings that are hard to fix now.
- Do not produce an Action Plan with vague changes. "Fix the security issue" is not actionable. "Add a validation rule in §2.7: if project == 'global' then classification must be >= 4" is actionable.
- Do not skip the consensus matrix. Disputed findings must be flagged — the user (Product Owner) resolves disputes, not the synthesizers.
- Do not run synthesizers sequentially — they are independent and must run in parallel.
