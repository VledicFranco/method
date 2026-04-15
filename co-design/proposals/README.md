# `co-design/proposals/`

Holds **open amendment proposals** for ratified surfaces governed by
`../CHANGES.md`.

## When to add a file here

Either Surface Advocate files a proposal when they want to amend a ratified
surface. Per `../CHANGES.md` §Amendment proposal workflow, step 1:

> **Proposal.** File a draft note in
> `co-design/proposals/YYYY-MM-DD-<slug>.md`. Proposal includes motivation,
> proposed interface diff, impact on both sides, migration sketch.

## Naming

`YYYY-MM-DD-<kebab-slug>.md` where:

- `YYYY-MM-DD` is the date the proposal was filed (not the date it lands).
- `<kebab-slug>` is a short description of the change. Examples:
  `2026-05-20-ctx-secrets-facade.md`,
  `2026-06-03-method-agent-cancel-token.md`,
  `2026-07-11-pacta-major-2-cascade.md`.

## Required sections in each proposal file

Per `../CHANGES.md`:

1. **Motivation** — why this change is needed, what it unblocks.
2. **Classification** — clarification / additive / breaking (classified by
   joint advocate review per §Classification responsibility).
3. **Interface diff** — exact shape change against the authoritative
   `decision.md`.
4. **Impact on both sides** — what the producer ships, what the consumer
   migrates.
5. **Migration sketch** — the consumer-side update steps (omitted for
   clarifications, required for additive, detailed for breaking).
6. **Debate record** (only if `/fcd-debate` was run) — written decision and
   attendees.
7. **Status** — one of: `draft`, `classified`, `in-fcd-surface`,
   `landed`, `reverted`.

## Count threshold

Per `../CHANGES.md` §Cadence on-demand review triggers: once this
directory contains **≥ 3 pending additive proposals** (`status: draft` or
`status: classified` and not yet `landed`), either Surface Advocate can
call an on-demand review to prevent amendment pile-up.

## Lifecycle

1. Created here as `status: draft`.
2. Classified in joint review → `status: classified`.
3. If breaking: routes through `/fcd-surface`; `status: in-fcd-surface`.
4. When the producer-side PR merges (and consumer-side, for breaking
   changes): `status: landed`. The proposal file stays here for a minor
   release as an open-reference, then is **moved** to `../history/` when
   its landing release is superseded.
5. If rolled back: `status: reverted` with a post-mortem note. The file
   moves to `../history/` immediately.

## What does NOT go here

- Ratification signoff documents (live at `../` as
  `<surface-slug>.md`).
- SC-0 readthrough records (live at `../` as
  `readthrough-YYYY-MM-DD.md`).
- Historical post-mortems or superseded ratifications (live at
  `../history/`).
- Anything not scoped to a ratified surface amendment.

Directory is otherwise empty at PRD-060 close. First real entry lands when
the first amendment is proposed.
