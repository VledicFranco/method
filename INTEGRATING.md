# INTEGRATING.md — Method for Cortex Tenant-App Engineers

**Audience:** you are writing a Cortex tenant app (category `agent`, Tier 2 per RFC-005 §10.2) and you want to embed a method-governed LLM agent inside it. You have never touched this repo before. You have one hour.

**Outcome after this doc:** a working `agent.invoke()` call against a `MockCortexCtx` that returns a parsed, schema-validated output and emits audit events.

**Repo:** `VledicFranco/method` (personal GitHub).
**Package versions assumed:** all `@methodts/*` at `0.2.0` (master as of 2026-04-19).

---

## 1. 30-second pitch

Method is a runtime that makes formal methodologies executable by LLM agents. For a Cortex tenant app, the parts you actually need are three packages:

| Package | Layer | What it gives you |
|---|---|---|
| `@methodts/agent-runtime` | L3 public API | `createMethodAgent({ ctx, pact, provider })` — the one call that composes the entire Cortex-safe middleware stack: token-exchange → audit → predictive budget enforcer → output validator → reasoner → provider. |
| `@methodts/pacta-provider-claude-agent-sdk` | L3 provider | A pacta agent provider that delegates the inner agent loop to `@anthropic-ai/claude-agent-sdk` (which spawns the `claude` CLI subprocess). Streaming, sub-agents, and new reasoning modes come in for free via the SDK. |
| `@methodts/pacta-provider-cortex` | L3 provider | Cortex service adapters for Pacta. The single seam between pacta and `@t1/cortex-sdk` (`ctx.llm`, `ctx.audit`, `ctx.auth`). Ships `cortexAnthropicTransport` — a localhost HTTP proxy that routes every SDK turn through `ctx.llm.reserve/.settle` (degraded until Cortex O1). |

### Why you want this

- **You don't re-derive Cortex governance.** `createMethodAgent` wires token-exchange (RFC-8693 depth-2 cap), exhaustive audit (24-variant `AgentEvent` → `ctx.audit.event`), predictive budget enforcement (observability only — `ctx.llm` is single authority on cost), and output-schema validation. One import, one call.
- **You get the Claude Agent SDK loop.** You do not write a ReAct / tool-runner yourself. The SDK owns turn pacing, system-prompt assembly, tool invocation, streaming. You own the `Pact` contract (mode, budget, scope, output schema) and the Cortex ctx.
- **Every HTTP request is budget-enforced, audited, and app-attributed.** The `cortexAnthropicTransport` intercepts every `/v1/messages` POST, reserves budget (when O1 lands), forwards to `api.anthropic.com`, computes actual cost from `response.usage`, settles, and emits one `method.transport.turn_completed` audit event per turn.
- **Provider swap is a one-line change.** Same composition, different inner loop — swap `claudeAgentSdkProvider` for `pacta-provider-anthropic` (manual loop) and the middleware stack is byte-identical.

---

## 2. Minimum install + composition example

### 2.1 Install

```bash
npm install \
  @methodts/agent-runtime@0.2.0 \
  @methodts/pacta@0.2.0 \
  @methodts/pacta-provider-claude-agent-sdk@0.2.0 \
  @methodts/pacta-provider-cortex@0.2.0 \
  @anthropic-ai/claude-agent-sdk@^0.2.114
```

Notes:

- `@methodts/pacta` is a **peer dependency** of `@methodts/agent-runtime` — a single pacta version flows through the tenant app's dep graph (prevents dual-pacta realities).
- `@anthropic-ai/claude-agent-sdk` is a peer dependency of `pacta-provider-claude-agent-sdk`. The SDK spawns the `claude` CLI subprocess at runtime — make sure it's on your app's container `PATH`.

### 2.2 The full composition (lifted from `samples/cortex-incident-triage-agent-sdk/src/agent.ts`)

There are three layers of composition here. Read them outer → inner:

```
createMethodAgent
  └─ tokenExchange  →  audit  →  budgetEnforcer(predictive)  →  outputValidator
        └─ claudeAgentSdkProvider
              └─ cortexAnthropicTransport       (HTTP proxy on 127.0.0.1)
                    └─ ctx.llm.reserve/.settle  (degraded: skip until Cortex O1)
                    └─ ctx.audit.event          (per-turn transport audit)
                    └─ upstream Anthropic API   (real fetch)
              └─ @anthropic-ai/claude-agent-sdk (spawns `claude` CLI)
```

Tenant app code — the full working example:

```ts
// src/agent.ts
import {
  createMethodAgent,
  assertCtxCompatibility,
  type AgentEvent,
  type AgentProvider,
  type CortexCtx,
  type MethodAgentResult,
} from '@methodts/agent-runtime';
import { claudeAgentSdkProvider } from '@methodts/pacta-provider-claude-agent-sdk';
import {
  cortexAnthropicTransport,
  type CortexAnthropicTransportConfig,
  type CortexAuditCtx,
  type CortexLlmCtx,
} from '@methodts/pacta-provider-cortex';

import { incidentTriagePact } from './pacts/incident-triage.js';
import type { TriageOutput } from './types.js';

// ── adaptCtx — nested CortexCtx → flat ctx the transport needs ─────
//
// `createMethodAgent` takes the **nested** CortexCtx shape:
//    { app, llm: { complete, structured? }, audit: { event }, ... }
//
// `cortexAnthropicTransport` (Wave 0 frozen surface) takes a **flat**
// `CortexLlmCtx & CortexAuditCtx` intersection:
//    { complete, structured, embed, event }
//
// Both shapes are narrow re-declarations of the same upstream Cortex
// surface. The adapter below projects nested → flat. When the C-2 ctx
// shape is harmonised with `CortexCtx` (a Wave 3 cleanup PRD), this
// helper collapses to `(ctx) => ctx.llm` — type cast gone.
type CortexTransportCtx = CortexLlmCtx & CortexAuditCtx;

function adaptCtx(ctx: CortexCtx): CortexTransportCtx {
  if (!ctx.llm) throw new Error('adaptCtx: ctx.llm is required');
  if (!ctx.audit) throw new Error('adaptCtx: ctx.audit is required');
  const flat = {
    complete: ctx.llm.complete.bind(ctx.llm),
    structured:
      ctx.llm.structured?.bind(ctx.llm) ??
      (async () => { throw new Error('ctx.llm.structured not provided'); }),
    embed:
      ctx.llm.embed?.bind(ctx.llm) ??
      (async () => { throw new Error('ctx.llm.embed not provided'); }),
    event: ctx.audit.event.bind(ctx.audit),
  };
  return flat as unknown as CortexTransportCtx;
}

// ── Composition root ──────────────────────────────────────────────

const DEFAULT_TRANSPORT_HANDLERS: CortexAnthropicTransportConfig['handlers'] = {
  onBudgetWarning: () => undefined,
  onBudgetCritical: () => undefined,
  onBudgetExceeded: () => undefined,
};

export function createIncidentTriageAgent(
  ctx: CortexCtx,
  onEvent?: (event: AgentEvent) => void,
) {
  // R1 (dual-ctx-drift) mitigation — guarded boot check.
  assertCtxCompatibility(ctx);

  const provider = claudeAgentSdkProvider({
    transport: cortexAnthropicTransport(adaptCtx(ctx), {
      handlers: DEFAULT_TRANSPORT_HANDLERS,
      appId: ctx.app.id,
    }),
  });

  return createMethodAgent({
    ctx,
    pact: incidentTriagePact,
    provider,
    onEvent,
  });
}

// ── Tenant entry point ────────────────────────────────────────────

export async function runTriageAgent(ctx: CortexCtx) {
  const agent = createIncidentTriageAgent(ctx, (event) => {
    if (event.type === 'text') ctx.notify?.slack?.(event.content);
  });

  const prompt = ctx.input?.text ?? 'triage the latest incident';
  const result: MethodAgentResult<TriageOutput> = await agent.invoke({ prompt });
  await agent.dispose();

  return {
    ok: result.completed,
    output: result.output,
    costUsd: result.cost.totalUsd,
    auditEventCount: result.auditEventCount,
    stopReason: result.stopReason,
  };
}
```

### 2.3 The Pact (contract your agent is held to)

```ts
// src/pacts/incident-triage.ts
import type { Pact } from '@methodts/agent-runtime';
import { triageSchema, type TriageOutput } from '../types.js';

export const incidentTriagePact: Pact<TriageOutput> = {
  mode: { type: 'oneshot' },                  // only 'oneshot' is advertised by the SDK provider
  budget: {
    maxTurns: 10,
    maxCostUsd: 0.1,
    onExhaustion: 'stop',
  },
  output: {
    schema: triageSchema,                     // any object with `.parse(raw) → { success, data | errors }`
    retryOnValidationFailure: true,
    maxRetries: 2,
  },
  reasoning: {
    effort: 'medium',
  },
  scope: {
    allowedTools: ['read-only/*'],
    deniedTools: ['fs/Write', 'shell/Bash'],  // refused by the SDK if unexpectedly wired up
    permissionMode: 'deny',
  },
};
```

### 2.4 The output schema

Any object with a `.parse(raw) → { success: true, data: T } | { success: false, errors: string[] }` shape works. You do **not** need Zod — pacta defines its own `SchemaDefinition` contract. Example:

```ts
// src/types.ts
export interface TriageOutput {
  readonly severity: 'critical' | 'warning' | 'info';
  readonly summary: string;
  readonly nextAction: string;
}

export const triageSchema = {
  parse(raw: unknown) {
    let value: unknown = raw;
    if (typeof raw === 'string') {
      try { value = JSON.parse(raw); }
      catch { return { success: false, errors: ['output is not valid JSON'] }; }
    }
    if (!value || typeof value !== 'object') {
      return { success: false, errors: ['output is not an object'] };
    }
    const obj = value as Record<string, unknown>;
    const errors: string[] = [];
    if (!['critical', 'warning', 'info'].includes(String(obj.severity))) {
      errors.push("severity must be 'critical' | 'warning' | 'info'");
    }
    if (typeof obj.summary !== 'string' || obj.summary.length === 0) {
      errors.push('summary must be a non-empty string');
    }
    if (typeof obj.nextAction !== 'string' || obj.nextAction.length === 0) {
      errors.push('nextAction must be a non-empty string');
    }
    return errors.length > 0
      ? { success: false, errors }
      : { success: true, data: obj as unknown as TriageOutput };
  },
};
```

### 2.5 Wiring it into a Cortex tenant app

```ts
// src/index.ts — Cortex tenant-app entry
import { runTriageAgent } from './agent.js';

export default async function app(ctx) {
  return runTriageAgent(ctx);
}
```

That's it. The tenant app's entry reduces to: get `ctx`, call `runTriageAgent`. The middleware stack composed by `createMethodAgent` handles the rest.

### 2.6 Testing against `MockCortexCtx`

The sample ships a fully-spy-backed mock `ctx` at `samples/cortex-incident-triage-agent-sdk/test/mock-ctx.ts`. For a first-hour walkthrough, copy it into your app's `test/` directory and:

```ts
import { createMockCtx } from './mock-ctx.js';
import { createIncidentTriageAgent } from '../src/agent.js';

const { ctx, spies } = createMockCtx({
  tier: 'tool',        // NOT 'service' — strict-mode refuses custom providers for service-tier
  inputText: 'DB pool 100% saturated; latency p99 12s',
});

// Stub the SDK provider so the test doesn't spawn the `claude` CLI.
const stubProvider: AgentProvider = {
  capabilities: { modes: ['oneshot'], streaming: false, resumable: false,
                  budgetEnforcement: 'client', outputValidation: 'client',
                  toolModel: 'function' },
  async invoke(pact, req) {
    return {
      completed: true,
      output: { severity: 'warning', summary: '...', nextAction: '...' },
      usage: { tokensIn: 100, tokensOut: 50 },
      cost: { totalUsd: 0.01 },
      turns: 1,
      events: [],
      stopReason: 'output_validated',
    };
  },
  async dispose() {},
};

const agent = createIncidentTriageAgent(ctx, () => {});
const result = await agent.invoke({ prompt: ctx.input.text });

console.log(result.output);          // TriageOutput
console.log(spies.auditEvent.calls); // one entry per AgentEvent
```

### 2.7 Degraded mode — what it means today

The cortex transport currently runs in **degraded mode**. The frozen `CortexLlmCtx` does not yet include `reserve()` / `settle()` (those land with Cortex ask **O1**, tracked as PRD-080). The transport detects their presence with `typeof ctx.reserve === 'function' && typeof ctx.settle === 'function'`. Until O1 lands:

- Step 1 (estimate cost), 3 (forward), 4 (compute actual), 6 (emit audit), 7 (pipe response) all execute normally.
- Step 2 (reserve) is **skipped**. There is no budget pre-flight.
- Step 5 (settle) is **skipped**. Actual cost is not reported back to Cortex through the reservation channel — it is still recorded in the per-turn audit event.
- The audit payload reports `degradedMode: true` so downstream observers can flag it.

When O1 lands and `CortexLlmCtx.reserve` / `.settle` exist on the structural type, the runtime check flips to true automatically and full mode engages **with no transport surface change** in your tenant app.

---

## 3. Pointers to the four co-design decision docs

Read these only as you need them. All four live in `co-design/` at the repo root. All four are checked into master.

| File | Purpose | When to read it |
|---|---|---|
| [`co-design/CHANGES.md`](co-design/CHANGES.md) | The meta-contract — change-control SOP for every method-owned surface. Defines the three change classes (clarification / additive / breaking), the peer-dep cascade rule (a `@methodts/pacta` major forces a `@methodts/agent-runtime` major), deprecation protocol, amendment workflow, and the `G-RATIFIED` / `G-BOUNDARY` / `G-PORT` / `G-LAYER` gates. | Before you propose any change to a ratified surface. Before you pin an `agent-runtime` version range in your tenant app's `package.json`. Whenever pacta majors. |
| [`co-design/method-agent-port.md`](co-design/method-agent-port.md) | Bilateral signoff record for **S1 — MethodAgentPort** (ratified 2026-04-18). Points at the authoritative `decision.md` at commit SHA `7402c3ae419821719b8f55aa0c2201cdb93d1938`. Names the Surface Advocates. Declares the Cortex-side commitment on `ctx.llm` / `ctx.audit` / `ctx.auth` facade shapes. | When you want the single source of truth for the `createMethodAgent` public API. When you want to know what Cortex has committed to on the `ctx.*` facade side. When a CI gate fails citing `G-RATIFIED`. |
| [`co-design/readthrough-2026-04-14.md`](co-design/readthrough-2026-04-14.md) | SC-0 readthrough record — the checklist both advocates initialled before signing S1. Covers all 10 subsections of the authoritative `decision.md` (4.1–4.7, 8, 9, 10). Contains the clarifications log (empty as of ratification — no open ambiguities). | As an onboarding cheat-sheet — every subsection of the S1 interface, one row, with the advocate who has signed off on it. Scan the table and you've seen the full S1 surface. |
| [`co-design/proposals/README.md`](co-design/proposals/README.md) | Lifecycle definition for amendment proposals. Where you file a `YYYY-MM-DD-<slug>.md` when you want to propose a clarification, additive, or breaking change to a frozen surface. Names the required sections (motivation, classification, interface diff, impact, migration sketch, debate record, status) and the count-threshold trigger (≥3 pending additive proposals → on-demand review). | The day you want to propose a change. Not before. |

> **Surface Advocates (S1 — MethodAgentPort):**
> - Method advocate: Vledic | Franco (`@VledicFranco`)
> - Cortex advocate: Francisco Aramburo (`@VledicFranco`) — signed 2026-04-18

---

## 4. The cost cliff

> This section is lifted verbatim from [`packages/pacta-provider-claude-agent-sdk/README.md`](packages/pacta-provider-claude-agent-sdk/README.md#the-cost-cliff). Reproduced here because it's load-bearing for tenant-app budget planning.

The Claude Agent SDK ships generous defaults that work great for interactive Claude Code usage but balloon every request body for programmatic agents. **Spike 2** measured a 199 KB → 8 KB reduction when all suppression knobs are applied (96% reduction). This provider applies those defaults automatically.

| Knob | Default here | If you opt in to broader behavior | Per-request cost added |
|---|---|---|---|
| `tools: []` | locked | `pact.scope.allowedTools = ['Read', 'Bash', ...]` | ~80 KB for the full Claude Code tool set |
| `settingSources: []` | locked | not exposed (override the provider's options manually) | ~76 KB for `~/.claude/settings.json` + project settings |
| `agents: {}` | locked | not exposed in v1 | varies by sub-agent definition |
| sanitized `env` | locked (PATH/HOME/TEMP/etc only) | not exposed | ~33 KB for cached MCP auth tokens |

If you find yourself needing the broader behavior (e.g. loading `CLAUDE.md` via `settingSources: ['project']`), measure the per-request body size and the budget impact before shipping. Forgetting any one knob can take a per-request floor from ~8 KB to 165 KB+.

The architecture test (`architecture.test.ts` → `G-COST`) locks in the three structural defaults; if a future PR removes one, the test fails.

### What this means for your tenant app

- **Do NOT** try to sneak wider tool access through a custom `pact.scope.allowedTools` without running the numbers. The scope is your governance knob, not your performance knob.
- **Do NOT** manually override the provider's `settingSources` to load `CLAUDE.md` or project-level settings. The per-request delta (~76 KB) is multiplied by `pact.budget.maxTurns` on every invocation. A 10-turn pact with wide settings adds ~760 KB of serialization cost before the model sees the first token.
- **DO** run your tenant app in production with the transport audit events enabled. Each `method.transport.turn_completed` event has `maxTokens` and `usage` fields — watch for a widening gap between estimate and actual. That is the empirical signal that the cost cliff is biting.
- **DO** revisit this section whenever you're about to add a sub-agent definition, a new `settingSources` entry, or a custom MCP server. Assume the default is right; justify the deviation in a co-design proposal.

---

## 5. Pending Cortex asks — O1 / O5 / O6 / O7 status

Four `ctx.*` service extensions Cortex owes method. Each unblocks a specific method PRD. Source: [`../ov-t1/projects/t1-cortex/method-integration.md`](../ov-t1/projects/t1-cortex/method-integration.md) §3.3 and §4 (draft issue texts).

| Ask | Short description | Current method-side status | Blocker on Cortex side |
|---|---|---|---|
| **O1** | `ctx.llm.reserve(maxCostUsd, ttlMs?)` → `ReservationHandle`; `ctx.llm.settle(handle, actualCostUsd)` — atomic hold-and-release for multi-turn budget reservations. | **Partially shipped — degraded-mode fallback is live.** `cortexAnthropicTransport` already detects `reserve` / `settle` at runtime (`typeof ctx.reserve === 'function' && typeof ctx.settle === 'function'`) and falls back to per-turn audit-only when absent. `degradedMode: true` is surfaced in every `method.transport.turn_completed` audit event. When O1 lands, full mode engages automatically with zero tenant-app code change. Blocks method PRD-062 Wave 2 (`batched-held` strategy); Wave 1 (`fresh-per-continuation`) ships without this. | Cortex-side issue on `PlataformaT1/t1-cortex` — PRD-068 extension + RFC-005 §12.3 co-design. Draft text in `method-integration.md` §4.1. |
| **O5** | Runtime per-methodology tool registration endpoint. Manifest gets `spec.methodology.{pool, toolRegistration: 'static' \| 'dynamic'}`; new `POST /v1/platform/apps/:appId/tools` with auto-generated authz template; `methodology.toolRegistered` event on `ctx.events`. | **Not implemented on method side — design complete.** Blocks method PRD-066 Track B (the Cortex adapters for `@methodts/mcp`). Track A (deploy-time static manifest) ships regardless of O5. The S9 `MCPCortexTransport` surface is currently `status: needs-follow-up` in `co-design/method-agent-port.md` §6 pending this answer. | Cortex-side issue on `PlataformaT1/t1-cortex` — PRD-043 extension. Draft text in `method-integration.md` §4.2. Authz auto-approval semantics are the contentious piece; everything else is straightforward API surface. |
| **O6** | `ctx.auth.issueServiceToken(scope: ServiceTokenScope)` → `ScopedToken` — service-account JWT for platform-capability actions (e.g., method calling Cortex tool-registry API). Narrow scopes like `'tool:register'` / `'methodology:install'`. Requires manifest-declared pre-authorization (`spec.authz.serviceScopes`). Short TTL (≤ 5 min default). Audits `auth.service_token_issued`. | **Not implemented on method side — design complete.** Blocks method PRD-066 Track B (which needs this to call the tool-registry API from O5). Would land as an additive amendment on S1: `CortexAuthFacade.issueServiceToken?` — optional field, back-compat. No breaking change. | Cortex-side issue on `PlataformaT1/t1-cortex` — PRD-061 extension + RFC-005 §4.1 pipeline extension (new service-account issuance stage). Draft text in `method-integration.md` §4.3. |
| **O7** | `DELETE /v1/platform/apps/:appId/tools/:toolName` — tool deregistration verb on the platform tool registry. Idempotent (404 on second call OK). Requires `'tool:register'` service scope (pairs with O6). Refuses to delete tools declared via static `spec.tools[]`. Cascades 409 Conflict if the tool is referenced by another methodology. Emits `platform.app.toolRemoved` on `ctx.events`. | **Not implemented on method side — design complete.** Blocks method PRD-066 Track B (tool deregistration when a methodology is removed via the CortexMethodologySource hot-swap flow). Paired with O5 — if O5 ships, O7 is the cleanup half. | Cortex-side issue on `PlataformaT1/t1-cortex` — PRD-043 extension. Draft text in `method-integration.md` §4.4. |

### Timeline expectation (from `method-integration.md` §5)

| Item | Needed by | Reason |
|---|---|---|
| PRD-060 signature + 3 adapter reviews | 2026-04-21 | April 21 demos leverage method-backed agents running under real Cortex governance. |
| O1 (reserve/settle) | 2026-05-26 | Start of method PRD-062 Wave 2. |
| O5 / O6 / O7 | 2026-06-16 | Start of method PRD-066 Track B. |

If O1/O5/O6/O7 slip, method ships the partial paths (PRD-062 `fresh-per-continuation` only; PRD-066 Track A only) and reopens when Cortex catches up. **None of these slip-paths breaks the April 21 demos.**

---

## 6. Appendix — the full `AgentEvent` → audit event map

Every `AgentEvent` variant emitted by pacta's composition engine is mapped to a single `ctx.audit.event()` call with a stable `eventType` namespace. This is the exhaustive 24-variant `AUDIT_EVENT_MAP` that PRD-065 guarantees:

| `AgentEvent.type` | Audit `eventType` | Emitted by |
|---|---|---|
| `started` | `method.agent.started` | pacta composition engine |
| `text` | `method.agent.text` (suppressed by default; opt-in per §policy) | SDK assistant output |
| `thinking` | `method.agent.thinking` (suppressed by default) | SDK assistant thinking channel |
| `tool_use` | `method.agent.tool_use` | SDK assistant tool invocation |
| `tool_result` | `method.agent.tool_result` | SDK tool runner |
| `completed` | `method.agent.completed` | pacta composition engine |
| `error` | `method.agent.error` | pacta composition engine |
| `turn_complete` | `method.agent.turn_complete` | pacta reasoning middleware |
| ... (see `cortexAuditMiddleware` source for the full 24) | | |

Separate from the agent-level events, the cortex transport emits one **transport-level** event per HTTP turn with `eventType: 'method.transport.turn_completed'` — distinct namespace (`method.transport.*`), does not collide with the agent-level map. Payload (per `packages/pacta-provider-cortex/README.md` §Audit event schema):

| Field | Type | Notes |
|---|---|---|
| `transport` | `'cortex-anthropic-sdk'` | Constant, identifies this transport. |
| `model` | `string` | Model from the response (or request, on failure). |
| `maxTokens` | `number` | Request's `max_tokens`. |
| `usage.{input,output,cacheRead,cacheWrite}Tokens` | `number` | From upstream `response.usage`. |
| `costUsd` | `number` | Actual cost computed from usage. |
| `maxCostUsd` | `number` | Pre-flight estimate fed to `reserve()`. |
| `status` | `number` | Upstream HTTP status (or proxy's synthesized on error). |
| `degradedMode` | `boolean` | `true` if `ctx.llm.reserve` / `.settle` were not present. |

---

## 7. Appendix — error taxonomy

All errors re-exported from `@methodts/agent-runtime` (source: `co-design/method-agent-port.md` §4.6):

| Error | When | Retry? |
|---|---|---|
| `ConfigurationError` | Compose-time — `pact` or `ctx` shape rejected by `createMethodAgent` (e.g. service-tier app passes a custom provider in strict mode). | No — fix the composition. |
| `MissingCtxError` | Compose-time — a required `ctx.*` facade is missing (`ctx.llm`, `ctx.audit`, `ctx.auth`). Thrown by `assertCtxCompatibility(ctx)` boot check. | No — fix the Cortex tenant-app manifest. |
| `UnknownSessionError` | `agent.resume(resumption)` — opaque resumption descriptor does not match any known session. | No — treat as "start fresh". |
| `IllegalStateError` | Calling `invoke` / `resume` / `abort` / `dispose` in an invalid lifecycle order. | No — audit the handle lifecycle. |
| pacta re-exports: `CapabilityError`, `BudgetExceededError`, `OutputValidationError`, etc. | Runtime — `invoke()` result failure modes. Retry ownership inherited from pacta. | Depends — see the pacta `AgentRequest.retryPolicy`. |

### Transport-specific budget errors

From `cortexAnthropicTransport`:

- **`BudgetExceeded`** (reserve throws with name `BudgetExceeded` / `BudgetExceededError`, or message matching `/budget.*(exceed|exhausted)/i`) → proxy returns 429 with Anthropic-shaped `rate_limit_error` body; `onBudgetExceeded` handler fires; audit event still emitted with `status: 429`.
- **Upstream network failure** → 502 with Anthropic-shaped error; reservation (if any) settled at `0` to avoid double-billing; audit emitted with `status: 502`.
- **Upstream non-2xx** (401, 429, 5xx) → status preserved, body forwarded; reservation settled at `0`.
- **Bad request body** (non-JSON) → 400 with `invalid_request_error`.
- **Unhandled handler crash** → 500 with `api_error`. The proxy server itself **never** crashes — handler errors are caught and synthesized into a response.

---

## 8. One-hour acceptance criterion

If you've read this far, you should now be able to:

1. `npm install` the four packages (§2.1).
2. Copy `samples/cortex-incident-triage-agent-sdk/src/agent.ts`, `src/types.ts`, and `src/pacts/incident-triage.ts` into your tenant app.
3. Copy `samples/cortex-incident-triage-agent-sdk/test/mock-ctx.ts` into your `test/` directory.
4. Write a test that:
   - Constructs `createMockCtx({ tier: 'tool' })`.
   - Passes a stub `AgentProvider` via the `providerOverride` option.
   - Calls `agent.invoke({ prompt: '...' })`.
   - Asserts `result.output` is a parsed `TriageOutput`.
   - Asserts `result.auditEventCount > 0`.
5. Run it. It passes.

You have not spawned the `claude` CLI. You have not opened a network connection. You have not needed an `ANTHROPIC_API_KEY`. You have, however, exercised the entire composition stack (token-exchange → audit → budget enforcer → output validator → provider) against a real Cortex `ctx` shape. That is the floor.

From there:

- **Go live:** drop the stub provider. Set `ANTHROPIC_API_KEY` in your app's environment. The SDK will spawn `claude`; the transport will boot the proxy; every request will flow through `cortexAnthropicTransport` → Anthropic. Audit events land in your dev audit stream.
- **Tune the pact:** widen `scope.allowedTools` only after reading §4 (the cost cliff).
- **Wire budget handlers:** replace the `DEFAULT_TRANSPORT_HANDLERS` no-ops with `ctx.log.warn` / `ctx.log.error` calls (or your alerting stack).
- **When O1 lands:** you do nothing. The transport flips to full mode automatically.

---

## 9. Where to go next

| Question | File |
|---|---|
| What's the full S1 interface? | `.method/sessions/fcd-surface-method-agent-port/decision.md` §4 |
| How do I propose a change? | `co-design/CHANGES.md` §Amendment proposal workflow |
| What are the other 8 surfaces? | `co-design/method-agent-port.md` §6 |
| What's on the Cortex consumption roadmap? | `docs/roadmap-cortex-consumption.md` |
| What's the sibling manual-loop sample look like? | `samples/cortex-incident-triage-agent/` |
| What are the streaming semantics? | `packages/pacta-provider-claude-agent-sdk/README.md` §Streaming |
| How does the HTTP proxy actually work? | `packages/pacta-provider-cortex/README.md` §Per-call lifecycle |

---

**License.** Apache-2.0 for every `@methodts/*` package referenced in this document.
