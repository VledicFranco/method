---
type: co-design-record
surface: "CortexServiceAdapters (S3)"
date: "2026-04-14"
owner: "@method/agent-runtime"
producer: "@method/agent-runtime (adapters) — implemented against Cortex ctx.* (consumer-of-platform)"
consumer: "Cortex tenant app composition root (ctx.* host)"
direction: "method → Cortex ctx.* (outbound calls); Cortex → method (event handlers register at compose-time)"
status: frozen
mode: "new"
related:
  - docs/roadmap-cortex-consumption.md §4.1 (items A3, A4, A5)
  - t1-cortex-1/docs/rfcs/RFC-005-app-platform-service-library.md §4.1, §4.1.5
  - t1-cortex-1/docs/prds/068-llm-service.md
  - t1-cortex-1/docs/prds/065-audit-service.md
  - t1-cortex-1/docs/prds/061-auth-as-a-service.md
  - packages/pacta/src/ports/agent-provider.ts
  - packages/pacta/src/middleware/budget-enforcer.ts
prd_ref: "PRD-059"
supersedes: "—"
---

# Co-Design Record — CortexServiceAdapters (S3)

> *The adapter pattern that maps `@method/pacta` ports to Cortex `ctx.*` services.*
> *Shipping as the first three concrete instantiations: LLM, Audit, Auth
> (token exchange). Future adapters (storage S4, jobs S5, events S6) follow
> the same shape.*

---

## 0. Scope

This surface freezes:

1. **Three concrete TypeScript surfaces** shipped in `@method/agent-runtime/src/cortex/`:
   - `CortexLLMProvider` — implements pacta `AgentProvider` over `ctx.llm`
   - `CortexAuditMiddleware` — translates pacta `AgentEvent` to `ctx.audit`
   - `CortexTokenExchangeMiddleware` — RFC 8693 token exchange per call chain
2. **A shared `CortexServiceAdapter<CtxSlice, Config>` pattern** that all
   future Cortex adapters conform to (so S4–S6 are mechanical).
3. **The compose-time validation contract** that rejects malformed pacts at
   factory construction (not at first invocation).
4. **The double-counting resolution** between pacta's predictive
   `budgetEnforcer` and `ctx.llm`'s atomic check-and-reserve.
5. **The token-exchange depth enforcement placement** (who counts `act_as`
   chain length, where).

**Out of scope (other surfaces):**
- S1 `MethodAgentPort` (PRD-060) — the outermost public API on
  `@method/agent-runtime`.
- S2 `CortexCtxPort` — the shape of `ctx.*` that method consumes (frozen
  separately, owned by Cortex RFC-005).
- S4 `CortexSessionStore` (PRD-061), S5 `JobBackedExecutor` (PRD-062),
  S6 `CortexEventConnector` (PRD-063) — follow the pattern defined here.

---

## 1. The Shared Adapter Pattern

All Cortex adapters in `@method/agent-runtime` satisfy this shape:

```typescript
// packages/agent-runtime/src/cortex/adapter.ts

/**
 * The slice of Cortex ctx.* that an adapter consumes. Kept narrow —
 * each adapter declares exactly which ctx services it needs. This is
 * the ONLY way adapters reach Cortex. No global ctx, no fallbacks.
 */
export type CtxSlice = Partial<{
  llm:    CortexLlmCtx;       // from PRD-068
  audit:  CortexAuditCtx;     // from PRD-065
  auth:   CortexAuthCtx;      // from PRD-061 / RFC-005 §4.1
  storage: CortexStorageCtx;  // S4
  jobs:    CortexJobsCtx;     // S5
  events:  CortexEventsCtx;   // S6
  // Future ctx.* services extend here; never add optional fields that
  // silently no-op — adapters fail-closed.
}>;

/**
 * Every Cortex adapter implements this shape. The `compose` step is
 * the sole place validation runs — after compose returns, the adapter
 * is guaranteed structurally correct. Runtime errors become typed
 * AdapterFailure values, never thrown at unexpected call sites.
 */
export interface CortexServiceAdapter<
  TCtxSlice extends Partial<CtxSlice>,
  TPact,            // the pact shape the adapter asserts against
  TConfig = unknown // static configuration the adapter accepts
> {
  /** Stable identifier for diagnostics and gate assertions. */
  readonly name: string;

  /**
   * Validate + bind. Throws CortexAdapterComposeError for any structural
   * mismatch between pact and required ctx services. After compose
   * returns, the adapter is live.
   *
   * This is the ONE place that may throw. Anything past compose returns
   * typed results.
   */
  compose(args: {
    ctx: TCtxSlice;
    pact: TPact;
    config?: TConfig;
  }): ComposedAdapter<TPact>;
}

/** The bound, ready-to-run form. */
export interface ComposedAdapter<TPact> {
  readonly name: string;
  readonly requires: ReadonlyArray<keyof CtxSlice>; // which ctx services it holds
  readonly pact: TPact;
  dispose?(): Promise<void>;
}

/**
 * Single error class every adapter throws from compose(). Consumers
 * handle one type, not N.
 */
export class CortexAdapterComposeError extends Error {
  readonly adapter: string;
  readonly reason:
    | 'missing_ctx_service'       // required ctx.foo not provided
    | 'missing_pact_field'        // pact doesn't declare required capability
    | 'missing_mandatory_handler' // PRD-068 handler absent
    | 'incompatible_version'      // ctx service version doesn't match adapter
    | 'invalid_config';
  readonly details: Record<string, unknown>;
  constructor(adapter: string, reason: CortexAdapterComposeError['reason'], details: Record<string, unknown>) {
    super(`Cortex adapter "${adapter}" compose failed: ${reason} — ${JSON.stringify(details)}`);
    this.name = 'CortexAdapterComposeError';
    this.adapter = adapter;
    this.reason = reason;
    this.details = details;
  }
}
```

**Why this shape:**

- Every adapter's side effects are reachable only through `ctx.*` — the pattern
  enforces that at the type level (an adapter that needs LLM access
  **cannot** be composed if `ctx.llm` is absent; the type of `TCtxSlice`
  makes the slice required, not optional, for that adapter).
- `compose()` is the only throw site. Invocation-time failures become
  typed error events (for providers) or typed `Result<T>` (for middleware).
  This is the same discipline as RFC-005 §4.1.8 "nothing happens at runtime
  that wasn't locked down at compose time."
- `requires` is readable from the outside so a higher-level factory
  (`createMethodAgent`) can cross-check `pact.requires` against the
  union of all adapters' `requires`. Gate G-CORTEX-COMPLETENESS enforces
  "every pact-declared capability has a composed adapter."

**Future adapters (S4, S5, S6) MUST:**
1. Export a single factory `create{Name}Adapter(config?: {Name}Config): CortexServiceAdapter<...>`.
2. Declare their `TCtxSlice` as the exact sub-record of `CtxSlice` they use. **Never** take the whole `ctx`.
3. Throw `CortexAdapterComposeError` and only `CortexAdapterComposeError` from `compose()`.
4. Expose their composed form as a typed wrapper of the pacta port they fulfill (AgentProvider, Middleware, MemoryPort, Resumable, etc.).

---

## 2. Surface 1 — `CortexLLMProvider`

### Purpose
Implements the pacta `AgentProvider` port by routing every model call through
`ctx.llm.complete/structured/embed`. No API keys in method; no provider
SDK imports in the agent runtime.

### Interface

```typescript
// packages/agent-runtime/src/cortex/llm-provider.ts
import type {
  AgentProvider, Streamable, ProviderCapabilities
} from '@method/pacta/ports/agent-provider';
import type {
  Pact, AgentRequest, AgentResult
} from '@method/pacta';
import type {
  CortexLlmCtx, LlmTier, LlmBudgetHandlers, BudgetStatus,
  CompletionResult, StructuredResult, EmbeddingResult
} from './ctx-types.js'; // narrow re-declaration of Cortex SDK types
import type {
  CortexServiceAdapter, ComposedAdapter
} from './adapter.js';

/** Compose-time configuration for the Cortex LLM provider. */
export interface CortexLLMProviderConfig {
  /**
   * Tier override. If omitted, tier is derived from
   * pact.reasoning.effort via the table in §2.3.
   */
  tierOverride?: LlmTier;

  /**
   * Mandatory budget handlers per PRD-068 §5.4. Validated at compose.
   * See §2.2 for the "missing handler = compose error" rule.
   */
  handlers: LlmBudgetHandlers;

  /**
   * Optional tier mapper. Advanced callers override the default
   * effort → tier mapping (§2.3).
   */
  tierFromEffort?: (effort: 'low' | 'medium' | 'high' | undefined, pact: Pact<unknown>) => LlmTier;
}

/** The adapter factory — the only thing consumers import. */
export function cortexLLMProvider(
  config: CortexLLMProviderConfig
): CortexServiceAdapter<
  { llm: CortexLlmCtx },
  Pact<unknown>,
  CortexLLMProviderConfig
>;

/** The composed form — satisfies pacta's AgentProvider. */
export interface ComposedCortexLLMProvider
  extends ComposedAdapter<Pact<unknown>>,
          AgentProvider,
          Streamable {
  readonly name: 'cortex-llm';
  capabilities(): ProviderCapabilities; // see §2.4
}
```

### 2.1 Invocation flow (one turn)

```
pacta agent engine
  → CortexLLMProvider.invoke(pact, request)
      1. Derive tier:
           effort = pact.reasoning?.effort
           tier   = config.tierFromEffort?.(effort, pact) ?? DEFAULT_TIER_MAP[effort]
      2. Build CompletionRequest { prompt, tier, maxTokens: effortParams.maxTokens }
         (effortParams is the value put on request.metadata by effortMapper
          middleware — §2.3 documents the contract).
      3. Call ctx.llm.complete(req) OR .structured(req) (based on
         pact.output?.schema) OR .embed(text) — Cortex does check-and-reserve
         atomically per PRD-068 §5.1.
      4. Map CompletionResult → AgentResult:
           usage.inputTokens  = tokensIn
           usage.outputTokens = tokensOut
           usage.totalTokens  = tokensIn + tokensOut
           cost.totalUsd      = costUsd            // REAL, post-reconcile
           cost.perModel[providerModel] = { tokens, costUsd }
           stopReason         = 'complete'
      5. Emit 'turn_complete' with the same usage.
         (Budget handlers are NOT invoked from inside invoke(); they fire
          from ctx.llm's own threshold check — see §2.5.)
      6. If ctx.llm throws LLMError.BudgetExceeded:
           emit AgentEvent 'budget_exhausted' with resource='cost'
           return AgentResult with stopReason='budget_exhausted', completed=false
         If ctx.llm throws LLMError.RateLimited:
           emit AgentEvent 'error' { recoverable: true, code: 'rate_limited' }
           throw CortexProviderError — caller may retry.
         Other LLMError → AgentEvent 'error' { recoverable: false }; throw.
```

### 2.2 Compose-time validation (strict)

`compose()` rejects any of:

| Check | Error reason | Detail |
|---|---|---|
| `ctx.llm` is undefined | `missing_ctx_service` | `{ service: 'llm' }` |
| `config.handlers.onBudgetWarning` absent | `missing_mandatory_handler` | `{ handler: 'onBudgetWarning' }` |
| `config.handlers.onBudgetCritical` absent | `missing_mandatory_handler` | `{ handler: 'onBudgetCritical' }` |
| `config.handlers.onBudgetExceeded` absent | `missing_mandatory_handler` | `{ handler: 'onBudgetExceeded' }` |
| Pact declares `requires.llm` but adapter is not being supplied to a `MethodAgentPort` wiring | — | enforced at the outer `createMethodAgent` factory, not here |

Handlers MUST be present even if they are no-ops that only log — PRD-068
§5.4 forbids `undefined`. This is gate `G-LLM-HANDLERS-PRESENT`.

### 2.3 Tier routing table

Pacta has no concept of Cortex tiers. The mapping lives here and here only:

```typescript
const DEFAULT_TIER_MAP: Record<
  NonNullable<Pact['reasoning']>['effort'] | 'undefined',
  LlmTier
> = {
  'low':       'fast',
  'medium':    'balanced',
  'high':      'powerful',
  'undefined': 'balanced',  // when pact doesn't declare an effort level
};
```

The effort-mapper middleware (already part of pacta) continues to populate
`request.metadata.effortParams` with `{ thinkingBudgetTokens, temperature,
maxTokens }`. The provider uses `effortParams.maxTokens` as the
`CompletionRequest.maxTokens` (Cortex needs this to compute the
pre-reservation estimate). `thinkingBudgetTokens` and `temperature` flow
through via `CompletionRequest.extra` (new optional field the Cortex LLM
adapter negotiates with PRD-068 team in the 12.3 co-design — if the field
doesn't land, those values are dropped silently by the provider and that
fact is a documented v1 limitation).

Embedding calls (agents that use tool-embedding context) route through
`ctx.llm.embed` with `tier: 'embedding'` — independent of effort.

`ctx.llm.structured` is selected when `pact.output?.schema` is present;
the pacta outputValidator middleware still runs to assert the shape the
agent declared matches what Cortex returns.

### 2.4 Capabilities

```typescript
capabilities(): ProviderCapabilities {
  return {
    modes: ['single_shot', 'stateless_multi_turn', 'resumable'],
    streaming: false,          // v1: ctx.llm.complete is request/response.
                               // Streaming follows PRD-068 Wave 7 gate.
    resumable: false,          // provider is stateless; resume is S4's concern.
    budgetEnforcement: 'native', // Cortex is the enforcement authority
    outputValidation: 'client',  // pacta's validator still runs
    toolModel: 'none',         // tools live at the pact level, above the provider
  };
}
```

Note that `budgetEnforcement: 'native'` is the signal to the outer
`createMethodAgent` factory that the pacta `budgetEnforcer` should be
configured in **predictive-only** mode for this provider. See §4
"Budget double-count resolution."

### 2.5 Handler-fire contract (where do handlers run?)

**Where they fire:** handlers run inside Cortex's LLM service per PRD-068 §5.4
whenever the budget crosses 80/95/100 percent. Method does NOT poll and
does NOT decide thresholds — that authority belongs to `ctx.llm`.

**What method does:** registers `config.handlers` with `ctx.llm` at
compose time (or passes them through the `cortexApp({... llm: handlers})`
wiring — the exact mechanism follows the PRD-068 Wave 5 SDK surface).

**Where handlers SHOULD NOT live:** not inside `pact.budget.onExhaustion`
(that is pacta's pre-flight), not inside individual middleware, not in
the agent code. Exactly one place, registered exactly once per agent
runtime, owned by the adapter.

**AgentEvent mirror:** when ctx.llm's `BudgetStatus` indicates warning /
critical / exceeded (observed on any return), the provider ALSO emits
pacta's `AgentBudgetWarning` / `AgentBudgetExhausted` events so the
existing pacta event stream stays informative. This mirror is read-only
— never an enforcement path.

---

## 3. Surface 2 — `CortexAuditMiddleware`

### Purpose
Every pacta `AgentEvent` variant is translated to a PRD-065-compliant
audit call on `ctx.audit`. This is the agent-runtime's sole audit path —
no direct writes to any other audit sink.

### Interface

```typescript
// packages/agent-runtime/src/cortex/audit-middleware.ts
import type { AgentEvent } from '@method/pacta';
import type { Pact, AgentRequest, AgentResult } from '@method/pacta';
import type { CortexAuditCtx } from './ctx-types.js';
import type {
  CortexServiceAdapter, ComposedAdapter
} from './adapter.js';

export interface CortexAuditMiddlewareConfig {
  /** The Cortex app id — already bound into ctx.audit; included here for logging symmetry. */
  appId: string;

  /** Opaque opt-in: events to elide (e.g., high-frequency 'text' chunks). Default: no elision. */
  suppressEventTypes?: Array<AgentEvent['type']>;

  /** Tag prepended to eventType when a pacta event has no direct audit mapping. */
  fallbackPrefix?: string; // default 'method.agent'
}

/** The adapter factory. */
export function cortexAuditMiddleware(
  config: CortexAuditMiddlewareConfig
): CortexServiceAdapter<
  { audit: CortexAuditCtx },
  Pact<unknown>,
  CortexAuditMiddlewareConfig
>;

/**
 * Composed form — a function that takes the inner invoke pipeline
 * and wraps it to emit audit events on every AgentEvent AND on the
 * final AgentResult. The shape matches pacta's middleware convention
 * (see middleware/budget-enforcer.ts).
 */
export interface ComposedCortexAuditMiddleware extends ComposedAdapter<Pact<unknown>> {
  readonly name: 'cortex-audit';
  wrap<T>(
    inner: (p: Pact<T>, r: AgentRequest) => Promise<AgentResult<T>>
  ): (p: Pact<T>, r: AgentRequest) => Promise<AgentResult<T>>;

  /** Exposed so pacta providers can stream-emit audit records out of `onEvent`. */
  emit(event: AgentEvent, request: AgentRequest): Promise<void>;
}
```

### 3.1 Event-type mapping (complete, v1)

Every pacta `AgentEvent` variant maps to exactly one entry in the PRD-065
`AppDomainEvent` hierarchy. Mapping is exhaustive — new AgentEvent
variants added to pacta require a mapping here or a compose-time warning.

| pacta `AgentEvent.type` | PRD-065 `eventType` (app-domain-event) | payload fields |
|---|---|---|
| `started` | `method.agent.started` | `{ sessionId, pactId, mode, reasoningEffort }` |
| `text` | `method.agent.text` (suppressed by default) | `{ contentPreview }` (first 200 chars) |
| `thinking` | `method.agent.thinking` | `{ contentPreview }` |
| `tool_use` | `method.agent.tool_use` | `{ tool, toolUseId, inputRedacted }` |
| `tool_result` | `method.agent.tool_result` | `{ tool, toolUseId, durationMs, outputSizeBytes }` |
| `turn_complete` | `method.agent.turn_complete` | `{ turnNumber, usage }` |
| `context_compacted` | `method.agent.context_compacted` | `{ fromTokens, toTokens }` |
| `reflection` | `method.agent.reflection` | `{ trial, critiquePreview }` |
| `budget_warning` | `method.agent.budget_warning` | `{ resource, consumed, limit, percentUsed }` |
| `budget_exhausted` | `method.agent.budget_exhausted` | `{ resource, consumed, limit }` |
| `error` | `method.agent.error` | `{ message, code, recoverable }` |
| `completed` | `method.agent.completed` | `{ usage, cost, durationMs, turns, stopReason }` |
| Cognitive events (`CognitiveEvent`) | `method.cognitive.<variant>` | variant-specific, preserves module name + cycle |

**Redaction:** `inputRedacted` and `contentPreview` are the only places
where agent-provided content enters an audit payload. Redaction relies
on the Cortex `RedactionPolicy` (PRD-065 §6.3) against the app's declared
`requires.secrets.keys`. The middleware **never** writes tool_result
`output` bodies directly — only a size indicator — because tool outputs
commonly include large retrieval results that aren't useful in audit.

**Automatic SDK audit:** every `ctx.llm.complete/...` call already produces a
`platform-call` audit event (PRD-065 §6.2). The agent-runtime adds the
`method.agent.*` layer ON TOP — the two are complementary, not redundant.

### 3.2 Wrapping contract

The middleware wraps the pacta invoke pipeline at the same layer the
budget enforcer uses (outermost). Ordering (outer → inner):

```
CortexAuditMiddleware            (this surface — records every event)
  → CortexTokenExchangeMiddleware (§5 — exchanges tokens for nested calls)
    → pacta budgetEnforcer        (predictive pre-flight — §4)
      → pacta outputValidator
        → pacta reasoner middleware (effortMapper, reactReasoner, ...)
          → CortexLLMProvider.invoke  (actual ctx.llm call)
```

The middleware hooks `onEvent` in pacta's event pipe so every event is
shadow-emitted to `ctx.audit.event()`. Audit emission is fire-and-forget
(PRD-065 §6.4 — write failures don't fail the agent) but errors are
collected into the returned `AgentResult.errors[]` for diagnosis.

### 3.3 Compose-time validation

| Check | Error reason | Detail |
|---|---|---|
| `ctx.audit` missing | `missing_ctx_service` | `{ service: 'audit' }` |
| `config.appId` empty | `invalid_config` | `{ field: 'appId' }` |

No handler validation here — audit has no mandatory app-side handlers.

---

## 4. Budget Double-Count Resolution

**The problem.** Pacta has `budgetEnforcer` (predictive — deducts from a
local `BudgetState` using `result.usage/cost` after each turn). Cortex has
atomic check-and-reserve (predictive — reserves `estimatedCost` before the
provider call, reconciles after). Both claim to be the enforcement layer.
If both count, the agent appears to burn budget twice.

**The resolution (the contract).**

1. **Cortex `ctx.llm` is the authority.** `BudgetExceeded` as decided by
   Cortex is the only "hard" budget stop. The enforcer does not
   independently reject calls based on cost.
2. **Pacta's `budgetEnforcer` operates in PREDICTIVE-ONLY mode when
   composed with a provider whose `capabilities().budgetEnforcement === 'native'`.**
   This is a named mode added to `budgetEnforcer` for S3:

   ```typescript
   // packages/pacta/src/middleware/budget-enforcer.ts (extended)
   export interface BudgetEnforcerOptions {
     /**
      * 'authoritative' — default; the enforcer rejects on exhaustion.
      * 'predictive'    — the enforcer only EMITS warnings/exhaustion events;
      *                   it does NOT alter flow. Use when the provider
      *                   (e.g., ctx.llm) enforces atomically downstream.
      */
     mode: 'authoritative' | 'predictive';
   }
   ```

3. **Cost accounting uses REAL numbers from ctx.llm.** `CompletionResult.costUsd`
   (post-reconcile) is what gets added to `state.totalCostUsd` inside the
   enforcer. The enforcer's estimate-from-pricing fallback is never used
   when the provider is `CortexLLMProvider` — that fallback stays for the
   Anthropic/Claude-CLI providers.
4. **Turns and duration stay authoritative in pacta.** Those two resources
   aren't tracked by `ctx.llm`. The enforcer continues to reject on
   `maxTurns` / `maxDurationMs`. This is explicit in the mode contract:
   predictive mode downgrades ONLY token and cost enforcement, not turn
   and duration enforcement.
5. **Budget status stream-through.** After every provider call, the
   provider writes `ctx.llm.budget()` (or the equivalent cheap-read in
   PRD-068 §5.2 `BudgetStatus`) into `AgentResult.cost.budgetConsumedPercent`.
   The agent runtime then emits a single authoritative `budget_warning`
   event at 80%/95% — NOT two (one from ctx.llm's handlers, one from
   pacta). Pacta's warning emission is suppressed when
   `budgetEnforcement === 'native'`.

**Summary:** one authority (`ctx.llm`) for cost/tokens, one source of
events (pacta, mirroring Cortex's decisions), no double-charging, no
races. Turns and duration remain pacta's job because Cortex doesn't
know about them.

**Gate `G-BUDGET-SINGLE-AUTHORITY`:** for any composition where
`AgentProvider.capabilities().budgetEnforcement === 'native'`, the
`budgetEnforcer` MUST be constructed with `{ mode: 'predictive' }`. The
`createMethodAgent` factory enforces this and fails compose otherwise
(`CortexAdapterComposeError { reason: 'invalid_config' }`).

---

## 5. Surface 3 — `CortexTokenExchangeMiddleware`

### Purpose
Every outbound call the agent makes to a Cortex service must present a
user-scoped token per RFC-005 §4.1.5 (RFC 8693). The agent runtime holds
a service-account JWT; it exchanges it for a per-user delegated token
once at the top of each invocation and re-exchanges (once more) if a
sub-agent is spawned. Depth MUST NOT exceed 2.

### Interface

```typescript
// packages/agent-runtime/src/cortex/token-exchange-middleware.ts
import type { Pact, AgentRequest, AgentResult } from '@method/pacta';
import type { CortexAuthCtx, ScopedToken } from './ctx-types.js';
import type {
  CortexServiceAdapter, ComposedAdapter
} from './adapter.js';

/** Depth-2 cap per RFC-005 §4.1.5 Wave 0. */
export const MAX_DELEGATION_DEPTH = 2;

export interface CortexTokenExchangeConfig {
  /** The appId requesting the exchange — becomes `audience` claim. */
  appId: string;

  /**
   * Scope narrowing function. Called with the user's scope list;
   * must return a subset. Escalation is enforced server-side too,
   * but this client-side pre-check lets us fail fast.
   */
  narrowScope: (userScope: string[], pact: Pact<unknown>) => string[];

  /** Optional TTL override for the exchanged token (bounded by server policy). */
  ttlSeconds?: number;
}

export function cortexTokenExchangeMiddleware(
  config: CortexTokenExchangeConfig
): CortexServiceAdapter<
  { auth: CortexAuthCtx },
  Pact<unknown>,
  CortexTokenExchangeConfig
>;

export interface ComposedCortexTokenExchangeMiddleware extends ComposedAdapter<Pact<unknown>> {
  readonly name: 'cortex-token-exchange';

  /**
   * The middleware wraps invoke the same way budget-enforcer does.
   * Inside, it calls `ctx.auth.exchange()` and attaches the resulting
   * ScopedToken to request.metadata.__cortexDelegatedToken for the
   * inner chain to consume.
   */
  wrap<T>(
    inner: (p: Pact<T>, r: AgentRequest) => Promise<AgentResult<T>>
  ): (p: Pact<T>, r: AgentRequest) => Promise<AgentResult<T>>;

  /**
   * Called by any sub-agent spawner (e.g., pacta's subagentDelegator).
   * Produces an exchanged token for the child, enforcing depth cap.
   */
  exchangeForSubAgent(
    parentToken: ScopedToken,
    childAppId: string,
    childScope: string[]
  ): Promise<ScopedToken>;
}
```

### 5.1 Parent-user token → agent-scoped token (per invocation)

```
ctx.auth.exchange({
  subjectTokenType:  'urn:ietf:params:oauth:token-type:jwt',
  subjectToken:       request.metadata.parentUserToken,
  actorTokenType:    'urn:ietf:params:oauth:token-type:jwt',
  actorToken:         ctx.auth.serviceAccountToken, // agent's own
  audience:           config.appId,
  scope:              config.narrowScope(parseScope(parentUserToken.scope), pact).join(' '),
  requestedTokenType:'urn:ietf:params:oauth:token-type:jwt',
}): Promise<ScopedToken>
```

The returned `ScopedToken` carries an `act_as` chain. Its depth is
computed by `parseActChain(token).length` — at v1 this is expected to
be 1 after first exchange (user → agent).

### 5.2 Sub-agent exchange (for pacta's `subagentDelegator`)

When the pact wires a sub-agent, the delegator calls
`exchangeForSubAgent(parentToken, childAppId, childScope)` BEFORE
spawning the child. The middleware:

1. Reads `parseActChain(parentToken).length`.
2. If `length >= MAX_DELEGATION_DEPTH` → throw
   `CortexDelegationDepthExceededError` (see §5.4). The sub-agent is
   not spawned.
3. Otherwise, calls `ctx.auth.exchange(...)` with `actorToken` set to
   `parentToken` (chaining). Returns the new `ScopedToken`.
4. The spawned sub-agent's own `CortexTokenExchangeMiddleware` does NOT
   re-exchange — it consumes `parentToken` directly. Depth increments
   happen at exchange time, not at wrap time.

### 5.3 Depth enforcement placement

**Placement: this middleware, specifically `exchangeForSubAgent`.** Not:

- `pacta.subagentDelegator` (generic — doesn't know about tokens).
- `CortexLLMProvider.invoke` (wrong layer — individual LLM calls are
  not exchange events).
- The platform alone (server-side enforcement is there per RFC-005, but
  client-side fail-fast is required for good UX — a sub-agent should
  never be spawned if we know its exchange will be rejected).

Both client-side AND server-side enforce, by design. Client-side is the
defensive check; server-side is authoritative.

### 5.4 Error types (all typed, never thrown from invoke hot path unchecked)

```typescript
export class CortexDelegationDepthExceededError extends Error {
  readonly depth: number;
  readonly max = MAX_DELEGATION_DEPTH;
  constructor(depth: number) {
    super(`Token delegation depth ${depth} exceeds max ${MAX_DELEGATION_DEPTH}`);
    this.name = 'CortexDelegationDepthExceededError';
    this.depth = depth;
  }
}

export class CortexSubjectUnauthorizedError extends Error {
  readonly subjectSub: string | undefined;
  constructor(subjectSub: string | undefined, reason: string) {
    super(`Subject unauthorized for token exchange: ${reason}`);
    this.name = 'CortexSubjectUnauthorizedError';
    this.subjectSub = subjectSub;
  }
}

export class CortexScopeEscalationError extends Error {
  readonly requestedScope: string[];
  readonly allowedScope: string[];
  constructor(requested: string[], allowed: string[]) {
    super(`Scope escalation rejected: requested ${requested.length} beyond allowed`);
    this.name = 'CortexScopeEscalationError';
    this.requestedScope = requested;
    this.allowedScope = allowed;
  }
}
```

All three surface up as pacta `AgentEvent { type: 'error', recoverable: false, code: 'cortex_delegation_*' }`.
The agent run is aborted with `stopReason: 'error'`.

### 5.5 Compose-time validation

| Check | Error |
|---|---|
| `ctx.auth` missing | `missing_ctx_service` |
| `config.appId` empty | `invalid_config` |
| `config.narrowScope` not a function | `invalid_config` |

### 5.6 Audit linkage

Every successful exchange is mirrored as an `AgentEvent`
`{ type: 'text', content: '[act_as chain: user → agent]' }`? **No — reject
that pattern.** Token activity is sensitive. The exchange itself is
audited by `ctx.auth` server-side per RFC-005 §4.1.5. The agent runtime
records a sanitized entry via `CortexAuditMiddleware`:

```typescript
ctx.audit.event({
  eventType: 'method.agent.token_exchange',
  payload: {
    depth: parseActChain(token).length,
    audience: config.appId,
    scopeCount: narrowedScope.length,
    // NEVER the token itself, NEVER the subject sub.
  }
})
```

---

## 6. Producer / Consumer Mapping

| Surface | Producer (file) | Consumer (file) | Wiring |
|---|---|---|---|
| `CortexServiceAdapter<>` pattern | `packages/agent-runtime/src/cortex/adapter.ts` (NEW) | All three adapters + future S4–S6 | Type-only; pattern enforcement via gate tests |
| `CortexLLMProvider` | `packages/agent-runtime/src/cortex/llm-provider.ts` (NEW) | `packages/agent-runtime/src/create-method-agent.ts` (NEW, owned by PRD-060) | `createMethodAgent({ ctx, pact, providers: [cortexLLMProvider({...})] })` |
| `CortexAuditMiddleware` | `packages/agent-runtime/src/cortex/audit-middleware.ts` (NEW) | Same factory | Registered in middleware chain after token-exchange |
| `CortexTokenExchangeMiddleware` | `packages/agent-runtime/src/cortex/token-exchange-middleware.ts` (NEW) | Same factory | Outermost of the Cortex-layer middlewares |
| `budgetEnforcerOptions.mode` extension | `packages/pacta/src/middleware/budget-enforcer.ts` (EXTEND) | `createMethodAgent` + any consumer of the enforcer | New optional `options.mode` on the factory |

**Package layering:** adapters live in `@method/agent-runtime` (L3),
**not** in `@method/pacta` (L2). Pacta must not depend on Cortex types.
The pacta-level change (predictive mode on `budgetEnforcer`) is pure —
no Cortex imports; it adds a mode flag to an existing option bag.

**The single mode-flag change to pacta IS a minor breaking change to the
middleware factory signature.** See §7 gate assertions for how we ship
it safely (new optional field, backward-compatible default = `'authoritative'`).

---

## 7. Gate Assertions

Added to the architecture test for `@method/agent-runtime`:

```typescript
// packages/agent-runtime/src/architecture.test.ts

describe('Cortex adapter gates', () => {
  it('G-CORTEX-ONLY-PATH: adapters never import ctx directly — all ctx access is via explicit slice', () => {
    const offenders = scanImports('src/cortex/**/*.ts', /from ['"]@t1\/cortex-sdk['"]$/);
    // allowed: ctx-types.ts re-declaration file (the seam).
    expect(offenders.filter(f => !f.endsWith('ctx-types.ts'))).toEqual([]);
  });

  it('G-LLM-HANDLERS-PRESENT: cortexLLMProvider compose rejects missing handlers', () => {
    expect(() => cortexLLMProvider({ handlers: {} as any }).compose({
      ctx: { llm: mockLlm },
      pact: anyPact,
    })).toThrow(CortexAdapterComposeError);
  });

  it('G-BUDGET-SINGLE-AUTHORITY: createMethodAgent forces predictive mode for native providers', () => {
    const agent = createMethodAgent({ ctx, pact, providers: [cortexLLMProvider({...})] });
    expect(agent.diagnostics.budgetEnforcerMode).toBe('predictive');
  });

  it('G-TOKEN-DEPTH-CAP: exchangeForSubAgent throws at depth 2', async () => {
    const mw = cortexTokenExchangeMiddleware({ appId: 'test', narrowScope: s => s }).compose({
      ctx: { auth: mockAuth }, pact: anyPact,
    });
    const depth2 = makeTokenWithDepth(2);
    await expect(mw.exchangeForSubAgent(depth2, 'child', [])).rejects.toBeInstanceOf(CortexDelegationDepthExceededError);
  });

  it('G-AUDIT-EXHAUSTIVE: every AgentEvent.type has a mapping entry', () => {
    const types = extractAgentEventTypes(); // from pacta/src/events.ts
    for (const t of types) expect(AUDIT_EVENT_MAP).toHaveProperty(t);
  });

  it('G-ADAPTER-SHAPE: every *Adapter.ts exports a factory returning CortexServiceAdapter<>', () => {
    const files = glob('src/cortex/*-{provider,middleware,store,executor}.ts');
    for (const f of files) expect(exportsCortexServiceAdapter(f)).toBe(true);
  });
});
```

Gate `G-ADAPTER-SHAPE` is how the pattern gets enforced for future
S4–S6 work without a reviewer having to remember.

---

## 8. Open Items Handed Back to the Caller

These are NOT frozen by this record — they are deliberate deferrals that
the consuming PRDs (059, 060) or Cortex co-designs must settle:

1. **Streaming.** `CortexLLMProvider.capabilities().streaming = false` for v1.
   Re-open when PRD-068 Wave 7 decides. No change to the surface shape —
   adding `stream()` is additive on `Streamable`.
2. **Pacta budget-enforcer mode extension.** The new option is a pacta-level
   change. PRD-059 carries it; bump `@method/pacta` minor (no breaking API).
3. **`ctx.llm` structured extras.** `thinkingBudgetTokens` and `temperature`
   require a negotiated `extra` field on `CompletionRequest` in the Cortex
   12.3 co-design. Until then, those drop silently. This is acceptable for
   April 21 demos.
4. **RedactionPolicy field list.** The middleware delegates to Cortex; no
   method-local list. If PRD-065's redaction omits a field we want
   redacted (e.g., tool inputs that look like secrets), we do NOT add a
   second redaction layer here — we file a Cortex PRD update.
5. **Sub-agent spawn path.** Pacta has `subagentDelegator`, but the concrete
   wiring to `exchangeForSubAgent` lives in `createMethodAgent` (PRD-060),
   not in this surface. S3 provides the function; S1 calls it.

---

## 9. Freeze

- **Frozen:** 2026-04-14
- **Author:** Lysica (co-design session)
- **Changes require:** new `/fcd-surface` session citing this record as supersedes
- **Tracking:** PRD-059

> Both sides can now implement independently against this contract.
> The pattern defined here IS the coordination for S4 (CortexSessionStore),
> S5 (JobBackedExecutor), S6 (CortexEventConnector) — those PRDs reference
> this record rather than redefining the adapter shape.
