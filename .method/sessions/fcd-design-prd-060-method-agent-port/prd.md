---
type: prd
id: PRD-060
title: "MethodAgentPort Co-Design Ratification (with Cortex)"
date: "2026-04-14"
status: draft
version: "0.1.0"
size: S
group: A
phase: 1
domains:
  - "@method/agent-runtime (S1 owner)"
  - "t1-cortex platform (S1 consumer)"
  - "@method/pacta (peer dep, impact audit)"
surfaces:
  - "S1 — MethodAgentPort (frozen 2026-04-14, .method/sessions/fcd-surface-method-agent-port/decision.md)"
related:
  - docs/roadmap-cortex-consumption.md
  - .method/sessions/fcd-surface-method-agent-port/decision.md
  - ../../t1-repos/t1-cortex-1/docs/rfcs/RFC-005-app-platform-service-library.md
blocks:
  - "PRD-058 implementation merge (requires Cortex signoff on S1)"
  - "samples/cortex-incident-triage-agent/ (requires signed port contract)"
unblocks:
  - "A7 (roadmap gate — Surface Advocate review of MethodAgentPort)"
  - "A8 (smoke-test against t1-cortex-1 dev stack)"
---

# PRD-060 — MethodAgentPort Co-Design Ratification

## Summary

S1 (`MethodAgentPort`) is already frozen on the method side (see
`.method/sessions/fcd-surface-method-agent-port/decision.md`, 2026-04-14).
Unlike PRDs 057/058/059 which **build** things, PRD-060's job is to
**ratify** that freeze bilaterally with the Cortex team, establish the
cross-team change-control process that governs the port's evolution, and
define the migration path if S1 needs amendment after freeze.

The Surface **is** the artifact; this PRD is the **governance wrapper**
around it. It produces (a) a bilaterally signed freeze document, (b) a
CHANGES.md template + change-control SOP, (c) a RACI matrix between the
two teams, and (d) evidence that the first sample app can be written
against S1 end-to-end.

## Problem

A frozen surface without bilateral signoff is a *unilateral* surface.
`MethodAgentPort` was co-designed through the method-side `/fcd-surface`
ritual, but the Cortex team — the sole consumer of this port — has not
formally ratified it. Three failure modes are imminent without ratification:

1. **Silent drift.** Cortex discovers a missing facade mid-implementation
   (e.g. `ctx.secrets`, `ctx.notify`) and adds it ad-hoc to their side,
   producing two structural `CortexCtx` subsets that both claim to be S1.

2. **Breaking change by ambiguity.** Method team ships a minor bump
   (adding an optional `CortexCtx.foo` field) that Cortex's type
   declaration file doesn't expose, breaking structural compatibility in
   a way semver alone cannot signal.

3. **Migration paralysis.** When a real breaking change is needed
   (e.g. `AgentEvent` variant removal, `createMethodAgent` going async),
   there is no agreed protocol for proposing, debating, or rolling out
   the change across both codebases. The port freezes the *interface* but
   not the *evolution process*.

S1 is the contract; this PRD establishes the **meta-contract** governing
how S1 changes.

## Constraints

**Non-negotiable (inherited from S1 and FCD discipline):**

- **Producer-owned semver.** `@method/agent-runtime` owns version
  numbers. Consumer (Cortex) cannot unilaterally declare a bump.
- **Bilateral approval for breaking changes.** Any `major` bump requires
  a new `/fcd-surface` session co-signed by both Surface Advocates.
- **Type-only Cortex imports.** The port declares `CortexCtx` structurally;
  Cortex must not require `@cortex/sdk` value imports in
  `@method/agent-runtime` at runtime. This is a gate, not a guideline
  (G-BOUNDARY in §8 of decision.md).
- **Cadence floor.** Surface review happens at minimum quarterly or on
  every `major` proposal, whichever comes first. No "set and forget."

**Imposed by roadmap:**

- **April 21 demo freeze.** S1 cannot be amended between now and
  April 21 (incident-triage demo) except for bug-level clarifications
  (no field adds/removes). Ratification must complete *before* the demo.
- **Peer-dep invariant.** `@method/pacta` is a peer dep; if pacta majors,
  agent-runtime majors, and S1's `Pact`/`AgentEvent` re-exports may shift.
  Change-control must anticipate cascaded majors.

**Resource:**

- **S size.** No new code, no new packages. Artifacts are governance
  documents + one end-to-end validation run.
- **No separate ratification infrastructure.** Reuse the existing
  `.method/sessions/` + `co-design/` directory convention. The signoff
  document lives in the repo where the port owner lives.

## Success Criteria

Three measurable outcomes. All three must hold for PRD-060 to close.

1. **SC-1 — Bilateral signoff on S1.** A single file
   `co-design/method-agent-port.md` exists in this repo, containing:
   - A copy (or authoritative reference) of the frozen decision.md §4 interface.
   - A "Signed by method team" line with named Surface Advocate.
   - A "Signed by Cortex team" line with named Surface Advocate.
   - Dates for both signatures.
   Signoff is evidenced by a merged PR in `t1-cortex-1` that
   references the file and declares acceptance in its description.

2. **SC-2 — Change-control protocol published.** A document
   `co-design/CHANGES.md` exists that:
   - Enumerates the three change classes (additive / clarification / breaking).
   - Specifies the procedure for each (minor bump + CHANGELOG / note
     only / new `/fcd-surface` session + both-sides PR).
   - Names the cadence for surface review (quarterly + on-demand).
   - Provides a RACI matrix (§7 of this PRD).
   - Is referenced from the decision.md `Agreement` section.

3. **SC-3 — End-to-end surface validation.** The first sample app
   (`samples/cortex-incident-triage-agent/`, roadmap A6) compiles and
   runs against a mock `CortexCtx` implementing the frozen facades.
   The sample app's type checker must accept *only* the symbols the
   decision.md exports — no `@cortex/*` value imports, no reaches into
   `@method/pacta` internals. Evidenced by CI green on the sample app
   in `method-1` and by PRD-058's G-PORT gate passing.

Optional but recommended: **SC-0 (pre-req)** — joint surface-read session
(30 min, recorded in `co-design/readthrough-YYYY-MM-DD.md`) where both
Surface Advocates walk through the decision.md together and log
clarification questions. This is the gate that *catches* drift before it
becomes a change request.

## Scope

### In scope

- **Ratification artifacts.** `co-design/method-agent-port.md` (signoff),
  `co-design/CHANGES.md` (change-control SOP), `co-design/RACI.md` (or
  inline in CHANGES.md — §7 of this PRD).
- **Change-control SOP.** Written protocol for how an amendment proposal
  flows from idea → fcd-debate (if contentious) → fcd-surface session →
  both-sides PR → version bump. One process, two repos.
- **Surface review cadence.** Quarterly review meeting stub + trigger
  conditions for ad-hoc review (e.g. ≥ 3 pending amendments, any Cortex
  RFC-005 amendment touching `ctx.*` facades listed on S1).
- **RACI matrix.** Responsible / Accountable / Consulted / Informed
  rows for each amendment class.
- **First sample-app contract validation.** Supervising role in PRD-058's
  sample app shipping — no direct implementation, but PRD-060 is not
  closable until the sample app demonstrates S1 end-to-end.
- **Migration path for post-freeze amendments.** A documented playbook:
  "If S1 needs a breaking change after ratification, here are the six
  steps." (§5 of this PRD.)
- **Surface Advocate role definition.** Who fills the role on each side,
  what they are empowered to sign, what they must escalate.

### Out of scope

- **Any code in `@method/agent-runtime` itself.** PRD-058's job.
- **Any code in `@method/pacta-provider-cortex`.** PRD-059's job.
- **`CortexLLMProvider`, audit middleware, token-exchange middleware
  implementations.** PRD-059's job; PRD-060 only ratifies that S1's
  injection shape accommodates them.
- **SessionStore, JobBackedExecutor, EventConnector, MethodologySource.**
  Surfaces S4–S7, separate ratification PRDs (implicit in the roadmap
  surface-by-surface signoff cadence). S1 is the top-level surface;
  ratifying it does not ratify the others.
- **Cortex-side `ctx.*` facade implementations.** Out of method's
  control; ratification says "S1's declared shape matches Cortex's
  actual shape," not "Cortex has shipped those facades."
- **A new governance tool or dashboard.** The RACI + CHANGES.md live as
  markdown. No tracker, no sheet, no bot. If the process needs tooling,
  that's a future PRD.
- **Cross-PRD surface-batch ratification.** This PRD ratifies S1 only.
  S2–S9 need their own (smaller) ratification PRDs or a consolidated
  "surface batch ratification" PRD later. Out of scope here.

## Domain Map

```
@method/agent-runtime  ──S1 (frozen)──►  Cortex tenant app (category: agent)
       ▲                                               │
       │ governs (PRD-060, this doc)                   │
       │                                               │
       └────────── bilateral Surface Advocacy ─────────┘

                         │
                         ▼
            co-design/method-agent-port.md  (signoff)
            co-design/CHANGES.md            (change-control SOP)
            co-design/RACI.md               (accountability matrix)
```

Only two domains are in play. The "work" of this PRD is not surface
design (already done) but governance: establishing the signed commitment
and the evolution rules.

## Surfaces (Primary Deliverable)

### S1 — MethodAgentPort

**Status:** frozen 2026-04-14. See
`.method/sessions/fcd-surface-method-agent-port/decision.md` for the
authoritative interface, gate assertions, and open-question resolutions.

**This PRD's relationship to S1:** not owner, not author — **ratifier**.
PRD-060 does not alter any field of S1. Every interface in §4 of
decision.md is reproduced verbatim by reference. If this PRD uncovers a
needed change during ratification, that change is caught by the
change-control protocol (§5 of this PRD) and handled as a proper
amendment — not by rewriting S1 in place.

**What PRD-060 produces that S1 does not:**

| Artifact | S1 (decision.md) | PRD-060 |
|---|---|---|
| Interface definition | ✔️ owns | — references |
| Gate assertions | ✔️ owns | — references |
| Producer/consumer roles | ✔️ owns | — references |
| Bilateral signatures | stub ("Reviewers (implicit)") | ✔️ produces `co-design/method-agent-port.md` with named signers |
| Change-control protocol | stub ("Changes after freeze require…") | ✔️ produces `co-design/CHANGES.md` |
| RACI matrix | — | ✔️ produces (§7 of this PRD) |
| Cadence for review | — | ✔️ produces (quarterly + triggers) |
| Migration playbook | — | ✔️ produces (§5 of this PRD) |
| Surface Advocate names | — | ✔️ assigns |

### Entity / type impact

**No new shared entities introduced by this PRD.** `CortexCtx`, `MethodAgent`,
`CreateMethodAgentOptions`, `Resumption`, and the error types are owned
by S1. This PRD ratifies the ownership structure, not the entities.

### Gate assertions

All gates are inherited from S1 (decision.md §8):
- **G-BOUNDARY** — `@method/agent-runtime` has no value imports from `@cortex/*`.
- **G-PORT** — public export set matches decision.md §4.
- **G-LAYER** — no imports from `@method/bridge`.

PRD-060 adds **one meta-gate**:

- **G-RATIFIED** — the file `co-design/method-agent-port.md` exists in
  this repo and contains both `method team signed by:` and
  `cortex team signed by:` lines with non-empty values. Enforced as a
  test in `packages/agent-runtime/src/gates/gates.test.ts` alongside
  G-BOUNDARY and G-PORT (once PRD-058 creates that package; until then,
  a temporary test at `test/ratification.test.ts`).

## Surface Evolution Rules

The canonical source of these rules is `co-design/CHANGES.md` (created
by this PRD). Reproduced here for PRD review.

### Change classes

| Class | Example | Protocol | Version |
|---|---|---|---|
| **Clarification** | Typo, wording fix, example code adjustment, non-normative note | PR to decision.md with `changelog: clarification` in the frontmatter; no version bump | patch (optional) |
| **Additive** | New optional field on `CortexCtx`, new `MethodAgent` method with default impl, new error type | PR to decision.md with `changelog: additive` + update `@method/agent-runtime` exports; `fcd-surface` not required but **recommended** for ≥ 2 field adds in one change; Surface Advocate from each side approves PR | minor |
| **Breaking** | Rename, remove, narrow field; flip default; change return type; change sync→async | **Mandatory** new `/fcd-surface` session with both teams' Surface Advocates present; mandatory `/fcd-debate` if contentious (≥ 1 advocate objects); migration plan required; both-sides PRs land on the same day | major |

### Versioning authority

- `@method/agent-runtime` owns the version number (semver).
- Producer-side bump cadence is independent of Cortex's version cadence.
- Cortex pins a range `"@method/agent-runtime": "^X.Y.Z"` and updates
  on a schedule it controls. Major bumps require a Cortex-side migration
  PR and are coordinated as a joint release.

### Peer-dependency cascade

If `@method/pacta` majors:
1. `@method/agent-runtime` majors in the same release window.
2. The major bump is treated as breaking per the table above (mandatory
   `/fcd-surface` session even if no field literally changed — because
   the re-exported `Pact` / `AgentEvent` types shifted).
3. Cortex side updates its version pin and runs the conformance testkit
   (PRD-065) against the new major.

### Deprecation protocol (additive path for eventual removal)

A field cannot be removed without first being deprecated. Deprecation:
1. Mark the field `@deprecated` in the JSDoc with a replacement hint.
2. Add to decision.md §10 "Non-Goals" or a new §12 "Deprecations."
3. Ship the deprecation in a minor bump with a CHANGELOG entry.
4. Wait ≥ one minor release (≈ 1 month observed usage) before proposing
   removal in a major bump. Removal follows the breaking-change protocol.

### Cadence

- **Quarterly surface review.** Both Surface Advocates meet to walk
  through all frozen surfaces (S1 + any others under their ownership).
  Scheduled as a recurring Cortex-method sync. Minimum agenda:
  (a) review pending amendment proposals, (b) review deprecations aging
  out, (c) review Cortex RFC-005 amendments touching listed facades.
- **On-demand review.** Triggered by:
  - Any proposed breaking change.
  - Cortex RFC-005 amendment that touches `ctx.llm` / `ctx.audit` /
    `ctx.auth` / `ctx.storage` / `ctx.jobs` / `ctx.schedule` / `ctx.events`
    shape.
  - ≥ 3 pending additive amendments (to avoid amendment pile-up).
  - Conformance testkit (PRD-065) failure on production traffic.

## Bilateral Signoff Mechanism

### The Surface Advocate role

Each team nominates **one Surface Advocate** per frozen surface. The
advocate is:

- **Named.** Not a team alias, a single human with a GitHub handle.
- **Empowered.** Can sign off on clarifications and additive changes
  without team-wide quorum. Breaking changes escalate to team review.
- **Long-lived.** Minimum 6-month commitment; handover requires a
  documented transfer (note in `co-design/RACI.md`).
- **Publicly accountable.** Their name and handle appear in
  `co-design/method-agent-port.md` and in `CHANGES.md`.

### Signoff artifact: `co-design/method-agent-port.md`

Template (created by this PRD):

```markdown
---
surface: MethodAgentPort (S1)
frozen: 2026-04-14
authoritative: .method/sessions/fcd-surface-method-agent-port/decision.md
---

# MethodAgentPort — Bilateral Signoff

This document records the bilateral acceptance of MethodAgentPort (S1)
as the contract between @method/agent-runtime and Cortex tenant apps of
category `agent`.

## Interface
See the authoritative decision.md §4 (linked above). No divergence from
that file is permitted without amendment per CHANGES.md.

## Method team
- Surface Advocate: {name} ({github-handle})
- Signed: {YYYY-MM-DD}
- Role authority: @method/agent-runtime maintainer
- Commitment: @method/agent-runtime ≥ 1.0.0 exports match decision.md §4.

## Cortex team
- Surface Advocate: {name} ({github-handle})
- Signed: {YYYY-MM-DD}
- Role authority: t1-cortex-1 platform team
- Commitment: t1-cortex-1 tenant-app category `agent` accepts
  CreateMethodAgentOptions with the declared CortexCtx shape.

## Amendment pointer
All changes to this surface follow co-design/CHANGES.md.
```

### What "signing" means operationally

Signing is evidenced by:
1. **Method-side PR** that lands `co-design/method-agent-port.md` with
   the method Surface Advocate's name and date.
2. **Cortex-side PR** in `t1-cortex-1` that references the method-side
   file by commit SHA and declares acceptance. The Cortex PR landing is
   the second signature.

Both PRs must land for SC-1 to be met. The method-side file can be
written with a placeholder `{pending}` for the Cortex signature, then
updated once Cortex's PR lands and we know the actual signer + date.

## RACI Matrix

| Activity | Method team | Cortex team |
|---|---|---|
| Define S1 interface | **A** / **R** | **C** |
| Ratify S1 (this PRD) | **R** | **A** |
| Sign `co-design/method-agent-port.md` | **R** (method advocate) | **R** (cortex advocate) |
| Own `@method/agent-runtime` semver | **A** / **R** | **I** |
| Own `@cortex/sdk` `ctx.*` shape | **I** | **A** / **R** |
| Propose a **clarification** | method or cortex | method or cortex |
| Approve a **clarification** | advocate | advocate |
| Propose an **additive** amendment | method or cortex | method or cortex |
| Approve an **additive** amendment | **A** (method advocate) | **C** (cortex advocate) |
| Propose a **breaking** amendment | method or cortex | method or cortex |
| Approve a **breaking** amendment | **A** (method advocate + team) | **A** (cortex advocate + team) |
| Run `/fcd-debate` on contentious amendment | method facilitates; both attend | cortex facilitates; both attend |
| Run `/fcd-surface` co-design for breaking change | **R** (method owner) | **R** (cortex consumer) |
| Publish version bump | **R** | **I** |
| Update Cortex version pin | **I** | **R** |
| Run conformance testkit (PRD-065) | **C** | **R** |
| Quarterly surface review | **R** (schedule + host) | **R** (attend + prepare) |
| On-demand review (triggered) | either side calls | either side calls |
| Escalation: advocate disagreement | method steering council | cortex platform lead |

Legend: R = Responsible (does it), A = Accountable (signs off),
C = Consulted (input required), I = Informed (told after).

## Migration Path (post-freeze amendment playbook)

If S1 needs a breaking amendment after ratification, the following
six-step path applies. This is the "how" that the change-control rules
(§5) invoke.

1. **Proposal.** Either side files an amendment proposal as a draft
   note in `co-design/proposals/YYYY-MM-DD-{slug}.md`. Proposal includes
   motivation, proposed interface diff, impact on both sides, migration
   sketch.

2. **Classification.** Surface Advocates meet (or async-review) and
   classify: clarification / additive / breaking. Record classification
   in the proposal file.

3. **Debate (if contentious).** If either advocate objects, escalate to
   `/fcd-debate` with both advocates + their teams' representatives
   present. Output is a written decision recorded in the proposal file.

4. **Co-design (if breaking).** Run a new `/fcd-surface` session with
   both advocates. Produces a new decision.md (or an addendum to the
   existing one). The old decision.md becomes historical record.

5. **Coordinated release.** Method ships the new major on `next` tag;
   Cortex ships the pin bump on a feature branch; both land on the same
   day with cross-links in their respective PR descriptions. Conformance
   testkit (PRD-065) must pass on the Cortex side before merge.

6. **Signoff refresh.** Update `co-design/method-agent-port.md` with the
   new version line and re-sign. Old versions archived in
   `co-design/history/method-agent-port-vN.md`.

**Rollback path.** If a coordinated release fails on either side, both
roll back. Method deprecates the shipped major (patches it with a "do
not use, see X" notice); Cortex reverts the pin. The proposal file is
marked `status: reverted` with a post-mortem.

## Per-Domain Architecture

Architecturally this PRD is a **governance layer**, not a software
layer. No FCA domain owns new code. The artifacts live in two
conceptual slots:

### Slot 1 — `co-design/` directory in `method-1`

Files:
- `co-design/method-agent-port.md` — signoff for S1 (template §6 of this PRD).
- `co-design/CHANGES.md` — change-control SOP (template §5 of this PRD).
- `co-design/RACI.md` — *or* inline §7 of CHANGES.md. Chose inline for
  fewer files.
- `co-design/proposals/` — future amendment proposals (empty at ratification).
- `co-design/history/` — archived pre-amendment snapshots (empty).

**Gate test** (PRD-058 will integrate): `G-RATIFIED` asserts the first
two files exist and are non-empty.

### Slot 2 — Cross-repo reference in `t1-cortex-1`

A single file referenced from the Cortex side's RFC-005 (or a new
Cortex-side PRD) that:
- Pins the commit SHA of method-side `co-design/method-agent-port.md`.
- Declares Cortex's acceptance and names the Cortex Surface Advocate.

**Method team does not own this file.** Cortex team writes it. PRD-060
closes when the Cortex-side file lands (SC-1 evidence).

### No new packages, no new imports, no new tests (beyond G-RATIFIED)

Intentional. This PRD is not allowed to grow beyond governance without
becoming a build PRD.

## Phase Plan

### Wave 0 — Ratification artifacts (this PRD's implementation wave)

Duration estimate: 2–3 days (writing + internal review + send to Cortex).

| Step | Owner | Deliverable |
|---|---|---|
| W0.1 | Method Surface Advocate | Create `co-design/` directory and `CHANGES.md` per §5 template |
| W0.2 | Method Surface Advocate | Create `co-design/method-agent-port.md` per §6 template, method side signed, Cortex placeholder |
| W0.3 | Method team | PR the above to `method-1` with G-RATIFIED gate relaxed for Cortex placeholder (temporary) |
| W0.4 | Method Surface Advocate | Send signoff-request to Cortex team with pointer to decision.md + CHANGES.md + co-design file |
| W0.5 | Cortex Surface Advocate | Schedule SC-0 joint readthrough session (30 min, record clarification questions) |
| W0.6 | Both advocates | Run readthrough; file clarifications (if any) as **clarification-class** PRs per CHANGES.md |
| W0.7 | Cortex team | PR on `t1-cortex-1` side that names Cortex advocate + cross-links method file |
| W0.8 | Method team | Update `co-design/method-agent-port.md` with Cortex signer name + date; tighten G-RATIFIED |

**Acceptance gates for Wave 0:**
- SC-1 green: both signatures present.
- G-RATIFIED passes in `method-1` CI.
- Cortex-side acceptance PR merged.

### Wave 1 — Validation (overlaps PRD-058)

Duration: 1 week (gated on PRD-058 sample-app progress).

| Step | Owner | Deliverable |
|---|---|---|
| W1.1 | PRD-058 (supervised by this PRD) | Ship `samples/cortex-incident-triage-agent/` that compiles against frozen S1 exports |
| W1.2 | Method team | Verify no `@cortex/*` value imports and no `@method/pacta` reaches (G-BOUNDARY, G-LAYER) |
| W1.3 | Cortex team | Run the sample app against their mock or dev `ctx` |
| W1.4 | Both | Confirm SC-3: end-to-end validation green |

**Acceptance gate for Wave 1:** PRD-060 closes.

### Wave 2 — Ongoing cadence (post-close, recurring)

Not a delivery wave; this is the recurring responsibility PRD-060
creates. Method team books the quarterly review; both sides file
amendments via `co-design/proposals/`. No further PRD action needed —
the process runs itself per CHANGES.md.

## Risks

### R-1 — Cortex team rejects part of S1

**Probability:** medium. **Impact:** high. The decision.md was authored
from the method side; Cortex may disagree on Q4 (custom provider
escape hatch), Q9 (budget pre-reservation), or Q3 (token-exchange depth
enforcement), each of which has cross-cutting implications.

**Fallback.** Any rejection is handled as a **pre-freeze amendment**:
rewind S1's status from `frozen` to `in-review` in decision.md, run a
joint `/fcd-surface` session, re-freeze. This is expensive but cheaper
than shipping a rejected port. **Do not** ship PRD-058 implementation
against an un-accepted S1 — the G-PORT gate should fail CI until SC-1 is
green.

**Mitigation.** Do the SC-0 readthrough *before* PRD-058 merges any
substantial code. Catch disagreement early.

### R-2 — Cortex team signs off without reading decision.md carefully

**Probability:** medium-low (given FCD discipline). **Impact:** high
(drift appears later as mysterious incompatibilities).

**Fallback.** Mandatory SC-0 readthrough with a structured checklist
(one line per decision.md §4 subsection; advocate initials each line).
Non-negotiable gate before signature.

### R-3 — Surface Advocate turnover

**Probability:** medium over 6-month window. **Impact:** medium.

**Fallback.** `co-design/RACI.md` handover clause: departing advocate
files a handover note naming successor + bringing them through
decision.md before leaving. Repo state carries institutional memory.

### R-4 — Change-control protocol bypassed by "just ship it" PR

**Probability:** medium. **Impact:** very high (re-introduces unilateral
surface).

**Fallback.** G-RATIFIED gate is one layer; add a CI rule that any PR
changing `packages/agent-runtime/src/index.ts` public exports or
decision.md §4 must touch `co-design/CHANGES.md` as well (or have a
`changelog: clarification` frontmatter in decision.md). Not
bulletproof but creates friction.

### R-5 — Amendment pile-up (3+ pending, no review)

**Probability:** high if quarterly cadence slips. **Impact:** medium
(forced large-batch amendments lose granularity).

**Fallback.** On-demand review trigger for ≥ 3 pending proposals
(stated in §5 Cadence). Enforce with a lightweight count in
`co-design/proposals/` — if count hits 3, either advocate can call
on-demand review.

### R-6 — Peer-dep cascade produces silent major on agent-runtime

**Probability:** medium (pacta is under active development). **Impact:**
medium (Cortex gets an unexpected major).

**Fallback.** Pacta-side release process must notify agent-runtime
Surface Advocate *before* tagging a major. Captured in §5 "Peer-dep
cascade" rule. Add to pacta's CONTRIBUTING.md once this PRD lands.

### R-7 — decision.md mutated without amendment

**Probability:** low-medium (new contributors may "fix typos" casually).
**Impact:** high (contract drift).

**Fallback.** decision.md frontmatter `status: frozen` is a hint; the
real guard is code review. Add a CODEOWNERS entry: any change to
`.method/sessions/fcd-surface-*/decision.md` requires method-team owner
review. Cheap and effective.

## Acceptance Gates (close criteria)

PRD-060 closes when **all** of the following are green:

1. ✅ `co-design/method-agent-port.md` exists, method signature present.
2. ✅ `co-design/CHANGES.md` exists, matches §5 template.
3. ✅ RACI matrix published (inline in CHANGES.md or `co-design/RACI.md`).
4. ✅ Cortex-side acceptance PR merged in `t1-cortex-1`; signature line
      in method-side file updated with Cortex advocate name + date.
5. ✅ SC-0 readthrough record filed at `co-design/readthrough-YYYY-MM-DD.md`
      (strong recommendation; hard requirement if any clarifications
      were raised).
6. ✅ G-RATIFIED gate passes in `method-1` CI.
7. ✅ Sample app `samples/cortex-incident-triage-agent/` compiles
      against S1 (PRD-058 responsibility; gate shared).
8. ✅ CODEOWNERS rule added for `.method/sessions/fcd-surface-*/decision.md`.

## Appendix A — CHANGES.md template (to be created at `co-design/CHANGES.md`)

```markdown
# Surface Change Control

Governs how the surfaces in `.method/sessions/fcd-surface-*/decision.md`
evolve once frozen. Currently covers **S1 — MethodAgentPort** (as of
PRD-060). Future surfaces append here under their own `## S{N}`
heading.

## Change classes

{§5 table reproduced here}

## Versioning authority

{§5 Versioning authority reproduced}

## Peer-dependency cascade

{§5 Peer-dep cascade reproduced}

## Deprecation protocol

{§5 Deprecation protocol reproduced}

## Cadence

{§5 Cadence reproduced}

## Surface Advocates

| Surface | Method advocate | Cortex advocate | Since |
|---|---|---|---|
| S1 — MethodAgentPort | {name/handle} | {name/handle} | 2026-04-14 |

## RACI

{§7 matrix reproduced}

## Amendment log

| Date | Surface | Class | Summary | Version | PR |
|---|---|---|---|---|---|
| 2026-04-14 | S1 | initial freeze | decision.md freeze | n/a (pre-1.0) | PRD-060 |
```

## Appendix B — Relationship to other PRDs in the surface batch

PRD-060 is the **prototype** for surface ratification. The same pattern
applies to S2–S9:

- **S2** (RuntimePackageBoundary) — internal to method team, no Cortex
  signoff needed; ratification is a one-sided method-team record.
- **S3** (CortexServiceAdapters) — needs Cortex signoff; clone PRD-060
  template.
- **S4** (SessionStore + CheckpointSink) — partial Cortex involvement
  (`ctx.storage` shape); clone PRD-060.
- **S5** (JobBackedExecutor + ScheduledPact) — needs Cortex signoff
  (`ctx.jobs` + `ctx.schedule`); clone PRD-060.
- **S6** (CortexEventConnector) — needs Cortex signoff; clone PRD-060.
- **S7** (CortexMethodologySource) — needs Cortex signoff; clone PRD-060.
- **S8** (Conformance testkit) — method owns, Cortex consumes; clone PRD-060.
- **S9** (MCPCortexTransport) — **blocked** (status: needs-follow-up);
  ratification waits for O5/O6/O7 resolution.

Whether to spin up one ratification PRD per surface or batch them into
a single "S2–S8 ratification" PRD is a scope call left to the Surface
Advocates. The template from this PRD applies either way.
