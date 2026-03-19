---
name: review-pipeline
description: End-to-end adversarial review pipeline — spawns contrarian advisors to attack an artifact, then spawns synthesizers to defend/refine/sequence the findings, producing an Action Plan. Combines /review-advisors and /review-synthesizers into a single invocation. Use when you want the full review cycle without manual handoff. Trigger phrases: "review pipeline", "full review", "review and synthesize", "adversarial pipeline".
disable-model-invocation: true
argument-hint: [file path, PR number, or description of what to review]
---

# Review Pipeline

End-to-end adversarial review: attack → defend → decide. Combines `/review-advisors` (Phase A) and `/review-synthesizers` (Phase B) into a single invocation with automatic handoff.

```
Artifact → [Phase A: Advisors attack] → Review Report → [Phase B: Synthesizers defend] → Action Plan
```

**When to use:** When you want the full review cycle — adversarial critique + proportional response + actionable decisions — without manually running two skills in sequence.

**When NOT to use:** When you only need the critique (use `/review-advisors` alone) or only need to respond to existing findings (use `/review-synthesizers` alone). Also skip for trivial artifacts — the overhead of 7-9 parallel agents is only justified for high-stakes designs.

---

## Phase A — Review Advisors

Follow the `/review-advisors` skill phases 1-5 exactly:

1. **Target Identification** — resolve the artifact from `$ARGUMENTS`
2. **Cast Design** — design 3-5 contrarian advisors tailored to the artifact's risk surface
3. **Present & Dispatch** — present the advisor cast as a table (informational, no approval pause), then immediately launch all advisors as parallel background sub-agents
5. **Collect & Summarize** — as each advisor completes, present a concise summary
6. **Review Report** — after all advisors complete, produce the structured Review Report (convergence matrix, themes, severity-sorted findings with F-{X}-{N} IDs)

**Write the Review Report to file:** `tmp/review-report-{artifact-slug}-{date}.md`

**Critical:** Use the exact finding ID format (`F-{advisor_initial}-{N}`) and the mandatory advisor output structure from `/review-advisors`. The synthesizers consume these IDs.

**Automatic transition:** After presenting the Review Report summary to the user, proceed directly to Phase B without asking. State:
> *"Review Report complete. {N} findings across {M} advisors. Proceeding to synthesis."*

---

## Phase B — Review Synthesizers

Follow the `/review-synthesizers` skill phases 1-5 exactly:

1. **Load Review Report** — use the Review Report produced in Phase A (already in context)
2. **Synthesizer Cast Design** — design 3-4 synthesizers with the fixed posture archetypes:

| Posture | Role |
|---------|------|
| **Defender** | Pushes back on overreach, concedes genuine gaps |
| **Pragmatist** | Accepts valid concerns, proposes lighter fixes |
| **Strategist** | Sequences: fix-now vs defer-to-PRD vs ops-runbook |
| **Integrator** | Merges overlapping findings, spots contradictions |

3. **Present & Dispatch** — present the synthesizer cast as a table (informational, no approval pause), then immediately launch all synthesizers as parallel background sub-agents (each gets ALL findings + the original artifact)
5. **Collect & Summarize** — as each synthesizer completes, present a concise summary
6. **Consensus Matrix** — tally votes per finding across synthesizers
7. **Action Plan** — produce the structured Action Plan with Fix Now / Defer / Acknowledge / Reject / Merge sections + Implementation Checklist

**Write the Action Plan to file:** `tmp/action-plan-{artifact-slug}-{date}.md`

---

## Phase C — Present & Triage

Present the final Action Plan summary to the user:

```
**Review Pipeline Complete**

Phase A: {N} advisors produced {M} findings ({C} CRITICAL, {H} HIGH, {M} MEDIUM, {L} LOW)
Phase B: {N} synthesizers produced consensus on {M} findings

**Action Plan:**
- Fix now: {N} findings ({IDs})
- Defer: {N} findings → {targets}
- Acknowledge: {N} findings
- Reject: {N} findings
- Merge: {N} findings

Implementation checklist has {N} items.
Action Plan written to `tmp/action-plan-{slug}-{date}.md`.
```

Then ask:
> *"Want to adjust any decisions before applying fixes? Or should I proceed with the implementation checklist?"*

If the user approves, apply the "Fix Now" and "Acknowledge" changes directly to the artifact using the Implementation Checklist.

---

## Iteration Support

If the user requests a second round (e.g., "review again", "check the fixes"):

1. Re-read the artifact (now with fixes applied)
2. Re-launch the SAME advisor cast from Phase A, but instruct them to check their original findings: **"Was it fixed? Partially? New issues?"**
3. Skip Phase B synthesizers if all findings are resolved (APPROVED)
4. Run Phase B only on remaining/new findings

The iteration loop is: `fix → re-review → fix → re-review` until all advisors approve.

---

## Configuration

**Advisor count:** 3-5 (default: 4). Fewer for focused artifacts, more for large designs.

**Synthesizer count:** 3-4 (default: 4 — one per posture archetype).

**Model:** Use the default model for all agents. Do not override.

**Parallelism:** All advisors run in parallel. All synthesizers run in parallel. Advisors and synthesizers are sequential (synthesizers need advisor output).

---

## Anti-patterns

- Do not skip Phase A and go straight to synthesis — the value is in the adversarial findings
- Do not skip Phase B and just present raw findings — the value is in proportional response
- Do not merge Phase A and Phase B into a single agent — the separation ensures the synthesizers are genuinely contrarian to the reviews, not influenced by having produced them
- Do not run more than 2 iteration rounds without user confirmation — diminishing returns after round 2
- Do not auto-apply fixes from the Action Plan without presenting the triage first — the user (Product Owner) decides
- Do not let the pipeline take longer than the artifact is worth — proportionality check at the start
