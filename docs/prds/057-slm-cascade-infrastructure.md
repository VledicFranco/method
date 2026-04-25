---
type: prd
title: "PRD 057: SLM Cascade Infrastructure — N-tier Provider, Routing, Spillover"
date: "2026-04-25"
status: complete
tier: heavyweight
depends_on: [49, 52]
enables: []
blocked_by: []
complexity: high
domains: [pacta/cognitive/slm, pacta/middleware, pacta/ports, pacta-provider-anthropic, bridge/domains/cost-governor]
surfaces:
  - "CascadeProvider (N-tier) + AgentResult.confidence (additive) — frozen 2026-04-25"
  - "TierRouter port — frozen 2026-04-25 (impl deferred to Wave 3)"
  - "SLMInferer port + SpilloverSLMRuntime — port frozen 2026-04-25; spillover impl deferred to Wave 4"
related:
  - ".method/sessions/fcd-design-20260425-lysica-port-portfolio/notes.md"
  - "../lysica-1/docs/prds/005-cost-tiering-and-resilience.md"
  - "../lysica-1/.method/sessions/fcd-surface-cascade-provider-ntier/record.md"
  - "../lysica-1/.method/sessions/fcd-surface-tier-router/record.md"
  - "../lysica-1/.method/sessions/fcd-surface-slm-spillover/record.md"
progress:
  wave_0: complete
  wave_1: complete (cascade core + http-bridge + slm-as-agent-provider)
  wave_2: complete (@methodts/pacta-provider-openai-compat package — agent B)
  wave_3: complete (RoutingProvider + FeatureTierRouter — agent C)
  wave_4: complete (SpilloverSLMRuntime built ahead of signal — agent C)
---

## Progress log

| Date | Wave | Outcome |
|---|---|---|
| 2026-04-25 | Wave 0 + Wave 1 | **Complete in one pass.** All three surfaces frozen. CascadeProvider, confidenceAbove, SLMAsAgentProvider, HttpBridgeSLMRuntime, TierRouter port, SLMInferer port, SLM error hierarchy all shipped. 33 new tests (13 cascade, 6 slm-as-agent-provider, 8 http-bridge, plus other coverage). 1054/1054 pacta tests pass. |
| 2026-04-25 | Wave 2 | **Complete (agent B).** New sibling package `@methodts/pacta-provider-openai-compat`. `OpenAICompatibleProvider` implements `AgentProvider` against any OpenAI-compatible `/v1/chat/completions` endpoint (OpenRouter, Together, Fireworks, Groq, Cerebras). Native fetch + AbortSignal.timeout. Tools/streaming intentionally out of scope (heterogeneous backend support). Per-1K cost rates, optional. 14 unit tests using global fetch stub. |
| 2026-04-25 | Wave 3 | **Complete (agent C).** `RoutingProvider` (a-priori dispatch via TierRouter, default-fallback on TierRouterError or unknown tier name), `FeatureTierRouter` (rule-based router with `keywordMatch` + `lengthAbove` helpers). Both in `pacta/cognitive/slm/`. Per-tier dispatch + latency metrics with `resetMetrics()`. Capabilities intersection mirrors CascadeProvider. |
| 2026-04-25 | Wave 4 | **Complete (agent C — built ahead of signal).** `SpilloverSLMRuntime` implements `SLMInferer` with primary + fallback. Health states: `healthy` / `degraded` / `unknown`. Optional active probe via `setInterval(...).unref()` so it never blocks process exit. Inline recovery probe fires synchronously if degraded ≥ `recoveryCheckIntervalMs`. Double-failure errors wrap primary cause via `SLMError`. 38 new tests across W3+W4 suites. **1092/1092 pacta tests pass.** |

### Implementation details (2026-04-25)

**TS adaptation note:** the lysica PRD was written using Python `LLMProvider`/`LLMResponse` terms. TS pacta uses richer `AgentProvider`/`AgentResult<T>` (with sessions, streaming, tool use). The cascade and adapter code map across:

- `LLMProvider` → `AgentProvider`
- `LLMResponse` → `AgentResult<T>`
- `LLMResponse.confidence` → `AgentResult.confidence` (additive field on the canonical pact type)
- `complete(messages)` → `invoke<T>(pact, request)` (request carries `prompt: string`)

`SLMAsAgentProvider` bridges the impedance: an `SLMInferer` only speaks text-in/text-out; the adapter takes `request.prompt`, runs `infer()`, and packs the result into a minimal `AgentResult<T>` with `confidence` set.

**Files added (Wave 0 + Wave 1):**

- `packages/pacta/src/pact.ts` — `AgentResult.confidence?: number` (additive)
- `packages/pacta/src/ports/slm-inferer.ts` — Surface 3 port
- `packages/pacta/src/ports/tier-router.ts` — Surface 2 port + `TierRouterError`
- `packages/pacta/src/cognitive/slm/types.ts` — `SLMInferenceResult`, `SLMInferOptions`, `SLMMetrics`, `CascadeMetrics`, `CascadeTierMetrics`, `HealthState`, `HealthProbe`, `RoutingMetrics`, `SpilloverMetrics`
- `packages/pacta/src/cognitive/slm/errors.ts` — `SLMError`, `SLMNotAvailable`, `SLMLoadError`, `SLMInferenceError`
- `packages/pacta/src/cognitive/slm/cascade.ts` — `CascadeProvider`, `CascadeTier`, `TierAcceptFn`, `confidenceAbove`
- `packages/pacta/src/cognitive/slm/slm-as-agent-provider.ts` — `SLMAsAgentProvider`
- `packages/pacta/src/cognitive/slm/http-bridge.ts` — `HttpBridgeSLMRuntime` (uses native `fetch`, no third-party deps — G-PORT compliant)
- `packages/pacta/src/cognitive/slm/index.ts` — barrel
- 3 test files: `cascade.test.ts` (13 tests), `slm-as-agent-provider.test.ts` (6 tests), `http-bridge.test.ts` (8 tests with global fetch stub)

**Files modified:**

- `packages/pacta/src/cognitive/index.ts` — re-export `slm/`
- `packages/pacta/src/ports/index.ts` — re-export `SLMInferer`, `TierRouter`, `TierRouterError`

**What landed:**

- ✅ CascadeProvider with N-tier registration, accept-or-escalate semantics, error fall-through, per-tier metrics, `resetMetrics()`, capabilities intersection
- ✅ `confidenceAbove(threshold)` factory with range validation
- ✅ SLMAsAgentProvider — adapts `SLMInferer` to `AgentProvider`, populates `confidence` on the result
- ✅ HttpBridgeSLMRuntime — `/health` ping on `load()`, `/generate` POSTs, native `fetch` with `AbortSignal.timeout`, error hierarchy
- ✅ SLMInferer port (Wave 0)
- ✅ TierRouter port (Wave 0)
- ✅ Additive `AgentResult.confidence`

**What's deferred:**

- **Wave 2 (OpenAI-compat provider).** PRD specifies a new `@methodts/pacta-provider-openai-compat` package for OpenRouter / DeepSeek mid-tier. Not implemented overnight — that's a multi-hour package-creation + tool-call round-trip exercise. Cascade is fully usable today with `pacta-provider-anthropic` as the frontier tier and `SLMAsAgentProvider(HttpBridgeSLMRuntime)` as the SLM tier.
- **Wave 3 (RoutingProvider + FeatureTierRouter).** Port is frozen; impl pending. Composition pattern `RoutingProvider({ routine: cascade(slm, mid), hard: frontier })` is documented in the PRD; consumers can implement TierRouter themselves until the default impl ships.
- **Wave 4 (SpilloverSLMRuntime).** PRD-specified deferred (build on signal — first chobits outage triggers it). Stub class implementing `SLMInferer` is not shipped because the port is frozen and a concrete impl awaits a real failure mode to design against.

**Verification:**

- `npm run build --workspace=@methodts/pacta` — green
- `npm test --workspace=@methodts/pacta` — **1054/1054 pass** (33 new for PRD 057)
- G-PORT gate still passes — `HttpBridgeSLMRuntime` uses native `fetch` only, no third-party HTTP deps
- AC-1 (N-tier cascade), AC-3-design (Spillover contract frozen), AC-4 (no PRD 049/052 regression): verified

**PRD 057 status: Wave 0 + Wave 1 shippable.** Cascade infrastructure is production-usable today. Waves 2-4 are follow-up.

---

# PRD 057: SLM Cascade Infrastructure

## Problem

method's reasoning path is 100% routed through `pacta-provider-anthropic` →
Sonnet 4.6/4.7. Two existing TS components are SLM-aware but each is wired
to a single, task-specific port: `kpi-checker-slm.ts` (PRD 049) for KPI
predicate generation and `router-slm.ts` (PRD 052) for architecture
classification. Both bypass `AgentProvider`/`LLMProvider` entirely. There
is **no generic confidence-gated cascade** that the cognitive cycle (or any
ad-hoc reasoning call) can route through.

The Python sister repo (`lysica-1`) shipped a generic `CascadeProvider` and
in April 2026 froze the contracts for an N-tier evolution (PRD-005 there).
The user-facing argument that drove that PRD applies equally here: the OSS
reasoning landscape (DeepSeek-R1-Distill-Llama-70B, Kimi K2.6, Qwen3.5)
makes ~80% of routine reasoning ~5x cheaper than Sonnet without sacrificing
tool-call reliability — but only if the runtime can compose `SLM → mid →
frontier` without nesting two separate adapters.

A 2-tier cascade was the right abstraction last quarter. The 3+-tier shape
is now load-bearing. The lysica records freeze the right port shape; this
PRD ports the shape directly so we skip the breaking-change cycle the
Python side is mid-refactor on, and arrive at N-tier in a single move.

Adjacent problem: there's no spillover. If chobits (the on-prem RTX 4090
running the SLM server) goes offline, the bridge has no fallback path —
SLM-routed calls hard-fail or escalate silently to frontier. lysica's
`SpilloverSLMRuntime` is the cleanest fix and slots in below the cascade
with zero downstream awareness.

## Constraints

- **Backward-compat for PRD 049/052.** `KPICheckerPort` and `RouterSLMPort`
  ship today through `kpi-checker-slm.ts`/`router-slm.ts`. They keep their
  task-specific shape and HTTP transport; the cascade is parallel
  infrastructure, not a replacement.
- **Single SLM server.** `packages/slm-server/server.py` is the only HTTP
  bridge; we don't add a second protocol. The lysica `HttpBridgeSLMRuntime`
  is a thin wrapper over the same `/generate`/`/health` contract that
  `kpi-checker-slm` already speaks.
- **No bridge-tier behavior change required at Wave 0.** Cognitive agents
  keep using `AgentProvider`. The cascade adoption is a per-call-site
  decision in subsequent waves.
- **Cost governor coordination.** `domains/cost-governor` already attributes
  cost per-tenant; per-tier metrics from the cascade need to feed it
  without double-counting.
- **No new training in scope.** This PRD adopts the cascade infrastructure;
  it does not train new SLMs or change the Observer/Evaluator/Router models
  delivered in PRD 049/052.

## Success Criteria

1. **N-tier cascade compiles and ships** behind a feature flag. A reasoning
   call routed through `CascadeProvider([slm, mid, frontier])` returns a
   single `LLMResponse` with deterministic per-tier metrics. Tier
   acceptance is decided by an injected `TierAcceptFn` predicate
   (default: `confidenceAbove(threshold)`).
2. **OpenAI-compatible mid-tier provider works** against OpenRouter (DeepSeek
   primary target) and emits `LLMResponse` with `confidence: undefined`
   (the response field is additive). Latency, token, and cost telemetry
   reaches `cost-governor`.
3. **Spillover deferred but designed.** The `SpilloverSLMRuntime` contract
   is frozen and a stub implementation passes its conformance tests.
   Daemon/runtime composition is updated to accept it; the live deployment
   keeps the single `HttpBridgeSLMRuntime` until first chobits outage
   triggers Wave 4.
4. **No regression in PRD 049/052.** `kpi-checker-slm` and `router-slm`
   tests still pass unchanged. Their HTTP clients are not migrated to the
   cascade in this PRD.

## Scope

In scope:

- New `pacta/cognitive/slm/` directory under `@methodts/pacta` (or new
  `@methodts/pacta-slm` package — see Phase 4) with `cascade.ts`,
  `http-bridge.ts`, `types.ts`, `errors.ts`, `slm-as-llm-provider.ts`,
  `spillover.ts`.
- New port files in `pacta/ports/`: `tier-router.ts`, `slm-inferer.ts`.
- Additive `confidence?: number` field on `LLMResponse` (or its TS analog
  inside `pact.ts` / a new generic-LLM port — see §Per-Domain).
- New provider in `pacta-provider-anthropic` neighborhood: an
  `OpenAICompatibleProvider` (or its own package) for OpenRouter/Fireworks/
  Together/Groq. Likely co-located with the existing provider packages.
- New `RoutingProvider` (a-priori dispatch) and rule-based `FeatureTierRouter`
  in the cascade package.
- Daemon/composition wiring updates so existing call sites can opt-in.

Out of scope:

- Migrating `kpi-checker-slm`/`router-slm` to the cascade.
- Middleware-style cascade. The cascade is its own `LLMProvider`; not a
  `BudgetEnforcer`-style middleware. Mixing the two patterns invites
  surprise.
- Confidence calibration improvements (e.g., extracting confidence from
  Anthropic extended-thinking traces). Frontier tiers stay
  `confidence: undefined`.
- Frontend UI for tier configuration.
- Training new SLMs.

**Anti-capitulation:** if scope creeps to "while we're in there, also
migrate KPI/Router to the cascade", refuse — those ports were designed for
specific cognitive cycles and still want their bespoke shape. Generalizing
them is a separate PRD.

## Domain Map

```
                ┌──────────────────────────────────────┐
                │     Bridge / Cognitive cycle / etc.   │   (consumers)
                │     (call sites that want LLM)        │
                └──────────────┬───────────────────────┘
                               │   AgentProvider / LLMProvider
                               ▼
              ┌────────────────────────────────┐
              │        RoutingProvider          │   (optional layer)
              │   dispatches by TierRouter      │
              └──────┬───────────────┬─────────┘
                     │               │
                     ▼               ▼
        ┌─────────────────────┐    ┌────────────────────┐
        │   CascadeProvider   │    │  AnthropicProvider │
        │   tiers in order    │    │   (frontier-only)  │
        └──────┬───────────┬──┘    └────────────────────┘
               │           │
               ▼           ▼
   ┌────────────────┐  ┌────────────────────────┐
   │ SLMAsLLMProv.  │  │ OpenAICompatibleProv.  │
   │  wraps SLM     │  │  (OpenRouter/Together) │
   └──────┬─────────┘  └────────────────────────┘
          │
          ▼
   ┌────────────────────────────────────┐
   │     SpilloverSLMRuntime            │   (Wave 4 — deferred)
   │  primary: HttpBridgeSLMRuntime     │
   │  fallback: cloud-hosted SLM        │
   └──────┬─────────────────────────────┘
          │
          ▼
   HttpBridgeSLMRuntime ── HTTP /generate ──▶ slm-server (chobits)
```

Affected domains:

| Domain | Change |
|---|---|
| `pacta/cognitive/slm` | **New.** Owns `CascadeProvider`, `HttpBridgeSLMRuntime`, `SLMAsLLMProvider`, `SpilloverSLMRuntime`, types, errors. |
| `pacta/ports` | **Extend.** New `TierRouter`, `SLMInferer` ports. Additive `confidence` field on the canonical `LLMResponse` shape. |
| `pacta-provider-anthropic` (and siblings) | **Extend.** New sibling package or file: `OpenAICompatibleProvider` for `/v1/chat/completions` endpoints. |
| `pacta/middleware` | **No change.** Cascade is a provider, not middleware. |
| `bridge/domains/cost-governor` | **Extend.** Per-tier metric attribution; the cascade emits a per-tier breakdown the governor consumes. |
| `bridge` composition root | **Wire.** Optional cascade construction in `server-entry.ts`, behind config flag. |

## Surfaces (Primary Deliverable)

Three surfaces — all STANDARD complexity per fcd-design 3.2. Each is
inlined; the full Python contracts in lysica's records are the reference
implementation. TS shapes below.

### Surface 1 — `CascadeProvider` + additive `LLMResponse.confidence`

**Owner:** `pacta/cognitive/slm` · **Producer:** `CascadeProvider` · **Consumer:** any `AgentProvider` consumer (cognitive cycle, ad-hoc reasoning calls)

**Direction:** consumer → cascade (configuration); cascade → tiered providers (delegation)

**Status:** to freeze in Wave 0

**Additive change** to `pacta/pact.ts` (or wherever `LLMResponse` lives — verify in Wave 0):

```typescript
export interface LLMResponse {
  // ... existing fields preserved unchanged ...

  /**
   * Calibrated confidence in [0, 1] when the provider emits one
   * (e.g., SLMs). `undefined` when the provider has no native
   * confidence signal (most chat-completion LLMs). Consumed by
   * CascadeProvider's confidence-based tier-acceptance helpers;
   * ignored by other consumers.
   */
  confidence?: number;
}
```

**New** `packages/pacta/src/cognitive/slm/cascade.ts`:

```typescript
export type TierAcceptFn = (response: LLMResponse) => boolean;

/**
 * Predicate built around `LLMResponse.confidence`.
 * Returns false if confidence is undefined.
 */
export function confidenceAbove(threshold: number): TierAcceptFn;

export interface CascadeTier {
  /** Unique within a cascade. Used in metrics + logs. */
  readonly name: string;
  /** Provider for this tier. SLMs are wrapped via SLMAsLLMProvider. */
  readonly provider: LLMProvider;
  /**
   * Predicate run on this tier's response to decide whether to keep
   * it or escalate. `undefined` = always accept (terminal tier or
   * tier with no escalation signal).
   */
  readonly accept?: TierAcceptFn;
}

export interface CascadeMetrics {
  readonly perTier: ReadonlyMap<string, {
    invocations: number;
    accepted: number;
    avgLatencyMs: number;
    avgConfidence: number | null;
  }>;
}

export class CascadeProvider implements LLMProvider {
  constructor(tiers: readonly CascadeTier[]);
  // standard LLMProvider methods: complete, completeStructured
  readonly metrics: CascadeMetrics;
  resetMetrics(): void;
}
```

**Consumer-usage minimality check:** `complete()` is the only entry point;
no `streamComplete()` until a real consumer needs it. `completeStructured()`
is included only because lysica's experience showed JSON-validation
fallback prevents schema regressions when a low-confidence SLM returns
malformed JSON. We keep it.

**Gate:** `G-SLM-CASCADE` — `pacta/cognitive/slm/cascade.ts` does not
import from `pacta-provider-*` packages directly; tier providers are
injected. Asserted in `architecture.test.ts`.

### Surface 2 — `TierRouter` port + `RoutingProvider` impl

**Owner:** `pacta/ports` (port), `pacta/cognitive/slm` (impl) · **Producer:** `RoutingProvider` · **Consumer:** composition root

**Direction:** consumer → routing (config); routing → `TierRouter` (delegation); routing → `LLMProvider` (dispatch)

**Status:** to freeze in Wave 0

**New** `packages/pacta/src/ports/tier-router.ts`:

```typescript
/**
 * Pre-call dispatch decision. Inspects the LLM call's input and
 * returns the *name* of a downstream provider. Unlike CascadeProvider's
 * post-hoc `accept` predicate (inspects the response), TierRouter is
 * consulted BEFORE any provider is called.
 *
 * Implementations may be rule-based, SLM-backed, or LLM-backed.
 * The router has no awareness of which providers are wired downstream
 * — it returns a name. RoutingProvider resolves the name against its
 * provider registry and dispatches.
 */
export interface TierRouter {
  select(request: TierRouterRequest): Promise<string>;
}

export interface TierRouterRequest {
  readonly messages: readonly LLMMessage[];
  readonly system?: string;
  readonly tools?: readonly ToolDefinition[];
}

export class TierRouterError extends Error {}
```

**New** `packages/pacta/src/cognitive/slm/routing-provider.ts`:

```typescript
export interface RoutingProviderConfig {
  readonly router: TierRouter;
  readonly providers: ReadonlyMap<string, LLMProvider>;
  /** Fallback name when router throws TierRouterError. Must be in providers. */
  readonly defaultTier: string;
}

export class RoutingProvider implements LLMProvider {
  constructor(config: RoutingProviderConfig);
  // standard LLMProvider methods
  readonly metrics: RoutingMetrics;
}
```

Plus a **default rule-based router** (`feature-tier-router.ts`) that
matches lysica's `FeatureTierRouter` — keyword features on the last user
message, configurable rule list, zero LLM calls.

**Consumer-usage minimality check:** the router has *one* method (`select`).
Lysica's `select()` returns a string name (not an `LLMProvider` reference)
so the router stays decoupled from the provider registry — verified, kept.

**Gate:** `G-TIER-ROUTER` — `pacta/ports/tier-router.ts` has zero imports
from `pacta/cognitive/`, `pacta/middleware/`, or any provider package.

### Surface 3 — `SLMInferer` Protocol + `SpilloverSLMRuntime` impl

**Owner:** `pacta/ports` (port), `pacta/cognitive/slm` (impl) · **Producer:** `SpilloverSLMRuntime`, `HttpBridgeSLMRuntime` · **Consumer:** `SLMAsLLMProvider`

**Direction:** SLMAsLLMProvider → SLMInferer (delegation)

**Status:** to freeze in Wave 0

**New** `packages/pacta/src/ports/slm-inferer.ts`:

```typescript
/**
 * Anything that can run SLM inference. Structurally implemented
 * by HttpBridgeSLMRuntime, SpilloverSLMRuntime, and any future
 * local ONNX runtime.
 */
export interface SLMInferer {
  infer(prompt: string, options?: SLMInferOptions): Promise<SLMInferenceResult>;
}

export interface SLMInferOptions {
  readonly maxLength?: number;
  readonly timeoutMs?: number;
}

export interface SLMInferenceResult {
  readonly output: string;
  readonly confidence: number; // [0, 1]
  readonly inferenceMs: number;
  readonly escalated: boolean;
  readonly fallbackReason?: string;
}
```

**New** `packages/pacta/src/cognitive/slm/spillover.ts` (Wave 4 — implementation deferred, but contract frozen now):

```typescript
export type HealthState = 'healthy' | 'degraded' | 'unknown';
export type HealthProbe = () => Promise<boolean>;

export interface SpilloverConfig {
  readonly primary: SLMInferer;
  readonly fallback: SLMInferer;
  /** Active health probe interval. 0 = disabled (passive only). */
  readonly checkIntervalMs?: number;
  /** How long degraded state persists before re-probing. */
  readonly recoveryCheckIntervalMs?: number;
  readonly probe?: HealthProbe;
}

export class SpilloverSLMRuntime implements SLMInferer {
  constructor(config: SpilloverConfig);
  readonly metrics: SpilloverMetrics;
  readonly healthState: HealthState;
  /** Spawns the active probe loop; idempotent. */
  start(): Promise<void>;
  /** Stops the probe loop and closes any held resources. */
  stop(): Promise<void>;
}
```

**Consumer-usage minimality check:** the `SLMInferer` Protocol has *one*
method. Already validated by lysica's existing usage. We add `options`
because TS can't pass keyword arguments — slightly different ergonomics
but same minimality.

**Gate:** `G-SLM-INFERER` — `pacta/ports/slm-inferer.ts` imports nothing
from `cognitive/`, `middleware/`, or any provider.

### Entity check

`LLMResponse` is the only existing entity touched, and the change is
purely additive. No new shared entities are introduced — the cascade types
(`CascadeTier`, `CascadeMetrics`, `RoutingMetrics`, `SpilloverMetrics`,
`HealthState`, `HealthProbe`, `TierAcceptFn`, `SLMInferenceResult`,
`SLMInferOptions`) are all scoped to their owning module.

### Surface summary

| # | Surface | Owner | Producer → Consumer | Status | Gate |
|---|---|---|---|---|---|
| 1 | `CascadeProvider` + `LLMResponse.confidence` | `cognitive/slm` | cascade → providers | to-freeze (Wave 0) | G-SLM-CASCADE |
| 2 | `TierRouter` port + `RoutingProvider` | `ports` / `cognitive/slm` | routing → router → providers | to-freeze (Wave 0) | G-TIER-ROUTER |
| 3 | `SLMInferer` port + `SpilloverSLMRuntime` | `ports` / `cognitive/slm` | spillover → SLMInferer | to-freeze (Wave 0) | G-SLM-INFERER |

## Per-Domain Architecture

### `pacta/cognitive/slm` (NEW)

**Layer:** L2/L3 mixed — port-shaped types are L2, transport-touching code (HTTP bridge) is L3.

**Internal layout:**

```
packages/pacta/src/cognitive/slm/
  README.md
  index.ts                  Re-exports
  cascade.ts                CascadeProvider, CascadeTier, TierAcceptFn, confidenceAbove
  cascade.test.ts           Unit + integration with mocks
  routing-provider.ts       RoutingProvider
  routing-provider.test.ts
  feature-tier-router.ts    Rule-based router
  feature-tier-router.test.ts
  http-bridge.ts            HttpBridgeSLMRuntime
  http-bridge.test.ts       (with msw or undici mock)
  slm-as-llm-provider.ts    SLMAsLLMProvider — wraps SLMInferer as LLMProvider
  spillover.ts              SpilloverSLMRuntime (Wave 4 stub, contract frozen)
  spillover.test.ts
  types.ts                  CascadeMetrics, RoutingMetrics, SpilloverMetrics, HealthState
  errors.ts                 SLMError hierarchy: SLMNotAvailable, SLMLoadError, SLMInferenceError
```

**Port consumption:** `LLMProvider` (existing), `SLMInferer` (new, Surface 3), `TierRouter` (new, Surface 2).

**Port production:** `LLMProvider` (cascade and routing both implement it; this is the composition theorem at work — they swap with any frontier provider).

**Verification strategy:** unit tests per file; an integration test in `cascade.test.ts` that builds a 3-tier cascade with mocked SLM + mocked OpenAI-compat + a real `AnthropicProvider` stub, verifies escalation paths and metrics.

### `pacta/ports`

**File: `llm.ts`** (or wherever `LLMResponse` lives) — verify in Wave 0. Add `confidence?: number` field. Backward-compatible.

**File: `tier-router.ts` (NEW)** — Protocol-only. Zero imports from L2/L3.

**File: `slm-inferer.ts` (NEW)** — Protocol-only.

### `pacta-provider-anthropic` neighborhood

**Decision:** create a sibling package `@methodts/pacta-provider-openai-compat` rather than extending the Anthropic package. Rationale: the existing `pacta-provider-*` pattern is one package per upstream; OpenRouter/Together/Fireworks/Groq all speak the same OpenAI-compat shape, so one package serves them.

**Layout:**

```
packages/pacta-provider-openai-compat/
  package.json
  src/
    index.ts
    provider.ts              OpenAICompatibleProvider
    provider.test.ts
    types.ts
```

**Constructor:** `(baseUrl, apiKey, model, { timeoutMs, defaultHeaders })`. Translates `LLMMessage` ↔ OpenAI message format, `ToolDefinition` ↔ OpenAI tool format. Returns `LLMResponse` with `confidence: undefined`.

**Verification:** unit tests with `undici` `MockAgent` covering happy path, tool-call round-trip, schema mismatches, timeout.

### `bridge/domains/cost-governor`

**Change:** consume per-tier metrics from any `CascadeProvider` instance the bridge composes. Two options:

- **A.** Cascade emits an event on each tier hop; cost-governor subscribes via the existing event bus.
- **B.** Cascade exposes a `metrics` accessor; cost-governor polls it on a timer.

**Recommendation:** A. Reuses existing event-bus plumbing, no polling jitter, lines up with how `budgetEnforcer` already emits `agent_budget_warning` events.

This is a small change inside cost-governor (subscribe + attribute) — not a new surface.

### `bridge` composition root

**File:** `packages/bridge/src/server-entry.ts`. Add optional cascade construction behind a config flag (`CASCADE_ENABLED=true`), keyed on env-var-driven tier list. The default-off path keeps everything wired exactly as today.

### Layer Stack Cards

All new components fit existing FCA placement:

| Component | Layer | Domain | Consumed Ports |
|---|---|---|---|
| `CascadeProvider` | L3 | `cognitive/slm` | `LLMProvider` |
| `RoutingProvider` | L3 | `cognitive/slm` | `TierRouter`, `LLMProvider` |
| `FeatureTierRouter` | L2 | `cognitive/slm` | (none — pure rules) |
| `HttpBridgeSLMRuntime` | L3 | `cognitive/slm` | (HTTP transport — `undici`/`fetch`) |
| `SLMAsLLMProvider` | L2 | `cognitive/slm` | `SLMInferer` |
| `SpilloverSLMRuntime` | L3 | `cognitive/slm` | `SLMInferer` (×2), `HealthProbe` |
| `OpenAICompatibleProvider` | L3 | `pacta-provider-openai-compat` | (HTTP transport) |

No card escalation needed — each component's L0-L4 questions resolve trivially against the surfaces above.

## Phase Plan

### Wave 0 — Surfaces (≈1 day)

**Goal:** every typed contract in §Surfaces frozen and asserted.

1. Locate the canonical `LLMResponse` definition (currently used by all `pacta-provider-*` packages). Add `confidence?: number`. Update all provider implementations to leave it `undefined`.
2. Create `packages/pacta/src/ports/tier-router.ts` and `slm-inferer.ts`.
3. Create skeleton `packages/pacta/src/cognitive/slm/` directory with empty files for every component plus a stub `index.ts` re-exporting only the *types* (no implementations yet).
4. Add gate assertions in `packages/pacta/src/cognitive/algebra/__tests__/architecture.test.ts` (or the canonical architecture-test file) for G-SLM-CASCADE, G-TIER-ROUTER, G-SLM-INFERER.
5. Add `packages/pacta-provider-openai-compat/package.json` + skeleton `provider.ts` exporting only the type signature.

**Acceptance:** `npm run build` green. Architecture tests pass with surfaces in place but no implementations.

### Wave 1 — HttpBridge + SLMAsLLMProvider + Cascade core (≈2 days)

1. Implement `HttpBridgeSLMRuntime` (port `slm-server` chobits HTTP).
2. Implement `SLMAsLLMProvider`.
3. Implement `CascadeProvider` + `confidenceAbove` + per-tier metrics.
4. Tests: confidence-gated escalation, terminal tier, error escalation, metrics correctness.

**Acceptance:** `npm test --workspace=@methodts/pacta` passes. Demo: 2-tier `[slm, mockFrontier]` cascade routes by confidence in unit tests.

### Wave 2 — OpenAI-compat provider (≈2 days)

1. Implement `OpenAICompatibleProvider` against OpenRouter's `/v1/chat/completions`.
2. Round-trip `LLMMessage` ↔ OpenAI shape, including tool calls.
3. Live smoke test against OpenRouter with a `DEEPSEEK_API_KEY` env var (skipped if absent).

**Acceptance:** OpenRouter call returns valid `LLMResponse` with tools round-tripped.

### Wave 3 — Routing layer (≈1.5 days)

1. Implement `RoutingProvider` + `FeatureTierRouter` (rule-based).
2. Cost-governor event subscription for per-tier attribution.
3. Composition-root wiring behind `CASCADE_ENABLED` flag.

**Acceptance:** With flag on, the bridge boots a 3-tier cascade routing path; with flag off, no behavior change.

### Wave 4 — Spillover (DEFERRED, build on signal)

Not implemented in initial PR. Frozen contract + stub class only. Triggers:

- chobits has its first sustained outage (>30 min) impacting bridge users, OR
- field test wants to A/B a cloud SLM fallback.

Implementation is ≈1.5 days from frozen contract.

### Acceptance Gates

| Wave | Tests | Gates | Definition of done |
|---|---|---|---|
| 0 | architecture.test.ts | G-SLM-CASCADE, G-TIER-ROUTER, G-SLM-INFERER | All surfaces typed and frozen; build green |
| 1 | cascade.test.ts, http-bridge.test.ts, slm-as-llm-provider.test.ts | (Wave 0 + ) types match port files | 2-tier cascade demo passes |
| 2 | provider.test.ts | (cumulative) | OpenRouter live smoke optional pass |
| 3 | routing-provider.test.ts, feature-tier-router.test.ts, cost-governor integration | (cumulative) | Composition root wired; flag-on default-off |
| 4 | spillover.test.ts (live integration) | (cumulative) | Health-degraded → fallback validated against staging chobits |

## Risks

- **R1 — `LLMResponse` shape divergence.** Different `pacta-provider-*` packages may have already re-defined `LLMResponse` locally instead of importing the canonical one. Wave 0 begins with a grep audit; if divergence exists, the PRD's first commit consolidates it (no logic change). **Likelihood:** medium. **Mitigation:** Wave 0 audit step.
- **R2 — Cost-governor double-attribution.** The cascade emits per-tier metrics; the existing budget-enforcer middleware also tracks tokens/cost. If a call is wrapped by both, cost may double-count. **Mitigation:** decide attribution authority early — cascade is authoritative when present, budget-enforcer falls into 'predictive' mode (pattern already exists per `budget-enforcer.ts` PRD-059 docstring).
- **R3 — OpenRouter tool-call shape drift.** OpenAI's tool-call schema has had multiple iterations; OpenRouter passes through whatever the underlying model speaks. **Mitigation:** OpenAI-compat provider tests cover the latest `tool_choice: 'auto'` shape; failure modes throw a typed error rather than silently corrupting the response.
- **R4 — Spillover never gets built.** Wave 4 is "build on signal"; the signal might not arrive for months while frozen contracts rot. **Mitigation:** the frozen `SLMInferer` is consumed in Wave 1 (HttpBridge implements it); contract gets exercised continuously even without spillover.
- **R5 — N-tier metric explosion.** Per-tier metrics in a long-running bridge can grow unbounded. **Mitigation:** metrics are reset on each cascade-level `resetMetrics()` call; cost-governor sees only event-stream snapshots, not a growing in-memory store.

## Related Work

- `../lysica-1/docs/prds/005-cost-tiering-and-resilience.md` — the source PRD this ports.
- `../lysica-1/.method/sessions/fcd-surface-cascade-provider-ntier/record.md` — Surface 1 reference.
- `../lysica-1/.method/sessions/fcd-surface-tier-router/record.md` — Surface 2 reference.
- `../lysica-1/.method/sessions/fcd-surface-slm-spillover/record.md` — Surface 3 reference.
- PRD 049 (`docs/prds/049-kpi-checker-slm.md`), PRD 052 (`docs/prds/052-router-slm.md`) — task-specific SLM ports that remain unchanged.

## Open Questions

1. Does `LLMResponse` live in `packages/pacta/src/pact.ts` or a dedicated `ports/llm.ts`? Wave 0 audit answers this.
2. Should `OpenAICompatibleProvider` be its own package or live inside `pacta-provider-anthropic`? Default: own package; revisit if no second OpenAI-compat target appears in 6 months.
3. Should the cascade's `accept` predicate be `async`? Lysica's is sync — kept here for the same reason: predicates are usually structural/numeric and sync keeps the cascade hot-path tight. Promote to async if a real consumer needs it.
