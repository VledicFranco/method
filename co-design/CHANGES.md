# Surface Change Control

Governs how the surfaces defined in `.method/sessions/fcd-surface-*/decision.md`
evolve once frozen. Currently covers **S1 — MethodAgentPort** as ratified by
PRD-060 on 2026-04-14. Future ratified surfaces append to the Surface
Advocates, RACI, and Amendment log sections under their own headings; the
general rules (change classes, versioning, cadence, deprecation, gates)
apply to all surfaces uniformly.

> **Scope note.** This document is the canonical change-control SOP for all
> method-owned surfaces ratified via the PRD-060 template. It is *not* the
> interface definition — interfaces live in the authoritative `decision.md`
> files. It is also *not* the signoff record — those live in
> `co-design/<surface-slug>.md`. This file is the **meta-contract** that
> governs how every other file in `co-design/` evolves.

## Change classes

Every proposed modification to a frozen surface falls into exactly one of
three classes. The class determines the protocol, the approver, and the
version bump.

| Class | Example | Protocol | Version |
|---|---|---|---|
| **Clarification** | Typo, wording fix, example code adjustment, non-normative note, documentation expansion with no semantic change | PR to `decision.md` with `changelog: clarification` in the frontmatter; no version bump required; advocate-level approval (either side) | patch (optional) |
| **Additive** | New optional field on an injection shape, new method with default implementation, new error subclass, widening a parameter type with a new union member | PR to `decision.md` with `changelog: additive` in the frontmatter; update producer package exports; `/fcd-surface` session not required for a single-field add, but **recommended** when ≥ 2 fields are added in one change; both advocates approve PR | minor |
| **Breaking** | Rename, remove, narrow a field; flip a default; change a return type; change sync → async; union-variant removal on a re-exported type | **Mandatory** new `/fcd-surface` session co-attended by both advocates; mandatory `/fcd-debate` if contentious (≥ 1 advocate objects); written migration plan; both-sides PRs land on the same day; `decision.md` status briefly flips `frozen` → `in-review` → `frozen` (new version) | major |

### Classification responsibility

Classification is a joint decision, not producer-only. If either advocate
believes a proposed "additive" change is actually breaking (e.g., because a
consumer's type inference narrows), the change is treated as breaking until
both advocates agree otherwise. Conservative classification prevents silent
drift.

## Versioning authority

- **Producer owns the version number.** `@methodts/agent-runtime` (and each
  method-owned package behind a ratified surface) owns its semver tag.
  Consumers cannot unilaterally declare a bump.
- **Producer-side bump cadence is independent** of the consumer's version
  cadence. Cortex pins a range `"@methodts/agent-runtime": "^X.Y.Z"` and
  updates on a schedule it controls.
- **Major bumps are joint releases.** A consumer-side migration PR lands on
  the same day as the producer-side release. PR descriptions cross-link.
- **No silent majors.** If a producer-side change *would* cross the
  breaking line, the change-control protocol must be entered before the
  bump tag. The peer-dep cascade (below) is the canonical example: a pacta
  major always triggers an agent-runtime major, even when no S1 field
  literally changes.

## Peer-dependency cascade

`@methodts/agent-runtime` declares `@methodts/pacta` as a peer dependency, so a
single version of pacta flows through the tenant app. This creates a
cascade rule:

1. If `@methodts/pacta` majors, `@methodts/agent-runtime` majors in the same
   release window. No exceptions.
2. The cascade major is treated as **breaking** per the classification
   table, even if no field in `decision.md` §4 literally changed. The
   re-exported `Pact`, `AgentEvent`, `AgentState`, `AgentResult`,
   `AgentRequest`, `ExecutionMode`, and error types shift with pacta; that
   is a surface break under the structural-typing invariant.
3. A mandatory `/fcd-surface` session runs to re-freeze S1 against the new
   pacta major. If no field changed in substance, the session records "no
   interface delta, peer-dep-driven major only" and re-freezes. This is
   cheaper than it sounds and is the gate that prevents structural
   drift from leaking across the surface.
4. Consumer (Cortex) updates its version pin and runs the S8 conformance
   testkit (PRD-065) against the new major.
5. Pacta release process notifies the agent-runtime Surface Advocate
   *before* tagging the pacta major. This captured-in-process rule is
   mirrored to `@methodts/pacta`'s CONTRIBUTING.md the next time that file is
   touched.

## Deprecation protocol

A field cannot be removed from a ratified surface without first being
deprecated. Deprecation is the additive path to eventual removal — it buys
consumers time to migrate before the breaking change lands.

1. **Mark the field** `@deprecated` in JSDoc with a replacement hint (name
   of the successor field, migration shape, or rationale if no successor).
2. **Record the deprecation** in the authoritative `decision.md` — either
   as a new `§Deprecations` section or as a note on the affected field. The
   PR frontmatter carries `changelog: additive` (deprecation is additive in
   tooling terms; removal is the later breaking step).
3. **Ship the deprecation in a minor bump** with a CHANGELOG entry of the
   producer package. The deprecation appears in both the field's JSDoc and
   in the producer package's release notes.
4. **Wait ≥ one minor release** (approximately one month of observed usage
   in production consumers) before proposing removal in a major bump.
5. **Remove in a major bump** following the breaking-change protocol
   (`/fcd-surface` session, migration plan, joint release). The removal PR
   references the deprecation PR.

Deprecation of a whole subsystem (e.g., an entire optional facade on
`CortexCtx`) follows the same schedule but requires a migration plan that
enumerates every consumer pattern relying on it.

## Cadence

### Quarterly surface review (standing)

Both Surface Advocates meet to walk through all frozen surfaces under their
joint ownership. This is the catch-all review that prevents amendment
pile-up and catches drift between quarters.

**Schedule.** Recurring Cortex–method sync, first week of each calendar
quarter. Method side books and hosts; Cortex side attends and prepares.

**Minimum agenda:**

1. Review pending amendment proposals in `co-design/proposals/`.
2. Review deprecations aging out (≥ one minor release elapsed → eligible
   for removal in next major).
3. Review Cortex RFC-005 amendments landed since last review, scanned for
   any that touch the facades listed on ratified surfaces.
4. Review peer-dep cascade risk: any planned `@methodts/pacta` majors?
5. Review G-RATIFIED and related gates in CI — still passing?

**Output.** A short review note checked into `co-design/history/` as
`review-YYYY-QN.md`. If the review triggers an amendment, the amendment
follows the standard change-class protocol.

### On-demand review (triggered)

Either Surface Advocate can call an on-demand review. Triggers:

- **Any proposed breaking change** — mandatory, not optional.
- **Cortex RFC-005 amendment** that touches `ctx.llm`, `ctx.audit`,
  `ctx.auth`, `ctx.storage`, `ctx.jobs`, `ctx.schedule`, or `ctx.events`
  shape — mandatory for any surface that names that facade.
- **≥ 3 pending additive amendments** in `co-design/proposals/` — prevents
  amendment pile-up and forced large-batch rollups that lose per-change
  granularity.
- **Conformance testkit failure** (PRD-065) on production traffic — the
  conformance suite is the empirical signal that the ratified surface no
  longer matches reality; a failure is a de-facto amendment trigger.
- **Advocate disagreement** on a classification (clarification vs additive
  vs breaking) — escalate via on-demand review rather than argue in PR
  threads.

Any of the above triggers can be invoked by either side; the other side is
obligated to attend within one week of the call.

## Gates

The change-control SOP is backed by three automated gates. Only
`G-RATIFIED` is introduced by this PRD; the others are inherited from S1's
`decision.md` §8 and land with PRD-058.

### G-RATIFIED (meta-gate, introduced by PRD-060)

**Semantics.** For every ratified surface, assert that:

1. A signoff file exists at `co-design/<surface-slug>.md`.
2. The signoff file's frontmatter declares the authoritative decision.md
   path and a pinned `authoritative_sha`.
3. Both `method team` and `cortex team` signature blocks are present.
4. Both signature blocks contain a non-empty `Signed:` date. The
   `awaiting-cortex-signature` status is a permitted intermediate state
   during which the Cortex `Signed:` field may be the placeholder
   `_TBD — Cortex Surface Advocate signature_`; in that state the gate is
   **permissive** (presence-only). Once the status flips to `ratified`,
   the gate becomes **strict** (non-empty signer name + date required).
5. A corresponding `decision.md` exists at the path declared in the
   signoff frontmatter.
6. `co-design/CHANGES.md` (this file) exists and is non-empty.

**Ship location.** Per PRD-060 §8, the real test assertion lands in
`packages/agent-runtime/src/gates/gates.test.ts` alongside G-BOUNDARY and
G-PORT. That package is introduced by **PRD-058** — this PRD (PRD-060)
only defines the gate semantics; PRD-058 implements the assertion.

Until PRD-058 lands, G-RATIFIED is enforced by human review: any PR that
touches `co-design/*.md`, `CODEOWNERS`, or any
`.method/sessions/fcd-surface-*/decision.md` must explicitly reference
this gate's six checks in its PR description.

### G-BOUNDARY, G-PORT, G-LAYER (inherited from S1)

See `.method/sessions/fcd-surface-method-agent-port/decision.md` §8. These
gates assert that `@methodts/agent-runtime`:

- has no value imports from `@cortex/*` (G-BOUNDARY, keeps the structural
  typing invariant that makes S1 testable without Cortex).
- exports the exact symbol set declared in S1's §4 (G-PORT).
- does not import from `@methodts/bridge` — L3 does not reach L4 (G-LAYER).

These gates land in PRD-058 and are referenced by G-RATIFIED: a surface is
not truly ratified until its producer package passes its own gates.

## Surface Advocates

| Surface | Method advocate | Cortex advocate | Since |
|---|---|---|---|
| S1 — MethodAgentPort | Vledic \| Franco (`@VledicFranco`) | Francisco Aramburo (`@VledicFranco`) | 2026-04-18 |

### The Surface Advocate role

Each team nominates **one Surface Advocate** per ratified surface. The
advocate is:

- **Named.** Not a team alias. A single human with a GitHub handle. If the
  nomination is pending on either side (as with S1's Cortex side at method
  signoff time), the placeholder `_TBD — <Role> Surface Advocate_` stands
  until the countersignature PR names a person.
- **Empowered.** Can sign off on clarifications and additive changes
  without team-wide quorum. Breaking changes escalate to team review.
- **Long-lived.** Minimum 6-month commitment. Handover requires a
  documented transfer — departing advocate files a handover note naming
  the successor and walking them through the authoritative decision.md
  before leaving. Transfer is recorded in this file's advocate table and
  in an entry in the amendment log.
- **Publicly accountable.** Named in `co-design/<surface>.md` and in this
  file.

## RACI

Responsibility matrix for S1 — MethodAgentPort. When S3–S8 ratify under
the same template, they inherit this matrix with their own producer /
consumer columns.

| Activity | Method team | Cortex team |
|---|---|---|
| Define S1 interface | **A** / **R** | **C** |
| Ratify S1 (PRD-060) | **R** | **A** |
| Sign `co-design/method-agent-port.md` | **R** (method advocate) | **R** (cortex advocate) |
| Own `@methodts/agent-runtime` semver | **A** / **R** | **I** |
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
| Notify counter-party of peer-dep major (`pacta`) | **R** (method, as pacta maintainer) | **I** |
| Maintain CODEOWNERS protection on `decision.md` | **R** | **I** |
| Escalation: advocate disagreement | method steering council | cortex platform lead |

**Legend.** R = Responsible (does it), A = Accountable (signs off),
C = Consulted (input required), I = Informed (told after).

## Amendment proposal workflow

When either side wants to propose a change:

1. **Proposal.** File a draft note in
   `co-design/proposals/YYYY-MM-DD-<slug>.md`. Proposal includes
   motivation, proposed interface diff, impact on both sides, migration
   sketch.
2. **Classification.** Surface Advocates meet (or async-review within one
   week) and classify: clarification / additive / breaking. Record
   classification in the proposal file.
3. **Debate (if contentious).** If either advocate objects to the
   classification, the proposed change, or the migration plan, escalate to
   `/fcd-debate` with both advocates + team representatives present.
   Written decision recorded in the proposal file.
4. **Co-design (if breaking).** Run a new `/fcd-surface` session with both
   advocates. Produces a new `decision.md` (or an addendum to the
   existing one). The old `decision.md` becomes a historical record under
   `co-design/history/`.
5. **Coordinated release.** Producer ships the new major on its `next`
   tag; consumer ships the pin bump on a feature branch; both land on the
   same day with cross-links in their respective PR descriptions.
   Conformance testkit (PRD-065) must pass on the consumer side before
   merge.
6. **Signoff refresh.** Update `co-design/<surface>.md` with the new
   version line and re-sign. Old version archived under
   `co-design/history/<surface>-vN.md`.

**Rollback path.** If a coordinated release fails on either side, both
roll back. Producer deprecates the shipped major (patches it with a
"do not use, see X" notice); consumer reverts the pin. The proposal file
is marked `status: reverted` with a post-mortem referenced from the
amendment log below.

## Amendment log

| Date | Surface | Class | Summary | Version | PR |
|---|---|---|---|---|---|
| 2026-04-14 | S1 | initial freeze + bilateral ratification | `decision.md` freeze via `/fcd-surface`; ratification artifacts produced by PRD-060 (this file, `method-agent-port.md`, `readthrough-2026-04-14.md`, CODEOWNERS, `proposals/` and `history/` scaffolds) | n/a (pre-1.0) | PRD-060 |
| 2026-04-18 | S1 | ratification | Cortex countersignature landed; status flipped to `ratified`. No interface change (SHA `7402c3ae419821719b8f55aa0c2201cdb93d1938` still authoritative). G-RATIFIED gate now exits permissive form. | n/a | this commit |
| 2026-04-19 | S-CORTEX-ANTHROPIC-TRANSPORT | additive | Wave 2 / C-2: implement `cortexAnthropicTransport` body in `@methodts/pacta-provider-cortex` — new pairing export with `@methodts/pacta-provider-claude-agent-sdk` (S-ANTHROPIC-SDK-TRANSPORT consumer). Localhost HTTP proxy injects `ANTHROPIC_BASE_URL`, intercepts `/v1/messages` POSTs, ducktypes `ctx.llm.reserve/settle` (Cortex O1) with documented degraded-mode fallback, emits `method.transport.turn_completed` audit per turn. No S3 amendment — additive new file, frozen surfaces (S3 ctx.llm/ctx.audit) unchanged. Frozen Wave 0 ctx parameter shape (`CortexLlmCtx & CortexAuditCtx`, flat) preserved. | n/a (pre-1.0) | feat/claude-agent-sdk-c2-cortex-transport |

Future entries append in chronological order. Each entry must link to a PR
(or a commit SHA, when the change lands outside a PR flow) so the audit
trail stays walkable.
