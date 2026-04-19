# sample-cortex-incident-triage-agent

Reference tenant app for PRD-058 / April-21 demo gate. Shows how to embed a
method-governed agent inside a Cortex service (category `agent`, Tier 2)
with one import and one call.

This sample is **not published**. It exists as an executable contract: CI
runs it as part of `npm test`, and it is the go-to reference when onboarding
a new tenant team to `@methodts/agent-runtime`.

## Run

```bash
npm --workspace=sample-cortex-incident-triage-agent test
```

No API keys, no network, no Cortex dev stack — the tests use an in-process
spy-backed `CortexCtx` (see `test/mock-ctx.ts`).

## Dev-stack run (manual)

Against a real Cortex dev stack:
1. Ensure `@t1/cortex-sdk` is installed and `ctx` is wired by the Cortex
   runtime (RFC-005 §9, `export default async function app(ctx)`).
2. Replace `runTriageAgent(ctx)` with the Cortex app-entry wiring.
3. Verify `ctx.audit.event` writes land in the dev audit stream.

## Shape

- `src/agent.ts` — tenant entry: `runTriageAgent(ctx)`
- `src/pacts/incident-triage.ts` — the Pact<TriageOutput>
- `src/types.ts` — TriageOutput schema
- `test/mock-ctx.ts` — in-process mock ctx
- `test/end-to-end.test.ts` — asserts invoke, audit, onEvent, events-connector wiring
- `test/resumption.test.ts` — Resumption token round-trip

## Gates asserted

- `G-AUDIT-WIRED` — `ctx.audit.event` called per invocation
- `G-EVENTS-MUTEX` — events() vs onEvent enforced
- `G-BUDGET-SINGLE-AUTHORITY` — predictive enforcer (end-to-end)
- `G-SAMPLE-BUILDS` — this package builds and its tests pass
