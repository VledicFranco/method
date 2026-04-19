---
type: prd
title: "PRD-059 — Cortex Service Adapters (`@methodts/pacta-provider-cortex`)"
date: "2026-04-14"
status: draft
version: "0.1"
author: Lysica (fcd-design session)
size: M
domains:
  - "@methodts/pacta-provider-cortex (new, L3)"
  - "@methodts/pacta (extend — budget-enforcer mode option, L2)"
  - "@methodts/agent-runtime (consumer, L3 — PRD-058)"
surfaces_implemented:
  - "S3 — CortexServiceAdapters (frozen 2026-04-14) — `.method/sessions/fcd-surface-cortex-service-adapters/decision.md`"
surfaces_consumed:
  - "S1 — MethodAgentPort (frozen 2026-04-14) — `.method/sessions/fcd-surface-method-agent-port/decision.md`"
related:
  - docs/roadmap-cortex-consumption.md §4.1 items A3, A4, A5 / §7 Phase 2
  - t1-repos/t1-cortex-1/docs/prds/068-llm-service.md
  - t1-repos/t1-cortex-1/docs/prds/065-audit-service.md
  - t1-repos/t1-cortex-1/docs/prds/061-auth-as-a-service.md
  - t1-repos/t1-cortex-1/docs/rfcs/RFC-005-app-platform-service-library.md §4.1, §4.1.5
  - packages/pacta/src/middleware/budget-enforcer.ts
  - packages/pacta/src/ports/agent-provider.ts
unblocks:
  - "PRD-058 (createMethodAgent can wire a concrete default provider)"
  - "Roadmap gate A8 (Cortex dev-stack smoke)"
  - "Samples: cortex-incident-triage-agent"
---

# PRD-059 — Cortex Service Adapters

> **Design-only PRD.** Implements the frozen S3 surface
> (`fcd-surface-cortex-service-adapters`) as a new package
> `@methodts/pacta-provider-cortex`, plus a backward-compatible minor extension
> on `@methodts/pacta`'s `budgetEnforcer`. No code is written by this session.

---

## 1. Summary

Ship three concrete Cortex adapters — `CortexLLMProvider`,
`CortexAuditMiddleware`, `CortexTokenExchangeMiddleware` — as the first
(and only April-21-critical) package that connects `@methodts/pacta` to
Cortex `ctx.*` services. Adapters conform to the `CortexServiceAdapter<>`
pattern frozen by S3. Package name: `@methodts/pacta-provider-cortex`
(preserves the `pacta-provider-*` family convention — S1+S3 decision).
A minor, additive extension to pacta's `budgetEnforcer` adds a
`mode: 'authoritative' | 'predictive'` option so `ctx.llm` can remain the
single budget authority without a double-count race.

---

## 2. Problem

1. **No Cortex-aware adapters today.** `@methodts/pacta-provider-anthropic`
   and `@methodts/pacta-provider-claude-cli` hold their own API keys, have no
   concept of `ctx.llm` tiers, do not exchange user-scoped tokens, and do
   not emit to `ctx.audit`. A Cortex tenant app of category `agent`
   (RFC-005 §10.2) cannot run any pacta pact in production without violating
   RFC-005 §4.1 (mandatory `ctx.llm`), §4.1.5 (RFC 8693 token exchange),
   and §4.14 (automatic + explicit audit).
2. **Double budget count is architecturally possible.** Pacta's
   `budgetEnforcer` deducts from a local `BudgetState` after each turn.
   Cortex PRD-068 atomically `checkAndReserve`s before the provider call
   and reconciles after. With both authoritative, an agent appears to burn
   budget twice and emit duplicate warnings. S3 §4 resolves this; this PRD
   ships the implementation (a pacta mode flag).
3. **Token delegation depth (≤2) has no client-side enforcement.** RFC-005
   §4.1.5 caps `act_as` chain length at 2 in Wave 0 and PRD-061 rejects
   `depth ≥ 2` server-side. Without client-side fail-fast, a sub-agent can
   be spawned only to be rejected on its first exchange — wasting budget,
   a turn, and user time.

The April 21 incident-triage demo cannot ship without (1). The Twins
flagship Wave 1 cannot ship without (2) and (3).

---

## 3. Constraints

### C-01 — Budget single authority = `ctx.llm` (S3 §4)

Cortex is the atomic authority on `cost` and `tokens`. Pacta's enforcer,
when composed against a provider whose
`capabilities().budgetEnforcement === 'native'`, runs in **predictive-only**
mode: emits `budget_warning` / `budget_exhausted` events for observability
but never rejects on cost/tokens. Turns and duration remain authoritative
in pacta (Cortex doesn't track them). Gate `G-BUDGET-SINGLE-AUTHORITY`.

### C-02 — Token-exchange depth cap ≤ 2 (RFC-005 §4.1.5)

Client-side enforcement lives in
`CortexTokenExchangeMiddleware.exchangeForSubAgent`. Fail-fast before
calling `ctx.auth.exchange`. Server-side also enforces — double defense
by design. Gate `G-TOKEN-DEPTH-CAP`.

### C-03 — Audit superset gate (S3 §3.1, PRD-065)

Every pacta `AgentEvent.type` has exactly one mapping entry to
`method.agent.<variant>` / `method.cognitive.<variant>`. New event
variants added to pacta require an entry here or compose warns. Gate
`G-AUDIT-EXHAUSTIVE`.

### C-04 — Adapter shape (S3 §1)

Every future Cortex adapter (this PRD's three + S4/S5/S6) exports a single
factory returning a `CortexServiceAdapter<TCtxSlice, TPact, TConfig>`.
`compose()` is the only throw site; runtime errors become typed values.
Gate `G-ADAPTER-SHAPE`.

### C-05 — No Cortex import at module top level

`@methodts/pacta-provider-cortex` only imports from `@t1/cortex-sdk` as
`import type` (erased). A narrow re-declaration lives at
`packages/pacta-provider-cortex/src/ctx-types.ts` — the sole seam.
Gate `G-CORTEX-ONLY-PATH` (already defined by S3 §7).

### C-06 — Package family discipline

Name: `@methodts/pacta-provider-cortex`. L3 layer. Depends on `@methodts/pacta`
as peer (single version), `@t1/cortex-sdk` as type-only dev dep. No
`@methodts/bridge` or `@methodts/agent-runtime` imports (wrong direction).

### C-07 — Handler presence is mandatory at compose (PRD-068 §5.4)

`CortexLLMProvider.compose` throws `CortexAdapterComposeError` with
`reason: 'missing_mandatory_handler'` if any of
`onBudgetWarning / onBudgetCritical / onBudgetExceeded` is absent.
Gate `G-LLM-HANDLERS-PRESENT`.

### C-08 — Non-Goals (size-M discipline)

- **Not shipping:** `CortexSessionStore` (PRD-061 covers S4),
  `JobBackedExecutor` (PRD-062/S5), `CortexEventConnector` (PRD-063/S6),
  streaming LLM (PRD-068 Wave 7), any new audit variants beyond S3 §3.1
  table.
- **Not redesigning pacta.** The pacta extension is one option field on
  one existing factory, backwards-compatible default.
- **Not writing the `createMethodAgent` factory.** That is PRD-058. This
  PRD provides the three adapter factories it wires.

---

## 4. Success Criteria

| # | Criterion | How verified |
|---|-----------|--------------|
| SC-01 | `cortexLLMProvider({handlers, ...}).compose({ctx: {llm}, pact})` returns `ComposedCortexLLMProvider` when all three handlers are present; throws `CortexAdapterComposeError { reason: 'missing_mandatory_handler' }` when any is absent. | Unit + gate `G-LLM-HANDLERS-PRESENT` |
| SC-02 | A pact declaring `requires.llm` composed without a budget-handler-bearing `CortexLLMProvider` fails at `createMethodAgent` compose with `CortexAdapterComposeError`. (Gate lives in PRD-058; this PRD provides the mechanism.) | Integration test against PRD-058 stub |
| SC-03 | `CortexLLMProvider.invoke` routes `pact.reasoning.effort='low'` → `ctx.llm.complete({tier:'fast',...})`, `medium → balanced`, `high → powerful`, `undefined → balanced`, `pact.output?.schema` present → `ctx.llm.structured`. | Unit + tier mapping table |
| SC-04 | `cortexAuditMiddleware(...).compose(...)` emits one `ctx.audit.event(...)` per `AgentEvent` per S3 §3.1 mapping. Exhaustiveness test fails if a new pacta event variant has no mapping. | Unit + gate `G-AUDIT-EXHAUSTIVE` |
| SC-05 | `cortexTokenExchangeMiddleware.exchangeForSubAgent` with `parentToken` whose `act_as` chain length ≥ 2 throws `CortexDelegationDepthExceededError` WITHOUT calling `ctx.auth.exchange`. | Unit + gate `G-TOKEN-DEPTH-CAP` |
| SC-06 | Pacta `budgetEnforcer({ mode: 'predictive' })` emits `budget_warning` / `budget_exhausted` events but never sets `stopReason: 'budget_exhausted'` for cost/tokens. Turns + duration still enforce (unchanged behavior). | Unit + regression on existing enforcer tests |
| SC-07 | Pacta `budgetEnforcer({})` (default) is byte-equivalent to pre-PR behavior. Minor bump, no breaking change. | Regression suite |
| SC-08 | Every file under `packages/pacta-provider-cortex/src/` imports from `@t1/cortex-sdk` only via `import type` (or from `ctx-types.ts`). | Gate `G-CORTEX-ONLY-PATH` |
| SC-09 | Compose-time validation rejects a pact declaring `requires.llm` when the wiring omits budget handlers — at composition time, not first invocation. | Integration test |
| SC-10 | `ComposedCortexLLMProvider.capabilities()` returns `budgetEnforcement: 'native'`, which drives `createMethodAgent` (PRD-058) to construct pacta's enforcer in `predictive` mode. | Unit + integration |

---

## 5. Scope

### 5.1 In scope

1. **New package `@methodts/pacta-provider-cortex` (L3).**
   - `src/adapter.ts` — `CortexServiceAdapter<>`, `ComposedAdapter<>`, `CortexAdapterComposeError` (verbatim from S3 §1).
   - `src/ctx-types.ts` — structural re-declaration of the Cortex SDK types consumed (`CortexLlmCtx`, `CortexAuditCtx`, `CortexAuthCtx`, `CompletionRequest`, `CompletionResult`, `StructuredResult`, `EmbeddingResult`, `BudgetStatus`, `LlmTier`, `ScopedToken`, `LlmBudgetHandlers`). ONE seam file.
   - `src/llm-provider.ts` — `cortexLLMProvider(config)` factory + `ComposedCortexLLMProvider`.
   - `src/audit-middleware.ts` — `cortexAuditMiddleware(config)` factory + `AUDIT_EVENT_MAP` + `ComposedCortexAuditMiddleware`.
   - `src/token-exchange-middleware.ts` — `cortexTokenExchangeMiddleware(config)` factory + `exchangeForSubAgent` + depth cap + error types.
   - `src/index.ts` — single public entrypoint: the three factories, the error types, `MAX_DELEGATION_DEPTH`.
   - `src/architecture.test.ts` — five gate assertions from S3 §7.
   - `tests/` — unit tests per §5.2 test strategy (one file per adapter).

2. **Minor extension on `@methodts/pacta`.**
   - `packages/pacta/src/middleware/budget-enforcer.ts` — add `BudgetEnforcerOptions { mode?: 'authoritative' | 'predictive' }` (default `'authoritative'`, preserves current behavior). Signature change: `budgetEnforcer<T>(inner, pact, onEvent?, options?)`. Cost + tokens suppression gated by `options.mode === 'predictive'`. Turns + duration unchanged.
   - `packages/pacta/src/middleware/budget-enforcer.test.ts` — new case `predictive mode emits but does not stop`.
   - CHANGELOG + minor version bump on `@methodts/pacta`.

### 5.2 Out of scope

- `createMethodAgent` factory + `requires.llm` gate plumbing (PRD-058).
- Pacta's `subagentDelegator` wiring to `exchangeForSubAgent` (PRD-058).
- `ctx.llm.reserve()` / `settle()` API (Cortex open question O1 — blocks `batched-held` budget carry-over in S5, not this PRD).
- Streaming (`ctx.llm` is request/response in v1; `capabilities().streaming = false`).
- Deprecating `@methodts/pacta-provider-anthropic` (kept as a non-production/test provider).
- `thinkingBudgetTokens` + `temperature` pass-through (Cortex open question O3; dropped silently until `CompletionRequest.extra` lands).

---

## 6. Architecture

### 6.1 Package layout

```
packages/pacta-provider-cortex/
  package.json                  { name: "@methodts/pacta-provider-cortex", peerDeps: { "@methodts/pacta": "^<current>" } }
  tsconfig.json
  src/
    index.ts                    re-exports: cortexLLMProvider, cortexAuditMiddleware,
                                  cortexTokenExchangeMiddleware, MAX_DELEGATION_DEPTH,
                                  CortexAdapterComposeError, CortexDelegationDepthExceededError,
                                  CortexSubjectUnauthorizedError, CortexScopeEscalationError,
                                  all config + composed-form types
    adapter.ts                  CortexServiceAdapter<>, ComposedAdapter<>, CortexAdapterComposeError
    ctx-types.ts                narrow re-declaration of @t1/cortex-sdk — ONLY seam file
    llm-provider.ts             cortexLLMProvider(config) + ComposedCortexLLMProvider
    audit-middleware.ts         cortexAuditMiddleware(config) + AUDIT_EVENT_MAP + Composed…
    token-exchange-middleware.ts cortexTokenExchangeMiddleware(config) + exchangeForSubAgent
    architecture.test.ts        gate assertions
  tests/
    llm-provider.test.ts
    audit-middleware.test.ts
    token-exchange-middleware.test.ts
    adapter.test.ts
```

### 6.2 Shared `CortexServiceAdapter<>` shape (S3 §1, verbatim)

```typescript
export type CtxSlice = Partial<{
  llm:     CortexLlmCtx;
  audit:   CortexAuditCtx;
  auth:    CortexAuthCtx;
  storage: CortexStorageCtx;
  jobs:    CortexJobsCtx;
  events:  CortexEventsCtx;
}>;

export interface CortexServiceAdapter<
  TCtxSlice extends Partial<CtxSlice>,
  TPact,
  TConfig = unknown,
> {
  readonly name: string;
  compose(args: { ctx: TCtxSlice; pact: TPact; config?: TConfig }): ComposedAdapter<TPact>;
}

export interface ComposedAdapter<TPact> {
  readonly name: string;
  readonly requires: ReadonlyArray<keyof CtxSlice>;
  readonly pact: TPact;
  dispose?(): Promise<void>;
}
```

`compose()` is the only throw site; invocation-time failures become typed
results (providers → `AgentResult.stopReason = 'error' | 'budget_exhausted'`;
middleware → fire-and-forget with errors collected into
`AgentResult.errors[]`).

### 6.3 The three adapter signatures

```typescript
// llm-provider.ts
export function cortexLLMProvider(
  config: CortexLLMProviderConfig,
): CortexServiceAdapter<
  { llm: CortexLlmCtx },
  Pact<unknown>,
  CortexLLMProviderConfig
>;

// audit-middleware.ts
export function cortexAuditMiddleware(
  config: CortexAuditMiddlewareConfig,
): CortexServiceAdapter<
  { audit: CortexAuditCtx },
  Pact<unknown>,
  CortexAuditMiddlewareConfig
>;

// token-exchange-middleware.ts
export function cortexTokenExchangeMiddleware(
  config: CortexTokenExchangeConfig,
): CortexServiceAdapter<
  { auth: CortexAuthCtx },
  Pact<unknown>,
  CortexTokenExchangeConfig
>;
```

Each composed form extends `ComposedAdapter<Pact<unknown>>` and a
pacta-shaped capability:
- `ComposedCortexLLMProvider` ⊂ `AgentProvider & Streamable`
  (`streaming: false` at v1 — `Streamable.stream` throws).
- `ComposedCortexAuditMiddleware` exposes `wrap(inner)` and `emit(event,
  request)` (the pacta-middleware shape, matching `budgetEnforcer`'s
  higher-order function convention).
- `ComposedCortexTokenExchangeMiddleware` exposes `wrap(inner)` +
  `exchangeForSubAgent(parentToken, childAppId, childScope)`.

### 6.4 Pacta minor extension shape

```typescript
// packages/pacta/src/middleware/budget-enforcer.ts
export interface BudgetEnforcerOptions {
  /**
   * 'authoritative' (default) — enforcer rejects calls on cost/token/turn/duration exhaustion.
   * 'predictive'             — enforcer only EMITS warnings/exhaustion events for cost+tokens;
   *                            turns + duration continue to reject authoritatively.
   *
   * Use 'predictive' when the provider enforces budget atomically downstream
   * (e.g., CortexLLMProvider — capabilities().budgetEnforcement === 'native').
   */
  readonly mode?: 'authoritative' | 'predictive';
}

export function budgetEnforcer<T>(
  inner: InvokeFn<T>,
  pact: Pact<T>,
  onEvent?: (event: AgentEvent) => void,
  options?: BudgetEnforcerOptions,       // NEW, additive
): InvokeFn<T>;
```

Semantics of `mode: 'predictive'`:
- `tokens` post-check: warning + exhausted events emitted; **never** short-circuit the flow, **never** throw `BudgetExhaustedError`, **never** set `stopReason: 'budget_exhausted'` on the result.
- `cost` post-check: same.
- `turns` pre-check + post-check: unchanged from authoritative (reject).
- `duration` pre-check + post-check: unchanged from authoritative (reject).

Minor version bump. Default `'authoritative'` preserves all existing call-sites byte-for-byte (confirmed — the current signature has no `options` parameter; adding it as optional at the tail is source-compatible).

### 6.5 Tier routing (from effort → `LlmTier`)

Single authoritative table, lives in `llm-provider.ts`:

| `pact.reasoning.effort` | `LlmTier` | Notes |
|---|---|---|
| `'low'`      | `'fast'`      | Cheap, fast path. |
| `'medium'`   | `'balanced'`  | Default for most pacts. |
| `'high'`     | `'powerful'`  | Reasoning-heavy pacts (ReAct/Reflexion with high bar). |
| `undefined`  | `'balanced'`  | Fallback when pact declares no effort. |
| embedding call path (selected by tool/context manager) | `'embedding'` | Independent of effort. |

Override via `config.tierOverride` (static) or `config.tierFromEffort(effort, pact)` (dynamic). `ctx.llm.structured` selected when `pact.output?.schema` is present; otherwise `ctx.llm.complete`; `ctx.llm.embed` for embedding paths. `effortParams.maxTokens` (already set by pacta's `effortMapper` middleware on `request.metadata`) is the value passed to `CompletionRequest.maxTokens` (required by PRD-068 for pre-reserve estimation).

### 6.6 Event → audit `eventType` mapping (S3 §3.1, verbatim, normative for SC-04)

Lives as `AUDIT_EVENT_MAP: Record<AgentEvent['type'], AuditMappingEntry>` in `audit-middleware.ts`. Gate `G-AUDIT-EXHAUSTIVE` asserts `extractAgentEventTypes()` ⊆ `Object.keys(AUDIT_EVENT_MAP)`.

| pacta `AgentEvent.type` | `eventType` | payload |
|---|---|---|
| `started` | `method.agent.started` | `{ sessionId, pactId, mode, reasoningEffort }` |
| `text` | `method.agent.text` (suppressed by default via `suppressEventTypes`) | `{ contentPreview: first 200 chars }` |
| `thinking` | `method.agent.thinking` (suppressed by default) | `{ contentPreview }` |
| `tool_use` | `method.agent.tool_use` | `{ tool, toolUseId, inputRedacted }` |
| `tool_result` | `method.agent.tool_result` | `{ tool, toolUseId, durationMs, outputSizeBytes }` |
| `turn_complete` | `method.agent.turn_complete` | `{ turnNumber, usage }` |
| `context_compacted` | `method.agent.context_compacted` | `{ fromTokens, toTokens }` |
| `reflection` | `method.agent.reflection` | `{ trial, critiquePreview }` |
| `budget_warning` | `method.agent.budget_warning` | `{ resource, consumed, limit, percentUsed }` |
| `budget_exhausted` | `method.agent.budget_exhausted` | `{ resource, consumed, limit }` |
| `error` | `method.agent.error` | `{ message, code, recoverable }` |
| `completed` | `method.agent.completed` | `{ usage, cost, durationMs, turns, stopReason }` |
| Cognitive events | `method.cognitive.<variant>` | variant-specific; preserves `module` + `cycle` |
| (token-exchange success, from this PRD's token-exchange middleware) | `method.agent.token_exchange` | `{ depth, audience, scopeCount }` — never token text, never subject sub |

Redaction is delegated to Cortex's `RedactionPolicy` (PRD-065 §6.3) via the app's `requires.secrets.keys`. The middleware itself never writes tool_result `output` bodies — only a size indicator.

### 6.7 Middleware ordering (S3 §3.2)

Outer → inner:

```
CortexAuditMiddleware                (emit every event → ctx.audit)
  → CortexTokenExchangeMiddleware    (exchange + attach to request.metadata.__cortexDelegatedToken)
    → pacta budgetEnforcer           (predictive mode when provider is native)
      → pacta outputValidator
        → pacta reasoner middleware  (effortMapper, reactReasoner, ...)
          → CortexLLMProvider.invoke (the single ctx.llm call)
```

Wiring is the responsibility of PRD-058's `createMethodAgent`. This PRD guarantees each adapter exposes a `wrap(inner)` or `invoke(...)` in that shape.

### 6.8 Capabilities

```typescript
// ComposedCortexLLMProvider.capabilities()
{
  modes: ['single_shot', 'stateless_multi_turn', 'resumable'],
  streaming: false,             // v1 — PRD-068 Wave 7 gated
  resumable: false,             // provider is stateless; S4 owns resume
  budgetEnforcement: 'native',  // signals predictive mode on pacta enforcer
  outputValidation: 'client',   // pacta validator still runs
  toolModel: 'none',            // tools live above provider
}
```

`budgetEnforcement: 'native'` is the load-bearing signal for `G-BUDGET-SINGLE-AUTHORITY`.

### 6.9 Handler-fire contract (S3 §2.5)

Handlers are registered with `ctx.llm` at compose time (or passed through `cortexApp({ llm: handlers })` per PRD-068 Wave 5 SDK surface — exact mechanism inherited, not redefined here). The provider does **not** poll and does **not** own thresholds. When `ctx.llm`'s `BudgetStatus` on a return crosses 80 / 95 / 100, the provider mirrors the state into a single pacta `AgentBudgetWarning` / `AgentBudgetExhausted` event — read-only, never an enforcement path.

---

## 7. Per-Domain Architecture

### 7.1 `@methodts/pacta-provider-cortex` (new, L3)

- **Layer:** L3 (same as `@methodts/pacta-provider-anthropic`).
- **Deps:** peer `@methodts/pacta`; type-only `@t1/cortex-sdk`; no runtime Cortex imports.
- **Boundary gate:** `G-CORTEX-ONLY-PATH` (import scanner; allow-list = `ctx-types.ts`).
- **Layer gate:** no `@methodts/bridge`, no `@methodts/agent-runtime` import in `src/`.
- **Composition:** each factory is the composition root for its adapter. `compose()` is the single throw site. Post-compose, errors are typed values.

### 7.2 `@methodts/pacta` (extend, L2)

- **Change scope:** one option field on `budgetEnforcer`. Pure — no Cortex types referenced.
- **Backwards-compat:** default `'authoritative'` preserves every existing call-site (bridge, samples, pacta-testkit, smoke-test). Confirmed by reading `budget-enforcer.ts` — no current caller passes an options bag, so adding optional trailing param is source-compatible.
- **Version bump:** minor. CHANGELOG entry cites S3 §4 and this PRD.

### 7.3 Test strategy

- **Unit (per adapter, tests/*.test.ts):** fixture `ctx` shapes (mock `CortexLlmCtx`, `CortexAuditCtx`, `CortexAuthCtx`); happy-path compose + invoke/wrap; compose-time rejection tests (missing ctx, missing handler, bad config); tier mapping table; audit mapping exhaustiveness; depth-cap rejection; audit event fire-and-forget on `ctx.audit` failure.
- **Pacta regression:** existing `budget-enforcer.test.ts` must still pass (authoritative default). New test: predictive mode emits but does not stop on cost/tokens; predictive mode still stops on turns + duration.
- **Gate tests (`architecture.test.ts`):** `G-CORTEX-ONLY-PATH`, `G-LLM-HANDLERS-PRESENT`, `G-AUDIT-EXHAUSTIVE`, `G-TOKEN-DEPTH-CAP`, `G-ADAPTER-SHAPE`. `G-BUDGET-SINGLE-AUTHORITY` lives in PRD-058 (needs `createMethodAgent`); this PRD provides the mechanism (provider exposes `budgetEnforcement: 'native'`).
- **No integration test against live Cortex in this PRD.** Roadmap gate A8 (dev-stack smoke) is a PRD-058 + sample-app concern.

---

## 8. Phase Plan (size M, ~5 days)

### Wave 0 — Scaffolding (0.5d)

- Create `packages/pacta-provider-cortex/` package skeleton.
- Add to root `tsconfig.json` refs and `package.json` workspaces.
- Copy `adapter.ts` (verbatim from S3 §1) and a stub `ctx-types.ts`.
- Add gate file `architecture.test.ts` with failing stubs.
- Minor: extend `BudgetEnforcerOptions` type on `@methodts/pacta/src/middleware/budget-enforcer.ts` (type only, no behavior change yet).

**Acceptance:** `npm run build` passes; gate stubs fail; existing tests unchanged.

### Wave 1 — Pacta predictive mode (0.5d)

- Implement `mode: 'predictive'` behavior in `budgetEnforcer`.
- Add unit test for predictive cost/tokens suppression + authoritative turns/duration.
- Regression: existing enforcer tests pass.
- Bump `@methodts/pacta` minor + CHANGELOG.

**Acceptance:** pacta tests green including new case; bridge + samples build unchanged.

### Wave 2 — `CortexLLMProvider` (1.5d)

- Implement `cortexLLMProvider` factory, compose validation, tier map, invoke flow (complete/structured/embed), error mapping, capabilities, mirror-event emission on `BudgetStatus` threshold return.
- Unit tests + gate `G-LLM-HANDLERS-PRESENT`.

**Acceptance:** SC-01, SC-03, SC-07, SC-10.

### Wave 3 — `CortexAuditMiddleware` (1d)

- Implement `AUDIT_EVENT_MAP`, `wrap`, `emit`, fire-and-forget with `errors[]` collection.
- Unit tests + gate `G-AUDIT-EXHAUSTIVE`.
- Expose `suppressEventTypes` default `['text', 'thinking']`.

**Acceptance:** SC-04.

### Wave 4 — `CortexTokenExchangeMiddleware` (1d)

- Implement `wrap`, `exchangeForSubAgent`, `parseActChain` helper, depth cap, three error types, audit linkage payload.
- Unit tests + gate `G-TOKEN-DEPTH-CAP`.

**Acceptance:** SC-05.

### Wave 5 — Gates + polish (0.5d)

- Enforce `G-ADAPTER-SHAPE` (factory-export scanner) + `G-CORTEX-ONLY-PATH`.
- `src/index.ts` surface freeze — public exports listed per §5.1.
- Package README with three factory signatures + one wiring sketch (PRD-058 will own the end-to-end sample).

**Acceptance:** all gates green; `npm run build && npm test` green at repo root.

---

## 9. Acceptance Gates

| Gate | Scope | Defined in |
|---|---|---|
| `G-ADAPTER-SHAPE` | Every `*-{provider,middleware,...}.ts` in `src/cortex/` (or this package's `src/`) exports a factory returning `CortexServiceAdapter<>`. | S3 §7, this PRD §7.3 |
| `G-BUDGET-SINGLE-AUTHORITY` | `createMethodAgent` forces pacta `budgetEnforcer({ mode: 'predictive' })` when any provider reports `budgetEnforcement: 'native'`. | S3 §4 (gate); mechanism shipped here (provider capability flag + pacta mode). Actual assertion lives in PRD-058. |
| `G-TOKEN-DEPTH-CAP` | `exchangeForSubAgent` throws `CortexDelegationDepthExceededError` at `act_as` chain length ≥ 2 without calling `ctx.auth.exchange`. | S3 §7, this PRD §5.1 SC-05 |
| `G-AUDIT-EXHAUSTIVE` | `extractAgentEventTypes()` ⊆ `Object.keys(AUDIT_EVENT_MAP)`. New pacta event variants without a mapping fail the build. | S3 §7, this PRD §6.6 |
| `G-LLM-HANDLERS-PRESENT` | `cortexLLMProvider.compose` rejects with `missing_mandatory_handler` when any of `onBudgetWarning / onBudgetCritical / onBudgetExceeded` is absent. | S3 §2.2, PRD-068 §5.4 |
| `G-CORTEX-ONLY-PATH` | No runtime import from `@t1/cortex-sdk` in `src/` outside `ctx-types.ts`. | S3 §7 |

---

## 10. Risks

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R-01 | **`ctx.llm.reserve()`/`settle()` API shape unknown (open question O1).** Blocks `batched-held` budget carry-over for long resumable pacts. | High | Medium | v1 relies on PRD-068's existing atomic `checkAndReserve` per call. Carry-over is a PRD-062 concern (S5). This PRD does not depend on `reserve/settle`. If Cortex amends 12.3, the provider gains a cheap upgrade via `CompletionRequest.extra`. |
| R-02 | **Cortex `CompletionRequest.extra` field not yet agreed (open question O3).** `thinkingBudgetTokens` + `temperature` drop silently. | Medium | Low | Documented v1 limitation. Demos do not require thinking-budget control. |
| R-03 | **Streaming deferred (open question O2).** `capabilities().streaming = false`. Some reasoning strategies (e.g., future live-stream Reflexion) cannot run. | Medium | Low | Additive fix later — `Streamable.stream` becomes real when PRD-068 Wave 7 lands. No surface change. |
| R-04 | **Pacta minor bump breaks a consumer who passes positional onEvent + undefined.** | Low | Low | Adding an optional trailing param is TS-source-compatible. Regression suite + smoke-test runs catch any surprise. |
| R-05 | **Audit write failure silently drops events.** PRD-065 design (fire-and-forget + metric). Bugs hide. | Medium | Medium | Collect errors into `AgentResult.errors[]` (pacta-side, observable to the tenant app) AND rely on Cortex's `audit.write.failure` metric (platform-side). |
| R-06 | **Pacta event union widens (new variant), `AUDIT_EVENT_MAP` missing entry.** | Medium | Medium | Gate `G-AUDIT-EXHAUSTIVE` fails the build. Dev must add the mapping row or update suppress list. |
| R-07 | **Depth-cap parsing of `act_as` chain is Cortex-specific; format drift breaks client-side check.** | Low | Medium | `parseActChain` helper is isolated in one place. Server-side depth check remains authoritative. Unit test asserts against a golden JWT fixture. |
| R-08 | **Tier mapping table grows out of sync with Cortex pricing rotations.** | Low | Low | Mapping is effort→tier (stable). Tier→model lives in PRD-068's `LLMPricingRepo` — rotates server-side without client change. |

---

## 11. Open Questions (deferred — handed to caller / other PRDs)

Inherited from S3 §8 — none are new:

- O1 `ctx.llm.reserve()` / `settle()` — Cortex PRD-068 amendment (affects S5/PRD-062, not this PRD directly).
- O2 Streaming — PRD-068 Wave 7.
- O3 `CompletionRequest.extra` — Cortex 12.3 co-design.
- (O4 methodology override, O5/O6/O7 tool registration, O8 large payloads — unrelated.)

---

## 12. Judgment Calls Made in This Design

1. **Package name:** `@methodts/pacta-provider-cortex`. Preserves the `pacta-provider-*` family naming convention (S1+S3 agreement). Rejected `@methodts/cortex-adapters` (loses family affiliation) and co-locating inside `@methodts/agent-runtime` (would force agent-runtime to depend on `@t1/cortex-sdk` types — violates S3 §6 layering).
2. **Pacta extension placement:** on the existing `budgetEnforcer` factory, as a trailing optional parameter. Rejected introducing a new `predictiveBudgetEnforcer` factory (API surface duplication) and a class-based rework (scope creep). The decision trades one parameter-position bump for zero new exports and zero conceptual duplication.
3. **Default event suppression:** `['text', 'thinking']` suppressed by default in `CortexAuditMiddleware`. Rejected "log everything" (would fire two events per streamed token on chatty pacts — Cortex audit is a relational DB, not a time-series store). S6 `CortexEventConnector` will re-expose these via `ctx.events` for observability use cases; audit superset still holds because the suppress list is explicit + configurable.
4. **Turns + duration stay authoritative in predictive mode.** Cortex doesn't know pacta's turn or wall-clock budget. Keeping those in pacta is the only correct split — and it also means the `BudgetExhaustedError` contract still fires for the resources pacta owns.
5. **Depth-cap client-side enforcement in `exchangeForSubAgent`, not in `subagentDelegator`.** Pacta's delegator is provider-agnostic; it cannot know about Cortex tokens. The cap belongs with the token-exchange adapter. PRD-058 is responsible for wiring `subagentDelegator → exchangeForSubAgent`.

---

## 13. Freeze

- **Design frozen:** 2026-04-14 by this session.
- **Implementation:** scoped to 5 waves, ~5 days, size M.
- **Changes require:** an amendment to S3 (new `/fcd-surface` session) OR a new `/fcd-design` session citing this PRD as `supersedes`.
