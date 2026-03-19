---
name: review-advisors
description: Spawn a cast of contrarian advisors who independently review a document, design, PR, or RFC from complementary dimensions. Each advisor runs as a parallel sub-agent and produces a structured review. The host synthesizes all reviews into a Review Report — a structured artifact designed as input to /review-synthesizers. Use when you want adversarial multi-perspective critique before shipping, merging, or committing to a design. Trigger phrases: "review advisors", "contrarian review", "adversarial review", "multi-perspective review", "stress test this".
disable-model-invocation: true
argument-hint: [file path, PR number, or description of what to review]
---

# Review Advisors

A structured adversarial review where a cast of contrarian advisors independently critique a target artifact from complementary dimensions. Each advisor runs as a parallel sub-agent — no debate, no consensus-seeking. The value is in the divergence.

**Pipeline position:** This skill produces a **Review Report** — a structured artifact designed as input to `/review-synthesizers`, which produces an **Action Plan** consumable by an implementer agent.

```
Artifact → /review-advisors → Review Report → /review-synthesizers → Action Plan → implementer
```

**When to use:** Before shipping, merging, or committing to a design. When you want to find the holes before production does.

**When NOT to use:** For trivial changes, bug fixes with obvious solutions, or tasks where a single perspective is sufficient. The overhead of 3-5 parallel agents is only justified when the artifact has real stakes.

## Phase 1 — Target Identification

Determine what is being reviewed:

1. If `$ARGUMENTS` is provided, use it as the target. Resolve file paths, PR numbers, or descriptions.
2. If not provided, ask:
   > *"What should the advisors review? Give me a file path, PR number, or describe the artifact."*
3. **Read the target** thoroughly before designing the cast. The advisors' dimensions must be tailored to the artifact's actual content, not generic categories.

---

## Phase 2 — Cast Design

Design **3-5 advisors**, each covering a distinct review dimension. All advisors are contrarians — their job is to attack, not praise.

**Design principles:**
- Dimensions must be **complementary and non-overlapping**. Each advisor owns a unique lens. No two advisors should find the same issue.
- Every advisor is a **contrarian to the artifact's assumptions**, not to each other. They don't debate — they independently stress-test.
- Advisors should have a **name, dimension, and contrarian angle** that makes their perspective immediately clear.
- Choose dimensions based on what the artifact actually needs, not a fixed template. An RFC needs different dimensions than a PR or a data model.

**Dimension selection heuristic — pick 3-5 from the artifact's risk surface:**

| Artifact Type | Common Dimensions |
|---------------|-------------------|
| RFC / Architecture | Security, Scale/Performance, Operations/Day-2, Simplicity/YAGNI, Data Integrity |
| PR / Code Change | Correctness, Edge Cases, Performance, API Surface/Compatibility, Test Coverage |
| Data Model | Consistency, Query Patterns, Migration Risk, Access Control, Schema Evolution |
| API Design | Ergonomics, Backward Compatibility, Error Handling, Security, Performance |
| Process / Policy | Enforceability, Escape Hatches, Cognitive Load, Failure Modes, Incentive Alignment |

**Present the cast as a table:**

| Advisor | Dimension | Contrarian Angle |
|---------|-----------|-----------------|
| **Name** | What they review | One-line attack posture |

After presenting the cast, ask:
> *"Any changes to the lineup before I dispatch the reviews?"*

---

## Phase 3 — Dispatch

Launch all advisors as **parallel background sub-agents** using the Agent tool. Each advisor gets:

1. **Identity:** Their name, dimension, and contrarian role.
2. **Target:** The file(s) to read and review.
3. **Scope:** Their specific review dimension — what to focus on, what to ignore (other advisors' dimensions).
4. **Instructions:**
   - Be a CONTRARIAN — attack the artifact's assumptions, find holes, challenge decisions.
   - Be SPECIFIC — reference section numbers, line numbers, or code paths. No vague concerns.
   - Propose MITIGATIONS for real risks — don't just criticize, offer alternatives.
   - Rate each finding: **CRITICAL / HIGH / MEDIUM / LOW**.
   - Return a structured review with the **exact format specified below** (this format is consumed downstream by `/review-synthesizers`).

**Advisor output format (MANDATORY — each advisor must return this exact structure):**

````
## {Advisor Name} — {Dimension} Review

**Verdict:** {approve | approve-with-conditions | reject}
**Artifact:** {file path or description}

### Executive Summary
{2-3 sentences}

### Findings

#### [{severity}] F-{advisor_initial}-{N}: {title}
- **Section:** {section number or file:line}
- **Description:** {specific description of the issue}
- **Attack scenario / Evidence:** {concrete scenario or code path demonstrating the issue}
- **Proposed mitigation:** {specific fix or alternative}

{repeat for each finding}
````

**Finding ID convention:** `F-{first letter of advisor name}-{number}`. Example: Kira's findings are F-K-1, F-K-2. Dex's are F-D-1, F-D-2. This ensures globally unique IDs across advisors.

**Prompt template for each advisor:**

```
You are **{name}**, a {dimension} contrarian reviewing {target_description}.
Your job is to be a CONTRARIAN — {contrarian_angle}. You are not here to
praise; you are here to stress-test.

Read the target artifact at: {file_path(s)}

Your review dimension: **{dimension}**

Focus on:
{numbered_focus_areas — 5-8 specific questions tailored to this advisor's dimension}

Be specific. Reference section numbers / line numbers. Propose mitigations
where you see real risk. Mark issues as CRITICAL / HIGH / MEDIUM / LOW.

IMPORTANT: Return your review using this EXACT structure:

## {Your Name} — {Your Dimension} Review

**Verdict:** {approve | approve-with-conditions | reject}
**Artifact:** {file path}

### Executive Summary
{2-3 sentences}

### Findings

#### [{SEVERITY}] F-{your initial}-{N}: {title}
- **Section:** {reference}
- **Description:** {what is wrong}
- **Attack scenario / Evidence:** {concrete scenario}
- **Proposed mitigation:** {specific fix}

Use finding IDs starting with F-{your_initial}-1, F-{your_initial}-2, etc.
```

Tell the user:
> *"All {N} advisors are reviewing in parallel. I'll present their findings as they come in."*

---

## Phase 4 — Collect & Summarize

As each advisor completes, present a **concise summary** (not the full review):

```
### {Name} ({Dimension}) — Verdict: {verdict}

**CRITICAL ({count}):**
- F-{X}-{N}: one-line summary

**HIGH ({count}):**
- F-{X}-{N}: one-line summary

**MEDIUM ({count}):**
- F-{X}-{N}: one-line summary

**LOW ({count}):**
- F-{X}-{N}: one-line summary
```

---

## Phase 5 — Review Report

After ALL advisors complete, produce the **Review Report**. This is the primary output artifact — it is designed to be consumed by `/review-synthesizers` or directly by the user.

The Review Report has two parts: a **human summary** shown to the user, and a **structured report** (written to a file) that serves as input to downstream skills.

### Part A — Human Summary (shown to user)

#### 1. Convergence Matrix

A table showing which themes were raised by multiple advisors:

| Theme | Advisor 1 | Advisor 2 | ... | Advisor N |
|-------|-----------|-----------|-----|-----------|
| {theme name} | {severity or —} | {severity or —} | ... | {severity or —} |

#### 2. Converging Themes

3-5 themes, each with:
- **What:** One sentence describing the concern
- **Who raised it:** Which advisors, at what severity, which finding IDs
- **Why it matters:** One sentence on the impact

#### 3. All Findings by Severity

Flat list of ALL findings across all advisors, sorted by severity (CRITICAL first):

```
| ID | Advisor | Severity | Title | Section |
|----|---------|----------|-------|---------|
| F-K-1 | Kira | CRITICAL | global project bypass | 2.4 |
| F-K-2 | Kira | CRITICAL | sole SQL enforcement | 2.4, 4 |
| ... | ... | ... | ... | ... |
```

### Part B — Structured Report (written to file)

Write the structured report to `tmp/review-report-{artifact-slug}-{date}.md` using this format:

````markdown
---
type: review-report
artifact: {file path or description}
date: {YYYY-MM-DD}
advisor_count: {N}
finding_count: {total findings}
critical_count: {N}
high_count: {N}
medium_count: {N}
low_count: {N}
---

# Review Report: {artifact name}

## Artifact
- **Path:** {file path}
- **Type:** {RFC | PR | data model | ...}
- **Description:** {one-line description}

## Cast
| Advisor | Dimension | Contrarian Angle | Verdict |
|---------|-----------|-----------------|---------|
{one row per advisor}

## Findings

{paste each advisor's full findings section here, preserving the exact
F-{X}-{N} IDs, severity, section references, descriptions, and mitigations}

## Convergence
| Theme | Findings | Advisors | Max Severity |
|-------|----------|----------|-------------|
{one row per converging theme}
````

Tell the user:
> *"Review Report written to `tmp/review-report-{slug}-{date}.md`. Run `/review-synthesizers tmp/review-report-{slug}-{date}.md` to generate an action plan, or triage the findings manually."*

---

## Anti-patterns

- Do not design generic advisors ("the security person", "the performance person") without reading the artifact first. Dimensions must be tailored.
- Do not let advisors overlap. If two advisors would find the same issue, merge their dimensions or sharpen the boundary.
- Do not summarize away specificity. The value of the reviews is in the specific findings (section numbers, code paths, attack scenarios), not in vague themes.
- Do not suppress findings because they disagree with the artifact's premise. Contrarians exist to challenge premises.
- Do not run advisors sequentially — they are independent and must run in parallel for efficiency.
- Do not skip writing the structured report to file. Downstream skills depend on it.
