# sample-cortex-incident-triage-agent-sdk

C-4 sample for the `pacta-provider-claude-agent-sdk` realize plan
(`.method/sessions/fcd-plan-20260419-2300-pacta-claude-agent-sdk/`). Shows
how to embed a method-governed agent inside a Cortex tenant app where the
inner agent loop is driven by `@anthropic-ai/claude-agent-sdk` instead of
the manual `pacta-provider-anthropic` loop.

This is the **SDK-flavor** sibling of
[`samples/cortex-incident-triage-agent`](../cortex-incident-triage-agent/)
— the manual-loop reference. Diff the two when learning the trade-offs.

## What this sample shows

- **Composition root** (`src/agent.ts`) — one import, one call to
  `createMethodAgent({ ctx, pact, provider })` where `provider` is
  `claudeAgentSdkProvider({ transport: cortexAnthropicTransport(...) })`.
- **Cortex transport wiring** — `cortexAnthropicTransport` boots a
  localhost HTTP proxy on `127.0.0.1` and points the SDK's
  `ANTHROPIC_BASE_URL` at it. Every API call the SDK makes (per turn)
  flows through the proxy where Cortex budget hooks fire.
- **`adaptCtx` shape bridge** — the cortex transport's ctx parameter is
  a flat `CortexLlmCtx & CortexAuditCtx` intersection (see C-2 PR #193's
  Wave 0 deviation note), but `createMethodAgent` exposes the
  **nested** `CortexCtx` shape (`ctx.llm.*`, `ctx.audit.*`). The
  `adaptCtx` helper in `agent.ts` projects nested → flat without
  changing either contract. Wave 3 cleanup PRD will harmonise these.

## How it differs from the manual-loop sibling

| Concern | manual-loop sibling | this sample |
|---|---|---|
| Inner provider | `pacta-provider-anthropic` (calls Anthropic API per turn from in-process pacta loop) | `pacta-provider-claude-agent-sdk` (delegates to the `claude` CLI subprocess via `@anthropic-ai/claude-agent-sdk`) |
| Cost path | `ctx.llm.complete()` directly | HTTP proxy in `cortexAnthropicTransport` → eventual `ctx.llm.reserve/.settle` (Cortex O1) |
| Tool execution | pacta's tool runner | the SDK's tool runner (the `claude` CLI's built-in agentic loop) |
| Streaming | pacta `Streamable.stream()` | C-3 stream wired through the SDK's `Streamable.stream()` |
| Resumption | pacta's `resumable` mode | not yet — SDK provider's `capabilities.resumable === false` |

The Cortex middleware stack (token-exchange → audit → budget enforcer →
output validator) is **identical** between the two samples. That's the
point of `createMethodAgent`: tenant apps swap providers without
re-wiring governance.

## Composition pattern

```ts
import {
  createMethodAgent,
  type CortexCtx,
} from '@methodts/agent-runtime';
import { claudeAgentSdkProvider } from '@methodts/pacta-provider-claude-agent-sdk';
import { cortexAnthropicTransport } from '@methodts/pacta-provider-cortex';

import { incidentTriagePact } from './pacts/incident-triage.js';

export function createIncidentTriageAgent(ctx: CortexCtx) {
  const provider = claudeAgentSdkProvider({
    transport: cortexAnthropicTransport(adaptCtx(ctx), {
      handlers: {
        onBudgetWarning: () => undefined,
        onBudgetCritical: () => undefined,
        onBudgetExceeded: () => undefined,
      },
      appId: ctx.app.id,
    }),
  });

  return createMethodAgent({
    ctx,
    pact: incidentTriagePact,
    provider,
  });
}
```

`adaptCtx` is the flat-vs-nested shape bridge documented above. The
production version lives in `src/agent.ts`.

## Status — degraded mode

The cortex transport currently runs in **degraded mode**:
`ctx.llm.reserve()` and `ctx.llm.settle()` (Cortex O1) are not yet on
the structural `CortexLlmCtx`. Until Cortex O1 lands the transport
forwards each request directly and emits a single audit event per turn
with the actual cost. When O1 lands the transport flips to the full
pre/post pattern with no surface change in this sample.

Tracking: `PRD-080` (Cortex O1) — see C-2 PR #193 for the full footnote.

## Run

```bash
npm --workspace=sample-cortex-incident-triage-agent-sdk test
```

No API keys, no network, no Cortex dev stack — the e2e test stubs the
SDK provider at the seam (same pattern C-1's `factory.test.ts` uses)
and exercises the surrounding composition stack. A separate "wiring
smoke" test instantiates the **real** transport + SDK provider and
verifies construction succeeds without spawning the `claude` CLI.

## Dev-stack run (manual)

Against a real Cortex dev stack with a live `ANTHROPIC_API_KEY`:

```ts
import { runTriageAgent } from 'sample-cortex-incident-triage-agent-sdk/dist/src/agent.js';

export default async function app(ctx) {
  const result = await runTriageAgent(ctx);
  // ctx.notify.slack(result.output.summary);
  return result;
}
```

The cortex transport will boot the proxy, the SDK will spawn the
`claude` CLI subprocess, and every API call will flow through the
proxy → Anthropic. Audit events land in your dev audit stream.

## Files

- `src/agent.ts` — composition root, `runTriageAgent` + `createIncidentTriageAgent` + `adaptCtx`
- `src/pacts/incident-triage.ts` — the `Pact<TriageOutput>` (oneshot, read-only scope)
- `src/types.ts` — `TriageOutput` schema
- `test/end-to-end.test.ts` — AC-4.1 / AC-4.2 / AC-4.3 coverage
- `test/mock-ctx.ts` — in-process spy-backed `CortexCtx`

## Acceptance gates

- **AC-4.1** — `agent.invoke()` against `MockCortexCtx` returns the
  expected `TriageOutput` (output validator parses the SDK result)
- **AC-4.2** — degraded-mode equivalent of `ctx.llm.reserve/settle` is
  observed (`ctx.audit.event` called for the agent lifecycle)
- **AC-4.3** — PRD AC-2 (Cortex composition) holds: the assembled
  stack type-checks, instantiates with the real cortex transport, runs
  with a stubbed provider, and returns the fixture output
