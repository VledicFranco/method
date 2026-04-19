# Draft: issue O1 for PlataformaT1/t1-cortex

**Labels:** ctx.llm, PRD-068, method-integration, enhancement

**Title:** feat(llm): add ctx.llm.reserve() / settle() for multi-turn batched budget reservation

---

Method's PRD-062 (JobBackedExecutor) needs to hold a single budget
reservation across multiple pact continuations — one pact, N turns,
each turn potentially running in a different Lambda via ctx.jobs.

Today ctx.llm atomically checks + reserves per call. A multi-turn
agent either over-reserves (one big reservation up front, wastes
budget if the pact completes early) or under-reserves (one reservation
per turn, loses the guarantee that the full pact can complete within
budget without being canceled mid-flight).

In addition, the SDK-backed provider (`@methodts/pacta-provider-claude-agent-sdk`,
published 2026-04-19) runs its inner Anthropic calls through a
localhost HTTP proxy provided by `cortexAnthropicTransport` in
`@methodts/pacta-provider-cortex`. That proxy is pre-wired to call
`ctx.llm.reserve()` / `.settle()` per turn — **today it runs in
degraded mode** (reservation skipped, only post-call audit emitted)
because the methods don't yet exist. Shipping this ask flips the SDK
path into full pre-flight budget enforcement with no surface change
on the method side.

## Ask

Two new ctx.llm methods:

```ts
ctx.llm.reserve(opts: { maxCostUsd: number, ttlMs?: number })
  → Promise<ReservationHandle>

ctx.llm.settle(handle: ReservationHandle, actualCostUsd: number)
  → Promise<void>
```

Semantics:

- `reserve()` atomically holds `maxCostUsd` against the app budget;
  `complete()` / `structured()` / `embed()` calls may pass the
  reservationId and bill against this pool until exhausted or settled.
- `settle()` releases remaining reserved amount back to the app budget
  (returns the diff if `actualCostUsd < reserved`).
- `ttlMs` bounds zombie reservations (default 1h); expired handles
  auto-settle at the reserved amount.

## Related

- RFC-005 §12.3 (LLM Budget Control System) — extends atomic
  check-and-reserve contract to named reservations.
- Method surface: `.method/sessions/fcd-surface-job-backed-executor/decision.md §5`
  (budget strategies) in `VledicFranco/method`.
- SDK-path transport: `packages/pacta-provider-cortex/src/anthropic-transport.ts`
  — search for `TODO(O1):`. Duck-types `reserve/settle` on the ctx today;
  flips to unconditional once this ask lands.
- Surface decision: `.method/sessions/fcd-design-pacta-provider-claude-agent-sdk/prd.md`
  and `co-design/` (proposals + CHANGES.md) in `VledicFranco/method`.

## Blocks

- Method PRD-062 Wave 2 (batched-held strategy). Wave 1
  (fresh-per-continuation) ships without this.
- `@methodts/pacta-provider-cortex`'s `cortexAnthropicTransport` full
  mode (degraded mode ships today; flipping requires this ask).
