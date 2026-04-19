---
surface: MethodAgentPort (S1)
frozen: 2026-04-14
authoritative: .method/sessions/fcd-surface-method-agent-port/decision.md
authoritative_sha: 7402c3ae419821719b8f55aa0c2201cdb93d1938
prd: PRD-060
status: ratified
---

# MethodAgentPort — Bilateral Signoff

This document records the bilateral acceptance of **S1 — MethodAgentPort** as
the contract between `@methodts/agent-runtime` (producer) and Cortex tenant apps
of category `agent` (consumer, Tier 2 per RFC-005 §10.2).

It is produced by PRD-060 (`.method/sessions/fcd-design-prd-060-method-agent-port/prd.md`)
as the first of nine planned surface ratifications (S1–S9). The ratification
pattern established here is reused for S3–S8; S2 and S9 have scope notes
below.

## 1. Authoritative Interface

The frozen interface lives in the authoritative decision record — do not
duplicate it here. Any divergence between implementation and that file is a
contract violation handled by `co-design/CHANGES.md`.

- **Path:** `.method/sessions/fcd-surface-method-agent-port/decision.md`
- **Commit SHA at signoff:** `7402c3ae419821719b8f55aa0c2201cdb93d1938`
- **Frozen date:** 2026-04-14
- **Interface section:** §4 (CortexCtx, CreateMethodAgentOptions,
  MethodAgent, MethodAgentResult, createMethodAgent factory, errors,
  re-exported pacta types)
- **Gate assertions:** §8 (G-BOUNDARY, G-PORT, G-LAYER)
- **Open-question resolutions:** §9 (Q1–Q12, all resolved at freeze)

Signing this document means: "the interface at the SHA above is the contract
I will implement / consume against, and any future divergence routes through
`co-design/CHANGES.md`."

## 2. Method team

- **Surface Advocate:** Vledic | Franco (`@VledicFranco`)
- **Signed:** 2026-04-14
- **Role authority:** `@methodts/agent-runtime` maintainer; pacta composition
  engine owner
- **Commitment:**
  - `@methodts/agent-runtime` ≥ 1.0.0 public exports match decision.md §4
    verbatim.
  - No narrowing, renaming, or removal of any symbol in §4 without a new
    `/fcd-surface` session co-attended by both advocates.
  - Quarterly surface review honored (see `co-design/CHANGES.md` §Cadence).
  - Peer-dep cascade on `@methodts/pacta` handled per `co-design/CHANGES.md`
    §Peer-dependency cascade — no silent majors.
  - CODEOWNERS protection on `.method/sessions/fcd-surface-*/decision.md`
    maintained (see repository root `CODEOWNERS`).

## 3. Cortex team

- **Surface Advocate:** Francisco Aramburo (`@VledicFranco`)
- **Signed:** 2026-04-18
- **Role authority:** `t1-cortex-1` platform team (tenant-app category
  `agent`, Tier 2 per RFC-005 §10.2)
- **Commitment (pending countersignature):**
  - `t1-cortex-1` tenant apps of category `agent` accept
    `CreateMethodAgentOptions` with the declared `CortexCtx` shape
    (decision.md §4.1).
  - `ctx.llm`, `ctx.audit`, and `ctx.auth` facades conform structurally to
    `CortexLlmFacade`, `CortexAuditFacade`, and `CortexAuthFacade` as
    declared in §4.1. Optional facades (`ctx.events`, `ctx.storage`,
    `ctx.jobs`, `ctx.schedule`, `ctx.log`) either conform or are absent —
    never present with a divergent shape.
  - Any Cortex-side RFC-005 amendment touching `ctx.llm` / `ctx.audit` /
    `ctx.auth` / `ctx.storage` / `ctx.jobs` / `ctx.schedule` / `ctx.events`
    shape triggers an on-demand surface review (see `co-design/CHANGES.md`
    §Cadence).
  - Cortex-side acceptance PR in `t1-cortex-1` references this file by
    commit SHA and declares acceptance in its description; landing that PR
    is the second signature.

### How Cortex countersigns

1. Cortex file a PR in `t1-cortex-1` that:
   - Pins the commit SHA of this file (the method-side ratification doc).
   - Names their Surface Advocate (human + GitHub handle).
   - Declares acceptance of the interface at the authoritative SHA above.
2. Once that Cortex-side PR is merged, the method side opens a follow-up PR
   to this repo that replaces the `_TBD — Cortex Surface Advocate signature_`
   placeholders in §3 with the real name and date, and flips the frontmatter
   `status` from `awaiting-cortex-signature` to `ratified`.

Until that follow-up PR lands, the `G-RATIFIED` meta-gate (see
`co-design/CHANGES.md` §Gates) is in its permissive form (both presence
checks on this file + `CHANGES.md` pass, but the "non-empty Cortex
signature" assertion is temporarily relaxed). PRD-060 cannot close until
the countersignature lands.

## 4. SC-0 Readthrough Status

PRD-060 §Success Criteria SC-0 mandates a joint surface-read session before
signatures land. Status at method-side signoff:

- **Method-side readthrough:** initialled in
  `co-design/readthrough-2026-04-14.md`.
- **Cortex-side readthrough:** pending — checklist in the same file is
  waiting for the Cortex Surface Advocate's initials on each §4 subsection.
- **Clarifications raised during method-side read:** none. All 12 open
  questions (Q1–Q12) were resolved inline at freeze; no residual ambiguity
  was surfaced during method-side walkthrough.

If the Cortex-side readthrough raises clarifications, they land as
`changelog: clarification` PRs against the authoritative decision.md per
`co-design/CHANGES.md` §Change classes — they do **not** block this file's
Cortex signature unless they escalate to additive or breaking.

## 5. Amendment Pointer

**All changes to this surface follow `co-design/CHANGES.md`.**

- Clarifications: no version bump; PR to decision.md with
  `changelog: clarification` frontmatter.
- Additive (new optional field, new method with default): `@methodts/agent-runtime`
  minor bump; advocate-level approval.
- Breaking (rename, remove, narrow, default-flip, sync→async): new
  `/fcd-surface` session; `@methodts/agent-runtime` major bump; both-sides
  coordinated release; this file updated and archived per
  `co-design/history/`.

Peer-dep cascade: if `@methodts/pacta` majors, `@methodts/agent-runtime` majors
in the same release window per `co-design/CHANGES.md` §Peer-dependency
cascade — this is treated as breaking even if no field literally changes on
S1, because the re-exported `Pact` / `AgentEvent` types shifted.

## 6. Related Ratifications

| Surface | Status | Ratification |
|---|---|---|
| S1 — MethodAgentPort | **this file** | PRD-060 (first ratification, prototype for S3–S8) |
| S2 — RuntimePackageBoundary | internal to method team | method-only record (no Cortex signoff needed) |
| S3 — CortexServiceAdapters | pending | clone this pattern — separate ratification PRD |
| S4 — SessionStore + CheckpointSink | pending | clone this pattern |
| S5 — JobBackedExecutor + ScheduledPact | pending | clone this pattern |
| S6 — CortexEventConnector | pending | clone this pattern |
| S7 — CortexMethodologySource | pending | clone this pattern |
| S8 — CortexAgentConformance testkit | pending | clone this pattern |
| S9 — MCPCortexTransport | blocked (`needs-follow-up`) | ratification deferred pending O5/O6/O7 resolution (see `docs/roadmap-cortex-consumption.md` §10) |

## 7. Amendment Log

See `co-design/CHANGES.md` §Amendment log. First entry is this initial
ratification (PRD-060, 2026-04-14).
