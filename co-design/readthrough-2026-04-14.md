---
surface: MethodAgentPort (S1)
kind: sc-0-readthrough
date: 2026-04-14
authoritative: .method/sessions/fcd-surface-method-agent-port/decision.md
authoritative_sha: 7402c3ae419821719b8f55aa0c2201cdb93d1938
prd: PRD-060
status: method-side-complete
---

# SC-0 — Joint Surface Readthrough

PRD-060 §Success Criteria SC-0 mandates a joint surface-read session before
signatures land on `co-design/method-agent-port.md`. The readthrough is the
gate that catches drift *before* it becomes an amendment — each advocate
initials a checklist line per §4 subsection of the authoritative decision.md,
which forces an explicit read rather than a skim-and-sign.

**Protocol.** 30-minute walkthrough. One advocate reads each §4 subsection
aloud (or silently if async); the other advocate confirms understanding and
initials the checklist. Clarifications raised during the read are filed as
`changelog: clarification` PRs against `decision.md` per
`co-design/CHANGES.md` §Change classes — they do not block the signature
unless they escalate to additive or breaking.

**Status at commit time.** Method side walked through and initialled
2026-04-14. Cortex side pending — their initials land either in a subsequent
commit to this file (method-side follow-up after the countersignature PR
merges) or inline in the Cortex countersignature PR and then mirrored here.

## Checklist

Each row covers one §4 subsection of
`.method/sessions/fcd-surface-method-agent-port/decision.md` at SHA
`7402c3ae419821719b8f55aa0c2201cdb93d1938`.

| §   | Subsection | Method advocate initials | Cortex advocate initials | Clarifications raised |
|-----|---|---|---|---|
| 4.1 | `CortexCtx` injection shape (`app`, `llm`, `audit`, `events?`, `storage?`, `jobs?`, `schedule?`, `auth?`, `log?`) and the eight facade interfaces | VF | _TBD_ | none (method side) |
| 4.2 | `CreateMethodAgentOptions<T>` (ctx, pact, onEvent, eventsChannel, provider, middleware, resumption, strict) | VF | _TBD_ | none (method side) |
| 4.3 | `MethodAgent<T>` handle (pact, state, invoke, resume, abort, events, dispose) | VF | _TBD_ | none (method side) |
| 4.4 | `MethodAgentResult<T>` (extends `AgentResult<T>` + `resumption?`, `appId`, `auditEventCount`) and the opaque `Resumption` descriptor | VF | _TBD_ | none (method side) |
| 4.5 | `createMethodAgent<TOutput>(options)` factory — composition-time throw set (CapabilityError, ConfigurationError, MissingCtxError) | VF | _TBD_ | none (method side) |
| 4.6 | Error types — pacta re-exports + `ConfigurationError`, `MissingCtxError`, `UnknownSessionError`, `IllegalStateError`; retry ownership inherited from pacta | VF | _TBD_ | none (method side) |
| 4.7 | Re-exported pacta types (`Pact`, `AgentRequest`, `AgentResult`, `AgentState`, `AgentEvent`, mode variants, contract types, policies, usage, recovery intent, `AgentProvider` for the escape hatch) | VF | _TBD_ | none (method side) |
| 8   | Gate assertions (G-BOUNDARY, G-PORT, G-LAYER) — their scopes and the G-RATIFIED meta-gate introduced by this ratification | VF | _TBD_ | none (method side) |
| 9   | Open-question resolutions (Q1–Q12) — all marked resolved at freeze | VF | _TBD_ | none (method side) |
| 10  | Non-goals (multi-agent orchestration, direct `ctx.events` forwarding, scheduler integration, bridge parity) | VF | _TBD_ | none (method side) |

## Clarifications log

No clarifications were raised during the method-side read. All 12
decision-table questions (§9 Q1–Q12) were resolved inline at freeze and
there is no residual ambiguity in the §4 interface from the method
perspective.

If the Cortex side raises clarifications during their read, each one
appends a row here with:

- Question (one sentence).
- Subsection reference (§4.X).
- Resolution (link to `changelog: clarification` PR, or "deferred to
  additive amendment" with proposal path).

| # | Subsection | Question | Resolution |
|---|---|---|---|
| — | — | _(none raised on method side)_ | — |

## Sign-off

This readthrough is **not** the signature — it is the *prerequisite* that
gates the signature in `co-design/method-agent-port.md` §2–§3. The method
signature in that file attests that this row of the checklist is
initialled. The Cortex signature attests the same on the Cortex side.

- Method advocate readthrough complete: **Vledic | Franco (`@VledicFranco`)** — 2026-04-14
- Cortex advocate readthrough complete: **_TBD — Cortex Surface Advocate_** — _TBD_

Once both columns are initialled and the clarifications log is finalised,
this file is frozen (no further edits). Future ratifications use a fresh
file `co-design/readthrough-YYYY-MM-DD.md` per surface; this one remains as
the SC-0 evidence for S1.
