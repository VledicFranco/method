# @methodts/agent-runtime

Cortex-targeted public API for method-governed agents (PRD-058).

One import, one call — tenant apps embed a method-governed agent without
re-deriving the Cortex composition wiring.

## Install

```bash
npm install @methodts/agent-runtime @methodts/pacta
```

`@methodts/pacta` is a **peer dependency** — a single pacta version flows
through the tenant app's dep graph.

## Usage

```typescript
import { createMethodAgent } from '@methodts/agent-runtime';
import { incidentTriagePact } from './pacts/incident-triage.js';

export default async function app(ctx) {
  const agent = createMethodAgent({
    ctx,
    pact: incidentTriagePact,
    onEvent: (e) => { if (e.type === 'text') ctx.notify?.slack(e.content); },
  });
  const result = await agent.invoke({ prompt: ctx.input.text });
  return { ok: true, cost: result.cost.totalUsd };
}
```

The factory auto-wires the Cortex-safe middleware stack (token-exchange →
audit → predictive budget enforcer → output validator → reasoner →
`ctx.llm`). Budget enforcement is **single-authority**: pacta's enforcer
emits observability events only; `ctx.llm` is the sole rejector.

## Sample

See [`samples/cortex-incident-triage-agent/`](../../samples/cortex-incident-triage-agent/)
for the full working tenant app (no API keys, no network — runs against
an in-process mock `ctx`).

## Design contract (S1)

This package realizes the **MethodAgentPort** frozen co-design record:
[`.method/sessions/fcd-surface-method-agent-port/decision.md`](../../.method/sessions/fcd-surface-method-agent-port/decision.md).

- Factory signature, exports, error taxonomy, middleware order are frozen.
- Changes require a new `/fcd-surface` session + major version bump.
- Surface Advocate review is non-negotiable per FCD Rule 3.

## Public API

Exported from `@methodts/agent-runtime`:

- `createMethodAgent<T>(options)` — synchronous factory
- `MethodAgent<T>` — handle: `invoke / resume / abort / events / dispose`
- `MethodAgentResult<T>` — pacta `AgentResult<T>` + `resumption`, `appId`, `auditEventCount`
- `Resumption` — opaque descriptor (treat as black box)
- `CortexCtx` + facades — structural injection type
- `assertCtxCompatibility(ctx)` — opt-in R1 runtime guard
- Errors: `ConfigurationError`, `MissingCtxError`, `UnknownSessionError`, `IllegalStateError`
- Pacta re-exports: `Pact`, `AgentRequest`, `AgentEvent`, error taxonomy, etc.

The internal resumption payload shape is NOT exported — PRD-058 R4 mitigation.
