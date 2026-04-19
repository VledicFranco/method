# @methodts/pacta-provider-cortex

Cortex service adapters for Pacta. The single seam between
`@methodts/pacta` and `@t1/cortex-sdk` (`ctx.llm`, `ctx.audit`,
`ctx.auth`).

License: Apache-2.0.

## Exports

- `cortexLLMProvider` — `AgentProvider` over `ctx.llm` (PRD-068).
- `cortexAuditMiddleware` — pacta `AgentEvent` → `ctx.audit.event`
  (PRD-065).
- `cortexTokenExchangeMiddleware` — RFC-8693 exchange + depth cap
  (PRD-061 / RFC-005 §4.1.5).
- `cortexAnthropicTransport` — Cortex-aware
  `AnthropicSdkTransport` (S-CORTEX-ANTHROPIC-TRANSPORT, paired with
  `@methodts/pacta-provider-claude-agent-sdk`).

The architecture gate `G-CORTEX-ONLY-PATH` (see
`src/architecture.test.ts`) forbids any runtime import of
`@t1/cortex-sdk` outside `ctx-types.ts`. That file is the only allow-list
entry — every other source file imports the structural shapes from
there.

## `cortexAnthropicTransport`

Pairs with `@methodts/pacta-provider-claude-agent-sdk`. The SDK spawns
the `claude` CLI as a subprocess and the CLI honors `ANTHROPIC_BASE_URL`
in its environment (see
`.method/sessions/fcd-design-pacta-provider-claude-agent-sdk/spike-findings.md`).
This transport runs a **localhost HTTP proxy** on a random port per SDK
invocation and injects `ANTHROPIC_BASE_URL` so every `/v1/messages`
request flows through it.

```ts
import { createMethodAgent } from '@methodts/agent-runtime';
import { claudeAgentSdkProvider } from '@methodts/pacta-provider-claude-agent-sdk';
import { cortexAnthropicTransport } from '@methodts/pacta-provider-cortex';

// Inside a Cortex tenant app handler
const provider = claudeAgentSdkProvider({
  transport: cortexAnthropicTransport(ctx, {
    handlers: {
      onBudgetWarning: (e) => ctx.log.warn('budget warning', e),
      onBudgetCritical: (e) => ctx.log.warn('budget critical', e),
      onBudgetExceeded: (e) => ctx.log.error('budget exceeded', e),
    },
    apiKey: { source: 'env', name: 'ANTHROPIC_API_KEY' },
    appId: ctx.app.id,
  }),
});
const agent = createMethodAgent({ ctx, pact, provider });
const result = await agent.invoke({ prompt: ctx.input.text });
```

### Per-call lifecycle

`setup()` is invoked by the SDK provider before each agent loop:

1. Resolves the Anthropic API key from `config.apiKey` (defaults to
   `process.env.ANTHROPIC_API_KEY`).
2. Spawns a `node:http` server listening on `127.0.0.1` at a random
   ephemeral port.
3. Returns
   `{ env: { ANTHROPIC_BASE_URL, ANTHROPIC_API_KEY }, teardown }`.

The provider merges the env into `Options.env` for the spawned CLI and
calls `teardown()` in a `finally` block — even on SDK errors. Multiple
concurrent `setup()` calls produce independent servers, so the same
transport value is safe to share across parallel agent invocations.

The proxy handles three URL patterns:

| Method | URL | Behavior |
|---|---|---|
| `HEAD` | `/` | 200 — handles the SDK's connectivity probe (spike surprise #1) |
| `POST` | `/v1/messages?beta=true` (and the non-beta variant as a safety net) | The full reserve → forward → settle → audit pipeline below |
| anything else | — | 404 with an Anthropic-shaped error body |

For each `/v1/messages` POST:

1. **Estimate cost** via `config.estimateCost(req)` (default: a
   conservative upper bound assuming the entire `max_tokens` budget is
   spent on output and the prompt is ~equal to `max_tokens`; uses Opus
   rates for unknown models).
2. **Reserve budget** via `ctx.llm.reserve({ maxCostUsd })` — see the
   degraded-mode note below.
3. **Forward** to `https://api.anthropic.com/v1/messages?beta=true`
   using `globalThis.fetch`, with `x-api-key` and
   `anthropic-version: 2023-06-01` headers.
4. **Compute actual cost** from the response `usage` block using a
   hardcoded Anthropic pricing table (Sonnet 4.6: $3/$15 per Mtok input/output).
5. **Settle** via `ctx.llm.settle(handle, actualCostUsd)`.
6. **Emit audit** via `ctx.audit.event({ eventType: 'method.transport.turn_completed', ... })`
   with the full usage payload.
7. **Pipe** the response back to the SDK with status + headers preserved.

### Degraded mode (Cortex O1 fallback — current default)

The frozen `CortexLlmCtx` re-declared in `src/ctx-types.ts` does not
yet include `reserve()` / `settle()` — those land with Cortex ask
**O1** (PRD-080). The transport detects their presence with a runtime
check (`typeof ctx.reserve === 'function' && typeof ctx.settle === 'function'`).
Until O1 lands, the transport runs in **degraded mode**:

- Steps 1, 3, 4, 6, and 7 above all execute normally.
- Step 2 (reserve) is **skipped** — there is no budget pre-flight.
- Step 5 (settle) is **skipped** — actual cost is not reported back to
  Cortex through the reservation channel; it is still recorded in the
  per-turn audit event.
- The audit payload reports `degradedMode: true` so downstream
  observers can flag it.

When O1 lands and `CortexLlmCtx.reserve` / `.settle` exist on the
structural type, the runtime check flips to true automatically and full
mode engages with no transport surface change.

### Wave 0 surface note

Wave 0 froze the function signature as
`cortexAnthropicTransport(ctx: CortexLlmCtx & CortexAuditCtx, config)` —
a *flat* intersection rather than the nested
`{ llm: CortexLlmCtx; audit: CortexAuditCtx }` shape used by the
broader Cortex `ctx` object. Callers wiring the transport from a
nested `CortexCtx` should pass an adapter:

```ts
const flatCtx = {
  ...ctx.llm,
  event: ctx.audit.event.bind(ctx.audit),
};
const transport = cortexAnthropicTransport(flatCtx, config);
```

This is a Wave 0 stub artifact — the signature is frozen for C-2 and
will be revisited if a follow-up wave normalizes it against
`CortexCtx`.

### Audit event schema

The transport emits a single audit event per turn with `eventType:
'method.transport.turn_completed'`. Payload fields:

| Field | Type | Notes |
|---|---|---|
| `transport` | `'cortex-anthropic-sdk'` | Constant, identifies this transport |
| `model` | `string` | The model from the response (or request, on failure) |
| `maxTokens` | `number` | The request's `max_tokens` |
| `usage.{input,output,cacheRead,cacheWrite}Tokens` | `number` | From upstream `response.usage` |
| `costUsd` | `number` | Actual cost computed from usage |
| `maxCostUsd` | `number` | Pre-flight estimate fed to `reserve()` |
| `status` | `number` | Upstream HTTP status (or proxy's synthesized status on error) |
| `degradedMode` | `boolean` | `true` if `ctx.llm.reserve` / `.settle` were not present |

The transport-level event lives below pacta's `AUDIT_EVENT_MAP` (which
maps pacta `AgentEvent` variants). It uses a distinct namespace
(`method.transport.*`) so it doesn't collide with the pacta-level
`method.agent.turn_complete`.

### Error handling

- **Budget exceeded** (reserve throws with `BudgetExceeded` /
  `BudgetExceededError` name, or message matching `/budget.*(exceed|exhausted)/i`) →
  429 with body `{ type: 'error', error: { type: 'rate_limit_error',
  message: 'Budget exceeded' } }`. The `onBudgetExceeded` handler is
  fired. Audit event is still emitted with `status: 429`.
- **Upstream network failure** → 502 with an Anthropic-shaped error
  body. Reservation (if any) is settled at `0` so the app isn't
  double-billed. Audit emitted with `status: 502`.
- **Upstream non-2xx** (401, 429, 5xx) → status preserved, body
  forwarded. Reservation is settled at `0` (no usage to bill).
- **Bad request body** (non-JSON) → 400 with `invalid_request_error`.
- **Unhandled handler crash** → 500 with `api_error`. The proxy
  server itself never crashes — handler errors are caught and converted
  to a synthesized response.
