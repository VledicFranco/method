# `co-design/history/`

Archives **closed amendments, superseded ratifications, and post-mortems**
for ratified surfaces governed by `../CHANGES.md`.

## When files land here

Three flows move a file into this directory:

1. **Landed amendment superseded by a later release.** A proposal from
   `../proposals/` with `status: landed` stays at its original path for
   one minor release as an open-reference; once superseded, it moves
   here.
2. **Rolled-back amendment.** A proposal marked `status: reverted` per
   `../CHANGES.md` §Amendment proposal workflow (rollback path) moves
   here immediately with its post-mortem appended.
3. **Superseded surface ratification.** When a surface goes through a
   breaking change and gets a fresh ratification, the previous
   `co-design/<surface>.md` is archived here as
   `<surface>-v<N>.md` before the new version replaces it.

## Naming

| Flow | Pattern |
|---|---|
| Landed amendment | `amendment-YYYY-MM-DD-<slug>.md` (preserves the original proposal filename's date + slug) |
| Reverted amendment | `reverted-YYYY-MM-DD-<slug>.md` |
| Superseded ratification | `<surface-slug>-v<N>.md` (e.g., `method-agent-port-v1.md` when v2 ratifies) |
| Quarterly review note | `review-YYYY-Q<N>.md` (per `../CHANGES.md` §Cadence) |

## Quarterly review records

Per `../CHANGES.md` §Cadence (quarterly surface review), each quarterly
review produces a short note checked in here as `review-YYYY-QN.md`.
Minimum content: attendees, surfaces reviewed, findings, any amendments
triggered, any deprecations eligible for removal in the next major. These
accumulate as the audit trail of the change-control process itself.

## What does NOT go here

- Open proposals (live at `../proposals/`).
- Active ratification signoff docs (live at `../`).
- Active SC-0 readthroughs (live at `../`).
- `../CHANGES.md` itself — that is the living SOP and is never archived.

Directory is otherwise empty at PRD-060 close. First real entry will be
either a quarterly review note (Q3 2026) or the first landed amendment,
whichever comes first.
